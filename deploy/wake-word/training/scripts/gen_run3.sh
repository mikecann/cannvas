#!/bin/sh
# run3 additions on top of run2's clips:
#  - LibriTTS (MPS): near-miss phrase + command, cut 0-150 ms after the near miss (700 per prefix)
#  - VCTK en_GB (CPU, 14 procs): 25k "hey canvas", 10k "hey canvas <command>" cut,
#    8k custom near misses, 8k adversarial texts, 300 cut near-miss+command per prefix
W=$1; R=$2; D=$R/hey_canvas
PSG=$W/src/piper-sample-generator
LIB="$W/venv/bin/python -I $W/scripts/gen_clips.py --psg $PSG --model $W/data/piper_models/en_US-libritts_r-medium.pt --device mps --length-scales 0.7 0.8 0.9 1.0 1.1 1.2 1.35 --noise-scales 0.667 0.8 0.9 1.0 --noise-scale-ws 0.7 0.85 1.0"
VC="$W/venv/bin/python -I $W/scripts/gen_clips_onnx.py --psg $PSG --voice $W/data/piper_models/en_GB-vctk-medium.onnx --workers 12"
(
  i=0
  for t in $R/texts/hard_*.txt; do
    i=$((i+1)); p=$(cat ${t%.txt}.prefix)
    $LIB --texts $t --n $((700*i)) --out-dir $D/negative_train_hard_libri --batch-size 48 --seed $((400+i)) --cut-after "$p" --cut-extra-ms 0 150
  done
  echo LIBDONE
) > $W/logs/gen_run3_libri.log 2>&1 &
(
  $VC --texts $R/positive.txt --n 25000 --out-dir $D/positive_train_vctk --seed 51 &&
  $VC --texts $R/positive_cont.txt --n 10000 --out-dir $D/positive_train_vctk_cut --seed 52 --cut-after "hey canvas" &&
  $VC --texts $R/texts/custom.txt --n 8000 --out-dir $D/negative_train_vctk --seed 53 &&
  $VC --texts $R/texts/adversarial.txt --n 8000 --out-dir $D/negative_train_vctk --seed 54 &&
  i=0 && for t in $R/texts/hard_*.txt; do
    i=$((i+1)); p=$(cat ${t%.txt}.prefix)
    $VC --texts $t --n 300 --out-dir $D/negative_train_vctk_hard --seed $((600+i)) --cut-after "$p"
  done
  echo VCDONE
) > $W/logs/gen_run3_vctk.log 2>&1 &
wait
echo ALLDONE >> $W/logs/gen_run3_vctk.log
