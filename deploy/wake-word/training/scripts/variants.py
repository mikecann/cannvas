#!/usr/bin/env python3
"""One line per recipe: cross-validated real recall (sum over the 3 folds' held-out clips) and the means of
the other metrics over its fold models, at each model's own standard calibration (first-half rule)."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from summarize import F, FAR
W = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OFFS = ("off0", "off320", "off640", "off960")
L = lambda n: json.load(open(f"{W}/eval/results/{n}.json"))
def rep(r, c, s="session2"):
    return sum(r["replay"][f"{s}@x4@{o}"]["per_event_max"][c] >= 0.5 for o in OFFS)
print(f"{'recipe':10s} {'CV clip x1':>10s} {'x4':>5s} {'replay':>7s} | {'s1/20':>6s} {'far/15':>6s} | {'say pos':>7s} {'saymic':>7s} {'nearmiss':>8s} | {'label trig':>10s} | {'valFP 2nd':>9s}")
for v in sys.argv[1:]:
    names = [f"{v}_none"] if os.path.exists(f"{W}/eval/results/{v}_none.json") else [f"{v}_{f}" for f in ("f1", "f2", "f3")]
    if v == "old":
        names = ["old"]
    R = [L(n) for n in names]
    tps = [F["close_pos"]] if len(names) == 1 else [F["folds"][f]["test_pos"] for f in ("f1", "f2", "f3")]
    x1 = sum(sum(r["real_clips"][c]["x1"] >= 0.5 for c in tp) for r, tp in zip(R, tps))
    x4 = sum(sum(r["real_clips"][c]["x4"] >= 0.5 for c in tp) for r, tp in zip(R, tps))
    rp = sum(sum(rep(r, c) for c in tp) for r, tp in zip(R, tps)) / 4
    s1 = np.mean([np.mean([sum(x >= 0.5 for x in r["replay"][f"session1@x4@{o}"]["per_event_max"].values()) for o in OFFS]) for r in R])
    far = np.mean([sum(rep(r, c) for c in FAR) / 4 for r in R])
    say = np.mean([sum(x >= 0.5 for x in r["say"]["pos"].values()) for r in R])
    sm = np.mean([sum(x >= 0.5 for x in r["say_mic"]["pos"].values()) for r in R])
    nm = np.mean([sum(x >= 0.5 for x in r["say"]["neg"].values()) + sum(x >= 0.5 for x in r["say_mic"]["neg"].values()) for r in R])
    lab = sum(1 for r in R for s in ("session1", "session2") for o in OFFS for t in r["replay"][f"{s}@x4@{o}"]["triggers"] if t["kind"] != "wake")
    fp = np.mean([r["val_fp"]["fph_second_half@0.5"] for r in R])
    print(f"{v:10s} {x1:>7d}/10 {x4:>2d}/10 {rp:>5.2f}/10 | {s1:>6.2f} {far:>6.2f} | {say:>7.1f} {sm:>7.1f} {nm:>6.1f}/174 | {lab:>10d} | {fp:>9.2f}")
