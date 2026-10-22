#!/usr/bin/env python3
"""Set up a training run: runs/<name>/hey_canvas with symlinked features + configs/<name>.yml.

Usage: make_run.py <name> --fold f1|f2|f3|all|none --neg A|B [--steps 100000] [--n-real 12] [--n-owner 16]
                   [--threads 3] [--pos feats/positive_train_merged.npy]
  --neg A: all run 3 negatives (mic-sim features)
  --neg B: run 3 negatives minus "a canvas", "a canvas tote" and "a canvas <command>" (the owner's
           "Hey Canvas" is often heard as "a canvas"; see the report)
"""
import argparse
import os
import subprocess
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.dirname(HERE)


def link(src, dst):
    if os.path.lexists(dst):
        os.remove(dst)
    os.symlink(os.path.abspath(src), dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--fold", required=True)
    ap.add_argument("--neg", default="A")
    ap.add_argument("--steps", type=int, default=100000)
    ap.add_argument("--n-real", type=int, default=12)
    ap.add_argument("--n-owner", type=int, default=16)
    ap.add_argument("--threads", type=int, default=3)
    ap.add_argument("--feats", default="feats", help="feats (mic sim) or feats_stock (plain openWakeWord)")
    ap.add_argument("--n-generic", type=int, default=0, help="per batch from feats/generic_negatives.npy")
    ap.add_argument("--init-onnx", default=None, help="fine-tune from this model")
    ap.add_argument("--init-bias-shift", type=float, default=0.0)
    ap.add_argument("--lr", type=float, default=None)
    a = ap.parse_args()
    a.pos = f"{W}/{a.feats}/positive_train_merged.npy"
    run = f"{W}/runs/{a.name}"
    d = f"{run}/hey_canvas"
    os.makedirs(d, exist_ok=True)
    link(a.pos, f"{d}/positive_features_train.npy")
    link(f"{W}/{a.feats}/negative_train_merged_{a.neg}.npy", f"{d}/negative_features_train.npy")
    link(f"{W}/{a.feats}/positive_test.npy", f"{d}/positive_features_test.npy")
    link(f"{W}/{a.feats}/negative_test.npy", f"{d}/negative_features_test.npy")
    link(f"{W}/runs/run1/hey_canvas/positive_test", f"{d}/positive_test")
    subprocess.run([sys.executable, "-I", f"{HERE}/assemble.py", a.fold, f"{run}/real"], check=True)

    cfg = yaml.safe_load(open(f"{W}/configs/run3.yml"))
    cfg["output_dir"] = run
    cfg["steps"] = a.steps
    cfg["torch_threads"] = a.threads
    cfg["feature_data_files"] = {"ACAV100M_sample": cfg["feature_data_files"]["ACAV100M_sample"]}
    cfg["batch_n_per_class"] = {"ACAV100M_sample": 1024, "adversarial_negative": 50, "positive": 100}
    if os.path.exists(f"{run}/real/positive_real.npy") and a.n_real > 0:
        cfg["feature_data_files"]["positive_real"] = f"{run}/real/positive_real.npy"
        cfg["batch_n_per_class"]["positive_real"] = a.n_real
    if a.n_owner > 0:
        cfg["feature_data_files"]["negative_owner"] = f"{run}/real/negative_owner.npy"
        cfg["batch_n_per_class"]["negative_owner"] = a.n_owner
    if a.init_onnx:
        cfg["init_onnx"] = os.path.abspath(a.init_onnx)
        cfg["init_bias_shift"] = a.init_bias_shift
    if a.lr:
        cfg["base_lr"] = a.lr
    if a.n_generic > 0:
        cfg["feature_data_files"]["negative_generic"] = f"{W}/feats/generic_negatives.npy"
        cfg["batch_n_per_class"]["negative_generic"] = a.n_generic
    with open(f"{W}/configs/{a.name}.yml", "w") as f:
        f.write(f"## wakeword2 run {a.name}: run 3 settings, features {a.feats}, fold {a.fold}, negatives {a.neg}, generic {a.n_generic}/batch,"
                f" positive_real {a.n_real}/batch, negative_owner {a.n_owner}/batch, steps {a.steps}, init {a.init_onnx}, lr {a.lr}\n")
        yaml.safe_dump(cfg, f, sort_keys=False)
    print(f"{W}/configs/{a.name}.yml")


if __name__ == "__main__":
    main()
