from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


VOWELS = "aeiou"
ACCENTED_TO_PLAIN = str.maketrans("áéíóúÁÉÍÓÚ", "aeiouAEIOU")


@dataclass(frozen=True)
class PhonemeResult:
    phoneme_string: str
    clause_phonemes: list[str]
    debug_words: list[dict]


def _strip_accents(text: str) -> str:
    return "".join(
        char for char in unicodedata.normalize("NFD", text) if unicodedata.category(char) != "Mn"
    )


def _word_has_terminal_glottal(raw_word: str) -> bool:
    return raw_word.endswith("^")


def _clean_word(raw_word: str) -> str:
    return re.sub(r"[^A-Za-zÁÉÍÓÚáéíóú^'-]", "", raw_word).strip("-'")


def _vowel_positions(word: str) -> list[int]:
    positions = []
    for index, char in enumerate(word):
        if char.lower() in VOWELS or char in "áéíóúÁÉÍÓÚ":
            positions.append(index)
    return positions


def _stress_index(raw_word: str) -> int | None:
    for index, char in enumerate(raw_word):
        if char in "áéíóúÁÉÍÓÚ":
            return index

    positions = _vowel_positions(raw_word)
    if not positions:
        return None
    if len(positions) == 1:
        return positions[0]
    return positions[-2]


def _tokenize(word: str, r_mode: str, terminal_glottal: bool) -> list[str]:
    tokens: list[str] = []
    index = 0
    stress_at = _stress_index(word)
    plain_word = word.translate(ACCENTED_TO_PLAIN).lower()

    while index < len(plain_word):
        chunk = plain_word[index:]
        if stress_at == index:
            tokens.append("ˈ")

        if chunk.startswith("ng"):
            tokens.append("ŋ")
            index += 2
            continue
        if chunk.startswith("ch"):
            tokens.append("ʧ")
            index += 2
            continue
        if chunk.startswith("dy") or chunk.startswith("di"):
            tokens.append("ʤ")
            index += 2
            continue
        if chunk.startswith("sy") or chunk.startswith("sh"):
            tokens.append("ʃ")
            index += 2
            continue
        if chunk.startswith("ts"):
            tokens.append("ʧ")
            index += 2
            continue

        char = plain_word[index]
        next_char = plain_word[index + 1] if index + 1 < len(plain_word) else ""

        if char == "a":
            tokens.append("ɑ")
        elif char == "e":
            tokens.append("ɛ")
        elif char == "i":
            tokens.append("i")
        elif char == "o":
            tokens.append("O")
        elif char == "u":
            tokens.append("u")
        elif char == "b":
            tokens.append("b")
        elif char == "d":
            tokens.append("d")
        elif char == "f":
            tokens.append("f")
        elif char == "g":
            tokens.append("ɡ")
        elif char == "h":
            tokens.append("h")
        elif char == "j":
            tokens.append("ʤ")
        elif char == "k":
            tokens.append("k")
        elif char == "l":
            tokens.append("l")
        elif char == "m":
            tokens.append("m")
        elif char == "n":
            tokens.append("n")
        elif char == "p":
            tokens.append("p")
        elif char == "q":
            tokens.append("k")
        elif char == "r":
            tokens.append(r_mode)
        elif char == "s":
            tokens.append("s")
        elif char == "t":
            tokens.append("t")
        elif char == "v":
            tokens.append("v")
        elif char == "w":
            tokens.append("w")
        elif char == "x":
            tokens.extend(["k", "s"])
        elif char == "y":
            tokens.append("j")
        elif char == "z":
            tokens.append("z")
        elif char == "c":
            tokens.append("s" if next_char in {"e", "i", "y"} else "k")
        else:
            pass
        index += 1

    if terminal_glottal:
        tokens.append("t")
    return tokens


def convert_to_kokoro_phonemes(annotated_text: str, clauses: list[str], r_mode: str = "ɾ") -> PhonemeResult:
    r_phone = "ɹ" if r_mode == "ɹ" else "ɾ"
    debug_words: list[dict] = []
    clause_phonemes: list[str] = []

    for clause in clauses:
        words = []
        for raw_word in clause.split():
            cleaned = _clean_word(raw_word)
            if not cleaned:
                continue
            terminal_glottal = _word_has_terminal_glottal(cleaned)
            cleaned = cleaned.rstrip("^")
            tokens = _tokenize(cleaned, r_phone, terminal_glottal)
            phoneme_word = "".join(tokens)
            if phoneme_word:
                words.append(phoneme_word)
                debug_words.append(
                    {
                        "word": raw_word,
                        "normalized": _strip_accents(cleaned.lower()),
                        "phonemes": phoneme_word,
                        "terminal_glottal_hack": terminal_glottal,
                    }
                )
        if words:
            clause_phonemes.append(" ".join(words))

    return PhonemeResult(
        phoneme_string=" | ".join(clause_phonemes),
        clause_phonemes=clause_phonemes,
        debug_words=debug_words,
    )
