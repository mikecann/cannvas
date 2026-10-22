"""Speech on/off times (band energy) for every session2 event; which ones may be used for training."""
import json, sys, wave
import numpy as np
from scipy.signal import butter, sosfilt
sys.path.insert(0, sys.argv[2] + "/real")
from events import S2
w = wave.open(sys.argv[1] + "/session2.wav"); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float)
xf = sosfilt(butter(4, [300, 3400], btype="bandpass", fs=16000, output="sos"), x)
fr = 160
e = np.array([np.sqrt(np.mean(xf[j:j + fr] ** 2)) for j in range(0, len(x) - fr, fr)])
CLOSE = {"seg02", "seg03", "seg05", "seg06", "seg09", "seg10", "seg12", "seg13", "seg38", "seg39"}
out = []
for a, b, kind, label in S2:
    i0, i1 = int(a * 100), int(b * 100)
    seg = e[i0:i1]
    act = np.flatnonzero(seg > max(25, 0.12 * seg.max()))
    on, off = (i0 + act[0]) / 100, (i0 + act[-1] + 1) / 100
    name = label.split(" ")[0]
    if name == "(unsegmented)":
        name = f"u{int(a)}"
    use = "pos" if name in CLOSE else ("neg" if kind == "label" else "test")
    out.append({"name": name, "kind": kind, "label": label, "span": [a, b], "on": on, "off": off, "use": use,
                "peak_band_rms": float(seg.max())})
# labels must not run into the next wake try
for i, u in enumerate(out):
    nxt = [v["on"] for v in out[i + 1:] if v["kind"] == "wake"]
    u["max_end"] = round(min(u["off"] + 0.6, (nxt[0] - 0.05) if nxt else 1e9), 2)
    if u["use"] == "neg":
        u["off"] = min(u["off"], u["max_end"] - 0.6)
for u in out:
    print(f"{u['name']:8s} {u['kind']:5s} {u['use']:4s} on {u['on']:7.2f} off {u['off']:7.2f} max_end {u['max_end']:8.2f} band {u['peak_band_rms']:5.0f}  {u['label']}")
json.dump(out, open(sys.argv[2] + "/real/utterances.json", "w"), indent=1)
