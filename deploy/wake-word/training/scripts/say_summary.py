#!/usr/bin/env python3
"""Summarise held-out `say` clip scores for several models (runtime-identical streaming).
Usage: say_summary.py <eval/say dir> model1.onnx [model2.onnx ...]"""
import glob, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_clips import load, score

d = sys.argv[1]
groups = {g: sorted(glob.glob(f"{d}/{g}/*.wav")) for g in ("pos", "neg", "odd")}
for m in sys.argv[2:]:
    r = {g: np.array([score(m, load(c))[0] for c in cs]) for g, cs in groups.items()}
    pos_names = [os.path.basename(c) for c in groups["pos"]]
    plain = np.array(["__hey_canvas.wav" in n for n in pos_names])
    neg_max = r["neg"].max(); neg_arg = os.path.basename(groups["neg"][int(r["neg"].argmax())])
    print(f"{m.split('/')[-2]:12s} pos>=0.5: {(r['pos']>=0.5).sum()}/{len(r['pos'])} "
          f"(plain 'Hey Canvas' {(r['pos'][plain]>=0.5).sum()}/{plain.sum()}, with command "
          f"{(r['pos'][~plain]>=0.5).sum()}/{(~plain).sum()}) median {np.median(r['pos']):.2f} | "
          f"neg>=0.5: {(r['neg']>=0.5).sum()}/{len(r['neg'])} max {neg_max:.3f} ({neg_arg}) | "
          f"odd>=0.5: {(r['odd']>=0.5).sum()}/{len(r['odd'])}", flush=True)
