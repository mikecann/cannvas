import glob, json, wave, sys
import numpy as np
from scipy.signal import butter, sosfilt
def load(p):
    w = wave.open(p); return np.frombuffer(w.readframes(w.getnframes()), np.int16)
RV = sys.argv[1]
s2 = load(f"{RV}/session2.wav")
sos = butter(4, [300, 3400], btype="bandpass", fs=16000, output="sos")
out = {}
for p in sorted(glob.glob(f"{RV}/session2-segments/seg*.wav")):
    x = load(p)
    # exact match search on first 64 samples
    key = x[:64].tobytes()
    b = s2.tobytes()
    i = b.find(key)
    while i != -1 and i % 2:
        i = b.find(key, i + 1)
    off = i // 2
    assert (s2[off:off + len(x)] == x).all(), p
    xf = sosfilt(sos, x.astype(float))
    # 20 ms band energy envelope to find speech start/end
    fr = 320
    e = np.array([np.sqrt(np.mean(xf[j:j+fr]**2)) for j in range(0, len(x) - fr, fr)])
    thr = max(np.percentile(e, 20) * 3, e.max() * 0.1)
    act = np.flatnonzero(e > thr)
    out[p.split("/")[-1]] = dict(start=off / 16000, dur=len(x) / 16000, peak=int(np.abs(x).max()),
                                 rms=float(np.sqrt(np.mean(x.astype(float) ** 2))),
                                 band_rms_max=float(e.max()), band_floor=float(np.percentile(e, 20)),
                                 sp_on=act[0] * fr / 16000, sp_off=(act[-1] + 1) * fr / 16000)
    o = out[p.split("/")[-1]]
    print(f"{p.split('/')[-1]} start {o['start']:7.2f} dur {o['dur']:.2f} peak {o['peak']:5d} rms {o['rms']:6.0f} band max {o['band_rms_max']:6.0f} floor {o['band_floor']:4.0f} speech {o['sp_on']:.2f}-{o['sp_off']:.2f}")
json.dump(out, open(sys.argv[2], "w"), indent=1)
