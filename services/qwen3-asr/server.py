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


# ---------------- listening modes (Mike 2026-10-23) ----------------
# The phone Director tells Pitch what kind of answer comes next. "email": names joined with numbers and
# words, not normal English ("pineda mike b at yahoo dot com" -> pinedamikeb@yahoo.com). "digits": phone
# numbers ("zero nine one seven ..." -> 0917...). "serial": letters + numbers. Each clip in a mode is saved
# (local-runtime/asr-dataset/<mode>/) so confirmed answers can later fine-tune the model.
import json
DATASET_DIR = Path(__file__).resolve().parents[2] / "local-runtime" / "asr-dataset"
NUM_WORDS = {"zero": "0", "oh": "0", "o": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
             "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10", "isa": "1", "dalawa": "2", "tatlo": "3",
             "apat": "4", "lima": "5", "anim": "6", "pito": "7", "walo": "8", "siyam": "9"}


def spoken_to_digits(text):
    toks = re.findall(r"[a-z]+|\d+", str(text or "").lower())
    out, i = "", 0
    while i < len(toks):
        w = toks[i]
        if w in ("double", "triple") and i + 1 < len(toks) and toks[i + 1] in NUM_WORDS:
            out += NUM_WORDS[toks[i + 1]] * (2 if w == "double" else 3); i += 2; continue
        if w.isdigit(): out += w
        elif w in NUM_WORDS: out += NUM_WORDS[w]
        i += 1
    return out


def spoken_to_email(text):
    t = " " + str(text or "").lower().strip() + " "
    t = re.sub(r"[,!?]", " ", t)
    t = re.sub(r"\s+(at|@|et)\s+", " @ ", t)
    t = re.sub(r"\s+(dot|period|tuldok)\s+", " . ", t)
    t = re.sub(r"\s+underscore\s+", " _ ", t)
    t = re.sub(r"\s+(dash|hyphen)\s+", " - ", t)
    t = re.sub(r"\.\s*$", " ", t)
    if "@" not in t:
        return ""
    local, _, domain = t.partition("@")
    words = local.split()
    for intro in ("is", "ay", "email", "address", "it's", "its", "po", "my"):
        if intro in words:
            words = words[len(words) - words[::-1].index(intro):]
    local = "".join(NUM_WORDS.get(w, w) if len(w) > 1 else w for w in words)
    local = re.sub(r"[^a-z0-9._%+-]", "", local)
    domain = re.sub(r"\s+", "", domain)
    m = re.match(r"[a-z0-9.-]+\.[a-z]{2,}(\.[a-z]{2,})?", domain)
    if not local or not m:
        return ""
    return f"{local}@{m.group(0).rstrip('.')}"


def letter_pairs(a):
    return [a[i:i + 2] for i in range(len(a) - 1)]


def similarity(a, b):
    a = re.sub(r"[^a-z0-9]", "", a.split("@")[0]); b = re.sub(r"[^a-z0-9]", "", b.split("@")[0])
    A, B = letter_pairs(a), letter_pairs(b)
    if not A or not B:
        return 0.0
    pool, hit = list(B), 0
    for g in A:
        if g in pool:
            pool.remove(g); hit += 1
    return 2.0 * hit / (len(A) + len(B))


def save_clip(mode, path, info):
    try:
        d = DATASET_DIR / mode
        d.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time() * 1000) % 1000:03d}"
        import shutil
        shutil.copyfile(path, d / f"{stamp}.wav")
        (d / f"{stamp}.json").write_text(json.dumps(info, ensure_ascii=False))
        return f"{mode}/{stamp}"
    except Exception as exc:  # never block a call on this
        app.logger.warning("dataset save failed: %s", exc)
        return None


def transcribe_mode(path, mode, context, candidates):
    if mode == "email":
        res = model.transcribe(audio=[path, path], context=[context, ""], language=["English", "English"])
        raws = [str(r.text or "").strip() for r in res]
        emails = [spoken_to_email(r) or (re.search(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", r.lower()) or [None])[0] for r in raws]
        picked, why = None, "none"
        for e in emails:
            if not e:
                continue
            best = max(candidates, key=lambda c: similarity(e, c), default=None)
            if best and similarity(e, best) >= 0.6:
                picked, why = best, "known"
                break
        if not picked:
            picked = emails[0] or emails[1]
            why = "context" if emails[0] else ("plain" if emails[1] else "none")
        text = picked or raws[0] or raws[1]
        return {"text": text, "mode": "email", "email": picked, "picked": why, "raw_context": raws[0], "raw_plain": raws[1]}
    if mode == "digits":
        r = model.transcribe(audio=path, context=context, language="English")[0]
        raw = str(r.text or "").strip()
        d = spoken_to_digits(raw)
        return {"text": d if len(d) >= 7 else raw, "mode": "digits", "digits": d, "raw_context": raw}
    r = model.transcribe(audio=path, context=context, language="English")[0]
    raw = str(r.text or "").strip()
    return {"text": raw, "mode": mode, "raw_context": raw}


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
        mode = str(request.form.get("mode") or "").strip().lower()
        candidates = [c.strip().lower() for c in str(request.form.get("candidates") or "").split(",") if "@" in c]
        started = time.perf_counter()
        with lock:
            if mode in ("email", "digits", "serial"):
                decoded = transcribe_mode(path, mode, context, candidates)
                decoded["clip"] = save_clip(mode, path, {k: v for k, v in decoded.items() if k != "clip"} | {"context": context, "candidates": candidates})
                app.logger.info("ASR mode=%s %s", mode, json.dumps({k: decoded.get(k) for k in ("text", "picked", "raw_context", "raw_plain")}, ensure_ascii=False))
            elif requested_language in ("taglish", "mixed"):
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
