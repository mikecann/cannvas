#!/usr/bin/env python3
"""Held-out test clips from macOS `say` voices (never seen in training).

Writes 16 kHz mono s16 WAVs (via ffmpeg) to <out>/pos and <out>/neg, named
<voice>__<rate>__<phrase>.wav.
"""
import argparse
import os
import re
import subprocess
import tempfile

POS_VOICES = ["Karen", "Daniel", "Samantha", "Moira", "Tessa", "Rishi", "Kathy", "Fred",
              "Eddy (English (UK))", "Flo (English (UK))", "Grandma (English (UK))",
              "Grandpa (English (UK))", "Reed (English (UK))", "Rocko (English (UK))",
              "Sandy (English (UK))", "Shelley (English (UK))"]
ODD_VOICES = ["Albert", "Zarvox", "Whisper"]  # robotic/novelty, reported separately
POS_PHRASES = ["Hey Canvas", "Hey Canvas, turn the lights on", "Hey Canvas what's the weather"]

NEG_VOICES = ["Karen", "Daniel", "Samantha", "Moira", "Rocko (English (UK))", "Flo (English (UK))"]
NEG_PHRASES = ["Hey, can you pass the salt", "I bought a canvas bag", "Hey Kansas", "Hey Alexa",
               "Hey Jarvis", "that painting is on canvas", "Hey Cameron", "heavens above",
               "Hey can we go to the park", "Kansas City", "Hey Cass", "the canvas is ready",
               "Hey Kevin", "Hey camera"]
ORDINARY = (
    "Good morning everyone. Can you please put your shoes on, we are leaving in five minutes. "
    "Has anyone seen my keys? I left them on the kitchen bench last night. "
    "What would you like for dinner tonight, pasta or tacos? "
    "The weather looks nice, so we could go to the beach this afternoon. "
    "Remember to feed the cat before you go to school. "
    "I bought some paint and a new brush from the craft shop. "
    "Can you help me carry the shopping bags in from the car? "
    "Your brother has soccer practice at four, and then we need to pick up groceries. "
    "Have you finished your homework yet? You still have reading to do. "
    "Turn the music down a little please, I'm on the phone. "
    "Grandma is coming over on Sunday, so let's tidy the lounge room. "
    "The campus tour starts at ten, and parking is behind the library. "
    "Let's watch a movie together after dinner, but only one episode for the kids. "
    "I think it might rain later, so bring your raincoat. "
    "Hey, can you grab me a glass of water while you're up? "
    "We could paint the fence on the weekend if it stays dry. "
    "Okay, lights off, it's time for bed. Good night, sleep tight."
)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def make(voice, text, rate, path):
    with tempfile.TemporaryDirectory() as td:
        aiff = os.path.join(td, "x.aiff")
        cmd = ["say", "-v", voice, "-o", aiff]
        if rate:
            cmd += ["-r", str(rate)]
        subprocess.run(cmd + [text], check=True)
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", aiff,
                        "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", path], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    pos, neg, odd = (os.path.join(a.out, d) for d in ("pos", "neg", "odd"))
    for d in (pos, neg, odd):
        os.makedirs(d, exist_ok=True)
    for v in POS_VOICES:
        for p in POS_PHRASES:
            make(v, p, None, os.path.join(pos, f"{slug(v)}__default__{slug(p)}.wav"))
    for v in ["Karen", "Daniel", "Samantha"]:  # speaking-rate variants
        for r in (140, 230):
            for p in POS_PHRASES:
                make(v, p, r, os.path.join(pos, f"{slug(v)}__r{r}__{slug(p)}.wav"))
    for v in ODD_VOICES:
        for p in POS_PHRASES:
            make(v, p, None, os.path.join(odd, f"{slug(v)}__default__{slug(p)}.wav"))
    for v in NEG_VOICES:
        for p in NEG_PHRASES:
            make(v, p, None, os.path.join(neg, f"{slug(v)}__default__{slug(p)}.wav"))
    for v in ["Karen", "Daniel", "Samantha"]:
        make(v, ORDINARY, None, os.path.join(neg, f"{slug(v)}__default__ordinary_sentences.wav"))


if __name__ == "__main__":
    main()
