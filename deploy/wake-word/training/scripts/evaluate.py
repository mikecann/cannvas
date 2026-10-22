#!/usr/bin/env python3
"""Evaluate one wake word model the way the Pi runs it. Writes eval/results/<name>.json.

  real_clips : Pi clip method (1 s digital silence each side, 1280-sample frames, max) at x1 and x4 on every
               session2 wake try and label (VAD segments as recorded; seg41b cut from session2).
  replay     : continuous replay of session1 and session2 (pi_eval.replay: 1 s lead-in, threshold 0.5,
               reset + 1 s deaf after a trigger) at x4 with 4 frame alignments (0/20/40/60 ms extra
               lead-in) and at x1 with alignment 0; triggers matched to the event table, and per-event max.
  say        : macOS `say` held-out clips (pos / neg / odd), Pi clip method at x1.
  say_mic    : the same clips through the simulated mic + room background (make_say_mic.py), at x4.
  val_fp     : hot windows/hour on validation_set_features (first half, second half, all).
  noisy      : make_noisy.py sets (say x1, say_mic and real x4) with TV-like speech/music at 10 and 5 dB SNR.
  libri      : LibriSpeech FP streams (eval/fp_streams), replayed at x4: triggers and triggers/hour.
  synth      : recall on mic-sim positive_test features, FP rate on mic-sim negative_test features.
Usage: evaluate.py --model m.onnx --name tag [--parts real_clips,replay,say,val_fp,libri,synth] [--workers 12]
"""
import argparse
import glob
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.dirname(HERE)
RV = os.environ.get("REAL_VOICE", os.path.join(os.path.dirname(W), "real-voice"))
sys.path.insert(0, HERE)
from pi_eval import FRAME, SR, clip_score, load, new_model, boost  # noqa: E402


def replay_offset(model_path, audio, gain, offset, threshold=0.5, deaf_s=1.0):
    np.random.seed(0)
    model, key = new_model(model_path)
    lead = SR + offset
    a = np.concatenate([np.zeros(lead, np.int16), boost(audio, gain)])
    n = (len(a) // FRAME) * FRAME
    scores = np.zeros(n // FRAME, np.float32)
    times = np.zeros(n // FRAME, np.float32)
    trig = []
    deaf_until = -1.0
    for k, i in enumerate(range(0, n, FRAME)):
        s = float(model.predict(a[i:i + FRAME])[key])
        t = (i + FRAME - lead) / SR
        scores[k], times[k] = s, t
        if s >= threshold and t >= deaf_until:
            trig.append((round(t, 2), round(s, 4)))
            model.reset()
            deaf_until = t + deaf_s
    return trig, scores, times


def j_clip(args):
    m, path, g = args
    s, at = clip_score(m, load(path), g)
    return path, g, s


def j_replay(args):
    m, path, g, off = args
    trig, scores, times = replay_offset(m, load(path), g, off)
    return path, g, off, trig, scores, times


def events():
    sys.path.insert(0, os.path.join(W, "real"))
    from events import S2
    s1 = json.load(open(os.path.join(W, "real", "session1_events.json")))
    S1 = [(a, b, "wake", f"s1_{i + 1:02d} ({a:.1f} s)") for i, (a, b, _) in enumerate(s1)]
    return {"session1": S1, "session2": S2}


def match(t, evs):
    best = None
    for a, b, kind, label in evs:
        if a - 0.1 <= t <= b + 1.2 and (best is None or abs(t - b) < abs(t - best[1])):
            best = (a, b, kind, label)
    return best


def seg41b_clip():
    p = os.path.join(W, "real", "clips", "seg41b.wav")
    if not os.path.exists(p):
        import wave
        os.makedirs(os.path.dirname(p), exist_ok=True)
        x = load(f"{RV}/session2.wav")[int(167.55 * SR):int(168.85 * SR)]
        with wave.open(p, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(x.tobytes())
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--parts", default="real_clips,replay,say,say_mic,val_fp,libri,synth")
    ap.add_argument("--workers", type=int, default=12)
    a = ap.parse_args()
    parts = a.parts.split(",")
    out_path = f"{W}/eval/results/{a.name}.json"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    res = json.load(open(out_path)) if os.path.exists(out_path) else {}
    res["model"] = os.path.abspath(a.model)
    m = res["model"]
    ex = ProcessPoolExecutor(a.workers)

    if "real_clips" in parts:
        clips = sorted(glob.glob(f"{RV}/session2-segments/seg*.wav")) + [seg41b_clip()]
        out = {}
        for path, g, s in ex.map(j_clip, [(m, c, g) for c in clips for g in (1, 4)], chunksize=2):
            out.setdefault(os.path.basename(path)[:-4], {})[f"x{g}"] = round(s, 4)
        res["real_clips"] = out
        print("real_clips done", flush=True)

    if "replay" in parts:
        ev = events()
        jobs = [(m, f"{RV}/{s}.wav", 4, off) for s in ("session1", "session2") for off in (0, 320, 640, 960)]
        jobs += [(m, f"{RV}/{s}.wav", 1, 0) for s in ("session1", "session2")]
        out = {}
        for path, g, off, trig, scores, times in ex.map(j_replay, jobs):
            s = os.path.basename(path)[:-4]
            rows = []
            for t, sc in trig:
                e = match(t, ev[s])
                rows.append({"t": t, "score": sc, "kind": e[2] if e else "other", "event": e[3] if e else "none"})
            per = {}
            for a0, b0, kind, label in ev[s]:
                sel = (times >= a0) & (times <= b0 + 1.2)
                key = label.split(" ")[0]
                if key == "(unsegmented)":
                    key = f"u{int(a0)}"
                per[key] = round(float(scores[sel].max()), 4)
            out[f"{s}@x{g}@off{off}"] = {"triggers": rows, "per_event_max": per}
        res["replay"] = out
        print("replay done", flush=True)

    if "say" in parts:
        groups = {g: sorted(glob.glob(f"{W}/eval/say/{g}/*.wav")) for g in ("pos", "neg", "odd")}
        out = {g: {} for g in groups}
        allc = [(g, c) for g, cs in groups.items() for c in cs]
        for (g, c), (path, gain, s) in zip(allc, ex.map(j_clip, [(m, c, 1) for _, c in allc], chunksize=4)):
            out[g][os.path.basename(c)[:-4]] = round(s, 4)
        res["say"] = out
        print("say done", flush=True)

    if "say_mic" in parts:
        groups = {g: sorted(glob.glob(f"{W}/eval/say_mic/{g}/*.wav")) for g in ("pos", "neg", "odd")}
        out = {g: {} for g in groups}
        allc = [(g, c) for g, cs in groups.items() for c in cs]
        for (g, c), (path, gain, s) in zip(allc, ex.map(j_clip, [(m, c, 4) for _, c in allc], chunksize=4)):
            out[g][os.path.basename(c)[:-4]] = round(s, 4)
        res["say_mic"] = out
        print("say_mic done", flush=True)

    if "noisy" in parts:
        dirs = sorted(glob.glob(f"{W}/eval/noisy/*"))
        allc = [(os.path.basename(d), c) for d in dirs for c in sorted(glob.glob(f"{d}/*.wav"))]
        gains = [1 if st.startswith("say_") else 4 for st, _ in allc]
        out = {}
        for (st, c), (path, gain, s) in zip(allc, ex.map(j_clip, [(m, c, g) for (_, c), g in zip(allc, gains)], chunksize=4)):
            out.setdefault(st, {})[os.path.basename(c)[:-4]] = round(s, 4)
        res["noisy"] = out
        print("noisy done", flush=True)

    if "libri" in parts:
        streams = sorted(glob.glob(f"{W}/eval/fp_streams/*.wav"))
        out = {}
        for path, g, off, trig, scores, times in ex.map(j_replay, [(m, p, 4, 0) for p in streams]):
            out[os.path.basename(path)[:-4]] = {"hours": round(float(times[-1]) / 3600, 4), "triggers": trig,
                                                "n_ge_0.3": int((scores >= 0.3).sum())}
        res["libri"] = out
        print("libri done", flush=True)

    ex.shutdown()

    if "val_fp" in parts or "synth" in parts:
        from fastscore import session, scores, windows
        sess = session(m)
        if "val_fp" in parts:
            v = np.load(f"{W}/data/features/validation_set_features.npy")
            vs = scores(sess, windows(v))
            hrs = len(vs) * 0.08 / 3600
            half = len(vs) // 2
            r = {"hours": round(hrs, 3)}
            for th in (0.5,):
                hot = vs >= th
                r[f"fph_all@{th}"] = round(hot.sum() / hrs, 3)
                r[f"fph_first_half@{th}"] = round(hot[:half].sum() / (hrs / 2), 3)
                r[f"fph_second_half@{th}"] = round(hot[half:].sum() / (hrs / 2), 3)
                idx = np.flatnonzero(hot); acts = 0; last = -10 ** 9
                for i in idx:
                    if i - last > 25:
                        acts += 1
                    last = i
                r[f"activations_per_hr@{th}"] = round(acts / hrs, 3)
            res["val_fp"] = r
        if "synth" in parts:
            p = scores(sess, np.load(f"{W}/feats/positive_test.npy"))
            n = scores(sess, np.load(f"{W}/feats/negative_test.npy"))
            res["synth"] = {"micsim_pos_recall@0.5": round(float((p >= 0.5).mean()), 4),
                            "micsim_neg_fp_rate@0.5": round(float((n >= 0.5).mean()), 4)}
        print("val/synth done", flush=True)

    # merge into whatever is on disk now (other evaluate.py runs may have written other parts meanwhile)
    cur = json.load(open(out_path)) if os.path.exists(out_path) else {}
    cur.update({k: v for k, v in res.items() if k == "model" or k in parts})
    json.dump(cur, open(out_path, "w"), indent=1)
    print("wrote", out_path)


if __name__ == "__main__":
    main()
