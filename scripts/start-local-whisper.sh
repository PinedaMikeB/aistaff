#!/usr/bin/env bash
set -euo pipefail

WHISPER_DIR="${PITCH_WHISPER_CPP_DIR:-/home/ai-server/projects/whisper}"
MODEL="${PITCH_WHISPER_CPP_MODEL:-$WHISPER_DIR/models/ggml-small.bin}"
SERVER="${PITCH_WHISPER_CPP_SERVER:-$WHISPER_DIR/build-hip/bin/whisper-server}"
HOST="${PITCH_WHISPER_CPP_HOST:-127.0.0.1}"
PORT="${PITCH_WHISPER_CPP_PORT:-8188}"
THREADS="${PITCH_WHISPER_CPP_THREADS:-8}"

ROCM_SITE="${PITCH_ROCM_SITE:-/home/ai-server/projects/zonos/Zonos/venv/lib/python3.12/site-packages}"
ROCM_CORE="$ROCM_SITE/_rocm_sdk_core"
ROCM_GFX="$ROCM_SITE/_rocm_sdk_libraries_gfx1151"
export LD_LIBRARY_PATH="$ROCM_CORE/lib:$ROCM_GFX/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

exec "$SERVER" \
  --host "$HOST" \
  --port "$PORT" \
  --model "$MODEL" \
  --language auto \
  --threads "$THREADS"
