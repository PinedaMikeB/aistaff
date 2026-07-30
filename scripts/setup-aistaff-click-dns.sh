#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TUNNEL_ID="52302446-f24e-4f17-9ed6-a369e2d0a8fc"
TUNNEL_NAME="marga-api"
DOMAIN="aistaff.click"
PUBLIC_URL="https://${DOMAIN}"

print_hostinger_steps() {
  cat <<EOF

============================================================
  Fix ${DOMAIN} — do these in Hostinger (your screenshot page)
============================================================

IMPORTANT: Do NOT add an A record with an empty "Points to" field.
That keeps the domain parked and will not reach your app.

Step 1 — Add ${DOMAIN} to Cloudflare (same account as marga.biz)
  https://dash.cloudflare.com/?to=/:account/add-site
  Enter: ${DOMAIN}
  Choose Free plan
  Cloudflare will show 2 nameservers, e.g.:
    aria.ns.cloudflare.com
    bob.ns.cloudflare.com
  (Copy YOUR two nameservers from Cloudflare — not these examples.)

Step 2 — In Hostinger → ${DOMAIN} → DNS / Nameservers
  Click "Change Nameservers"
  Replace parking nameservers:
    lunar.dns-parking.com
    solar.dns-parking.com
  With the 2 Cloudflare nameservers from Step 1.
  Save.

Step 3 — Wait for propagation (often 5–30 minutes, up to 24h)
  Re-run this script — it will auto-create tunnel DNS when ready:
    npm run setup:dns

============================================================
EOF
}

ns_ready() {
  dig +short NS "$DOMAIN" 2>/dev/null | grep -qi cloudflare
}

cf_ips() {
  dig +short A "$DOMAIN" 2>/dev/null | grep -E '^(104\.|172\.67\.)' >/dev/null 2>&1
}

route_dns() {
  echo "Creating Cloudflare CNAME routes for tunnel ${TUNNEL_NAME}..."
  cloudflared tunnel route dns "$TUNNEL_ID" "$DOMAIN" 2>&1 || true
  cloudflared tunnel route dns "$TUNNEL_ID" "www.${DOMAIN}" 2>&1 || true
}

verify_public() {
  local ok=0
  for _ in {1..30}; do
    if curl -fsS --max-time 8 "${PUBLIC_URL}/api/health" 2>/dev/null | grep -q '"ok":true'; then
      ok=1
      break
    fi
    sleep 4
  done
  [[ "$ok" -eq 1 ]]
}

echo "Checking ${DOMAIN} DNS..."
echo ""
echo "Current nameservers:"
dig +short NS "$DOMAIN" | sed 's/^/  /' || true
echo ""
echo "Current A record:"
dig +short A "$DOMAIN" | sed 's/^/  /' || true
echo ""

if ! ns_ready; then
  print_hostinger_steps
  echo "Status: still on Hostinger parking DNS — change nameservers to Cloudflare first."
  exit 1
fi

echo "Cloudflare nameservers detected."

if ! cf_ips; then
  echo "DNS not fully propagated yet. Waiting 30s..."
  sleep 30
fi

route_dns

echo ""
echo "Restarting Cloudflare tunnel..."
launchctl kickstart -k "gui/$(id -u)/com.marga.cloudflare-tunnel" >/dev/null 2>&1 || true
sleep 5

echo ""
echo "Verifying ${PUBLIC_URL}/api/health ..."
if verify_public; then
  echo "SUCCESS: ${DOMAIN} is live."
  curl -fsS "${PUBLIC_URL}/api/health"
  echo ""
  echo ""
  echo "Live URLs:"
  echo "  Landing: ${PUBLIC_URL}"
  echo "  Admin:   ${PUBLIC_URL}/admin/login"
  echo ""
  if [[ -f "$ROOT/.env" ]] && grep -q 'META_APP_SECRET=' "$ROOT/.env" && ! grep -q 'META_APP_SECRET=$' "$ROOT/.env" && ! grep -q 'META_APP_SECRET=""' "$ROOT/.env"; then
    echo "Updating Meta webhook..."
    (cd "$ROOT" && npm run configure:webhook) || true
  else
    echo "Next: add META_APP_SECRET to .env, then run: npm run configure:webhook"
  fi
  exit 0
fi

echo "DNS routes created but ${DOMAIN} is not responding yet."
echo "Wait a few minutes and run: npm run setup:dns"
echo "Or check: curl -I ${PUBLIC_URL}/api/health"
exit 1
