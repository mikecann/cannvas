# Ablation: the same round 4 recipe without the far-field simulation (near-only copies of every clip),
# to tell how much of any change comes from the simulated lounge rather than the extra voices.
set -e
export W=/workspace; cd $W; F=runs/r4/feat; D2=runs/r4near/hey_canvas; mkdir -p $D2
venv/bin/python -I scripts/merge_features.py $D2/positive_features_train.npy 7 $F/pos_piper_near.npy $F/pos_vctk_near.npy $F/pos_kok_near.npy $F/pos_f5_near.npy
venv/bin/python -I scripts/merge_features.py $D2/negative_features_train.npy 8 $F/neg_main_near.npy $F/neg_f5_near.npy
venv/bin/python -I - <<"PY"
import sys, yaml; sys.argv=["x"]; sys.path.insert(0, "scripts")
import r4_train as t
from pathlib import Path
t.D = Path("/workspace/runs/r4near/hey_canvas")
for f in ["positive_test", "speech_features_train.npy", "positive_features_test.npy", "negative_features_test.npy"]:
    p = t.D / f
    if not p.exists(): p.symlink_to(Path("/workspace/runs/r4/hey_canvas") / f)
t.train("r4_near", t.base_cfg("r4_near"))
PY
echo NEAR_DONE
