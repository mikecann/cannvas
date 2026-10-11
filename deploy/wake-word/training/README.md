# hey_canvas openWakeWord model: how it was built

`$W` is a scratch work dir (about 35 GB once the data is downloaded). This
folder keeps its `scripts/` and `configs/`; the model it made is
`../hey_canvas.onnx`. The layout of the work dir was:

```
$W/final/      hey_canvas.onnx (deliverable), raw run-3 model, run-3 config
$W/src/        upstream repos (read-only)      $W/data/     downloads + background audio
$W/scripts/    everything I wrote              $W/configs/  train.py YAML configs (+ variants)
$W/runs/runN/  clips, features, model per run  $W/eval/     held-out `say` clips + all scores
$W/venv/       Python 3.11 env                 $W/logs/     logs of every long step
```

## Versions

* Python 3.11.15 (uv), macOS arm64 (M5 Pro). torch 2.8.0: MPS for LibriTTS TTS, CPU for training.
* Exact pins are in `scripts/requirements.txt`. Install with `uv venv --python 3.11 venv && uv pip install --python venv/bin/python -r scripts/requirements.txt`.
* Runtime parity with the Pi: `openwakeword==0.6.0` and `onnxruntime==1.31.0`. The shared
  `melspectrogram.onnx` and `embedding_model.onnx` have the same sha256 on both machines
  (ba2b0e0f… and 70d16429…).
* `src/openWakeWord` is dscripka/openWakeWord main @ 368c037 (train.py comes from here). Tag v0.6.0 is c8ef691.
* `src/piper-sample-generator` is dscripka/piper-sample-generator @ f1988a4.
* TTS models:
  * `en_US-libritts_r-medium.pt` from the rhasspy/piper-sample-generator v2.0.0 release (sha256 e95ee537…). Its JSON comes from rhasspy/piper-sample-generator @ 2971426.
  * Run 3 only: `en_GB-vctk-medium.onnx` from HF `rhasspy/piper-voices` (109 UK speakers, sha256 4e9fc85a…).

## Data

| what | source | where |
|---|---|---|
| negative features (2000 h ACAV100M, 16-bit) | HF `davidscripka/openwakeword_features`, `openwakeword_features_ACAV100M_2000_hrs_16bit.npy` (sha256 721a66d0…, matches the LFS oid) | `data/features/` |
| FP validation features (10.7 h, though train.py assumes 11.3) | same repo, `validation_set_features.npy` (sha256 a56a8a0f…) | `data/features/` |
| room impulse responses (270) | HF `davidscripka/MIT_environmental_impulse_responses`, `16khz/*.wav` | `data/mit_rirs/` |
| background noise (1500 x 10 s) | HF `agkphysics/AudioSet`, `data/bal_train/{09,02,05}.parquet` (the notebook's `bal_train09.tar` is now parquet) | `data/audioset_parquet/` -> `data/audioset_16k/` |
| background music (659 x 30 s) | random tracks from FMA `fma_small.zip` (os.unil.cloud.switch.ch, the archive that `rudraml/fma` streams), fetched with HTTP range requests | `data/fma_16k/` |

## Pipeline

```sh
W=<work dir>; PY="$W/venv/bin/python -I"
# Data. HF files are fetched with: curl -L https://huggingface.co/datasets/<repo>/resolve/main/<file>
$PY scripts/prep_background.py audioset --out data/audioset_16k --parquets data/audioset_parquet/*.parquet
$PY scripts/prep_background.py fma --out data/fma_16k --n 600

# Run 1 (stock settings: 50k + 50k clips, layer 32, 50k steps)
$PY scripts/make_texts.py --config configs/hey_canvas_run1.yml --out-dir runs/run1
scripts/gen_run.sh $W $W/runs/run1                                       # TTS on MPS, ~10 min
scripts/train_run.sh $W configs/hey_canvas_run1.yml logs/train_run1.log  # augment + features + train

# Run 2 (100k positives, 30% of them "hey canvas <command>" cut after the wake phrase; 60k negatives)
scripts/gen_run2_pos.sh $W $W/runs/run2 ; scripts/gen_run2_neg.sh $W $W/runs/run2
#   (negative texts: make_texts.py with n_samples=60000, --custom-share 0.25 --seed 2)
$PY scripts/feats_for_clips.py runs/run2/hey_canvas/positive_train runs/run2/hey_canvas/positive_features_train.npy $W
#   (the same for negative_train and negative_test; positive_features_test.npy is copied from run 1)
$PY scripts/oww_train.py --training_config configs/hey_canvas_run2.yml --train_model

# Run 3 (run 2 data + VCTK voices + near-miss-plus-command negatives); this is the shipped model
scripts/gen_run3.sh $W $W/runs/run3
$PY scripts/feats_for_clips.py runs/run3/hey_canvas/<each new dir> runs/run3/hey_canvas/feat_<dir>.npy $W
$PY scripts/merge_features.py runs/run3/hey_canvas/positive_features_train.npy 7 <run2 pos> <vctk pos> <vctk cut pos>
$PY scripts/merge_features.py runs/run3/hey_canvas/negative_features_train.npy 8 <run2 neg> <hard libri> <vctk> <vctk hard>
$PY scripts/oww_train.py --training_config configs/hey_canvas_run3.yml --train_model

# Operating point: pick t on the first half of the validation features and report the second half,
# then shift the last bias so that the Pi's fixed 0.5 trigger equals raw score t (t = 0.975829)
$PY scripts/calibrate_onnx.py --model runs/run3/hey_canvas.onnx --out final/hey_canvas.onnx \
    --fp-data data/features/validation_set_features.npy --target-fph 0.4

# Checks
$PY scripts/eval_model.py --model final/hey_canvas.onnx --feature-dir runs/run3/hey_canvas \
    --fp-data data/features/validation_set_features.npy      # recall + FP/hour on validation features
python3 scripts/make_say_clips.py --out eval/say             # held-out macOS voices
$PY scripts/score_clips.py --model final/hey_canvas.onnx eval/say/pos/*.wav   # Pi-identical streaming
$PY scripts/say_summary.py eval/say final/hey_canvas.onnx ...  # summary across models
$PY scripts/roc.py data/features/validation_set_features.npy runs/run1/hey_canvas/positive_features_test.npy m.onnx ...
```

Training-only variants (`configs/v_*.yml`, `configs/r2_*.yml`, `configs/r3_*.yml`) were made with
`scripts/variant.py`. Each one reuses a run's features through a symlink.

## Deviations from the stock notebook / train.py, and why

* **train.py comes from main, not the v0.6.0 tag.** The tag always converts to tflite, which needs
  tensorflow-cpu 2.8.1 and onnx_tf, and neither has Apple Silicon wheels. The patches in
  `oww_train.py` are marked `LOCAL PATCH`:
  * INFO logging.
  * The piper import is optional.
  * `--convert_to_tflite` defaults to `False`. Upstream's default is the string `"False"`, which is truthy.
  * DataLoader uses `num_workers=0` on macOS.
  * Validation metrics are logged to `train_history.json`.

  The exported ONNX is in the same format as upstream's: opset 13, input `[1,16,96]`, sigmoid output.
* **Clip generation** (`gen_clips.py`) runs the upstream `generate_samples()` loop on MPS, which is
  about 10x faster than CPU. To check the MPS audio, I scored MPS and CPU "hey jarvis" clips with the
  pretrained hey_jarvis model: both got 40/40 >= 0.5. Each batch also gets random speaker pairs plus a
  random SLERP weight, length scale and noise scales, instead of cycling speakers in order.
  `--cut-after` cuts a "hey canvas <command>" clip at the end of the wake phrase, plus 0-150 ms of the
  next word. The cut point comes from the VITS duration predictor.
* **VCTK clips** (`gen_clips_onnx.py`, run 3) run the Piper ONNX voice through onnxruntime. The graph's
  `Ceil` output is exposed so durations are available for the cut.
* **Phonemizer.** dscripka's fork uses `espeak_phonemizer`, which is Linux only, and piper-tts's
  bundled espeak fails on macOS. The root cause is that libespeak-ng stores its data path in a 160-byte
  buffer, and this work dir's absolute path is longer than that. `espeak_ctypes.py` loads libespeak-ng
  1.52 from the `espeakng-loader` wheel with a relative data path. Its output matches espeak_phonemizer's
  defaults.
* **Negatives** (`make_texts.py`):
  * The adversarial generator's homophone filter never fires because it compares a string with a list.
    So it emits "hay canvas", "hey canvass" and "haigh canvas" labelled as negative. These are dropped.
  * Custom near-miss phrases are repeated to make up 20-25% of the negatives. train.py synthesises each
    one about once in 50k.
* **Bias calibration** (`calibrate_onnx.py`) only moves the threshold. Window ranking is unchanged.
* `torch.load(..., weights_only=False)` loads the pickled piper model (torch >= 2.6 defaults to `True`).
* `setuptools<81` is pinned because `pronouncing` imports `pkg_resources`.
