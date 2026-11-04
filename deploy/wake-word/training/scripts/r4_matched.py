"""Recall at matched false-wake budgets: for each model, the threshold giving K hot windows on the
10.7 h validation features, then how many held-out real tries reach it."""
import json, sys
from pathlib import Path
import numpy as np
R = Path.home()/'r4eval'; sys.path.insert(0, str(R))
from fastscore import session, scores, windows
d = json.load(open(R/'r4.json'))
v = windows(np.load(R/'validation_set_features.npy'))
models = {'round3': R/'final/hey_canvas_round3b.onnx', 'r4_syn': R/'models/r4_syn.onnx', 'r4_live': R/'models/r4_live.onnx', 'r4_near': R/'models/r4_near.onnx', 'r4b_live': R/'models/r4b_live.onnx'}
fold = {'round3b_f0': R/'final/round3b_f0.onnx', 'round3b_f1': R/'final/round3b_f1.onnx', 'r4_f0': R/'models/r4_f0.onnx', 'r4_f1': R/'models/r4_f1.onnx', 'r4b_f0': R/'models/r4b_f0.onnx', 'r4b_f1': R/'models/r4b_f1.onnx'}
vs = {k: np.sort(scores(session(str(p)), v))[::-1] for k, p in {**models, **fold}.items()}
live = [x for x in d['live'].values() if x['primary']]
c3 = [r for r in d['coach'].values() if r['session'] == 'coach3' and r['kind'] == 'wake' and r['valid']]
c1 = [r for r in d['coach'].values() if r['session'] == 'coach1' and r['kind'] == 'wake' and r['valid']]
print('K = hot windows allowed on 10.7 h validation (round 3 has 3 at 0.5, 52 at 0.1)')
for K in (3, 10, 25, 52, 150):
    t = {k: s[K] + 1e-12 for k, s in vs.items()}
    out = []
    for m in ('round3', 'r4_syn', 'r4_near', 'r4_live', 'r4b_live'):
        if f'{m}/FR' in live[0]:
            out.append(f"live {m} {sum(x[f'{m}/FR'] >= t[m] for x in live)}/6")
    oof = lambda pre: sum(r['max'][pre + str(r['fold'])] >= t[pre + str(r['fold'])] for r in c3)
    out.append(f"c3 OOF r3 {oof('round3b_f')}/31")
    out.append(f"c3 OOF r4 {oof('r4_f')}/31")
    out.append(f"c3 OOF r4b {oof('r4b_f')}/31")
    out.append(f"c3 r4_syn {sum(r['max']['r4_syn'] >= t['r4_syn'] for r in c3)}/31")
    out.append(f"c1 r4_syn {sum(r['max']['r4_syn'] >= t['r4_syn'] for r in c1)}/9 ")
    print(f'K={K:3d}', ' | '.join(out))
