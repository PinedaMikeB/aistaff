#!/usr/bin/env python3
"""Validate AIStaff voice-training recordings without modifying source data."""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import wave
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class AudioInfo:
    ok: bool
    sample_rate: int | None = None
    channels: int | None = None
    sample_width_bytes: int | None = None
    frames: int | None = None
    duration_seconds: float | None = None
    error: str | None = None


def inspect_wav(path: Path) -> AudioInfo:
    try:
        with wave.open(str(path), "rb") as wav:
            sample_rate = wav.getframerate()
            channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            frames = wav.getnframes()
        duration = frames / sample_rate if sample_rate else 0.0
        if duration <= 0:
            return AudioInfo(
                ok=False,
                sample_rate=sample_rate,
                channels=channels,
                sample_width_bytes=sample_width,
                frames=frames,
                duration_seconds=duration,
                error="zero-length audio",
            )
        return AudioInfo(
            ok=True,
            sample_rate=sample_rate,
            channels=channels,
            sample_width_bytes=sample_width,
            frames=frames,
            duration_seconds=duration,
        )
    except Exception as exc:  # noqa: BLE001 - report the exact file problem.
        return AudioInfo(ok=False, error=str(exc))


def read_metadata(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, delimiter="|")
        for line_number, row in enumerate(reader, start=1):
            if not row or not any(cell.strip() for cell in row):
                continue
            file_id = row[0].strip() if len(row) >= 1 else ""
            text = row[1].strip() if len(row) >= 2 else ""
            rows.append({"line_number": line_number, "file_id": file_id, "text": text})
    return rows


def duration_stats(durations: list[float]) -> dict[str, float | None]:
    if not durations:
        return {
            "average_seconds": None,
            "median_seconds": None,
            "min_seconds": None,
            "max_seconds": None,
            "total_seconds": 0.0,
            "total_minutes": 0.0,
        }
    return {
        "average_seconds": round(statistics.mean(durations), 3),
        "median_seconds": round(statistics.median(durations), 3),
        "min_seconds": round(min(durations), 3),
        "max_seconds": round(max(durations), 3),
        "total_seconds": round(sum(durations), 3),
        "total_minutes": round(sum(durations) / 60, 3),
    }


def validate(dataset_root: Path) -> dict:
    recordings_root = dataset_root / "recordings"
    phrase_root = dataset_root / "phrases"
    speakers = []

    for speaker_dir in sorted(p for p in recordings_root.glob("*") if p.is_dir()):
        metadata_path = speaker_dir / "metadata.csv"
        wav_root = speaker_dir / "wavs"
        metadata_rows = read_metadata(metadata_path)
        wavs = {path.stem: path for path in sorted(wav_root.glob("*.wav"))}

        file_id_counts = Counter(row["file_id"] for row in metadata_rows)
        text_counts = Counter(row["text"].casefold().strip() for row in metadata_rows)
        duplicate_file_ids = sorted(fid for fid, count in file_id_counts.items() if count > 1)
        duplicate_texts = sorted(text for text, count in text_counts.items() if count > 1)

        missing_wavs = []
        invalid_metadata_rows = []
        corrupt_files = []
        usable_pairs = []
        sample_rates: Counter[str] = Counter()
        channel_counts: Counter[str] = Counter()
        sample_widths: Counter[str] = Counter()
        durations: list[float] = []
        audio_by_id: dict[str, dict] = {}

        for row in metadata_rows:
            file_id = row["file_id"]
            if not file_id or not row["text"]:
                invalid_metadata_rows.append(row)
                continue

            wav_path = wavs.get(file_id)
            if wav_path is None:
                missing_wavs.append(row)
                continue

            info = inspect_wav(wav_path)
            audio_by_id[file_id] = asdict(info)
            if not info.ok:
                corrupt_files.append({"file_id": file_id, "path": str(wav_path), "error": info.error})
                continue

            usable_pairs.append({"file_id": file_id, "text": row["text"], "wav": str(wav_path)})
            sample_rates[str(info.sample_rate)] += 1
            channel_counts[str(info.channels)] += 1
            sample_widths[str(info.sample_width_bytes)] += 1
            durations.append(float(info.duration_seconds or 0.0))

        metadata_file_ids = {row["file_id"] for row in metadata_rows}
        orphan_wavs = [
            {"file_id": file_id, "path": str(path)}
            for file_id, path in sorted(wavs.items())
            if file_id not in metadata_file_ids
        ]

        rejected_count = (
            len(missing_wavs)
            + len(orphan_wavs)
            + len(corrupt_files)
            + len(invalid_metadata_rows)
            + len(duplicate_file_ids)
        )

        speakers.append(
            {
                "speaker_folder": speaker_dir.name,
                "actor": "Gab",
                "actor_note": "Folder name is historical; the recorded actor is Gab, female.",
                "metadata_path": str(metadata_path),
                "wav_root": str(wav_root),
                "metadata_entries": len(metadata_rows),
                "wav_files": len(wavs),
                "usable_pairs": len(usable_pairs),
                "rejected_pairs_or_files": rejected_count,
                "missing_wavs": missing_wavs,
                "orphan_wavs": orphan_wavs,
                "corrupt_or_zero_length_files": corrupt_files,
                "invalid_metadata_rows": invalid_metadata_rows,
                "duplicate_file_ids": duplicate_file_ids,
                "duplicate_transcripts": duplicate_texts,
                "sample_rate_distribution": dict(sample_rates),
                "channel_distribution": dict(channel_counts),
                "sample_width_bytes_distribution": dict(sample_widths),
                "duration": duration_stats(durations),
                "audio_by_id": audio_by_id,
            }
        )

    phrase_files = sorted(str(path.relative_to(dataset_root)) for path in phrase_root.glob("*.json"))
    totals = {
        "speaker_folders": len(speakers),
        "metadata_entries": sum(s["metadata_entries"] for s in speakers),
        "wav_files": sum(s["wav_files"] for s in speakers),
        "usable_pairs": sum(s["usable_pairs"] for s in speakers),
        "rejected_pairs_or_files": sum(s["rejected_pairs_or_files"] for s in speakers),
        "total_usable_seconds": round(sum(s["duration"]["total_seconds"] for s in speakers), 3),
        "total_usable_minutes": round(sum(s["duration"]["total_minutes"] for s in speakers), 3),
    }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset_root": str(dataset_root),
        "phrase_files": phrase_files,
        "totals": totals,
        "speakers": speakers,
    }


def write_markdown(report: dict, path: Path) -> None:
    lines = [
        "# Dataset Validation Report",
        "",
        f"Generated: `{report['generated_at']}`",
        f"Dataset root: `{report['dataset_root']}`",
        "",
        "## Totals",
        "",
    ]
    for key, value in report["totals"].items():
        lines.append(f"- {key.replace('_', ' ')}: `{value}`")

    lines.extend(["", "## Speakers", ""])
    for speaker in report["speakers"]:
        lines.extend(
            [
                f"### {speaker['speaker_folder']}",
                "",
                f"- Actor: `{speaker['actor']}`",
                f"- Note: {speaker['actor_note']}",
                f"- Metadata rows: `{speaker['metadata_entries']}`",
                f"- WAV files: `{speaker['wav_files']}`",
                f"- Usable pairs: `{speaker['usable_pairs']}`",
                f"- Rejected pairs/files: `{speaker['rejected_pairs_or_files']}`",
                f"- Missing WAVs: `{len(speaker['missing_wavs'])}`",
                f"- Orphan WAVs: `{len(speaker['orphan_wavs'])}`",
                f"- Corrupt or zero-length files: `{len(speaker['corrupt_or_zero_length_files'])}`",
                f"- Duplicate file IDs: `{len(speaker['duplicate_file_ids'])}`",
                f"- Duplicate transcripts: `{len(speaker['duplicate_transcripts'])}`",
                f"- Sample rates: `{speaker['sample_rate_distribution']}`",
                f"- Channels: `{speaker['channel_distribution']}`",
                f"- Sample widths bytes: `{speaker['sample_width_bytes_distribution']}`",
                f"- Average duration: `{speaker['duration']['average_seconds']}` seconds",
                f"- Median duration: `{speaker['duration']['median_seconds']}` seconds",
                f"- Min duration: `{speaker['duration']['min_seconds']}` seconds",
                f"- Max duration: `{speaker['duration']['max_seconds']}` seconds",
                f"- Total usable duration: `{speaker['duration']['total_minutes']}` minutes",
                "",
            ]
        )

    lines.extend(
        [
            "## Notes",
            "",
            "- This script does not delete, resample, rewrite, or normalize source audio.",
            "- StyleTTS2 preparation should create derived training audio later if 24 kHz is required.",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", default="voice-training")
    parser.add_argument(
        "--output-dir",
        default="voice-training/styletts2/output/dataset-validation",
    )
    args = parser.parse_args()

    dataset_root = Path(args.dataset_root)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    report = validate(dataset_root)
    json_path = output_dir / "report.json"
    markdown_path = output_dir / "report.md"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    write_markdown(report, markdown_path)

    totals = report["totals"]
    print(f"Speakers: {totals['speaker_folders']}")
    print(f"Metadata entries: {totals['metadata_entries']}")
    print(f"WAV files: {totals['wav_files']}")
    print(f"Usable pairs: {totals['usable_pairs']}")
    print(f"Total usable minutes: {totals['total_usable_minutes']}")
    print(f"Wrote {json_path}")
    print(f"Wrote {markdown_path}")


if __name__ == "__main__":
    main()

