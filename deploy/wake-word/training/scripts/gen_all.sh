#!/bin/sh
# Regenerate all run 1-3 TTS clips used by the shipped model (same seeds and settings as the README recipe).
W=$1
PSG=$W/src/piper-sample-generator
LIB="$W/venv/bin/python -I $W/scripts/gen_clips.py --psg $PSG --model $W/data/piper_models/en_US-libritts_r-medium.pt --device mps"
WIDE="--length-scales 0.7 0.8 0.9 1.0 1.1 1.2 1.35 --noise-scales 0.667 0.8 0.9 1.0 --noise-scale-ws 0.7 0.85 1.0"
VC="$W/venv/bin/python -I $W/scripts/gen_clips_onnx.py --psg $PSG --voice $W/data/piper_models/en_GB-vctk-medium.onnx --workers 12"
R1=$W/runs/run1; R2=$W/runs/run2; R3=$W/runs/run3
(
  $LIB --texts $R1/positive.txt --n 2000 --out-dir $R1/hey_canvas/positive_test --batch-size 64 --seed 11 &&
  $LIB --texts $R2/positive.txt --n 70000 --out-dir $R2/hey_canvas/positive_train --batch-size 64 --seed 31 $WIDE &&
  $LIB --texts $R2/positive_cont.txt --n 100000 --out-dir $R2/hey_canvas/positive_train --batch-size 48 --seed 32 $WIDE --cut-after "hey canvas" --cut-extra-ms 0 150
  echo CHAIN_A_DONE
) > $W/logs/gen_a.log 2>&1 &
(
  $LIB --texts $R2/negative_test.txt --n 2000 --out-dir $R2/hey_canvas/negative_test --batch-size 32 --seed 33 $WIDE &&
  $LIB --texts $R2/negative_train.txt --n 60000 --out-dir $R2/hey_canvas/negative_train --batch-size 32 --seed 34 $WIDE &&
  i=0 && for t in $R3/texts/hard_*.txt; do
    i=$((i+1)); p=$(cat ${t%.txt}.prefix)
    $LIB $WIDE --texts $t --n $((700*i)) --out-dir $R3/hey_canvas/negative_train_hard_libri --batch-size 48 --seed $((400+i)) --cut-after "$p" --cut-extra-ms 0 150
  done
  echo CHAIN_B_DONE
) > $W/logs/gen_b.log 2>&1 &
(
  $VC --texts $R3/positive.txt --n 25000 --out-dir $R3/hey_canvas/positive_train_vctk --seed 51 &&
  $VC --texts $R3/positive_cont.txt --n 10000 --out-dir $R3/hey_canvas/positive_train_vctk_cut --seed 52 --cut-after "hey canvas" &&
  $VC --texts $R3/texts/custom.txt --n 8000 --out-dir $R3/hey_canvas/negative_train_vctk --seed 53 &&
  $VC --texts $R3/texts/adversarial.txt --n 8000 --out-dir $R3/hey_canvas/negative_train_vctk --seed 54 &&
  i=0 && for t in $R3/texts/hard_*.txt; do
    i=$((i+1)); p=$(cat ${t%.txt}.prefix)
    $VC --texts $t --n 300 --out-dir $R3/hey_canvas/negative_train_vctk_hard --seed $((600+i)) --cut-after "$p"
  done
  echo CHAIN_C_DONE
) > $W/logs/gen_c.log 2>&1 &
wait
echo ALLDONE > $W/logs/gen_all.done
