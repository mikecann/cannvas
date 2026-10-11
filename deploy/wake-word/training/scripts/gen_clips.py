#!/usr/bin/env python3
"""Synthesise wake word clips with dscripka/piper-sample-generator on MPS/CPU.

This is the generation loop from dscripka/piper-sample-generator's
`generate_samples()` (commit f1988a4), reusing its helpers (`slerp`,
`remove_silence`, `audio_float_to_int16`, the 22.05k->16k Kaiser resampler and
the piper_train VITS code), with these changes:

* device: runs on Apple MPS (or CPU) instead of CUDA-only;
* phonemizer: macOS shim `espeak_ctypes.Phonemizer` (same output as
  espeak_phonemizer, which is Linux-only);
* torch.load(weights_only=False): torch>=2.6 defaults to weights_only=True and
  the .pt is a pickled nn.Module;
* variety: every batch draws a random speaker pair per clip, a random SLERP
  weight, length scale, noise scale and noise_w from the given lists, rather
  than cycling speakers in order (the upstream cycle only reaches the first
  ~55 "speaker_1" ids in 50k clips);
* texts are shuffled and cycled; batches are right-padded with phoneme id 1
  ('^') exactly like upstream;
* optional --cut-after PREFIX: synthesise "PREFIX + continuation" and cut each
  clip at the end of PREFIX (from the VITS duration predictor's per-phoneme
  durations) plus a random 0..N ms of the next word, so some positives look like
  a wake phrase followed straight away by a command;
* writes <out-dir>.manifest.tsv (file, text, settings) next to the clip folder.

Output: 16 kHz mono int16 WAVs, silence-trimmed with webrtcvad like upstream.
"""
import argparse
import itertools as it
import json
import os
import random
import sys
import time
import uuid
import wave
from pathlib import Path

import numpy as np
import torch
import torchaudio

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from espeak_ctypes import Phonemizer  # noqa: E402


def load_psg(psg_path):
    """Import dscripka's generate_samples module with the macOS phonemizer."""
    import types
    shim = types.ModuleType("espeak_phonemizer")
    shim.Phonemizer = Phonemizer
    sys.modules["espeak_phonemizer"] = shim
    sys.path.insert(0, str(Path(psg_path).resolve()))
    import generate_samples as gs  # noqa: E402
    from piper_train.vits import commons  # noqa: E402
    return gs, commons


def generate_audio(model, commons, slerp, speaker_1, speaker_2, phoneme_ids, slerp_weight,
                   noise_scale, noise_scale_w, length_scale, device):
    """Same maths as generate_samples.generate_audio, with an explicit device."""
    x = torch.LongTensor(phoneme_ids).to(device)
    x_lengths = torch.LongTensor([len(i) for i in phoneme_ids]).to(device)
    speaker_1 = speaker_1.to(device)
    speaker_2 = speaker_2.to(device)

    x, m_p_orig, logs_p_orig, x_mask = model.enc_p(x, x_lengths)
    emb0 = model.emb_g(speaker_1)
    emb1 = model.emb_g(speaker_2)
    g = slerp(emb0, emb1, slerp_weight).unsqueeze(-1)

    if model.use_sdp:
        logw = model.dp(x, x_mask, g=g, reverse=True, noise_scale=noise_scale_w)
    else:
        logw = model.dp(x, x_mask, g=g)
    w = torch.exp(logw) * x_mask * length_scale
    w_ceil = torch.ceil(w)
    y_lengths = torch.clamp_min(torch.sum(w_ceil, [1, 2]), 1).long()
    y_mask = torch.unsqueeze(commons.sequence_mask(y_lengths, y_lengths.max()), 1).type_as(x_mask)
    attn_mask = torch.unsqueeze(x_mask, 2) * torch.unsqueeze(y_mask, -1)
    attn = commons.generate_path(w_ceil, attn_mask)
    m_p = torch.matmul(attn.squeeze(1), m_p_orig.transpose(1, 2)).transpose(1, 2)
    logs_p = torch.matmul(attn.squeeze(1), logs_p_orig.transpose(1, 2)).transpose(1, 2)
    z_p = m_p + torch.randn_like(m_p) * torch.exp(logs_p) * noise_scale
    z = model.flow(z_p, y_mask, g=g, reverse=True)
    o = model.dec((z * y_mask), g=g)
    return o, w_ceil


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--texts", required=True, help="text file, one phrase per line")
    ap.add_argument("--n", type=int, required=True, help="number of clips wanted in out-dir")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--psg", required=True, help="path to dscripka/piper-sample-generator")
    ap.add_argument("--model", required=True, help="path to en_US-libritts_r-medium.pt")
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--max-speakers", type=int, default=None)
    ap.add_argument("--slerp-weights", type=float, nargs="+", default=[0.0, 0.25, 0.5, 0.75, 1.0])
    ap.add_argument("--length-scales", type=float, nargs="+", default=[0.75, 0.85, 1.0, 1.15, 1.3])
    ap.add_argument("--noise-scales", type=float, nargs="+", default=[0.667, 0.8, 0.98])
    ap.add_argument("--noise-scale-ws", type=float, nargs="+", default=[0.8, 0.98])
    ap.add_argument("--cut-after", default=None, help="cut clips right after this prefix phrase")
    ap.add_argument("--cut-extra-ms", type=float, nargs=2, default=[0, 120],
                    help="random amount of the following word kept after the cut")
    args = ap.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    gs, commons = load_psg(args.psg)
    device = torch.device(args.device)
    model = torch.load(args.model, map_location="cpu", weights_only=False)
    model.eval()
    model.to(device)

    with open(f"{args.model}.json", "r", encoding="utf-8") as f:
        config = json.load(f)
    num_speakers = config["num_speakers"]
    if args.max_speakers:
        num_speakers = min(num_speakers, args.max_speakers)
    phonemizer = Phonemizer(config["espeak"]["voice"])

    resampler = torchaudio.transforms.Resample(
        22050, 16000, lowpass_filter_width=64, rolloff=0.9475937167399596,
        resampling_method="sinc_interp_kaiser", beta=14.769656459379492)

    texts = [t.strip() for t in open(args.texts, encoding="utf-8") if t.strip()]
    random.shuffle(texts)
    phon_cache = {}

    def ids_for(t):
        if t not in phon_cache:
            phon_cache[t] = gs.get_phonemes(phonemizer, config, t, False)
        return phon_cache[t]

    prefix_ids = None
    if args.cut_after:
        prefix_ids = ids_for(args.cut_after)[:-1]  # drop the end-of-utterance '$'
        bad = [t for t in texts if ids_for(t)[:len(prefix_ids)] != prefix_ids]
        if bad:
            print(f"dropping {len(bad)} texts whose phonemes don't start with the prefix: {bad[:5]}")
            texts = [t for t in texts if t not in bad]

    text_iter = it.cycle(texts)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    have = len([p for p in out_dir.iterdir() if p.suffix == ".wav"])
    todo = args.n - have
    print(f"{have} clips exist in {out_dir}, generating {max(todo, 0)} more", flush=True)
    manifest = open(out_dir.parent / f"{out_dir.name}.manifest.tsv", "a", encoding="utf-8")
    t0 = time.time()
    done = 0
    n_batches = 0
    bs = args.batch_size
    while done < todo:
        n_b = min(bs, todo - done)
        batch_texts = [next(text_iter) for _ in range(n_b)]
        ids = [ids_for(t) for t in batch_texts]
        max_len = max(len(i) for i in ids)
        ids = [i + [1] * (max_len - len(i)) for i in ids]  # pad with '^' like upstream

        s1 = torch.LongTensor(np.random.randint(0, num_speakers, n_b))
        s2 = torch.LongTensor(np.random.randint(0, num_speakers, n_b))
        sw = random.choice(args.slerp_weights)
        ls = random.choice(args.length_scales)
        ns = random.choice(args.noise_scales)
        nw = random.choice(args.noise_scale_ws)
        with torch.no_grad():
            audio, w_ceil = generate_audio(model, commons, gs.slerp, s1, s2, ids, sw, ns, nw, ls, device)
            audio = resampler(audio.float().cpu()).numpy()
            w_ceil = w_ceil.cpu().numpy()
        if device.type == "mps":
            torch.mps.empty_cache()
        audio_int16 = gs.audio_float_to_int16(audio)
        for k in range(n_b):
            a = audio_int16[k].flatten()
            if prefix_ids is not None:
                cut = int(w_ceil[k, 0, :len(prefix_ids)].sum() * 256 * 16000 / 22050)
                cut += int(random.uniform(*args.cut_extra_ms) * 16)
                a = a[:cut]
            clip = gs.remove_silence(a)
            if clip.shape[0] < 4000:  # degenerate output (< 0.25 s): skip
                continue
            fname = f"{uuid.uuid4().hex}.wav"
            manifest.write(f"{fname}\t{batch_texts[k]}\tsw={sw} ls={ls} ns={ns} nw={nw}\n")
            with wave.open(str(out_dir / fname), "wb") as w:
                w.setframerate(16000)
                w.setsampwidth(2)
                w.setnchannels(1)
                w.writeframes(clip.tobytes())
            done += 1
        n_batches += 1
        if n_batches % 25 == 0:
            rate = done / (time.time() - t0)
            print(f"{done}/{todo} clips, {rate:.1f} clips/s, eta {(todo - done) / max(rate, 1e-6) / 60:.1f} min",
                  flush=True)
    manifest.close()
    print(f"done: {done} clips in {(time.time() - t0) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
