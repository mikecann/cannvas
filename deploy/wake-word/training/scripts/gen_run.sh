#!/bin/sh
# Usage: gen_run.sh <work dir> <run dir> ; synthesises the four clip sets for a run on MPS.
W=$1; R=$2; D=$R/hey_canvas
PY="$W/venv/bin/python -I $W/scripts/gen_clips.py --psg $W/src/piper-sample-generator --model $W/data/piper_models/en_US-libritts_r-medium.pt --device mps"
( $PY --texts $R/positive.txt --n 2000 --out-dir $D/positive_test --batch-size 64 --seed 11 &&
  $PY --texts $R/positive.txt --n 50000 --out-dir $D/positive_train --batch-size 64 --seed 12 ) > $W/logs/gen_pos.log 2>&1 &
( $PY --texts $R/negative_test.txt --n 2000 --out-dir $D/negative_test --batch-size 32 --seed 13 &&
  $PY --texts $R/negative_train.txt --n 50000 --out-dir $D/negative_train --batch-size 32 --seed 14 ) > $W/logs/gen_neg.log 2>&1 &
wait
echo ALLDONE >> $W/logs/gen_pos.log
