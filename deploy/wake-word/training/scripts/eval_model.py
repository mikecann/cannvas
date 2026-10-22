#!/usr/bin/env python3
"""Re-check the exported ONNX model on the training script's validation data.

* recall: fraction of positive_features_test windows scoring >= threshold
  (the same windows train.py uses for "val_recall");
* adversarial FP rate: fraction of negative_features_test windows >= threshold;
* false positives per hour on validation_set_features.npy (~10.7 h of speech,
  noise and music), sliding a 16-frame window one 80 ms step at a time like the
  runtime. Reported two ways:
    - raw windows >= threshold / hours (train.py's metric; it divides by 11.3 h);
    - activations: runs of consecutive hot windows merged, plus a 2 s refractory
      gap, which is what a user would experience as separate false wakes.
"""
import argparse
import json

import numpy as np
import onnxruntime as ort


def run(sess, x):
    name = sess.get_inputs()[0].name
    out = np.empty(len(x), np.float32)
    for i in range(len(x)):
        out[i] = sess.run(None, {name: x[i:i + 1].astype(np.float32)})[0].ravel()[0]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--feature-dir", required=True, help="dir with positive/negative_features_test.npy")
    ap.add_argument("--fp-data", required=True, help="validation_set_features.npy")
    ap.add_argument("--json")
    a = ap.parse_args()

    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    sess = ort.InferenceSession(a.model, so, providers=["CPUExecutionProvider"])
    n = sess.get_inputs()[0].shape[1]

    pos = np.load(f"{a.feature_dir}/positive_features_test.npy")
    neg = np.load(f"{a.feature_dir}/negative_features_test.npy")
    ps, ns = run(sess, pos), run(sess, neg)

    v = np.load(a.fp_data)
    hours = v.shape[0] * 0.08 / 3600
    win = np.lib.stride_tricks.sliding_window_view(v, (n, v.shape[1]))[:, 0]
    vs = run(sess, win)

    res = {"model": a.model, "val_hours": round(hours, 2)}
    for th in (0.3, 0.5, 0.7, 0.9):
        hot = vs >= th
        idx = np.flatnonzero(hot)
        acts = 0
        last = -10 ** 9
        for i in idx:
            if i - last > 25:  # > 2 s since the previous hot window
                acts += 1
            last = i
        res[f"th{th}"] = {
            "recall": round(float((ps >= th).mean()), 4),
            "adversarial_fp_rate": round(float((ns >= th).mean()), 4),
            "fp_windows": int(hot.sum()),
            "fp_windows_per_hr_trainpy_11.3h": round(hot.sum() / 11.3, 3),
            "fp_windows_per_hr": round(hot.sum() / hours, 3),
            "fp_activations": acts,
            "fp_activations_per_hr": round(acts / hours, 3),
        }
    print(json.dumps(res, indent=1))
    if a.json:
        json.dump(res, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
