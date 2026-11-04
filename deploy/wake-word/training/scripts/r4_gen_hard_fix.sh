#!/usr/bin/env bash
set -uo pipefail
export W=/workspace OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
cd $W; C=$W/runs/r4/clips; T=$W/runs/r4/texts; PY=venv/bin/python
LIB="$PY -I scripts/gen_clips.py --psg src/piper-sample-generator --model data/piper_models/en_US-libritts_r-medium.pt --device cuda --batch-size 64 --length-scales .7 .8 .9 1 1.1 1.2 1.35 --noise-scales .667 .8 .9 1 --noise-scale-ws .7 .85 1"
VC="$PY -I scripts/gen_clips_onnx.py --psg src/piper-sample-generator --voice data/piper_models/en_GB-vctk-medium.onnx --workers 5"
for f in $T/hard_*.txt; do
  i=$(basename $f .txt); p=$(cat ${f%.txt}.prefix); k=$((10#${i#hard_}))
  $LIB --texts $f --n 1000 --out-dir $C/piper_hard_$i --seed $((400 + k)) --cut-after "$p" --cut-extra-ms 0 150 || echo "hard prefix failed: $p"
done
echo PIPER_DONE
for f in $T/hard_*.txt; do
  i=$(basename $f .txt); p=$(cat ${f%.txt}.prefix); k=$((10#${i#hard_}))
  [ $k -lt 6 ] && continue
  $VC --texts $f --n 300 --out-dir $C/vctk_hard --seed $((600 + k)) --cut-after "$p" || echo "vctk hard prefix failed: $p"
done
echo VCTK_DONE
