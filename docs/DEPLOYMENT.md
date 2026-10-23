# AIStaff Live Deployment

## Current production authority (verified 2026-10-14)

The live source of truth is the Ryzen host, not a Mac checkout.

| Item | Production value |
|---|---|
| Public hostname | `https://aistaff.click` |
| SSH host | `aistaff` (hostname `aistaff`) |
| Repository | `/srv/apps/aistaff` |
| Node service | user unit `aistaff-api.service` |
| Service wrapper | `/home/mike/srv/ryzen-start-aistaff-api.sh` |
| Working directory | `/srv/apps/aistaff` |
| Listening port | `3000` |
| Environment | `NODE_ENV=production` |
| Environment file | `/srv/apps/aistaff/.env` |
| Database | PostgreSQL `aistaff_click` at `127.0.0.1:5432` |
| Cloudflare ingress | `/home/mike/.cloudflared/marga-api.yml` → `127.0.0.1:3000` |

The public hostname reaches this service through the production proxy/tunnel route. Do not build, migrate, deploy, or overwrite production from `/Volumes/Wotg Drive Mike/GitHub/AIStaff`; that Mac checkout is reference-only unless the owner explicitly changes the authority.

### Established deployment procedure

1. SSH to `aistaff` and work in `/srv/apps/aistaff`.
2. Inspect the dirty worktree and preserve unrelated changes. Apply only a reviewed narrow patch; never replace whole files from a mirror.
3. Before a database migration, create a timestamped PostgreSQL dump outside the repository.
4. Run `./node_modules/.bin/prisma validate`,
   `./node_modules/.bin/prisma migrate deploy`, and
   `./node_modules/.bin/prisma generate` when the patch contains a migration.
5. Run `npm test` and the relevant syntax/feature tests.
6. Restart with `systemctl --user restart aistaff-api.service` and confirm `systemctl --user is-active aistaff-api.service` reports `active`.
7. Verify `https://aistaff.click/api/health`, the authenticated workflow, and recent service logs. A local test alone is not a live verification.

The remaining sections below are historical deployment alternatives. They are not the current production path.

### Universal Connections & Actions release (2026-10-14)

- Migration: `20261013235500_smart_integration_discovery`
- Rollback branch: `codex/rollback-universal-connections-20261013-2346`
- Backup directory:
  `/srv/apps/aistaff/.codex-backups/20261013T2346-universal-connections-preupgrade`
- Validated custom dump: `aistaff-pre-universal-connections.dump`
- Service verification: `aistaff-api.service` active and
  `https://aistaff.click/api/health` healthy after restart.

The release is additive. A database rollback requires restoring the validated
dump because Prisma does not provide an automatic down migration. For a code
rollback, first disable newly configured connections, restore the repository
state from the rollback branch or targeted file archive, restore the dump if
the schema must be reversed, regenerate Prisma, restart the user service, and
verify the public hostname.

### Guided Business Engine setup update (2026-10-14)

- No database migration is required; the existing Business Engine schema is
  reused and the catalog is versioned in application code.
- Backup: `/srv/apps/aistaff/.codex-backups/20261014T1645-engine-guided-setup`
- Settings flow: connect application → review suggested jobs and uncertain
  field matches → safe connection test → activate selected jobs.
- A connected application never activates an engine by itself.
- Tenant instructions live only in Settings > General > Closer Instructions.
  AI Studio remains the global platform layer; Knowledge Base stores facts;
  Business Engines contribute system-owned capability guidance and policies.
- Marga currently has no documented serial-number lookup endpoint. Do not map
  customer search or machine detail to serial lookup unless Marga's OpenAPI
  document explicitly adds that capability.
- Roll back code by restoring only the files from the backup directory and
  restarting `aistaff-api.service`; no schema rollback is needed.
- Verification: 33/33 focused tests passed; a self-cleaning temporary-tenant
  sample proved the guided activation transaction and runtime tool exposure;
  cleanup returned zero temporary tenants; local and public health checks were
  healthy after the Ryzen service restart.

---

**Historical setup:** Domain `aistaff.click` on Hostinger + Cloudflare Tunnel for the live API.

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
