# Gab Piper Training Package

This folder is generated from `voice-training/recordings/mike-taglish-v1`.

## Dataset

- Speaker: Gab
- Piper quality target: medium
- Sample rate: 22050 Hz
- Clips: 970
- Audio minutes: 79.70
- Piper format: LJSpeech single-speaker

## Local Contents

- `dataset/wav/` - resampled WAV files for Piper
- `dataset/metadata.csv` - `id|text` rows, no header
- `test_sentences.txt` - quick Taglish generation prompts
- `training_commands.md` - commands for GPU training
- `summary.json` - prep/audit output

## Important Pronunciation Note

Piper normally uses espeak phonemes during preprocessing. For Gab Taglish, English
words should stay English, while Tagalog words should stay Filipino-like. If a
plain `--language en-us` run sounds American on Tagalog, the next attempt should
use a custom phoneme/text strategy instead of accepting the default frontend.
