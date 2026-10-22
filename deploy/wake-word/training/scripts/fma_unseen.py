"""Fetch N FMA-small tracks that are NOT in data/fma_16k (training background), for a noisy test set."""
import os, random, subprocess, sys, tempfile
from remotezip import RemoteZip
W, n = sys.argv[1], int(sys.argv[2])
out = f"{W}/data/fma_unseen"; os.makedirs(out, exist_ok=True)
used = {f.replace(".wav", "") for f in os.listdir(f"{W}/data/fma_16k")}
url = "https://os.unil.cloud.switch.ch/fma/fma_small.zip"
with RemoteZip(url) as z:
    names = [i.filename for i in z.infolist() if i.filename.endswith(".mp3")]
    random.Random(12345).shuffle(names)
    names = [x for x in names if os.path.basename(x)[:-4] not in used][:int(n * 1.2)]
    ok = 0
    with tempfile.TemporaryDirectory() as td:
        for name in names:
            if ok >= n: break
            src = os.path.join(td, "x.mp3")
            try:
                open(src, "wb").write(z.read(name))
            except Exception as e:
                continue
            dst = os.path.join(out, os.path.basename(name)[:-4] + ".wav")
            r = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", src, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", dst])
            if r.returncode == 0 and os.path.getsize(dst) > 16000 * 2 * 10:
                ok += 1
print("fetched", ok)
