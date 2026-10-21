#!/usr/bin/env python3
import os
import re
import tempfile
import threading
import time
from pathlib import Path

import torch
from flask import Flask, jsonify, request
from qwen_asr import Qwen3ASRModel


MODEL_PATH = os.environ.get(
    "QWEN_ASR_MODEL",
    str(Path(__file__).resolve().parents[2] / "local-runtime/qwen3-asr/models/Qwen3-ASR-0.6B"),
)
HOST = os.environ.get("QWEN_ASR_HOST", "127.0.0.1")
PORT = int(os.environ.get("QWEN_ASR_PORT", "8190"))

app = Flask(__name__)
lock = threading.Lock()
# Long vocabulary prompts can be echoed when telephone audio is unclear.
# Keep the default empty and rely on independent language decodes instead.
TAGLISH_CONTEXT = ""
FILIPINO_CLUE = re.compile(
    r"\b(?:ako|ikaw|siya|kami|tayo|kayo|sila|ang|ng|nang|mga|sa|para|kung|"
    r"pwede|puwede|pede|pedi|ba|bang|opo|po|hindi|oo|kaya|marunong|"
    r"naiintindihan|mag[a-z]*|nag[a-z]*|pag[a-z]*)\b",
    re.IGNORECASE,
)
loaded_at = time.perf_counter()
model = Qwen3ASRModel.from_pretrained(
    MODEL_PATH,
    dtype=torch.bfloat16,
    device_map="cuda:0",
    attn_implementation="sdpa",
    # Taglish mode decodes auto, English, and Filipino together.
    max_inference_batch_size=3,
    max_new_tokens=128,
)


def qwen_language(value):
    value = str(value or "auto").strip().lower()
    if value in ("", "auto"):
        return None
    if value in ("tl", "fil", "filipino", "tagalog"):
        return "Filipino"
    if value in ("en", "english"):
        return "English"
    return value.title()


def normalize_taglish(text):
    text = str(text or "").strip()
    text = re.sub(r"\b(?:pedi|pede)\b", "Pwede", text, flags=re.IGNORECASE)
    text = re.sub(r"\bmagpa[ -]?buk\b", "magpa-book", text, flags=re.IGNORECASE)
    text = re.sub(r"\bmagbook\b", "mag-book", text, flags=re.IGNORECASE)
    return text


def transcribe_taglish(path, context):
    results = model.transcribe(
        audio=[path, path, path],
        context=[context, context, context],
        language=[None, "English", "Filipino"],
    )
    automatic, english, filipino = results
    auto_language = str(automatic.language or "").strip().lower()
    english_text = str(english.text or "").strip()
    filipino_text = str(filipino.text or "").strip()

    use_filipino = auto_language == "filipino" or bool(FILIPINO_CLUE.search(english_text))
    selected = filipino_text if use_filipino else english_text
    selected_decoder = "filipino" if use_filipino else "english"
    if not selected:
        selected = english_text or filipino_text or str(automatic.text or "").strip()
        selected_decoder = "fallback"

    return {
        "text": normalize_taglish(selected) if use_filipino else selected,
        "language": "Taglish",
        "selected_decoder": selected_decoder,
        "candidates": {
            "auto": str(automatic.text or "").strip(),
            "auto_language": str(automatic.language or "").strip(),
            "english": english_text,
            "filipino": filipino_text,
        },
    }


@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "model": MODEL_PATH,
        "device": torch.cuda.get_device_name(0),
        "load_seconds": round(time.perf_counter() - loaded_at, 3),
    })


@app.post("/inference")
def inference():
    upload = request.files.get("file")
    if upload is None:
        return jsonify({"error": "multipart field 'file' is required"}), 400

    suffix = os.path.splitext(upload.filename or "caller.wav")[1] or ".wav"
    fd, path = tempfile.mkstemp(prefix="qwen-asr-", suffix=suffix)
    os.close(fd)
    try:
        upload.save(path)
        requested_language = str(request.form.get("language") or "auto").strip().lower()
        language = qwen_language(requested_language)
        context = str(request.form.get("context") or TAGLISH_CONTEXT).strip()
        started = time.perf_counter()
        with lock:
            if requested_language in ("taglish", "mixed"):
                decoded = transcribe_taglish(path, context)
                candidates = decoded.get("candidates", {})
                app.logger.info(
                    "Taglish ASR selected=%s auto_language=%r auto=%r english=%r filipino=%r text=%r",
                    decoded.get("selected_decoder"),
                    candidates.get("auto_language"),
                    candidates.get("auto"),
                    candidates.get("english"),
                    candidates.get("filipino"),
                    decoded.get("text"),
                )
            else:
                result = model.transcribe(audio=path, context=context, language=language)[0]
                decoded = {
                    "text": str(result.text or "").strip(),
                    "language": result.language,
                    "selected_decoder": "single",
                }
        elapsed = time.perf_counter() - started
        text = decoded.pop("text")
        return jsonify({
            "text": text,
            "transcription": text,
            **decoded,
            "qwen_asr_seconds": round(elapsed, 3),
            "model": "Qwen3-ASR-0.6B",
        })
    except Exception as exc:
        app.logger.exception("Qwen-ASR inference failed")
        return jsonify({"error": str(exc)}), 500
    finally:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, threaded=True)
