#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIPER_ROOT="/home/ai-server/projects/piper-serve"
readarray -t PIPER_CONFIG < <(cd "$ROOT" && node - <<'NODE'
const local = require("./src/pitch/runtime-config").readConfig().local || {};
console.log(local.piperVoice || "zonos1110_22050_epoch180");
console.log(Number(local.piperLengthScale ?? 1));
console.log(Number(local.piperNoiseScale ?? 0.667));
console.log(local.piperSpeakerId == null ? "" : Number(local.piperSpeakerId));
NODE
)
VOICE="${PIPER_CONFIG[0]}"
LENGTH_SCALE="${PIPER_CONFIG[1]}"
NOISE_SCALE="${PIPER_CONFIG[2]}"
SPEAKER_ID="${PIPER_CONFIG[3]:-}"
MODEL="$PIPER_ROOT/voices/$VOICE.onnx"
[[ -f "$MODEL" ]] || MODEL="$ROOT/local-runtime/piper/voices/$VOICE.onnx"
if [[ ! -f "$MODEL" ]]; then
  echo "Piper model is not installed: $VOICE" >&2
  exit 1
fi

mapfile -t PIPER_PIDS < <(pgrep -f 'piper.http_server.*--port 5001' || true)
if ((${#PIPER_PIDS[@]})); then
  running="$(ps -o args= -p "${PIPER_PIDS[0]}")"
  speaker_matches=0
  if [[ -n "$SPEAKER_ID" && "$running" == *" -s $SPEAKER_ID"* ]]; then speaker_matches=1; fi
  if [[ -z "$SPEAKER_ID" && "$running" != *" -s "* ]]; then speaker_matches=1; fi
  if [[ "$running" == *"-m $MODEL"* && "$running" == *"--length-scale $LENGTH_SCALE"* && "$running" == *"--noise-scale $NOISE_SCALE"* && "$speaker_matches" == 1 ]]; then
    echo "Piper $VOICE is already listening on port 5001"
    exit 0
  fi
  for pid in "${PIPER_PIDS[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  for _ in $(seq 1 20); do
    timeout 1 bash -c '</dev/tcp/127.0.0.1/5001' 2>/dev/null || break
    sleep 0.25
  done
fi

mkdir -p "$ROOT/run" "$ROOT/logs"
cd "$PIPER_ROOT"
PIPER_ARGS=(--host 127.0.0.1 --port 5001 -m "$MODEL" --length-scale "$LENGTH_SCALE" --noise-scale "$NOISE_SCALE")
if [[ -n "$SPEAKER_ID" ]]; then PIPER_ARGS+=(-s "$SPEAKER_ID"); fi
setsid nohup venv/bin/python -m piper.http_server \
  "${PIPER_ARGS[@]}" \
  >>"$ROOT/logs/piper.log" 2>&1 </dev/null &
echo "$!" > "$ROOT/run/piper.pid"
echo "Started Piper $VOICE as PID $!"
