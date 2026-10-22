#!/usr/bin/env python3
"""Score WAV clips exactly the way the Pi runtime does.

openwakeword==0.6.0, onnxruntime, Model(wakeword_models=[path], inference_framework="onnx"),
1 s of silence padded before and after, streamed in 1280-sample (80 ms) int16
frames, max score reported. A fresh Model per clip so no state carries over.

Usage: score_clips.py --model hey_canvas.onnx [--json out.json] clip1.wav clip2.wav ...
Clips must be 16 kHz mono int16 WAV.
"""
import argparse
import json
import os
import wave

import numpy as np
from openwakeword.model import Model


def load(path):
    with wave.open(path) as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2, path
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)


def score(model_path, audio):
    m = Model(wakeword_models=[model_path], inference_framework="onnx")
    key = list(m.models.keys())[0]
    a = np.concatenate([np.zeros(16000, np.int16), audio, np.zeros(16000, np.int16)])
    best, at, n_hot = 0.0, 0.0, 0
    for i in range(0, len(a) - 1280 + 1, 1280):
        s = float(m.predict(a[i:i + 1280])[key])
        n_hot += s >= 0.5
        if s > best:
            best, at = s, (i + 1280) / 16000
    return best, at, int(n_hot)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--json")
    ap.add_argument("clips", nargs="+")
    args = ap.parse_args()
    rows = []
    for c in args.clips:
        audio = load(c)
        best, at, n_hot = score(args.model, audio)
        rows.append({"clip": os.path.basename(c), "max_score": round(best, 4), "at_s": at,
                     "frames_ge_0.5": n_hot, "dur_s": round(len(audio) / 16000, 2)})
        print(f"{os.path.basename(c):60s} max {best:.4f} @ {at:5.2f}s  frames>=0.5: {n_hot}", flush=True)
    if args.json:
        with open(args.json, "w") as f:
            json.dump(rows, f, indent=1)


if __name__ == "__main__":
    main()
