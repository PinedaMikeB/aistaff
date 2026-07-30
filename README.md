# AI Inbox Sales Assistant

Focused MVP for B2B companies that receive quotation inquiries through Facebook Page Messenger.

## What This Builds

- Public landing page for `AIStaff.click`
- Admin login
- Company profile and settings
- Knowledge base and qualification questions
- Facebook Page Messenger webhook and Send API integration
- AI sales reply engine constrained to the company knowledge base
- Lead capture, conversation history, follow-ups, human handoff
- Quotation draft workflow with admin approval before sending by default

## Local Setup

1. Copy `.env.example` to `.env` and edit values.
2. Create a local PostgreSQL database named `ai_inbox_sales_assistant`.
3. Install dependencies:

```bash
npm install
```

4. Run migrations and seed:

```bash
npm run prisma:migrate -- --name init
npm run seed
```

5. Start the local server:

```bash
npm run dev
```

Open `http://localhost:3000`.

See `docs/PHASE_1_LAUNCH_PLAN.md` for managed onboarding and Facebook ads launch steps.

## Messenger Webhook

Use one webhook URL for all Facebook Pages:

```text
https://YOUR-PUBLIC-URL/api/webhooks/messenger
```

Legacy alias (same handler):

```text
https://YOUR-PUBLIC-URL/webhooks/meta/messenger
```

Verify token:

```text
aistaff_verify_2026
```

### Persistent Cloudflare Tunnel (recommended)

This project is configured to use a stable hostname such as:

```text
https://aistaff.click
```

Landing page: `https://aistaff.click`  
Admin panel: `https://aistaff.click/admin/login`

1. Add ingress for port `3000` in your Cloudflare tunnel config.
2. Set `APP_PUBLIC_URL` in `.env`.
3. Install marga-style always-on launchd services (recommended on Mac):

```bash
npm run install:launchd
npm run status:live
```

Or start manually:

```bash
npm run start:live
```

4. Register the webhook with Meta:

```bash
npm run configure:webhook
```

Set `META_APP_ID`, `META_APP_SECRET`, `META_PAGE_ID`, and `META_PAGE_ACCESS_TOKEN` in `.env`.
Webhook signatures are verified when `META_APP_SECRET` is set.

After rotating `ENCRYPTION_SECRET`, re-encrypt stored page tokens:

```bash
npm run sync:page-token
```

### Temporary local tunnel

While `aistaff.click` is not deployed, you can still use a quick tunnel:

```bash
npm run dev
cloudflared tunnel --url http://localhost:3000
```

Copy the printed HTTPS URL into `APP_PUBLIC_URL`, then run `npm run configure:webhook`.

After the domain is deployed and DNS points to this Node app, switch the Meta callback URL to:

```text
https://aistaff.click/api/webhooks/messenger
```

## Security Notes

- PostgreSQL is local only and is never exposed publicly.
- All database access goes through the Node.js backend.
- Page access tokens are stored encrypted with `ENCRYPTION_SECRET`.
- Messenger webhooks require a valid `X-Hub-Signature-256` when `META_APP_SECRET` is set.
- Quotation auto-send exists as a setting but is disabled by default.
