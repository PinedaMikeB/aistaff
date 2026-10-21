#!/usr/bin/env bash
set -euo pipefail

printf 'Pitch: '
pgrep -fa 'node src/pitch/index.js' || true
printf 'Qwen3-ASR: '
curl -fsS --max-time 2 http://127.0.0.1:8190/health || true
printf '\nSEA-LION: '
curl -fsS --max-time 2 http://127.0.0.1:8090/health || true
voice="$(cd "$(dirname "$0")/.." && node -e 'process.stdout.write(require("./src/pitch/runtime-config").readConfig().local.piperVoice || "unknown")')"
printf '\nPiper %s: ' "$voice"
if timeout 2 bash -c '</dev/tcp/127.0.0.1/5001' 2>/dev/null; then echo healthy; else echo down; fi
