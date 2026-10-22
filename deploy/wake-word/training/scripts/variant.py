#!/usr/bin/env python3
"""Make a training-only variant of a run: new output_dir whose hey_canvas/ dir is a
symlink to an existing run's clips + features, with config overrides.

Usage: variant.py <base.yml> <base_run_dir> <new_run_dir> <out.yml> key=value ...
(values parsed as YAML, dotted keys for nested dicts, e.g. batch_n_per_class.positive=200)
"""
import os
import sys

import yaml

base_cfg, base_run, new_run, out_cfg, *overrides = sys.argv[1:]
cfg = yaml.safe_load(open(base_cfg))
for o in overrides:
    k, v = o.split("=", 1)
    d = cfg
    *path, last = k.split(".")
    for p in path:
        d = d[p]
    d[last] = yaml.safe_load(v)
cfg["output_dir"] = os.path.abspath(new_run)
os.makedirs(new_run, exist_ok=True)
link = os.path.join(new_run, cfg["model_name"])
if not os.path.exists(link):
    os.symlink(os.path.abspath(os.path.join(base_run, cfg["model_name"])), link)
with open(out_cfg, "w") as f:
    f.write(f"## variant of {base_cfg}: {' '.join(overrides)}\n")
    yaml.safe_dump(cfg, f, sort_keys=False)
print(out_cfg)
