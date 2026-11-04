#!/usr/bin/env python3
"""Zero-shot voice-cloned clips (F5-TTS) for round 4.

Piper and Kokoro voices come from a few hundred studio-ish speakers. Cloning from
real recordings adds real timbres and accents: LibriSpeech dev speakers, GLOBE
(Common Voice, with Australian, British, NZ, Irish and other accents) and,
in a separate output dir, Mike's own voice from coach-session commands and chat
(never from a wake try, and never from the live recording, which is held out).

refs.tsv lines: <wav path>\t<transcript or empty>\t<group>
Each clip: a random reference, a random text, speed 0.85-1.2, a random seed.
A Whisper pass drops failed generations (silence, babble, > 6 words), with
a deliberately loose test so mumbled or accented takes are kept.
"""
import argparse
import random
import time
import uuid
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torchaudio


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--refs', required=True)
    ap.add_argument('--group', default=None, help='only refs of this group')
    ap.add_argument('--texts', required=True)
    ap.add_argument('--n', type=int, required=True)
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--max-minutes', type=float, default=120)
    a = ap.parse_args()
    random.seed(a.seed)
    t0 = time.time()
    out = Path(a.out_dir); out.mkdir(parents=True, exist_ok=True)
    have = len(list(out.glob('*.wav')))
    refs = [l.split('\t') for l in Path(a.refs).read_text().splitlines() if l.strip()]
    refs = [r for r in refs if a.group is None or r[2] == a.group]
    texts = [t for t in Path(a.texts).read_text().splitlines() if t.strip()]
    assert refs and texts
    from f5_tts.api import F5TTS
    tts = F5TTS(model='F5TTS_v1_Base', device='cuda')
    manifest = open(str(out) + f'.manifest.{a.seed}.tsv', 'a')
    made = tried = 0
    while have + made < a.n and time.time() - t0 < a.max_minutes * 60:
        path, ref_text, group = random.choice(refs)
        text = random.choice(texts)
        tried += 1
        try:
            wav, sr, _ = tts.infer(ref_file=path, ref_text=ref_text, gen_text=text, nfe_step=16,
                                   speed=random.uniform(.85, 1.2), seed=random.randrange(1 << 30),
                                   show_info=lambda *x: None, remove_silence=False)
        except Exception as e:
            print('fail', Path(path).name, e, flush=True)
            continue
        y = torchaudio.functional.resample(torch.from_numpy(np.asarray(wav, np.float32)), sr, 16000).numpy()
        e = np.abs(y)
        on = np.where(e > max(e.max() * .03, 1e-4))[0]
        if not len(on):
            continue
        y = y[max(0, on[0] - 800):on[-1] + 1280]
        if not .3 < len(y) / 16000 < 3.5:
            continue
        name = uuid.uuid4().hex + '.wav'
        sf.write(out / name, np.clip(y / max(1e-4, np.abs(y).max()) * .9 * 32767, -32768, 32767).astype(np.int16), 16000)
        # F5's own Whisper (large-v3-turbo, transformers on the GPU; faster-whisper's cuDNN clashes with torch's).
        heard = (tts.transcribe(str(out / name), language='en') or '').strip()
        if not heard or len(heard.split()) > 6:
            (out / name).unlink()
            continue
        manifest.write(f'{name}\t{text}\t{group}\t{Path(path).name}\t{heard}\n')
        made += 1
        if made % 500 == 0:
            print(out.name, have + made, '/', a.n, f'kept {made}/{tried}', f'{(time.time() - t0) / 60:.1f} min', flush=True)
    print('DONE', out, have + made, f'kept {made}/{tried}', flush=True)


if __name__ == '__main__':
    main()
