#!/usr/bin/env python3
"""Write the TTS text lists for positive and adversarial-negative clips.

Negatives follow train.py: config["custom_negative_phrases"] plus
openwakeword.data.generate_adversarial_texts(target, N, include_partial_phrase=1.0,
include_input_words=0.2), with two deliberate changes:

1. Homophone filter. generate_adversarial_texts means to drop homophones, but its
   check compares a phone *string* with a phone *list*, so it never matches. For
   "hey canvas" that lets through "hay canvas", "haigh canvas", "hey canvass",
   which sound identical to the wake phrase but would be labelled negative. Any
   text whose stress-free CMUdict phones contain the target's phones is dropped.
2. Custom-phrase share. train.py appends the custom phrases once to a list of N
   generated texts, so each one is synthesised about once in 50k clips. Here they
   are repeated to make up `--custom-share` of the negatives (default 20%), so
   every near miss gets many voices, speeds and noise settings.
"""
import argparse
import itertools
import random
import re

import numpy as np
import pronouncing
import yaml
from openwakeword.data import generate_adversarial_texts


def contains_target(text, target_variants):
    """True if any CMUdict pronunciation of text contains a target pronunciation (stress ignored)."""
    words = [w.strip(",.?!") for w in text.lower().split()]
    prons = [[re.sub(r"\d", "", p) for p in pronouncing.phones_for_word(w)] for w in words]
    if any(not p for p in prons):
        return False
    for combo in itertools.product(*prons):
        s = " " + " ".join(combo) + " "
        if any(f" {t} " in s for t in target_variants):
            return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--custom-share", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    random.seed(a.seed)
    np.random.seed(a.seed)
    cfg = yaml.safe_load(open(a.config))
    targets = cfg["target_phrase"]
    custom = cfg["custom_negative_phrases"]

    target_variants = set()
    for t in targets:
        words = t.lower().split()
        for combo in itertools.product(*[[re.sub(r"\d", "", p) for p in pronouncing.phones_for_word(w)]
                                         for w in words]):
            target_variants.add(" ".join(combo))
    print("target pronunciations:", target_variants)

    bad_custom = [c for c in custom if contains_target(c, target_variants)]
    print("custom phrases containing the target pronunciation (kept on purpose, they continue past it):",
          bad_custom)

    with open(f"{a.out_dir}/positive.txt", "w") as f:
        for t in targets:
            f.write(t + "\n")

    for split, n in (("train", cfg["n_samples"]), ("test", cfg["n_samples_val"])):
        n_custom = int(round(n * a.custom_share))
        n_adv = n - n_custom
        adv = []
        dropped = []
        while len(adv) < n_adv:
            for t in targets:
                for x in generate_adversarial_texts(input_text=t, N=n_adv // len(targets) + 1,
                                                    include_partial_phrase=1.0, include_input_words=0.2):
                    if contains_target(x, target_variants):
                        dropped.append(x)
                    else:
                        adv.append(x)
        adv = adv[:n_adv]
        cust = [custom[i % len(custom)] for i in range(n_custom)]
        texts = adv + cust
        random.shuffle(texts)
        with open(f"{a.out_dir}/negative_{split}.txt", "w") as f:
            f.write("\n".join(texts) + "\n")
        print(f"{split}: {len(adv)} adversarial + {len(cust)} custom; dropped {len(dropped)} homophone texts,"
              f" e.g. {sorted(set(dropped))[:12]}")


if __name__ == "__main__":
    main()
