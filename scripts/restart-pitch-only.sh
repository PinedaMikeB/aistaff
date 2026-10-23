#!/usr/bin/env bash
# Restart ONLY the Pitch process (not SEA-LION / ASR / Piper). Safe to run over ssh:
# the process match is anchored to the start of the command line, so it never matches this script.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pids=$(pgrep -f '^node src/pitch/index.js' || true)
for p in $pids; do kill -TERM "$p" 2>/dev/null || true; done
for _ in $(seq 1 40); do pgrep -f '^node src/pitch/index.js' >/dev/null || break; sleep 0.5; done
if pgrep -f '^node src/pitch/index.js' >/dev/null; then echo "Pitch did not stop"; exit 1; fi
setsid nohup node src/pitch/index.js >>"$ROOT/logs/pitch-live.log" 2>&1 </dev/null &
echo "$!" > "$ROOT/run/pitch.pid"
for _ in $(seq 1 30); do
  sleep 1
  if tail -5 "$ROOT/logs/pitch-live.log" | grep -q "ready for calls"; then echo "Pitch restarted — ready for calls"; exit 0; fi
done
echo "Pitch started but not registered yet — check logs/pitch-live.log"; exit 1
