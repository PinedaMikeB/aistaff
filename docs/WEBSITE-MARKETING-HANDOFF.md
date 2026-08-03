# AIStaff Marketing Website — Handoff & Masterplan

_Last updated: July 31, 2026 (overnight session). Covers the public marketing
site (`public/index.html` + `public/agents/*`), not the Messenger AI
orchestrator (see `handoff-masterplan.md` for that)._

## What exists now

- **Homepage** (`public/index.html`): cinematic hero → workforce ticker →
  2 agent cards (Brandee, Closer) → proof section → contact/chat CTA
- **Agent pages**: `public/agents/brandee/` and `public/agents/closer/`
  — full standalone landing pages, dark cinematic theme, own pricing
  sections (Brandee's is placeholder, Closer's is real)
- **Site chat widget**: bottom-right floating chat, calls
  `POST /api/public/site-chat`, powered by `gpt-5.6-luna`, grounded on
  real Closer pricing + Brandee features. **Blocked on OpenAI account
  having zero credit balance** — code is complete and correct, just
  needs credits added at platform.openai.com/settings/organization/billing
- **Git repo**: initialized this session (`github.com/PinedaMikeB/aistaff`,
  branch `main`). Tag `verified-correct-2026-07-31` marks a known-good
  rollback point.

## CRITICAL: how local vs. live actually works (read this first)

There is **no separate deploy step** for this site. `localhost:3000` and
`aistaff.click` are the **same running process**, same codebase, on this
Mac, reached two ways:
- Directly: `localhost:3000`
- Publicly: `aistaff.click` → Cloudflare Tunnel (`com.marga.cloudflare-tunnel`
  LaunchAgent) → `127.0.0.1:3000` (see `~/.cloudflared/config.yml`)

Editing a static file (`.html`/`.css`/`.js`) takes effect **immediately**
on both, because Express reads files from disk on every request.

**The one real gap:** `aistaff.click` is proxied through Cloudflare's CDN,
which caches static assets at the edge **independently of the origin**.
`localhost` bypasses Cloudflare entirely and always shows the true current
state. This is why local and live can visibly disagree even though it's
"the same server."

**Fix when actively iterating:** turn on Cloudflare **Development Mode**
(dashboard → aistaff.click zone → Caching → Development Mode → On, lasts
3 hours per toggle). Turn it off when done — not meant to run permanently.

**One-time fix if already stale:** Cloudflare dashboard → Caching →
Purge Everything.

## The server MUST run via launchd, not a manual `node`/`npm run dev`

Production runs as LaunchAgent `com.aistaff.api` (see
`scripts/status-aistaff-live.sh`, `scripts/install-aistaff-launchd.sh`).
It does **not** use `--watch`, so editing `src/server.js` (backend logic,
new routes) requires an explicit restart:

```bash
launchctl kickstart -k gui/$(id -u)/com.aistaff.api
```

Static file edits (HTML/CSS/JS) do **not** need this — only actual
`server.js` changes do. Logs:
`~/Library/Logs/AIStaff/aistaff-api.launchd.log` (stdout, morgan access log)
`~/Library/Logs/AIStaff/aistaff-api.launchd.err.log` (stderr, real errors)

**Mistake made this session:** manually killed a stale process and ran
`nohup npm run dev &` instead of using launchd. This left a duplicate
orphaned process running uselessly (cleaned up), and briefly confused
which process was actually serving traffic. Always use `launchctl
kickstart`, never a manual node/npm process, for anything touching the
live domain.

## Static file caching (`express.static` no-cache list)

`src/server.js` explicitly sets `Cache-Control: no-cache` for a specific
list of filenames so browsers revalidate on every load during active dev.
**If you add a new public JS/CSS file that needs live-reload behavior,
add it to this list** (`setHeaders` callback, ~line 129):

```js
if (filePath.endsWith("app.js") || filePath.endsWith("index.html") ||
    filePath.endsWith("style.css") || filePath.endsWith("workforce-motion.js") ||
    filePath.endsWith("site-chat.js")) {
  res.setHeader("Cache-Control", "no-cache");
}
```

**Mistake made this session:** added `workforce-motion.js` late, after
already debugging a "why isn't my JS updating" issue for a while. Check
this list first next time before assuming something else is wrong.

## Design system reference

**Palette** (defined as CSS custom properties on `.modern-home`):
`--night: #030810` (bg) · `--cyan: #24a9ff` · `--ice: #c7ecff` ·
glow accent `#5dd0ff`

**Fonts:** `Space Grotesk` (headings) · `DM Mono` (labels/eyebrows,
uppercase, letter-spacing .14-.16em) · `Manrope` (body text)

**Animation library:** Motion (formerly Framer Motion), vanilla build via
CDN (`motion@11/dist/motion.js`, global `window.Motion`), NOT the React
build. Loaded in `index.html` before `workforce-motion.js`.

**Established animation patterns** (all in `public/workforce-motion.js`):
- `initCaptionReveal(prefix, titleId)` — shared letter-by-letter 3D flip
  reveal (`rotateX: -90→0`), used for both Brandee's and Closer's card
  captions AND the "Specialized AI agents..." section heading. Always
  resets to hidden on scroll-out (`return setHidden` from the `inView`
  callback) so it **replays every time**, not just once.
- Carousel entrance: independent scale+fade pop (`scale: 0.88→1`,
  bouncy easing `[0.34, 1.4, 0.64, 1]`), separate `inView()` trigger from
  the caption text beside it — deliberately not synced.
- **Word-wrapping gotcha:** if you split text into per-letter
  `display: inline-block` spans for animation, wrap letters inside a
  per-word `.word-group` (`white-space: nowrap`) first, or the browser
  will insert line-breaks mid-word. Learned this the hard way on
  "Facebook Messenger" breaking into "Facebook M" / "essenger".

## Card layout system (Brandee / Closer)

Both agent cards on the homepage use `.service-card-media` — no border,
no background box (deliberately removed, "should not look boxed").
Structure: `.media-row` (flex, carousel + caption side-by-side) →
`.service-card-media-footer` (the "Try X" link) below it.

- **≥1100px:** side-by-side, card `width: fit-content`, always centered
  via `margin: 0 auto !important` (overrides the zigzag
  `nth-child(odd/even)` alternating layout the other cards use — this
  was a real bug earlier: centering the card alone without also
  accounting for the caption's width left it visibly off-center)
- **<1100px:** stacks vertically (`flex-direction: column` via CSS
  `order`, caption on top), card widens to `min(500px, 88%)`

Carousel: 440px, square (`aspect-ratio: 1/1`), Ken Burns zoom on hover,
click-to-pause/play (not navigation — the footer link handles that),
progress bar at **bottom** (was top, but that overlapped a logo baked
into the slide images).

Brandee's caption sits right of the carousel; Closer's sits left
(mirrored, `text-align: right` on Closer's). Eyebrow text is now an
`<h3>` for SEO ("Closer, AI Chat Sales Agent" / "Brandee, AI UGC Brand
Agent") — the big stylized headline is a `<p>`, not a heading, so the
identifying text carries the semantic weight, not the marketing tagline.

## Heading structure (SEO)

Exactly one `<h1>` on the page. Two hidden ones were found and fixed
this session — `#adminTitle` ("Dashboard") and the login form's "Admin
Login" — both downgraded to `<h2>`. **If you add any new admin/login UI,
do not use `<h1>` for it** — check `grep -o "<h1[^>]*>" public/index.html`
returns exactly 1 before shipping.

Current structure:
```
H1: Build a business that responds, remembers, and follows through.
H2: Specialized AI agents. One connected workforce.
H2: Meet our AI agents
H3: Closer, AI Chat Sales Agent
H3: Brandee, AI UGC Brand Agent
```

## Terminology: "agents" not "specialists"

Site-wide rename this session. Routes are `/agents/brandee/` and
`/agents/closer/` (moved from `/specialists/`). Old `/specialists/...`
URLs don't 404 — they fall through to the SPA catch-all and just show
the homepage (not a real redirect, acceptable since the site isn't
indexed yet). **Use "agent" in all new copy, not "specialist".**

## Site chat widget (`public/site-chat.js`)

Bottom-right floating widget, calls `POST /api/public/site-chat`
(defined in `src/server.js`, near the audit-request route). Deliberately
**not** built on the existing Messenger AI orchestrator
(`src/ai.js` / `src/aistaff-ai-config.js`) — that system is tied to
per-client company records, conversations, and leads in Postgres via
Prisma, meant for Mike's *clients'* customers. Reusing it for
"visitors asking about AIStaff itself" would have created fake lead/
conversation records mixing marketing-site traffic into the real CRM.

Instead: stateless, no DB writes, client sends full conversation history
each request, system prompt hardcodes real facts (Closer's actual
pricing tiers pulled from `src/payments.js`, Brandee's real feature set)
so it can't invent numbers. Model: `gpt-5.6-luna` (confirmed correct API
model ID as of July 2026 — NOT the bare `gpt-5.6` alias, which routes to
Sol instead). Rate-limited in-memory (20 msgs / 10 min / IP, no new
dependency added).

**Status: code complete, blocked on OpenAI billing.** The
`OPENAI_API_KEY` account has zero credit balance
(`insufficient_quota` / `credit_balance_exhausted` from OpenAI, visible
in `~/Library/Logs/AIStaff/aistaff-api.launchd.err.log`). Add credits at
platform.openai.com/settings/organization/billing, no code changes
needed after that.

## Brandee pricing is still a placeholder

`public/agents/brandee/index.html` has a pricing section with made-up
numbers (₱999/₱2,499/₱4,999), clearly commented in the HTML as
placeholder. **Do not treat these as real** — Mike hasn't finalized
Brandee pricing yet. Update once real numbers exist, and update the
site-chat system prompt in `server.js` at the same time (it currently
tells the AI to say "pricing is being finalized" for Brandee, on purpose).

## Deployment / legal copy still says "AIChat Sales Agent"

Product was renamed "Closer" in marketing copy (homepage, agent pages),
but **legal and billing pages were deliberately left unchanged**:
Terms, Privacy, Refund/Cancellation Policy, Checkout, Pricing page's own
`<title>`/copy, `src/payments.js` PRODUCT.name. This was a conscious
choice flagged to Mike — renaming the billing/legal entity is a bigger
decision than a UI relabel. If Mike confirms he wants "Closer" to
formally replace "AIChat Sales Agent" everywhere including legal copy,
that's a separate, explicit task — don't assume it from "make it agents".

## Git — set up this session, use it going forward

Repo initialized fresh (`git init`) — this project had **zero version
control** before tonight, meaning zero rollback capability the whole
time it's been live in production. Now: `github.com/PinedaMikeB/aistaff`,
branch `main`. `.env` confirmed gitignored (verified no secrets leaked
in initial commit). Rollback tag: `verified-correct-2026-07-31`.

**Commit and push after meaningful changes** — don't let uncommitted
work pile up again. One large video file
(`Aistaff Facebook Video Inquiries Chat.mp4`, 67.71MB) triggered a
GitHub size warning (over the 50MB soft limit, under the 100MB hard
cap — it pushed fine, but consider Git LFS if more large video assets
get added).

## Open items for next session

1. **Add OpenAI credits** so the site chat widget actually responds
   (code is done, just blocked on billing)
2. **Real Brandee pricing** — replace the placeholder numbers once
   Mike decides, update both the pricing section AND the site-chat
   system prompt
3. **1200×630 social share image** — currently reusing the square
   1254×1254 logo for OG/Twitter cards since no proper landscape image
   exists; would render better in link previews with a real one
4. **Decide on legal/billing rename** — "Closer" vs "AIChat Sales
   Agent" in Terms/Privacy/Checkout/payments.js (see above, deliberately
   not done yet)
5. **Old `/specialists/...` URLs** — currently soft-fallback to
   homepage via SPA catch-all, not a real 301. Fine for now (site isn't
   indexed), revisit if that changes
6. **Voice/Marketing/Facebook Ads agents** — mentioned in copy as
   "planned," not built. Ticker references them by name
   ("AI Voice Sales Agent" etc.) — keep that consistent if/when they
   actually ship
