#!/usr/bin/env bash
# What ran on the pod once F5 was stopped early (F5 managed ~1 clip/s, see RESULTS-round4.md).
# r4_feats.sh is the same recipe written as one driver.
set -e
for m in near far; do
  venv-feat/bin/python -I scripts/r4_aug.py clips --kind pos --mode $m --seed $([ $m = near ] && echo 21 || echo 22) --out runs/r4/feat/pos_f5_$m.npy runs/r4/clips/f5_pos91 runs/r4/clips/f5_pos92 runs/r4/clips/f5_mike
  venv-feat/bin/python -I scripts/r4_aug.py clips --kind neg --mode $m --seed $([ $m = near ] && echo 23 || echo 24) --out runs/r4/feat/neg_f5_$m.npy runs/r4/clips/f5_neg runs/r4/clips/f5_mike_neg
done
venv-feat/bin/python -I scripts/r4_aug.py clips --kind pos --mode mix --seed 9 --out runs/r4/feat/pos_test.npy runs/r4/clips/piper_pos_test runs/r4/clips/kok_test runs/r4/clips/f5_test
venv/bin/python -I scripts/merge_features.py runs/r4/hey_canvas/positive_features_train.npy 7 runs/r4/feat/pos_piper_near.npy runs/r4/feat/pos_piper_far.npy runs/r4/feat/pos_vctk_near.npy runs/r4/feat/pos_vctk_far.npy runs/r4/feat/pos_kok_near.npy runs/r4/feat/pos_kok_far.npy runs/r4/feat/pos_f5_near.npy runs/r4/feat/pos_f5_far.npy
venv/bin/python -I scripts/merge_features.py runs/r4/hey_canvas/negative_features_train.npy 8 runs/r4/feat/neg_main_near.npy runs/r4/feat/neg_main_far.npy runs/r4/feat/neg_f5_near.npy runs/r4/feat/neg_f5_far.npy
ln -sf /workspace/runs/r4/feat/speech.npy runs/r4/hey_canvas/speech_features_train.npy
ln -sf /workspace/runs/r4/feat/pos_test.npy runs/r4/hey_canvas/positive_features_test.npy
ln -sf /workspace/runs/r4/feat/neg_test.npy runs/r4/hey_canvas/negative_features_test.npy
ln -sfn /workspace/runs/r4/clips/piper_pos_test runs/r4/hey_canvas/positive_test
echo FEATS_DONE
venv/bin/python -I scripts/r4_train.py syn
echo SYN_DONE
