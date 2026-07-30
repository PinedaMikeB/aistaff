#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
RUNNER_DIR="$HOME/.aistaff-launchd"
AUTOMATION_HOME="$HOME/Library/Application Support/AIStaff"
LOG_DIR="$HOME/Library/Logs/AIStaff"
PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
NODE_BIN="/opt/homebrew/bin/node"
BACKUP_HOUR="${AISTAFF_BACKUP_HOUR:-15}"
BACKUP_MINUTE="${AISTAFF_BACKUP_MINUTE:-30}"
APP_PORT="${APP_PORT:-3000}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing .env at $ENV_FILE" >&2
  echo "Run: node scripts/bootstrap-env.js" >&2
  exit 1
fi

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Node not found at $NODE_BIN" >&2
  exit 1
fi

if [[ ! -x "$PG_BIN/pg_isready" ]]; then
  echo "Postgres tools not found at $PG_BIN" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${DATABASE_URL:?DATABASE_URL missing from .env}"

if [[ "$DATABASE_URL" =~ ^postgresql://([^:@/]+)(:([^@]*))?@([^:/]+)(:([0-9]+))?/([^?]+) ]]; then
  PGUSER="${BASH_REMATCH[1]}"
  PGHOST="${BASH_REMATCH[4]}"
  PGPORT="${BASH_REMATCH[6]:-5432}"
  PGDATABASE="${BASH_REMATCH[7]}"
else
  echo "Could not parse DATABASE_URL from .env" >&2
  exit 1
fi

mkdir -p "$LAUNCH_DIR" "$RUNNER_DIR" "$LOG_DIR" "$AUTOMATION_HOME/scripts" "$AUTOMATION_HOME/state" "$ROOT/logs"
chmod 700 "$RUNNER_DIR"

cp "$ENV_FILE" "$AUTOMATION_HOME/state/aistaff.env"
chmod 600 "$AUTOMATION_HOME/state/aistaff.env"

API_RUNNER="$RUNNER_DIR/start-aistaff-api.sh"
cat > "$API_RUNNER" <<RUNNER
#!/usr/bin/env bash
set -euo pipefail
for _ in {1..90}; do
  if "$PG_BIN/pg_isready" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; then
    cd "$ROOT"
    exec "$NODE_BIN" src/server.js
  fi
  sleep 2
done
echo "Postgres did not become ready for AIStaff on ${PGHOST}:${PGPORT}/${PGDATABASE}." >&2
exit 1
RUNNER
chmod 755 "$API_RUNNER"

BACKUP_SCRIPT="$AUTOMATION_HOME/scripts/backup-aistaff-postgres.sh"
cp "$ROOT/scripts/backup-aistaff-postgres.sh" "$BACKUP_SCRIPT"
chmod 755 "$BACKUP_SCRIPT"

write_plist() {
  local label="$1"
  local program="$2"
  local workdir="$3"
  local stdout="$4"
  local stderr="$5"
  local plist="$LAUNCH_DIR/$label.plist"

  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$program</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$workdir</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$stdout</string>
  <key>StandardErrorPath</key>
  <string>$stderr</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/opt/homebrew/opt/node/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>APP_PORT</key>
    <string>$APP_PORT</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
PLIST

  chmod 644 "$plist"
  launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  launchctl enable "gui/$(id -u)/$label"
  echo "Installed $label -> $plist"
}

BACKUP_PLIST="$LAUNCH_DIR/com.aistaff.postgres-backup.plist"
cat > "$BACKUP_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.aistaff.postgres-backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$BACKUP_SCRIPT</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PG_BIN</key>
    <string>$PG_BIN</string>
    <key>AISTAFF_ENV_FILE</key>
    <string>$AUTOMATION_HOME/state/aistaff.env</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>$BACKUP_HOUR</integer>
    <key>Minute</key>
    <integer>$BACKUP_MINUTE</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/aistaff-postgres-backup.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/aistaff-postgres-backup.err.log</string>
  <key>WorkingDirectory</key>
  <string>$AUTOMATION_HOME</string>
</dict>
</plist>
PLIST

chmod 644 "$BACKUP_PLIST"
launchctl bootout "gui/$(id -u)" "$BACKUP_PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$BACKUP_PLIST"
launchctl enable "gui/$(id -u)/com.aistaff.postgres-backup"

write_plist \
  "com.aistaff.api" \
  "$API_RUNNER" \
  "$ROOT" \
  "$LOG_DIR/aistaff-api.launchd.log" \
  "$LOG_DIR/aistaff-api.launchd.err.log"

echo ""
echo "Patching marga Cloudflare tunnel health gate to wait for AIStaff..."
bash "$ROOT/scripts/patch-marga-tunnel-health-gate.sh"

echo ""
echo "Waiting for AIStaff API health on http://127.0.0.1:${APP_PORT}/api/health ..."
ready=0
for _ in {1..45}; do
  if curl -fsS --max-time 3 "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  echo "AIStaff API is not healthy yet. Check logs:" >&2
  echo "  tail -f $LOG_DIR/aistaff-api.launchd.err.log" >&2
  exit 1
fi

echo ""
echo "AIStaff launchd services installed."
echo ""
echo "Services:"
echo "  com.aistaff.api              -> port ${APP_PORT} (KeepAlive)"
echo "  com.aistaff.postgres-backup  -> daily $(printf '%02d:%02d' "$BACKUP_HOUR" "$BACKUP_MINUTE") local time"
echo ""
echo "Logs:"
echo "  $LOG_DIR/aistaff-api.launchd.log"
echo "  $LOG_DIR/aistaff-postgres-backup.log"
echo ""
echo "Backups:"
echo "  ~/AIStaff Backups/Database"
echo ""
echo "Useful commands:"
echo "  launchctl kickstart -k gui/\$(id -u)/com.aistaff.api"
echo "  bash scripts/backup-aistaff-postgres.sh"
echo "  curl http://127.0.0.1:${APP_PORT}/api/health"
