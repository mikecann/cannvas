#!/usr/bin/env bash
# Second neural lane layout: Kokoro turned out CPU-bound (~6 clips/s), so Kokoro and F5 run
# side by side, with smaller Kokoro targets.
set -uo pipefail
export W=/workspace OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
cd $W; C=$W/runs/r4/clips; T=$W/runs/r4/texts; TP=venv-tts/bin/python
(
  $TP -I scripts/r4_tts_kokoro.py --texts $T/pos_plain.txt --n 10000 --out-dir $C/kok_pos --seed 76
  $TP -I scripts/r4_tts_kokoro.py --texts $T/pos_cont_k.txt --n 6000 --out-dir $C/kok_cut --seed 73 --cut-after canvas
  $TP -I scripts/r4_tts_kokoro.py --texts $T/neg_custom.txt --n 3000 --out-dir $C/kok_neg --seed 74
  $TP -I scripts/r4_tts_kokoro.py --texts $T/neg_train.txt --n 2000 --out-dir $C/kok_neg2 --seed 75
  echo KOKORO_DONE
) > logs/gen_kokoro2.log 2>&1 &
(
  F5="$TP -I scripts/r4_tts_f5.py --refs data/r4_refs.tsv"
  $F5 --texts $T/pos_plain.txt --group mike --n 5000 --out-dir $C/f5_mike --seed 81 --max-minutes 25
  $F5 --texts $T/neg_custom.txt --group mike --n 1500 --out-dir $C/f5_mike_neg --seed 82 --max-minutes 8
  $F5 --texts $T/pos_plain.txt --n 1000 --out-dir $C/f5_test --seed 83 --max-minutes 6
  $F5 --texts $T/neg_custom.txt --n 4000 --out-dir $C/f5_neg --seed 84 --max-minutes 15
  $F5 --texts $T/pos_plain.txt --n 15000 --out-dir $C/f5_pos --seed 85 --max-minutes 50
  echo F5_DONE
) > logs/gen_f5.log 2>&1 &
wait
echo NEURAL2_DONE
