#!/usr/bin/env python3
"""Augmented 2 s training windows (and their openWakeWord features) from the owner's real recordings.

Windows are cut from the continuous session2 recording itself, so the audio around each utterance is the
real room (hum, mic noise, the tail of the previous sentence), never digital silence.

positives (close-range "Hey Canvas" tries): the window ends 0-300 ms after the phrase, like openWakeWord's
  create_fixed_size_clip (0-200 ms); speed 0.9-1.1 (resample), pitch +-2 semitones (p=0.4), 7-band EQ +-4 dB
  (p=0.3), AudioSet/FMA background at 5-20 dB SNR (p=0.3), a mild MIT RIR mixed 20-50 % wet (p=0.2),
  loudness +-4 dB and the service gain x1..x4 (log-uniform), clipped to int16.
labels (the owner's own non-wake speech): same augmentations, windows ending anywhere from 0.3 s into the
  utterance to 0.6 s after it.
room: room-only windows (session1/2 silences) at x1..x4, half of them with AudioSet/FMA mixed in.

Output: <out_dir>/<name>.npy features (N, 16, 96) per utterance, and <out_dir>/room.npy.
Usage: real_aug.py <real-voice dir> <out_dir> [--n-pos 1500] [--n-neg 400] [--n-room 6000]
"""
import argparse
import json
import os
import sys
import wave
from multiprocessing import get_context

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from feats2 import room_bank, room_chunk  # noqa: E402

SR = 16000
TOTAL = 32000


def load_wav(p):
    import soundfile as sf
    x, sr = sf.read(p, dtype="int16", always_2d=True)
    assert sr == SR, p
    return x.mean(1).astype(np.float32)


def resample_to(x, n):
    from scipy.signal import resample
    return resample(x, n)


def augment(src, end_s, rng, kit, positive):
    """src: whole session (float). end_s: where the window should end in the source (before speed)."""
    import librosa
    s = rng.uniform(0.9, 1.1)
    n_src = int(round(TOTAL * s))
    e = int(end_s * SR)
    a = src[max(0, e - n_src):e]
    if len(a) < n_src:
        a = np.concatenate([room_chunk(rng, kit["bank"], n_src - len(a)), a])
    x = resample_to(a.astype(np.float64), TOTAL)
    if rng.random() < 0.4:
        x = librosa.effects.pitch_shift(x.astype(np.float32), sr=SR, n_steps=rng.uniform(-2, 2)).astype(np.float64)
    if rng.random() < 0.3:
        x = kit["eq"](samples=x.astype(np.float32), sample_rate=SR).astype(np.float64)
    if rng.random() < 0.2:
        r = load_wav(kit["rirs"][rng.integers(len(kit["rirs"]))]).astype(np.float64)
        r = r / (np.abs(r).max() + 1e-9)
        wet = np.convolve(x, r)[:TOTAL]
        wet *= np.sqrt(np.mean(x ** 2)) / (np.sqrt(np.mean(wet ** 2)) + 1e-9)
        m = rng.uniform(0.2, 0.5)
        x = (1 - m) * x + m * wet
    if rng.random() < 0.3:
        b = load_wav(kit["bg"][rng.integers(len(kit["bg"]))]).astype(np.float64)
        if len(b) > TOTAL:
            i = rng.integers(0, len(b) - TOTAL)
            b = b[i:i + TOTAL]
        else:
            b = np.pad(b, (0, TOTAL - len(b)))
        sp = np.sqrt(np.mean(x[-int(1.2 * SR):] ** 2)) + 1e-3
        snr = rng.uniform(5, 20)
        x = x + b * (sp / 10 ** (snr / 20) / (np.sqrt(np.mean(b ** 2)) + 1e-3))
    x = x * 10 ** (rng.uniform(-4, 4) / 20) * np.exp(rng.uniform(0, np.log(4)))
    return np.clip(np.round(x), -32768, 32767).astype(np.int16)


def make_kit():
    import audiomentations
    return {
        "bank": room_bank(),
        "rirs": [e.path for e in os.scandir(f"{W}/data/mit_rirs") if e.name.endswith(".wav")],
        "bg": [e.path for d in ("audioset_16k", "fma_16k") for e in os.scandir(f"{W}/data/{d}") if e.name.endswith(".wav")],
        "eq": audiomentations.SevenBandParametricEQ(min_gain_db=-4, max_gain_db=4, p=1.0),
    }


def job(args):
    name, kind, on, off, n, seed, rv, out_dir = args
    from openwakeword.utils import AudioFeatures
    rng = np.random.default_rng(seed)
    kit = make_kit()
    F = AudioFeatures(device="cpu", ncpu=1)
    if kind == "room":
        xs = []
        for _ in range(n):
            x = room_chunk(rng, kit["bank"]).astype(np.float64)
            if rng.random() < 0.5:
                b = load_wav(kit["bg"][rng.integers(len(kit["bg"]))]).astype(np.float64)
                if len(b) > TOTAL:
                    i = rng.integers(0, len(b) - TOTAL)
                    b = b[i:i + TOTAL]
                else:
                    b = np.pad(b, (0, TOTAL - len(b)))
                b *= np.exp(rng.uniform(np.log(50), np.log(800))) / (np.sqrt(np.mean(b ** 2)) + 1e-3)
                x = x + b
            x *= np.exp(rng.uniform(0, np.log(4)))
            xs.append(np.clip(np.round(x), -32768, 32767).astype(np.int16))
    else:
        src = load_wav(f"{rv}/session2.wav")
        xs = []
        for _ in range(n):
            if kind == "pos":
                end = off + rng.uniform(0.0, 0.3)
            else:
                end = rng.uniform(on + 0.3, off + 0.6)
            xs.append(augment(src, end, rng, kit, kind == "pos"))
    X = np.stack(xs)
    feats = np.concatenate([F.embed_clips(X[i:i + 64], batch_size=64, ncpu=1) for i in range(0, len(X), 64)])
    np.save(f"{out_dir}/{name}.npy", feats.astype(np.float32))
    np.save(f"{out_dir}/{name}.audio_sample.npy", X[:8])
    return name, feats.shape


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rv")
    ap.add_argument("out_dir")
    ap.add_argument("--n-pos", type=int, default=1500)
    ap.add_argument("--n-neg", type=int, default=400)
    ap.add_argument("--n-room", type=int, default=6000)
    ap.add_argument("--workers", type=int, default=12)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    utt = json.load(open(f"{W}/real/utterances.json"))
    jobs = []
    for i, u in enumerate(utt):
        if u["use"] == "pos":
            jobs.append((u["name"], "pos", u["on"], u["off"], a.n_pos, 1000 + i, a.rv, a.out_dir))
        elif u["use"] == "neg":
            jobs.append((u["name"], "neg", u["on"], u["off"], a.n_neg, 2000 + i, a.rv, a.out_dir))
    per = a.n_room // 6
    for k in range(6):
        jobs.append((f"room{k}", "room", 0, 0, per, 3000 + k, a.rv, a.out_dir))
    with get_context("spawn").Pool(a.workers) as pool:
        for name, shape in pool.imap_unordered(job, jobs):
            print(name, shape, flush=True)


if __name__ == "__main__":
    main()
