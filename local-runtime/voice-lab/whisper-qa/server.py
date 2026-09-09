#!/usr/bin/env python3
"""
Whisper QA server for Voice Lab.

Loads whisper small ONCE and stays resident, so each take gets scored in
~1-2s on CPU instead of paying model-load cost per request. Runs on port
9891, called by voice-lab/server.js right after a take is written to disk.

WHY faster-whisper, not whisper.cpp: whisper.cpp needs to be compiled per
machine (no ffmpeg/build tools on this MacBook -- that was the whole reason
we couldn't do this earlier in the project). faster-whisper is pip-installable
and CTranslate2's int8 CPU path is fast enough for after-the-fact QA scoring,
where a couple of seconds per take is fine (unlike Pitch's live phone
pipeline, which cannot tolerate that latency).

WHY language=auto, not -l en (unlike Pitch's production config): this
dataset is deliberately Taglish -- pure English, pure Tagalog, and mixed
lines all appear on purpose. Forcing English would mis-score every Tagalog
and Taglish line as "wrong language" nonsense.
"""
import io
import json
import re
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from faster_whisper import WhisperModel

PORT = 9891
MODEL_SIZE = "small"

print(f"loading whisper {MODEL_SIZE} (CPU, int8)...", flush=True)
model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
print("ready", flush=True)

INITIAL_PROMPT = (
    "Filipino Taglish phone call. Ito po, kayo, wag, siguro, kasi, "
    "GCash, Lalamove, Shopee, LBC, J&T, Grab, Messenger, po, opo."
)

# Word forms of digits, both directions -- this is the exact fix for the
# false-positive pattern found in irenz-rerecord-production-small-617.csv:
# a script line reading "zero nine eight six" was flagged as wrong when
# whisper (correctly) transcribed it as "0986", because a naive text
# comparison sees those as completely different words. Normalizing both
# sides to the same digit form before comparing fixes this at the source
# instead of re-recording lines that were never actually wrong.
_WORD_TO_DIGIT = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
}

def normalize(text):
    """Lowercase, strip punctuation, collapse whitespace, spell digits out."""
    t = text.lower()
    t = re.sub(r"[^\w\s]", " ", t)
    words = t.split()
    words = [_WORD_TO_DIGIT.get(w, w) for w in words]
    # merge runs of ANY numeric tokens back into one string, e.g.
    # "0 9 1 7" -> "0917" (spelled-out digits) AND "0917 345 6789" -> "09173456789"
    # (whisper's own habit of chunking phone numbers with separators it then
    # inserts as punctuation, which normalize() has already turned into
    # whitespace). Without merging BOTH shapes, a perfectly correct phone
    # number take fails purely because the two sides group digits
    # differently -- this is the exact false-positive class the original
    # 617-line audit surfaced, just in a slightly different guise.
    merged, buf = [], []
    for w in words:
        if w.isdigit():
            buf.append(w)
        else:
            if buf:
                merged.append("".join(buf)); buf = []
            merged.append(w)
    if buf:
        merged.append("".join(buf))
    return merged

def word_error_rate(ref_words, hyp_words):
    """Standard WER via Levenshtein distance over words, 0 = perfect match."""
    n, m = len(ref_words), len(hyp_words)
    if n == 0:
        return 0.0 if m == 0 else 1.0
    dp = list(range(m + 1))
    for i in range(1, n + 1):
        prev = dp[0]
        dp[0] = i
        for j in range(1, m + 1):
            tmp = dp[j]
            cost = 0 if ref_words[i - 1] == hyp_words[j - 1] else 1
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + cost)
            prev = tmp
    return dp[m] / n

def score(expected_text, heard_text):
    ref = normalize(expected_text)
    hyp = normalize(heard_text)
    wer = word_error_rate(ref, hyp)
    similarity = max(0.0, 1.0 - wer)
    # threshold picked from the audit data: turbo-quality transcripts that
    # were genuinely correct takes scored >=0.6 similarity even with small
    # transcription noise; the 24 truly bad takes we found scored well below.
    passed = similarity >= 0.6
    return similarity, passed

def wav_bytes_to_float32_16k(raw_wav):
    """Decode a WAV (as written by voice-lab, 22050Hz mono 16-bit PCM) into
    float32 samples at 16kHz, which is what whisper expects. No ffmpeg
    needed -- Python's stdlib `wave` module reads the header, and a simple
    linear resample is more than adequate for STT input (unlike TTS output,
    where we cared about aliasing enough to use windowed-sinc)."""
    with wave.open(io.BytesIO(raw_wav), "rb") as w:
        rate = w.getframerate()
        n = w.getnframes()
        pcm = w.readframes(n)
    int16 = np.frombuffer(pcm, dtype=np.int16)
    audio = int16.astype(np.float32) / 32768.0

    target = 16000
    if rate != target:
        duration = len(audio) / rate
        new_len = int(round(duration * target))
        old_idx = np.linspace(0, len(audio) - 1, num=len(audio))
        new_idx = np.linspace(0, len(audio) - 1, num=new_len)
        audio = np.interp(new_idx, old_idx, audio).astype(np.float32)
    return audio


def transcribe(audio):
    segments, info = model.transcribe(
        audio,
        language=None,              # auto-detect: dataset mixes en/tl/taglish on purpose
        beam_size=5,
        best_of=5,
        no_speech_threshold=0.75,
        compression_ratio_threshold=2.8,  # faster-whisper's analogue of whisper.cpp's entropy_thold
        condition_on_previous_text=False,  # each take is an isolated utterance, not a continuous stream
        suppress_blank=True,
        initial_prompt=INITIAL_PROMPT,
    )
    return "".join(seg.text for seg in segments).strip()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep stdout to just load-time + errors

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "model": MODEL_SIZE})
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/check":
            self.send_response(404)
            self.end_headers()
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            payload = json.loads(body)
            wav_b64 = payload["wav_base64"]
            expected_text = payload["expected_text"]

            import base64
            raw_wav = base64.b64decode(wav_b64)
            audio = wav_bytes_to_float32_16k(raw_wav)
            heard = transcribe(audio)
            similarity, passed = score(expected_text, heard)

            self._json(200, {
                "heard": heard,
                "similarity": round(similarity, 3),
                "pass": passed,
            })
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print(f"Whisper QA server -> http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
