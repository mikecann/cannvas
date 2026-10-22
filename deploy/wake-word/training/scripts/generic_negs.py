#!/usr/bin/env python3
"""Generic speech negatives "through the Cannvas mic": random 2 s crops of LibriSpeech dev-clean/dev-other
(speakers and texts disjoint from the test-clean/test-other false-positive streams), each put through
feats2.micsim (mic low-pass + real speech level + room background + x1..x4 gain) with --mic-share, else the
room background at 0-20 dB SNR. Gives the model plenty of "ordinary speech through this mic in this room"
labelled negative, so the mic's colouration and hum can't act as evidence for the wake word.
Usage: generic_negs.py <LibriSpeech dir> <out.npy> [--n 40000] [--mic-share 0.7] [--workers 12]"""
import argparse
import glob
import os
import sys
from multiprocessing import get_context

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feats2 import micsim, room_bank  # noqa: E402

TOTAL = 32000


def job(args):
    k, files, n, seed, share = args
    import soundfile as sf
    from openwakeword.utils import AudioFeatures
    rng = np.random.default_rng(seed)
    bank = room_bank()
    F = AudioFeatures(device="cpu", ncpu=1)
    xs = []
    while len(xs) < n:
        d, sr = sf.read(files[rng.integers(len(files))], dtype="float64")
        if len(d) <= TOTAL + 1:
            continue
        i = rng.integers(0, len(d) - TOTAL)
        x = d[i:i + TOTAL] * 32767 * np.exp(rng.uniform(np.log(0.125), 1))
        xs.append(micsim(x, rng, bank, share))
    X = np.stack(xs)
    return k, np.concatenate([F.embed_clips(X[i:i + 64], batch_size=64, ncpu=1) for i in range(0, len(X), 64)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ls")
    ap.add_argument("out")
    ap.add_argument("--n", type=int, default=40000)
    ap.add_argument("--mic-share", type=float, default=0.7)
    ap.add_argument("--workers", type=int, default=12)
    a = ap.parse_args()
    files = sorted(glob.glob(f"{a.ls}/dev-clean/*/*/*.flac") + glob.glob(f"{a.ls}/dev-other/*/*/*.flac"))
    print(len(files), "dev utterances", flush=True)
    jobs = [(k, files, a.n // 40, 500 + k, a.mic_share) for k in range(40)]
    parts = {}
    with get_context("spawn").Pool(a.workers) as pool:
        for k, f in pool.imap_unordered(job, jobs):
            parts[k] = f
    x = np.concatenate([parts[k] for k in range(40)])
    x = x[np.random.default_rng(11).permutation(len(x))]
    np.save(a.out, x.astype(np.float32))
    print("saved", a.out, x.shape)


if __name__ == "__main__":
    main()
