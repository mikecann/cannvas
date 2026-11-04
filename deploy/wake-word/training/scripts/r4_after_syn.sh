# Queued on the pod: fine-tune heads once r4_syn exists, then calibrate every model.
export W=/workspace; cd $W
until grep -q SYN_DONE logs/finish.log; do sleep 20; done
venv/bin/python -I scripts/r4_train.py heads && echo HEADS_DONE
until grep -q NEAR_DONE logs/ablation_near.log; do sleep 20; done
venv/bin/python -I - <<"PY"
import subprocess
for n in ["r4_syn", "r4_live", "r4_f0", "r4_f1", "r4_near"]:
    subprocess.run(["venv/bin/python", "-I", "scripts/calib_matched.py", f"runs/{n}/hey_canvas.onnx", f"final/{n}.onnx"], check=True)
PY
sha256sum final/*.onnx
echo CALIB_DONE
