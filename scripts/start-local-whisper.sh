#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHISPER_DIR="$ROOT/local-runtime/whisper.cpp"
MODEL="${PITCH_WHISPER_CPP_MODEL:-$WHISPER_DIR/models/ggml-base.bin}"
HOST="${PITCH_WHISPER_CPP_HOST:-127.0.0.1}"
PORT="${PITCH_WHISPER_CPP_PORT:-8080}"
THREADS="${PITCH_WHISPER_CPP_THREADS:-6}"

exec "$WHISPER_DIR/build/bin/whisper-server" \
  --host "$HOST" \
  --port "$PORT" \
  --model "$MODEL" \
  --language auto \
  --max-context 0 \
  --vad \
  --vad-threshold "${PITCH_WHISPER_CPP_VAD_THRESHOLD:-0.50}" \
  --vad-min-speech-duration-ms "${PITCH_WHISPER_CPP_VAD_MIN_SPEECH_MS:-250}" \
  --vad-min-silence-duration-ms "${PITCH_WHISPER_CPP_VAD_MIN_SILENCE_MS:-500}" \
  --threads "$THREADS"
