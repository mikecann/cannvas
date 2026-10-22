#!/usr/bin/env python3
"""Move the model's operating point so the Pi's fixed 0.5 trigger means "raw score >= t".

The openWakeWord DNN ends in Gemm(last_layer) -> Sigmoid, so subtracting logit(t)
from last_layer.bias maps raw score t to exactly 0.5 and keeps the ranking of every
window unchanged (same as raising the runtime threshold to t, without touching the Pi).

Usage:
  calibrate_onnx.py --model in.onnx --out out.onnx --t 0.99
  calibrate_onnx.py --model in.onnx --out out.onnx --fp-data validation_set_features.npy --target-fph 0.3
With --fp-data, t is chosen on the FIRST half of the validation features only (smallest t with
hot windows/hour <= target there), and the rate on the untouched SECOND half is reported.
"""
import argparse
import math

import numpy as np
import onnx
import onnxruntime as ort
from onnx import numpy_helper


def scores(model_bytes, x):
    s = ort.InferenceSession(model_bytes, providers=["CPUExecutionProvider"])
    n = s.get_inputs()[0].name
    return np.array([s.run(None, {n: x[i:i + 1].astype(np.float32)})[0].ravel()[0] for i in range(len(x))])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--t", type=float)
    ap.add_argument("--fp-data")
    ap.add_argument("--target-fph", type=float, default=0.3)
    a = ap.parse_args()
    m = onnx.load(a.model)
    win_len = m.graph.input[0].type.tensor_type.shape.dim[1].dim_value

    t = a.t
    if a.fp_data:
        v = np.load(a.fp_data)
        win = np.lib.stride_tricks.sliding_window_view(v, (win_len, v.shape[1]))[:, 0]
        half = len(win) // 2
        sel, hold = win[:half], win[half:]
        hrs_sel, hrs_hold = len(sel) * 0.08 / 3600, len(hold) * 0.08 / 3600
        ss = np.sort(scores(m.SerializeToString(), sel))[::-1]
        k = int(math.floor(a.target_fph * hrs_sel))
        t = float(min(0.99999, ss[k] + 1e-6))
        sh = scores(m.SerializeToString(), hold)
        print(f"chosen t={t:.6f} on first half ({hrs_sel:.2f} h, {k} hot windows allowed); "
              f"second half ({hrs_hold:.2f} h): {(sh >= t).sum()} hot windows = {(sh >= t).sum() / hrs_hold:.3f}/h")

    shift = math.log(t / (1 - t))
    for init in m.graph.initializer:
        if init.name == "last_layer.bias":
            b = numpy_helper.to_array(init).copy()
            b -= shift
            init.CopyFrom(numpy_helper.from_array(b.astype(np.float32), init.name))
            break
    else:
        raise SystemExit("last_layer.bias not found")
    onnx.checker.check_model(m)
    onnx.save(m, a.out)
    print(f"wrote {a.out}: last_layer.bias shifted by -logit({t:.6f}) = {-shift:.4f}")


if __name__ == "__main__":
    main()
