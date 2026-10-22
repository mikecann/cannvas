#!/usr/bin/env python3
"""Noisy held-out test clips ("Hey Canvas with the TV on"): the say / say_mic clips and the owner's session2
close-range and 2 m tries with background noise mixed in at 10 dB and 5 dB SNR (300-3400 Hz band power over
the utterance). Noise: half LibriSpeech test-other speech (TV dialogue stand-in), half FMA music tracks that
were not used for training (data/fma_unseen). For say_mic and the real clips the noise first goes through
the mic's low-pass (it would be recorded by the same mic). Layout: eval/noisy/<set>_<snr>/<clip>.wav
Usage: make_noisy.py <real-voice dir>"""
import glob, json, os, sys, wave
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

W = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RV = sys.argv[1]
SR = 16000
BAND = butter(4, [300, 3400], btype="bandpass", fs=SR, output="sos")
LP = butter(4, 2200, btype="low", fs=SR, output="sos")
rng = np.random.default_rng(2024)
speech = sorted(glob.glob(f"{W}/data/librispeech/x/LibriSpeech/test-other/*/*/*.flac"))
music = sorted(glob.glob(f"{W}/data/fma_unseen/*.wav"))


def load(p):
    with wave.open(p) as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float64)


def save(p, x):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with wave.open(p, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(np.clip(np.round(x), -32768, 32767).astype(np.int16).tobytes())


def noise(n, k):
    out = np.empty(0)
    while len(out) < n:
        if k % 2 == 0:
            d, _ = sf.read(speech[rng.integers(len(speech))], dtype="float64")
        else:
            d, _ = sf.read(music[rng.integers(len(music))], dtype="float64")
            if d.ndim > 1:
                d = d.mean(1)
            i = rng.integers(0, max(1, len(d) - n))
            d = d[i:i + n]
        out = np.concatenate([out, d])
    return out[:n]


def bandpow(x):
    return np.mean(sosfilt(BAND, x) ** 2) + 1e-9


def mix(x, active, k, snr, through_mic):
    nz = noise(len(x), k)
    if through_mic:
        nz = sosfilt(LP, nz)
    nz *= np.sqrt(bandpow(x[active]) / bandpow(nz[active]) / 10 ** (snr / 10))
    return x + nz


def main():
    jobs = []
    for g in ("pos", "neg"):
        for k, p in enumerate(sorted(glob.glob(f"{W}/eval/say/{g}/*.wav"))):
            x = load(p)
            x = np.concatenate([np.zeros(24000), x, np.zeros(16000)])
            jobs.append((f"say_{g}", os.path.basename(p), x, slice(24000, len(x) - 16000), k, False))
        for k, p in enumerate(sorted(glob.glob(f"{W}/eval/say_mic/{g}/*.wav"))):
            x = load(p)
            jobs.append((f"saymic_{g}", os.path.basename(p), x, slice(24000, len(x) - 16000), k, True))
    s2 = load(f"{RV}/session2.wav")
    utt = {u["name"]: u for u in json.load(open(f"{W}/real/utterances.json"))}
    for k, name in enumerate(["seg02", "seg03", "seg05", "seg06", "seg09", "seg10", "seg12", "seg13", "seg38",
                              "seg39", "seg41b", "seg42"]):
        u = utt[name]
        a, b = int((u["on"] - 1.5) * SR), int((u["off"] + 1.0) * SR)
        x = s2[a:b].copy()
        jobs.append(("real", name + ".wav", x, slice(int(1.5 * SR), len(x) - SR), k, True))
    for snr in (10, 5):
        for st, name, x, active, k, mic in jobs:
            save(f"{W}/eval/noisy/{st}_{snr}/{name}", mix(x, active, k, snr, mic))
    print("wrote", len(jobs) * 2, "clips")


if __name__ == "__main__":
    main()
