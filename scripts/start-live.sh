#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env file."
  exit 1
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "Starting AIStaff API with PM2..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 start ecosystem.config.cjs --update-env 2>/dev/null || pm2 restart aistaff-api --update-env
  pm2 save
else
  echo "PM2 not found. Install: npm install -g pm2"
  echo "Starting with node instead..."
  lsof -ti :3000 | xargs kill -9 2>/dev/null || true
  nohup node src/server.js > /tmp/aistaff-api.log 2>&1 &
  sleep 2
fi

if curl -sf http://127.0.0.1:3000/api/health >/dev/null; then
  echo "Local health: OK"
else
  echo "Local health: FAILED — check logs"
  exit 1
fi

PUBLIC_URL="${APP_PUBLIC_URL:-https://aistaff.click}"
if curl -sf "${PUBLIC_URL}/api/health" >/dev/null; then
  echo "Public health: OK — ${PUBLIC_URL}"
else
  echo "Public health: not reachable yet."
  echo "Ensure cloudflared tunnel is running:"
  echo "  cloudflared tunnel --config /Users/mike/.cloudflared/config.yml run marga-api"
fi

echo ""
echo "Live URLs:"
echo "  API / Webhook: ${PUBLIC_URL}/api/webhooks/messenger"
echo "  Admin panel:   ${PUBLIC_URL}/admin/login"
echo "  Health:        ${PUBLIC_URL}/api/health"
