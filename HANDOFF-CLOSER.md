# AISTAFF HANDOFF — Closer build, with Pitch context
**Written 2026-08-12.** Read this before touching code. Pitch is live and
working; Closer is the next build.

---

## 0. The two non-negotiable rules (both agents)

1. **No language setting, ever.** No `PITCH_LANGUAGE`, no locale, no Taglish
   flag — not in code, env, prompt, or gateway. The model reads how the person
   speaks or writes and matches them, switching mid-sentence. There is a test
   asserting this (`test/pitch.test.js`). Apply the same rule to Closer.
2. **No hardcoded spoken or written copy.** Tools return FACTS; the model
   writes the words. This is the canned-reply mistake documented in
   `docs/handoff-masterplan.md`. It is more obvious in speech than text but
   wrong in both.

Everything below serves these two rules. If a proposed feature requires
breaking one, the feature is wrong.

---

## 0A. Ryzen 7 production authority and custom-app connections

AIStaff is authoritative on Ryzen host alias `aistaff`, repository
`/srv/apps/aistaff`. The live service is the user unit
`aistaff-api.service`, running on port 3000 behind the Cloudflare ingress in
`/home/mike/.cloudflared/marga-api.yml`. Never build, test, migrate, restart,
or deploy from the Mac mini checkout.

Tenant custom-app connections were deployed on Ryzen on 2026-10-13. Settings
now includes **Connections & Actions**, backed by:

- `src/integrations.js` for OpenAPI discovery, tenant tools, outbound request
  safety, encrypted credentials, approvals, and audit facts;
- `src/routes/integrations.js` for tenant-scoped configuration and approval;
- `public/integrations-settings.js` for connection and action controls;
- migration `20261013133000_tenant_integration_connections` for isolated
  connections, actions, and execution history.

All discovered actions start disabled. Writes default to staff approval;
customer-confirmed actions cannot execute in the same customer turn. API
credentials are encrypted with the protected Ryzen-only
`INTEGRATION_ENCRYPTION_SECRET`. Do not print, rotate, or copy that key without
a credential-rotation plan.

Deployment evidence: validated custom-format PostgreSQL backup, Prisma schema
validation and client generation, 6/6 focused tests, successful migration,
healthy service restart, public health 200, protected Meta routes unchanged,
authenticated tenant API 200, and live public assets containing the new tab.

---

## 1. Where things stand

### Pitch — LIVE, working end to end
Cellular call → Gemini Live → natural Taglish with emotion, sub-second
response. SMS both directions. Runs as a launchd service.

Full technical detail is in **`.claude/skills/aio100-pitch-telephony/SKILL.md`**
(~700 lines, 14 parts). That skill is authoritative for anything telephony —
gateway config field by field, the debugging ladder, every trap already hit.
Do not re-derive it.

### Closer — EXISTS, needs work
Messenger sales agent. Live on `aistaff.click`, Meta app approved and
published, webhook at `/api/webhooks/messenger`.

### Brandee — exists, uncommitted work in the tree
`src/server.js` has +87/−10 uncommitted, plus modified files under
`src/brandee/`. **Commit or stash before running any Prisma migration**, or the
migration generates against a schema that was never committed.

---

## 2. START HERE: the migration that gates everything

Nothing else on the roadmap works without this. It has been deferred for two
sessions.

### The problem
`Conversation` is keyed `@@unique([company_id, psid])` — a Facebook PSID.
Pitch has no PSID; it has a mobile number. So a person who messages on Tuesday
and calls on Thursday is two unrelated records. Pitch also cannot remember
anyone at all: SMS threads live in memory (`src/pitch/sms-agent.js`) and vanish
on restart, and call transcripts go to stdout only.

### The decision (settled 2026-08-12)
**Mobile number is the person. PSID is a delivery address.** Store both.

- `external_id` — per channel. PSID for messenger, mobile for voice/SMS.
  This is *how to reach them on that channel*, and PSID must be kept because
  it is the only way Meta lets you reply into a thread.
- `contact_number` — the join key across channels.
- `contact_name`, `email` — filled by whichever channel learned them.

### The change
- Copy `psid` → `external_id` on every existing row
- Swap the unique constraint to `[company_id, channel, external_id]`
- Keep `psid` nullable for backward compat
- Add `contact_number`, `contact_name` to `Conversation`
- `channel` already defaults to `facebook_messenger`, so existing rows are fine

### Rules
- **Normalise to E.164 before matching.** `09175769817`, `+639175769817` and
  `639175769817` are one person. Get this wrong and you create duplicates on
  day one.
- **Caller ID beats a typed number.** A number from the SIP INVITE is verified
  by the network; one typed into Messenger may be mistyped or fake.
- **A number is not proof of identity.** Front desks, shared handsets, a
  husband calling from his wife's phone. Keep name as a soft attribute; do not
  let a number match unlock anything private.

### Before running it
```bash
pg_dump aistaff_click > ~/backups/aistaff-pre-external-id.sql
git stash        # or commit the Brandee work
```
Adding columns is safe; changing a unique constraint touches existing rows.

⚠️ **The migration must NOT touch anything under `/admin/*` or the Meta
compliance URLs — see §12.** Adding columns is fine; renaming or moving a
reviewed screen is not.

**This file is `prisma/schema.prisma` — Mike asked to be consulted before it is
edited. He gave the go-ahead in principle on 2026-08-12; confirm before running
the migration.**

---

## 3. Strategy — why Closer first

**Sell Closer, demo Pitch.** Settled after working through the economics:

| | Closer | Pitch |
|---|---|---|
| Cost to serve | **~₱0.05/conversation** (measured) | **₱1.16/min** (measured) |
| Gross margin at list | ~98% | ~75% |
| Onboarding cost to you | near zero | ~₱16,000 hardware per client |
| Time to live | same day | days, needs a kit |
| Barrier for buyer | low monthly | ₱17k+ upfront |
| Market size | large — most PH SMBs live in Messenger | narrower |
| Differentiation | moderate (ManyChat et al. exist) | **high — nobody does native Taglish voice** |

Closer funds the business and gets you in the door; Pitch is the thing that
makes AIStaff memorable and is the easier *second* sale to an existing client.
A clinic that has watched Closer work for two months will take the hardware
call; a cold prospect will not.

**In every sales conversation, hand them your phone and let Pitch answer.**
That three-minute demo sells Closer *and* pre-sells Pitch. It costs ~₱4.
The deck is a leave-behind that justifies price *after* they already want it —
it is not the opener.

### Who to sell to
Three conditions must ALL be true: a booking is worth ₱2,000+, calls/messages
arrive when nobody can answer, and inquiries are repetitive.

Best fit: **aesthetic and dental clinics** (highest), hotels/resorts/staycations
(OFWs booking at 3am is an angle nobody else serves), veterinary, funeral
homes, diagnostic labs, multi-branch anything.

Skip early: restaurants (low ticket, walk-in culture), and any business whose
customers only ever message and never call — sell them Closer alone.

### Prospecting
**Meta Ad Library** (`facebook.com/ads/library`) is free and public. Businesses
running ads have budget, measure cost-per-lead, and already feel the pain of
slow replies. Verified 2026-08-12: Belo Medical Group had **113 active PH ads**.
Target the tier *below* Belo — single-clinic and 2–3 branch practices spending
₱20–50k/month. The Library also shows *what* they are advertising, which makes
a specific opener possible ("I saw your August slots campaign — how fast are
you replying to those inquiries at 9pm?").

### The objection you will hear most
*"Facebook already has auto-reply and AI reply."* Concede it first — it is free
and fine for simple cases; saying otherwise costs credibility. Then:
- It answers, it doesn't **sell** — it has no knowledge of their prices,
  availability, or packages, and pushes toward nothing.
- **Nothing is captured** — no lead record, no number, no dashboard, no report.
- **It ends at Messenger** — no SMS, no voice, no identity across channels.
- **The 24-hour window is the argument, not the counter-argument.** Meta's AI
  replies and the thread dies at hour 24 with nothing salvaged. Closer's job in
  those 24 hours is to earn the mobile number so the relationship survives.

### Barrier to entry — be realistic
You have a **6–18 month head start, not a moat.** Real friction: Meta app
review (you're through it), the telephony stack (genuinely unpleasant work),
Taglish quality, local presence, switching costs once installed. Nothing stops
a competent team from cloning Closer's core. **Move fast on distribution
rather than perfecting the product.**

---

## 4. Pricing

### Pitch — settled 2026-08-12

Original ask was ₱33,997 upfront, which is the single biggest deal-killer.
**Split it: recover cash costs upfront, amortise your time.**

| | Value |
|---|---|
| Upfront — "Pitch Dedicated Voice Channel Kit" | **₱16,999** |
| Monthly, first 12 months | **₱2,499** |
| Monthly, month 13+ | **₱999** |
| Total collected year 1 | ₱46,987 |

Maths: ₱33,997 − ₱16,999 = ₱16,998 deferred ÷ 12 = ₱1,416.50 + ₱999 platform
= ₱2,415.50 true break-even. Rounded to ₱2,499; the extra ~₱1,000/year is
interest for carrying ₱17,000 of their cost.

**NEVER say "AIO100", "Dinstar", "Quectel" or "VoLTE router" publicly.** Mike
does not want the hardware copied. Verified 2026-08-12: zero occurrences
anywhere in `public/`. It is always "Pitch Dedicated Voice Channel Kit" or
"voice channel".

Do not sell the kit at exact cost — landed cost is ~₱15–16k (₱13k item + air
freight). The margin is insurance for failures and warranty replacements.

**Talk-time:** ₱999/month platform **includes 100 minutes** (reset monthly,
expire monthly). Top-up credits **never expire**: ₱999/100 → ₱27,999/4,000.
**Included minutes are consumed first, then credits** — get this backwards and
customers watch paid balance drain while free minutes evaporate.

⚠️ **Fix the ₱999 collision** — platform fee and the 100-minute pack are both
₱999 and customers WILL conflate them. Since 100 minutes now come free, the
smallest top-up should start at 300 minutes.

**Credits run out mid-call → let the call finish, allow negative balance.**
Alert at 80% and 95%. A phone line dying silently is the worst possible failure.

**High-volume customers need a flat tier, not metered billing.** 25 calls/day ×
10 min = 7,500 min/month = ₱52,500 metered. Nobody should ever face that bill —
that is a plan-fit failure. Above ~4,000 min/month, offer flat ~₱29,999
(still ~70% margin at ₱1.16/min cost).

⚠️ **10-minute average call is NOT normal.** Real inquiry calls run 2–4 min.
Realistic: clinic 12 calls/day × 3 min ≈ 1,080 min/mo; small hotel 20 × 4 ≈
2,400. **Measure average call duration from real calls before finalising any
tier** — it is the number everything depends on and it is still a guess.

### Closer — live in `src/payments.js`

Starter ₱4,999 · Growth ₱24,999 · Scale ₱59,999 (+ setup, + add-ons).

**Two problems:**
1. **₱4,999 → ₱24,999 is a 5x cliff.** Add a **₱9,999** tier carrying the
   practical features (follow-ups, bookings, quotations, ~4,000 conversations,
   1 page) and reposition Growth as multi-page/multi-staff. Ladder becomes
   5 → 10 → 25 → 60, which people actually climb.
2. **"Conversations/month" is a hard unit for a buyer to estimate** and does
   not track cost (which is tokens). Consider matching Pitch's model — platform
   fee + included allowance + top-up — so there is one mental model across both
   products. The "Additional 1,000 Conversations ₱1,500" add-on is already a
   top-up in disguise.

**Justify ₱4,999 on value, never on cost.** Never mention ₱0.05/conversation.
Justify on: a receptionist costs ₱17,000+/month for ONE shift; one recovered
booking (₱12,000 laser, ₱30,000 implant) pays for months; they are already
spending ₱30k/month on ads to generate the leads Closer stops them losing.

⚠️ **₱4,999 may be too cheap for ad-spending clinics** — it signals "small
tool" rather than "revenue system". The ₱9,999 tier is the one to point at them.

⚠️ **BUG FOUND 2026-08-12, NOT YET FIXED:** the live dashboard shows Closer
quoting *"Starter ₱15,000 setup + ₱3,000/month, Growth ₱25,000 + ₱6,000, Pro
₱50,000 + ₱12,000"* to a real prospect. That matches nothing in `payments.js`
or anywhere else. **Find where those numbers come from and kill them before
Closer quotes a price that cannot be honoured.**

---

## 5. Architecture — Pitch (reference; it works, don't redesign it)

```
caller → PH mobile network → GOMO SIM (₱999/mo unli calls + texts)
  → voice gateway (FreeSWITCH gsmopen + C300 DSP internally)
  → inbound route → SIP extension 8001
  → Pitch: own Node process, NOT inside src/server.js
  → Gemini Live (native audio in/out) → back down the same path
```

**Key choices, and why:**
- **Speech-to-speech, never STT→LLM→TTS.** A chain forces a TTS voice per
  detected language, which IS a language setting, and cannot handle
  mid-sentence code-switching ("depende po sa model at duration ng pag-upa").
  It also flattens the emotion that customers reacted to.
- **Gemini `gemini-3.1-flash-live-preview`** — measured **637ms** to first
  audio vs **9,515ms** for `gemini-2.5-flash-native-audio`. That gap is the
  whole product on a phone call.
- **Cost measured at ~$0.02/min (₱1.16)** vs OpenAI Realtime ~$0.05/min.
  ~2.5x cheaper, not the 5x list prices imply.
- **OpenAI adapter is kept working as a fallback.** Preview models churn — a
  Google text model died under us mid-session on 2026-08-11.
- **Brains are swappable in one env line** (`PITCH_BRAIN_PROVIDER`);
  `call.js` never learns which it got. Keep that boundary.

**Files:** `src/pitch/` — `index.js`, `call.js`, `sip/ua.js`, `sip/sdp.js`,
`rtp/session.js`, `audio/`, `brain/{index,gemini-live,openai-realtime}.js`,
`prompt.js`, `tools.js`, `sms-agent.js`, `config.js`, `log.js`.
Tests: `npm run pitch:test` — **8/8 passing, keep it that way.**
Service: `com.aistaff.pitch` (launchd, KeepAlive).

**Do not rebuild on LiveKit.** It is orchestration, not a model — you still pay
Gemini underneath, and you would delete a working, tested SIP/RTP stack to add
a dependency. Revisit only for concurrency or warm transfers.

**Do not build a Kokoro/open-source TTS chain.** Kokoro has no Tagalog (8
languages). XTTS and F5-TTS are non-commercial licences. A chain saves ~₱0.90/min
and costs you the Taglish and the emotion. Revisit at ~20,000 min/month across
all clients, not before. If pursued, base = Chatterbox (MIT) or Fish Speech
(Apache 2.0) + LoRA on Filipino speech.

### Known Pitch limits
- **One concurrent call per SIM.** Second caller gets 486 Busy. This is a real
  product constraint at 15+ calls/day and must be solved before selling hard.
- **No booking, no availability, no calendar.** It answers and captures only.
  The `/agents/pitch/` FAQ says this plainly — keep it honest.
- **No persistence** — see §2.
- **No alerting.** Registration failed three times on 2026-08-10/11 and each
  was found only because someone tried a call.

---

## 6. Architecture — Closer (what to build)

**Existing:** `src/messenger-webhook.js`, `src/ai.js`, `src/aistaff-tools.js`,
`src/aistaff-ai-config.js`, `src/page-intelligence.js`. Prisma models already
exist: `Conversation`, `Message`, `Lead`, `KnowledgeBase`,
`QualificationQuestion`, `Quotation`, `FollowUp`, `HumanHandoff`, `AiLog`.

### Model choice — measured 2026-08-12
On a realistic 5-turn clinic conversation (1,966 in / 491 out tokens):

| Model | Result |
|---|---|
| **`gemini-3.5-flash-lite`** | **1.3s/turn, clean Taglish with "po"** ✅ |
| `gemini-3.6-flash` | 3.8s/turn, truncated mid-sentence, emitted `**markdown**` |
| `gemini-2.5-flash` | **fails** — closed to new accounts |

Newer models burn output tokens on internal reasoning and truncate short
replies. **Use `gemini-3.5-flash-lite`.** Don't reach for GPT-5-mini or Sonnet:
they cost more and the deciding factors are Taglish quality and latency, both
already won. 1.3s feels instant; 3.8s feels like waiting.

⚠️ **Strip markdown from Messenger output.** Messenger does not render
`**bold**` — customers see literal asterisks.

### Messenger policy — verified 2026-08-12, and it shapes the design
- **24-hour window resets on every user reply.** A conversation spanning days
  is fine while they engage. Do NOT cut off an active customer at 24h.
- **After 24h of silence: no unprompted message.** Switch to SMS or email.
- **The HUMAN_AGENT 7-day tag does NOT apply to Closer** — it is for
  human-sent messages only; an AI using it violates policy. If *Mike* types a
  reply, that is legitimate; Closer cannot.
- **CONFIRMED_EVENT_UPDATE, ACCOUNT_UPDATE, POST_PURCHASE_UPDATE were
  retired 27 Apr 2026** (error 100). Recurring Notifications discontinued in PH
  10 Feb 2026. The appointment-reminder tags are gone.

Verify current policy before relying on this — the area changes fast.

### Closer behaviour — decided 2026-08-12

**Answer decisively from the knowledge base.** Standard prices, packages,
inclusions, hours, availability, location, payment methods. No hedging, no
"let me check with my supervisor", no "our team will call you". A lead
comparing three suppliers goes with whoever answers first and clearly.

**But decisive ≠ inventing.** A model told to be decisive about prices WILL
make up a number for the one product nobody documented. Then the customer
screenshots it and the client is arguing with a written quote from their own
AI. The rule is **decisive inside the knowledge base, honest outside it** — and
honest is still fast:

> ✅ "Yung standard package po, ₱12,500. Yung custom sizing po hindi pa
> nakalista — makukuha ko po yan within the hour. Reserve ko na po muna yung
> slot ninyo?"
> ❌ "Let me check with my supervisor and get back to you."

**Prices come from a tool reading the knowledge base, never from prompt text.**
Prices change; a prompt-baked price goes stale silently and must be edited per
client.

**Log every unanswerable question.** This is the highest-value feature nobody
else builds: each gap becomes a line item, Mike answers it once, and after two
weeks of real conversations the knowledge base is better than anything written
upfront.

**Per-client setting: is Closer authorised to quote a binding price?** Fixed
treatment prices → yes. Custom-quoted work → "indicative, subject to
confirmation". The client decides, not us.

### Getting the mobile number

The number is what keeps the relationship alive past the 24-hour window, so
this matters — but asking badly costs conversions.

- **Never ask upfront.** Ask when there is a reason, as the price of something
  they already want: *"I-te-text ko po sa inyo yung quotation — ano pong
  number ninyo?"*
- **If they say "dito na lang sa Messenger" → say yes immediately and send it
  there.** No second ask, no pushback. Pushing makes you the pushy business and
  loses a sale you already had.
- **The number may return later with a NEW justification** (a booking that
  needs confirming), never a rephrased retry. If declined twice, done.
- **The honest framing works and is true:** *"Sabi lang po ng Messenger, hindi
  ako makakapag-message after 24 hours kung wala kayong reply — kaya kung
  gusto ninyo pong ma-follow up ko kayo bukas, mas mabuti po kung may number."*
- **Record the refusal.** A customer who said no should not be asked again next
  week. Same principle as SMS stop-words.
- **Don't treat no-number as low intent.** In PH, scam texts make people guard
  numbers by default. Judge intent on what they ASK about (specific dates,
  payment terms, "pwede ba ngayon?"), not what they share.
- **Email only when genuinely needed** (formal quotation, contract). For most
  PH inquiries the mobile covers it.

### Media and links

**Stay in Messenger by default.** It supports images, carousels, video and
buttons — a customer asking about a treatment should get before/afters
in-thread. Every hop out loses people.

**Link out only where the web does something Messenger cannot:** a real booking
calendar, a long price list, payment/deposit, or a form where typing an email
beats dictating it. **Answer first, then offer the link** — a link sent
*instead of* an answer feels like a brush-off.

⚠️ Media must be pre-loaded per client and tagged by offering — that is setup
work and part of what the setup fee buys. For aesthetics, the client must
supply only **marketing-approved** before/after photos; patient images have
consent implications that are theirs to manage.

### Knowledge base — how to collect it

**Manual for the first ~10 clients, self-serve much later.** Not because
self-serve is hard, but because you don't yet know what data matters and their
materials will be a mess (prices in a Viber screenshot, photos in an FB album).
A form built now would encode untested assumptions.

- **Structured intake call, not a form** — one hour, screen-share, fill it in
  while they talk. They say things they'd never write down.
- **A Google Sheet as the working doc**, one row per offering. Familiar, no
  login, they can correct it. Import from it.
- **Media via a shared Drive folder**, one folder per offering.
- **Dashboard v1 = review and edit, not upload.** A client who can't fix a
  wrong price will call you instead.

### The offerings schema — one model for all three verticals

Products, services and bookings are the same shape: **a bookable/purchasable
thing, for a span of time, with a capacity.**

| | Resource | Service | Constraint |
|---|---|---|---|
| Hotel | Room 302 / "any Deluxe" | 2-night stay | date range, occupancy |
| Restaurant | Table 5 / "any 4-seater" | dinner | time slot, party size |
| Clinic | Dr. Cruz, Bed 2, laser machine | facial, 90 min | duration, staff + equipment |

```
Offering      name, description, price (fixed|from|quoted), duration,
              inclusions, who it's for, FAQs, media
Resource      the bookable thing — type, capacity, attributes
Availability  opening hours, blackout dates, per-resource
Booking       resource(s) + offering + start + end + party + customer(number)
```
A clinic booking needing a practitioner AND a machine is two resources on one
booking. "Any Deluxe" is a resource *type* with quantity.

⚠️ **Build ONE vertical properly first — probably clinics** (duration-based
service booking is the cleanest case and they feel missed inquiries most).
Designing for hotels + restaurants + clinics simultaneously ships something
that fits none of them.

### Calendar and external systems — three tiers

**Google Calendar models TIME. Booking needs RESOURCES.** No calendar will ever
say whether Room 302 is free or if two seats remain at 7pm.

1. **AIStaff booking database** — for the majority of PH SMBs with no system at
   all. This is the real differentiator: not "we integrate with your PMS" but
   "you don't need one."
2. **Google Calendar** — for genuinely time-only businesses (one practitioner).
   Honest about the limits.
3. **Their system** — NOT "paste your API URL" (that tells us nothing about the
   payload). A **published AIStaff webhook contract** they implement or bridge
   via n8n. This is what the ₱5,000–15,000 webhook add-on is for.

**Pitch and Closer never know which tier they are on.** Tools stay generic:
`check_availability(offering, when, party_size)` returns facts,
`create_booking(...)` returns a confirmation. The adapter behind the tool
varies per client — same boundary as the swappable brain.

---

## 7. Customer dashboard — designed 2026-08-12, not yet built

**Principle:** the buyer is a clinic owner, not an engineer. Vapi and Retell
bury call outcomes under developer analytics. One question must be answered on
login: **did I miss anything?**

**1. Today** *(landing view — the only screen most users ever open)*
Four tiles: conversations today, leads captured, needs attention, minutes/
credits remaining. Then ONE reverse-chronological feed with calls and texts and
chats **interleaved** — to the customer it is one conversation with one person,
not three channels. Each row: name or number, time, one-line AI summary,
outcome tag, needs-attention flag.

**2. People** *(not "Leads" — the buyer doesn't think in CRM nouns)*
One row per mobile number. Name once known, first/last contact, totals per
channel, what they wanted, state. Click → merged timeline of every chat, call
transcript and text with that person. **This is the screen that makes the
product feel like it remembers.**

**3. Conversations** — full transcripts, searchable, filterable by outcome/date.

**4. Bookings** — calendar connection lives here; appointments linked to the
conversation that produced them.

**5. Settings** — hours, knowledge base, escalation contacts, voice, top-up,
SMS consent list.

**UX rules:**
- **Minutes/credits remaining is persistent in the header** with a colour
  state. Prepaid running out means the phone stops being answered — never a
  surprise.
- **Every row says what happened in plain language**, written by the model at
  conversation end. "Asked about room rates for Aug 20, wants a callback" beats
  `outcome: inquiry_pricing`.
- **Needs-attention is a filter, not a badge** — anything unanswered, promised,
  or where the customer sounded unhappy, grouped at the top of Today.
- **One path to each thing.** Vapi's console has three routes to the same call
  log, which is why only developers use it.

Follow `.claude/skills/aistaff-homepage-style/SKILL.md` for visual language.

---

## 8. Build order

1. **`external_id` migration + persistence** (§2) — gates everything. Call
   records, SMS threads, one identity across channels.
2. **Dashboard: Today + People** — real data, immediately useful, and it is
   what you demo to close a sale.
3. **Closer knowledge-base tooling** — offerings import from Sheet, the
   unanswered-question log, review/edit UI.
4. **Booking, ONE vertical (clinics)** — properly, end to end.
5. **Generalise to rooms and tables.**
6. **Health check + alerting** for Pitch (see §9).
7. Self-serve upload, second SIM/concurrency, proactive SMS reminders.

---

## 9. Open bugs and risks

| | |
|---|---|
| 🔴 **Closer quotes phantom prices** | Dashboard shows ₱15k/₱25k/₱50k setup tiers matching nothing in `payments.js`. Find the source, kill it. |
| 🔴 **No alerting anywhere** | Pitch registration failed 3× on 10–11 Aug; each found only by trying a call. launchd restarts a *crashed* process but a running-yet-unregistered Pitch looks healthy and gives every caller a busy signal. |
| 🟠 **`/agents/pitch/` claims booking** | Homepage card says "manages bookings"; the FAQ says it can't. Pricing section omits calendar items deliberately. **Three places disagree — make them agree.** |
| 🟠 **One concurrent call/chat channel** | Sell honestly or fix before selling hard. |
| 🟠 **SMS state is in-memory** | Restart forgets every thread. |
| 🟠 **`PITCH_RECORD_DIR`** | Writes real customer call audio to `~/Desktop/pitch-calls/`. Debug only — must be unset in production, and old WAVs cleared. |
| 🟡 **Rotating Wi-Fi MAC on the Mac Mini** | Can change its IP and silently break `PITCH_SIP_LOCAL_HOST`. Set to Fixed, or put the Mac on ethernet. |
| 🟡 **Uncommitted Brandee work** | Commit/stash before migrating. |

### Costs — measured, not estimated
| | |
|---|---|
| Pitch voice (Gemini Live) | **~₱1.16/min** |
| Closer chat (3.5-flash-lite) | **~₱0.05/conversation** |
| SIM (GOMO, unli calls + texts) | **₱999/month fixed** |
| Fixed | Mac Mini power, internet, your time |

Re-measure both with real client traffic before finalising any rate card. My
earlier estimates were wrong twice — once high on Gemini, once wrong on
break-even arithmetic that Mike caught. **Check the arithmetic on any number
before quoting it to a customer.**

---

## 10. Working preferences (from Mike, observed across sessions)

- **Inspect before changing. Never rewrite working code.**
- **Ask before touching `prisma/schema.prisma` or `src/server.js`.**
- **Measure, don't guess.** Every real breakthrough in the Pitch build came
  from a measurement (PCM peak=0, 637ms vs 9515ms, 20ms vs 100ms chunks).
  Every wasted hour came from a hunch.
- Surgical edits, immediate rollback when something breaks existing behaviour.
- Handoff docs (`HANDOFF.md`, `MASTERPLAN.md`, `CHANGELOG.md`) for continuity.
- Skills live in `.claude/skills/` and are the durable memory — update them as
  things are learned rather than writing new one-off docs.

## 11. Related documents
- **`.claude/skills/aio100-pitch-telephony/SKILL.md`** — authoritative for all
  telephony, gateway config, debugging ladder, launchd traps.
- `.claude/skills/aistaff-homepage-style/SKILL.md` — visual language.
- `.claude/skills/marketing-playbook/SKILL.md` — positioning, CRO, copy.
- `docs/handoff-masterplan.md` — the canned-reply mistake, tool philosophy.
- `PITCH-HANDOFF.md`, `docs/PITCH-SETUP.md` — older; **note their Trunk → VoLTE
  tables list Band Type and GSM Codec fields that do not exist on that page.**

---

## 12. 🔴 DO NOT BREAK: URLs verified by Meta App Review

The AIStaff Meta app is **approved and published** (app ID 3204429623074319).
Approval was granted against screen-recorded walkthroughs showing specific
URLs. If a reviewer re-checks and the flow no longer matches the video, or a
compliance URL 404s, it triggers a re-review — which can suspend Messenger
replies for every client at once.

**These paths must not be moved, renamed, redirected, or removed.**
All verified returning 200 on 2026-08-12:

| Path | Why it's locked |
|---|---|
| `/admin/login` | Shown in the `pages_messaging` submission video |
| `/admin/dashboard` | Shown in submission videos |
| `/admin/settings/facebook-page-connection` | The core `pages_show_list` + `pages_manage_metadata` walkthrough |
| `/admin/settings` | Parent of the above |
| `/privacy` | Meta re-checks automatically (301 → `/privacy/` is fine) |
| `/terms` | Meta re-checks automatically (301 → `/terms/` is fine) |
| `/data-deletion` | Required data-deletion callback |
| `/deauthorize` | Required deauthorize callback |
| `/api/webhooks/messenger` | GET verify + POST receive. Returns 403 on a bad token — that is correct behaviour, do not "fix" it. |

**Also do not change** without checking the submission first:
- The left-nav labels and order inside `/admin/*` — the videos show
  Dashboard / Marketing / Onboarding / Inquiries / Leads / Knowledge Base /
  AI Studio / Qualification Questions / Quotations / Payments / Follow-ups /
  Settings. Renaming a nav item makes the video stop matching the product.
- The "Connect Facebook Page" button and the connection-status panel on
  `/admin/settings/facebook-page-connection` — that exact screen is the
  evidence for two permissions.
- The permission set itself. Requesting new permissions means a new review.

**What IS safe to change freely:** everything under `/agents/*`, the public
marketing pages, `public/index.html`, `style.css`. Those were never part of the
review. The `/agents/closer/` page added in August is marketing only and
cannot affect the app.

**Rule of thumb:** `/admin/*` and the four compliance URLs are load-bearing
infrastructure, not UI you own. Build new client-facing screens (the dashboard
in §7) as *additions* — new routes alongside, not renames of existing ones. If
a redesign genuinely requires moving a reviewed screen, keep the old path
working as a redirect and re-record the walkthrough video first.

Check before shipping anything that touches `/admin`:
```bash
for u in /admin/login /admin/dashboard /admin/settings/facebook-page-connection \
         /admin/settings /privacy /terms /data-deletion /deauthorize; do
  printf "%-45s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' https://aistaff.click$u)"
done
```

---

## 13. 🔴 RULE 1 VIOLATION: `isTagalog` in the Closer path

**Found 2026-08-12. Not fixed — deliberately deferred to its own session.**

Rule 0.1 says there is no language setting anywhere. Closer has one. It is
called `isTagalog`: a boolean threaded through the demo orchestrator that
selects between hand-written Tagalog and English strings.

| File | Occurrences |
|---|---|
| `src/aistaff-demo.js` | 165 |
| `src/page-intelligence.js` | 30 |
| `src/facebook-page-search.js` | 7 |
| `src/facebook-lookup.js` | 5 |
| **Total** | **~207** |

It breaks **both** non-negotiable rules in a single construct: the flag is a
language setting (rule 1), and every branch of it is hardcoded customer-facing
copy (rule 2) — the canned-reply mistake from `docs/handoff-masterplan.md`,
reintroduced as a locale switch.

Shape of it:
```js
function chatOnlyNotice(isTagalog = false) {
  return isTagalog
    ? "Chat assistant lang ito sa Messenger — walang voice call."
    : "This is a chat-only assistant on Messenger — no voice calls.";
}
```
A person who writes "Magkano po ang setup, and do you support IG?" is one
language or the other by a coin flip, and can never be answered mid-sentence in
both. That is the exact failure the rule exists to prevent, and Pitch's
`test/pitch.test.js` asserts against it.

**Why it is not fixed yet.** It is ~207 call sites in code that currently
works, and Mike's standing preference is to inspect before changing and never
rewrite working code. Ripping the flag out is a refactor, not an edit, and it
deserves its own session with its own rollback point.

**It overlaps the phantom pricing bug (§9).** `aistaff-demo.js:1741-1742`
hardcodes the phantom ₱15,000 in *both* languages. Fixing pricing touches these
lines; resist the temptation to fix the flag at the same time, or the two
changes become impossible to roll back independently.

### When it is fixed

- Delete the flag; do not replace it with a detected-language variable, which
  is the same mistake wearing a different name.
- The strings do not get translated — they get **deleted**. Tools return facts,
  the model writes the words in whatever register the customer used.
- Add a Closer test mirroring `prompt sets no language and scripts no speech`,
  so the rule is enforced for both agents rather than only Pitch.
- Grep for `isTagalog`, `locale`, `language`, `Taglish` before declaring done.

---

## 14. Accounts, checkout, and provisioning

**Built 2026-08-13. Working end to end except live payment.**

### The architecture, in one line

Payment creates the account. There is no signup form, and that is deliberate.

```
/pricing/  →  cart  →  checkout  →  Xendit invoice  →  customer pays
                                          ↓ webhook (PAID)
                       order paid · subscription active · invoice paid
                                          ↓ provisionPaidOrder()
                Company (AIS-YYYY-NNNN) + owner User + CompanySetting
                       Subscription.company_id ← links payment to tenant
                                          ↓
                    welcome email with a SET-PASSWORD link
                                          ↓
                 customer chooses their own password → /admin/login
```

Why no signup form: an open form lets anyone create a tenant at 3am with no
payment, no intake call and an empty knowledge base, then judge Closer by a bot
that knows nothing about their business. The ₱4,999 setup covers work *we* do.
Payment is the gate.

### Files

| File | Role |
|---|---|
| `src/payments.js` | `XenditProvider` — Invoice API. Was an EMPTY STUB extending MockPaymentProvider, so keys alone did nothing. |
| `src/provisioning.js` | `provisionPaidOrder()` — idempotent tenant creation + welcome email |
| `src/password-reset.js` | token issue/redeem; only sha256(token) is stored |
| `scripts/simulate-payment.js` | test bypass, see below |
| `public/app.js` | login / forgot-password / reset-password panels |

### Key decisions

- **Idempotent provisioning.** Xendit retries webhooks; running twice would
  create two companies and strand the first. Every step checks before it
  creates. Verified: second run returns `alreadyProvisioned`, one company.
- **We never choose the customer's password.** A random one satisfies the
  non-null column; they set their own via the emailed link. Emailing a password
  we generated leaves a working credential in an inbox forever — the same
  mistake as the `ChangeMe123!` default that shipped live on the login page.
- **Provisioning never throws into the webhook.** A failure logs loudly and
  leaves the order paid, so Xendit does not retry a payment already recorded.
- **Returning buyers** attach to their existing company (`User.email` is
  globally unique). Multi-workspace needs the `Membership` table drafted in
  `docs/DRAFT-membership-workspace-switcher.md` — NOT applied.
- **Webhook lookup uses BOTH ids.** Xendit's `id` is their invoice id;
  `external_id` is OUR order number. Matching only `external_id` against
  `external_payment_id` never hits, so a real payment would have left the order
  unpaid.

---

## 15. The login section — current state and what remains

`/admin/login` is Meta-reviewed (§12). It was NOT moved, renamed or
redirected. The two new screens are additions in the same client-side shell:

| Route | Purpose |
|---|---|
| `/admin/login` | sign in — unchanged, reviewed |
| `/admin/forgot-password` | request a reset link |
| `/admin/reset-password?token=…` | set a password (also the welcome-email target) |

`setMode(mode, panel)` shows one of three panels inside `#loginPage`. All three
resolve BEFORE the session gate in `routeHandler`, because a locked-out user
cannot authenticate first.

**The welcome email points at `/admin/reset-password`.** That route did not
exist client-side until 2026-08-13 — the link would have rendered the marketing
homepage via the `app.get("*")` catch-all. If that route is ever removed, every
new customer is locked out on day one.

### Security properties (already verified)

- `forgot-password` returns an identical body for known and unknown addresses —
  otherwise it is a way to test who our customers are. Verified with a real and
  a fake address: byte-identical responses.
- Only `sha256(token)` is stored. A database leak yields nothing usable.
- Single use, 60 minutes (72 hours for welcome links).
- Redeeming bumps `User.session_epoch`, which kills every outstanding JWT — the
  reason 30-day sessions are safe.
- Rate limited per IP and per email.
- No auto sign-in after reset: holding the link proves control of the inbox,
  not of the password just chosen.

### What still needs doing

1. **Nothing on the login page tells a stranger where to sign up.** Correct
   today, since payment creates accounts — but a prospect who lands there will
   bounce. Consider a line: "New here? See pricing."
2. **`/admin/reset-password` has no expired-token screen** beyond a toast.
3. **Manual bank transfer has no admin approval screen.** The customer-facing
   proof upload exists (`checkout-status.js`, `/api/…/manual-payment-proof`)
   but nothing lets an admin mark it paid, so those orders can only be settled
   with `simulate:paid` or SQL.
4. **Stripe is a dead end.** `paymentProviderForCountry()` routes non-Philippine
   customers to Stripe, which has no keys and no implementation — they reach a
   mock page and think they have bought something. Restrict country to PH, or
   route everyone to Xendit, before any international traffic.

---

## 16. TEMPORARY: bypassing payment for testing

```bash
npm run simulate:paid                    # newest unpaid order
npm run simulate:paid AS-20260813-955B98 # a specific order
```

Does exactly what the Xendit PAID webhook does: marks order, payment and
invoice paid, activates the subscription, then provisions the workspace and
issues a set-password link. Prints the account number, login email and link.

**Safety guard: it refuses to run when `PAYMENT_MODE=live`.** Without that it
could mark a real customer's unpaid order as settled.

### Why the bypass is needed today

`PAYMENT_MODE` is unset (defaults to `test`) and no Xendit keys are in `.env`,
so `getPaymentProvider("xendit")` falls back to `MockPaymentProvider`. Checkout
still creates a REAL order — only the payment page is mocked.

### Removing the bypass

1. Add to `.env`: `XENDIT_SECRET_KEY`, `XENDIT_PUBLIC_KEY`,
   `XENDIT_WEBHOOK_TOKEN` (test keys start `xnd_development_`).
   `providerReady("xendit")` requires BOTH secret and public key.
2. Point Xendit's webhook at `https://aistaff.click/api/webhooks/xendit`.
3. Restart; confirm `providerReady("xendit") === true`.
4. Run a test payment and confirm the webhook provisions a workspace.
5. Only then set `PAYMENT_MODE=live`, which also disables `simulate:paid`.

### Business identity — MUST be set before live

`payments.js` defaults to "AIStaff Solutions Corporation". The registered
entity is **AIStaff Business Solutions Corporation** (Xendit, Test Mode).
Registration number and address default to "To be provided after verification"
and appear on invoices.

```
BUSINESS_LEGAL_NAME=AIStaff Business Solutions Corporation
BUSINESS_REGISTERED_ADDRESS=Blk 30-32 Lot 1 Cabrera Road Cor. Magnolia St. Glenrose Subd., Brgy. Dolores, Taytay, Rizal, 1920, PH
SUPPORT_EMAIL=mpineda@aistaff.click
SUPPORT_MOBILE=<real number, currently +63 900 000 0000>
```

---

## 17. 2026-08-17 — First real customer connected end to end

Irene Pineda (`AIS-2026-0004`, "Ipineda ads and funnel studio") is the first
non-role customer to complete: pay → provision → set password → log in →
connect a Facebook Page → receive an AI reply on Messenger.

Getting there took four days and five distinct blockers. All five are fixed.
Do not re-derive them.

### 17.1 Facebook Login for Business needs `config_id`, not `scope`

**Symptom:** any user without an app role hit *"Feature Unavailable: Facebook
Login is currently unavailable for this app, since we are updating additional
details for this app."* The OAuth dialog never rendered. `/api/meta/facebook/connect`
returned its 302 and no callback ever arrived, so no server-side logging could
see it. Worked perfectly for Mike (app admin), failed for everyone else.

**Cause:** the app is enrolled in Facebook Login **for Business**, which requires
a dashboard *configuration* whose ID is passed as `config_id`. `server.js` was
sending a raw `scope` string, the classic-Login approach. A raw scope is only
honoured for people holding a role on the app.

**Fix:** configuration created in the dashboard
(Facebook Login for Business → Configurations), ID `1615847410149532`, containing
`pages_show_list`, `pages_messaging`, `pages_manage_metadata`, user access token,
no asset selection. `server.js` now sends `config_id` +
`override_default_response_type=true`. Overridable via `META_LOGIN_CONFIG_ID`.

**Do not** switch that configuration to a system-user access token. It would
require customers to log in with a Business Portfolio, which PH SMBs do not have.

### 17.2 `public_profile` must be at Advanced Access

**This was the actual blocker**, and it is documented only in an FAQ:
*"advanced access to the public_profile permission is required for Facebook Login
for Business apps before they go live... to support authorization from users who
do not have an app role."*

It was at Standard. Standard = app-role holders only, so Login itself refused
every external user before any dialog rendered.

**Fix:** Use cases → Customize → `public_profile` → Actions → **Increase access**.
It went straight to `advanced` / `is_live: true` with no review and no screencast.

`email` is still Standard. Nothing requests it. Leave it.

### 17.3 Selecting a Page never subscribed it to the webhook

**Symptom:** dashboard showed "Connected / Messenger Replies: Enabled" and
messages to the customer Page produced nothing. 227 webhook events arrived for
the AIStaff Page, zero for the customer's.

**Cause:** the select handler in `server.js` stored the Page and returned a
hardcoded `messengerReplies: "Enabled"`. Nothing ever called
`POST /{page-id}/subscribed_apps`. The only place that call existed was
`scripts/configure-meta-webhook.js`, a manual script using
`META_PAGE_ACCESS_TOKEN` — Mike's own Page token. That is how the AIStaff Page
got subscribed months ago, by hand. **Every customer Page would have hit this.**

**Fix:** the select handler now calls `subscribed_apps` with **that Page's own
token**, subscribing `messages,messaging_postbacks`, and reports the real result.
`messengerReplies` is now derived, and `subscribeError` is returned on failure.
Log line: `[fb-subscribe] page_id=… OK|FAILED`.

### 17.4 `keepTypingOn` silently discarded every AI reply

**Symptom:** typing indicator appeared, then nothing. Prisma threw
`Argument 'message_text' is missing` at `messenger-webhook.js:390`.

**Cause:** `keepTypingOn(page, psid, taskPromise)` did `return await taskPromise`,
but line 351 passes a **thunk**: `() => generateSalesReply(...)`. Awaiting a
function returns the function. `ai.reply` was `undefined`. Everything downstream
failed silently — `{...undefined}` is legal, undefined optional fields are ignored
by Prisma — until `message_text`, the first *required* field.

The AI was working the whole time. Replies were generated, tokens logged to
`AiLog`, leads scored, and the text thrown away.

**Fix:** `return await (typeof taskPromise === "function" ? taskPromise() : taskPromise)`.
Both call styles are in use — line 75 passes a promise, line 351 a thunk — so the
tolerant form is required. Do not "clean this up" by changing a caller.

### 17.5 Canned qualification question appended to every reply (RULE 2)

**Symptom:** a clothing store customer asking for prices was answered with
*"Where is your office or project location?"*

**Cause:** `buildGuardrailPrompt` already instructs the model to ask exactly one
qualification question. `buildQualificationReply` then appended a **second**,
hardcoded one from `fieldQuestion()` — a B2B-services default table.

**Fix:** `buildQualificationReply` returns the model's reply unchanged. The prompt
now supplies *facts* (`Lead details still missing: …`, `Highest priority detail to
obtain next: <field_key>`) and the model writes the wording. Added instructions to
mirror the customer's language and register — as an instruction, not a setting.
**Rule 1 is intact: no locale, no flag.**

`fieldQuestion()` still exists on the mock-provider fallback path. **Known
remaining Rule 2 violation. Deferred — do not fix incidentally.** Log alongside §13.

### 17.6 Meta account state (verified via Meta Developer Tools MCP, not the dashboard)

The dashboard labels are misleading. Read them via MCP instead
(`https://mcp.facebook.com/devtools`, Read scope, app `3204429623074319`).

| Permission | Access | Live |
|---|---|---|
| `pages_show_list` | advanced | yes |
| `pages_messaging` | advanced | yes |
| `pages_manage_metadata` | advanced | yes |
| `public_profile` | advanced | yes (fixed 2026-08-17) |
| `email` | standard | — (unused) |

REJECTED: `pages_read_engagement`, `pages_utility_messaging`,
`business_management`, plus three gaming leftovers. Do not add them to the Login
configuration — a rejected permission can invalidate it.

- Business verification: **Verified** (Marga Enterprises, `701533219480958`)
- Access verification / Tech Provider: **Verified** 2026-08-14
- App: **Live** since 2026-07-11. No restrictions, Data Use Checkup complete.

**"Ready to publish" does not mean pending.** `pages_show_list` reads "Ready to
publish" while being `advanced` + `is_live`. Its Actions menu offers only
"Reduce access" — that asymmetry is how you tell: *Increase* = not yet Advanced,
*Reduce only* = already Advanced. **Never click "Reduce access".**

There is an **unfinished submission** open: all three page permissions are
`in_current_submission: true` with **screencasts not completed**. They are already
live so there is no risk, but do not submit it half-finished.

### 17.7 Still open — none blocking

1. **`AS-20260813-955B98`** — Irene's duplicate order, still `pending`. Also note
   `AS-20260813-1E9338` was settled via `simulate:paid`: a paid Order/Invoice/
   Subscription exists for money that never moved. Decide how to record it.
2. **Checkout 500** — `ZodError`, `cartId` and `agreements` arriving `undefined`
   on `POST /api/checkout`. This is what produced Irene's duplicate orders.
3. **Site chat widget down** — every request fails:
   `'max_tokens' is not supported with this model, use 'max_completion_tokens'`.
   Live defect on the marketing funnel.
4. **Cross-tenant leak risk** — `messenger-webhook.js:242`: a webhook for an
   unknown Page attaches to the **oldest active company** and is answered with
   `META_PAGE_ACCESS_TOKEN`. Has never fired (one Page until now). Should reject
   unknown Pages instead.
5. **`/data-deletion` and `/deauthorize` do not exist.** Both 404 on POST; GET
   returns the marketing homepage via `app.get("*")`. §12's status-code check
   reported them passing — **that check validates its own blind spot; compare page
   content, not status codes.** Currently Meta is pointed at
   `/privacy` as a *Data deletion instructions URL*, which has a
   "Retention and deletion" section, so this is not urgent. Implementing a real
   **callback** is what opts you out of Meta's manual identifier-purge duty
   (stated on App settings → Advanced). Needs a `FacebookPage` column for the
   connecting FB user id — schema change, ask first.
6. **IPineda Ads and Funnel Studio Page is not returned by `/me/accounts`.**
   Measured: `raw_count=1`, `dropped_by_filter=0` — Meta never sends it. Our
   filter is innocent. Irene connected "Irene's Closet" instead. Unexplained.
7. **10-minute OAuth window** (`server.js:2823`) is too short for a first-time
   customer reading consent screens. Irene timed out once:
   `meta_error=Facebook+authorization+expired`. Widen to ~30 min.
8. **`/terms` legal entity** — now names Marga Enterprises as operator (fixed
   2026-08-17). `/privacy` still names no entity. `BUSINESS_LEGAL_NAME` is still
   unset in `.env`, so `payments.js` still falls back to the non-existent
   "AIStaff Solutions Corporation".
9. **Xendit keys are still not in `.env`.** `providerReady("xendit")` is `false`.
   Checkout still hands off to `MockPaymentProvider`.

### 17.8 Diagnostic logging added (keep it)

- `[fb-connect] redirecting to Facebook with config_id=…`
- `[fb-connect] /me/accounts status=… raw_count=… error=…`
- `[fb-connect]   page id=… name=… has_access_token=… tasks=…`
- `[fb-connect] kept_after_filter=… dropped_by_filter=…`
- `[fb-subscribe] page_id=… OK|FAILED`
- `[ai-reply] EMPTY reply …` (fires only on the failure case)

The `raw_count` vs `kept_after_filter` pair is what proved the Page filter at
`server.js:2877` was not dropping Irene's Page. Without it we were guessing for
two days. **Do not remove.**

---

## 18. NEXT: Knowledge base intake wizard (designed 2026-08-17, not built)

### 18.1 Why

Irene's workspace has **0 knowledge base entries and 0 qualification questions**.
Closer connects, replies, and knows nothing — so it truthfully says it cannot
confirm details and a team member will follow up. That is correct behaviour and a
useless product. Every customer will land here.

This is also what the ₱4,999 setup fee actually buys: Mike sitting with a client
and extracting what the agent needs to know. The wizard encodes that expertise.

### 18.2 The blocker to design around

`KnowledgeBase` is currently **question/answer pairs**. What a sales agent needs
is not Q&A:

- product specifications, with photos
- price list (file or structured rows)
- promo videos
- mission and vision
- features, benefits, "what are they good at"
- special instructions / things never to say
- delivery, payment terms, service areas

Some are prose, some are media, some are documents, some are tabular. **This is a
`prisma/schema.prisma` decision — ask Mike before touching it**, and it is
expensive to reverse once customer data exists.

Open question to settle first: does everything normalise into Q&A at ingest (the
model generates pairs from uploads), or does `KnowledgeBase` gain typed records?
The first keeps the schema and the retrieval path; the second is more honest but
touches `buildGuardrailPrompt`, which currently flattens kb into `Q:/A:` text.

### 18.3 Sequencing (do not reverse)

1. **Schema** — decide what a knowledge base holds.
2. **Intake UI** — guided wizard, one topic per step, explaining *why* each item
   makes the agent better, not just *what* to upload. Show progress. Allow skip
   and return. This is the deliverable Mike cares about most.
3. **Owner notification email** — only after 2 exists. An email saying "complete
   your setup" needs somewhere to send them that can accept what it asks for.

Building the email first means Irene gets a link to a page that cannot take her
price list.

### 18.4 Constraints

- **Rule 2 applies hardest here.** The wizard's job is to collect *facts*. It must
  not generate reply templates or canned answers. Tools return facts; the model
  writes the words.
- **Rule 1**: no language setting anywhere in the intake. Do not add a "reply in
  Tagalog" option however tempting it looks in a settings wizard.
- Emails send via the existing SMTP config in `.env` (working — Irene's welcome
  email delivered). Reuse `provisioning.js`'s sender, do not build a second one.
- New admin screens are **additions** under existing §12 nav items. "Knowledge
  Base" already exists in the locked left-nav order — put the wizard under it.
  No new nav entries, no renames.

---

## 19. 2026-08-17 (evening) — Pricing simplification + KB intake wizard BUILT

### 19.1 Setup fee removed, tiers hidden

`SETUP_FEE = 0` in `payments.js` — **set to zero, not deleted.** Three OrderItem
rows still carry a "One-time setup" line (`AS-20260813-955B98` pending,
`AS-20260813-1E9338` paid) and those are price snapshots that must keep
resolving. `calculateCart` already skipped the line when the fee is 0.

Rationale: the wizard makes setup self-serve, and the §17 Meta fixes were
platform work every future customer gets free. Charging for labour that no
longer happens is a fee you cannot describe.

**Professional and Growth are HIDDEN, not deleted** (`available: false`). The
admin dashboard cannot manage more than one Facebook Page per company, so
selling multi-page capacity would sell something we cannot deliver.
`AVAILABLE_PLANS` / `AVAILABLE_ADD_ONS` are what every customer-facing surface
reads. To restore: flip `available`, remove `hidden` on the cards in
`public/agents/closer/index.html`, drop `is-single` from the grid.

Hiding a card is NOT enough on its own — `calculateCart` now also rejects
unavailable slugs, because `POST /api/cart` with `planSlug:"professional"`
would otherwise still build a valid cart.

The ₱10,000 "AI Knowledge Base Setup" add-on is hidden the same way (the wizard
does it free); order `AS-20260727-BA0FAE` and one cart reference the slug.

**Corrected a wrong comment** in `payments.js`: it claimed `annualPrice` was a
straight monthly × 12 with no discount and that the waived setup WAS the annual
benefit. False — annual is 10× monthly (two months free). Starter annual is
₱49,990, not ₱59,988; ₱4,166/month; saving now ₱9,998. Do not "fix" it back.

**CLOSER10 promo pulled.** It offered 10% off the setup fee. Deliberately NOT
replaced with an invented discount — that is a pricing decision. Old copy is
preserved in an HTML comment in the final-CTA section.

### 19.2 Schema (migration `kb_intake_wizard`, applied)

`pg_dump` taken first: `~/backups/aistaff-pre-kb-wizard-20260817-1829.sql`.
Additive only — new columns plus `question DROP NOT NULL`. No renames, no drops.

`KnowledgeBase` gained: `kind`, `title`, `data` (Json, structured rows),
`valid_until`, `source_name`, `source_kind`, `currency`, `confirmed`,
`display_order`, and an index on `[company_id, active, kind]`.

⚠️ **`confirmed` defaults to TRUE on purpose.** Defaulting false would have
silently dropped the 6 existing rows out of the prompt on migration. Only the
AI-suggestion path may write false.

`CompanySetting` gained `intake_progress`, `intake_completed_at`,
`live_data_source`, `live_data_interest`.

### 19.3 Decision: typed records, NOT Q&A-at-ingest

Normalising uploads into Q&A pairs would have the model write customer-facing
sentences at UPLOAD time and store them — the canned-reply mistake
industrialised. Facts belong in the row; words are written at reply time.

`src/knowledge-base.js` renders rows by kind (`qa`, `prose`, `pricelist`,
`promo`, `policy`, `shipping`, `media`, `instruction`). House rules render LAST,
closest to the model's output. Unknown kinds fall back to prose, never dropped.

**Expiry differs by kind, deliberately.** Only promos auto-deactivate —
a quoted expired promo is an argument with a customer. Prices and policies
never auto-deactivate; they flag for review. Otherwise someone picks "30 days"
on their main price list and a month later Closer knows no prices with no
visible cause. Evaluated in Asia/Manila, matching SMS quiet hours.

### 19.4 The `take: 20` bug (fixed)

`ai.js` loaded kb with `orderBy: created_at desc, take: 20`. That dropped the
OLDEST rows first — the first thing a client entered in the wizard would be the
first to stop reaching the agent. Now `take: 120`, ordered by `display_order`,
filtered to `confirmed: true`. Rows average ~430 chars, so 120 is ~13k tokens,
well inside `gemini-3.5-flash-lite`.

### 19.5 Wizard

`src/intake-steps.js` — 10 steps, ordered by what breaks a conversation soonest
(Irene's real thread reached "can you send me prices" in three messages).

**Industry packs reorder and relabel steps. They must NEVER fork storage,
schema, or code path.** Adding "church" is a config entry, not a feature.
Packs: general, retail, clinic, church, hotel, restaurant. `suggestPack()`
pre-selects from company name + Page name (Irene → retail, WOTG → church).

Files: `src/knowledge-base.js`, `src/intake-steps.js`,
`public/intake-wizard.js` (loaded BEFORE `app.js`, since `routeHandler` calls
`knowledgeBaseView`). Routes: `/api/intake/state|step/:id|skip/:id|pack|
live-data|qualification|extract`. All ADDITIONS under the existing "Knowledge
Base" nav item — no §12 nav label or route renamed.

Upload reuses `price-list-extract.js` (image via Gemini vision, PDF, xlsx/csv,
docx). Extracted text PRE-FILLS the box for the owner to check; it is never
stored unread.

⚠️ **Suggestions must be sourced.** A model inventing plausible FAQs is §9's
phantom pricing at scale — wrong answers stored and served for months. Sourced
suggestions pre-fill and get confirmed; unsourced fields get a question.

Live-data step records `live_data_source` and activates NOTHING (§15's Stripe
dead end). Google Calendar is deliberately absent until it works.

### 19.6 Still open

1. **Owner notification email** (§18.3 item 3) — not built. Now unblocked,
   since the wizard exists to send them to.
2. **AI discrepancy detection on upload** — designed, not built. It can catch
   contradictions, past dates, missing currency and accidentally-uploaded cost
   sheets. It CANNOT catch a clean but outdated price list; say so plainly.
3. **Evidence-triggered daily brief** — trigger on volume, never the clock, and
   derive it from the unanswered-question log, not generic sales advice.
4. **`send_media` tool** — `messenger-webhook.js` has `sendMessengerImage` /
   `sendMessengerFile` / `sendMessengerGenericCarousel` (lines 140-170) but they
   are only wired to page-candidate carousels and quotation PDFs. The tenant
   reply path cannot send an image, so collected media is inert.
5. **Media hosting** — Messenger attachments need a public HTTPS URL. The media
   step collects but has nowhere to put files. Biggest unknown.
6. **`scoreLead` is Marga's copier business hardcoded** (`ai.js:100`): urgency
   words are English-only, `extractLeadPatch` sniffs for copier/cctv/aircon, and
   `quotationReady` requires `company_name` so Irene's B2C leads can never be
   quotation-ready. Do NOT fix by adding Tagalog keywords — that is a language
   setting by another name. The model should return the label.
7. **`/terms` and `/refund-policy`** still reference setup fees becoming
   non-refundable once onboarding begins. Content changes are safe; the paths
   must not move.
8. **Landing page now advertises the wizard** — true as of tonight, but if the
   wizard is ever pulled, that copy must go with it.

---

## 20. 2026-08-18 — Prompts and models out of code, reliability hardening

### 20.0 READ FIRST — the model change that broke replies

Changing Closer to **GPT-5.6 Luna** in AI Studio silenced the Page. Two
separate bugs, both fixed, both worth knowing:

1. **`temperature` is rejected by the GPT-5.x family.**
   `"Unsupported value: 'temperature' does not support 0.2 with this model.
   Only the default (1) value is supported."` Brandee hit this same wall
   months ago (`BRANDEE_PLANNER_MODEL`). `callOpenAI()` now omits the parameter
   for any model matching `/^gpt-5/i`.

2. **A qualification `field_key` that is not a real Lead column crashed the
   reply.** `field_key` is free text typed by the owner; one was
   `preferred_payment_method`, the model returned it in `lead_updates`, prisma
   rejected `Unknown argument`, and the whole reply unwound. `ai.js` now
   filters `lead_updates` against an explicit `LEAD_COLUMNS` set and WARNS
   about dropped keys instead of failing.

**Diagnosis was slowed by a bad error message** — `throw new Error("OpenAI
error " + status)` discarded the provider's explanation. It now includes the
response body. Do not remove that.

**Also fixed:** the model dropdown offered every model for every function, so
`vision_extract` could be set to a text-only model and every upload would have
failed silently. `vision: true` is now marked on both the function and the
catalogue entries, enforced in `setModelFor()` (not just the UI, since the API
is directly callable), and the dropdown reverts on rejection.

Verified after the fix: Luna replies, `needsHuman: false`, and — notably —
answered a Taglish question in Taglish.

### 20.1 Prompts are no longer hardcoded (`src/prompt-store.js`)

Closer's instructions were string literals inside `buildGuardrailPrompt()`.
Now a versioned DB row (`prompt_revisions`), edited in **AI Studio**, with
history, author, note and rollback. Live: **v3**.

- Saving writes a NEW row; nothing is overwritten.
- Rollback flips `is_active` rather than copying text forward, so the log
  records what actually ran.
- The constant in `prompt-store.js` is a BOOTSTRAP for an empty table only.
- Cached 60s, cleared on save/rollback.

### 20.2 THE INSTRUCTION HIERARCHY

Stated explicitly inside the prompt, strongest first:

1. **Platform instructions** — AI Studio, staff only, govern every tenant.
2. **The business's own instructions** — Settings → "Extra instructions for
   your Closer" (`CompanySetting.ai_custom_instructions`). They ADD; they can
   never cancel a platform rule, and the prompt says so in words.
3. **Business Engine instructions** — work-specific rules for an enabled
   engine. A tenant admin can save versioned overrides without weakening
   platform safety or operation-approval rules.
4. **Knowledge base** — facts only.
5. **Live tool results** — runtime facts returned by approved tenant actions;
   they are context, not another saved instruction source.

⚠️ AI Studio previously edited `ai_custom_instructions` through
`aistaff-ai-config`, which only ever reached the SITE CHAT widget. Editing it
did nothing to Messenger. The old screen survives as `legacyAiStudioView()`.

### 20.3 ALL hardcoded behaviour removed from `src/ai.js`

| Removed | Was |
|---|---|
| `REQUIRED_FIELDS` | `company_name, location, urgency…` — Marga's B2B shape on every tenant |
| `DEFAULT_QUALIFICATION_QUESTIONS` | Six fixed English questions |
| `scoreLead()` | `today\|asap\|urgent` — Taglish urgency scored cold |
| `extractLeadPatch()` | Sniffed `copier\|cctv\|aircon`, pasted whole messages into fields |
| `captureQualificationAnswer()` | Assigned the entire message to whichever field was next |
| `isCustomerQuestion()` | English + Tagalog regex — a language rule in code (Rule 1) |
| `mockReply()` / `fieldQuestion()` | Canned replies served **silently during outages** |
| `buildQualificationReply()` | Dead wrapper |

The model now returns `reply`, `intent`, `handoff_reason`, `lead_updates`,
`lead_score`. Code only stores it. `quotation_ready` derives from each
tenant's own required questions, so B2C leads can finally qualify.

**A provider failure now THROWS** rather than serving a template. That is
deliberate — see §20.4.

### 20.4 Reliability: nothing may stall a reply

After the quotation incident (Page silent for hours, only evidence a stack
trace nobody was watching):

**Rule: between receiving a message and sending the reply, only generating the
reply may abort.** Everything else is bookkeeping wrapped in `bestEffort()` —
message persist, lead update, conversation update, handoff record, quotation
draft. Per-event isolation added too: Meta batches events, and one bad event
used to abort the whole batch.

**Send happens BEFORE recording the AI message.** It was the other way round,
so a DB hiccup swallowed a reply already paid for.

**Handoff no longer means silence.** `if (!auto_reply || ai.needsHuman) return`
threw away a written reply whenever a human was wanted. It now sends AND
alerts.

Root causes fixed the same day:
- `nextQuotationNumber()` used `count + 1`, which breaks permanently once
  numbers have a gap (had `00001` and `00003`, count=2, regenerated `00003`
  forever). Now derived from the highest existing. **A second copy of the same
  broken function lived in `aistaff-tools.js`** — fixed identically.
- Keyword handoff rule fired on `"agent"`, `"discount"`, `"tao"`. Removed;
  only the model decides.
- **`buildGuardrailPrompt` contained NO conversation history.** Closer asked
  "what medicine do you sell?", got "Bulate latigo 500", and — with no memory
  of asking — treated it as a medical question and escalated. No instruction
  could fix that. Now sends the last 12 turns.

### 20.5 Model registry (`src/model-registry.js`)

`model_settings` table + AI Studio dropdowns with live per-1,000-replies cost.
Env had already drifted (`GEMINI_MODEL=gemini-1.5-flash`, chosen by nobody).

Verified pricing per 1M tokens, 2026-08-18: GPT-5.6 Luna $0.20/$1.20 ·
gpt-4.1-mini $0.40/$1.60 · Gemini 3.1 Flash-Lite $0.25/$1.50 · Gemini 3.7
Flash $0.75/$3.75 **introductory, doubles to $1.50/$7.50 on 1 Jan 2027**.

Closer's prompt is ~15k tokens in, ~200 out, so **input price is ~98% of
cost**. Prompt caching (10% on cached input) is worth more than any model
swap — requires the stable prefix (instructions, then KB, then conversation,
then message) to stay in that order. NOT YET BUILT.

⚠️ Prompt caching ≠ response caching. Never cache responses; that is canned
copy by another name.

### 20.6 Other work this session

- **Nav gating** by `platform_role`: customers no longer see Marketing,
  Onboarding, AI Studio. Fail-safe — full nav is the DEFAULT, hidden only when
  `platform_role` is null. `reviewer@aistaff.click` was null and is now STAFF,
  so §12's submission videos still match. Route guard added; a hidden link is
  not access control.
- **Cross-tenant leak closed**: `ensureFacebookPage()` attached unknown Pages
  to the oldest active company and replied with Mike's token. Now rejects.
- **Demo routing removed** — every Page uses the tenant Closer path.
- **Closer status pill** in the header (`src/closer-health.js`), derived from
  real signals, alerts on transition into failure.
- **Page disconnect** endpoint + button; unsubscribes from Meta, marks
  inactive rather than deleting (conversations reference it).
- **Setup fee → 0**; Professional/Growth hidden (`available: false`) because
  the dashboard cannot manage multiple Pages; custom integration is now
  ₱10,000–15,000 and covers every agent on the account (Closer + Pitch share
  one connection).
- **`Company.contact_person`** added; Settings restacked into one column with
  grouped sections.
- **Cloudflare rewrites `no-cache` to `max-age=14400`** at the edge. Hard
  refresh after every JS change until a cache rule exists.

### 20.7 OPEN — next session

1. **Handoff email — `notify_email` is stored and read by NOTHING.** Highest
   value gap. Mike wants: collect name + mobile + email BEFORE handing off,
   then email the business the lead details. Use **support@aistaff.click** —
   the mailbox must exist in Hostinger with its own credentials, since the
   `From` must match `SMTP_USER`.
2. **"Never hand off empty-handed" + "ask naturally, not like a form"** —
   agreed instruction blocks, not yet added to AI Studio.
3. **Split the industries document.** Conduct rules ("Closer must not
   diagnose") are still inside the 21k-char knowledge base entry, written in
   the third person, so Closer RECITES them to prospects. They belong in AI
   Studio (already partly added in v2); strip them from the KB entry.
4. **Anti-repetition instruction** — never repeat a greeting or a question
   already asked.
5. **Owner notification email** on wizard progress (§18.3 item 3).
6. **AI-assisted instruction box** in Settings: owner writes in Taglish, model
   converts to instructions. The rewriter must NOT be the security boundary —
   precedence in the reply prompt is.
7. **Prompt-improvement proposals**: model reads failed conversations and
   PROPOSES an AI Studio revision; Mike approves. Never auto-applies. Flag
   loudly if a proposal touches CONFIDENTIALITY, ACCURACY or INDUSTRY CONDUCT.
8. **Per-company version history** for the customer's own instructions
   (`prompt_revisions` already supports it via `key`).
9. **Media hosting + `send_media`** — the wizard collects photos, Closer still
   cannot send them. Closer now OFFERS to send a file it cannot attach.
10. **`aistaff-ai-config.js` cache is cross-tenant unsafe** — module-level
    `cachedConfig` with `(!companyId || …)` returns another tenant's config on
    a no-arg call. Only `aistaff-demo.js` can trigger it today.
11. **Site chat reads AIS-2026-0002 while the FB Page belongs to
    AIS-2026-0001** — two different knowledge bases. The comment at
    `server.js:1136` claiming they share rows is FALSE.
12. **§13 `isTagalog`** (~207 sites) and dormant
    `CompanySetting.default_language` still unfixed.

---

## 21. 2026-08-20 — Payments live, platform area, repricing

### 21.0 READ FIRST

**Money works end to end.** PayMongo test payment → webhook → order paid →
company provisioned → welcome + admin emails. Verified with order
`AS-TEST-209763`, which created `AIS-2026-0005`.

**PayMongo is LIVE as of 2026-08-20.** `.env` has `PAYMONGO_MODE="live"`,
live secret key, live webhook secret, and `PAYMONGO_METHODS="qrph"`.
QRPh is the only active live channel today; GCash, Maya, cards and other wallet
rails are not offered until PayMongo activates them for the merchant account.
Do not re-enable inactive methods in UI or prompt unless the dashboard says
they are active.

**Private live-money test discount.** `/pricing/` now has a discount-code field.
If the entered code matches `PAYMONGO_LIVE_TEST_CODE` in `.env`, checkout is
recalculated server-side to `PAYMONGO_LIVE_TEST_TOTAL` (currently ₱10) and a
negative "Payment gateway live test discount" line is added to the cart/order.
The actual code must stay in `.env` only; do not hardcode it in source,
handoff, prompt, or customer-facing copy.

**Two AIStaff companies became one.** AIS-2026-0001 renamed "AIStaff" (it owns
the Page, 12 knowledge entries, media, conversations). AIS-2026-0002 retired.
The site chat now reads 0001, so widget and Page finally share one knowledge
base — the comment at server.js:1136 claiming they already did was FALSE.

### 21.1 PayMongo (src/payments.js, src/checkout-link.js)

Chosen over Xendit: QR Ph active on signup, no separate application, and
Xendit does not publish PH rates. QR Ph 1.34% vs Xendit 1.5%; cards
3.125% + ₱13.39; GCash 2.23%.

- `PayMongoProvider` uses **Checkout Sessions**, not Links — a session carries
  `reference_number` (our order number), which is what makes webhook
  attribution automatic.
- Amounts in **centavos**, converted in exactly one place (`toCentavos`).
- Webhook at `/api/webhooks/paymongo`, HMAC-SHA256 over `timestamp.body`,
  compared with `timingSafeEqual`. PayMongo nests payloads two levels deeper
  than Xendit — handled separately in `processPaymentWebhook`.
- PH routing now returns `paymongo`. XenditProvider kept, not deleted.

⚠️ The checkout page offered **"Xendit local payments"** while the backend had
already switched — customer picks one provider, billed by another. Fixed
2026-08-20; now reads "Pay online — QR Ph, GCash, Maya, GrabPay, card".

### 21.2 Closer can take payment in Messenger

`create_payment_link` — a field the model sets ONLY after agreement AND an
email. Code creates the order and sends the link as its own message.

- **The amount is written in code, not by the model.** A wrong price in a
  payment message cannot be walked back.
- **One open order per conversation, 24h reuse.** Guards the duplicate-order
  failure (AS-20260813-955B98), which matters far more now a model can trigger
  checkout.
- **AIStaff-only**, gated on company id — a tenant's Closer creating an AIStaff
  order would charge THEIR customer for OUR subscription.
- Email is asked for first and read back: it becomes their login, so a typo
  locks someone out of what they just paid for.

### 21.3 Prompt versions v11–v31

- **v11 selling behaviour**: sell the pain not the feature; give them their time
  back; handle doubt without pressure; ask for the sale; know when to stop.
  Written as behaviour, never scripts.
- **v12 security**: flags impersonation, credential requests, prompt injection,
  data requests via `security_alert`. Emails BOTH the tenant and AIStaff.
  Closer never mentions it flagged anything — someone probing should learn
  nothing from the reaction. Tested 3/3 caught, control question clean.
- **v15 tenant payment policy**: Payment and checkout knowledge became the
  authority for closing path, payment methods, provider/link source, details to
  collect, amount rules, prohibited actions, and after-payment handling.
- **v16 QRPh confirmation**: when tenant payment setup says collect inside chat
  through QRPh/PayMongo QRPh, Closer must collect name/email, confirm package,
  amount, name and email, then create/send payment.
- **v17 QRPh friction reduction**: prefer sending the QR image plus link when
  available; otherwise tell the customer to open the hosted checkout, tap
  Continue, then screenshot/download the QR and upload/scan it in GCash, Maya,
  or a banking app.
- **v18 QRPh-only advisory**: when the tenant's Payment and checkout knowledge
  says QRPh is the only active/available payment method, say briefly that direct
  GCash and card payments are still being worked on and payment is currently
  through QRPh QR code only. Match the customer's language and say it only when
  true for that tenant.
- **v19 consultative close**: stops repetitive "do you want to avail" endings.
  Closer now advances each exchange by naming one relevant pain, connecting it
  to one solution, asking the next useful question, or closing only when the
  buyer is ready. It asks for a website/Facebook Page only when the prospect is
  a business buyer or the tenant's questions require it, and it may send
  available in-chat media instead of pushing customers to links.
- **v20 public website research context**: Closer may use conversation-scoped
  public website research as temporary context for that prospect only. It helps
  infer what they sell, likely pain points, and relevant solution angles, but it
  is not permanent tenant knowledge and must not invent exact pricing, stock,
  promos, or policies unless explicitly shown in the research text.
- **v21 website-first B2B discovery**: when the prospect has another business
  or asks whether Closer can help their company, Closer must ask for the public
  website or Facebook Page link first. In the same short message it can say that
  if they do not have one, they can describe their product/service and
  customers. It must not replace the website/Page request with only "what do you
  sell?" unless they already said they have no website/Page.
- **v22 website-only discovery**: simplified v21. For B2B prospect discovery,
  Closer asks for the public website link first, not Facebook Page by default.
  If they have no website, they can describe their product/service and
  customers. Facebook Page review should wait until the system can reliably
  capture/read Page content.
- **v23 pain-benefit follow-up bubble**: Closer may send one optional second
  Messenger bubble after the direct answer for B2B prospects. Use it only for
  one relevant pain/consequence/benefit, such as missed bookings, slow replies,
  repeated questions, or starting with one channel and upgrading later. It must
  not be filler, pressure, or another repeated package question.
- **v24 value bridge every B2B reply**: strengthens v23. For B2B sales
  prospects, every reply should carry one pain, consequence, benefit, proof
  point, or next-step advantage when appropriate. If it would make the direct
  answer too long, put that value bridge in the second short bubble. When
  testimonials/case studies/reviews/client results exist in the knowledge base
  or sendable media, use one proof point at a time; never invent proof.
- **v25 business-model closing**: website research now determines the
  prospect's real conversion type. A spa/salon/clinic/restaurant/hotel-style
  business should be discussed as bookings, appointments, reservations, slots,
  branches and customer details — not quotations unless the site or tenant
  knowledge says quote first. If Payment and checkout says booking/reservation
  or payment can be completed in Messenger and handoff is not selected, Closer
  must collect the required details and finish the configured close in chat as
  far as the system allows.
- **v26 close ownership / no premature escalation**: Closer's number one job is
  to close the configured outcome, not merely answer and escape to staff. It
  must not ask for email/mobile just to "elevate this to the team." Contact
  details are requested only when they are the next required closing detail
  (payment link/QR, booking, reservation, order, quotation request, setup, or a
  configured handoff). Handoff is a last resort unless the customer asks for a
  human, raises a complaint/safety/security issue, the tenant chose handoff, or
  the system truly cannot proceed.
- **v27 tenant booking setup**: Closer reads the tenant Bookings settings when
  enabled, asks only the configured appointment/reservation fields, and treats
  unconfirmed slots as pending unless live/system/staff confirmation exists.
- **v28 booking action**: Closer can set `create_booking` after the configured
  booking details are complete and confirmed. Messenger creates a pending
  booking request and returns a booking reference.
- **v29 entry-price close**: replaces the old "always give the complete money
  picture" instruction. Closer now leads with the simplest relevant entry offer
  or single recommendation first. Annual totals/savings, higher tiers, and full
  package tables are mentioned only when the customer asks, is comparing,
  objects to price, or tenant knowledge says they are relevant.
- **v30 entry-offer first reply**: strengthens v29. The first pricing/how-to-
  avail reply must give one entry/recommended plan, the monthly/common entry
  price, and strong features/benefits/outcomes. It must not mention annual
  pricing, yearly billing, annual savings, annual packages, all tiers, or the
  full price table until the customer explicitly asks or has already selected a
  plan and is discussing billing/payment options.
- **v31 demo-before-subscription**: for AIStaff/Closer's own sales
  conversations, Closer no longer pushes immediately to subscription, cart,
  checkout, QRPh, or payment. It presents up to five relevant pain points with
  matching benefits/solutions, then offers the live demo first:
  `https://aistaff.click/agents/closer/#demo`. Second offer is a video-call
  consultation with the AIStaff team; collect preferred date/time, name, email,
  and mobile, then say the team will send the video link after scheduling.

AIStaff tenant KB also has a HOUSE RULE row titled `AIStaff pricing close rule`.
It says to lead pricing/how-to-avail conversations with Starter at ₱1,499/month,
Facebook Messenger, 100 inquiries/conversations, 1 Page, 1 staff login, no setup
fee, onboarding assistance and ongoing support, then emphasize benefits such as
24/7 replies, language matching, media/file sending, qualification questions,
customer detail capture, lead temperature, quotation drafts, unanswered-question
tracking, and fewer missed inquiries. Do not list all four packages or annual
pricing in the first reply. Mention higher tiers only when the prospect asks,
needs website chat/both channels/more capacity/more staff logins, or asks to
compare.

### 21.3.1 Intake setup records

Payment and checkout and Pain points and solutions are setup-style records, not
endless one-off entries. Returning to those steps now reloads the latest saved
checkboxes/text so the tenant can review or change them, and saving updates the
existing setup row instead of creating duplicates.

Normal multi-entry steps such as "Who you are and what you sell" stay blank
when opened from the left rail because that form is for adding another entry.
Editing an existing entry must happen through that row's Edit action; otherwise
the wizard may hydrate the wrong row from the category and make it look like the
real business description was lost.

### 21.3.2 AIStaff onboarding promise

AIStaff no longer promises a fixed onboarding window. The live tenant KB rows
for "how can I avail" and "onboarding process" now say onboarding assistance is
ongoing, can be scheduled on the customer's preferred day/time, and can be
handled done-for-you if the customer sends the needed business information:
products/services, prices/packages, promos, FAQs, files/media, payment/checkout
rules, delivery/booking rules, policies, qualification questions, and staff
confirmation rules.

The provisioning welcome email mirrors this after payment. Messenger-created
checkout links now store `orders.source_conversation_id`, so when PayMongo
confirms payment the webhook can message the same Messenger conversation with
the setup scheduling and done-for-you information list.

### 21.3.3 Tenant booking calendar MVP

Added an optional Bookings workspace for every tenant. It is inactive by
default and only becomes part of operations when the tenant enables it.

Database/API/UI pieces:

- `BookingSetting`, `BookingService`, and `Booking` in `prisma/schema.prisma`
  with migration `20260820200000_tenant_booking_calendar`.
- `/api/bookings`, `/api/bookings/settings`, `/api/bookings/services`, and
  booking status update routes in `src/server.js`.
- `/admin/bookings` in `public/app.js`, styled in `public/style.css`.

This is deliberately a tenant workspace/admin MVP first: settings, services,
manual appointment entry, status updates, and a simple 35-day grid. It now has
industry presets/custom selected fields on `BookingSetting`: `booking_type`,
`field_mode`, and `required_fields`. Presets include general appointment,
AI service/onboarding meeting, spa/salon, clinic/doctor, restaurant, hotel,
repair/home service, gym/class, school, church/ministry, real estate, car
dealership, and personal service. Per-booking extra answers are stored in
`Booking.field_values`, so "purpose" can mean repair, meeting, onboarding,
reservation, etc. without adding a column per industry.

It is NOT yet a Closer tool and does not yet check live availability. Until that
tool is wired, Closer may collect booking/reservation details according to the
tenant's Payment and checkout policy and booking settings, but must not promise
a confirmed slot unless a staff/user/system confirmation exists.

### 21.3.4 Prompt v27 — booking setup awareness

Active global prompt is now v27. Added a platform instruction requiring Closer
to follow the tenant's Booking setup for appointments, reservations,
onboarding meetings, repairs, consultations, rooms, tables, viewings, test
drives, classes, and similar scheduled services.

`src/ai.js` now injects `=== THIS BUSINESS'S BOOKING SETUP ===` into every
Closer prompt using `BookingSetting` plus active `BookingService` rows. This
lets Closer ask the correct configured fields (purpose, onboarding topic,
preferred date/time, party size, check-in/out, etc.) instead of guessing from a
generic script or the wrong industry.

Implemented next step: `create_booking` is now in the model JSON contract and
Messenger webhook path. When the booking setup is enabled and Closer has a real
scheduled request with exact date/time, `src/ai.js` may return
`create_booking`. `src/messenger-webhook.js` validates it, creates a
`Booking` row with `source="messenger"` and `status="pending_confirmation"`,
then sends a separate Messenger message with a `BK-XXXXXXXX` reference.

Conservative guardrails: missing customer name/contact/exact date-time means no
booking row is created. The customer gets a short follow-up asking for the
missing booking detail. The system never creates a confirmed booking from
Messenger; staff or a future live availability integration must confirm it.

### 21.4 Platform area (/platform)

Separate from /admin because /admin is ONE workspace and AIStaff staff are
themselves tenants. Pure addition — nothing Meta reviewed changes (§12).

**Three roles** (`src/platform-roles.js`): `admin` (everything incl. staff
management), `manager` (customers only), `support` (customers + global prompt
and models). **Only admin manages platform users** — everything else is
recoverable, the ability to grant yourself permissions is not.

**Assist mode**: enter a customer's workspace, session re-issued against their
company id (same mechanism as signing in, so every tenant-scoped route works
unchanged). Logged on ENTRY with reason. Red banner stays on screen throughout.

**Accounts**: `mikep@` admin + tenant account_admin; `admin@` tenant only;
`michael.marga2@` account_user; `reviewer@` KEEPS manager — §12 requires its
nav to match the submission videos.

⚠️ `mpineda@aistaff.click` DOES NOT EXIST. Chrome suggests it; the real admin
is `mikep@aistaff.click`.

### 21.5 Repricing — four tiers

| | Starter | Essential | Professional | Enterprise |
|---|---|---|---|---|
| Monthly | 1,499 | 2,999 | 4,499 | 6,999 |
| Annual | 14,990 | 29,990 | 44,990 | 69,990 |
| Conversations | 100 | 300 | 600 | 1,200 |
| Channels | Messenger | Messenger OR website | Both | Both |
| Logins | 1 | 2 | 3 | 10 |

Old 4,999/9,999/19,999 dropped. The old top tier earned LESS than the middle
one once AI cost was subtracted. Modelled in `docs/pricing-options.csv`.

- `facebookPageLimit` is 1 EVERYWHERE — the dashboard cannot manage multiple
  Pages. Raise to 3 only when that is genuinely built.
- **"Booking assistance" removed** from features: no live availability check,
  so Closer can take a request but cannot confirm one (§15).
- Features rewritten as outcomes. Support listed separately, with **no time
  promises** — "onboarding assistance", not "2-day onboarding".

### 21.6 Also built

- **Media**: `src/media-store.js`. Files stored at ORIGINAL quality (raw binary,
  not the compressed OCR copy), public URLs because Facebook fetches them
  itself. `send_media` resolves ids to URLs from the tenant's own rows — the
  model never supplies a URL. Same file never sent twice per conversation
  (`Message.attachments` records what actually went out).
- **Knowledge gaps** (`KnowledgeGap`): Closer flags what it could not answer;
  surfaced at the top of Knowledge Base. This is the "we tune it with you"
  promise made real.
- **FAQ generator**: 30 anticipated questions, marked covered or not. Never
  stores "NA" (a skip writes nothing) and never stores an already-covered
  answer twice.
- **Notifications** (`src/notify.js`): handoff, setup milestone (50%/100% only),
  gap digest, new sale, security alert. All from `support@aistaff.click` —
  Hostinger rejects sending as an address the authenticated mailbox does not
  own, so SMTP_USER is now support@ too.
- **Profile lookup**: real name + photo from Meta's User Profile API, fetched
  once per conversation.
- **Mobile admin**: full responsive layer. Nothing hidden; tables scroll, forms
  single-column, 16px inputs so iOS does not zoom, 44px touch targets, modals
  become bottom sheets.

### 21.7 OPEN — next session

1. **Conversation counter.** Nothing counts anything — the tier limits are
   marketing. Needed before enforcement AND to price on real data: the CSV
   assumes 10 replies per conversation, which is a GUESS.
2. **Prompt caching.** Cached input is ~10% cost. At 10,000 clients this is
   ₱1.9M/month vs ₱190k. Requires the stable prefix (instructions → KB →
   conversation → message) to stay in that order.
3. **Onboarding automation** — the real ceiling on 10,000 clients. Compute is
   trivial; 10,000 manual onboardings is not.
4. `/pricing/` Enterprise form still says "Starting at ₱100,000/month" beside a
   listed ₱6,999 Enterprise tier. "Enterprise" now means two things.
5. Qualification `field_key` values that are not Lead columns are dropped with a
   warning — Irene has questions whose answers can never be stored.
6. Tenant-level user management does not exist (account_admin / account_user
   are stored but not manageable).
7. Media hosting has no cleanup — deleted entries leave files on disk.
8. §13 `isTagalog` (~207 sites) and dormant `CompanySetting.default_language`.
10. `aistaff-ai-config.js` cache is cross-tenant unsafe.

### 21.8 Business Engines — live 2026-10-13

Closer now has a tenant-configurable business capability layer at **Settings →
Business Engines**. The initial catalog contains Customer Service, Booking,
Sales, and Finance. Each tenant can activate engines independently, select the
fields Closer may read or collect, add tenant-specific fields, configure the
operation approval policy and fallback, and map operations to actions from
Connections & Actions.

Runtime contract:

- only enabled engines contribute instructions;
- only enabled operations with enabled action mappings become Closer tools;
- platform safety instructions and minimum approval policies always win;
- mapped raw integration actions are removed from direct model exposure;
- staff-only, staff-approval, customer-confirmation, and automatic policies use
  the existing integration execution workflow;
- missing capability is logged as a tenant capability gap and can create a
  human-help request without letting the model invent an endpoint;
- disabling an engine immediately removes its instructions and tools while
  retaining configuration for later reactivation.

Data is normalized in `BusinessEngine`, `EngineFieldDefinition`,
`EngineOperationDefinition`, `TenantEngine`, `TenantEngineField`,
`TenantEngineOperation`, `EngineOperationMapping`,
`BusinessOperationRequest`, `CapabilityGap`, and `TenantAuditLog`. Migration:
`20261013204500_business_engines`.

Production verification completed on Ryzen 7: schema migration and Prisma
client generation succeeded; the catalog initialized with 4 engines, 66
fields, and 51 operations; 18 focused Business Engine/integration tests passed;
a self-cleaning database smoke test proved tenant isolation, disabled runtime,
and fallback logging; and an authenticated public-host test proved admin
control, account-user rejection, and activation/deactivation read-back. All
four engines remain inactive for Marga Enterprises until an administrator
chooses to enable and map them.

### 21.9 Universal Connections & Actions — live 2026-10-14

Settings → Connections & Actions now uses a progressive, resumable workflow:
**Discover → Authenticate → Test → Review Actions → Activate**. The first view
shows only one field: the website or API-guide URL. AIStaff derives the
application name from the hostname. Advanced REST/OpenAPI fields are not shown
until discovery fails. Manage mode renders only the current actionable step;
future steps and the main connection list remain hidden until the user returns.
On failure, the page offers two direct choices: open Advanced setup and enter
the API base URL plus OpenAPI URL/document supplied by the customer's IT team,
or retry with another URL. Connected Applications and Action History reveal
details only on demand, and the authenticated admin shell stays mounted without
flashing the public homepage.

Backend behavior:

- backend-only bounded discovery for OpenAPI JSON/YAML, known public paths, and
  same-origin documentation references;
- failed saved connections can retry discovery through the same tenant-scoped
  record instead of creating duplicates;
- HTTPS/public-network enforcement, DNS and redirect revalidation, size and
  timeout bounds, content-type checks, and discovery rate limiting;
- detected API-key header/query, bearer, Basic, OAuth 2.0 Authorization Code
  with PKCE, and no-auth flows; secrets remain AES-256-GCM encrypted;
- safe read-only connection tests distinguish verified credentials from mere
  host reachability; manual verification requires a reason and is audited;
- semantic action groups; every discovered action starts disabled;
- high-impact delete/payment/send/cancel-style work requires staff approval and
  explicit acknowledgment, enforced in the service rather than only the UI;
- approved actions can be assigned to enabled Business Engine operations;
- action history returns compact summaries and masked on-demand details;
- behavior controls bound timeouts, response size, read-only retries, and
  per-connection request rates; Closer can never supply an arbitrary URL or
  authorization header.

Migration: `20261013235500_smart_integration_discovery`. Main files:
`src/integration-discovery.js`, `src/integrations.js`,
`src/routes/integrations.js`, `public/integrations-settings.js`,
`public/style.css`, `prisma/schema.prisma`, and
`test/integrations.test.js`.

Verification on Ryzen 7: 23/23 focused integration/Business Engine tests pass;
the additive migration deployed successfully; the service restarted as
`aistaff-api.service`; the real `https://aistaff.click/api/health` endpoint is
healthy. A self-cleaning two-tenant database sample proved initial actions are
disabled, destructive action acknowledgment and staff-policy enforcement,
activation after approval, and cross-tenant invisibility. The complete suite
currently has 424/427 passing; the three failures are unrelated pre-existing
Brandee tests (two stale HTML expectations and one Node 18 / sharp runtime
test incompatibility).

Minimal workflow update verified live on 2026-10-14: 12/12 focused integration
tests passed, JavaScript syntax checks passed, `aistaff-api.service` restarted
successfully, and both local and public `/api/health` reported a healthy
database. The versioned public JavaScript and CSS assets contain the one-field
connect form, current-step renderer, and failed-discovery recovery actions.

Known limits: REST/OpenAPI is the only advertised live connector. GraphQL,
SOAP, webhook-only apps, private-network agents, automatic secret rotation,
and provider-specific OAuth refresh edge cases remain deferred. Marga
Enterprises has one active, successfully tested connection (`Cha`) with 12
discovered actions; only explicitly approved actions are available to Closer.

### 21.10 Guided Business Engine setup — 2026-10-14

Business Engines now follow a reviewed activation flow instead of exposing a
second tenant prompt and a manual mapping matrix by default:

1. connect the tenant application under Connections & Actions;
2. open the required Business Engine;
3. review AIStaff's semantic action and field suggestions;
4. resolve only the uncertain required fields;
5. activate the selected jobs after a safe connection test.

Unsupported jobs remain with staff and are never presented to Closer as tools.
The manual field and operation matrices, safe test, and activity/approvals are
still available under collapsed advanced sections. Connecting an application
does not activate an engine.

The editable instruction hierarchy is now explicit: AI Studio owns the global
platform prompt; Settings > General > Closer Instructions owns company-wide
workflow and tone; each enabled Business Engine owns work-specific guidance;
Knowledge Base supplies facts; live API results are runtime context. Engine
Instructions are collapsed by default but editable. Saving creates a new
tenant-scoped version, rollback activates an earlier version, reset returns to
the platform default while preserving history, and only inactive versions may
be deleted. Runtime uses the active custom engine version when present and the
platform snapshot otherwise. Activating or reconfiguring an engine does not
clear its selected instruction.

Production verification for versioned Engine Instructions on 2026-10-14:
30/30 focused Business Engine and integration tests passed. A self-cleaning
temporary tenant proved save v1, save v2, runtime use of the custom text,
rollback to v1, active-version deletion protection, reset to platform default,
inactive-version deletion, and zero leftover test rows. The user service was
restarted and the cache-busted assets were verified through
`https://aistaff.click`.

Marga's live connection currently documents customer search, customer detail,
customer-machine listing, machine service detail, ticket creation/status, and
approved email operations. It does not document a serial-number search. The
Customer Service recommender therefore does not claim that capability. A true
serial lookup must be added to Marga's OpenAPI document before AIStaff can map
and use it. Compound numeric workflow status IDs are also left for explicit
review rather than guessed from a generic `status` field.

Production verification: 33/33 focused engine, connector, tenant-isolation,
and admin-navigation tests passed. A self-cleaning live database sample proved
that a temporary tenant has zero engine tools before activation, that guided
setup safely tests the connection and activates exactly one reviewed mapping,
and that the mapped Closer tool appears afterward; the tenant and all related
rows were deleted and a zero-row cleanup check passed. The Ryzen service and
the real public health endpoint remained healthy.


---

## Session 2026-10-19 → 10-20: Director, required caller contact, follow-up actions, alert contacts

Plans: `docs/MASTERPLAN-director.md` (sections 1-9). Details per change: `CHANGELOG.md` (entries 2026-10-19 22:30 → 23:50).

### Built and live
1. **Director** (`src/director.js`) — code drives workflows; the AI only interprets (JSON commands) and writes replies.
   - Commands: start_flow, identify, set, choose, confirm, cancel, question, handoff, followup, contact, update_previous.
   - Reuses the blueprint engine (must-ask, derived, dry run, confirmation, idempotency, scope, staff alerts, memory reset).
   - Reference line appended by code. Remembered name/phone/email/machine reused on the next request.
   - Enabled per job with `workflow_config.director.enabled`; Marga `customer_service.create_service_request` is ON
     (identify by serial via `customer_service.find_machine`). Non-workflow messages fall back to the normal Closer.
   - Follow-ups on the last request (status, chasing, complaint, giving contact details) are handled by the Director:
     URGENT (N×) alert every time while unresolved, customer status email (max every 30 min, immediately on a new email),
     asks for missing email/phone, never says "blocked", never promises a call. Late corrections go to staff.
   - Hooked into `generateSalesReply` (`src/ai.js`) before the agent path. Local llama.cpp keeps JSON mode when no tools.
2. **Workflows panel** — Settings › Business Engines › "How your AI employee handles requests" (`src/workflows-view.js`,
   GET/PUT `/api/business-engines/workflows`): plain-language steps, Guided mode on/off, weekly saved/blocked, warnings.
3. **Caller contact required everywhere (Marga)**
   - Staff form app.marga.biz/service: Caller Email field; name + phone (>=7 digits) + valid email required; prefill from
     the customer file; write-back (new contacts to `tbl_branchcontact` with email; empty branch email filled; replace only
     after confirm; changes logged in `marga_customer_change_log`). Assign To auto-fills by area + purpose; warns when the
     area has no staff. Only 11 tech-area assignments exist in Setup Technicians.
   - Marga API `createServiceTicket` requires `callerEmail` (400 `CALLER_EMAIL_REQUIRED`); fills an empty branch email.
   - AIStaff blueprint asks/remembers `calleremail`. Marga connection renamed "Cha" → "Marga App".
   - Live Marga files only (`/srv/apps/marga-app`); `/home/mike/repos/marga-app` already differed — reconcile before commit.
     Marga notes in `/srv/apps/marga-app/HANDOFF.md`.
4. **Alert contacts** — Settings › General › Who gets alerts: Name / Email / Mobile (SMS) rows
   (`company_settings.alert_contacts`, migration `20261019233000_alert_contacts`); `notify_email` kept in sync.
   Marga: Michael Pineda · mikep@marga.biz · 09175769817. Mike also typed "Closer Mail · care@marga.biz" there —
   WRONG place (care@ is a customer inbox = planned email channel); remove it.
5. **Alert audiences** — tenant copy `[Tenant] …` from "AIStaff for Tenant"; platform copy to `ADMIN_ALERT_EMAIL`
   `[AIStaff platform] Tenant · …` from "AIStaff Platform" with a banner naming the tenant recipients.
6. **"What to do to resolve this"** box on every ACTION NEEDED / URGENT email (tenant + platform), generic by error type
   (`resolutionSteps` in `src/notify.js`). Details rows unchanged.
7. **Model switching fix** — a request for a model that is not loaded unloads the other model and loads it
   (`makeRoomForLocalModel`). Closer model currently: Winnow 12B Q8 (Mike's choice).

### Known issues / facts
- Gmail (michael.marga@gmail.com) silently throttled AIStaff mail after ~14 alerts; Hostinger addresses receive fine.
  Awaiting Mike: per-customer URGENT throttle (15 min)? System mail provider: Postmark or Amazon SES?
- South 3 (Kettle Foods) has no messenger/technician → every Kettle request is blocked (good test case for the resolve loop).
- No SMS sender yet. Phone channel = AIStaff's own VoLTE router with SIP (working for Pitch) — set up later.
- `src/` has many `*.backup-*` files from this session; clean up once stable.

### Next (agreed order, MASTERPLAN-director §9)
1. **Settings › Channels page** — checkbox cards that reveal settings. Facebook card = status + button to the EXISTING
   Facebook Page Connection tab. **Never move or change that flow (Meta App Review tests it).**
2. **Email channel** for care@marga.biz (Hostinger IMAP/SMTP; password entered by Mike in the UI, stored encrypted;
   Test connection; threaded replies as Marga; ignore auto-replies/bounces/noreply/own mail; customer status emails
   sent from the tenant inbox).
3. **Staff resolve loop** — signed buttons (Retry now / Created manually: SR / I'll handle it) + plain replies from alert
   contacts or the platform admin → Director retries → customer told on Messenger (<24 h) + email with thanks,
   apology and the reference.
4. Website chat widget into Channels. 5. Phone (VoLTE/SIP) calls + SMS.
Also pending: D4 (per-conversation turn lock, separate interpreter/communicator models), D5 flow editor + test bench.


## Session 2026-10-20 (early): Settings > Channels + email channel

Details: `CHANGELOG.md` entry 2026-10-20 00:40; plan `docs/MASTERPLAN-director.md` section 9.

### Built and live
1. **Settings > Channels** (last tab in the Settings row) — checkbox cards: Facebook Messenger (status + button to the
   existing Facebook Page Connection tab; pause and AI-replies switches only), Email, Website Chat Widget (later),
   Mobile Phone (later: own VoLTE/SIP router). Unticking pauses and keeps settings. Generic for every tenant.
2. **Email channel** — `src/email-channel.js`, tables `tenant_channels` + `email_message_log`. Hostinger preset.
   Password encrypted, never shown. Test connection required before "Turn on email replies"; changing address,
   servers or password pauses it until re-tested. Reads only NEW mail after turning on (every 60 s). Replies in the
   same thread from the tenant inbox. Ignores own/system mail, auto-replies, bounces, newsletters, bulk, spam, noreply.
3. Customer status emails now come from the tenant inbox when its email channel is on.
4. Marga: care@marga.biz removed from Who gets alerts (it would have been read as customer mail). Both sides now
   refuse to put a customer inbox in the alert list.

### Email channel status
- care@marga.biz connected and ON (Mike, 2026-10-20 00:35). First live email answered in the same thread in 11 s.
- Fix next: interpreter set `request_type` for "ink" but the Marga field is `category`, so it re-asked the type.
  Also strip "Sent from Yahoo Mail for iPhone"-style footers.

### Staff resolve loop (built 2026-10-20 00:45) — `src/resolve-loop.js`
- ACTION NEEDED / URGENT alerts carry buttons: I fixed it — try again / I created it manually / I'll handle it,
  and a code [R-xxxxxxxx]; replying to the alert email works too (support@aistaff.click is polled every minute).
- Retry saves with the collected details; on success the customer gets the reference on Messenger (<24 h) and by
  email from care@marga.biz, staff get DONE. Manual SR numbers are checked in the Marga App for that customer.
- Live check done: old Kettle request R-978aac92 retried -> still refused (South 3 has no messenger) -> new alert.

### Waiting for Mike
- Real success test: assign a messenger to South 3 in Marga (Master Schedule > Settings > Setup Technicians), then press
  "I fixed it — try again" on the newest Kettle alert (or reply "fixed, try again"). Note: this creates a REAL ticket
  for Kettle Foods and emails michael.marga@gmail.com (the caller email on that request).
- Decide: per-customer URGENT alert throttle of 15 minutes (not built yet).

### Facts
- Alert mail stays on Hostinger (support@aistaff.click via smtp.hostinger.com:465); SPF/DKIM/DMARC OK for
  aistaff.click and marga.biz. Earlier Gmail throttling was volume to one Gmail inbox, not setup.
- Migration also renamed 4 `customer_update_templates` indexes to Prisma default names (harmless).
- Tests: 3 pre-existing Brandee page test failures (not related).

### Next
Fix the email `request_type`/`category` re-ask. Then: resolve buttons inside Inquiries, staff reply to email threads from Inquiries, attachments,
   one customer profile across Messenger + email, business hours per channel, then website widget, then VoLTE.


## Session 2026-10-20 (morning): Marga area wiring + one case per need

### Marga (details in /srv/apps/marga-app/HANDOFF.md)
- Setup Client's Area edits the Customers record itself (tbl_branchinfo / tbl_billinfo); Branch Area/City cascade to
  Service/Delivery/Billing/Collection; one area rule everywhere (delivery/service area, else branch area).
- "Taguig City" removed (Set Area mapping + 2 branches renamed to Taguig). Kettle Plant + Warehouse Taguig = South 1.
- Live Marga files only; repo /home/mike/repos/marga-app still differs (reconcile before commit).

### Resolve loop proven live
- Mike fixed Kettle Warehouse area -> "Try again" -> SR-2026-000005 created (assigned South 1 messenger), reference
  emailed from care@marga.biz, DONE emails sent. Mike's Messenger case linked to the same SR and told on Messenger.

### Cases (CHANGELOG 2026-10-20 08:45, MASTERPLAN-director section 10)
- One open case per need; follow-ups = history; 15-minute alert limit per case; duplicates closed as "replaced";
  Open cases list on the workflow card. Marga: 0 open cases after cleanup.
- Not yet tested live: a NEW blocked request replacing an older open one (needs a real blocked case; e.g. a branch
  whose area has no staff). Watch the first one in the logs ([cases] ... replaced by ...).

### Next
- Email channel: interpreter `request_type` vs Marga `category` (re-asks the type); strip "Sent from Yahoo Mail" footers.
- Stale-draft sweep (unfinished drafts after 60 min) still emails without buttons; fold into cases (draft = case
  "waiting for customer") so staff are not alerted for customers who simply stopped answering.
- Resolve buttons inside Inquiries; staff reply to email threads from Inquiries; attachments; website widget; VoLTE.
- Reconcile Marga repo checkout with live files.


## Session 2026-10-20 (late morning): cases v2, Marga ticket actions, daily briefing

Details: CHANGELOG 2026-10-20 10:30; MASTERPLAN-director section 10 update.
- Cases never expire; "still needed?" fixed step before any new request; same need -> one ticket (update in Marga).
- Marga API: update / cancel / close ticket + schedule state (live files in /srv/apps/marga-app; repo still differs).
- Close Service Request now = closeServiceTicket; Escalate Service Request unmapped (was wired to create!).
- Daily briefing: Settings > General; Marga ON 16:00 Mon-Sat to mikep@marga.biz (+platform copy).
- Current Marga open cases: SR-2026-000005 (ticket_open, Kettle Warehouse 2 magenta ink, scheduled 2026-10-21 08:00, Armond).
- Simulation helper (not in repo): /home/mike/tmp/sim-open-case.js "[...turns]" — fake open case, cleans up.

### Next
- Watch the first real "still needed?" conversation and the first 4 PM report (Tue 2026-10-20 16:00).
- Email channel request_type/category re-ask; strip mail-app footers; stale-draft sweep alerts.
- Briefing view in AIStaff; SMS via VoLTE; reconcile Marga repo with live files.

- 10:45: open-request answers 1 keep / 2 received-done (closed, counts as cost) / 3 cancel; partial serial narrowing
  without listing other companies. Planned: cost-per-client report (MASTERPLAN-director section 10).

## Session 2026-10-20 (noon): scheduling cut-off + SR search
- Scheduling cut-off built (see CHANGELOG 12:00 and MASTERPLAN-director §11). Marga enabled: 4 PM, Mon-Sat, ink/toner/cartridge/parts +1 prep day after the cut-off. Live dry run proved Marga receives scheduledDate (forced 2026-10-22 -> scheduledFor 2026-10-22 08:00).
- Marga API (marga-app scripts/lib/marga-business-api.mjs): createServiceTicket accepts optional scheduledDate (today..+60 days); default still tomorrow. resolveAssignment balances load on that date.
- Master Schedule: SR numbers are now in the search index (portal_ticket_no) in both the server snapshot builder (/srv/marga-platform/scripts/lib/master-schedule-snapshot.mjs) and the page (master-schedule.js v=20261020-srsearch, SW v260). Oct 21 snapshot rebuilt.
- Found: the Margabase snapshot auto-rebuild worker is paused (MASTER_SCHEDULE_AUTO_REBUILD_ENABLED not set); 95 dates are queued. Snapshots for hot dates still rebuild on read / Rescan Cache. Not changed.
- Next: watch Mike's test message; first 4 PM briefing today.

- 12:30: cut-off moved to Business Engines > Customer Service; customers get no dates/times/promises (tell_customer_schedule off). Marga check: SR-2026-000005 is on Armond (#9000, the active login; #265 "Armon" is an old inactive duplicate) for Oct 21 under "Ready NO".
- 12:10: Marga Master Schedule got a Cancel button (office cancel = iscancel=1, same as cancelServiceTicket). AIStaff picks the cancelled state up on the next follow-up / 4 PM briefing.

## 2026-10-20 12:30 — One-button resolve emails + progressive disclosure
- ACTION NEEDED / URGENT emails: only "I fixed it — try again" (Step 1 fix this first, Step 2 click). Removed "I created it manually" / "I'll handle it" from emails, the resolve page and the 4 PM briefing (backend actions kept so old links still work). Footer asks staff not to create it manually.
- Business Engines > Workflows cards: steps folded under "How it works (N steps · show)"; setup notes folded to one line; open cases only shown when customers are waiting ("Customers waiting"); case buttons "I fixed it — try again" / "Not needed — close".
- Customer Service > Scheduling cut-off folded to a one-line summary.

## 2026-10-20 12:45 — Reply style per channel (Formal / Casual)
- Settings > Channels: each card has "Reply style" (Formal / Casual), stored in tenant_channels.config.reply_style; changing it never pauses a channel. Defaults: Email = Formal, Messenger / Website chat / Mobile = Casual.
- src/reply-style.js: styleFor(companyId, channel), rules(style, channel), emailHtml(text).
- Director communicator (director.js communicatorPrompt) and the main Closer prompt (ai.js) follow the style. Formal: greeting line, short paragraphs, numbered lists (choices as an indented sub-list), closing line, no emojis / po-opo, no sign-off (the signature is added by the email sender). Casual: 1-3 short chat sentences (unchanged).
- Email channel: formal replies are sent as rich HTML (paragraphs, ordered / bullet lists, one nested level, **bold**) + the plain-text version; casual = plain text.
- Live model test (Marga, local model): formal email reply came out as "Dear Ma'am Ana, ... 1. serial 2. condition (1-4) 3. type ... Thank you, and we look forward to your reply."; Messenger stayed casual.
- Tests: test/reply-style.test.js (2).

## 2026-10-20 13:00 — Saved contacts with permission (all channels + Pitch); email asks everything at once
- Mike: ask once whether we may save the customer's official name, contact, email, company/branch/department and machine, so next time they are not asked again. All channels, including Pitch phone calls (caller ID -> greet by name).
- NEW table contact_profiles (migration 20261020130000_contact_profiles) + src/contacts.js: phoneKey (PH numbers -> 639...), syncFromConversation, setConsent, forget, findByPhone, saveCaller, callerPromptSection.
- Consent lives in conversation.customer_profile.consent ("yes" / "no" / not asked). Asked ONCE together with the confirmation summary (no extra message). "yes" -> saved to contact_profiles and reused; "no" -> details used for this request only, then dropped (rememberCustomerAndReset). Not asked yet (older chats) -> still reused, and asked with the next request.
- Director interpreter: new commands consent yes/no and forget_me ("delete my details" -> wiped, customer told). Live model test: "Yes, correct. And yes you may save my details." -> confirm yes + consent yes; "Please delete my saved details" -> forget_me.
- Email: Director asks for ALL missing items in one message (no 3-item cap) with a one-time-setup / thank-you-for-your-patience line (only when the customer is not saved yet). Messenger / chat keep a few at a time.
- Confirmation summary is now printed by code ("Request details:" list, exact values); in formal emails it goes before the closing line. Follow-up nextStep says "Reply to this email" on email.
- Pitch: per call, prompt.js appends "## Who is calling" from contact_profiles (saved: greet by name, company, branch/department, machines; not saved: ask once and call save_caller_details; declined: never ask again). tools.js: new save_caller_details tool (always available; send_sms only when SMS is on). Test number saved/greeted/removed OK.
- Tests: test/contacts.test.js (2). Full suite 512 pass / 4 old fails.

## 2026-10-20 13:10 — Saving is automatic (no permission question)
- Mike: enforce saving on every channel, like a browser cache but in our database. Removed the yes/no permission question from the confirmation and the "forget my details" mention. When asking for details the first time, Closer says they are needed only once so we can address the customer properly and make future requests faster (email: everything in one message).
- contacts.syncFromConversation / rememberCustomerAndReset now save unless consent is "no" (only set if a customer asks to delete their details — forget_me still works, it is just not advertised).
- Pitch: unknown caller -> ask name, company, branch/department, say it is needed once, then save_caller_details (no permission question; consent=false only if they ask to delete).
- Backfill: 2 existing conversations with a remembered name copied into contact_profiles.
- 13:15: wording "future inquiries and requests"; Pitch asks name / company / branch one at a time, naturally inside the conversation (never back to back or as a list), mentions once that it is only needed the first time.

## 2026-10-20 13:25 — Channel instructions + combined read-only view + Settings > General folded
- Settings > Channels: each card has "Channel instructions" (folded; tenant_channels.config.instructions, max 2,000 chars; saving never pauses a channel). Used by the main Closer prompt (ai.js) and the Director communicator, AFTER the company (Closer) instructions and the Business Engine instructions (reply-style.js channelSettings / instructionLine).
- Settings > General > "What your Closer knows and does" now lists ALL instructions Closer combines, read-only, in order: 1 Closer instructions (every channel), 2 each active Business Engine (custom or platform default), 3 Customer Service scheduling rule, 4 each channel with its reply style and instructions — each with a "change" link to where it is edited. API: /api/prompts/closer/preview returns layers (server.js closerInstructionLayers).
- Settings > General: Company profile, AI and quotation settings, Daily briefing report (summary "On · 16:00 · 6 days a week"), What your Closer knows and does, and Closer instructions are folded (click to open). Facebook Pages stays open.

## 2026-10-20 14:10 — Collections: required billing contact (name, mobile, email) + owner alert on exceptions
- Mike: collectors must get the customer's contact name, mobile number and email; follow-ups are locked until they do. If the customer will not give a mobile / email, the follow-up can still be saved but the owner/admin is alerted and an admin approves the exception.
- collections.js (v=20261020-billingcontact, SW bumped): "Billing contact (required)" box in the Contacts panel of the collection window (renderCollectorBillingContactBox). Saved on tbl_billinfo (doc id = branch id): acct_contact, acct_mobile (09XXXXXXXXX), acct_email + billing_contact_updated_at/by; every change logged in marga_customer_change_log (source collections_billing_contact).
- Exception: tick "Customer will not give a mobile number / email" + reason -> tbl_billinfo.contact_exception_status = pending (+ reason, missing, by, at). Admins (MargaAuth.isAdmin) see "Approve exception" -> approved. Filling in valid details later -> resolved.
- Lock: saveCollectorFollowup validates/saves the billing contact first; saveCollectionConversation (invoice detail window) checks the record (collectionDetailBillingGate). Blocks unless complete or exception pending/approved.
- Alert path: browser -> POST /api/collections/contact-exception (scripts/local-margabase-proxy.mjs, 60/h) -> AIStaff POST /api/hooks/tenant-alert with AISTAFF_ALERT_KEY (in /srv/marga-platform/apps/margabase/.env) -> email to Marga alert contacts + platform admin. Tested: TEST alert delivered to mikep@marga.biz and mpineda@aistaff.click.
- Data today: 3,592 billing records; 6 with an accounting email, ~40 with a mobile-looking number.
- Note: acct_mobile is a NEW field; the Customers module shows acct_email but not acct_mobile yet.
- AIStaff side: src/routes/tenant-hooks.js, scripts/tenant-alert-key.js, company_settings.alert_hook_key_hash (migration 20261020140000_tenant_alert_hook).

## 2026-10-20 16:40 — Website Chat Widget channel (all tenants) — live on marga.biz
- src/routes/widget.js: GET /embed/closer-widget.js (src/widget/closer-widget.js, shadow-DOM bubble, CORP cross-origin), GET /api/public/widget/:key/config, POST/GET /api/public/widget/:key/messages. Key = tenant_channels(website_chat).config.public_key; only config.allowed_origins may call (others 403). One conversation per visitor (channel website_chat), lead source_channel website_chat, staff replies (sender_type admin) shown via polling (8 s open, 60 s closed). Rate limits 30/10 min per IP, 20 per visitor.
- Settings > Channels: Website Chat card is live (allowed websites, greeting, colour, embed code, AI replies, reply style + channel instructions). Mobile Phone stays "later".
- Marga: allowed https://marga.biz + https://www.marga.biz, colour #0b57c6, Casual style. Live API test: Taglish rental question answered (~40 s on the local model).

## 2026-10-20 17:05 — OUTAGE FIX: IPv6 broken on the Ryzen -> Messenger and Marga lookups failed
- From ~16:45 the Ryzen had an IPv6 route (router advertisement on wlp3s0) but no working IPv6 internet. curl falls back to IPv4; Node 18 fetch does not (UND_ERR_CONNECT_TIMEOUT). Result: Messenger replies could not be sent to graph.facebook.com and every Marga API call (app.marga.biz) failed -> "serial not found".
- Fix: src/server.js and src/pitch/index.js start with require("dns").setDefaultResultOrder("ipv4first"). Verified Marga API + Facebook reachable; serial E66868B1J659094 found (Ferrer Studio, contract 4482), case-insensitive.
- Missed Messenger customer (Analee Rodavia Edaño, Suhay, ink order) answered manually after the fix. No other unanswered conversation in the last 24 h.
- src/ai.js: salvageModelJson() repairs small JSON mistakes from the local model (e.g. "]" instead of "}") or rescues the reply text; the error log now shows the start and end of what the model returned.
- Website widget: no more doubled visitor messages (polling echo matched to the locally shown message); "Checking… this can take up to a minute" while waiting.
- TODO: other Node services on the Ryzen that call the internet may need the same ipv4first setting; or disable the broken IPv6 on the router / host.
- 17:25: director cleanIdentifier(): serial typed with labels / edge punctuation ("SN#- E80729A3H154007-") is cleaned before the lookup, with a letters-and-digits-only retry. E80729A3H154007 = Suhay OPC. Open item: when the customer answers with a company name instead of a serial, the interpreter put "SUHAY OPC" into branchid (a number field); company-name search is not wired into identify yet.

## 2026-10-20 17:45 — Director finds the machine in code: serial cleanup, company-name search, no "can't find" loops
- Mike: take the company name (unless it is a person's name) and never just say "can't find"; the Director code must find serials and strip extra characters.
- director.js identification (code): serial from the interpreter AND from the raw message (letters+digits, 8-24 long, not emails), cleaned by cleanIdentifier (labels "SN#", "S/N:", "Serial Number:", edge punctuation) -> exact -> letters/digits only -> last 6 characters (single match only).
- Company / branch name: new interpreter command {"type":"company"} (never a person; never put into an id field). A name typed into customerid/branchid/machineid is treated as a company search. by_name config (workflow_config.director.identify.by_name -> customer_service.find_customer + list_customer_machines): one company -> its machines as a numbered list (model, serial ending XXXX, branch; delivered first) -> customer answers 1..n; several companies -> choose the company first. A bare "1"/"2." answering a list is always a choice (code). A draft is kept while a list is shown so the list survives to the next message.
- Nothing found: first time "we can look it up by company instead" (ask company + branch); second time -> needsHuman with a handoff reason (team identifies the machine) and the customer is told the team will continue. state.identify_fails persisted on the draft.
- Live tests via the website widget (test conversations deleted): "sa Suhay OPC po ito ... black ink" -> 6 machines listed -> "1" -> DCP-T820DW (4007) identified; "SN#- E80729A3H154007- need ink po" -> identified directly; unknown serial -> asked for company name. Tests 512 pass / 4 old fails.
- Privacy note: the company-name list shows model + last 4 digits of the serial + branch name of that company's machines.

## 2026-10-20 18:15 — Typo-tolerant identification for ANY business (serials, models, plan ids, control / room / account numbers)
- Mike: the Director must not give up — filter in code, find the closest record to a typo, ask the customer's name, contact, company and department, then confirm the closest match. Applicable to all kinds of business.
- NEW src/fuzzy-match.js: cleanIdentifier (generic labels: SN, S/N, serial no, model, control no, ref no, room, unit, plan id, account no, contract no, id, #, plus per-business identify.labels), matchKey (look-alikes 0=O=Q=D, 1=I=L, 5=S, 8=B, 2=Z, 6=G), editDistance (insert / delete / replace / swap), closest (tolerance by length: <6 exact, 6-8 one edit, 9-13 two, 14+ three), contextScore (customer's words vs the record's company / branch / name, one-letter tolerance).
- director.js identify steps (all code): exact -> cleaned / letters+digits only -> last 6 characters (single match) -> CLOSE MATCHES (never revealed) -> ask identify.confirm.ask + name + contact -> pick the close match whose identify.confirm.match fields fit -> "Is this your record?" (yes/no, read by code too) -> if the company does not fit any close match: company search (by_name) -> machines list -> otherwise ask company once -> staff. State fuzzy / pending_pick persisted on the draft.
- Generic config (workflow_config.director.identify): name, labels, pattern (regex for identifiers in the raw message, e.g. "^\\d{3,4}$" for room numbers), min_length, tail_search, fuzzy.param (the business system searches typos) OR fuzzy.index { operation, list, field } (AIStaff compares against a list), confirm { ask, match[] }, by_name { ... }.
- Marga: findMachineBySerial accepts fuzzy=true (scripts/lib/marga-business-api.mjs: closestSerials over the active customer graph, cached 5 min, returns distance); action input_schema + query mapping updated; identify = serial number, fuzzy.param, confirm on customerName + branchName.
- Live test (deleted after): "serial E80729A3H15407" (one digit missing) -> asked name/contact/company -> "Suhay OPC po, ako si Ana 0917..." -> "closest record ... DCP-T820DW — E80729A3H154007, ito po ba?" -> "oo" -> identified, continued. Tests: test/fuzzy-match.test.js (3).


## 2026-10-20 — Exact supply items (quantity + colour) for ink / toner / cartridge

- Mike: "we need to be precise because we don't have a human who will check this" — e.g. "3, yellow, ink".
- `src/supply-items.js` (new, code not AI): parses the customer's words into `[{item, quantity, unit}]`.
  Colours in English/Tagalog/short forms (black/itim/bk, cyan/blue/asul, magenta/pula, yellow/dilaw),
  number words (isa…sampu, one…ten), "tig-isa / each" (CMY or named colours), "set / full set" (unit set).
  Serials, phone numbers and years are never quantities. Ink without colour -> asks colour; colours without
  quantity -> asks how many; never guesses. Test: `test/supply-items.test.js`.
- Director (`src/director.js`): items step from `workflow_config.director.items`
  `{ field, when:{field,values}, category_map }`. Runs before the blueprint call; parses this message, then
  recent customer messages of the request; a new statement replaces the items. Missing items are asked
  together with the other missing details (email: all at once), and block the confirmation summary
  (task `ask_items`). `releaseitems` is never shown to / set by the interpreter model.
- Confirmation summary now readable: `director.summary { labels, hide }` — "Machine:" line, labels instead of
  field names, value labels instead of `{"value":3,...}`, items as sub-lines ("3 pc Yellow Ink"),
  internal ids and the schedule date hidden.
- Adding to an open request now carries the exact items (`additionText` in business-engines.js).
- Marga action createServiceTicket: input `releaseitems` (array) -> body `releaseItems`.
  Marga Business API requires it for ink/toner/cartridge (400 RELEASE_ITEMS_REQUIRED), writes
  `release_request_*` on the schedule and the DR Item List rows (`tbl_newfordr`) exactly like the
  New Service Request form. Colour is part of the item name (no separate colour field in the form).
- Verified: widget test "need ink for <serial>" -> asked qty/colour; "3, yellow, ink" -> draft
  `releaseitems=[{Toner / Ink, Yellow Ink, 3, pc}]`; Marga dry-run -> `releaseItems: "3 pc Yellow Ink"`,
  messenger assigned; without items -> 400. Test data deleted (backup in ~/backups).
- Found: Suhay OPC branch (legacy 3490) has no delivery/branch area -> AREA_NOT_SET; its ink requests wait for staff.

## 2026-10-20 — Request Origin matches the real channel
- Was: requestorigin was hidden (server-owned) so it was dropped; the Marga API defaulted every AIStaff ticket to facebook_messenger (website chat and email too).
- Now: workflow_config.director.origin {field: requestorigin, map: channel -> origin, default: other}; set by code, never by the model. Dry-run confirmed requestOrigin=website_chat.
- Marga New Service Request form: added Facebook Messenger and Email to the Request Origin list (service-worker v263-origin).
- Field check vs form: Field Machine Status = asked; Task Sched/Time = cut-off rule (never told to customer); Super Urgent = Down / No Print; Remarks/Trouble = items + customer words; Release Request category auto (ink/toner -> Toner / Ink, cartridge -> Cartridge), Item Rstd = colour + item, Qty, PC/Set; DR Item List rows same shape. With Request = always 1, With Complain = always 0 (open question for Mike).


## 2026-10-20 — Complaints, completion check, after-service survey (Mike)

**Request Origin / With Complain (form fields)**
- Marga API: requestOrigin enum now facebook_messenger, viber, call, website_chat, email, tech_request, other (AIStaff action enum too — "email" was being rejected). `withComplain` on createServiceTicket (ticks withcomplain=1) and on updateServiceTicket (addition optional when withComplain=true; patches withcomplain=1, ticket event "Marked With Complain").
- AIStaff: `director.code_fields: ["withcomplain"]` (never set by the model).

**Complaint detection** (src/director.js handleFollowup)
- Every follow-up on an open case is now counted (before: only unresolved ones).
- Complaint = 3+ follow-ups on the same open need, or the interpreter tags the words as a complaint.
- First time: ticket open -> update_service_details withComplain=true; no ticket yet -> requested_arguments.withcomplain=true (ticket created with it when staff fix + retry). Case history "COMPLAINT".
- Staff email: new notify.notifyComplaint ("COMPLAINT: <name> — <ref> (n follow-ups)", call the customer today). Waiting cases: the URGENT alert subject gets "COMPLAINT · ". Complaint about a job DONE in the system -> COMPLAINT alert "done but the customer says it is not OK".
- Fixed: a complaint about a ticket WITH a reference no longer sends the "still has no reference number" alert.

**Completion check + survey** (new src/feedback.js, src/routes/feedback.js, public/feedback-settings.js; migration 20261020200000_customer_feedback: table customer_feedback + tenant_engines.feedback_rules)
- Sweep every 5 min (server.js): open AIStaff tickets -> get_service_status -> done => case done + "Was it done?" email right away (from the tenant inbox). Cases closed done elsewhere also get it. Only jobs finished in the last 3 days and after 2026-10-20 19:30 PH.
- Email: Yes / No buttons -> https://aistaff.click/feedback/<token> (token hashed in DB). Nothing is saved until Submit (email link scanners).
- No -> "What is still wrong?" -> NOT DONE alert to the tenant + platform, case history complaint.
- Yes -> survey of the topics DUE for this customer: field staff (named, e.g. "Carlos E., our delivery staff"), customer service staff, AI assistant, overall service; 1–5 stars + comment. Frequency per topic: Off / Every job / Once a month / Every 3 months / Every 6 months (counted from the customer's last answer). Ratings <= low_rating (default 2) alert the team.
- Settings: Business Engines > Customer Service > "After-service follow-up" (folded): completion check on/off, survey frequencies, alert threshold, Results (30 days: sent / answered / not done, average stars per topic, latest answers). API GET/PUT /api/engine-feedback/customer_service.
- Daily briefing: new section "Customer feedback after finished jobs" (not-done first).
- Defaults: completion check ON; field staff every job, customer service monthly, AI monthly, overall every 3 months.
- Tested: dry-run origin=email + withComplain=true OK; page questions + submit saved; frequency (same customer next job: field staff only); summary; real completion email to michael.marga@gmail.com (TEST-FB-B).

## 2026-10-20 20:05 — Survey frequency counted in JOBS (Mike: not months, less annoying)
- Choices: Off / Every job / Every 2 / 3 / 5 / 10 jobs. Counted from the last job where the customer was ASKED that topic (customer_feedback.topics); never asked = due. Old monthly/quarterly/semiannual map to every 3 / 5 / 10 jobs.
- Defaults: field staff every 2 jobs, customer service every 3, AI every 3, overall every 5.
- Simulated 6 jobs: 1 all four; 2 none; 3 field staff; 4 customer service + AI; 5 field staff; 6 overall. The completion check (was it done?) is still sent after EVERY job.

## 2026-10-20 20:40 — Live progress steps, IPv4 mail, no false "couldn't save"
- Incident (Jevy, website chat): SR-2026-000007 WAS created 19:49:29; staff email reached mikep@marga.biz 19:51:31 (2 min late); my 19:51:48 restart cut the reply; reply-recovery replayed "yes" -> confirmation already used -> wrongly answered "couldn't save".
- Fix 1 (business-engines commit): confirmation_not_valid but the execution already succeeded -> recover (save row, case ticket_open + reference, remember customer) and answer as submitted. Request saved in AIStaff BEFORE the staff email; staff email no longer blocks the customer reply.
- Fix 2 (src/mail-ipv4.js, required by notify, email-channel, password-reset, quotation-email, server): nodemailer chose a RANDOM IPv4/IPv6 address; IPv6 broken on the Ryzen -> ~50% of emails hung ~135 s. Now IPv4 only (verify 1.5 s).
- Fix 3 (src/progress.js + widget): website chat shows live steps instead of a static note: Reading your message / Looking up your machine in our records / Checking your request details / Saving your request in our system / Saved, getting your reference number / Checking the status of your request / Writing your reply; after 20 s with no step: Still working on it. GET /api/public/widget/:key/progress (memory only). Messenger already shows typing (refreshed every 18 s); email cannot show progress.

## 2026-10-20 21:00 — Department is always asked (Mike: force it)
- AIStaff createServiceTicket: new REQUIRED field callerdepartment -> body callerDepartment. workflow_config: step after callername, remember (asked once per customer, reused), ask_customer (never filled by the model from the branch/machine name), field note, summary label Department. contacts.js: saved contact department = known.callerdepartment (Pitch greets with it).
- Marga API: callerDepartment (optional, <=80). Schedule caller = "Name (Department)" + caller_department; branch contact gets department; facts.callerDepartment.
- Live test: first reply asked name + department + machine condition; summary showed Department: Accounting; dry-run callerDepartment=Accounting. Test chat deleted.

## 2026-10-20 21:30 — Company name -> ask the branch / department first (Mike)
- Reverted the separate callerdepartment question: the department IS the Marga branch. Serial given -> branch known, nothing asked. (Marga API keeps optional callerDepartment, unused.)
- Company name given and several branches with machines: ASK which branch / department and where (no list). New src/branch-match.js matches the answer in code: only distinguishing words count (company words, its initials e.g. CBS, and words in >60% of names are ignored, also in what the customer typed); short forms (acctg, hr, admin, bldg, flr...) and typos; joined words (backup = Back Up); "main" / "Ferrer Studio lang po" = the plain main branch (not on the first message).
- 1 match -> its machine (1 machine = CONFIRMED yes/no, never silent; several = numbered machines of that branch only). 2-5 matches -> show those. More -> ask the location and narrow within them. After 2 unclear answers -> the 5 closest only. No to the shown machine -> ask the branch again. A serial at any point wins. Branch named instead of numbered from a short list is accepted.
- Director state: branch_list, branch_ask, branch_company (persisted on the draft).
- Interpreter robustness: the local model sometimes returns lazy commands (["start_flow","company","set"]) -> asked once more strictly (logged "interpreter answer unusable"). Logged "[director] not a request".
- Real data check: China Bank Savings 489 branches: accounting/acctg -> 2, hr -> 2, tagaytay / CBS tagaytay / china bank savings tagaytay -> 2, makati -> 3, san fernando -> 5, cebu/asset -> ask location. Live widget: Ferrer Studio -> asked branch; "sa additional po" / "sa back up po" -> confirm machine; "hindi" -> asked again; "yung main po" -> 2 machines listed; 2 unclear answers -> 3-branch list. Tests 524 pass / 4 old.

## 2026-10-20 23:25 — Company correction, list answers, machine line
- Mike test (wiped): "ferrer" -> chose 2 (C.A Ferrer) -> "Wait its ferrer studio" was ignored. Fixed: a different company named after one was chosen / listed / waiting for yes-no / branch question -> forget the old match (state + id fields on the draft) and identify again. Company also read from the words in code ("my company is X", "company name: X", "wait its X", "ay sa X pala") because the model sometimes tags it update_previous.
- A bare "2" answering a numbered list is never an item quantity (was read as "2 inks").
- confirm_machine / confirm_close_match: "Machine: <company/branch — model — serial>" printed by code when the model leaves it out.
- Replay: ferrer -> 3 companies; 2 -> confirm C.A Ferrer machine shown; "Wait its ferrer studio" -> asked branch (no list). Tests 524 / 4 old.

## 2026-10-20 23:45 — AIStaff tickets visible in Master Schedule + SR status search
- Cause: Master Schedule reads app_meta.master_schedule_snapshot per day; the rebuild queue (master_schedule_snapshot_rebuild_queue) is filled by the trigger but its worker is paused (attempt_count 0), so SR-2026-000008 (Oct 22) was invisible. Oct 22 rebuilt by hand -> SR-8 shown.
- Marga API: refreshMasterSchedule() after commit of create (day + next day), update (day + next), cancel/close (day + next + today + tomorrow): POST 127.0.0.1:8787/admin/master-schedule-snapshot?date=… (fire-and-forget, warns on failure).
- Master Schedule page (v=20261020-srstatus, SW v264): typing an SR number from ANY date shows a status line: OPEN / OPEN overdue / DONE <when> / CANCELLED · scheduled <day time> · moved from <original> · purpose · items READY (released) or NOT yet released (n pending); opens its day (status All for done/cancelled); if the row is missing from a stale snapshot, rebuilds that day once and reloads.
- Director: the customer's word for the items sets the type ("2 black toners" after "I need ink" -> category toner, item Black Toner).

## 2026-10-21 14:50 — OGP (Colliers) email thread review fixes
- Case R-080d8c05 (Shirlyn Lecaros, One Global Place, Daiichi machine E78947G3H927850) blocked since 2026-10-20 11:34: "No active technician is assigned to area South 3". Areas with NO active technician: pasig, pms 1, pms 2, rizal 1, rizal 2, south 2, south 3 (Master Schedule > Settings > Setup Technicians). Needs staff.
- cases.openCasesForConversation: also cases this conversation was merged into + the same customer's open cases on other channels (calleremail / last 10 phone digits; email channel uses the sender address). Her 2026-10-21 14:05 email follow-up had found nothing -> generic AI.
- ai.js platform rule: never say forwarded / escalated / assigned / updated / scheduled / team reviewing unless a tool result this turn shows it (the generic reply invented "forwarded to our technical team").
- business-engines: name / phone / email the customer WROTE (e.g. email signature) are accepted without asking again (was: "Details was already provided earlier").
- Same caller + same machine + same kind -> added to the open request automatically and told (no "add or new?" question). merge_into.same_caller; added_to_open_request prints the reference when there is one.
- reply-style formal: closing line asks for a reply only when something was asked.
