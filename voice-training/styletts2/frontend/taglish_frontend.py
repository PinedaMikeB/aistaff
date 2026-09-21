#!/usr/bin/env python3
"""Prototype Taglish frontend for StyleTTS2 experiments.

This is an audit/prototyping frontend, not yet the final production frontend.
It deliberately avoids GPL Python dependencies. If `espeak-ng` is installed,
the harness can call the binary for baseline comparisons.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


FILIPINO_WORDS = {
    "ako",
    "amin",
    "aming",
    "ang",
    "araw",
    "asahan",
    "atin",
    "ba",
    "bago",
    "bakit",
    "balikan",
    "bayad",
    "bukas",
    "dito",
    "gabi",
    "hapon",
    "hindi",
    "i-check",
    "ikaw",
    "ilang",
    "inyo",
    "inyong",
    "isa",
    "kailangan",
    "kailan",
    "kami",
    "kanina",
    "kayo",
    "ko",
    "kung",
    "lang",
    "maganda",
    "magandang",
    "magkano",
    "mahal",
    "mahirap",
    "makati",
    "mga",
    "mo",
    "namin",
    "natin",
    "ng",
    "ngayon",
    "ninyo",
    "niyo",
    "pa",
    "paano",
    "para",
    "pasensya",
    "pero",
    "po",
    "pwede",
    "puwede",
    "quezon",
    "salamat",
    "sa",
    "sigurado",
    "sige",
    "tayo",
    "wala",
    "yung",
}

ENGLISH_WORDS = {
    "account",
    "again",
    "amount",
    "apologize",
    "appointment",
    "at",
    "available",
    "book",
    "business",
    "call",
    "can",
    "card",
    "check",
    "confirmed",
    "credit",
    "customer",
    "delay",
    "delivery",
    "during",
    "english",
    "for",
    "friday",
    "hi",
    "hundred",
    "is",
    "let",
    "me",
    "monday",
    "monthly",
    "package",
    "payment",
    "pm",
    "price",
    "our",
    "sales",
    "schedule",
    "service",
    "slight",
    "stock",
    "stocks",
    "the",
    "three",
    "thousand",
    "today",
    "tomorrow",
    "total",
    "two",
    "unit",
    "we",
    "your",
}


def _augment_wordlists_from_merge_js() -> None:
    merge_js = Path(__file__).resolve().parents[2] / "merge.js"
    try:
        source = merge_js.read_text(encoding="utf-8")
    except OSError:
        return
    for name, target in (("TL_WORDS", FILIPINO_WORDS), ("EN_WORDS", ENGLISH_WORDS)):
        match = re.search(rf"const {name} = new Set\(\(\"([^\"]+)\"\)\.split\(\" \"\)\);", source)
        if match:
            target.update(match.group(1).split())


_augment_wordlists_from_merge_js()

TOKEN_RE = re.compile(r"[A-Za-z]+(?:-[A-Za-z]+)?(?:'[A-Za-z]+)?|[0-9]+|[^\w\s]", re.UNICODE)
RARE_NATIVE_FILIPINO = re.compile(r"[cfjqvxz]", re.IGNORECASE)


@dataclass
class FrontendToken:
    raw: str
    kind: str
    language: str
    output: str
    warning: str | None = None


def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(text)


def normalize_word(token: str) -> str:
    return token.casefold().strip()


def detect_language(token: str) -> str:
    word = normalize_word(token)
    if not re.search(r"[a-z]", word):
        return "punct_or_number"
    if "-" in word:
        prefix, _, stem = word.partition("-")
        if prefix in {"i", "mag", "nag", "pag", "ipa", "naka", "maka"}:
            if stem in ENGLISH_WORDS or RARE_NATIVE_FILIPINO.search(stem):
                return "taglish_affixed_english"
    if word in FILIPINO_WORDS and word not in ENGLISH_WORDS:
        return "filipino"
    if word in ENGLISH_WORDS and word not in FILIPINO_WORDS:
        return "english"
    if word in FILIPINO_WORDS and word in ENGLISH_WORDS:
        return "ambiguous"
    if RARE_NATIVE_FILIPINO.search(word):
        return "english_or_name"
    return "filipino_guess"


def filipino_g2p_word(word: str) -> tuple[str, list[str]]:
    """Return a maintainable Filipino phone alias sequence.

    Phone aliases are ASCII so they can be audited in plain manifests. The final
    StyleTTS2 integration can map these aliases to IPA or model symbols.
    """

    w = normalize_word(word).replace("-", "")
    warnings: list[str] = []
    replacements = [
        ("ng", " NG "),
        ("mga", " m a NG a "),
        ("ch", " TS "),
        ("sh", " SY "),
        ("ñ", " NY "),
    ]
    for source, target in replacements:
        w = w.replace(source, target)
    phones: list[str] = []
    i = 0
    while i < len(w):
        char = w[i]
        if char.isspace():
            i += 1
            continue
        if w.startswith("NG", i):
            phones.append("NG")
            i += 2
            continue
        if w.startswith("TS", i):
            phones.append("TS")
            i += 2
            continue
        if w.startswith("SY", i):
            phones.append("SY")
            i += 2
            continue
        if w.startswith("NY", i):
            phones.append("NY")
            i += 2
            continue
        if char in "aeiou":
            phones.append(char.upper())
        elif char in "bcdfghjklmnpqrstvwxyz":
            phones.append(char.upper())
            if char in "cfjqvxz":
                warnings.append(f"non-native Filipino letter `{char}` in `{word}`")
        elif char in "'":
            pass
        else:
            warnings.append(f"unhandled Filipino character `{char}` in `{word}`")
        i += 1
    return " ".join(phones), warnings


def character_frontend(text: str) -> list[FrontendToken]:
    return [
        FrontendToken(raw=token, kind="token", language="character", output=" ".join(token))
        for token in tokenize(text)
    ]


def custom_taglish_frontend(text: str) -> list[FrontendToken]:
    tokens: list[FrontendToken] = []
    for token in tokenize(text):
        lang = detect_language(token)
        if lang == "punct_or_number":
            tokens.append(FrontendToken(raw=token, kind="literal", language=lang, output=token))
        elif lang in {"filipino", "filipino_guess", "ambiguous"}:
            output, warnings = filipino_g2p_word(token)
            tokens.append(
                FrontendToken(
                    raw=token,
                    kind="phone_alias",
                    language=lang,
                    output=output,
                    warning="; ".join(warnings) if warnings else None,
                )
            )
        elif lang == "taglish_affixed_english":
            prefix, _, stem = normalize_word(token).partition("-")
            output, warnings = filipino_g2p_word(prefix)
            tokens.append(
                FrontendToken(
                    raw=token,
                    kind="mixed",
                    language=lang,
                    output=f"{output} EN<{stem}>",
                    warning="; ".join(warnings) if warnings else "English stem needs English G2P",
                )
            )
        else:
            tokens.append(
                FrontendToken(
                    raw=token,
                    kind="english_placeholder",
                    language=lang,
                    output=f"EN<{normalize_word(token)}>",
                    warning="Route through English G2P in final frontend",
                )
            )
    return tokens


def espeak_ipa(text: str, voice: str) -> tuple[str | None, str | None]:
    binary = shutil.which("espeak-ng")
    if not binary:
        return None, "espeak-ng is not installed"
    command = [binary, "-q", "--ipa=3", "-v", voice, text]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        return None, exc.stderr.strip() or str(exc)
    return result.stdout.strip(), None


def flatten_outputs(tokens: list[FrontendToken]) -> str:
    return " | ".join(token.output for token in tokens)


FILIPINO_IPA_MAP = {
    "a": "a",
    "b": "b",
    "c": "k",
    "d": "d",
    "e": "ɛ",
    "f": "f",
    "g": "ɡ",
    "h": "h",
    "i": "i",
    "j": "dʒ",
    "k": "k",
    "l": "l",
    "m": "m",
    "n": "n",
    "o": "o",
    "p": "p",
    "q": "k",
    "r": "ɾ",
    "s": "s",
    "t": "t",
    "u": "u",
    "v": "v",
    "w": "w",
    "x": "ks",
    "y": "j",
    "z": "z",
}


def filipino_ipa_word(word: str) -> tuple[str, list[str]]:
    """Return a simple Filipino IPA-like rendering compatible with StyleTTS2 symbols."""

    w = normalize_word(word).replace("-", "")
    warnings: list[str] = []
    if w == "mga":
        return "maŋa", warnings
    phones: list[str] = []
    i = 0
    while i < len(w):
        if w.startswith("ng", i):
            phones.append("ŋ")
            i += 2
            continue
        if w.startswith("ny", i):
            phones.append("ɲ")
            i += 2
            continue
        if w.startswith("ch", i) or w.startswith("ts", i):
            phones.append("ʧ")
            i += 2
            continue
        if w.startswith("sh", i) or w.startswith("sy", i):
            phones.append("ʃ")
            i += 2
            continue
        char = w[i]
        if char in "'":
            i += 1
            continue
        mapped = FILIPINO_IPA_MAP.get(char)
        if mapped:
            phones.append(mapped)
            if char in "cfjqvxz":
                warnings.append(f"loanword/name letter `{char}` mapped in Filipino word `{word}`")
        else:
            warnings.append(f"unhandled Filipino character `{char}` in `{word}`")
        i += 1
    return "".join(phones), warnings


def english_ipa_word(word: str) -> tuple[str, str | None]:
    output, error = espeak_ipa(word, "en-us")
    if output:
        output = output.replace("\u200d", "").replace("\u0361", "")
    return (output or normalize_word(word), error)


TAGLISH_ENGLISH_IPA = {
    "account": "akawnt",
    "again": "aɡɛn",
    "amount": "amawnt",
    "apologize": "apolodʒajs",
    "appointment": "apojntmɛnt",
    "available": "abɛjlabol",
    "balance": "balans",
    "best": "bɛst",
    "book": "buk",
    "booking": "bukiŋ",
    "business": "bisnɛs",
    "call": "kol",
    "can": "kan",
    "card": "kaɾd",
    "cash": "kaʃ",
    "check": "ʧɛk",
    "choose": "ʧus",
    "confirmed": "konfɛɾmd",
    "credit": "kɾɛdit",
    "delay": "dɛlej",
    "delivery": "dɛlibɛɾi",
    "discount": "diskawnt",
    "during": "duɾiŋ",
    "english": "iŋɡliʃ",
    "fee": "fi",
    "final": "fajnal",
    "friday": "fɾajdej",
    "free": "fɾi",
    "full": "ful",
    "good": "ɡud",
    "help": "hɛlp",
    "hi": "haj",
    "hundred": "handɾɛd",
    "installation": "instalejʃon",
    "is": "is",
    "let": "lɛt",
    "me": "mi",
    "mobile": "mobil",
    "monday": "mandej",
    "monthly": "mantli",
    "morning": "moɾniŋ",
    "name": "nejm",
    "notes": "nots",
    "number": "nambɛɾ",
    "official": "ofiʃal",
    "order": "oɾdɛɾ",
    "package": "pakɛdʒ",
    "payment": "pejmɛnt",
    "pickup": "pikap",
    "please": "plis",
    "premium": "pɾimjum",
    "previous": "pɾibjus",
    "process": "pɾosɛs",
    "ready": "ɾɛdi",
    "receipt": "ɾɛsit",
    "reference": "ɾɛfɛɾɛns",
    "reserve": "ɾisɛɾb",
    "reschedule": "ɾiskɛdʒul",
    "review": "ɾibju",
    "schedule": "skɛdʒul",
    "scheduled": "skɛdʒuld",
    "slot": "slot",
    "stock": "stak",
    "stocks": "staks",
    "the": "di",
    "this": "dis",
    "thousand": "tawsand",
    "three": "tɾi",
    "today": "tudej",
    "tomorrow": "tumɔɾow",
    "total": "total",
    "two": "tu",
    "unit": "junit",
    "we": "wi",
    "while": "wajl",
    "within": "witin",
    "your": "juɾ",
}


def taglish_english_ipa_word(word: str) -> tuple[str, str | None]:
    """Render English words with a Filipino Taglish accent for Gab training.

    The first smoke test used `en-us` espeak for English words, which pushed
    the model toward American R/TH/schwa sounds. This keeps common AIStaff
    English words closer to how Filipino Taglish speakers usually say them.
    """

    w = normalize_word(word).replace("'", "")
    mapped = TAGLISH_ENGLISH_IPA.get(w)
    if mapped:
        return mapped, None

    output, warnings = filipino_ipa_word(w)
    warning = "; ".join(warnings) if warnings else f"fallback Taglish-English spelling for `{word}`"
    return output, warning


def styletts2_taglish_text(text: str) -> tuple[str, list[dict[str, str]]]:
    """Produce a single StyleTTS2-compatible text string for training/inference smoke tests."""

    parts: list[str] = []
    warnings: list[dict[str, str]] = []
    for token in tokenize(text):
        lang = detect_language(token)
        if lang == "punct_or_number":
            parts.append("—" if token == "-" else token)
        elif lang in {"filipino", "filipino_guess", "ambiguous"}:
            output, token_warnings = filipino_ipa_word(token)
            parts.append(output)
            for warning in token_warnings:
                warnings.append({"token": token, "warning": warning})
        elif lang == "taglish_affixed_english":
            prefix, _, stem = normalize_word(token).partition("-")
            prefix_output, token_warnings = filipino_ipa_word(prefix)
            stem_output, error = english_ipa_word(stem)
            parts.append(prefix_output + stem_output)
            if error:
                warnings.append({"token": token, "warning": error})
            for warning in token_warnings:
                warnings.append({"token": token, "warning": warning})
        else:
            output, error = english_ipa_word(token)
            parts.append(output)
            if error:
                warnings.append({"token": token, "warning": error})

    text_out = " ".join(part for part in parts if part).replace(" ,", ",").replace(" .", ".").replace(" ?", "?").replace(" !", "!")
    return text_out, warnings
