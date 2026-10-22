#!/usr/bin/env python3
"""Tables for the report: old vs the cross-validated folds and the final model.
Usage: report.py <fold prefix e.g. FTLmatch> [variant prefixes for the experiment table ...]"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from summarize import F, DIST, FAR, fold_of  # noqa: E402

W = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OFFS = ("off0", "off320", "off640", "off960")
L = lambda n: json.load(open(f"{W}/eval/results/{n}.json"))


def rep(r, c, s="session2"):
    return sum(r["replay"][f"{s}@x4@{o}"]["per_event_max"][c] >= 0.5 for o in OFFS)


def cv_rows(prefix):
    old = L("old")
    rows = []
    for f in ("f1", "f2", "f3"):
        r = L(f"{prefix}_{f}")
        for c in F["folds"][f]["test_pos"]:
            rows.append((c, DIST[c], f, old["real_clips"][c]["x1"], old["real_clips"][c]["x4"], rep(old, c),
                         r["real_clips"][c]["x1"], r["real_clips"][c]["x4"], rep(r, c)))
    return sorted(rows)


def metrics(r, test_pos):
    m = {}
    if test_pos:
        m["real_clip_x1"] = f"{sum(r['real_clips'][c]['x1'] >= 0.5 for c in test_pos)}/{len(test_pos)}"
        m["real_clip_x4"] = f"{sum(r['real_clips'][c]['x4'] >= 0.5 for c in test_pos)}/{len(test_pos)}"
        m["real_replay"] = f"{sum(rep(r, c) for c in test_pos) / 4:.2f}/{len(test_pos)}"
    m["2m_clip_x4"] = f"{sum(r['real_clips'][c]['x4'] >= 0.5 for c in ('seg41b', 'seg42'))}/2"
    m["2m_replay"] = f"{sum(rep(r, c) for c in ('seg41b', 'seg42')) / 4:.2f}/2"
    m["far_replay"] = f"{sum(rep(r, c) for c in FAR) / 4:.2f}/15"
    m["s1_replay"] = f"{np.mean([sum(v >= 0.5 for v in r['replay'][f'session1@x4@{o}']['per_event_max'].values()) for o in OFFS]):.2f}/20"
    m["label_trig_x4"] = sum(1 for s in ("session1", "session2") for o in OFFS for t in r["replay"][f"{s}@x4@{o}"]["triggers"] if t["kind"] != "wake")
    m["label_trig_x1"] = sum(1 for s in ("session1", "session2") for t in r["replay"][f"{s}@x1@off0"]["triggers"] if t["kind"] != "wake")
    for part in ("say", "say_mic"):
        for g, d in r[part].items():
            m[f"{part}_{g}"] = f"{sum(v >= 0.5 for v in d.values())}/{len(d)}"
    if "noisy" in r:
        for st, d in sorted(r["noisy"].items()):
            if st.startswith("real"):
                keep = [k for k in d if k in test_pos] if test_pos else list(d)
                m[f"noisy_{st}"] = f"{sum(d[k] >= 0.5 for k in keep)}/{len(keep)}"
            else:
                m[f"noisy_{st}"] = f"{sum(v >= 0.5 for v in d.values())}/{len(d)}"
    v = r["val_fp"]
    m["valFP_1st/2nd/all"] = f"{v['fph_first_half@0.5']:.2f}/{v['fph_second_half@0.5']:.2f}/{v['fph_all@0.5']:.2f}"
    if "libri" in r:
        tot = {}
        for k, x in r["libri"].items():
            var = "room_mic" if "room_mic" in k else "room"
            t = tot.setdefault(var, [0.0, 0])
            t[0] += x["hours"]; t[1] += len(x["triggers"])
        for k, (h, n) in tot.items():
            m[f"libri_{k}"] = f"{n} in {h:.1f} h ({n / h:.2f}/h)"
    m["synth_micsim_recall"] = r["synth"]["micsim_pos_recall@0.5"]
    return m


def main():
    prefix = sys.argv[1]
    print("## Held-out close-range tries, cross-validated (each clip scored by the fold model that never saw it)")
    print("clip  dist  fold | old x1  old x4  old replay | new x1  new x4  new replay")
    for row in cv_rows(prefix):
        c, d, f, a, b, cc, x, y, z = row
        print(f"{c} {d:5s} {f}  | {a:5.2f}  {b:5.2f}   {cc}/4      | {x:5.2f}  {y:5.2f}   {z}/4")
    print()
    old = L("old")
    cols = {"old (all 10 held out)": metrics(old, F["close_pos"])}
    for f in ("f1", "f2", "f3"):
        cols[f"{prefix}_{f}"] = metrics(L(f"{prefix}_{f}"), F["folds"][f]["test_pos"])
    cols[f"{prefix}_all (final)"] = metrics(L(f"{prefix}_all"), [])
    keys = list(dict.fromkeys(k for c in cols.values() for k in c))
    print("metric".ljust(26) + "".join(n[:22].rjust(24) for n in cols))
    for k in keys:
        print(k.ljust(26) + "".join(str(c.get(k, "-")).rjust(24) for c in cols.values()))
    print()
    fin = L(f"{prefix}_all")
    for s in ("session1", "session2"):
        for g in ("x4@off0", "x1@off0"):
            t = fin["replay"][f"{s}@{g}"]["triggers"]
            o = old["replay"][f"{s}@{g}"]["triggers"]
            print(f"{s}@{g}: final {len(t)} triggers: " + "; ".join(f"{x['t']:.1f}s {x['score']:.2f} {x['event']}" for x in t))
            print(f"{s}@{g}: old   {len(o)} triggers: " + "; ".join(f"{x['t']:.1f}s {x['score']:.2f} {x['event']}" for x in o))
    for n in ("old", f"{prefix}_all"):
        r = L(n)
        if "libri" in r:
            print(n, "libri triggers:", [(k, x["triggers"]) for k, x in r["libri"].items() if x["triggers"]])


if __name__ == "__main__":
    main()
