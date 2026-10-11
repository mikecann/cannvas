#!/bin/sh
# run2 positives: 70k plain "hey canvas" + 30k "hey canvas <command>" cut after the wake phrase.
W=$1; R=$2; D=$R/hey_canvas
PY="$W/venv/bin/python -I $W/scripts/gen_clips.py --psg $W/src/piper-sample-generator --model $W/data/piper_models/en_US-libritts_r-medium.pt --device mps"
WIDE="--length-scales 0.7 0.8 0.9 1.0 1.1 1.2 1.35 --noise-scales 0.667 0.8 0.9 1.0 --noise-scale-ws 0.7 0.85 1.0"
$PY --texts $R/positive.txt --n 70000 --out-dir $D/positive_train --batch-size 64 --seed 31 $WIDE &&
$PY --texts $R/positive_cont.txt --n 100000 --out-dir $D/positive_train --batch-size 48 --seed 32 $WIDE --cut-after "hey canvas" --cut-extra-ms 0 150
echo POSDONE
