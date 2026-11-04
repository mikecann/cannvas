#!/usr/bin/env python3
"""Augmented features of Mike's real tries (coach1, coach3, live), one file per try.

Same recipe as round 3b (xvf_augment.job: 1,500 coach1 / 1,000 other windows per try,
85% FR / 15% FL, speed, pitch, EQ, mild RIR, background, +-3 dB), so each try keeps
its own file and training manifests can hold out whole sessions or folds. Room
padding and room negatives come from coach3 settle spans only.
"""
import json
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import sys

W = Path(os.environ.get('W', Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(W / 'scripts'))
from xvf_augment import job


def main():
    out = W / 'runs/r4_real'
    out.mkdir(parents=True, exist_ok=True)
    labels_path = W / 'meta/r4_labels.json'
    rows = [r for r in json.loads(labels_path.read_text()) if r['kind'] == 'wake' and r.get('usable')]
    rows.append(dict(id='room', kind='room'))
    jobs = []
    for i, r in enumerate(rows):
        n = 6000 if r['kind'] == 'room' else 1500 if r['session'] == 'coach1' else 1000
        if not (out / (r['id'] + '.npy')).exists():
            jobs.append((r, n, 44000 + i, str(labels_path), str(out), ['coach3']))
    with ProcessPoolExecutor(int(os.environ.get('R4_CPU', 6))) as pool:
        for result in pool.map(job, jobs):
            print(result, flush=True)
    (out / 'READY').touch()


if __name__ == '__main__':
    main()
