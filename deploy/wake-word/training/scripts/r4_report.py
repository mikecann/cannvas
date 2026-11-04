#!/usr/bin/env python3
"""Tables for RESULTS-round4.md from r4_eval.py's JSON. Usage: r4_report.py results.json"""
import json
import sys

d = json.load(open(sys.argv[1]))
TH = (.5, .1)


def cnt(vals, t):
    return sum(v >= t for v in vals)


print('## Live tries (27-29 Oct lounge recording), held out from every model below\n')
rows = [v for v in d['live'].values() if v['primary']]
models = sorted({k.split('/')[0] for v in rows for k in v if '/' in k})
print('| model | FR >= 0.5 | FR >= 0.1 | FL >= 0.5 | FL >= 0.1 | FR scores |')
print('|---|---|---|---|---|---|')
for m in models:
    fr = [v[f'{m}/FR'] for v in rows]; fl = [v[f'{m}/FL'] for v in rows]
    print(f'| {m} | {cnt(fr, .5)}/{len(fr)} | {cnt(fr, .1)}/{len(fr)} | {cnt(fl, .5)}/{len(fl)} | {cnt(fl, .1)}/{len(fl)} | {", ".join(f"{x:.2f}" for x in fr)} |')
unc = [v for v in d['live'].values() if not v['primary']]
if unc:
    print('\nUncertain try (thu 18:08, "Hey Kano" or "Hey, can I?"), FR:', {m: unc[0].get(f'{m}/FR') for m in models})
print('\nNon-try speech in the same clips (separate events, 5 s apart):\n')
print('| model/channel | seconds | max | events >= 0.5 | events >= 0.1 |')
print('|---|---|---|---|---|')
for k, v in d['live_nontry'].items():
    print(f"| {k} | {v['seconds']:.0f} | {v['max']:.2f} | {v['ev05']} | {v['ev01']} |")

print('\n## Coached tries, each scored only by models that never trained on it\n')
print('| session | model | n | >= 0.5 | >= 0.1 |')
print('|---|---|---|---|---|')
for sess in ('coach1', 'coach3'):
    tries = [r for r in d['coach'].values() if r['session'] == sess and r['kind'] == 'wake' and r['valid']]
    groups = {}
    for r in tries:
        for m, v in r['max'].items():
            key = 'round 3 recipe (round3b_day / f0+f1)' if m.startswith('round3b') else 'round 4 fine-tune (r4_f0+f1)' if m in ('r4_f0', 'r4_f1') else m
            groups.setdefault(key, []).append(v)
    for k, vals in groups.items():
        print(f'| {sess} | {k} | {len(vals)} | {cnt(vals, .5)} | {cnt(vals, .1)} |')
for sess in ('coach3',):
    print(f'\n{sess} by distance, >= 0.5 (>= 0.1):\n')
    print('| spot | round 3 recipe | r4_syn | r4 fine-tune |')
    print('|---|---|---|---|')
    for spot in ('1m', '2m', '3m', 'far'):
        tries = [r for r in d['coach'].values() if r['session'] == sess and r['kind'] == 'wake' and r['valid'] and r['spot'] == spot]
        def col(pick):
            vals = [v for r in tries for m, v in r['max'].items() if pick(m)]
            return f'{cnt(vals, .5)}/{len(vals)} ({cnt(vals, .1)})'
        print(f"| {spot} | {col(lambda m: m.startswith('round3b'))} | {col(lambda m: m == 'r4_syn')} | {col(lambda m: m in ('r4_f0', 'r4_f1'))} |")

print('\n## False-wake guards (README tables), threshold 0.5\n')
neg = [r for r in d['coach'].values() if r['kind'] != 'wake']
allm = list(d['models'])
print('| guard | ' + ' | '.join(allm) + ' |')
print('|---|' + '---|' * len(allm))
for label, kinds in (('Mike chat (15)', ('chat',)), ('coach2 command-only replies (24)', ('command',)), ('TV prompts (68)', ('prompt',))):
    rs = [r for r in neg if r['kind'] in kinds]
    print(f'| {label} | ' + ' | '.join(str(sum(r["max"].get(m, 0) >= .5 for r in rs)) for m in allm) + ' |')
G = d['guards']
for g, label in (('say_neg', 'near misses firing (87)'), ('say_pos', 'macOS say wakes (66, recall)'), ('say_noisy10', 'say + TV-like 10 dB (recall)'),
                 ('say_noisy5', 'say + TV-like 5 dB (recall)'), ('room', 'room tone clips firing')):
    print(f'| {label} | ' + ' | '.join(str(G[g][m]['firing05']) for m in allm) + ' |')
for g, label in (('libri_native', 'LibriSpeech 12 h hot windows'), ('libri_xvf', 'LibriSpeech via simulated XVF hot windows')):
    print(f'| {label} | ' + ' | '.join(str(G[g][m]['hot05']) for m in allm) + ' |')
print('| validation 10.7 h hot windows | ' + ' | '.join(str(d['validation'][m]['0.5']) for m in allm) + ' |')
print('\nAt 0.1: near misses firing ' + ', '.join(f"{m} {G['say_neg'][m]['firing01']}" for m in allm)
      + '; validation hot windows ' + ', '.join(f"{m} {d['validation'][m]['0.1']}" for m in allm)
      + '; LibriSpeech XVF hot windows ' + ', '.join(f"{m} {G['libri_xvf'][m]['hot01']}" for m in allm))
