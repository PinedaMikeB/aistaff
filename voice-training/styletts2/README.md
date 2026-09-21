# AIStaff StyleTTS2 Taglish Voice

This folder contains AIStaff-specific preparation work for fine-tuning
StyleTTS2 on Gab's Filipino Taglish voice.

Hard rules:

- Do not modify original WAV files in `voice-training/recordings/`.
- Do not overwrite original metadata.
- Do not start GPU training until the Taglish frontend is validated.
- Training may use CUDA on RunPod.
- Production inference must have a CPU-only Ryzen path.
- Training and inference must use exactly the same text frontend.

Current dataset source:

- Speaker/actor: Gab, female.
- Local folder: `voice-training/recordings/mike-taglish-v1`.
- Folder name is historical and does not identify the actor.

Primary commands:

```bash
python3 voice-training/styletts2/scripts/validate_dataset.py
python3 voice-training/styletts2/frontend-tests/audit_frontends.py
```

The validator writes reports under `voice-training/styletts2/output/`.
The frontend audit writes `voice-training/styletts2/frontend-tests/report.md`.

