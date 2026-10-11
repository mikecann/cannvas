# "Hey Canvas" wake word

`hey_canvas.onnx` is the openWakeWord model `cannvas-voice` listens with.
There was no ready-made model for the phrase, so it was trained for Cannvas in
two rounds. The recipe, scripts and configs are in [`training/`](training/).

1. **Synthetic speech.** 135,000 "Hey Canvas" clips from 900+ LibriTTS and
   109 British VCTK voices, with room echo, background noise and music mixed
   in, against 2,000 hours of other audio and about 90,000 clips of near
   misses ("hey Kansas", "the canvas", "hey can you", "hey Cameron" and so on).
   It handled macOS voices well but only woke for about half of Mike's real
   tries through the Pi's microphone, even close up.
2. **Fine-tuned on a real voice.** The round 1 model, trained for another
   10,000 steps with Mike's own close-range tries (0.5 to 1 m) recorded
   through the Pi's microphone, his own non-wake speech as negatives, and the
   room's background hum. The recordings stay out of this repository.

It runs with `openwakeword==0.6.0` and fires at the usual 0.5. The model's
last bias was shifted so 0.5 gives no more false wakes on openWakeWord's
10.7 hour validation set than round 1 had (3 windows, about 0.3 an hour).

## How well it works

Both recordings replayed through the model the way the Pi listens (80 ms
frames, the service's x4 gain, a second's pause after each wake). Close-range
tries were scored by models that never trained on them.

| | Round 1 | Round 2 |
|---|---|---|
| Mike, 0.5 to 1 m, held out | 2 of 10 | 9 of 10 |
| Mike, 2 m (never trained on) | about 1 of 2 | 2 of 2 |
| Mike, 3 to 8 m (never trained on) | about 0.5 of 15 | 14 of 15 |
| Mike's distance labels and other speech | no wakes | no wakes |
| macOS `say` "Hey Canvas", natural voices | 57 of 66 | 61 of 66 |
| macOS `say` through a simulated copy of the Pi's mic | 25 of 66 | 46 of 66 |
| Near misses ("Hey Kansas", "a canvas bag", "Hey Cameron", ...) | 4 of 87 | 4 of 87, all "Hey Kansas" |
| 12 hours of LibriSpeech, as recorded / through the simulated mic | 1 / 1 | 0 / 1 |

The real-voice test is small: one speaker, ten close tries, one quiet
evening. Two things to watch:

- It has only heard Mike. Recordings of the rest of the family would show
  whether it works as well for them and could go into a third round.
- With loud TV-like speech or music mixed in, it wakes slightly less often for
  full-range synthetic voices (21 of 66 at 10 dB, against 28). Through this
  microphone that test is level, but a better microphone may bring it back.

"Kansas" and "canvas" are one sound apart, and no threshold separates them for
every voice without losing real wakes. A false wake only plays a chime and
listens for a few seconds.

## Licence

Unlike the rest of this repository, `hey_canvas.onnx` is CC BY-NC-SA 4.0,
because the negative training data
([`davidscripka/openwakeword_features`](https://huggingface.co/datasets/davidscripka/openwakeword_features))
is. That's the same licence as openWakeWord's own pretrained models: fine for
a family display, not for selling. `training/scripts/oww_train.py` is a
patched copy of openWakeWord's Apache 2.0 `train.py`.
