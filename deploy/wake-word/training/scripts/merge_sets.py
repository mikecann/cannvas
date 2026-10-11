#!/usr/bin/env python3
"""Merge mic-sim feature sets into the training files (row-shuffled with fixed seeds, like merge_features.py).
positive_train_merged.npy  = LibriTTS-R 100k (70k plain + 30k cut) + VCTK 25k + VCTK cut 10k   (seed 7)
negative_train_merged_A.npy = LibriTTS-R 60k + hard LibriTTS + VCTK custom/adversarial + VCTK hard (seed 8)
negative_train_merged_B.npy = the same minus clips whose text is "a canvas", "a canvas tote" or "a canvas <command>"
"""
import collections
import os
import sys
import numpy as np
W = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
F = f"{W}/" + (sys.argv[1] if len(sys.argv) > 1 else "feats")


def manifest_texts():
    t = {}
    for root, _, files in os.walk(f"{W}/runs"):
        for fn in files:
            if fn.endswith(".manifest.tsv"):
                for line in open(os.path.join(root, fn)):
                    p = line.rstrip("\n").split("\t")
                    t[p[0]] = p[1]
    return t


pos = [np.load(f"{F}/{n}.npy") for n in ("pos_libri", "pos_vctk", "pos_vctk_cut")]
x = np.concatenate(pos)
np.save(f"{F}/positive_train_merged.npy", x[np.random.default_rng(7).permutation(len(x))])
print("positives", [len(p) for p in pos], "->", len(x), flush=True)
del x, pos

texts = manifest_texts()
names = ("neg_libri", "neg_hard_libri", "neg_vctk", "neg_vctk_hard")
X, T = [], []
for n in names:
    a = np.load(f"{F}/{n}.npy")
    clips = [l.strip() for l in open(f"{F}/{n}.npy.clips.txt") if l.strip()]
    assert len(clips) == len(a), n
    X.append(a); T += [texts[os.path.basename(c)] for c in clips]
X = np.concatenate(X)
perm = np.random.default_rng(8).permutation(len(X))
X, T = X[perm], [T[i] for i in perm]
np.save(f"{F}/negative_train_merged_A.npy", X)
drop = np.array([t.lower() in ("a canvas", "a canvas tote") or t.lower().startswith("a canvas ") for t in T])
np.save(f"{F}/negative_train_merged_B.npy", X[~drop])
c = collections.Counter(t if not t.lower().startswith("a canvas ") else "a canvas <command>" for t, d in zip(T, drop) if d)
print("negatives A", len(X), "B", int((~drop).sum()), "dropped", dict(c))
