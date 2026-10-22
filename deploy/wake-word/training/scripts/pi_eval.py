#!/usr/bin/env python3
"""Pi-identical scoring helpers (openwakeword==0.6.0, onnxruntime, ONNX framework).

clip_score(model, audio, gain): 1 s silence padded each side, 1280-sample int16 frames,
  mic samples multiplied by `gain` and clipped to int16 (like cannvas-voice's MIC_GAIN), max score.
replay(model, audio, gain): continuous stream like the live service: 1 s silence lead-in, then the whole
  recording; on score >= 0.5 a trigger is logged, the model is reset and triggers are ignored for 1.0 s
  (the model is still fed during that second, as in Voice.rest()). Returns triggers and the per-frame scores.
"""
import wave

import numpy as np
from openwakeword.model import Model

FRAME = 1280
SR = 16000


def load(path):
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getnchannels() == 1 and w.getsampwidth() == 2, path
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)


def boost(audio, gain):
    return np.clip(audio.astype(np.int32) * gain, -32768, 32767).astype(np.int16)


def new_model(path):
    m = Model(wakeword_models=[path], inference_framework="onnx")
    return m, list(m.models.keys())[0]


def clip_score(model_path, audio, gain=1):
    np.random.seed(0)  # openwakeword seeds its feature buffer with random noise
    model, key = new_model(model_path)
    a = np.concatenate([np.zeros(SR, np.int16), boost(audio, gain), np.zeros(SR, np.int16)])
    best, at = 0.0, 0.0
    for i in range(0, len(a) - FRAME + 1, FRAME):
        s = float(model.predict(a[i:i + FRAME])[key])
        if s > best:
            best, at = s, (i + FRAME) / SR - 1.0
    return best, at


def replay(model_path, audio, gain=4, threshold=0.5, deaf_s=1.0):
    np.random.seed(0)
    model, key = new_model(model_path)
    a = np.concatenate([np.zeros(SR, np.int16), boost(audio, gain)])
    n = (len(a) // FRAME) * FRAME
    scores = np.zeros(n // FRAME, np.float32)
    triggers = []
    deaf_until = -1.0
    for k, i in enumerate(range(0, n, FRAME)):
        s = float(model.predict(a[i:i + FRAME])[key])
        scores[k] = s
        t = (i + FRAME) / SR - 1.0  # time in the recording at the end of this frame
        if s >= threshold and t >= deaf_until:
            triggers.append((round(t, 2), round(s, 4)))
            model.reset()
            deaf_until = t + deaf_s
    return triggers, scores
