#!/usr/bin/env bash
# Round 4 pod setup. venv = round 3b's exact Linux pins (Piper, training, calibration);
# venv-feat = onnxruntime-gpu for features; venv-tts = Kokoro + F5-TTS. Kept apart so
# none of them can move the others' torch/onnxruntime versions.
set -euo pipefail
export W=/workspace
cd $W
mkdir -p logs data src runs final
apt-get update -qq && apt-get install -y -qq ffmpeg libsndfile1 espeak-ng > logs/apt.log 2>&1
command -v uv >/dev/null || pip install -q uv
uv venv -q --python 3.11 venv
uv pip install -q --python venv/bin/python -r configs/requirements.round3b-pod.lock.txt > logs/install.log 2>&1
uv pip install -q --python venv/bin/python pyroomacoustics==0.8.4 > logs/install-extra.log 2>&1
git clone -q https://github.com/dscripka/openWakeWord.git src/openWakeWord && git -C src/openWakeWord checkout -q 368c037
git clone -q https://github.com/dscripka/piper-sample-generator.git src/piper-sample-generator && git -C src/piper-sample-generator checkout -q f1988a4
venv/bin/python -c 'from openwakeword.utils import download_models; download_models()'
uv venv -q --python 3.11 venv-feat
uv pip install -q --python venv-feat/bin/python torch==2.8.0 numpy==1.26.4 scipy==1.13.1 soundfile==0.12.1 onnxruntime-gpu==1.22.0 tqdm requests scikit-learn > logs/install-feat.log 2>&1
uv pip install -q --python venv-feat/bin/python --no-deps openwakeword==0.6.0 >> logs/install-feat.log 2>&1
cp venv/lib/python3.11/site-packages/openwakeword/resources/models/{melspectrogram,embedding_model}.onnx venv-feat/lib/python3.11/site-packages/openwakeword/resources/models/ 2>/dev/null || {
  mkdir -p venv-feat/lib/python3.11/site-packages/openwakeword/resources/models
  cp venv/lib/python3.11/site-packages/openwakeword/resources/models/{melspectrogram,embedding_model}.onnx venv-feat/lib/python3.11/site-packages/openwakeword/resources/models/; }
uv venv -q --python 3.11 venv-tts
uv pip install -q --python venv-tts/bin/python torch==2.8.0 torchaudio==2.8.0 'kokoro>=0.9.4' 'misaki[en]' f5-tts faster-whisper==1.2.1 soundfile > logs/install-tts.log 2>&1
echo SETUP_DONE
