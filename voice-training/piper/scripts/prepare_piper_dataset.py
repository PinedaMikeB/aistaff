#!/usr/bin/env python3
"""Prepare recordings for Piper training."""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-dir",
        default="voice-training/recordings/mike-taglish-v1",
        help="Directory containing metadata.csv and wavs/",
    )
    parser.add_argument(
        "--output-dir",
        default="voice-training/piper/gab-v1",
        help="Piper package output directory",
    )
    parser.add_argument("--speaker", default="Gab")
    parser.add_argument("--voice-id", default=None)
    parser.add_argument("--sample-rate", type=int, default=22050)
    return parser.parse_args()


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def ffprobe_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def read_metadata(path: Path) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.reader(f, delimiter="|"):
            if len(row) < 2:
                continue
            wav_id = row[0].strip()
            text = row[1].strip()
            if wav_id and text:
                rows.append((wav_id, text))
    return rows


def write_readme(output_dir: Path, summary: dict) -> None:
    readme = output_dir / "README.md"
    readme.write_text(
        f"""# {summary["speaker"]} Piper Training Package

This folder is generated from `{summary["source_dir"]}`.

## Dataset

- Speaker: {summary["speaker"]}
- Voice ID: {summary["voice_id"]}
- Piper quality target: medium
- Sample rate: {summary["sample_rate"]} Hz
- Clips: {summary["clip_count"]}
- Audio minutes: {summary["audio_minutes"]:.2f}
- Piper format: LJSpeech single-speaker

## Local Contents

- `dataset/wav/` - resampled WAV files for Piper
- `dataset/metadata.csv` - `id|text` rows, no header
- `test_sentences.txt` - quick Taglish generation prompts
- `training_commands.md` - commands for GPU training
- `summary.json` - prep/audit output

## Important Pronunciation Note

Piper normally uses espeak phonemes during preprocessing. For Taglish, English
words should stay English, while Tagalog words should stay Filipino-like. If a
plain `--language en-us` run sounds American on Tagalog, the next attempt should
use a custom phoneme/text strategy instead of accepting the default frontend.
""",
        encoding="utf-8",
    )


def write_training_commands(output_dir: Path, sample_rate: int, voice_id: str) -> None:
    (output_dir / "training_commands.md").write_text(
        f"""# Piper GPU Training Commands

Run these on a GPU machine after installing Piper training dependencies.

## 1. Preprocess

```bash
cd /workspace/gab-voice-lab/experiments/piper/{voice_id}
python3 -m piper_train.preprocess \\
  --language en-us \\
  --input-dir dataset \\
  --output-dir training-ready \\
  --dataset-format ljspeech \\
  --single-speaker \\
  --sample-rate {sample_rate}
```

## 2. Fine-tune Medium Voice

Use a medium single-speaker checkpoint first. Adjust the checkpoint path to the
downloaded Piper checkpoint.

```bash
python3 -m piper_train \\
  --dataset-dir training-ready \\
  --accelerator gpu \\
  --devices 1 \\
  --batch-size 16 \\
  --validation-split 0.05 \\
  --num-test-examples 10 \\
  --max_epochs 2000 \\
  --resume_from_checkpoint checkpoints/pretrained-medium.ckpt \\
  --checkpoint-epochs 25 \\
  --precision 32
```

If 16 GB VRAM has room, try `--batch-size 24`. If it OOMs, use `--batch-size 8`.

## 3. Export ONNX

```bash
python3 -m piper_train.export_onnx \\
  training-ready/lightning_logs/version_0/checkpoints/last.ckpt \\
  output/{voice_id}-medium.onnx

cp training-ready/config.json output/{voice_id}-medium.onnx.json
```

## 4. Inference Test

```bash
echo 'Magandang araw po. Available pa po ang package natin today.' | \\
  piper --model output/{voice_id}-medium.onnx --output_file output/test.wav
```
""",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    source_dir = Path(args.source_dir)
    output_dir = Path(args.output_dir)
    dataset_dir = output_dir / "dataset"
    wav_out_dir = dataset_dir / "wav"

    metadata_path = source_dir / "metadata.csv"
    wav_source_dir = source_dir / "wavs"
    rows = read_metadata(metadata_path)

    wav_out_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "training-ready").mkdir(parents=True, exist_ok=True)
    (output_dir / "checkpoints").mkdir(parents=True, exist_ok=True)
    (output_dir / "output").mkdir(parents=True, exist_ok=True)

    prepared: list[dict] = []
    missing: list[str] = []
    total_duration = 0.0

    for wav_id, text in rows:
        src = wav_source_dir / f"{wav_id}.wav"
        dst = wav_out_dir / f"{wav_id}.wav"
        if not src.exists():
            missing.append(wav_id)
            continue

        run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(src),
                "-ac",
                "1",
                "-ar",
                str(args.sample_rate),
                "-sample_fmt",
                "s16",
                str(dst),
            ]
        )
        duration = ffprobe_duration(dst)
        total_duration += duration
        prepared.append({"id": wav_id, "text": text, "seconds": duration})

    with (dataset_dir / "metadata.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, delimiter="|", lineterminator="\n")
        for item in prepared:
            writer.writerow([item["id"], item["text"]])

    (output_dir / "test_sentences.txt").write_text(
        "\n".join(
            [
                "Magandang araw po. Paano po kita matutulungan?",
                "Hi po, available pa po ang package natin today.",
                "Pwede po ba nating i-confirm ang delivery address ninyo?",
                "Kunin ko lang po ang complete name at contact number ninyo.",
                "Salamat po, ipapa-process ko na ang order ninyo ngayon.",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    summary = {
        "speaker": args.speaker,
        "voice_id": args.voice_id or output_dir.name,
        "source_dir": str(source_dir),
        "output_dir": str(output_dir),
        "sample_rate": args.sample_rate,
        "clip_count": len(prepared),
        "missing_count": len(missing),
        "missing": missing,
        "audio_seconds": total_duration,
        "audio_minutes": total_duration / 60.0,
        "min_seconds": min((item["seconds"] for item in prepared), default=0),
        "max_seconds": max((item["seconds"] for item in prepared), default=0),
    }
    (output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    write_readme(output_dir, summary)
    write_training_commands(output_dir, args.sample_rate, summary["voice_id"])

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
