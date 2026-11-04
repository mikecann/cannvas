"""Per-try augmentation, retaining provenance for honest grouped folds.

No 988 Hz beep or TV prompt may enter a positive window: audio before each
audited clean boundary is replaced by recorded room. Ambiguous coach1 clips
are evaluation only, and coach2 command-only responses are negative data.
Both stereo channels and every augmentation inherit their source try's fold.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import os
import random
import sys

import numpy as np
import soundfile as sf
from scipy.signal import resample, fftconvolve

W = Path(__file__).resolve().parents[1]
SR, TOTAL = 16000, 32000


def load(p):
    x, sr = sf.read(p, dtype='int16', always_2d=True)
    assert sr == SR
    return x.astype(np.float32)


def room(rng, bank, n):
    x = bank[rng.integers(len(bank))]
    start = rng.integers(max(1, len(x) - n + 1))
    return np.resize(x[start:], n).copy()


def job(args):
    # Optional alternate labels/output keep recording-specific additions isolated.
    # Three-element calls retain the original round3 behavior.
    row, n, seed, *options = args
    os.environ['OMP_NUM_THREADS'] = '1'
    import torch
    torch.set_num_threads(1)
    from openwakeword.utils import AudioFeatures
    import audiomentations
    import librosa
    rng = np.random.default_rng(seed)
    random.seed(seed)
    np.random.seed(seed)
    labels = json.loads(Path(options[0] if options else W / 'real/labels.json').read_text())
    # Room tone is a shared nuisance recording, never any held-out speech.
    bank = [load(r['path'])[r['start'] + SR:r['end'], 1] for r in labels if r['kind'] == 'settle' and r['end'] - r['start'] > 3 * SR and (len(options) < 3 or r['session'] in options[2])]
    bg = sorted((W / 'data/audioset_16k').glob('*.wav')) + sorted((W / 'data/fma_16k').glob('*.wav'))
    rirs = sorted((W / 'data/mit_rirs').glob('*.wav'))
    eq = audiomentations.SevenBandParametricEQ(min_gain_db=-4, max_gain_db=4, p=1)
    F = AudioFeatures(device='cpu', ncpu=1)
    src = load(row['path']) if row['kind'] != 'room' else None
    batches, samples = [], []
    for i in range(n):
        ch = 0 if src is not None and src.shape[1] == 2 and rng.random() < .15 else 1
        if row['kind'] == 'room':
            x = room(rng, bank, TOTAL).astype(np.float64)
        else:
            if row['kind'] == 'wake':
                end = row['wake_end'] + rng.uniform(0, .25)
            else:
                end = rng.uniform(row['start'] / SR + .3, row['end'] / SR)
            speed = rng.uniform(.9, 1.1)
            ns = int(TOTAL * speed)
            e = min(int(end * SR), row['end'])
            boundary = row.get('training_start', row['start'])
            start = max(boundary, e - ns)
            a = src[start:e, min(ch, src.shape[1] - 1)]
            if len(a) < ns:
                a = np.concatenate([room(rng, bank, ns - len(a)), a])
            x = resample(a.astype(np.float64), TOTAL)
            if rng.random() < .4:
                x = librosa.effects.pitch_shift(x.astype(np.float32), sr=SR, n_steps=rng.uniform(-2, 2)).astype(np.float64)
            if rng.random() < .3:
                x = eq(samples=x.astype(np.float32), sample_rate=SR).astype(np.float64)
            if rng.random() < .2:
                rir = load(rirs[rng.integers(len(rirs))])[:, 0].astype(np.float64)
                rir /= max(float(np.abs(rir).max()), 1e-6)
                wet = fftconvolve(x, rir)[:TOTAL]
                wet *= np.sqrt(np.mean(x*x)) / (np.sqrt(np.mean(wet*wet)) + 1e-6)
                mix = rng.uniform(.2, .5)
                x = (1 - mix) * x + mix * wet
        if bg and rng.random() < (.5 if row['kind'] == 'room' else .3):
            b = load(bg[rng.integers(len(bg))])[:, 0].astype(np.float64)
            k = rng.integers(max(1, len(b) - TOTAL))
            b = np.resize(b[k:], TOTAL)
            sp = np.sqrt(np.mean(x[-19200:] ** 2)) + 1e-3
            # Gain stays around x1. The XVF3800 already has its own AGC.
            x += b * sp / 10 ** (rng.uniform(8, 25) / 20) / (np.sqrt(np.mean(b*b)) + 1e-3)
        x *= 10 ** (rng.uniform(-3, 3) / 20)
        samples.append(np.clip(np.round(x), -32768, 32767).astype(np.int16))
        if len(samples) == 64 or i == n - 1:
            batches.append(F.embed_clips(np.stack(samples), batch_size=64, ncpu=1).astype(np.float32))
            samples = []
    out = Path(options[1]) if options else W / 'runs/real_features'
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / (row['id'] + '.partial.npy')
    np.save(tmp, np.concatenate(batches))
    tmp.replace(out / (row['id'] + '.npy'))
    return row['id'], n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=6)
    a = ap.parse_args()
    labels = json.loads((W / 'real/labels.json').read_text())
    rows = [r for r in labels if r['kind'] in ('wake', 'chat', 'prompt', 'command') and (r['kind'] != 'wake' or r.get('usable'))]
    rows += [dict(id='room', kind='room')]
    jobs = [(r, 1500 if r['kind'] == 'wake' else 6000 if r['kind'] == 'room' else 400, 30000 + i) for i, r in enumerate(rows) if not (W / 'runs/real_features' / (r['id'] + '.npy')).exists()]
    with ProcessPoolExecutor(a.workers) as pool:
        for result in pool.map(job, jobs):
            print(result, flush=True)
    (W / 'runs/real_features/READY').touch()


if __name__ == '__main__':
    main()
