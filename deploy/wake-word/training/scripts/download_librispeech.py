"""Fetch the official OpenSLR mirror using parallel byte ranges, then extract."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import urllib.request

W = Path(__file__).resolve().parents[1]
root = W / 'data/librispeech'
for split in ('test-clean','test-other'):
    out = root / (split + '.tar.gz')
    if not out.exists():
        url = f'https://openslr.elda.org/resources/12/{split}.tar.gz'
        req = urllib.request.Request(url, method='HEAD')
        size = int(urllib.request.urlopen(req).headers['Content-Length'])
        step = (size + 7) // 8
        def part(k):
            p = root / (split + f'.range{k}')
            start, end = k * step, min(size, (k + 1) * step) - 1
            if not p.exists() or p.stat().st_size != end - start + 1:
                subprocess.run(['curl','-fsSL','--retry','5','--range',f'{start}-{end}','-o',str(p),url],check=True)
            assert p.stat().st_size == end - start + 1
            return p
        with ThreadPoolExecutor(8) as pool:
            parts = list(pool.map(part, range(8)))
        tmp = out.with_suffix('.assembling')
        with tmp.open('wb') as f:
            for p in parts:
                f.write(p.read_bytes())
        assert tmp.stat().st_size == size
        tmp.replace(out)
        for p in parts:
            p.unlink()
    subprocess.run(['tar','-xzf',str(out),'-C',str(root)],check=True)
    print('READY',split,flush=True)
(root / 'READY').touch()
