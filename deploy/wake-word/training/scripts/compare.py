#!/usr/bin/env python3
"""Compact comparison across models. Usage: compare.py model_name ... (old is always included)."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from summarize import summary, fold_of, F, DIST, FAR
names = sys.argv[1:]
R = {n: json.load(open(f"{os.path.dirname(os.path.dirname(os.path.abspath(__file__)))}/eval/results/{n}.json")) for n in ["old"] + names}
OFFS = ("off0", "off320", "off640", "off960")

def ev(r, c, s="session2"):
    return [r["replay"][f"{s}@x4@{o}"]["per_event_max"][c] for o in OFFS]

print("Held-out close-range tries (per model, its own fold's test clips): clip x1 / clip x4 / replay x4 alignments fired of 4")
for n in names:
    fold = fold_of(n)
    tp = F["folds"][fold]["test_pos"]
    for c in tp:
        o, m = R["old"], R[n]
        print(f"  {n:8s} {c} ({DIST[c]:4s}) old {o['real_clips'][c]['x1']:.2f}/{o['real_clips'][c]['x4']:.2f}/{sum(v>=0.5 for v in ev(o,c))}"
              f"   new {m['real_clips'][c]['x1']:.2f}/{m['real_clips'][c]['x4']:.2f}/{sum(v>=0.5 for v in ev(m,c))}")
print()
hdr = f"{'model':8s} {'heldout clip>=.5 x1':>18s} {'x4':>6s} {'replay':>8s} | {'2m rep':>6s} {'far rep':>7s} {'s1 rep':>7s} | {'label trig x4(4 al)':>19s} {'x1':>3s} | {'say pos':>7s} {'neg':>5s} {'odd':>4s} | {'saymic pos':>10s} {'neg':>5s} | {'valFP/h 2nd':>11s} {'all':>5s} | {'synth rec':>9s}"
print(hdr)
for n in ["old"] + names:
    r = R[n]
    fold = "none" if n == "old" else fold_of(n)
    tp = F["folds"][fold]["test_pos"]
    if n == "old":
        tp = F["close_pos"]
    x1 = sum(r["real_clips"][c]["x1"] >= 0.5 for c in tp); x4 = sum(r["real_clips"][c]["x4"] >= 0.5 for c in tp)
    rep = sum(sum(v >= 0.5 for v in ev(r, c)) for c in tp) / 4
    two = sum(sum(v >= 0.5 for v in ev(r, c)) for c in ("seg41b", "seg42")) / 4
    far = sum(sum(v >= 0.5 for v in ev(r, c)) for c in FAR) / 4
    s1 = np.mean([sum(v >= 0.5 for v in r["replay"][f"session1@x4@{o}"]["per_event_max"].values()) for o in OFFS])
    lab4 = sum(1 for s in ("session1", "session2") for o in OFFS for t in r["replay"][f"{s}@x4@{o}"]["triggers"] if t["kind"] != "wake")
    lab1 = sum(1 for s in ("session1", "session2") for t in r["replay"][f"{s}@x1@off0"]["triggers"] if t["kind"] != "wake")
    say = {g: sum(v >= 0.5 for v in d.values()) for g, d in r["say"].items()}
    sm = {g: sum(v >= 0.5 for v in d.values()) for g, d in r["say_mic"].items()}
    print(f"{n:8s} {x1:>13d}/{len(tp):<4d} {x4:>2d}/{len(tp):<3d} {rep:>5.2f}/{len(tp):<2d} | {two:>4.2f}/2 {far:>5.2f}/15 {s1:>5.2f}/20 | {lab4:>19d} {lab1:>3d} | {say['pos']:>4d}/66 {say['neg']:>2d}/87 {say['odd']:>2d}/9 | {sm['pos']:>7d}/66 {sm['neg']:>2d}/87 | {r['val_fp']['fph_second_half@0.5']:>11.3f} {r['val_fp']['fph_all@0.5']:>5.2f} | {r['synth']['micsim_pos_recall@0.5']:>9.3f}")
print()
for n in ["old"] + names:
    r = R[n]
    labs = [(s, o, t["t"], t["score"], t["event"]) for s in ("session1", "session2") for o in OFFS + ("x1",) for t in r["replay"].get(f"{s}@x4@{o}" if o != "x1" else f"{s}@x1@off0", {"triggers": []})["triggers"] if t["kind"] != "wake"]
    negs = sorted(k.split("__")[0] + ":" + k.split("__")[-1] for k, v in r["say"]["neg"].items() if v >= 0.5)
    negm = sorted(k.split("__")[0] + ":" + k.split("__")[-1] for k, v in r["say_mic"]["neg"].items() if v >= 0.5)
    print(f"{n}: label/other triggers {labs}\n    say neg fired {negs}\n    say_mic neg fired {negm}")
