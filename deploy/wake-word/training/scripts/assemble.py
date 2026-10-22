#!/usr/bin/env python3
"""Build the per-fold real-voice feature files: positive_real (train close-range tries) and
negative_owner (train labels + room-only windows), shuffled.
Usage: assemble.py <fold> <out_dir>   (fold from real/folds.json; "none" = no real data)"""
import json, os, sys
import numpy as np
W = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fold, out = sys.argv[1], sys.argv[2]
cfg = json.load(open(f"{W}/real/folds.json"))
f = cfg["folds"][fold]
pos = [p for p in cfg["close_pos"] if p not in f["test_pos"]]
labels = [l for l in cfg["labels"] if l not in f["test_labels"]]
os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(42)
P = [np.load(f"{W}/real/feats/{p}.npy") for p in pos]
N = [np.load(f"{W}/real/feats/{l}.npy") for l in labels] + [np.load(f"{W}/real/feats/room{k}.npy") for k in range(6)]
if P:
    x = np.concatenate(P); np.save(f"{out}/positive_real.npy", x[rng.permutation(len(x))])
x = np.concatenate(N); np.save(f"{out}/negative_owner.npy", x[rng.permutation(len(x))])
json.dump({"fold": fold, "train_pos": pos, "train_labels": labels}, open(f"{out}/real_split.json", "w"), indent=1)
print(fold, "train pos", pos, "->", sum(len(p) for p in P), "windows; train labels", len(labels), "+ room ->", len(x))
