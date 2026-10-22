#!/bin/sh
# Usage: train_eval.sh <W> <name> <make_run args...>
# Set up the run, train (patched train.py, --train_model), calibrate the bias like the shipped model
# (operating point on the first half of the validation features, --target-fph 0.4), then evaluate.
W=$1; N=$2; shift 2
PY="$W/venv/bin/python -I"
LOG=$W/logs/train_$N.log
cd $W/scripts || exit 1
$PY make_run.py $N "$@" > $LOG 2>&1 || { echo "EXIT make_run failed" >> $LOG; exit 1; }
$PY oww_train.py --training_config $W/configs/$N.yml --train_model >> $LOG 2>&1 || { echo "EXIT train failed" >> $LOG; exit 1; }
mkdir -p $W/models
$PY calibrate_onnx.py --model $W/runs/$N/hey_canvas.onnx --out $W/models/$N.onnx \
    --fp-data $W/data/features/validation_set_features.npy --target-fph 0.4 > $W/logs/calib_$N.log 2>&1 || { echo "EXIT calib failed" >> $LOG; exit 1; }
OMP_NUM_THREADS=1 $PY evaluate.py --model $W/models/$N.onnx --name $N --parts real_clips,replay,say,say_mic,noisy,val_fp,synth --workers 3 > $W/logs/eval_$N.log 2>&1
echo "EXIT ok" >> $LOG
