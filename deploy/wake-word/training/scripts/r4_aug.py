#!/usr/bin/env python3
"""Round 4 augmentation + openWakeWord features, on the GPU.

Why this exists: rounds 1-3 used openWakeWord's stock augmentation (270 MIT
impulse responses at p=0.5, background noise), and every round missed Mike's
real tries from the sofa. The stock hey_jarvis model was trained on clips
reverberated with ~100k simulated rooms (the BIRD dataset) instead. This script
gives each clip one of two treatments:

  near: roughly the stock recipe (MIT or simulated close RIR at p=0.5, AudioSet/FMA
        background at -5..20 dB SNR, mild EQ, random level).
  far:  a simulated lounge matched to what the XVF3800's ASR beam (FR) sends:
        pyroomacoustics room at 0.7-7 m (bank from r4_rirs.py), partial dereverb
        (the chip attenuates the late tail), TV-like interference (speech, music,
        AudioSet) through a second RIR, recorded XVF room tone at its real level,
        an optional Wiener-style noise suppressor (musical-noise artefacts), random
        smooth EQ plus high/low-pass, and an AGC-like level of -38..-20 dBFS RMS,
        which is the range Mike's speech reached on FR in the live recording.

Clips are placed like openWakeWord's create_fixed_size_clip: end-aligned in a
2 s window with 0-200 ms of jitter (positives) or 0-600 ms (negatives).

Usage:
  r4_aug.py clips --out f.npy --mode near|far|mix --kind pos|neg DIR [DIR ...]
  r4_aug.py speech --out f.npy --n N --files LIST.txt      (random 2 s crops of long speech)
"""
import argparse
import os
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

W = Path(os.environ.get('W', Path(__file__).resolve().parents[1]))
SR, TOTAL = 16000, 32000
NFFT = 65536  # >= TOTAL + longest RIR (1 s)


def read(path, n=None):
    x, sr = sf.read(path, dtype='float32', always_2d=True)
    assert sr == SR, (path, sr)
    x = x[:, 0]
    if n is not None and len(x) > n:
        k = random.randrange(len(x) - n)
        x = x[k:k + n]
    return x


class Banks:
    """Everything the augmenter samples from, loaded once onto the GPU."""

    def __init__(self, dev):
        self.dev = dev
        far = np.load(W / 'data/r4_rirs/far.npy')        # (N, 16000), direct path at 1.0
        near = np.load(W / 'data/r4_rirs/near.npy')
        mit = []
        for p in sorted((W / 'data/mit_rirs').glob('*.wav')):
            r = read(p)[:16000]
            mit.append(np.pad(r / max(1e-6, np.abs(r).max()), (0, 16000 - len(r))))
        self.far = torch.from_numpy(far).to(dev)
        self.near = torch.from_numpy(np.concatenate([near, np.stack(mit)])).to(dev)
        self.far_f = torch.fft.rfft(self.far, NFFT)
        self.near_f = torch.fft.rfft(self.near, NFFT)
        # Recorded XVF3800 FR room tone (coach-session settle spans only, never a held-out try).
        room = np.load(W / 'data/r4_room_fr.npy').astype(np.float32)
        self.room = torch.from_numpy(room).to(dev)
        self.bg = sorted(str(p) for d in ('audioset_16k', 'fma_16k') for p in (W / 'data' / d).glob('*.wav'))
        tv = W / 'data/r4_tv_speech.txt'
        self.tv_speech = tv.read_text().split() if tv.exists() else []
        assert self.bg, 'no background audio'

    def interferer(self, n, pool):
        """TV-like: other speech (LibriSpeech speakers not used as negatives), music or AudioSet."""
        paths = [random.choice(self.tv_speech) if self.tv_speech and random.random() < .45 else random.choice(self.bg) for _ in range(n)]
        out = list(pool.map(lambda p: read(p, TOTAL), paths))
        return torch.from_numpy(np.stack([np.resize(x, TOTAL) if len(x) else np.zeros(TOTAL, np.float32) for x in out])).to(self.dev)


def place(clips, kind):
    out = np.zeros((len(clips), TOTAL), np.float32)
    for i, x in enumerate(clips):
        jitter = int(random.uniform(0, .2 if kind == 'pos' else .6) * SR)
        if len(x) >= TOTAL - jitter:
            x = x[-(TOTAL - jitter):]
        out[i, TOTAL - jitter - len(x):TOTAL - jitter] = x
    return out


def rms(x, tail=None):
    seg = x if tail is None else x[:, -tail:]
    return seg.pow(2).mean(dim=1, keepdim=True).sqrt() + 1e-7


def convolve(x, rir_f, idx):
    y = torch.fft.irfft(torch.fft.rfft(x, NFFT) * rir_f[idx], NFFT)[:, :TOTAL]
    return y


def smooth_eq(x, strength_db, hp, lp):
    """Random smooth spectral tilt/bumps plus soft high-pass and optional low-pass, in one FFT."""
    B = x.shape[0]
    X = torch.fft.rfft(x, TOTAL)
    f = torch.linspace(0, SR / 2, X.shape[1], device=x.device)
    logf = torch.log2(f.clamp(min=20) / 1000)[None]
    gain_db = torch.zeros(B, X.shape[1], device=x.device)
    for _ in range(3):
        c = torch.empty(B, 1, device=x.device).uniform_(-2.5, 2.5)
        w = torch.empty(B, 1, device=x.device).uniform_(.4, 1.6)
        a = torch.empty(B, 1, device=x.device).uniform_(-1, 1) * strength_db
        gain_db = gain_db + a * torch.exp(-((logf - c) / w) ** 2)
    g = 10 ** (gain_db / 20)
    g = g / (1 + (hp[:, None] / f.clamp(min=1)[None]) ** 4)          # 2nd-order-ish high-pass
    g = g / (1 + (f[None] / lp[:, None]) ** 8)                        # low-pass (lp=inf disables)
    return torch.fft.irfft(X * g, TOTAL)


def wiener(x, strength, floor):
    """Crude single-channel noise suppressor: noise PSD from the quietest 20% of frames."""
    win = torch.hann_window(512, device=x.device)
    S = torch.stft(x, 512, 128, window=win, return_complex=True)
    P = S.abs() ** 2
    q = torch.quantile(P, .2, dim=2, keepdim=True)
    G = (1 - strength[:, None, None] * q / (P + 1e-10)).clamp(min=0)
    G = torch.maximum(G, floor[:, None, None])
    return torch.istft(S * G, 512, 128, window=win, length=TOTAL)


def augment(clean, mode, banks, pool, kind):
    """clean: (B, TOTAL) float32 tensor on GPU at arbitrary level. Returns int16 numpy."""
    B, dev = clean.shape[0], clean.device
    x = clean / rms(clean, 19200) * .05
    U = lambda a, b: torch.empty(B, 1, device=dev).uniform_(a, b)
    far = torch.rand(B, 1, device=dev) < (1. if mode == 'far' else 0. if mode == 'near' else .6)
    # --- near branch (stock-like) ---
    rv = torch.rand(B, 1, device=dev) < .5
    idx = torch.randint(len(banks.near), (B,), device=dev)
    wet = convolve(x, banks.near_f, idx)
    near_x = torch.where(rv, wet / rms(wet, 19200) * .05, x)
    # --- far branch (simulated lounge + XVF3800-like processing) ---
    idx = torch.randint(len(banks.far), (B,), device=dev)
    rir = banks.far[idx].clone()
    # The chip's dereverb: attenuate everything later than 50 ms after the direct path.
    d = rir.abs().argmax(dim=1, keepdim=True)
    t = torch.arange(rir.shape[1], device=dev)[None]
    late = (t > d + 800).float()
    rir = rir * (1 - late) + rir * late * U(.25, 1.)
    far_x = torch.fft.irfft(torch.fft.rfft(x, NFFT) * torch.fft.rfft(rir, NFFT), NFFT)[:, :TOTAL]
    far_x = far_x / rms(far_x, 19200) * .05
    x = torch.where(far, far_x, near_x)
    # --- interference: TV/music/noise ---
    has_bg = torch.rand(B, 1, device=dev) < torch.where(far, torch.tensor(.6, device=dev), torch.tensor(.75, device=dev))
    bg = banks.interferer(B, pool)
    bidx = torch.randint(len(banks.far), (B,), device=dev)
    bg_far = convolve(bg, banks.far_f, bidx)
    bg = torch.where(far, bg_far, bg)
    snr = torch.where(far, U(0, 18), U(-5, 20))
    bg = bg / rms(bg) * rms(x, 19200) / 10 ** (snr / 20)
    x = x + torch.where(has_bg, bg, torch.zeros_like(bg))
    # --- EQ / band limits ---
    hp = torch.where(far[:, 0], U(60, 220)[:, 0], U(20, 120)[:, 0])
    lp_on = torch.rand(B, device=dev) < torch.where(far[:, 0], torch.tensor(.5, device=dev), torch.tensor(.15, device=dev))
    lp = torch.where(lp_on, U(3800, 7600)[:, 0], torch.full((B,), 1e9, device=dev))
    eq_db = torch.where(far[:, 0], torch.tensor(6., device=dev), torch.tensor(3., device=dev))[:, None]
    x = smooth_eq(x, eq_db, hp, lp)
    # --- level (the XVF3800's AGC keeps speech in a band regardless of distance) ---
    level_db = torch.where(far, U(-38, -20), U(-36, -10))
    x = x / rms(x, 19200) * 10 ** (level_db / 20)
    # --- recorded room tone at its real level (far: always; near: sometimes) ---
    k = torch.randint(0, banks.room.shape[0] - TOTAL, (B,), device=dev)
    room = torch.stack([banks.room[i:i + TOTAL] for i in k.tolist()])
    room_on = far | (torch.rand(B, 1, device=dev) < .3)
    x = x + room * U(.5, 1.5) * room_on
    # --- noise suppressor artefacts (far only, p=.4) ---
    ns = far[:, 0] & (torch.rand(B, device=dev) < .4)
    if ns.any():
        x[ns] = wiener(x[ns], U(1, 2.5)[ns, 0], U(.05, .3)[ns, 0])
    x = x * 32767
    return x.clamp(-32768, 32767).round().to(torch.int16).cpu().numpy()


def features(F, audio):
    return F.embed_clips(audio, batch_size=len(audio)).astype(np.float32)


def open_out(path, n):
    tmp = str(path) + '.partial.npy'
    return tmp, np.lib.format.open_memmap(tmp, mode='w+', dtype=np.float32, shape=(n, 16, 96))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('clips')
    c.add_argument('dirs', nargs='+')
    c.add_argument('--out', required=True)
    c.add_argument('--mode', choices=['near', 'far', 'mix'], required=True)
    c.add_argument('--kind', choices=['pos', 'neg'], required=True)
    c.add_argument('--rounds', type=int, default=1)
    c.add_argument('--limit', type=int, default=0)
    s = sub.add_parser('speech')
    s.add_argument('--files', required=True)
    s.add_argument('--n', type=int, required=True)
    s.add_argument('--out', required=True)
    for p in (c, s):
        p.add_argument('--seed', type=int, default=0)
        p.add_argument('--batch', type=int, default=256)
    a = ap.parse_args()
    if Path(a.out).exists():
        print('exists', a.out)
        return
    random.seed(a.seed); np.random.seed(a.seed); torch.manual_seed(a.seed)
    import onnxruntime as ort
    if hasattr(ort, 'preload_dlls'):
        ort.preload_dlls()
    from openwakeword.utils import AudioFeatures
    F = AudioFeatures(device='gpu')
    assert 'CUDA' in F.onnx_execution_provider, F.onnx_execution_provider
    dev = torch.device('cuda')
    banks = Banks(dev)
    pool = ThreadPoolExecutor(12)
    if a.cmd == 'clips':
        paths = sorted(str(p) for d in a.dirs for p in Path(d).glob('*.wav'))
        assert paths, a.dirs
        random.shuffle(paths)
        if a.limit:
            paths = paths[:a.limit]
        paths = paths * a.rounds
        kind, mode = a.kind, a.mode
        loader = lambda p: read(p)
    else:
        paths = Path(a.files).read_text().split()
        paths = [random.choice(paths) for _ in range(a.n)]
        kind, mode = 'neg', 'mix'
        loader = lambda p: read(p, TOTAL)
    tmp, dest = open_out(a.out, len(paths))
    for i in range(0, len(paths), a.batch):
        clips = list(pool.map(loader, paths[i:i + a.batch]))
        clean = torch.from_numpy(place(clips, kind)).to(dev)
        audio = augment(clean, mode, banks, pool, kind)
        dest[i:i + len(audio)] = features(F, audio)
        if (i // a.batch) % 50 == 0:
            print(Path(a.out).name, i + len(audio), '/', len(paths), flush=True)
    dest.flush()
    del dest
    os.replace(tmp, a.out)
    print('DONE', a.out, len(paths), flush=True)


if __name__ == '__main__':
    main()
