# StyleTTS2 RunPod Setup

This is the planned training path. Do not launch GPU training until
`frontend-tests/report.md` is reviewed and the Taglish frontend is approved.

## Current Local Dataset

- Actor: Gab, female.
- Dataset folder: `voice-training/recordings/mike-taglish-v1`.
- Original audio: 22050 Hz mono WAV.
- StyleTTS2 official defaults expect 24000 Hz preprocessing, so create a
  derived 24 kHz training copy later. Do not overwrite the original WAVs.

## Official StyleTTS2 Facts To Verify On RunPod

Use the current official repository:

```bash
git clone https://github.com/yl4579/StyleTTS2.git
cd StyleTTS2
```

Official README currently says:

- Python >= 3.7.
- Install `requirements.txt`.
- Install `phonemizer` and `espeak-ng` for demos.
- First stage: `accelerate launch train_first.py --config_path ./Configs/config.yml`.
- Second stage: `python train_second.py --config_path ./Configs/config.yml`.
- Fine-tuning: `python train_finetune.py --config_path ./Configs/config_ft.yml`.
- Single-GPU fine-tuning option:
  `accelerate launch --mixed_precision=fp16 --num_processes=1 train_finetune_accelerate.py --config_path ./Configs/config_ft.yml`.
- Data list format: `filename.wav|transcription|speaker`.
- The aligner and pitch extractor are built around 24 kHz data by default.

## Recommended RunPod Shape

Start conservative:

- 1x NVIDIA GPU.
- Prefer 20-24 GB VRAM for fewer interruptions.
- 16 GB VRAM may work with lower batch size, lower `max_len`, and possibly
  delayed/skipped SLM adversarial training.
- Ubuntu image with CUDA/PyTorch already matched is preferred.

Stability matters more than maxing out VRAM.

## System Packages

On RunPod:

```bash
apt-get update
apt-get install -y git git-lfs ffmpeg espeak-ng build-essential
```

## Python Environment

Use a Python version supported by the current StyleTTS2 dependencies. Python
3.10 is a conservative starting point for current PyTorch/CUDA wheels.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip wheel setuptools
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
pip install phonemizer
```

Adjust the PyTorch CUDA wheel to match the RunPod image.

## Data Preparation

After frontend approval:

1. Copy `voice-training/` to RunPod.
2. Generate deterministic manifests from valid pairs only.
3. Create a derived 24 kHz WAV tree for StyleTTS2.
4. Keep the original 22050 Hz source WAVs unchanged.

The manifest rows should look like:

```text
recordings_24k/mike-taglish-v1/wavs/cls001.wav|<frontend text>|0
```

For a single-speaker Gab model, speaker id can be `0`.

## Fine-Tuning Strategy

Prefer fine-tuning from official pretrained StyleTTS2 components/checkpoints,
especially the LibriTTS checkpoint for multispeaker/reference-audio behavior,
instead of training from scratch.

Expected component policy:

- Load pretrained acoustic, diffusion, decoder, aligner, F0, and PL-BERT where
  compatible.
- Fine-tune cautiously with small learning rates.
- Avoid catastrophic forgetting and speaker drift.
- Revisit PL-BERT if the final frontend diverges heavily from English IPA.

## CPU Production Requirement

Production must not require CUDA or RunPod.

Expected Ryzen 7 5700G path:

- Load trained model once in a persistent local service.
- Run Native PyTorch CPU first.
- Cache style embeddings at service startup.
- Benchmark before making concurrency claims.
- Investigate TorchScript, ONNX Runtime, OpenVINO, and quantization only after
  baseline quality is confirmed.

Future API shape:

```json
{
  "text": "Hi po! Available pa po ang package natin today.",
  "style": "friendly"
}
```

The service should return generated audio or a future audio stream.

