#!/usr/bin/env python3
"""Continuous replay of session1/session2 through models, Pi-style (see pi_eval.replay).
Usage: replay_sessions.py <real-voice dir> <json out> --gains 4 1 model1.onnx ..."""
import argparse, json, os, sys
from concurrent.futures import ProcessPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pi_eval import load, replay

HERE = os.path.dirname(os.path.abspath(__file__))


def events(rv):
    sys.path.insert(0, os.path.join(HERE, "..", "real"))
    from events import S2
    s1 = json.load(open(os.path.join(HERE, "..", "real", "session1_events.json")))
    S1 = [(a, b, "wake", f"s1 attempt {i + 1:02d} ({a:.1f} s, distance unknown)") for i, (a, b, _) in enumerate(s1)]
    return {"session1": S1, "session2": S2}


def match(t, evs):
    # A trigger belongs to the event it fires during or within 1.2 s after.
    best = None
    for a, b, kind, label in evs:
        if a - 0.1 <= t <= b + 1.2:
            if best is None or abs(t - b) < abs(t - best[1]):
                best = (a, b, kind, label)
    return best


def job(args):
    m, path, g = args
    trig, scores = replay(m, load(path), gain=g)
    return m, os.path.basename(path).replace(".wav", ""), g, trig, scores.tolist()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rv")
    ap.add_argument("out")
    ap.add_argument("--gains", nargs="+", type=float, default=[4])
    ap.add_argument("models", nargs="+")
    a = ap.parse_args()
    ev = events(a.rv)
    jobs = [(m, f"{a.rv}/{s}.wav", g) for m in a.models for s in ("session1", "session2") for g in a.gains]
    res = {}
    with ProcessPoolExecutor(min(len(jobs), 8)) as ex:
        for m, s, g, trig, scores in ex.map(job, jobs):
            evs = ev[s]
            rows = []
            for t, sc in trig:
                e = match(t, evs)
                rows.append({"t": t, "score": sc, "kind": e[2] if e else "other", "event": e[3] if e else "no event (background / unlabelled)"})
            # best score per event (for near-miss inspection)
            per_event = []
            for a0, b0, kind, label in evs:
                i0, i1 = int((a0 + 1.0) / 0.08), int((b0 + 1.0 + 1.2) / 0.08) + 1
                per_event.append({"event": label, "kind": kind, "max_score": round(max(scores[i0:i1]), 4)})
            res.setdefault(m, {})[f"{s}@x{g:g}"] = {"triggers": rows, "per_event": per_event}
    for m in a.models:
        print("==", m)
        for k, v in sorted(res[m].items()):
            fired = [r for r in v["triggers"]]
            nw = sum(r["kind"] == "wake" for r in fired); nf = len(fired) - nw
            print(f"  {k}: {len(fired)} triggers ({nw} on wake attempts, {nf} on labels/other)")
            for r in fired:
                print(f"     {r['t']:7.2f}s  {r['score']:.3f}  [{r['kind']}] {r['event']}")
    json.dump(res, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
