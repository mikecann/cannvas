"""Rebuild documented inputs without relying on the deleted /tmp work dir."""
import concurrent.futures as cf
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

W = Path(__file__).resolve().parents[1]


def fetch(job):
    url, path = job
    p = W / path
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists() and p.stat().st_size > 100:
        return str(path), p.stat().st_size
    tmp = str(p) + '.part'
    subprocess.run(['curl', '-fsSL', '--retry', '5', '-o', tmp, url], check=True)
    Path(tmp).replace(p)
    return str(path), p.stat().st_size


def main():
    jobs = []
    for name in ('openwakeword_features_ACAV100M_2000_hrs_16bit.npy','validation_set_features.npy'):
        jobs.append(('https://huggingface.co/datasets/davidscripka/openwakeword_features/resolve/main/' + name, 'data/features/' + name))
    api = 'https://huggingface.co/api/datasets/davidscripka/MIT_environmental_impulse_responses/tree/main/16khz'
    for item in json.load(urllib.request.urlopen(api)):
        if item['path'].endswith('.wav'):
            jobs.append(('https://huggingface.co/datasets/davidscripka/MIT_environmental_impulse_responses/resolve/main/' + item['path'], 'data/mit_rirs/' + Path(item['path']).name))
    for n in ('09', '02', '05'):
        jobs.append((f'https://huggingface.co/datasets/agkphysics/AudioSet/resolve/main/data/bal_train/{n}.parquet', f'data/audioset_parquet/{n}.parquet'))
    jobs += [
        ('https://github.com/rhasspy/piper-sample-generator/releases/download/v2.0.0/en_US-libritts_r-medium.pt', 'data/piper_models/en_US-libritts_r-medium.pt'),
        ('https://raw.githubusercontent.com/rhasspy/piper-sample-generator/2971426/models/en_US-libritts_r-medium.pt.json', 'data/piper_models/en_US-libritts_r-medium.pt.json'),
    ]
    for suffix in ('', '.json'):
        jobs.append(('https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/vctk/medium/en_GB-vctk-medium.onnx' + suffix, 'data/piper_models/en_GB-vctk-medium.onnx' + suffix))
    for split in ('test-clean', 'test-other'):
        jobs.append((f'https://www.openslr.org/resources/12/{split}.tar.gz', f'data/librispeech/{split}.tar.gz'))
    with cf.ThreadPoolExecutor(12) as pool:
        for result in pool.map(fetch, jobs):
            print(result, flush=True)
    checks = {}
    for _, path in jobs:
        p = W / path
        h = hashlib.sha256()
        with p.open('rb') as f:
            for chunk in iter(lambda: f.read(8 << 20), b''):
                h.update(chunk)
        checks[path] = h.hexdigest()
    (W / 'data/download_sha256.json').write_text(json.dumps(checks, indent=2))


if __name__ == '__main__':
    main()
