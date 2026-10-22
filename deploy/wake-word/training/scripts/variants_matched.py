#!/usr/bin/env python3
"""Recipes compared at the same operating point: each fold model re-thresholded so the whole validation set
has no more hot windows than the shipped model (3 in 10.7 h). Sums over the 3 folds' held-out real clips,
means over fold models for the rest. Usage: variants_matched.py recipe ..."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fastscore import session, scores, windows
from summarize import F, FAR
W = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OFFS = ("off0", "off320", "off640", "off960")
v = np.load(f"{W}/data/features/validation_set_features.npy"); win = windows(v)
cache = {}
def th_for(r):
    if r["model"] not in cache:
        cache[r["model"]] = float(np.sort(scores(session(r["model"]), win))[::-1][3] + 1e-6)
    return max(cache[r["model"]], 0.5) if "old.onnx" in r["model"] else cache[r["model"]]
print(f"{'recipe':9s} {'clip x4':>7s} {'replay':>7s} {'s1':>5s} | {'say':>5s} {'saymic':>6s} | {'say10':>5s} {'say5':>4s} {'mic10':>5s} {'mic5':>4s} {'real10':>6s} {'real5':>5s} | {'nm':>5s} {'nm noisy':>8s} | {'labels':>6s}")
for rec in sys.argv[1:]:
    names = ["old"] if rec == "old" else ([f"{rec}_none"] if os.path.exists(f"{W}/eval/results/{rec}_none.json") else [f"{rec}_{f}" for f in ("f1", "f2", "f3")])
    R = [json.load(open(f"{W}/eval/results/{n}.json")) for n in names]
    tps = [F["close_pos"]] if len(names) == 1 else [F["folds"][f]["test_pos"] for f in ("f1", "f2", "f3")]
    agg = dict(clip=0, rep=0, s1=[], say=[], sm=[], n10=[], n5=[], m10=[], m5=[], r10=0, r5=0, nm=[], nmn=[], lab=0)
    for r, tp in zip(R, tps):
        t = th_for(r)
        agg["clip"] += sum(r["real_clips"][c]["x4"] >= t for c in tp)
        agg["rep"] += sum(r["replay"][f"session2@x4@{o}"]["per_event_max"][c] >= t for c in tp for o in OFFS) / 4
        agg["s1"].append(np.mean([sum(x >= t for x in r["replay"][f"session1@x4@{o}"]["per_event_max"].values()) for o in OFFS]))
        agg["say"].append(sum(x >= t for x in r["say"]["pos"].values())); agg["sm"].append(sum(x >= t for x in r["say_mic"]["pos"].values()))
        nz = r.get("noisy", {})
        if nz:
            agg["n10"].append(sum(x >= t for x in nz["say_pos_10"].values())); agg["n5"].append(sum(x >= t for x in nz["say_pos_5"].values()))
            agg["m10"].append(sum(x >= t for x in nz["saymic_pos_10"].values())); agg["m5"].append(sum(x >= t for x in nz["saymic_pos_5"].values()))
            agg["r10"] += sum(nz["real_10"][c] >= t for c in tp); agg["r5"] += sum(nz["real_5"][c] >= t for c in tp)
            agg["nmn"].append(sum(x >= t for k in ("say_neg_10", "say_neg_5", "saymic_neg_10", "saymic_neg_5") for x in nz[k].values()))
        agg["nm"].append(sum(x >= t for x in r["say"]["neg"].values()) + sum(x >= t for x in r["say_mic"]["neg"].values()))
        agg["lab"] += sum(1 for s in ("session1", "session2") for o in OFFS for x in r["replay"][f"{s}@x4@{o}"]["triggers"] if x["kind"] != "wake" and x["score"] >= t)
    m = lambda k: f"{np.mean(agg[k]):.1f}" if agg[k] else "-"
    print(f"{rec:9s} {agg['clip']:>4d}/10 {agg['rep']:>4.2f}/10 {m('s1'):>5s} | {m('say'):>5s} {m('sm'):>6s} | {m('n10'):>5s} {m('n5'):>4s} {m('m10'):>5s} {m('m5'):>4s} {agg['r10']:>3d}/10 {agg['r5']:>2d}/10 | {m('nm'):>5s} {m('nmn'):>8s} | {agg['lab']:>6d}")
