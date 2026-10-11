#!/usr/bin/env python3
"""Long false-positive test streams from LibriSpeech (never used in training), as the Cannvas mic would hear it.

Utterances are concatenated with 0.3-1.5 s gaps, each scaled to a speech peak drawn from the owner's
close-range range at x1 (600-3000), and the room background (session1/2 silences, looped with random
offsets) is added at its real level. Written at x1; the replay applies the service's x4.
  room:      full-band LibriSpeech + room background
  room_mic:  LibriSpeech through the mic's measured roll-off (4th-order low-pass at 2.2 kHz) + room background
Output: <out_dir>/<set>_<variant>_<k>.wav, about 1 hour each.
Usage: make_fp_streams.py <LibriSpeech dir> <out_dir> test-clean [test-other]
"""
import glob
import os
import sys
import wave

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feats2 import room_bank  # noqa: E402

SR = 16000


def save(path, x):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(np.clip(np.round(x), -32768, 32767).astype(np.int16).tobytes())


def room_stream(n, rng, bank):
    out = np.empty(0)
    while len(out) < n:
        p = bank[rng.integers(len(bank))]
        i = rng.integers(0, len(p) - SR * 5)
        seg = p[i:i + rng.integers(SR * 5, len(p) - i)]
        if len(out):  # 20 ms crossfade
            f = np.linspace(0, 1, 320)
            out[-320:] = out[-320:] * (1 - f) + seg[:320] * f
            seg = seg[320:]
        out = np.concatenate([out, seg])
    return out[:n]


def main():
    ls, out_dir, *sets = sys.argv[1:]
    os.makedirs(out_dir, exist_ok=True)
    bank = room_bank()
    lp = butter(4, 2200, btype="low", fs=SR, output="sos")
    for s in sets:
        files = sorted(glob.glob(f"{ls}/{s}/*/*/*.flac"))
        rng = np.random.default_rng(len(files))
        rng.shuffle(files)
        chunks, cur, k = [], [], 0
        for f in files + [None]:
            if f is not None:
                d, sr = sf.read(f, dtype="float64")
                assert sr == SR
                cur.append(d)
                cur.append(np.zeros(int(rng.uniform(0.3, 1.5) * SR)))
            if f is None or sum(len(c) for c in cur) >= 3600 * SR:
                speech = np.concatenate(cur)
                for variant in ("room", "room_mic"):
                    r = np.random.default_rng(k * 10 + (variant == "room_mic"))
                    x = sosfilt(lp, speech) if variant == "room_mic" else speech.copy()
                    # per-utterance level: scale each utterance's peak to 600-3000 (x1 mic level)
                    pos = 0
                    for c in cur:
                        seg = x[pos:pos + len(c)]
                        if c.any():
                            seg *= np.exp(r.uniform(np.log(600), np.log(3000))) / (np.abs(seg).max() + 1e-9)
                        pos += len(c)
                    x = x + room_stream(len(x), r, bank)
                    save(f"{out_dir}/{s}_{variant}_{k}.wav", x)
                    print(f"{s}_{variant}_{k}.wav {len(x) / SR / 3600:.2f} h", flush=True)
                cur, k = [], k + 1


if __name__ == "__main__":
    main()
