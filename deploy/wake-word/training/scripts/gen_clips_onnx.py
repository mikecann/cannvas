#!/usr/bin/env python3
"""Synthesise clips with a multi-speaker Piper .onnx voice (used for en_GB-vctk-medium).

Same output conventions as gen_clips.py (16 kHz int16 WAV, webrtcvad silence
trim from dscripka/piper-sample-generator, <out-dir>.manifest.tsv), one clip per
inference with a random speaker / length scale / noise scales per clip.

--cut-after works like gen_clips.py: the graph's Ceil output (per-phoneme
durations in 256-sample frames) is exposed as an extra output so clips can be
cut at the end of the prefix phrase.
"""
import argparse
import multiprocessing as mp
import os
import random
import sys
import uuid
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def build_session(onnx_path, threads):
    import onnx
    import onnxruntime as ort
    m = onnx.load(onnx_path)
    ceil = [n.output[0] for n in m.graph.node if n.op_type == "Ceil"]
    assert len(ceil) == 1, ceil
    m.graph.output.append(onnx.helper.make_tensor_value_info(ceil[0], onnx.TensorProto.FLOAT, None))
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    return ort.InferenceSession(m.SerializeToString(), so, providers=["CPUExecutionProvider"])


def piper_ids(phonemes, id_map):
    """piper-phonemize convention: ^ _ p _ p _ ... $"""
    ids = list(id_map["^"]) + list(id_map["_"])
    for ph in phonemes:
        if ph in id_map:
            ids += list(id_map[ph]) + list(id_map["_"])
    return ids + list(id_map["$"])


def worker(job):
    (wid, n, texts, a) = job
    import json
    import unicodedata
    import torch
    import torchaudio
    from espeak_ctypes import Phonemizer
    sys.path.insert(0, a["psg"])
    import types
    shim = types.ModuleType("espeak_phonemizer")
    shim.Phonemizer = Phonemizer
    sys.modules["espeak_phonemizer"] = shim
    import generate_samples as gs

    rng = random.Random(a["seed"] * 1000 + wid)
    cfg = json.load(open(a["voice"] + ".json"))
    id_map = cfg["phoneme_id_map"]
    ph = Phonemizer(cfg["espeak"]["voice"])
    sess = build_session(a["voice"], 1)
    resampler = torchaudio.transforms.Resample(
        22050, 16000, lowpass_filter_width=64, rolloff=0.9475937167399596,
        resampling_method="sinc_interp_kaiser", beta=14.769656459379492)
    cache = {}

    def ids_for(t):
        if t not in cache:
            cache[t] = piper_ids(list(unicodedata.normalize("NFD", ph.phonemize(t))), id_map)
        return cache[t]

    prefix = ids_for(a["cut_after"])[:-1] if a["cut_after"] else None
    if prefix:
        texts = [t for t in texts if ids_for(t)[:len(prefix)] == prefix]
    out_dir = Path(a["out_dir"])
    lines = []
    done = 0
    while done < n:
        t = rng.choice(texts)
        ids = ids_for(t)
        sid = rng.randrange(cfg["num_speakers"])
        ls, ns, nw = rng.choice(a["length_scales"]), rng.choice(a["noise_scales"]), rng.choice(a["noise_scale_ws"])
        audio, dur = sess.run(None, {
            "input": np.array([ids], dtype=np.int64),
            "input_lengths": np.array([len(ids)], dtype=np.int64),
            "scales": np.array([ns, ls, nw], dtype=np.float32),
            "sid": np.array([sid], dtype=np.int64)})
        audio = resampler(torch.from_numpy(audio.reshape(1, -1).astype(np.float32))).numpy()
        a16 = gs.audio_float_to_int16(audio).flatten()
        if prefix:
            cut = int(np.asarray(dur).reshape(-1)[:len(prefix)].sum() * 256 * 16000 / 22050)
            cut += int(rng.uniform(*a["cut_extra_ms"]) * 16)
            a16 = a16[:cut]
        clip = gs.remove_silence(a16)
        if clip.shape[0] < 4000:
            continue
        fname = f"{uuid.uuid4().hex}.wav"
        with wave.open(str(out_dir / fname), "wb") as w:
            w.setframerate(16000)
            w.setsampwidth(2)
            w.setnchannels(1)
            w.writeframes(clip.tobytes())
        lines.append(f"{fname}\t{t}\tvctk sid={sid} ls={ls} ns={ns} nw={nw}\n")
        done += 1
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--texts", required=True)
    ap.add_argument("--n", type=int, required=True, help="clips to add")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--voice", required=True, help="Piper .onnx voice (with .onnx.json beside it)")
    ap.add_argument("--psg", required=True)
    ap.add_argument("--workers", type=int, default=14)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--length-scales", type=float, nargs="+", default=[1.0, 1.15, 1.3, 1.45, 1.6])
    ap.add_argument("--noise-scales", type=float, nargs="+", default=[0.333, 0.5, 0.667, 0.8])
    ap.add_argument("--noise-scale-ws", type=float, nargs="+", default=[0.333, 0.6, 0.8])
    ap.add_argument("--cut-after", default=None)
    ap.add_argument("--cut-extra-ms", type=float, nargs=2, default=[0, 150])
    a = vars(ap.parse_args())
    a["psg"] = str(Path(a["psg"]).resolve())
    texts = [t.strip() for t in open(a["texts"], encoding="utf-8") if t.strip()]
    os.makedirs(a["out_dir"], exist_ok=True)
    per = [a["n"] // a["workers"] + (1 if i < a["n"] % a["workers"] else 0) for i in range(a["workers"])]
    with mp.get_context("spawn").Pool(a["workers"]) as pool:
        results = pool.map(worker, [(i, per[i], texts, a) for i in range(a["workers"])])
    out = Path(a["out_dir"])
    with open(out.parent / f"{out.name}.manifest.tsv", "a", encoding="utf-8") as f:
        for lines in results:
            f.writelines(lines)
    print("done", sum(len(r) for r in results), flush=True)


if __name__ == "__main__":
    main()
