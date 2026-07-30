from __future__ import annotations

import json
import os
import re
import ssl
from dataclasses import dataclass
from pathlib import Path
from urllib import error, request

import certifi


DEFAULT_MODEL = "gpt-5-mini"


class LanguageBrainError(RuntimeError):
    """Raised when the language-brain step fails."""


@dataclass(frozen=True)
class BrainResult:
    normalized_text: str
    annotated_text: str
    clauses: list[str]
    notes: list[str]
    model: str


def _load_parent_env_file() -> None:
    root_env = Path(__file__).resolve().parents[1] / ".env"
    if not root_env.exists():
        return

    for raw_line in root_env.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def load_openai_api_key() -> str:
    _load_parent_env_file()
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise LanguageBrainError("OPENAI_API_KEY is not set.")
    return api_key


def _extract_json_object(text: str) -> dict:
    text = text.strip()
    if not text:
        raise LanguageBrainError("Language brain returned an empty response.")

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise LanguageBrainError("Language brain did not return valid JSON.") from None
        return json.loads(match.group(0))


def _fallback_normalize(text: str) -> BrainResult:
    cleaned = " ".join(str(text).split())
    replacements = [
        (r"\bqc\b", "Quezon City"),
        (r"\bmm\b", "Metro Manila"),
        (r"\bpwede\b", "puwede"),
        (r"\bpede\b", "puwede"),
        (r"\bst\b", "street"),
        (r"\brd\b", "road"),
    ]
    for pattern, repl in replacements:
        cleaned = re.sub(pattern, repl, cleaned, flags=re.IGNORECASE)

    number_map = {
        "0": "zero",
        "1": "isa",
        "2": "dalawa",
        "3": "tatlo",
        "4": "apat",
        "5": "lima",
        "6": "anim",
        "7": "pito",
        "8": "walo",
        "9": "siyam",
        "10": "sampu",
    }
    cleaned = re.sub(
        r"\b([0-9]|10)\b(?=\s+\w)",
        lambda match: (
            "dalawang" if match.group(1) == "2"
            else f"{number_map.get(match.group(1), match.group(1))}ng"
        ),
        cleaned,
    )
    cleaned = re.sub(r"\b([0-9]|10)\b", lambda match: number_map.get(match.group(1), match.group(1)), cleaned)
    cleaned = cleaned.strip()
    if cleaned:
        cleaned = cleaned[0].upper() + cleaned[1:]

    clauses = [segment.strip() for segment in re.split(r"\b(?:baka|pero|kasi)\b|[|.!?;:,]+", cleaned) if segment.strip()]
    return BrainResult(
        normalized_text=cleaned,
        annotated_text=cleaned,
        clauses=clauses or [cleaned],
        notes=["Fallback normalization was used because the GPT step failed."],
        model="fallback-rules",
    )


def normalize_transcript(text: str, strict: bool = False) -> BrainResult:
    cleaned = " ".join(str(text or "").split())
    if not cleaned:
        raise LanguageBrainError("Text is required.")

    prompt = (
        "You are a Filipino/Tagalog speech-normalization engine for a local Kokoro TTS pipeline.\n"
        "Rewrite rough transcript text into Kokoro-friendly intermediate Tagalog.\n"
        "Goals:\n"
        "- expand abbreviations\n"
        "- spell out numbers in natural Filipino or Tagalog when appropriate\n"
        "- clean casual Taglish only where it improves spoken delivery\n"
        "- split long text into short speakable clauses\n"
        "- optionally add stress marks using acute accents when confidence is high\n"
        "- optionally use a house-style glottal marker '^' at word-end when helpful\n"
        "- keep meaning, tone, and named entities intact\n"
        "- do not invent facts\n"
        "\n"
        "Output valid JSON only with this schema:\n"
        "{\n"
        '  "normalized_text": string,\n'
        '  "annotated_text": string,\n'
        '  "clauses": string[],\n'
        '  "notes": string[]\n'
        "}\n"
        "\n"
        "Rules:\n"
        "- `annotated_text` may contain acute accents and '^'.\n"
        "- `clauses` must be short, natural speaking units.\n"
        "- Use plain UTF-8 text. No markdown.\n"
        f"\nTranscript:\n{cleaned}"
    )

    payload = {
        "model": os.environ.get("KOKORO_LANGUAGE_BRAIN_MODEL", DEFAULT_MODEL),
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }

    try:
        api_key = load_openai_api_key()
    except LanguageBrainError:
        if strict:
            raise
        return _fallback_normalize(cleaned)
    req = request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        with request.urlopen(req, timeout=90, context=ssl_context) as response:
            body = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        if strict:
            raise LanguageBrainError(f"OpenAI HTTP {exc.code}: {details}") from exc
        fallback = _fallback_normalize(cleaned)
        return BrainResult(
            normalized_text=fallback.normalized_text,
            annotated_text=fallback.annotated_text,
            clauses=fallback.clauses,
            notes=[f"GPT step failed with OpenAI HTTP {exc.code}; fallback normalization was used."],
            model=fallback.model,
        )
    except Exception as exc:  # noqa: BLE001
        if strict:
            raise LanguageBrainError(f"OpenAI request failed: {exc}") from exc
        fallback = _fallback_normalize(cleaned)
        return BrainResult(
            normalized_text=fallback.normalized_text,
            annotated_text=fallback.annotated_text,
            clauses=fallback.clauses,
            notes=[f"GPT step failed ({exc}); fallback normalization was used."],
            model=fallback.model,
        )

    content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
    parsed = _extract_json_object(content)

    normalized_text = " ".join(str(parsed.get("normalized_text", cleaned)).split()).strip()
    annotated_text = " ".join(str(parsed.get("annotated_text", normalized_text)).split()).strip()
    clauses = [str(item).strip() for item in parsed.get("clauses", []) if str(item).strip()]
    notes = [str(item).strip() for item in parsed.get("notes", []) if str(item).strip()]

    if not normalized_text:
        return _fallback_normalize(cleaned)
    if not clauses:
        clauses = [segment.strip() for segment in re.split(r"[|.!?;:,]+", annotated_text or normalized_text) if segment.strip()]

    return BrainResult(
        normalized_text=normalized_text,
        annotated_text=annotated_text or normalized_text,
        clauses=clauses or [normalized_text],
        notes=notes,
        model=body.get("model") or payload["model"],
    )
