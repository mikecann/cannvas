#!/usr/bin/env python3
"""What different operating-point rules do to each model (scores are monotone in the threshold, so the stored
max scores can be re-thresholded). Rules: thresholds in the calibrated model's score space.
  split0.4 : as shipped (first half, <=2 hot windows), i.e. 0.5
  split0.2 : first half, <=1 hot window
  full<=old: whole validation set, no more hot windows than the shipped model (3)
Usage: calib_rules.py name ..."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fastscore import session, scores, windows
from summarize import F, fold_of, FAR
W = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OFFS = ("off0", "off320", "off640", "off960")
v = np.load(f"{W}/data/features/validation_set_features.npy"); win = windows(v)
half = len(win) // 2
for n in sys.argv[1:]:
    r = json.load(open(f"{W}/eval/results/{n}.json"))
    vs = scores(session(r["model"]), win)
    a, b = np.sort(vs[:half])[::-1], np.sort(vs)[::-1]
    rules = {"split0.4": 0.5, "split0.2": a[1] + 1e-6, "full<=old": b[3] + 1e-6}
    fold = "none" if n == "old" else fold_of(n)
    tp = F["close_pos"] if fold in ("none",) else F["folds"][fold]["test_pos"]
    for rule, th in rules.items():
        clip = sum(r["real_clips"][c]["x4"] >= th for c in tp)
        rep = sum(sum(r["replay"][f"session2@x4@{o}"]["per_event_max"][c] >= th for o in OFFS) for c in tp) / 4
        s1 = np.mean([sum(x >= th for x in r["replay"][f"session1@x4@{o}"]["per_event_max"].values()) for o in OFFS])
        say = sum(x >= th for x in r["say"]["pos"].values()); saym = sum(x >= th for x in r["say_mic"]["pos"].values())
        nm = sum(x >= th for x in r["say"]["neg"].values()) + sum(x >= th for x in r["say_mic"]["neg"].values())
        print(f"{n:9s} {rule:9s} th {th:.3f} | val windows 1st/2nd {(vs[:half] >= th).sum()}/{(vs[half:] >= th).sum()} | real clip x4 {clip}/{len(tp)} replay {rep:.2f}/{len(tp)} | s1 {s1:.2f}/20 | say {say}/66 saymic {saym}/66 | near-miss fired {nm}/174")
