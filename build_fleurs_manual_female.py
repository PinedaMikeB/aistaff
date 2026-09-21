#!/usr/bin/env python3
from __future__ import annotations

import csv
import shutil
import subprocess
import sys
import tarfile
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


ROOT = Path("/Volumes/Wotg Drive Mike/GitHub/Voice Agent Training Set")
MANUAL = ROOT / "Manual Download"
OUTPUT = ROOT / "piper_dataset_female_fleurs_final"
SPLITS = [
    ("train", "train.tar.gz", "train.tsv"),
    ("dev", "dev.tar.gz", "dev.tsv"),
    ("test", "test.tar.gz", "test.tsv"),
]


def load_female_rows() -> dict[str, str]:
    rows: dict[str, str] = {}
    for split, _, tsv_name in SPLITS:
        tsv_path = MANUAL / "metadata" / tsv_name
        if not tsv_path.exists():
            raise FileNotFoundError(f"Missing metadata: {tsv_path}")

        with tsv_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.reader(handle, delimiter="\t")
            count = 0
            for row in reader:
                if len(row) < 7:
                    continue
                audio_name = Path(row[1]).name
                raw_text = row[2].strip()
                gender = row[6].strip().upper()
                if gender == "FEMALE":
                    rows[audio_name] = raw_text
                    count += 1
        print(f"{split}: female rows={count}", flush=True)
    return rows


def convert_one(ffmpeg: str, src: Path, dest: Path) -> tuple[str, bool, str]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(src),
        "-ac",
        "1",
        "-ar",
        "22050",
        "-sample_fmt",
        "s16",
        str(dest),
    ]
    proc = subprocess.run(cmd, text=True, capture_output=True)
    try:
        src.unlink()
    except FileNotFoundError:
        pass
    if proc.returncode != 0:
        return dest.stem, False, proc.stderr.strip()
    return dest.stem, True, ""


def main() -> int:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required for the manual archive build")

    rows = load_female_rows()
    wav_dir = OUTPUT / "wavs"
    tmp_dir = Path(tempfile.mkdtemp(prefix="fleurs_female_raw_", dir="/private/tmp"))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    wav_dir.mkdir(parents=True, exist_ok=True)

    futures = []
    errors: list[str] = []
    found_names: set[str] = set()
    completed: dict[str, str] = {}
    max_workers = 8

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        for split, archive_name, _ in SPLITS:
            archive_path = MANUAL / archive_name
            if not archive_path.exists():
                raise FileNotFoundError(f"Missing archive: {archive_path}")
            print(f"{split}: scanning {archive_name}", flush=True)
            with tarfile.open(archive_path, "r:gz") as archive:
                for member in archive:
                    if not member.isfile():
                        continue
                    audio_name = Path(member.name).name
                    if audio_name not in rows:
                        continue
                    source = archive.extractfile(member)
                    if source is None:
                        continue
                    stem = Path(audio_name).stem
                    raw_path = tmp_dir / audio_name
                    raw_path.write_bytes(source.read())
                    found_names.add(audio_name)
                    futures.append(pool.submit(convert_one, ffmpeg, raw_path, wav_dir / f"{stem}.wav"))

                    if len(futures) % 200 == 0:
                        print(f"queued={len(futures)} latest={stem}", flush=True)

        for i, future in enumerate(as_completed(futures), start=1):
            stem, ok, err = future.result()
            if ok:
                source_name = f"{stem}.wav"
                completed[stem] = rows[source_name]
            else:
                errors.append(f"{stem}: {err}")
            if i % 200 == 0:
                print(f"converted={i}/{len(futures)}", flush=True)

    missing = sorted(set(rows) - found_names)
    metadata_path = OUTPUT / "metadata.csv"
    with metadata_path.open("w", encoding="utf-8", newline="") as handle:
        for stem in sorted(completed):
            handle.write(f"{stem}|{completed[stem]}\n")

    report_path = OUTPUT / "build_report.txt"
    report_path.write_text(
        "\n".join(
            [
                f"output={OUTPUT}",
                f"female_rows={len(rows)}",
                f"archive_matches={len(found_names)}",
                f"converted_wavs={len(completed)}",
                f"missing_in_archives={len(missing)}",
                f"errors={len(errors)}",
                "missing=" + ",".join(missing[:50]),
                "errors_sample=" + " || ".join(errors[:20]),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    shutil.rmtree(tmp_dir, ignore_errors=True)
    print(report_path.read_text(encoding="utf-8"), flush=True)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
