#!/usr/bin/env python3
"""Text lists for round 4 TTS, in $W/runs/r4/texts.

pos_plain    "Hey Canvas" with different punctuation (it changes the prosody of every TTS)
pos_cont     "Hey Canvas, <command>", cut after "canvas" by the generators
neg_train / neg_test   make_texts.py: openWakeWord's adversarial texts + 30% custom near misses
neg_custom   the custom near misses alone (for Kokoro and F5, which get fewer clips)
hard_NN      "<near miss> <command>", cut after the near miss, so negatives also look like
             a phrase followed straight away by a command
"""
import os
import subprocess
import sys
from pathlib import Path
import yaml

W = Path(os.environ.get('W', Path(__file__).resolve().parents[1]))
T = W / 'runs/r4/texts'
EXTRA_PREFIXES = ['hey Candace', 'can you', 'the camera', 'hey Kansas', 'the canvas']


def main():
    T.mkdir(parents=True, exist_ok=True)
    cfg = W / 'configs/hey_canvas_r4.yml'
    subprocess.run([sys.executable, '-I', str(W / 'scripts/make_texts.py'), '--config', str(cfg), '--out-dir', str(T),
                    '--custom-share', '.3', '--seed', '4'], check=True)
    (T / 'negative_train.txt').rename(T / 'neg_train.txt')
    (T / 'negative_test.txt').rename(T / 'neg_test.txt')
    custom = yaml.safe_load(cfg.read_text())['custom_negative_phrases']
    (T / 'neg_custom.txt').write_text('\n'.join(custom) + '\n')
    plain = ['hey canvas', 'Hey Canvas.', 'Hey, Canvas.', 'Hey Canvas!', 'Hey canvas?', 'Hey Canvas,', 'Hey Canvas...', 'hey, canvas!']
    (T / 'pos_plain.txt').write_text('\n'.join(plain) + '\n')
    cont = (W / 'configs/continuations.txt').read_text().splitlines()
    # Piper's cut finds the prefix's phonemes, so its texts keep the bare prefix; Kokoro cuts on word timestamps.
    (T / 'pos_cont.txt').write_text('\n'.join('hey canvas ' + c for c in cont) + '\n')
    (T / 'pos_cont_k.txt').write_text('\n'.join(p + ' ' + c for c in cont for p in ('hey canvas', 'Hey Canvas,')) + '\n')
    prefixes = (W / 'configs/hard_prefixes.txt').read_text().splitlines() + EXTRA_PREFIXES
    seen = []
    for p in prefixes:
        if p.lower() in seen:
            continue
        seen.append(p.lower())
        sep = ', ' if p.endswith('can you') else ' '
        (T / f'hard_{len(seen) - 1:02d}.txt').write_text('\n'.join(p + sep + c for c in cont) + '\n')
        (T / f'hard_{len(seen) - 1:02d}.prefix').write_text(p)
    print('texts in', T, len(seen), 'hard prefixes')


if __name__ == '__main__':
    main()
