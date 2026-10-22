#!/bin/sh
# wait for gen_run.sh to finish, then train
W=$1; CFG=$2; LOG=$3
until grep -q ALLDONE "$W/logs/gen_pos.log"; do sleep 20; done
"$W/scripts/train_run.sh" "$W" "$CFG" "$LOG"
