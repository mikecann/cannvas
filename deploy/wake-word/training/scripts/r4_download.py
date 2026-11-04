#!/usr/bin/env python3
"""Round 4 public downloads (pod only). Same sources and hashes as round 3b where shared, plus:
LibriSpeech dev-clean/dev-other (voice references and TV-like interference), train-other-500
(500 h of speech negatives, far-field augmented) and GLOBE (CC0 Common Voice subset with accent
labels, voice references). Writes data/download_sha256.json when everything is in."""
import concurrent.futures as cf
import hashlib
import json
import subprocess
import urllib.request
from pathlib import Path
import os

W = Path(os.environ.get('W', Path(__file__).resolve().parents[1]))
HF = 'https://huggingface.co/datasets/'


def fetch(job):
    url, path, ranges = job
    p = W / path
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists() and p.stat().st_size > 100:
        return str(path)
    if ranges:
        size = int(urllib.request.urlopen(urllib.request.Request(url, method='HEAD')).headers['Content-Length'])
        step = (size + ranges - 1) // ranges

        def part(k):
            q = Path(str(p) + f'.r{k}')
            a, b = k * step, min(size, (k + 1) * step) - 1
            if not q.exists() or q.stat().st_size != b - a + 1:
                subprocess.run(['curl', '-fsSL', '--retry', '8', '--range', f'{a}-{b}', '-o', str(q), url], check=True)
            return q
        with cf.ThreadPoolExecutor(ranges) as pool:
            parts = list(pool.map(part, range(ranges)))
        with open(str(p) + '.part', 'wb') as f:
            for q in parts:
                f.write(q.read_bytes()); q.unlink()
    else:
        subprocess.run(['curl', '-fsSL', '--retry', '8', '-o', str(p) + '.part', url], check=True)
    Path(str(p) + '.part').replace(p)
    return str(path)


def main():
    jobs = [(HF + 'davidscripka/openwakeword_features/resolve/main/' + n, 'data/features/' + n, 0)
            for n in ('openwakeword_features_ACAV100M_2000_hrs_16bit.npy', 'validation_set_features.npy')]
    api = HF.replace('/datasets/', '/api/datasets/') + 'davidscripka/MIT_environmental_impulse_responses/tree/main/16khz'
    for item in json.load(urllib.request.urlopen(api)):
        if item['path'].endswith('.wav'):
            jobs.append((HF + 'davidscripka/MIT_environmental_impulse_responses/resolve/main/' + item['path'], 'data/mit_rirs/' + Path(item['path']).name, 0))
    for n in ('09', '02', '05'):
        jobs.append((HF + f'agkphysics/AudioSet/resolve/main/data/bal_train/{n}.parquet', f'data/audioset_parquet/{n}.parquet', 0))
    jobs += [
        ('https://github.com/rhasspy/piper-sample-generator/releases/download/v2.0.0/en_US-libritts_r-medium.pt', 'data/piper_models/en_US-libritts_r-medium.pt', 0),
        ('https://raw.githubusercontent.com/rhasspy/piper-sample-generator/2971426/models/en_US-libritts_r-medium.pt.json', 'data/piper_models/en_US-libritts_r-medium.pt.json', 0),
    ]
    for suffix in ('', '.json'):
        jobs.append(('https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/vctk/medium/en_GB-vctk-medium.onnx' + suffix, 'data/piper_models/en_GB-vctk-medium.onnx' + suffix, 0))
    for split in ('dev-clean', 'dev-other', 'train-other-500'):
        jobs.append((f'https://openslr.elda.org/resources/12/{split}.tar.gz', f'data/librispeech/{split}.tar.gz', 8 if 'train' in split else 0))
    for shard in ('test-00000-of-00001', 'val-00000-of-00001', 'train-00000-of-00108', 'train-00001-of-00108'):
        jobs.append((HF + f'MushanW/GLOBE/resolve/main/data/{shard}.parquet', f'data/globe/{shard}.parquet', 0))
    with cf.ThreadPoolExecutor(10) as pool:
        for r in pool.map(fetch, jobs):
            print('got', r, flush=True)
    for split in ('dev-clean', 'dev-other', 'train-other-500'):
        marker = W / f'data/librispeech/.{split}.extracted'
        if not marker.exists():
            subprocess.run(['tar', '-xzf', str(W / f'data/librispeech/{split}.tar.gz'), '-C', str(W / 'data/librispeech')], check=True)
            marker.touch()
            (W / f'data/librispeech/{split}.tar.gz').unlink()
    (W / 'data/librispeech/READY').touch()
    print('DOWNLOADS_READY', flush=True)
    sums = {}
    for _, path, _ in jobs:
        p = W / path
        if p.exists():
            h = hashlib.sha256()
            with p.open('rb') as f:
                for chunk in iter(lambda: f.read(8 << 20), b''):
                    h.update(chunk)
            sums[path] = h.hexdigest()
    (W / 'data/download_sha256.json').write_text(json.dumps(sums, indent=1))


if __name__ == '__main__':
    main()
