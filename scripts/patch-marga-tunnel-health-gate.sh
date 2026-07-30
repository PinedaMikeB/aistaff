#!/usr/bin/env bash
set -euo pipefail

TUNNEL_RUNNER="${MARGA_TUNNEL_RUNNER:-$HOME/.marga-launchd/start-marga-cloudflare-tunnel.sh}"
AISTAFF_HEALTH_URL="${AISTAFF_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
MARKER="curl -fsS --max-time 3 ${AISTAFF_HEALTH_URL}"

if [[ ! -f "$TUNNEL_RUNNER" ]]; then
  echo "Marga tunnel runner not found: $TUNNEL_RUNNER" >&2
  echo "Install marga launchd first, then re-run install-aistaff-launchd.sh" >&2
  exit 1
fi

if grep -Fq "$MARKER" "$TUNNEL_RUNNER"; then
  echo "Tunnel health gate already includes AIStaff: $TUNNEL_RUNNER"
  exit 0
fi

python3 - "$TUNNEL_RUNNER" "$AISTAFF_HEALTH_URL" <<'PY'
from pathlib import Path
import sys

runner_path = Path(sys.argv[1])
health_url = sys.argv[2]
text = runner_path.read_text()

needle = "http://127.0.0.1:9200/health >/dev/null 2>&1; then"
replacement = (
    "http://127.0.0.1:9200/health >/dev/null 2>&1 \\\n"
    f"    && curl -fsS --max-time 3 {health_url} >/dev/null 2>&1; then"
)

if needle not in text:
    raise SystemExit(f"Expected marga health check not found in {runner_path}")

runner_path.write_text(text.replace(needle, replacement, 1))
print(f"Patched tunnel health gate: {runner_path}")
PY

chmod 755 "$TUNNEL_RUNNER"

LABEL="com.marga.cloudflare-tunnel"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if [[ -f "$PLIST" ]]; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  echo "Restarted $LABEL"
fi
