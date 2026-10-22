"""Transcribe WAVs with mlx-whisper large-v3 (word timestamps). Usage: transcribe.py out.json [--prompt P] wav..."""
import json, sys, wave
import numpy as np
import mlx_whisper
args = sys.argv[1:]
out = args.pop(0)
prompt = None
if args[0] == "--prompt":
    args.pop(0); prompt = args.pop(0)
res = {}
for p in args:
    w = wave.open(p); a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    a = a * (0.5 / (np.abs(a).max() or 1))
    r = mlx_whisper.transcribe(a, path_or_hf_repo="mlx-community/whisper-large-v3-mlx", word_timestamps=True,
                               language="en", initial_prompt=prompt, condition_on_previous_text=False, temperature=0.0)
    words = [(x["word"], round(x["start"], 2), round(x["end"], 2), round(x.get("probability", 0), 2))
             for s in r["segments"] for x in s.get("words", [])]
    res[p.split("/")[-1]] = {"text": r["text"].strip(), "words": words}
    print(p.split("/")[-1], "|", r["text"].strip(), "|", " ".join(f"{w}[{s:.2f}-{e:.2f}]" for w, s, e, _ in words), flush=True)
json.dump(res, open(out, "w"), indent=1)
