#!/usr/bin/env python3
"""Operating point matched to the shipped model: the smallest raw threshold t at which the model has no more
hot windows on the whole validation set (10.7 h) than the shipped hey_canvas.onnx has at 0.5 (3), and never
more on either half than calibrate_onnx.py's first-half rule (--target-fph 0.4) would allow. Then shifts
last_layer.bias exactly like calibrate_onnx.py. Usage: calib_matched.py raw.onnx out.onnx [max_windows=3]"""
import math, os, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fastscore import session, scores, windows
W = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
raw, out = sys.argv[1:3]
k = int(sys.argv[3]) if len(sys.argv) > 3 else 3
v = np.load(f"{W}/data/features/validation_set_features.npy"); win = windows(v)
vs = scores(session(raw), win)
half = len(win) // 2
t_full = float(np.sort(vs)[::-1][k] + 1e-6)
t_split = float(np.sort(vs[:half])[::-1][int(math.floor(0.4 * half * 0.08 / 3600))] + 1e-6)
t = min(0.99999, max(t_full, t_split))
print(f"t_split(first half, 0.4/h)={t_split:.6f}  t_full(<= {k} windows on 10.7 h)={t_full:.6f}  -> t={t:.6f}; "
      f"hot windows first/second half {(vs[:half] >= t).sum()}/{(vs[half:] >= t).sum()}")
subprocess.run([sys.executable, "-I", f"{W}/scripts/calibrate_onnx.py", "--model", raw, "--out", out, "--t", f"{t:.6f}"], check=True)
