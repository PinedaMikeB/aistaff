# AIStaff Live Deployment

**Your setup:** Domain `aistaff.click` on Hostinger + Cloudflare Tunnel for the live API.

---

## Architecture (recommended for you)

```
Customer / Meta Webhook
        ↓
https://aistaff-api.marga.biz   ← Cloudflare Tunnel (already configured)
        ↓
Your server (Node.js port 3000)
        ↓
PostgreSQL (local or VPS)
```

**Hostinger** = domain registrar + email (optional)  
**Cloudflare** = public HTTPS tunnel to your app (no open ports needed)  
**Not Hostinger shared hosting** — Node.js needs a machine that runs 24/7 (your Mac, Hostinger VPS, or other VPS).

---

## Option A — Live now (what you have today)

Uses subdomain **`aistaff-api.marga.biz`** on your existing Cloudflare tunnel.

### 1. Start the app (always-on with PM2)

```bash
cd "/Volumes/Wotg Drive Mike/GitHub/AI-Inbox-Sales-Assistant"
npm install -g pm2   # once
bash scripts/start-live.sh
```

### 2. Keep Cloudflare tunnel running

Tunnel config: `/Users/mike/.cloudflared/config.yml`  
Route: `aistaff-api.marga.biz` → `http://127.0.0.1:3000`

```bash
cloudflared tunnel --config /Users/mike/.cloudflared/config.yml run marga-api
```

Or install as macOS service (see Cloudflare docs: `cloudflared service install`).

### 3. Live URLs

| Purpose | URL |
|---|---|
| Landing page | https://aistaff.click |
| Admin panel | https://aistaff.click/admin/login |
| Health check | https://aistaff.click/api/health |
| Meta webhook | https://aistaff.click/api/webhooks/messenger |

### 4. Meta webhook

Callback URL must be:

```text
https://aistaff-api.marga.biz/api/webhooks/messenger
```

Verify token: `aistaff_verify_2026`

---

## Option B — Use `aistaff.click` (Hostinger domain)

Your domain is currently **parked on Hostinger**. To serve the app on `aistaff.click`:

### Path 1: Cloudflare DNS (best)

1. Add site **aistaff.click** in [Cloudflare Dashboard](https://dash.cloudflare.com)
2. At **Hostinger** → Domain → DNS → change **nameservers** to Cloudflare (they give you 2 nameservers)
3. Wait for DNS propagation (up to 24h, often 1–2h)
4. Add tunnel route:

```bash
cloudflared tunnel route dns 52302446-f24e-4f17-9ed6-a369e2d0a8fc aistaff.click
cloudflared tunnel route dns 52302446-f24e-4f17-9ed6-a369e2d0a8fc app.aistaff.click
```

5. Add to `/Users/mike/.cloudflared/config.yml` **before** the 404 line:

```yaml
  - hostname: aistaff.click
    service: http://127.0.0.1:3000
  - hostname: app.aistaff.click
    service: http://127.0.0.1:3000
```

6. Restart cloudflared tunnel
7. Update `.env`: `APP_PUBLIC_URL="https://aistaff.click"`
8. Run `npm run configure:webhook`

### Path 2: Hostinger DNS only (no nameserver change)

At Hostinger DNS panel, add **CNAME**:

| Type | Name | Target |
|---|---|---|
| CNAME | app | `<TUNNEL_ID>.cfargotunnel.com` |

Cloudflare tunnel ID: `52302446-f24e-4f17-9ed6-a369e2d0a8fc`  
Target: `52302446-f24e-4f17-9ed6-a369e2d0a8fc.cfargotunnel.com`

Then add `app.aistaff.click` ingress in cloudflared config (same as above).

**Note:** Root domain `aistaff.click` on Hostinger parking page must be removed/disabled for CNAME to work on `app` subdomain.

---

## Option C — Hostinger VPS (true 24/7, no Mac)

If you buy **Hostinger VPS**:

1. SSH into VPS
2. Install Node 20+, PostgreSQL, cloudflared
3. Clone repo, `npm install`, configure `.env`
4. `pm2 start ecosystem.config.cjs`
5. Run cloudflared tunnel on VPS
6. Point DNS to tunnel or VPS IP

This is the production path when you have paying clients.

---

## Option D — DigitalOcean droplet (recommended for 24/7)

Same droplet as MARGA (`marga-platform-sgp1`, `168.144.96.24`), **separate container** from `marga-app` / `marga-api`. Database lives on **DigitalOcean managed Postgres** (same cluster as `margabase`, separate database `aistaff_click`).

### Architecture

```text
aistaff.click (Cloudflare A → 168.144.96.24)
        ↓
Caddy on droplet (host-based routing)
        ↓
aistaff-api container :3000
        ↓
DO managed Postgres: aistaff_click
```

MARGA staff app continues on `:80` default → `marga-app:9100`. AIStaff gets its own hostname block in Caddy.

### 1. Create database and restore from Mac backup

```bash
cd "/Volumes/Wotg Drive Mike/GitHub/AI-Inbox-Sales-Assistant"
npm run migrate:db:do
```

Uses credentials from `marga-platform/state/digitalocean-margabase.env` and the latest dump in `~/AIStaff Backups/Database/`.

In the DigitalOcean console you can also create database `aistaff_click` on cluster `apps-postgres-sgp1` — the script does this via `CREATE DATABASE` if missing.

### 2. Deploy container to droplet

```bash
npm run deploy:do
```

This rsyncs the app to `/opt/aistaff`, writes production `.env` with the managed Postgres URL, starts `aistaff-api` on network `marga-deploy_marga`, and updates `/opt/marga-deploy/Caddyfile` for `aistaff.click`.

### 3. DNS cutover (Cloudflare)

Same pattern as `app.marga.biz` cutover (see marga migration skill):

1. Stop Mac tunnel route for `aistaff.click` if it exists in `~/.cloudflared/config.yml`.
2. In Cloudflare DNS for `aistaff.click`, set **A** record `@` → `168.144.96.24` (proxied orange cloud).
3. Remove any CNAME to `*.cfargotunnel.com` for the root hostname.

Verify:

```bash
curl -s https://aistaff.click/api/health
npm run configure:webhook
```

### 4. Retire Mac launchd (after cutover proof)

```bash
launchctl bootout gui/$(id -u) ~/Library/Agents/com.aistaff.api.plist 2>/dev/null || true
launchctl bootout gui/$(id -u) ~/Library/Agents/com.aistaff.postgres-backup.plist 2>/dev/null || true
```

Local Postgres backups can stay as a secondary copy until you trust DO backups.

---

## Database note

Current `.env` uses **local PostgreSQL** on your Mac. For VPS deployment, install Postgres on the same VPS or use a managed DB.

---

## Mac production (marga-style launchd)

Install always-on AIStaff services on your Mac, matching the marga-app pattern:

```bash
cd "/Volumes/Wotg Drive Mike/GitHub/AI-Inbox-Sales-Assistant"
npm run install:launchd
```

This installs:

| LaunchAgent | Purpose |
|---|---|
| `com.aistaff.api` | Node API on port 3000, waits for Postgres, `KeepAlive` |
| `com.aistaff.postgres-backup` | Daily dump of `aistaff_click` to `~/AIStaff Backups/Database` |

It also patches the existing **marga** Cloudflare tunnel health gate so `com.marga.cloudflare-tunnel` waits for AIStaff before starting.

**Prerequisites:** marga launchd stack already installed (`com.marga.cloudflare-tunnel`, `com.marga.nosleep`), Postgres running, `.env` configured.

```bash
npm run status:live                 # check local + public health
launchctl kickstart -k gui/$(id -u)/com.aistaff.api
bash scripts/backup-aistaff-postgres.sh   # manual backup now
tail -f ~/Library/Logs/AIStaff/aistaff-api.launchd.err.log
```

Schedule override (optional):

```bash
AISTAFF_BACKUP_HOUR=15 AISTAFF_BACKUP_MINUTE=30 npm run install:launchd
```

---

## Quick commands

```bash
npm run install:launchd             # marga-style always-on install (recommended)
npm run status:live                 # health check
bash scripts/start-live.sh          # one-off start (legacy / without launchd)
npm run configure:webhook           # update Meta (needs META_APP_SECRET)
```

---

## What “live testing” means for you today

1. Mac (or VPS) runs Node app on port 3000  
2. cloudflared tunnel exposes it at **https://aistaff-api.marga.biz**  
3. You open **https://aistaff.click/admin** for the control panel  
4. Messenger webhook hits the same domain  
5. **Do not use localhost** — use the public URL above  

If the Mac sleeps or tunnel stops, live testing breaks until launchd recovers (or you run `npm run install:launchd` once so services auto-restart).
