#!/bin/sh
W=$1; R=$2; D=$R/hey_canvas
PY="$W/venv/bin/python -I $W/scripts/gen_clips.py --psg $W/src/piper-sample-generator --model $W/data/piper_models/en_US-libritts_r-medium.pt --device mps"
WIDE="--length-scales 0.7 0.8 0.9 1.0 1.1 1.2 1.35 --noise-scales 0.667 0.8 0.9 1.0 --noise-scale-ws 0.7 0.85 1.0"
$PY --texts $R/negative_test.txt --n 2000 --out-dir $D/negative_test --batch-size 32 --seed 33 $WIDE &&
$PY --texts $R/negative_train.txt --n 60000 --out-dir $D/negative_train --batch-size 32 --seed 34 $WIDE
echo NEGDONE
