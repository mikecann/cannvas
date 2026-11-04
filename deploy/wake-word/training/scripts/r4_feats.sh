#!/usr/bin/env bash
# Round 4 features: every TTS clip gets a near (stock-like) and a far (simulated lounge + XVF3800)
# version, the tests get one mixed version, plus 400k crops of LibriSpeech train-other-500.
set -euo pipefail
export W=/workspace
cd $W
C=$W/runs/r4/clips; F=$W/runs/r4/feat; D=$W/runs/r4/hey_canvas; mkdir -p $F $D
A="venv-feat/bin/python -I scripts/r4_aug.py"
S=${R4_SCALE:-1}
for mode in near far; do
  $A clips --kind pos --mode $mode --seed $([ $mode = near ] && echo 1 || echo 2) --out $F/pos_piper_$mode.npy $C/piper_pos $C/piper_cut
  $A clips --kind pos --mode $mode --seed $([ $mode = near ] && echo 3 || echo 4) --out $F/pos_vctk_$mode.npy $C/vctk_pos $C/vctk_cut
  $A clips --kind pos --mode $mode --seed $([ $mode = near ] && echo 5 || echo 6) --out $F/pos_neural_$mode.npy $C/kok_pos $C/kok_cut $C/f5_pos* $C/f5_mike
  $A clips --kind neg --mode $mode --seed $([ $mode = near ] && echo 7 || echo 8) --out $F/neg_$mode.npy $C/piper_neg $C/piper_hard_* $C/vctk_neg $C/vctk_hard $C/kok_neg $C/kok_neg2 $C/f5_neg $C/f5_mike_neg
done
$A clips --kind pos --mode mix --seed 9 --out $F/pos_test.npy $C/piper_pos_test $C/kok_test $C/f5_test
$A clips --kind neg --mode mix --seed 10 --out $F/neg_test.npy $C/piper_neg_test
find data/librispeech/LibriSpeech/train-other-500 -name '*.flac' > $F/speech_files.txt
$A speech --files $F/speech_files.txt --n $(python3 -c "print(max(500, int(400000 * $S)))") --seed 11 --out $F/speech.npy
venv/bin/python -I scripts/merge_features.py $D/positive_features_train.npy 7 $F/pos_*_near.npy $F/pos_*_far.npy
venv/bin/python -I scripts/merge_features.py $D/negative_features_train.npy 8 $F/neg_near.npy $F/neg_far.npy
ln -sf $F/speech.npy $D/speech_features_train.npy
ln -sf $F/pos_test.npy $D/positive_features_test.npy
ln -sf $F/neg_test.npy $D/negative_features_test.npy
ln -sfn $C/piper_pos_test $D/positive_test
echo FEATS_DONE
