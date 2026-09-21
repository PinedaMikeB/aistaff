#!/usr/bin/env python3
"""Create derived StyleTTS2 data without modifying original recordings."""

from __future__ import annotations

import argparse
import csv
import json
import random
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

STYLE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = STYLE_ROOT.parents[1]
DATASET_ROOT = REPO_ROOT / "voice-training"
FRONTEND_ROOT = STYLE_ROOT / "frontend"
sys.path.insert(0, str(FRONTEND_ROOT))

from taglish_frontend import detect_language, styletts2_taglish_text, tokenize  # noqa: E402

STYLETTS2_SYMBOLS = set(
    "$"
    + ';:,.!?¡¿—…"«»“” '
    + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    + "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ"
)


def read_metadata(speaker: str) -> list[dict[str, str]]:
    path = DATASET_ROOT / "recordings" / speaker / "metadata.csv"
    rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, delimiter="|")
        for row in reader:
            if len(row) >= 2 and row[0].strip() and row[1].strip():
                rows.append({"id": row[0].strip(), "text": row[1].strip()})
    return rows


def classify_text(text: str) -> str:
    langs = [detect_language(token) for token in tokenize(text)]
    has_en = any(lang in {"english", "english_or_name", "taglish_affixed_english"} for lang in langs)
    has_fil = any(lang in {"filipino", "filipino_guess", "ambiguous", "taglish_affixed_english"} for lang in langs)
    if has_en and has_fil:
        return "taglish"
    if has_en:
        return "english"
    return "filipino"


def ffmpeg_resample(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size > 44:
        return
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-ac",
        "1",
        "-ar",
        "24000",
        "-sample_fmt",
        "s16",
        str(target),
    ]
    subprocess.run(command, check=True)


def deterministic_split(rows: list[dict[str, str]], val_fraction: float, seed: int) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    by_class: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        by_class.setdefault(row["class"], []).append(row)

    train: list[dict[str, str]] = []
    val: list[dict[str, str]] = []
    rng = random.Random(seed)
    for group in by_class.values():
        group = group[:]
        rng.shuffle(group)
        take = max(1, round(len(group) * val_fraction))
        val.extend(group[:take])
        train.extend(group[take:])

    train_texts = {row["norm_text"] for row in train}
    val = [row for row in val if row["norm_text"] not in train_texts]
    train.sort(key=lambda row: row["id"])
    val.sort(key=lambda row: row["id"])
    return train, val


def take_balanced(rows: list[dict[str, str]], total: int, seed: int) -> list[dict[str, str]]:
    by_class: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        by_class.setdefault(row["class"], []).append(row)
    rng = random.Random(seed)
    for group in by_class.values():
        rng.shuffle(group)
    selected: list[dict[str, str]] = []
    classes = sorted(by_class, key=lambda name: len(by_class[name]), reverse=True)
    while len(selected) < total and any(by_class.values()):
        for name in classes:
            if len(selected) >= total:
                break
            group = by_class[name]
            if not group:
                continue
            selected.append(group.pop())
    selected.sort(key=lambda row: row["id"])
    return selected


def write_manifest(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"{row['relative_wav']}|{row['styletts2_text']}|0" for row in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_ood_texts(path: Path) -> int:
    source = STYLE_ROOT / "evaluation" / "evaluation_sentences.txt"
    lines = []
    if source.exists():
        for text in source.read_text(encoding="utf-8").splitlines():
            text = text.strip()
            if not text:
                continue
            converted, _warnings = styletts2_taglish_text(text)
            lines.append(converted)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--speaker", default="mike-taglish-v1")
    parser.add_argument("--seed", type=int, default=20260830)
    parser.add_argument("--val-fraction", type=float, default=0.10)
    parser.add_argument("--skip-audio", action="store_true")
    args = parser.parse_args()

    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg is required for 24 kHz derived WAV creation")

    rows = read_metadata(args.speaker)
    out_audio_root = STYLE_ROOT / "output" / "resampled-24k" / args.speaker / "wavs"
    manifest_root = STYLE_ROOT / "data"
    source_wav_root = DATASET_ROOT / "recordings" / args.speaker / "wavs"

    prepared: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    for index, row in enumerate(rows, start=1):
        source = source_wav_root / f"{row['id']}.wav"
        target = out_audio_root / f"{row['id']}.wav"
        if not source.exists():
            warnings.append({"id": row["id"], "warning": "missing source wav"})
            continue
        if not args.skip_audio:
            ffmpeg_resample(source, target)
        text, text_warnings = styletts2_taglish_text(row["text"])
        unsupported = sorted({char for char in text if char not in STYLETTS2_SYMBOLS})
        for char in unsupported:
            warnings.append({"id": row["id"], "token": char, "warning": "unsupported StyleTTS2 symbol"})
        for warning in text_warnings:
            warnings.append({"id": row["id"], **warning})
        prepared.append(
            {
                **row,
                "relative_wav": str(target.relative_to(STYLE_ROOT / "output")),
                "source_wav": str(source),
                "derived_wav": str(target),
                "styletts2_text": text,
                "class": classify_text(row["text"]),
                "norm_text": " ".join(row["text"].casefold().split()),
            }
        )
        if index % 100 == 0:
            print(f"Prepared {index}/{len(rows)}")

    train, val = deterministic_split(prepared, args.val_fraction, args.seed)
    smoke_train = take_balanced(train, 120, args.seed + 1)
    smoke_val = take_balanced(val, 24, args.seed + 2)
    write_manifest(manifest_root / "train.txt", train)
    write_manifest(manifest_root / "val.txt", val)
    write_manifest(manifest_root / "all.txt", prepared)
    write_manifest(manifest_root / "smoke_train.txt", smoke_train)
    write_manifest(manifest_root / "smoke_val.txt", smoke_val)
    ood_rows = write_ood_texts(manifest_root / "OOD_texts.txt")

    summary = {
        "speaker": args.speaker,
        "seed": args.seed,
        "source_rows": len(rows),
        "prepared_rows": len(prepared),
        "train_rows": len(train),
        "val_rows": len(val),
        "smoke_train_rows": len(smoke_train),
        "smoke_val_rows": len(smoke_val),
        "ood_text_rows": ood_rows,
        "class_distribution": dict(Counter(row["class"] for row in prepared)),
        "audio_root_for_styletts2": str((STYLE_ROOT / "output").resolve()),
        "train_manifest": str((manifest_root / "train.txt").resolve()),
        "val_manifest": str((manifest_root / "val.txt").resolve()),
        "frontend": "custom Taglish: English words unchanged with English G2P + simple Filipino IPA-like G2P for Tagalog words",
        "warnings_count": len(warnings),
        "warnings_sample": warnings[:100],
    }
    (manifest_root / "manifest-summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    (manifest_root / "frontend-warnings.json").write_text(json.dumps(warnings, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
