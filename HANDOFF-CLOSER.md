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
