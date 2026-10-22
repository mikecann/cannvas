#!/usr/bin/env python3
"""The held-out macOS `say` clips as the Cannvas mic would hear them: 4th-order low-pass at 2.2 kHz (the mic's
measured roll-off), peak set to 1500 (the owner's close-range level at x1), 1.5 s of real room background
before and 1 s after (instead of digital silence). Scored at x4 like the live service.
Usage: make_say_mic.py <eval/say> <eval/say_mic>"""
import glob, os, sys, wave
import numpy as np
from scipy.signal import butter, sosfilt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feats2 import room_bank, room_chunk
src, dst = sys.argv[1:3]
bank = room_bank()
lp = butter(4, 2200, btype="low", fs=16000, output="sos")
rng = np.random.default_rng(5)
for g in ("pos", "neg", "odd"):
    os.makedirs(f"{dst}/{g}", exist_ok=True)
    for p in sorted(glob.glob(f"{src}/{g}/*.wav")):
        w = wave.open(p); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float)
        x = sosfilt(lp, x); x *= 1500 / (np.abs(x).max() + 1e-9)
        x = np.concatenate([np.zeros(24000), x, np.zeros(16000)])
        x = x + room_chunk(rng, bank, len(x)) if len(x) < 40 * 16000 else x + np.resize(bank[0], len(x))
        with wave.open(f"{dst}/{g}/{os.path.basename(p)}", "wb") as o:
            o.setnchannels(1); o.setsampwidth(2); o.setframerate(16000)
            o.writeframes(np.clip(np.round(x), -32768, 32767).astype(np.int16).tobytes())
print("ok")
