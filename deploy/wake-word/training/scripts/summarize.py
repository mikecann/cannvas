#!/usr/bin/env python3
"""Summarise eval/results/*.json. Usage: summarize.py name[:fold] ...  (fold defaults from the name suffix)"""
import json
import os
import sys

import numpy as np

W = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
F = json.load(open(f"{W}/real/folds.json"))
DIST = {"seg02": "0.5f", "seg03": "0.5f", "seg05": "0.5a", "seg06": "0.5a", "seg09": "1m", "seg10": "1m",
        "seg12": "1a", "seg13": "1a", "seg38": "<=1", "seg39": "<=1"}
FAR = ["seg15", "seg16", "seg18", "u96", "seg20", "seg21", "seg23", "u112", "seg24", "seg25", "seg27", "seg28",
       "seg31", "seg32", "u149"]
OFFS = ("off0", "off320", "off640", "off960")


def fold_of(name):
    for f in ("f1", "f2", "f3", "all", "none"):
        if name.endswith("_" + f):
            return f
    return "none"


def summary(name, fold):
    r = json.load(open(f"{W}/eval/results/{name}.json"))
    fd = F["folds"][fold]
    test_pos = fd["test_pos"]
    out = {"name": name, "fold": fold}
    rc = r.get("real_clips", {})
    rp = r.get("replay", {})
    out["clip_x1"] = {c: rc[c]["x1"] for c in test_pos} if rc else {}
    out["clip_x4"] = {c: rc[c]["x4"] for c in test_pos} if rc else {}
    if rp:
        ev = {c: [rp[f"session2@x4@{o}"]["per_event_max"][c] for o in OFFS] for c in test_pos + ["seg41b", "seg42"] + FAR}
        out["replay_x4_alignments_fired"] = {c: int(sum(v >= 0.5 for v in ev[c])) for c in ev}
        s1 = [rp[f"session1@x4@{o}"]["per_event_max"] for o in OFFS]
        out["session1_fired_mean"] = float(np.mean([sum(v >= 0.5 for v in d.values()) for d in s1]))
        out["session1_n"] = len(s1[0])
        trig = {k: v["triggers"] for k, v in rp.items()}
        out["triggers_label_or_other"] = {k: [(t["t"], t["score"], t["event"]) for t in v if t["kind"] != "wake"] for k, v in trig.items()}
        out["n_label_triggers_x4"] = int(sum(len(out["triggers_label_or_other"][f"{s}@x4@{o}"]) for s in ("session1", "session2") for o in OFFS))
        out["n_label_triggers_x1"] = int(sum(len(out["triggers_label_or_other"][f"{s}@x1@off0"]) for s in ("session1", "session2")))
        out["wake_triggers_s2_x4_off0"] = [t["event"].split(" ")[0] for t in trig["session2@x4@off0"] if t["kind"] == "wake"]
    if "say" in r:
        out["say"] = {g: f"{sum(v >= 0.5 for v in d.values())}/{len(d)}" for g, d in r["say"].items()}
        out["say_neg_fired"] = sorted(k.split("__")[0] + ":" + k.split("__")[-1] for k, v in r["say"]["neg"].items() if v >= 0.5)
    if "say_mic" in r:
        out["say_mic"] = {g: f"{sum(v >= 0.5 for v in d.values())}/{len(d)}" for g, d in r["say_mic"].items()}
        out["say_mic_neg_fired"] = sorted(k.split("__")[0] + ":" + k.split("__")[-1] for k, v in r["say_mic"]["neg"].items() if v >= 0.5)
    if "val_fp" in r:
        out["val_fp"] = r["val_fp"]
    if "synth" in r:
        out["synth"] = r["synth"]
    if "libri" in r:
        tot = {}
        for k, v in r["libri"].items():
            var = "room_mic" if "room_mic" in k else "room"
            t = tot.setdefault(var, [0.0, 0])
            t[0] += v["hours"]; t[1] += len(v["triggers"])
        out["libri"] = {k: f"{v[1]} triggers in {v[0]:.2f} h = {v[1] / v[0]:.3f}/h" for k, v in tot.items()}
    return out


def main():
    for arg in sys.argv[1:]:
        name, _, fold = arg.partition(":")
        fold = fold or fold_of(name)
        s = summary(name, fold)
        print(json.dumps(s, indent=None, default=str)[:6000])
        print()


if __name__ == "__main__":
    main()
