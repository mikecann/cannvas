#!/usr/bin/env bash
# Round 4 TTS on the pod. Three lanes run at once: Piper LibriTTS-R (GPU), Piper VCTK (CPU),
# and Kokoro then F5-TTS (GPU). Counts are targets; F5 is time-boxed.
set -euo pipefail
export W=/workspace OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
cd $W
C=$W/runs/r4/clips; T=$W/runs/r4/texts; mkdir -p $C logs
PY=venv/bin/python; TP=venv-tts/bin/python
VW=${R4_VCTK_WORKERS:-5}  # the pod has 12 vCPUs whatever nproc says
LIB="$PY -I scripts/gen_clips.py --psg src/piper-sample-generator --model data/piper_models/en_US-libritts_r-medium.pt --device cuda --batch-size 64 --length-scales .7 .8 .9 1 1.1 1.2 1.35 --noise-scales .667 .8 .9 1 --noise-scale-ws .7 .85 1"
VC="$PY -I scripts/gen_clips_onnx.py --psg src/piper-sample-generator --voice data/piper_models/en_GB-vctk-medium.onnx --workers $VW"
S=${R4_SCALE:-1}   # R4_SCALE=0.01 for a smoke run
n() { python3 -c "print(max(20, int($1 * $S)))"; }

(
  $LIB --texts $T/positive.txt --n $(n 3000) --out-dir $C/piper_pos_test --seed 11
  $LIB --texts $T/neg_test.txt --n $(n 3000) --out-dir $C/piper_neg_test --seed 33
  $LIB --texts $T/pos_plain.txt --n $(n 70000) --out-dir $C/piper_pos --seed 31
  $LIB --texts $T/pos_cont.txt --n $(n 60000) --out-dir $C/piper_cut --seed 32 --cut-after 'hey canvas' --cut-extra-ms 0 150
  $LIB --texts $T/neg_train.txt --n $(n 80000) --out-dir $C/piper_neg --seed 34
  for f in $T/hard_*.txt; do
    i=$(basename $f .txt); p=$(cat ${f%.txt}.prefix)
    $LIB --texts $f --n $(n 1000) --out-dir $C/piper_hard_$i --seed $((400 + 10#${i#hard_})) --cut-after "$p" --cut-extra-ms 0 150 || echo "hard prefix failed: $p"
  done
  echo PIPER_DONE
) > logs/gen_piper.log 2>&1 &
(
  $VC --texts $T/pos_plain.txt --n $(n 20000) --out-dir $C/vctk_pos --seed 51
  $VC --texts $T/pos_cont.txt --n $(n 10000) --out-dir $C/vctk_cut --seed 52 --cut-after 'hey canvas'
  $VC --texts $T/neg_custom.txt --n $(n 6000) --out-dir $C/vctk_neg --seed 53
  $VC --texts $T/neg_train.txt --n $(n 6000) --out-dir $C/vctk_neg --seed 54
  for f in $T/hard_*.txt; do
    i=$(basename $f .txt); p=$(cat ${f%.txt}.prefix)
    $VC --texts $f --n $(n 300) --out-dir $C/vctk_hard --seed $((600 + 10#${i#hard_})) --cut-after "$p" || echo "vctk hard prefix failed: $p"
  done
  echo VCTK_DONE
) > logs/gen_vctk.log 2>&1 &
(
  $TP -I scripts/r4_tts_kokoro.py --texts $T/pos_plain.txt --n $(n 1000) --out-dir $C/kok_test --seed 71
  $TP -I scripts/r4_tts_kokoro.py --texts $T/pos_plain.txt --n $(n 18000) --out-dir $C/kok_pos --seed 72
  $TP -I scripts/r4_tts_kokoro.py --texts $T/pos_cont_k.txt --n $(n 12000) --out-dir $C/kok_cut --seed 73 --cut-after canvas
  $TP -I scripts/r4_tts_kokoro.py --texts $T/neg_custom.txt --n $(n 6000) --out-dir $C/kok_neg --seed 74
  $TP -I scripts/r4_tts_kokoro.py --texts $T/neg_train.txt --n $(n 4000) --out-dir $C/kok_neg2 --seed 75
  echo KOKORO_DONE
  F5="$TP -I scripts/r4_tts_f5.py --refs data/r4_refs.tsv"
  $F5 --texts $T/pos_plain.txt --group mike --n $(n 5000) --out-dir $C/f5_mike --seed 81 --max-minutes 25
  $F5 --texts $T/neg_custom.txt --group mike --n $(n 1500) --out-dir $C/f5_mike_neg --seed 82 --max-minutes 8
  $F5 --texts $T/pos_plain.txt --n $(n 1000) --out-dir $C/f5_test --seed 83 --max-minutes 6
  $F5 --texts $T/neg_custom.txt --n $(n 4000) --out-dir $C/f5_neg --seed 84 --max-minutes 18
  $F5 --texts $T/pos_plain.txt --n $(n 15000) --out-dir $C/f5_pos --seed 85 --max-minutes ${R4_F5_MIN:-60}
  echo F5_DONE
) > logs/gen_neural.log 2>&1 &
wait
echo GEN_DONE
