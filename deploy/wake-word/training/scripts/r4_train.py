#!/usr/bin/env python3
"""Round 4 training: one synthetic model from scratch, then real-voice fine-tunes.

r4_syn    from scratch, synthetic + speech negatives only (no recording of Mike's tries at all;
          his chat/command audio only appears as F5 voice references). 120k steps, layer 64,
          like openWakeWord's stock models but with ~4x round 3's positive variety.
r4_live   r4_syn fine-tuned on coach1 + coach3 tries. Never sees the live recording, so its
          live-try numbers are held out. This is the round 4 candidate.
r4_f0/f1  r4_syn fine-tuned on coach1 + the live tries + half of coach3 (round 3b's folds),
          to score the other half of coach3 held out.

Every export is calibrated with calib_matched.py: the smallest raw threshold that keeps
<= 3 hot windows on openWakeWord's 10.7 h validation features, mapped to the Pi's 0.5.
Selection never reads Mike's tries.

Usage: r4_train.py syn | heads | calibrate
"""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import yaml

W = Path(os.environ.get('W', Path(__file__).resolve().parents[1]))
PY = str(W / 'venv/bin/python')
D = W / 'runs/r4/hey_canvas'
REAL = W / 'runs/r4_real'


def base_cfg(name):
    return dict(
        model_name='hey_canvas', target_phrase=['hey canvas'], custom_negative_phrases=[],
        n_samples=0, n_samples_val=0, tts_batch_size=1, augmentation_batch_size=1,
        piper_sample_generator_path=str(W / 'src/piper-sample-generator'),
        output_dir=str(W / 'runs' / name),
        rir_paths=[str(W / 'data/mit_rirs')],
        background_paths=[str(W / 'data/audioset_16k'), str(W / 'data/fma_16k')],
        background_paths_duplication_rate=[1, 1],
        false_positive_validation_data_path=str(W / 'data/features/validation_set_features.npy'),
        augmentation_rounds=1,
        feature_data_files=dict(
            ACAV100M_sample=str(W / 'data/features/openwakeword_features_ACAV100M_2000_hrs_16bit.npy'),
            speech_far=str(D / 'speech_features_train.npy')),
        batch_n_per_class=dict(ACAV100M_sample=1024, speech_far=192, adversarial_negative=128, positive=256),
        model_type='dnn', layer_size=64, steps=120000, max_negative_weight=1500,
        target_false_positives_per_hour=0.2, torch_threads=4, training_workers=0, seed=42,
        positive_features_test=str(D / 'positive_features_test.npy'),
        negative_features_test=str(D / 'negative_features_test.npy'),
    )


def link_run(name):
    data = W / 'runs' / name / 'hey_canvas'
    data.mkdir(parents=True, exist_ok=True)
    for f in ['positive_test', 'positive_features_train.npy', 'negative_features_train.npy']:
        if not (data / f).exists():
            (data / f).symlink_to(D / f)


def train(name, cfg):
    link_run(name)
    path = W / 'configs' / f'{name}.yml'
    path.write_text(yaml.safe_dump(cfg, sort_keys=False))
    raw = W / 'runs' / name / 'hey_canvas.onnx'
    if not raw.exists():
        with (W / 'logs' / f'train_{name}.log').open('w') as log:
            subprocess.run([PY, '-I', str(W / 'scripts/oww_train.py'), '--training_config', str(path), '--train_model'],
                           cwd=W, stdout=log, stderr=subprocess.STDOUT, check=True)
    print('TRAINED', name, flush=True)


def heads():
    labels = json.loads((W / 'meta/r4_labels.json').read_text())
    tries = [r for r in labels if r['kind'] == 'wake' and r.get('usable')]
    sets = {
        'r4_live': [r for r in tries if r['session'] in ('coach1', 'coach3')],
        'r4_f0': [r for r in tries if r['session'] in ('coach1', 'live') or (r['session'] == 'coach3' and r['fold'] != 0)],
        'r4_f1': [r for r in tries if r['session'] in ('coach1', 'live') or (r['session'] == 'coach3' and r['fold'] != 1)],
    }
    for name, rows in sets.items():
        run = W / 'runs' / name
        run.mkdir(parents=True, exist_ok=True)
        feats = [np.load(REAL / (r['id'] + '.npy')) for r in rows]
        for r, f in zip(rows, feats):
            assert f.ndim == 3 and f.shape[1:] == (16, 96) and np.isfinite(f).all(), r['id']
        x = np.concatenate(feats)
        np.save(run / 'positive_real.npy', x[np.random.default_rng(42).permutation(len(x))])
        manifest = dict(positive_real=[r['id'] for r in rows], init='r4_syn raw', negative_owner='coach3 room tone',
                        sources={r['id']: hashlib.sha256((REAL / (r['id'] + '.npy')).read_bytes()).hexdigest() for r in rows})
        (run / 'data_manifest.json').write_text(json.dumps(manifest, indent=1))
        cfg = base_cfg(name)
        cfg['feature_data_files'].update(positive_real=str(run / 'positive_real.npy'), negative_owner=str(REAL / 'room.npy'))
        cfg['batch_n_per_class'].update(positive_real=48, negative_owner=16)
        cfg.update(steps=10000, init_onnx=str(W / 'runs/r4_syn/hey_canvas.onnx'), init_bias_shift=0.0, base_lr=2e-5)
        train(name, cfg)


def calibrate():
    (W / 'final').mkdir(exist_ok=True)
    for name in ['r4_syn', 'r4_live', 'r4_f0', 'r4_f1']:
        raw = W / 'runs' / name / 'hey_canvas.onnx'
        out = W / 'final' / f'{name}.onnx'
        if raw.exists() and not out.exists():
            subprocess.run([PY, '-I', str(W / 'scripts/calib_matched.py'), str(raw), str(out)], check=True)


if __name__ == '__main__':
    step = sys.argv[1]
    if step == 'syn':
        train('r4_syn', base_cfg('r4_syn'))
    elif step == 'heads':
        heads()
    elif step == 'calibrate':
        calibrate()
