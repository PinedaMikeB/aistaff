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
cd "$LLAMA_ROOT"
setsid nohup ./build/hip/bin/llama-server \
  --host 127.0.0.1 --port 8090 --jinja -ngl 999 -c 16384 \
  -m "$MODEL" --alias sealion >>"$ROOT/logs/sealion.log" 2>&1 </dev/null &
echo "$!" > "$ROOT/run/sealion.pid"
echo "Started SEA-LION as PID $!"
