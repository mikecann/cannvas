"""Rebuild the utterance index of the LibriSpeech FP streams (same order/gaps as make_fp_streams.py) and
look up what was being said at given trigger times. Usage: fp_index.py <LibriSpeech dir> <set> <chunk> <t> ..."""
import glob, os, sys
import numpy as np
import soundfile as sf
SR = 16000
ls, s, chunk, *ts = sys.argv[1:]
files = sorted(glob.glob(f"{ls}/{s}/*/*/*.flac"))
rng = np.random.default_rng(len(files)); rng.shuffle(files)
idx, cur, k, pos = [], 0, 0, 0
for f in files:
    n = sf.info(f).frames
    gap = int(rng.uniform(0.3, 1.5) * SR)
    if k == int(chunk):
        idx.append((pos / SR, (pos + n) / SR, f))
    pos += n + gap
    if pos >= 3600 * SR:
        k += 1; pos = 0
        if k > int(chunk): break
trans = {}
for t in ts:
    t = float(t)
    for a, b, f in idx:
        if a - 0.5 <= t <= b + 1.5:
            uid = os.path.basename(f)[:-5]
            tf = glob.glob(os.path.join(os.path.dirname(f), "*.trans.txt"))[0]
            line = [l for l in open(tf) if l.startswith(uid)][0].strip()
            print(f"{t:.1f}s in {s}_{chunk}: utterance {a:.1f}-{b:.1f}s: {line}")
