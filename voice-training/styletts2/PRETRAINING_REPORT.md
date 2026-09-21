# StyleTTS2 Pre-Training Report

Status: not ready for GPU training yet. Dataset validation passes, but the
Taglish frontend still needs espeak baseline output and final approval.

## Dataset

- Actor: Gab, female.
- Speaker folder: `voice-training/recordings/mike-taglish-v1`.
- Folder-name note: `mike-taglish-v1` is historical; it is not the actor name.
- Metadata rows: 970.
- WAV files: 970.
- Usable WAV/transcript pairs: 970.
- Missing WAV files: 0.
- Orphan WAV files: 0.
- Corrupt or zero-length WAV files: 0.
- Duplicate file IDs: 0.
- Duplicate transcripts: 0.
- Audio format: 22050 Hz, mono, 16-bit PCM.
- Total usable audio: 79.697 minutes.
- Average clip duration: 4.93 seconds.
- Median clip duration: 4.864 seconds.
- Duration range: 2.816 to 7.68 seconds.

Full generated reports:

- `voice-training/styletts2/output/dataset-validation/report.md`
- `voice-training/styletts2/output/dataset-validation/report.json`

## Official StyleTTS2 Findings

Current official StyleTTS2 documentation says:

- Python requirement: Python >= 3.7.
- Python dependencies are in `requirements.txt`, including `torch`,
  `torchaudio`, `SoundFile`, `librosa`, `accelerate`, and `transformers`.
- Demo phonemization uses `phonemizer` and `espeak-ng`.
- First stage training command:
  `accelerate launch train_first.py --config_path ./Configs/config.yml`.
- Second stage training command:
  `python train_second.py --config_path ./Configs/config.yml`.
- Fine-tuning command:
  `python train_finetune.py --config_path ./Configs/config_ft.yml`.
- Single-GPU fine-tuning option:
  `accelerate launch --mixed_precision=fp16 --num_processes=1 train_finetune_accelerate.py --config_path ./Configs/config_ft.yml`.
- Data list rows are `filename.wav|transcription|speaker`.
- The default aligner and pitch extractor path expects 24 kHz data.
- PL-BERT bundled in the repo is English-trained; official docs warn it may
  not work well for other languages and mention multilingual PL-BERT.

Official sources:

- https://github.com/yl4579/StyleTTS2
- https://raw.githubusercontent.com/yl4579/StyleTTS2/main/README.md
- https://raw.githubusercontent.com/yl4579/StyleTTS2/main/requirements.txt
- https://raw.githubusercontent.com/yl4579/StyleTTS2/main/meldataset.py

## Current Text Path

The current implementation separates phonemization from dataset loading:

1. Raw text is normalized/phonemized in demo or preprocessing code.
2. The dataset manifest stores the resulting text/phoneme string.
3. `meldataset.py` reads rows with `filename.wav|transcription|speaker`.
4. `TextCleaner` maps each character to a symbol id.
5. The resulting token ids feed PL-BERT/text encoder/StyleTTS2.

The symbol table in `meldataset.py` includes ASCII letters, punctuation, and
IPA characters. That means our final frontend can output a shared phoneme
string, but whatever we choose must be used identically for training manifests
and production inference.

## Frontend Audit Status

Created:

- `voice-training/styletts2/frontend/taglish_frontend.py`
- `voice-training/styletts2/frontend-tests/audit_frontends.py`
- `voice-training/styletts2/frontend-tests/report.md`
- `voice-training/styletts2/frontend-tests/report.json`

The audit covers:

- 10 required Taglish test sentences.
- 48 representative sentences selected from Gab's metadata.
- Filipino probes: `ng`, `mga`, `kailangan`, `pwede`, `puwede`, `hindi`,
  `ninyo`, `natin`, `namin`, `po`, `ba`, `magkano`, `salamat`.
- Candidate approaches: English espeak baseline, Spanish espeak comparison,
  character/token frontend, custom language-aware Taglish frontend.

Local blocker:

- This Mac currently does not have `espeak-ng` installed, so English and
  Spanish espeak outputs are recorded as unavailable in the report.

## Frontend Recommendation

Preferred architecture: language-aware English + Filipino routing.

- Detect Filipino words, English words, numbers, names, and affixed Taglish
  forms such as `i-check`.
- Route Filipino words through a maintainable Filipino G2P.
- Route English words through an English G2P.
- Normalize both routes into one shared symbol representation.
- Use exactly that shared representation for StyleTTS2 training and production.

Do not use English espeak alone for Filipino. Do not use Spanish espeak as the
final solution unless future listening tests prove it, which is unlikely.

## Character-Based Viability

Character input is possible mechanically because StyleTTS2's `TextCleaner`
maps characters to ids. It is not the first choice because:

- It weakens pretrained phoneme/PL-BERT assumptions.
- It can make alignment harder on a small 79.7-minute dataset.
- It gives the model less pronunciation guidance for English/Filipino
  code-switching.

Keep character mode as a baseline, not the main training plan.

## PL-BERT Implications

Official docs say the bundled PL-BERT is English-trained. For Taglish:

- English espeak IPA stays closest to the pretrained English path but damages
  Filipino pronunciation.
- A custom Filipino phone alias path may require PL-BERT adaptation or a
  multilingual PL-BERT experiment.
- The safest first experiment is a shared IPA-like representation that preserves
  English words through English G2P and Filipino words through Filipino G2P.

## Licensing Notes

- StyleTTS2 code: MIT.
- StyleTTS2 pretrained models: additional usage notice/permission language in
  the official README.
- `espeak-ng`: GPL-3.0-or-later; treat as a licensing risk for production.
- `phonemizer`: GPL per its source headers; treat as a licensing risk for
  production if bundled/imported.

Training-time use of GPL command-line tools is still a business/legal decision.
Production deployment should avoid silently bundling GPL dependencies.

## Recommended Pretrained Components

Start from official StyleTTS2 fine-tuning rather than training from scratch:

- Use LibriTTS checkpoint/components if reference-audio style support is the
  target.
- Keep ASR aligner and F0 extractor pretrained initially.
- Fine-tune cautiously with conservative learning rates.
- Revisit PL-BERT after frontend approval.

## Recommended RunPod GPU

- Preferred: 20-24 GB VRAM single NVIDIA GPU.
- Possible: 16 GB VRAM with conservative batch size, lower `max_len`, and
  delayed/skipped SLM adversarial phase if necessary.

Do not optimize for max batch size first. Stable fine-tuning is the priority.

## Expected CPU Deployment Path

Production target: Ryzen 7 5700G, 32 GB RAM, CPU-only.

Expected path:

- Native PyTorch CPU baseline.
- Persistent local service that loads model once.
- Cache style embeddings at startup.
- Benchmark on the actual Ryzen before concurrency claims.
- Investigate TorchScript, ONNX Runtime, OpenVINO, and quantization only after
  quality is stable.

## Files Created

- `voice-training/styletts2/README.md`
- `voice-training/styletts2/SETUP.md`
- `voice-training/styletts2/PRETRAINING_REPORT.md`
- `voice-training/styletts2/scripts/validate_dataset.py`
- `voice-training/styletts2/frontend/taglish_frontend.py`
- `voice-training/styletts2/frontend-tests/audit_frontends.py`
- `voice-training/styletts2/frontend-tests/report.md`
- `voice-training/styletts2/frontend-tests/report.json`
- `voice-training/styletts2/evaluation/evaluation_sentences.txt`
- `voice-training/styletts2/output/dataset-validation/report.md`
- `voice-training/styletts2/output/dataset-validation/report.json`

## Next Gate

Install `espeak-ng` locally or run the frontend audit on RunPod, then regenerate
`frontend-tests/report.md` with real English and Spanish espeak outputs. After
that, approve or revise the custom Taglish frontend before generating training
manifests.

