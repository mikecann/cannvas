#!/bin/sh
# Usage: train_run.sh <work dir> <config.yml> <log>
# Augments clips + computes features, then trains, with the patched openWakeWord train.py.
W=$1; CFG=$2; LOG=$3
cd "$W/scripts" || exit 1
"$W/venv/bin/python" -I "$W/scripts/oww_train.py" --training_config "$CFG" --augment_clips > "$LOG" 2>&1 &&
"$W/venv/bin/python" -I "$W/scripts/oww_train.py" --training_config "$CFG" --train_model >> "$LOG" 2>&1
echo "EXIT $?" >> "$LOG"
