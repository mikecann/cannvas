#!/usr/bin/env python3
"""Augment TTS clips like train.py --augment_clips, then simulate the Cannvas microphone, and save features.

Step 1 is unchanged openWakeWord: openwakeword.data.augment_clips (EQ, distortion, pitch, band-stop,
coloured noise, AudioSet/FMA background at SNR -10..15 dB, gain -18..0 dB, MIT RIR at p=0.5), clip placed
at the end of a 2 s window with 0-200 ms after it.

Step 2 (new, "mic sim"), applied identically to positives and negatives so neither the hum nor the
colouration can become a cue for the wake word:
  * with probability --mic-share: the C-Media mini mic's response. Its recordings are 8-28 dB weaker than
    TTS above 1.8 kHz (see spectra.py), which a 4th-order Butterworth low-pass at 1.7-2.8 kHz matches.
    The clip is then set to the mic's real speech level (peak 400-4000 at x1; the owner's close-range
    tries peak at 600-3000), the room's own background (session1/2 silences, ~115 rms hum) is added at
    its real level (x0.7-1.4), and the service gain is applied (log-uniform x1..x4, clipped to int16).
  * otherwise: the room background is still added, at a speech-to-room SNR of 0-20 dB.

Rows follow sorted(clip paths); <out>.clips.txt lists them in order.
Usage: feats2.py --out out.npy [--mic-share 0.6] [--workers 8] [--seed 0] (--dir d | --list file) ...
"""
import argparse
import glob
import os
import sys
import wave
from multiprocessing import get_context

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.dirname(HERE)
TOTAL = 32000


def load_wav(p):
    with wave.open(p) as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32)


def room_bank():
    """Room background stretches with nobody speaking (checked by band energy)."""
    rv = os.environ.get("REAL_VOICE", os.path.join(os.path.dirname(W), "real-voice"))
    s1, s2 = load_wav(f"{rv}/session1.wav"), load_wav(f"{rv}/session2.wav")
    parts = [s1[0:44 * 16000], s1[92 * 16000:103 * 16000], s2[0:48 * 16000], s2[171 * 16000:182 * 16000]]
    return parts


def room_chunk(rng, bank, n=TOTAL):
    lens = np.array([len(p) - n for p in bank], float)
    p = bank[rng.choice(len(bank), p=lens / lens.sum())]
    i = rng.integers(0, len(p) - n)
    x = p[i:i + n].copy()
    if rng.random() < 0.5:
        x = -x
    return x


def micsim(x, rng, bank, mic_share):
    from scipy.signal import butter, sosfilt
    x = x.astype(np.float64)
    room = room_chunk(rng, bank, len(x)).astype(np.float64)
    if rng.random() < mic_share:
        fc = rng.uniform(1700, 2800)
        x = sosfilt(butter(4, fc, btype="low", fs=16000, output="sos"), x)
        peak = np.abs(x).max() + 1e-3
        x = x * (np.exp(rng.uniform(np.log(400), np.log(4000))) / peak)
        x = x + room * rng.uniform(0.7, 1.4)
        x = x * np.exp(rng.uniform(0, np.log(4)))
    else:
        rms = np.sqrt(np.mean(x ** 2)) + 1e-3
        snr = rng.uniform(0, 20)
        x = x + room * (rms / 10 ** (snr / 20) / (np.sqrt(np.mean(room ** 2)) + 1e-3))
    return np.clip(np.round(x), -32768, 32767).astype(np.int16)


def worker(job):
    idx, clips, a = job
    import random
    import torch
    torch.set_num_threads(1)
    random.seed(a["seed"] * 1000 + idx)
    np.random.seed(a["seed"] * 1000 + idx)
    torch.manual_seed(a["seed"] * 1000 + idx)
    rng = np.random.default_rng(a["seed"] * 1000 + idx + 7)
    from openwakeword.data import augment_clips
    from openwakeword.utils import AudioFeatures
    F = AudioFeatures(device="cpu", ncpu=1)
    rirs = [e.path for e in os.scandir(f"{W}/data/mit_rirs") if e.name.endswith(".wav")]
    bg = [e.path for d in ("audioset_16k", "fma_16k") for e in os.scandir(f"{W}/data/{d}") if e.name.endswith(".wav")]
    bank = room_bank()
    out = []
    gen = augment_clips(clips, total_length=TOTAL, batch_size=16, background_clip_paths=bg, RIR_paths=rirs)
    for batch in gen:
        if a["stock"]:  # plain openWakeWord augmentation (as train.py / feats_for_clips.py), no mic sim, no room
            b = batch
        else:
            b = np.stack([micsim(x, rng, bank, a["mic_share"]) for x in batch])
        out.append(F.embed_clips(b, batch_size=len(b), ncpu=1))
    feats = np.concatenate(out)
    assert len(feats) == len(clips), (len(feats), len(clips))
    np.save(f"{a['out']}.part{idx:03d}.npy", feats)
    return idx, len(feats)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--dir", nargs="*", default=[])
    ap.add_argument("--list")
    ap.add_argument("--mic-share", type=float, default=0.6)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--stock", action="store_true", help="skip step 2 (stock openWakeWord features)")
    a = vars(ap.parse_args())
    clips = []
    for d in a["dir"]:
        clips += sorted(glob.glob(os.path.join(d, "*.wav")))
    if a["list"]:
        clips += [l.strip() for l in open(a["list"]) if l.strip()]
    n = len(clips)
    k = max(1, min(a["workers"] * 4, n // 64))
    bounds = np.linspace(0, n, k + 1).astype(int)
    jobs = [(i, clips[bounds[i]:bounds[i + 1]], a) for i in range(k)]
    print(f"{n} clips in {k} shards on {a['workers']} workers -> {a['out']}", flush=True)
    with get_context("spawn").Pool(a["workers"]) as pool:
        for i, m in pool.imap_unordered(worker, jobs):
            print(f"shard {i} done ({m})", flush=True)
    parts = [np.load(f"{a['out']}.part{i:03d}.npy") for i in range(k)]
    x = np.concatenate(parts)
    np.save(a["out"], x)
    with open(a["out"] + ".clips.txt", "w") as f:
        f.write("\n".join(clips) + "\n")
    for i in range(k):
        os.remove(f"{a['out']}.part{i:03d}.npy")
    print("saved", a["out"], x.shape, flush=True)


if __name__ == "__main__":
    main()
