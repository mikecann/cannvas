#!/bin/sh
# Stock openWakeWord features (no mic sim, no room) for every TTS clip set: the run 3 recipe itself.
W=$1; NW=${2:-12}
F="$W/venv/bin/python -I $W/scripts/feats2.py --stock --workers $NW"
R1=$W/runs/run1/hey_canvas; R2=$W/runs/run2/hey_canvas; R3=$W/runs/run3/hey_canvas
cd $W; mkdir -p feats_stock
$F --out feats_stock/positive_test.npy --dir $R1/positive_test --seed 101
$F --out feats_stock/negative_test.npy --dir $R2/negative_test --seed 102
$F --out feats_stock/pos_vctk.npy --dir $R3/positive_train_vctk --seed 103
$F --out feats_stock/pos_vctk_cut.npy --dir $R3/positive_train_vctk_cut --seed 104
$F --out feats_stock/neg_vctk.npy --dir $R3/negative_train_vctk --seed 105
$F --out feats_stock/neg_vctk_hard.npy --dir $R3/negative_train_vctk_hard --seed 106
$F --out feats_stock/pos_libri.npy --dir $R2/positive_train --seed 107
$F --out feats_stock/neg_libri.npy --dir $R2/negative_train --seed 108
$F --out feats_stock/neg_hard_libri.npy --dir $R3/negative_train_hard_libri --seed 109
echo FEATS_DONE
