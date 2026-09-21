# Piper Training Prep

This area is for Piper only. It does not replace or erase the StyleTTS2 work.

## Goal

Prepare Gab as a Piper single-speaker voice so we can train on a GPU later and
export a lightweight `.onnx` model for local AIStaff voice calls.

## Prepare Dataset

```bash
python3 voice-training/piper/scripts/prepare_piper_dataset.py
```

Generated package:

```text
voice-training/piper/gab-v1/
  dataset/
    metadata.csv
    wav/
  training-ready/
  checkpoints/
  output/
  test_sentences.txt
  training_commands.md
  summary.json
```

## Notes

Piper training uses a dataset preparation step, a training step, and an ONNX
export step. The official Piper guide expects `metadata.csv` plus `wav/` input
and recommends fine-tuning from an existing checkpoint instead of training from
scratch.
