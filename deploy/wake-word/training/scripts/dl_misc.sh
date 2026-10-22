#!/bin/sh
W=$1
set -x
cd $W/data/mit_rirs
curl -sS "https://huggingface.co/api/datasets/davidscripka/MIT_environmental_impulse_responses/tree/main/16khz" | python3 -c "import json,sys; [print(x['path']) for x in json.load(sys.stdin)]" > list.txt
while read p; do f=$(basename "$p"); [ -s "$f" ] || curl -sS -L --retry 5 -o "$f" "https://huggingface.co/datasets/davidscripka/MIT_environmental_impulse_responses/resolve/main/$p"; done < list.txt
ls *.wav | wc -l
cd $W/data/audioset_parquet
for n in 09 02 05; do curl -sS -L --retry 5 -C - -o $n.parquet "https://huggingface.co/datasets/agkphysics/AudioSet/resolve/main/data/bal_train/$n.parquet"; done
cd $W/data/piper_models
curl -sS -L --retry 5 -o en_US-libritts_r-medium.pt "https://github.com/rhasspy/piper-sample-generator/releases/download/v2.0.0/en_US-libritts_r-medium.pt"
curl -sS -L --retry 5 -o en_US-libritts_r-medium.pt.json "https://raw.githubusercontent.com/rhasspy/piper-sample-generator/2971426/models/en_US-libritts_r-medium.pt.json"
curl -sS -L --retry 5 -o en_GB-vctk-medium.onnx "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/vctk/medium/en_GB-vctk-medium.onnx"
curl -sS -L --retry 5 -o en_GB-vctk-medium.onnx.json "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/vctk/medium/en_GB-vctk-medium.onnx.json"
shasum -a 256 *
cd $W/data/librispeech
curl -sS -L --retry 5 -o test-clean.tar.gz https://www.openslr.org/resources/12/test-clean.tar.gz
curl -sS -L --retry 5 -o test-other.tar.gz https://www.openslr.org/resources/12/test-other.tar.gz
ls -la
echo MISC_DONE
