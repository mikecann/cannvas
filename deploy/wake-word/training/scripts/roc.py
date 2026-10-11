#!/usr/bin/env python3
"""Recall on augmented positive test windows at the threshold that gives a target
false-positive rate on validation_set_features (FP counted as hot windows / hour,
like train.py, using the true 10.7 h duration). For comparing models fairly.
Usage: roc.py <validation_set_features.npy> <positive_features_test.npy> model1.onnx ...
"""
import sys
import numpy as np
import onnxruntime as ort

v = np.load(sys.argv[1]); pos = np.load(sys.argv[2])
hours = v.shape[0] * 0.08 / 3600
for m in sys.argv[3:]:
    s = ort.InferenceSession(m, providers=["CPUExecutionProvider"])
    name = s.get_inputs()[0].name
    n = s.get_inputs()[0].shape[1]
    win = np.lib.stride_tricks.sliding_window_view(v, (n, v.shape[1]))[:, 0]
    f = lambda x: np.array([s.run(None, {name: x[i:i+1].astype(np.float32)})[0].ravel()[0] for i in range(len(x))])
    vs, ps = f(win), f(pos)
    vs_sorted = np.sort(vs)[::-1]
    out = []
    for fph in (0.2, 0.5, 1.0, 2.0):
        k = int(np.floor(fph * hours))  # allowed hot windows
        th = max(vs_sorted[k] + 1e-6, 1e-6) if k < len(vs_sorted) else 0
        out.append(f"FP<={fph}/h: th={th:.3f} recall={(ps >= th).mean():.3f}")
    out.append(f"@0.5: recall={(ps>=0.5).mean():.3f} fp/h={(vs>=0.5).sum()/hours:.2f}")
    print(m.split('/')[-2], " | ".join(out), flush=True)
