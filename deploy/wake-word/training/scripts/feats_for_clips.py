#!/usr/bin/env python3
"""Augment a folder of clips exactly like train.py --augment_clips and save features.
Usage: feats_for_clips.py <clip_dir> <out.npy> <work_dir> [total_length]"""
import os, sys, glob
from openwakeword.data import augment_clips
from openwakeword.utils import compute_features_from_generator
clip_dir, out, W = sys.argv[1:4]
total = int(sys.argv[4]) if len(sys.argv) > 4 else 32000
clips = sorted(glob.glob(os.path.join(clip_dir, "*.wav")))
rirs = [e.path for e in os.scandir(f"{W}/data/mit_rirs")]
bg = [e.path for d in ("audioset_16k", "fma_16k") for e in os.scandir(f"{W}/data/{d}")]
g = augment_clips(clips, total_length=total, batch_size=16, background_clip_paths=bg, RIR_paths=rirs)
compute_features_from_generator(g, n_total=len(clips), clip_duration=total, output_file=out, device="cpu", ncpu=9)
