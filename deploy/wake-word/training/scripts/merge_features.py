#!/usr/bin/env python3
"""Concatenate feature .npy files and shuffle rows (fixed seed) so the sequential
mmap batch generator sees every source mixed. Usage: merge_features.py out.npy seed in1.npy in2.npy ..."""
import sys
import numpy as np
out, seed, *ins = sys.argv[1:]
arrs = [np.load(f) for f in ins]
for f, a in zip(ins, arrs):
    print(f.split("/")[-1], a.shape)
x = np.concatenate(arrs)
x = x[np.random.default_rng(int(seed)).permutation(len(x))]
np.save(out, x)
print("->", out, x.shape)
