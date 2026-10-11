"""Find utterances in session1 (45-90 s are wake attempts) with a band-energy detector."""
import json, sys, wave
import numpy as np
from scipy.signal import butter, sosfilt
w = wave.open(sys.argv[1]); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float)
sos = butter(4, [300, 3400], btype="bandpass", fs=16000, output="sos")
xf = sosfilt(sos, x)
fr = 320
e = np.array([np.sqrt(np.mean(xf[j:j + fr] ** 2)) for j in range(0, len(x) - fr, fr)])
floor = np.percentile(e[:int(44 * 50)], 90)
act = e > max(3 * floor, 40)
# merge gaps < 0.3 s, drop < 0.15 s
segs, s = [], None
for i, a in enumerate(act):
    if a and s is None: s = i
    if not a and s is not None:
        segs.append([s, i]); s = None
merged = []
for a, b in segs:
    if merged and a - merged[-1][1] < 15: merged[-1][1] = b
    else: merged.append([a, b])
ev = [(a * fr / 16000, b * fr / 16000, float(e[a:b].max())) for a, b in merged if b - a >= 8]
print(f"floor (90th pct of 0-44 s band rms) {floor:.1f}")
for a, b, m in ev:
    print(f"{a:7.2f}-{b:7.2f}  peak band rms {m:6.0f}")
json.dump(ev, open(sys.argv[2], "w"))
