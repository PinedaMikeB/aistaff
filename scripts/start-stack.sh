#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env file. Copy .env.example first."
  exit 1
fi

set -a
source .env
set +a

PORT="${APP_PORT:-3000}"
PUBLIC_URL="${APP_PUBLIC_URL:-}"

echo "Starting AI Inbox Sales Assistant on port ${PORT}..."
node src/server.js &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 2
if ! curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
  echo "Server failed health check on port ${PORT}."
  exit 1
fi

echo "Server healthy at http://127.0.0.1:${PORT}"

if [[ -n "$PUBLIC_URL" ]]; then
  echo "Public URL: $PUBLIC_URL"
  echo "Webhook: ${PUBLIC_URL%/}/api/webhooks/messenger"
  npm run configure:webhook || true
else
  echo "APP_PUBLIC_URL is empty. Start your Cloudflare tunnel, set APP_PUBLIC_URL, then run:"
  echo "  npm run configure:webhook"
fi

echo "Press Ctrl+C to stop."
wait "$SERVER_PID"
