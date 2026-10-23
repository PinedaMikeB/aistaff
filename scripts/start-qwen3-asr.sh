#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="$ROOT/local-runtime/qwen3-asr"
ROCM_SITE="/home/ai-server/projects/zonos/Zonos/venv/lib/python3.12/site-packages"
PID_FILE="$ROOT/run/qwen3-asr.pid"
LOG_FILE="$ROOT/logs/qwen3-asr.log"

if curl -fsS --max-time 2 http://127.0.0.1:8190/health >/dev/null 2>&1; then
  echo "Qwen3-ASR is already healthy on port 8190"
  exit 0
fi

mkdir -p "$ROOT/run" "$ROOT/logs"
export LD_LIBRARY_PATH="$ROCM_SITE/_rocm_sdk_core/lib:$ROCM_SITE/_rocm_sdk_libraries_gfx1151/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export QWEN_ASR_MODEL="$RUNTIME/models/Qwen3-ASR-0.6B"
setsid nohup "$RUNTIME/venv/bin/python" "$ROOT/services/qwen3-asr/server.py" \
  >>"$LOG_FILE" 2>&1 </dev/null &
echo "$!" > "$PID_FILE"
echo "Started Qwen3-ASR as PID $!"
