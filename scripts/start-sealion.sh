#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LLAMA_ROOT="/home/ai-server/projects/llama-cpp"
MODEL="/srv/models/sea-lion/Gemma-SEA-LION-v4.5-E2B-IT-Q8_0.gguf"

if curl -fsS --max-time 2 http://127.0.0.1:8090/health >/dev/null 2>&1; then
  echo "SEA-LION is already healthy on port 8090"
  exit 0
fi

mkdir -p "$ROOT/run" "$ROOT/logs"
# AMD GPU libraries (without these llama-server fails: libamdhip64.so.7 not found).
ROCM_SITE="/home/ai-server/projects/zonos/Zonos/venv/lib/python3.12/site-packages"
export LD_LIBRARY_PATH="$ROCM_SITE/_rocm_sdk_core/lib:$ROCM_SITE/_rocm_sdk_libraries_gfx1151/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
cd "$LLAMA_ROOT"
setsid nohup ./build/hip/bin/llama-server \
  --host 0.0.0.0 --port 8090 --jinja -ngl 999 -c 65536 -np 2 \
  --chat-template-kwargs '{"enable_thinking":false}' \
  -m "$MODEL" --alias sealion >>"$ROOT/logs/sealion.log" 2>&1 </dev/null &
echo "$!" > "$ROOT/run/sealion.pid"
echo "Started SEA-LION as PID $!"
