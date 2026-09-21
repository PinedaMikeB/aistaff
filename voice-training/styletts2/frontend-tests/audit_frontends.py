#!/usr/bin/env python3
"""Compare candidate Taglish text frontends for StyleTTS2."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
STYLE_ROOT = ROOT / "voice-training" / "styletts2"
sys.path.insert(0, str(STYLE_ROOT / "frontend"))

from taglish_frontend import (  # noqa: E402
    character_frontend,
    custom_taglish_frontend,
    espeak_ipa,
    flatten_outputs,
    tokenize,
)


REQUIRED_SENTENCES = [
    "Kailangan po natin i-check ang account ninyo.",
    "Available po ba tomorrow?",
    "Pwede po nating schedule sa Friday.",
    "May delivery po ba sa Quezon City?",
    "The total amount is two thousand five hundred pesos.",
    "Hi po! We can book your appointment today.",
    "Magkano po ang monthly package?",
    "Let me check po kung available pa ang unit.",
    "Pwede po ba credit card?",
    "Your appointment is confirmed for Monday at three PM.",
]

AUDIT_WORDS = [
    "ng",
    "mga",
    "kailangan",
    "pwede",
    "puwede",
    "hindi",
    "ninyo",
    "natin",
    "namin",
    "po",
    "ba",
    "magkano",
    "salamat",
]


def read_metadata_sentences(limit: int = 48) -> list[str]:
    metadata_path = ROOT / "voice-training" / "recordings" / "mike-taglish-v1" / "metadata.csv"
    rows: list[str] = []
    if not metadata_path.exists():
        return rows
    with metadata_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, delimiter="|")
        for row in reader:
            if len(row) >= 2 and row[1].strip():
                rows.append(row[1].strip())

    selected: list[str] = []
    buckets = {
        "tagalog": [" po ", " ninyo", " natin", " magkano", " salamat", " kailangan"],
        "english": [" the ", " your ", " appointment ", " confirmed ", " total "],
        "taglish": [" po ", " check", " available", " schedule", " delivery", " package"],
        "numbers_prices": [" pesos", " thousand", " hundred", " monthly", " total"],
        "appointments": ["appointment", "schedule", "monday", "friday", "today", "tomorrow"],
        "sales_service": ["order", "delivery", "package", "customer", "available", "payment"],
    }
    lowered_rows = [(text, f" {text.casefold()} ") for text in rows]
    for needles in buckets.values():
        for text, lowered in lowered_rows:
            if text in selected:
                continue
            if any(needle in lowered for needle in needles):
                selected.append(text)
                break

    for text in rows:
        if len(selected) >= limit:
            break
        if text not in selected:
            selected.append(text)
    return selected[:limit]


def audit_sentence(text: str) -> dict:
    english_ipa, english_error = espeak_ipa(text, "en-us")
    spanish_ipa, spanish_error = espeak_ipa(text, "es")
    character = character_frontend(text)
    custom = custom_taglish_frontend(text)
    return {
        "sentence": text,
        "tokens": tokenize(text),
        "english_espeak": {"voice": "en-us", "output": english_ipa, "error": english_error},
        "spanish_espeak": {"voice": "es", "output": spanish_ipa, "error": spanish_error},
        "character": [token.__dict__ for token in character],
        "custom_taglish": [token.__dict__ for token in custom],
        "custom_joined": flatten_outputs(custom),
        "warnings": [token.warning for token in custom if token.warning],
    }


def write_markdown(results: list[dict], path: Path) -> None:
    lines = [
        "# Taglish Frontend Audit",
        "",
        "This report compares candidate text frontends before StyleTTS2 training.",
        "",
        "Important: a frontend is not approved just because it runs. Filipino and",
        "English pronunciation must be inspected before GPU training.",
        "",
        "## Environment",
        "",
    ]
    first = results[0] if results else {}
    lines.append(f"- English espeak status: `{first.get('english_espeak', {}).get('error') or 'available'}`")
    lines.append(f"- Spanish espeak status: `{first.get('spanish_espeak', {}).get('error') or 'available'}`")
    lines.extend(
        [
            "",
            "## Early Findings",
            "",
            "- Official StyleTTS2 demos use `phonemizer` plus `espeak-ng`; this is only a baseline for Taglish.",
            "- Spanish espeak may sometimes look closer to Filipino vowel spelling, but it is not a Tagalog frontend.",
            "- Character-based input is technically easy, but it changes alignment and PL-BERT assumptions.",
            "- The proposed route is language-aware English + Filipino G2P into one shared representation.",
            "",
            "## Required Word Probe",
            "",
        ]
    )
    for word in AUDIT_WORDS:
        item = audit_sentence(word)
        lines.append(f"### `{word}`")
        lines.append("")
        lines.append(f"- Tokens: `{item['tokens']}`")
        lines.append(f"- English espeak: `{item['english_espeak']['output'] or item['english_espeak']['error']}`")
        lines.append(f"- Spanish espeak: `{item['spanish_espeak']['output'] or item['spanish_espeak']['error']}`")
        lines.append(f"- Custom Taglish: `{item['custom_joined']}`")
        if item["warnings"]:
            lines.append(f"- Warnings: `{item['warnings']}`")
        lines.append("")

    lines.extend(["## Sentence Audit", ""])
    for index, result in enumerate(results, start=1):
        lines.append(f"### {index}. {result['sentence']}")
        lines.append("")
        lines.append(f"- Tokenized words: `{result['tokens']}`")
        lines.append(f"- English espeak: `{result['english_espeak']['output'] or result['english_espeak']['error']}`")
        lines.append(f"- Spanish espeak: `{result['spanish_espeak']['output'] or result['spanish_espeak']['error']}`")
        lines.append(f"- Character/token frontend: `{flatten_outputs([type('T', (), t) for t in result['character']])}`")
        lines.append(f"- Custom language-aware frontend: `{result['custom_joined']}`")
        if result["warnings"]:
            lines.append(f"- Warnings: `{result['warnings']}`")
        lines.append("")

    lines.extend(
        [
            "## Recommendation",
            "",
            "Do not train on raw English espeak output for Taglish. Continue developing",
            "the language-aware frontend, then use the exact same frontend for training",
            "manifests and CPU production inference.",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    output_dir = STYLE_ROOT / "frontend-tests"
    output_dir.mkdir(parents=True, exist_ok=True)

    sentences = REQUIRED_SENTENCES + read_metadata_sentences(limit=48)
    deduped = list(dict.fromkeys(sentences))
    results = [audit_sentence(sentence) for sentence in deduped]

    json_path = output_dir / "report.json"
    markdown_path = output_dir / "report.md"
    json_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    write_markdown(results, markdown_path)
    print(f"Audited {len(results)} sentences")
    print(f"Wrote {json_path}")
    print(f"Wrote {markdown_path}")


if __name__ == "__main__":
    main()

