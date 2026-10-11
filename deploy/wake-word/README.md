# "Hey Canvas" wake word

`hey_canvas.onnx` is the openWakeWord model `cannvas-voice` listens with.
There was no ready-made model for the phrase, so this one was trained for
Cannvas on synthetic speech: 135,000 "Hey Canvas" clips from 900+ LibriTTS
and 109 British VCTK voices, with room echo, background noise and music mixed
in, against 2,000 hours of other audio and about 90,000 clips of near misses ("hey
Kansas", "the canvas", "hey can you", "hey Cameron" and so on). The training
recipe, scripts and configs are in [`training/`](training/).

It runs with `openwakeword==0.6.0` and fires at the usual 0.5. The model's
last bias was shifted so 0.5 lands where the false positives are about 0.2 an
hour.

## How well it works

Tested on voices it never trained on (macOS `say`), scored on the Pi:

| | Fired |
|---|---|
| "Hey Canvas", natural voices (Karen, Daniel, Samantha, Moira, Tessa, Rishi, Kathy, Fred) | 42 of 42, lowest score 0.70 |
| "Hey Canvas", novelty voices (Rocko, Grandma, Albert and others) | 15 of 24 |
| Near misses ("Hey Kansas", "I bought a canvas bag", "Hey Alexa", "Hey Cameron", ...) | 4 of 87, all "Hey Kansas" |
| Three minutes of ordinary family sentences | none, peak score below 0.0001 |
| Background audio (openWakeWord's 10.7 hour validation set) | about 0.2 to 0.3 times an hour |

"Kansas" and "canvas" are one sound apart, and no threshold separates them for
every voice without losing real wakes. A false wake only plays a chime and
listens for a few seconds. If it becomes a nuisance, the next step is 20 to 50
recordings of the family saying "Hey Canvas", either to retrain with or for
openWakeWord's per-speaker verifier.

## Licence

Unlike the rest of this repository, `hey_canvas.onnx` is CC BY-NC-SA 4.0,
because the negative training data
([`davidscripka/openwakeword_features`](https://huggingface.co/datasets/davidscripka/openwakeword_features))
is. That's the same licence as openWakeWord's own pretrained models: fine for
a family display, not for selling. `training/scripts/oww_train.py` is a
patched copy of openWakeWord's Apache 2.0 `train.py`.
