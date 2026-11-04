#!/usr/bin/env python3
"""Private-data prep for round 4 on the pod (the recordings never leave the pod).

1. meta/r4_labels.json: round 3b's audited coach labels with pod paths, plus the
   live-recording tries (meta/live_tries.json, timed by hand from Whisper word
   timings and listening notes; see RESULTS-round4.md).
2. data/r4_room_fr.npy: recorded XVF3800 FR room tone from the coach sessions'
   settle spans, the far-field augmenter's noise floor. No live audio is used.
3. data/r4_tv_speech.txt: LibriSpeech dev speakers used as TV-like interference.
4. data/r4_refs.tsv: F5-TTS voice references (LibriSpeech dev, GLOBE, and Mike's
   coach-session chat/command audio as group "mike"; wake tries are never used).
"""
import io
import json
import os
import random
from pathlib import Path

import numpy as np
import soundfile as sf

W = Path(os.environ.get('W', Path(__file__).resolve().parents[1]))
SR = 16000


def remap(p):
    return str(W / 'real' / p.split('/real/', 1)[1])


def main():
    random.seed(4)
    labels = json.loads((W / 'meta/r3b_labels.json').read_text())
    for r in labels:
        r['path'] = remap(r['path'])
        assert Path(r['path']).exists(), r['path']
    for t in json.loads((W / 'meta/live_tries.json').read_text()):
        path = W / 'live' / (t['clip'] + '.flac')
        assert path.exists(), path
        labels.append(dict(id=t['id'], session='live', spot='live', kind='wake', path=str(path),
                           start=int(max(0, t['wake_start'] - 1.5) * SR), end=int((t['wake_end'] + 1.0) * SR),
                           wake_start=t['wake_start'], wake_end=t['wake_end'],
                           training_start=int(max(0, t['wake_start'] - 1.2) * SR),
                           usable=t['primary'], fold=-1, primary=t['primary'], heard=t.get('heard', '')))
    (W / 'meta/r4_labels.json').write_text(json.dumps(labels, indent=1))

    room = []
    for r in labels:
        if r['kind'] == 'settle' and r['end'] - r['start'] > 3 * SR:
            x, sr = sf.read(r['path'], dtype='float32', always_2d=True)
            room.append(x[r['start'] + SR:r['end'], 1])
    room = np.concatenate(room)
    np.save(W / 'data/r4_room_fr.npy', room)
    print('room tone', len(room) / SR, 's, rms dBFS', 20 * np.log10(np.sqrt(np.mean(room ** 2))), flush=True)

    dev = sorted((W / 'data/librispeech/LibriSpeech').glob('dev-*/*/*/*.flac'))
    speakers = sorted({p.parts[-3] for p in dev})
    random.shuffle(speakers)
    tv_spk, ref_spk = set(speakers[:len(speakers) // 2]), set(speakers[len(speakers) // 2:])
    tvdir = W / 'data/r4_tv'
    tvdir.mkdir(exist_ok=True)
    tv = []
    for p in dev:
        if p.parts[-3] in tv_spk:
            out = tvdir / (p.stem + '.wav')
            if not out.exists():
                x, _ = sf.read(p, dtype='int16')
                sf.write(out, x, SR)
            tv.append(str(out))
    (W / 'data/r4_tv_speech.txt').write_text('\n'.join(tv) + '\n')

    refs = []
    trans = {}
    for t in (W / 'data/librispeech/LibriSpeech').glob('dev-*/*/*/*.trans.txt'):
        for line in t.read_text().splitlines():
            k, v = line.split(' ', 1)
            trans[k] = v.lower()
    by_spk = {}
    for p in dev:
        d = sf.info(p).duration
        if p.parts[-3] in ref_spk and 3 <= d <= 10:
            by_spk.setdefault(p.parts[-3], []).append(p)
    for spk, ps in by_spk.items():
        for p in random.sample(ps, min(4, len(ps))):
            refs.append((str(p), trans[p.stem], 'libri'))
    import pyarrow.parquet as pq
    gdir = W / 'data/globe_refs'
    gdir.mkdir(exist_ok=True)
    per_spk = {}
    for shard in sorted((W / 'data/globe').glob('*.parquet')):
        t = pq.read_table(shard, columns=['audio', 'speaker_id', 'transcript', 'accent', 'duration']).to_pylist()
        random.shuffle(t)
        for row in t:
            if not 3 <= row['duration'] <= 10 or per_spk.get(row['speaker_id'], 0) >= 2:
                continue
            per_spk[row['speaker_id']] = per_spk.get(row['speaker_id'], 0) + 1
            out = gdir / f"{row['speaker_id']}_{per_spk[row['speaker_id']]}.wav"
            if not out.exists():
                x, sr = sf.read(io.BytesIO(row['audio']['bytes']), dtype='float32')
                sf.write(out, x, sr)
            refs.append((str(out), row['transcript'], 'globe:' + (row['accent'] or '?').replace('\t', ' ')))
    mdir = W / 'data/mike_refs'
    mdir.mkdir(exist_ok=True)
    for r in labels:
        # Mike's own non-wake speech from the coach sessions (22 Oct): chat and command-only replies.
        if r['session'] in ('coach1', 'coach2') and r['kind'] in ('chat', 'command') and r['end'] - r.get('training_start', r['start']) >= 2 * SR:
            x, _ = sf.read(r['path'], dtype='float32', always_2d=True)
            seg = x[r.get('training_start', r['start']):r['end'], 1]
            seg = seg / max(1e-4, np.abs(seg).max()) * .7
            out = mdir / (r['id'] + '.wav')
            sf.write(out, seg, SR)
            refs.append((str(out), '', 'mike'))
    (W / 'data/r4_refs.tsv').write_text(''.join(f'{a}\t{b}\t{c}\n' for a, b, c in refs))
    from collections import Counter
    print('refs', Counter(c.split(':')[0] for _, _, c in refs), 'GLOBE accents', Counter(c for _, _, c in refs if c.startswith('globe')).most_common(12), flush=True)


if __name__ == '__main__':
    main()
