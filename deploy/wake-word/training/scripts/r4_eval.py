#!/usr/bin/env python3
"""Round 4 evaluation (CPU, light; run on tinker-desk, not the M5).

Real tries are only ever scored by a model that never trained on them:
  live (6 tries, 27-29 Oct lounge recording): round 3, r4_syn, r4_near, r4_live, r4b_live (none trained on live)
  coach1 (9 tries, 22 Oct): round 3b_day (trained on coach3 only), r4_syn
  coach3 (31 tries, 23 Oct): round 3b_f0/f1, r4_f0/f1, r4b_f0/f1 (other half of coach3), r4_syn
Live clips are streamed through openWakeWord exactly like the Pi (80 ms frames, no gain),
on FR (the channel the service uses) and FL. A try counts if any frame from the start of
"Hey" to 1 s after "Canvas" reaches the threshold.

Guards (README tables): Mike's chat, coach2 command-only replies, the Pi's TV prompts, 87 near
misses, 66 macOS `say` wakes (clean, +TV-like 10/5 dB), 12 h LibriSpeech as recorded and
through a simulated XVF3800, 10.7 h openWakeWord validation features, and the non-try speech
in the live clips.

Usage: r4_eval.py <dir with models/*.onnx, eval/, live/, meta> > results.json
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

R = Path(sys.argv[1])
sys.path.insert(0, str(R))
from fastscore import session, scores, windows  # noqa: E402

M = {
    'round2': R / 'eval/models/shipped.onnx',
    'round3': R / 'final/hey_canvas_round3b.onnx',
    'round3b_day': R / 'final/round3b_day.onnx', 'round3b_f0': R / 'final/round3b_f0.onnx', 'round3b_f1': R / 'final/round3b_f1.onnx',
}
for p in sorted((R / 'models').glob('r4*.onnx')):
    M[p.stem] = p
TH = [.05, .1, .2, .3, .4, .5, .6, .7, .8]
SR = 16000


def stream(model_path, x):
    from openwakeword.model import Model
    np.random.seed(0)
    m = Model(wakeword_models=[str(model_path)], inference_framework='onnx')
    k = next(iter(m.models))
    return np.array([float(m.predict(x[i:i + 1280])[k]) for i in range(0, len(x) - 1279, 1280)])


def events(times, s, t, gap=5.):
    n, last = 0, -1e9
    for a, v in zip(times, s):
        if v >= t and a - last > gap:
            n, last = n + 1, a
    return n


def main():
    out = dict(models={k: str(v.name) for k, v in M.items()}, live={}, live_nontry={}, coach={}, guards={}, validation={})
    tries = json.loads((R / 'live_tries.json').read_text())
    S = {k: session(str(v), threads=2) for k, v in M.items()}
    live_models = [k for k in M if k in ('round2', 'round3') or k in ('r4_syn', 'r4_near') or k.endswith('_live')]
    for clip in sorted({t['clip'] for t in tries} | {p.stem for p in (R / 'live').glob('*.flac')}):
        x, sr = sf.read(R / 'live' / f'{clip}.flac', dtype='int16', always_2d=True)
        ct = [t for t in tries if t['clip'] == clip]
        for ch, chn in ((1, 'FR'), (0, 'FL')):
            for name in live_models:
                s = stream(M[name], np.ascontiguousarray(x[:, ch]))
                times = (np.arange(len(s)) + 1) * .08
                for t in ct:
                    mask = (times >= t['wake_start']) & (times <= t['wake_end'] + 1.0)
                    out['live'].setdefault(t['id'], dict(primary=t['primary']))[f'{name}/{chn}'] = round(float(s[mask].max()), 4)
                keep = np.ones(len(s), bool)
                for t in ct:
                    keep &= ~((times >= t['wake_start'] - .5) & (times <= t['wake_end'] + 1.5))
                row = out['live_nontry'].setdefault(f'{name}/{chn}', dict(seconds=0, max=0, ev05=0, ev01=0))
                row['seconds'] += float(keep.sum() * .08)
                row['max'] = max(row['max'], float(s[keep].max()))
                row['ev05'] += events(times[keep], s[keep], .5)
                row['ev01'] += events(times[keep], s[keep], .1)
    labels = json.loads((R / 'r3b_labels.json').read_text())
    cache = {}
    for r in labels:
        if r['kind'] == 'settle':
            continue
        p = R / f"eval/round3b/c3_{r['spot']}.npz" if r['session'] == 'coach3' else R / 'eval/streams' / ((r['id'] if r['session'] == 'coach1' else 'c2_' + r['spot']) + '.npz')
        if p not in cache:
            z = np.load(p)
            cache[p] = (z['times'], {k: scores(s, z['features']) for k, s in S.items()})
        times, pr = cache[p]
        mask = (times * SR > r['start']) & (times * SR <= r['end'])
        row = dict(session=r['session'], spot=r['spot'], kind=r['kind'], fold=r.get('fold'),
                   valid=r['kind'] != 'wake' or (r.get('valid_positive', True) and (r['session'] == 'coach1' or r.get('usable', True))))
        if r['kind'] == 'wake':
            held = ['r4_syn'] + (['round3b_day'] if r['session'] == 'coach1' else [f"round3b_f{r['fold']}", f"r4_f{r['fold']}", f"r4b_f{r['fold']}"])
        else:
            held = list(M)  # no model trained on any of these as negatives
        row['max'] = {k: round(float(pr[k][mask].max()), 4) for k in held if k in pr}
        out['coach'][r['id']] = row
    for g in ['say_pos', 'say_noisy10', 'say_noisy5', 'say_neg', 'libri_native', 'libri_xvf', 'room']:
        res = {k: dict(files=0, firing05=0, firing01=0, hot05=0, hot01=0, max=0.) for k in M}
        for p in sorted((R / 'eval/cache' / g).glob('*.npy')):
            f = windows(np.load(p, mmap_mode='r'))
            for k, s in S.items():
                ps = scores(s, f); ps[:5] = 0
                d = res[k]; d['files'] += 1
                d['firing05'] += int(ps.max() >= .5); d['firing01'] += int(ps.max() >= .1)
                d['hot05'] += int((ps >= .5).sum()); d['hot01'] += int((ps >= .1).sum())
                d['max'] = max(d['max'], float(ps.max()))
        out['guards'][g] = res
    v = windows(np.load(R / 'validation_set_features.npy'))
    for k, s in S.items():
        ps = scores(s, v)
        out['validation'][k] = {str(t): int((ps >= t).sum()) for t in TH}
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
