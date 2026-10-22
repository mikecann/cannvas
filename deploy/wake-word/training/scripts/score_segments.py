#!/usr/bin/env python3
"""Score WAV clips Pi-style at several gains for several models. Usage:
score_segments.py --models a.onnx b.onnx --gains 1 4 --json out.json clip.wav ..."""
import argparse, json, os, sys
from concurrent.futures import ProcessPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pi_eval import load, clip_score

def job(args):
    m, c, g = args
    s, at = clip_score(m, load(c), g)
    return m, c, g, s, at

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="+", required=True)
    ap.add_argument("--gains", nargs="+", type=float, default=[1, 4])
    ap.add_argument("--json")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("clips", nargs="+")
    a = ap.parse_args()
    jobs = [(m, c, g) for m in a.models for c in a.clips for g in a.gains]
    res = {}
    with ProcessPoolExecutor(a.workers) as ex:
        for m, c, g, s, at in ex.map(job, jobs, chunksize=4):
            res.setdefault(m, {}).setdefault(os.path.basename(c), {})[f"x{g:g}"] = round(s, 4)
    for m in a.models:
        print("==", m)
        for c in a.clips:
            b = os.path.basename(c)
            print(f"  {b:50s} " + "  ".join(f"x{g:g} {res[m][b][f'x{g:g}']:.3f}" for g in a.gains))
    if a.json:
        json.dump(res, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
