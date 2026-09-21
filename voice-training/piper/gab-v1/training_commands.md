# Piper GPU Training Commands

Run these on a GPU machine after installing Piper training dependencies.

## 1. Preprocess

```bash
cd /workspace/gab-voice-lab/experiments/piper/gab-v1
python3 -m piper_train.preprocess \
  --language en-us \
  --input-dir dataset \
  --output-dir training-ready \
  --dataset-format ljspeech \
  --single-speaker \
  --sample-rate 22050
```

## 2. Fine-tune Medium Voice

Use a medium single-speaker checkpoint first. Adjust the checkpoint path to the
downloaded Piper checkpoint.

```bash
python3 -m piper_train \
  --dataset-dir training-ready \
  --accelerator gpu \
  --devices 1 \
  --batch-size 16 \
  --validation-split 0.05 \
  --num-test-examples 10 \
  --max_epochs 2000 \
  --resume_from_checkpoint checkpoints/pretrained-medium.ckpt \
  --checkpoint-epochs 25 \
  --precision 32
```

If 16 GB VRAM has room, try `--batch-size 24`. If it OOMs, use `--batch-size 8`.

## 3. Export ONNX

```bash
python3 -m piper_train.export_onnx \
  training-ready/lightning_logs/version_0/checkpoints/last.ckpt \
  output/gab-piper-medium.onnx

cp training-ready/config.json output/gab-piper-medium.onnx.json
```

## 4. Inference Test

```bash
echo 'Magandang araw po. Available pa po ang package natin today.' | \
  piper --model output/gab-piper-medium.onnx --output_file output/test.wav
```
