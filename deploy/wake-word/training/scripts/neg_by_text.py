#!/usr/bin/env python3
"""Per-phrase score of a model on a run's negative test windows (TTS + augmentation).
Rows of negative_features_test.npy follow sorted(glob(negative_test/*.wav)) (feats_for_clips.py).
Usage: neg_by_text.py <run hey_canvas dir> model.onnx [threshold]"""
import collections, glob, os, sys
import numpy as np, onnxruntime as ort
D, M = sys.argv[1], sys.argv[2]
th = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
x = np.load(f"{D}/negative_features_test.npy")
clips = sorted(glob.glob(f"{D}/negative_test/*.wav"))
man = dict(l.rstrip("\n").split("\t")[:2] for l in open(f"{D}/negative_test.manifest.tsv"))
texts = [man[os.path.basename(c)] for c in clips]
s = ort.InferenceSession(M, providers=["CPUExecutionProvider"]); n = s.get_inputs()[0].name
p = np.array([s.run(None, {n: x[i:i+1].astype(np.float32)})[0].ravel()[0] for i in range(len(x))])
by = collections.defaultdict(list)
for t, v in zip(texts, p):
    by[t].append(v)
rows = sorted(((np.mean(np.array(v) >= th), len(v), t) for t, v in by.items()), reverse=True)
print(f"overall >= {th}: {(p >= th).mean():.4f} of {len(p)}")
for r, k, t in rows[:25]:
    if r > 0:
        print(f"  {r:5.2f} of {k:3d}  {t}")
