# Email Engine — Handoff & Masterplan

Added 2026-10-22. First building block of the AIStaff **Marketing engine** ("Marketing Director").
Live for Marga Enterprises, sending from `care@marga.biz`.

## What it does

A tenant writes one email and sends it to many people. Each person gets **their own copy**
(nobody sees other addresses) with their own **unsubscribe link**. Sending is slow and safe:
a per-minute speed, inside the mailbox's daily limit, keeping part of the day free for Closer.

## Where things are (dual mode)

| Who | Where | What |
|---|---|---|
| Tenant admin (or AIStaff in assist mode) | **Settings › Email Engine** (`/admin/settings/email-engine`) | New email, test send, choose recipients, send / pause / resume / stop / retry failed, contacts and lists, do-not-email list, sending settings |
| AIStaff staff (`emailengine.manage`: admin, support) | **Platform › Email Engine** (folded section on the Platform page) | Pause ALL tenant campaigns, max per minute, max per day per mailbox, see/pause every tenant's campaign |
| Customers | `https://aistaff.click/u/<token>` | Unsubscribe page (GET shows a button; POST unsubscribes, so link scanners can't unsubscribe people). Also `List-Unsubscribe` + one-click header for Gmail/Yahoo |

## Files

| File | Role |
|---|---|
| `src/email-engine.js` | Sender choice, daily budget, composing (personalisation, footer, unsubscribe), SMTP pool, error classes, background worker, alerts |
| `src/routes/email-engine.js` | Tenant API, platform API, public unsubscribe page |
| `public/email-engine-settings.js` | Tenant panel + platform panel (progressive disclosure: contacts, blocked list, settings folded) |
| `prisma/migrations/20261022140000_email_engine` | Tables `email_engine_settings`, `email_contacts`, `email_campaigns`, `email_campaign_recipients`, `email_suppressions`, `email_engine_platform` |
| Wiring | `src/server.js` (routes + `startWorker()` inside background jobs), `src/platform-roles.js` (`emailengine.manage`), `public/app.js` (Settings tab), `public/platform.js` (holder), `public/index.html` (script tags `?v=20261022-ee…`) |

## How sending works

1. **Sender**: default = the tenant's Email channel inbox (Settings › Channels › Email) — must be ON and tested.
   Option = a separate sending mailbox (own SMTP login, encrypted, must pass Test connection).
   Replies go to the sending inbox, so Closer answers them like any customer email.
2. **Speed**: tenant `per_minute` (default 10), capped by platform `max_per_minute` (default 30). Worker ticks every 5 s.
3. **Daily budget** (rolling 24 h, per sending address):
   `min(mailbox_daily_limit, platform max_per_day) − max(reserve_for_closer, Closer/status emails already sent) − campaign emails sent`.
   Defaults: 1,000/day (Hostinger Business Starter), 200 reserved for Closer. When the budget is used up the campaign waits and continues by itself.
4. **Never twice**: each recipient is claimed (`pending → sending`) before sending. After a restart, anything stuck in `sending` is marked `failed` ("may or may not have been delivered") — never re-sent automatically; "Retry failed" re-queues on purpose.
5. **Errors**
   - login / limit / connection → campaign **paused**, tenant alert contacts + platform admin emailed once with fix steps (`notify.sendToTenantAndPlatform`).
   - bad address (550/551/553/"user unknown") → recipient failed + added to do-not-email list as `bounced`.
   - temporary → retried after 15 min, up to 3 attempts.
6. **Do-not-email list** is checked when recipients are chosen and again right before each send.

## Personalisation

`{{name}}`, `{{name|Valued Customer}}` (fallback after `|`), `{{first_name}}`, `{{organization}}`, `{{email}}`.
Links become clickable. The Email channel signature, tenant footer and unsubscribe link are added automatically.
All wording is the tenant's own (AIStaff rule: no hardcoded copy).

## Manual deployment checklist for a new tenant — all panel steps

1. Settings › Channels › Email: connect the customer-service inbox, Test connection, turn ON. *(or Settings › Email Engine › Sending settings › separate mailbox → Test connection)*
2. Settings › Email Engine › Sending settings: set the mailbox's daily limit from their email plan; footer (company address / why they get the email).
3. Contacts: paste/Excel rows, and/or "Add emails Closer already collected".
4. New email → Send me a test → Review and send.

No SSH, `.env` or code step is required.

## Verified 2026-10-22

- Migration applied (DB backup `~/db-backups/aistaff_click-pre-emailengine-20261022131446.dump`; file backups `*.backup-emailengine-20261022131446`).
- Live test campaign for Marga: 2/2 delivered from `care@marga.biz` (to michael.marga@gmail.com and mikep@marga.biz), ~8 s apart.
- Unsubscribe page GET/POST verified; invalid token → 404 page.
- "Add emails Closer already collected" for Marga: 4 contacts (list "Closer customers").
- Panel screenshots checked on desktop and phone width; no page errors.

## Manual steps still required / known limits

- Bounces that come back later as a bounce email (not refused at send time) are not read yet — next: let the Email channel poller recognise bounce mails for campaign Message-IDs and add them to the do-not-email list.
- No open/click tracking yet (deliberate for step 1).
- Marga's full customer email list lives in margabase (branch contacts). Next: a "Import from connected app" button using the tenant's Connections & Actions (no direct DB reads), or a CSV export from app.marga.biz pasted into Contacts.
- Check Marga's Hostinger plan for `care@marga.biz` and set the real daily limit (1,000 Starter / 3,000 Premium / 100 free-trial).

## Masterplan — Marketing engine (next steps)

1. **Contacts sync** from connected apps (Marga branches: contact name, email, company, branch) with lists/segments (e.g. by area, machine model, active/inactive).
2. **Bounce + reply handling** through the Email channel poller.
3. **Templates** (tenant-branded HTML blocks) and AI drafting: the model writes the copy from the tenant's facts and goal; tenant approves.
4. **Scheduling** (send at a time) and **sequences** (follow-ups after N days, stop when replied).
5. **Results**: delivered, replied (Inquiries), unsubscribed, and later opens/clicks.
6. More channels under the same campaign: SMS via Pitch router, Messenger (within Meta rules).

---

# Outreach mode (added 2026-10-22, same day)

One-to-one prospecting to businesses, done properly. Settings › Email Engine › **New outreach**.
File: `src/email-outreach.js` (rules, drafting, sending, reply reading, record), UI `public/email-outreach-settings.js`
(loaded before `email-engine-settings.js`, exposes `window.EEOutreach`). Migration `20261022150000_email_outreach`.

## The six rules, and where code enforces them

| Rule | Enforced by |
|---|---|
| 1. One-to-one, written for that company | `draftTick()` — the AI (Closer model via `callCloserModelJSON`) writes each email from the tenant's brief + that contact's "why they fit"; facts only, no signature/opt-out (system adds). Review on by default: drafts wait in **Review** (approve / edit / write again / don't send / send me this). One draft per 10 s tick, drafts at most 2× pace ahead. 3 AI failures → goes to review with the error for a human to write. |
| 2. Company contact addresses first | `addressType()` — role (info@, sales@, procurement@, bac@…) go ahead; personal (name@company) and free-mail (Gmail…) are **held** until the tenant ticks "the company publishes these for business inquiries" (`/allow-held`, logged in events). Rows without "where you found it" stay held. Addresses contacted by outreach in the last 180 days, or on the do-not-email list, are skipped. |
| 3. Separate domain | `resolveOutreachSender()` / settings PUT — outreach sends only from the **Outreach mailbox**; its domain may not be the Email channel domain, company website/contact-email domain, or `email_engine_platform.protected_domains` (default `aistaff.click`); free-mail refused. Test connection checks SMTP **and** IMAP. |
| 4. Who we are, how we found you, reply STOP | Footer template (tenant-editable, must keep `{{source}}` and STOP) appended by the system to every email + `List-Unsubscribe` header. `pollReplies()` reads the outreach inbox every 2 min: bounce → `bounced` + do-not-email; first line `STOP` (protocol, not language routing) or AI reads it as opt-out / clear no → `opted_out` + do-not-email; out-of-office ignored; any other reply → `replied`, follow-ups stop, tenant alert contacts emailed with the reply. Manual "Mark: they replied / asked to stop" in the prospect list. |
| 5. Keep a record | Per contact: source, reason, address type, event log (added, allowed, drafted, approved/edited, sent with text, replies). Privacy check (PIA: purpose, data, source, lawful basis, opt-out, retention days, security + 3 confirmations) required before **Start**. `GET /campaigns/:id/record.csv` exports all of it. |
| 6. 1–2 follow-ups only | `followups` 0–2, `followup_days` 2–30. After a send the row waits; when due and still no outcome it becomes a new draft (same thread: `Re:` subject, In-Reply-To/References). |

## Pace — for outreach AND normal emails
`pace_count` emails every `pace_hours` hours, spread evenly (10 every 3 h ≈ one per 18 min), plus optional
sending hours (`send_window`: Mon–Fri / every day, from–to, Philippine time). `paceAllows()` in `email-engine.js`.
Editable while a campaign is running. Outreach defaults: 10 every 24 h, Mon–Fri 08:00–18:00, 1 follow-up after 4 days, review on.
Platform caps: `outreach_enabled`, `outreach_max_per_day` (default 50 per company), `protected_domains` (Platform › Email Engine).

## Verified 2026-10-22
- Guards: marga.biz outreach mailbox refused; footer without STOP refused; start refused without brief/sender, PIA, mailbox; allow-held needs confirmation; missing-source rows stay held.
- Address types: info@/sales2@/procurement-dept@/bac@ → role; juan.cruz@ → personal; gmail → freemail.
- AI draft for a sample company in ~7 s (local model), specific and fact-only.
- Reply reading with sample emails: STOP → opted_out, bounce → bounced, "not interested, remove us" → opted_out, out-of-office → ignored; all correct entries on the do-not-email list (test data removed).
- Pace: spacing and sending-hours checks; record CSV; panel screenshots (no page errors). Test campaigns deleted.
- Backups: DB `~/db-backups/aistaff_click-pre-outreach-20261022135536.dump`; files `*.backup-outreach-20261022135536`.

## Still to do
- **Buy a separate outreach domain** and create a Hostinger mailbox on it (e.g. mike@<sister-domain>), with SPF/DKIM/DMARC; then Settings › Email Engine › Outreach mailbox → Test connection. Warm it up: start 5–10 a day.
- Retention: `pia.retention_days` is recorded, but deleting old no-reply records is not automatic yet (add a nightly purge).
- Replies are alerted by email; showing them in Inquiries (and letting Closer draft an answer for approval) is a next step.
