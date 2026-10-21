#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/logs/voice-stack-restart.log"
mkdir -p "$ROOT/logs" "$ROOT/run"
exec >>"$LOG" 2>&1

pipeline="$(cd "$ROOT" && node -e 'process.stdout.write(require("./src/pitch/runtime-config").readConfig().pipeline)')"
echo "$(date -Is) restart requested for pipeline=$pipeline"

if [[ "$pipeline" == "local" ]]; then
  "$ROOT/scripts/start-qwen3-asr.sh"
  "$ROOT/scripts/start-sealion.sh"
  "$ROOT/scripts/start-piper-epoch180.sh"

  for _ in $(seq 1 120); do
    qwen=0; lion=0; piper=0
    curl -fsS --max-time 2 http://127.0.0.1:8190/health >/dev/null 2>&1 && qwen=1
    curl -fsS --max-time 2 http://127.0.0.1:8090/health >/dev/null 2>&1 && lion=1
    timeout 2 bash -c '</dev/tcp/127.0.0.1/5001' 2>/dev/null && piper=1
    [[ "$qwen$lion$piper" == "111" ]] && break
    sleep 1
  done
  if [[ "${qwen:-0}${lion:-0}${piper:-0}" != "111" ]]; then
    echo "Stack 4 services failed readiness: qwen=$qwen sealion=$lion piper=$piper"
    exit 1
  fi
fi

mapfile -t pitch_pids < <(pgrep -f 'node src/pitch/index.js' || true)
for pid in "${pitch_pids[@]}"; do
  [[ -n "$pid" ]] || continue
  kill -TERM "$pid" 2>/dev/null || true
done
for _ in $(seq 1 20); do
  pgrep -f 'node src/pitch/index.js' >/dev/null || break
  sleep 0.5
done

cd "$ROOT"
setsid nohup node src/pitch/index.js >>"$ROOT/logs/pitch-live.log" 2>&1 </dev/null &
echo "$!" > "$ROOT/run/pitch.pid"
echo "$(date -Is) started in-repo Pitch PID $! pipeline=$pipeline"
