#!/usr/bin/env python3
"""Kokoro-82M clips for round 4: a second TTS family next to Piper/VITS.

openWakeWord's stock models were trained on two different TTS systems (WaveGlow
and VITS). Rounds 1-3 only had Piper (VITS). Kokoro is StyleTTS2-based, with 28
English voices (American and British); each clip blends 1-3 of them with random
weights so most clips are a new voice. "--cut-after" makes "hey canvas <command>"
positives cut 0-150 ms after "canvas", using Kokoro's own word timestamps.

Output: 16 kHz mono int16 WAVs, leading/trailing silence trimmed, plus a manifest.
"""
import argparse
import random
import uuid
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torchaudio

VOICES = {
    'a': ['af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river',
          'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx',
          'am_puck', 'am_santa'],
    'b': ['bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'],
}


def trim(x, sr):
    e = np.convolve(np.abs(x), np.ones(int(.01 * sr)) / int(.01 * sr), 'same')
    on = np.where(e > max(e.max() * .03, 1e-4))[0]
    if not len(on):
        return x[:0]
    a, b = max(0, on[0] - int(.05 * sr)), min(len(x), on[-1] + int(.08 * sr))
    return x[a:b]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--texts', required=True)
    ap.add_argument('--n', type=int, required=True)
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--cut-after', default=None, help='last word of the prefix to keep, e.g. canvas')
    a = ap.parse_args()
    random.seed(a.seed); torch.manual_seed(a.seed)
    out = Path(a.out_dir); out.mkdir(parents=True, exist_ok=True)
    have = len(list(out.glob('*.wav')))
    texts = [t for t in Path(a.texts).read_text().splitlines() if t.strip()]
    from kokoro import KModel, KPipeline
    model = KModel().to('cuda').eval()
    pipes = {k: KPipeline(lang_code=k, model=model) for k in VOICES}
    packs = {v: pipes[k].load_single_voice(v) for k in VOICES for v in VOICES[k]}
    manifest = open(str(out) + f'.manifest.{a.seed}.tsv', 'a')
    made = 0
    while have + made < a.n:
        lang = 'b' if random.random() < .45 else 'a'
        names = random.sample(VOICES[lang], random.choice([1, 2, 2, 3]))
        w = np.random.dirichlet(np.ones(len(names)))
        voice = sum(float(wi) * packs[n] for wi, n in zip(w, names))
        speed = random.uniform(.8, 1.25)
        text = random.choice(texts)
        try:
            results = list(pipes[lang](text, voice=voice, speed=speed))
        except Exception as e:  # odd phonemes for an odd adversarial text
            print('skip', text, e, flush=True)
            continue
        if not results or results[0].audio is None:
            continue
        r = results[0]
        x = r.audio.cpu().numpy().astype(np.float32)
        if a.cut_after:
            ends = [t.end_ts for t in (r.tokens or []) if t.text.strip(',.!?').lower() == a.cut_after and t.end_ts]
            if not ends:
                continue
            x = x[:int((ends[0] + random.uniform(0, .15)) * 24000)]
        y = torchaudio.functional.resample(torch.from_numpy(x), 24000, 16000).numpy()
        y = trim(y, 16000)
        if not .25 < len(y) / 16000 < 4:
            continue
        name = uuid.uuid4().hex + '.wav'
        sf.write(out / name, np.clip(y / max(1e-4, np.abs(y).max()) * .9 * 32767, -32768, 32767).astype(np.int16), 16000)
        manifest.write(f'{name}\t{text}\t{"+".join(names)}\t{speed:.2f}\n')
        made += 1
        if made % 1000 == 0:
            print(out.name, have + made, '/', a.n, flush=True)
    print('DONE', out, have + made, flush=True)


if __name__ == '__main__':
    main()
