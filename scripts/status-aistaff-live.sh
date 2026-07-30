#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PORT="${APP_PORT:-3000}"
CONFIGURED_URL="https://aistaff.click"
TUNNEL_URL="https://aistaff-api.marga.biz"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT/.env"
  set +a
  CONFIGURED_URL="${APP_PUBLIC_URL:-$CONFIGURED_URL}"
fi

check_launchctl() {
  local label="$1"
  if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
    echo "  $label: loaded"
  else
    echo "  $label: not loaded"
  fi
}

check_public() {
  local url="$1"
  if curl -fsS --max-time 8 "${url}/api/health" >/dev/null 2>&1; then
    echo "  OK  ${url}"
    return 0
  fi
  echo "  FAIL ${url}"
  return 1
}

echo "AIStaff live status"
echo ""
echo "LaunchAgents:"
check_launchctl "com.aistaff.api"
check_launchctl "com.aistaff.postgres-backup"
check_launchctl "com.marga.cloudflare-tunnel"
check_launchctl "com.marga.nosleep"
echo ""
echo "Local health:"
curl -fsS --max-time 5 "http://127.0.0.1:${APP_PORT}/api/health" || echo "  FAILED"
echo ""
echo "Public health:"
check_public "$TUNNEL_URL" || true
if [[ "$CONFIGURED_URL" != "$TUNNEL_URL" ]]; then
  check_public "$CONFIGURED_URL" || true
fi
echo ""
echo "Live URLs (tunnel): ${TUNNEL_URL}/admin/login"
echo "Target URL (.env):  ${CONFIGURED_URL}/admin/login"
