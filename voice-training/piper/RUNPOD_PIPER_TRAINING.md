# RunPod Piper Training Checklist

Use this when a GPU pod is ready. Keep this separate from StyleTTS2.

## 1. Upload Package From Mac

Replace the host/port/user with the current RunPod SSH details.

```bash
scp -P <PORT> -i ~/.ssh/id_ed25519 \
  voice-training/piper/archives/gab-piper-v1-dataset.tgz \
  root@<RUNPOD_PUBLIC_IP>:/workspace/
```

If RunPod only gives the proxy SSH command, ask Codex to check
`RUNPOD_PUBLIC_IP` and `RUNPOD_TCP_PORT_22` inside the pod first.

## 2. Unpack On Persistent Volume

```bash
mkdir -p /workspace/gab-voice-lab/experiments/piper
tar -xzf /workspace/gab-piper-v1-dataset.tgz \
  -C /workspace/gab-voice-lab/experiments/piper
```

Expected folder:

```text
/workspace/gab-voice-lab/experiments/piper/gab-v1/
```

## 3. Install Piper Training

Use a PyTorch GPU pod. Piper's original training guide recommends a CUDA
PyTorch environment, `espeak-ng`, and building `monotonic_align`.

```bash
apt-get update
apt-get install -y python3-dev gcc espeak-ng git

cd /workspace/gab-voice-lab
git clone https://github.com/rhasspy/piper.git tools/piper

cd /workspace/gab-voice-lab/tools/piper/src/python
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip wheel setuptools
pip install -e .
bash build_monotonic_align.sh
```

## 4. Download Base Checkpoint

Start with Piper medium Lessac. It is not Tagalog-native, but it is the common
fine-tune starting point and matches our 22,050 Hz medium package.

```bash
mkdir -p /workspace/gab-voice-lab/experiments/piper/gab-v1/checkpoints
cd /workspace/gab-voice-lab/experiments/piper/gab-v1/checkpoints
wget -O pretrained-medium.ckpt \
  'https://huggingface.co/datasets/rhasspy/piper-checkpoints/resolve/main/en/en_US/lessac/medium/epoch%3D2164-step%3D1355540.ckpt'
```

## 5. Preprocess Dataset

```bash
source /workspace/gab-voice-lab/tools/piper/src/python/.venv/bin/activate
cd /workspace/gab-voice-lab/experiments/piper/gab-v1

python3 -m piper_train.preprocess \
  --language en-us \
  --input-dir dataset \
  --output-dir training-ready \
  --dataset-format ljspeech \
  --single-speaker \
  --sample-rate 22050
```

## 6. Train

For RTX 4090, start with batch 32. If it fails, drop to 16.

```bash
python3 -m piper_train \
  --dataset-dir training-ready \
  --accelerator gpu \
  --devices 1 \
  --batch-size 32 \
  --validation-split 0.05 \
  --num-test-examples 10 \
  --max_epochs 2000 \
  --resume_from_checkpoint checkpoints/pretrained-medium.ckpt \
  --checkpoint-epochs 25 \
  --precision 32
```

## 7. Test During Training

Generate test phonemes:

```bash
/workspace/gab-voice-lab/tools/piper/lib/Linux-x86_64/piper_phonemize/lib/piper_phonemize \
  -l en-us \
  --espeak-data /workspace/gab-voice-lab/tools/piper/lib/Linux-x86_64/piper_phonemize/lib/espeak-ng-data \
  < test_sentences.txt > output/test_sentences.jsonl
```

Infer from a checkpoint:

```bash
python3 -m piper_train.infer \
  --sample-rate 22050 \
  --checkpoint training-ready/lightning_logs/version_0/checkpoints/<CHECKPOINT>.ckpt \
  --output-dir output/samples
```

## Important

If the first Piper samples still pronounce Tagalog with an English/American
frontend, do not keep training blindly. The next Piper experiment should use a
custom phoneme/text frontend so English words stay English and Tagalog words use
Filipino-like pronunciation.
