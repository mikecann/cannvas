#!/bin/sh
# Compute mic-sim features for every TTS clip set, waiting for each generation chain to finish first.
W=$1; NW=${2:-10}
F="$W/venv/bin/python -I $W/scripts/feats2.py --workers $NW"
R2=$W/runs/run2/hey_canvas; R3=$W/runs/run3/hey_canvas
cd $W
$F --out feats/negative_test.npy --dir $R2/negative_test --seed 2
$F --out feats/pos_vctk.npy --dir $R3/positive_train_vctk --seed 3
$F --out feats/pos_vctk_cut.npy --dir $R3/positive_train_vctk_cut --seed 4
until grep -q CHAIN_C_DONE logs/gen_c.log; do sleep 20; done
$F --out feats/neg_vctk.npy --dir $R3/negative_train_vctk --seed 5
$F --out feats/neg_vctk_hard.npy --dir $R3/negative_train_vctk_hard --seed 6
until grep -q CHAIN_A_DONE logs/gen_a.log; do sleep 20; done
$F --out feats/pos_libri.npy --dir $R2/positive_train --seed 7
until grep -q CHAIN_B_DONE logs/gen_b.log; do sleep 20; done
$F --out feats/neg_libri.npy --dir $R2/negative_train --seed 8
$F --out feats/neg_hard_libri.npy --dir $R3/negative_train_hard_libri --seed 9
echo FEATS_DONE
