#!/usr/bin/env python3
"""Prepare background audio for augmentation (16 kHz mono int16 WAV).

audioset: decode the FLAC clips embedded in agkphysics/AudioSet bal_train
          parquet shards (the notebook's bal_train09.tar is now parquet).
fma:      pull N random tracks out of fma_small.zip with HTTP range requests
          (remotezip), the same source the rudraml/fma loader streams from,
          and convert with ffmpeg.
"""
import argparse
import io
import os
import random
import subprocess
import tempfile

import numpy as np
import pyarrow.parquet as pq
import soundfile as sf
import soxr
from scipy.io import wavfile


def to_16k_int16(data, sr):
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != 16000:
        data = soxr.resample(data, sr, 16000)
    return (np.clip(data, -1, 1) * 32767).astype(np.int16)


def audioset(parquets, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    n = 0
    for p in parquets:
        f = pq.ParquetFile(p)
        for rg in range(f.metadata.num_row_groups):
            t = f.read_row_group(rg, columns=["video_id", "audio"])
            for vid, a in zip(t.column("video_id").to_pylist(), t.column("audio").to_pylist()):
                try:
                    data, sr = sf.read(io.BytesIO(a["bytes"]), dtype="float32")
                except Exception as e:  # noqa: BLE001
                    print("skip", vid, e)
                    continue
                if len(data) < sr:  # < 1 s
                    continue
                wavfile.write(os.path.join(out_dir, f"{vid}.wav"), 16000, to_16k_int16(data, sr))
                n += 1
        print(p, "->", n, "clips so far", flush=True)


def fma(n_tracks, out_dir, seed=0, workers=16):
    """Fetch tracks with parallel range requests (server latency is ~2 s per request)."""
    from concurrent.futures import ThreadPoolExecutor
    from remotezip import RemoteZip
    os.makedirs(out_dir, exist_ok=True)
    url = "https://os.unil.cloud.switch.ch/fma/fma_small.zip"
    with RemoteZip(url) as z:
        names = [i.filename for i in z.infolist() if i.filename.endswith(".mp3")]
    print(len(names), "mp3s in fma_small.zip", flush=True)
    random.Random(seed).shuffle(names)
    names = names[:int(n_tracks * 1.1)]  # a few FMA-small tracks are broken/short

    def work(chunk):
        ok = 0
        with RemoteZip(url) as z, tempfile.TemporaryDirectory() as td:
            for name in chunk:
                out = os.path.join(out_dir, os.path.basename(name).replace(".mp3", ".wav"))
                if os.path.exists(out):
                    ok += 1
                    continue
                src = os.path.join(td, "x.mp3")
                try:
                    with open(src, "wb") as fh:
                        fh.write(z.read(name))
                except Exception as e:  # noqa: BLE001
                    print("skip", name, e, flush=True)
                    continue
                r = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", src,
                                    "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", out])
                if r.returncode != 0 or os.path.getsize(out) < 16000 * 2 * 5:
                    if os.path.exists(out):
                        os.remove(out)
                    continue
                ok += 1
        return ok

    chunks = [names[i::workers] for i in range(workers)]
    with ThreadPoolExecutor(workers) as ex:
        total = sum(ex.map(work, chunks))
    print("fma done", total, flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["audioset", "fma"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--parquets", nargs="*", default=[])
    ap.add_argument("--n", type=int, default=600)
    a = ap.parse_args()
    if a.what == "audioset":
        audioset(a.parquets, a.out)
    else:
        fma(a.n, a.out)
