#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DROPLET="${AISTAFF_DROPLET:-root@168.144.96.24}"
REMOTE_APP="/opt/aistaff"
REMOTE_DEPLOY="/opt/aistaff-deploy"
MARGA_STATE="${MARGA_DO_STATE:-/Volumes/Wotg Drive Mike/GitHub/marga-platform/state/digitalocean-margabase.env}"
ENV_FILE="${AISTAFF_ENV_FILE:-$ROOT/.env}"

[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }
[[ -f "$MARGA_STATE" ]] || { echo "Missing $MARGA_STATE" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$MARGA_STATE"
set +a

DB_NAME="${AISTAFF_DB_NAME:-aistaff_click}"
DO_DATABASE_URL="postgresql://${DO_PGUSER}:${DO_PGPASSWORD}@${DO_PGHOST}:${DO_PGPORT}/${DB_NAME}?sslmode=${DO_PGSSLMODE}"

echo "Syncing app to ${DROPLET}:${REMOTE_APP}..."
ssh "$DROPLET" "mkdir -p '$REMOTE_APP' '$REMOTE_DEPLOY'"
rsync -az --delete \
  --exclude node_modules \
  --exclude .env \
  --exclude remotion/node_modules \
  --exclude .git \
  "$ROOT/" "${DROPLET}:${REMOTE_APP}/"

echo "Writing production .env on droplet..."
ssh "$DROPLET" "cat > '$REMOTE_APP/.env'" <<EOF
$(grep -v '^DATABASE_URL=' "$ENV_FILE" | grep -v '^APP_BASE_URL=' | grep -v '^APP_PUBLIC_URL=')
DATABASE_URL="${DO_DATABASE_URL}"
APP_BASE_URL="https://aistaff.click"
APP_PUBLIC_URL="https://aistaff.click"
NODE_ENV=production
EOF
ssh "$DROPLET" "chmod 600 '$REMOTE_APP/.env'"

echo "Installing compose + Caddy routing..."
scp "$ROOT/deploy/digitalocean/docker-compose.yml" "${DROPLET}:${REMOTE_DEPLOY}/docker-compose.yml"
scp "$ROOT/deploy/digitalocean/Caddyfile" "${DROPLET}:/opt/marga-deploy/Caddyfile"

ssh "$DROPLET" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/aistaff-deploy
docker compose pull
docker compose up -d
cd /opt/marga-deploy
docker compose up -d caddy
sleep 3
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
REMOTE

echo ""
echo "Deployed. Verify from droplet:"
echo "  ssh ${DROPLET} 'docker exec marga-deploy-caddy-1 wget -qO- http://aistaff-api:3000/api/health'"
echo ""
echo "After DNS points aistaff.click -> 168.144.96.24 (Cloudflare proxied A):"
echo "  curl -s https://aistaff.click/api/health"
echo "  npm run configure:webhook"
