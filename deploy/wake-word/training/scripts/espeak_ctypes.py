"""Minimal espeak-ng IPA phonemizer for macOS.

Drop-in replacement for `espeak_phonemizer.Phonemizer` as used by
dscripka/piper-sample-generator (generate_samples.py calls
`Phonemizer(voice).phonemize(text)`). That package is Linux-only (it loads
libespeak-ng.so and libc.so.6), and piper-tts's bundled espeakbridge has a
hard-coded CI data path on macOS, so we use the libespeak-ng 1.52 dylib and data
shipped in the `espeakng-loader` wheel instead.

Behaviour matches espeak_phonemizer's defaults: IPA phonemes, clauses joined by
a single space, punctuation dropped, language-switch flags like "(en)" removed.

libespeak-ng keeps its data path in a 160-byte buffer, and this work dir's
absolute path is longer than that (the root cause of both the piper-tts and
espeakng-loader "phontab: No such file" errors). So we pass a *relative* path
and chdir into the loader's package dir while espeak loads data files
(initialise + set voice); phonemization itself reads only in-memory data.
"""
import contextlib
import ctypes
import os
import re

import espeakng_loader

_LANG_FLAG = re.compile(r"\([^)]*\)")
_AUDIO_OUTPUT_SYNCHRONOUS = 0x02
_espeakCHARS_AUTO = 0
_espeakPHONEMES_IPA = 0x02
_DATA_PARENT = os.path.dirname(espeakng_loader.get_data_path())


@contextlib.contextmanager
def _in_data_parent():
    old = os.getcwd()
    os.chdir(_DATA_PARENT)
    try:
        yield
    finally:
        os.chdir(old)


class Phonemizer:
    _lib = None

    def __init__(self, default_voice="en-us"):
        self.default_voice = default_voice
        self.current_voice = None
        if Phonemizer._lib is None:
            lib = ctypes.CDLL(espeakng_loader.get_library_path())
            with _in_data_parent():
                sr = lib.espeak_Initialize(_AUDIO_OUTPUT_SYNCHRONOUS, 0, b"espeak-ng-data", 0)
            assert sr > 0, "Failed to initialise libespeak-ng"
            lib.espeak_TextToPhonemes.restype = ctypes.c_char_p
            lib.espeak_TextToPhonemes.argtypes = [
                ctypes.POINTER(ctypes.c_char_p), ctypes.c_int, ctypes.c_int]
            Phonemizer._lib = lib

    def phonemize(self, text, voice=None):
        lib = Phonemizer._lib
        voice = voice or self.default_voice
        if voice != self.current_voice:
            with _in_data_parent():
                assert lib.espeak_SetVoiceByName(voice.encode("utf-8")) == 0, voice
            self.current_voice = voice
        buf = ctypes.c_char_p(text.encode("utf-8"))
        ptr = ctypes.pointer(buf)
        clauses = []
        while buf.value:
            out = lib.espeak_TextToPhonemes(ptr, _espeakCHARS_AUTO, _espeakPHONEMES_IPA)
            if out:
                clauses.append(out.decode("utf-8").strip())
        return _LANG_FLAG.sub("", " ".join(c for c in clauses if c))


if __name__ == "__main__":
    import sys
    p = Phonemizer("en-us")
    for t in sys.argv[1:] or ["hey canvas", "hey Kansas", "hey, can you pass the salt?"]:
        print(repr(t), "->", p.phonemize(t))
