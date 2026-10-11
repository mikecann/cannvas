#!/usr/bin/env python3
"""Recall at matched false-positive rates. For each model: validation hot windows/hour as a function of the
threshold, and the share of say / say_mic / held-out real clips (Pi clip method, x4 for real and say_mic,
x1 for say) whose max score passes the same threshold. Uses the calibrated models' max scores (a monotone
transform of the raw score), so no re-streaming is needed.
Usage: matched.py name ..."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fastscore import session, scores, windows
from summarize import F, fold_of
W = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
v = np.load(f"{W}/data/features/validation_set_features.npy")
win = windows(v)
hrs = len(win) * 0.08 / 3600
for n in sys.argv[1:]:
    r = json.load(open(f"{W}/eval/results/{n}.json"))
    vs = np.sort(scores(session(r["model"]), win))[::-1]
    fold = "none" if n == "old" else fold_of(n)
    tp = F["close_pos"] if n == "old" else F["folds"][fold]["test_pos"]
    real = np.array([r["real_clips"][c]["x4"] for c in tp])
    say = np.array(list(r["say"]["pos"].values())); saym = np.array(list(r["say_mic"]["pos"].values()))
    sayn = np.array(list(r["say"]["neg"].values())); saymn = np.array(list(r["say_mic"]["neg"].values()))
    row = []
    for fph in (0.28, 0.5, 1.0, 2.0):
        k = int(round(fph * hrs))
        th = vs[k] + 1e-9
        row.append(f"FP {fph}/h: real {int((real >= th).sum())}/{len(real)} say {int((say >= th).sum())}/66 saymic {int((saym >= th).sum())}/66 nm {int((sayn >= th).sum())}+{int((saymn >= th).sum())}")
    print(f"{n:8s} " + " | ".join(row), flush=True)
