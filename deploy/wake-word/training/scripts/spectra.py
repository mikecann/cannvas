"""Compare long-term spectra: room background, the owner's close-range speech, TTS positives."""
import glob, json, sys, wave
import numpy as np
from scipy.signal import welch
RV, W = sys.argv[1], sys.argv[2]
def load(p):
    w = wave.open(p); return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float)
s1 = load(f"{RV}/session1.wav"); s2 = load(f"{RV}/session2.wav")
bg = np.concatenate([s1[:44 * 16000], s2[:48 * 16000]])
f, Pbg = welch(bg, 16000, nperseg=512)
info = json.load(open(f"{W}/real/seg_info.json"))
close = ["seg02", "seg03", "seg05", "seg06", "seg09", "seg10", "seg12", "seg13", "seg38", "seg39"]
P = []
for s in close:
    o = info[s + ".wav"]; a = int((o["start"] + o["sp_on"]) * 16000); b = int((o["start"] + o["sp_off"]) * 16000)
    _, p = welch(s2[a:b], 16000, nperseg=512); P.append(np.maximum(p - Pbg, 1e-6))
Preal = np.mean([p / p[(f > 300) & (f < 3400)].mean() for p in P], 0)
tts = sorted(glob.glob(f"{W}/runs/run1/hey_canvas/positive_test/*.wav"))[:300]
Pt = []
for c in tts:
    x = load(c); _, p = welch(x, 16000, nperseg=512); Pt.append(p / p[(f > 300) & (f < 3400)].mean())
Ptts = np.mean(Pt, 0)
edges = [0, 80, 125, 200, 300, 500, 800, 1200, 1800, 2500, 3200, 4000, 5000, 6000, 7000, 8000]
print(" band (Hz)     bg dB   real dB   tts dB   real-tts dB")
rows = []
for lo, hi in zip(edges[:-1], edges[1:]):
    m = (f >= lo) & (f < hi)
    r = 10 * np.log10(Preal[m].mean()); t = 10 * np.log10(Ptts[m].mean()); b = 10 * np.log10(Pbg[m].mean())
    rows.append((lo, hi, r - t))
    print(f"{lo:5d}-{hi:5d}  {b:7.1f}  {r:7.1f}  {t:7.1f}  {r - t:7.1f}")
np.save(f"{W}/real/eq_curve.npy", np.stack([f, 10 * np.log10(Preal / Ptts)]))
