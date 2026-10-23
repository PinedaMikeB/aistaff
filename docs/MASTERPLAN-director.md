# MASTERPLAN — Closer Director (code-controlled workflows)

Owner: Mike Pineda. Started 2026-10-19. Repo: `/srv/apps/aistaff` on Ryzen.
Builds on `docs/MASTERPLAN-integration-blueprints.md` (blueprints, safe writes, memory).

## 1. Why

Tests on 2026-10-15…19 showed the weak point is letting the AI decide *when* to look
things up and *when* to submit. Small/fast local models (Gemma 4 12B, Winnow 12B,
Qwen3 8B) chat naturally but skip tool calls, guess fields or claim actions; the
27B dense is reliable but ~1–2 min per reply because it writes many tool rounds.

Principle (same as Rasa CALM, the closest proven open-source design):
**the AI understands and speaks; AIStaff code decides and acts.**

## 2. Architecture

```
Customer message
  → Interpreter (AI, JSON only): commands, not free text
      start_flow · set_field · correct_field · confirm(yes/no) · cancel ·
      question · smalltalk · handoff
  → Director (code): per-conversation state machine
      COLLECTING → CHECKING → AWAITING_CONFIRMATION → SUBMITTING → DONE / BLOCKED / FAILED
      - runs identification lookups itself (serial → machine; company → branch → machine)
      - merges fields with provenance: said (customer) / understood (AI) / verified (lookup)
      - decides what is missing, what to ask next, when to dry-run and submit
      - reuses the blueprint engine: must-ask, derived fields, dry run, confirmation,
        idempotency, customer scope, staff alerts, memory reset
  → Communicator (AI): writes the reply from a code task
      ask_missing · confirm_identity · show_summary · submitted · blocked · error · answer_question
  → Response guard (code): attaches critical values itself (reference number line),
      blocks invented references/actions
```

Questions outside a flow (prices, coverage, sales) keep using the normal Closer path
with the knowledge base. A flow can be paused for a question and resumed (Rasa
"digression"/"repair" pattern). Corrections ("ay 3 pala") update the field and
re-check what depends on it.

## 3. Copy from proven systems

| Source | What we copy | What we skip |
|---|---|---|
| Rasa CALM | flows + slots, LLM outputs commands, conversation repair (correction, digression, cancel, clarify, handoff) | the platform/code itself |
| XState | explicit states, allowed transitions, guards | the library for now (our flows are tenant data in Postgres) |
| Zod + llama.cpp JSON schema | validated, grammar-forced interpreter output | — |
| Temporal | durable state/retries idea (we use Postgres + the 15-min sweeper) | the server, until long approval chains need it |

## 4. Configuration (per tenant, per engine job) — no tenant-specific code

A flow = engine operation + mapped API action + blueprint + `director` block:
- **trigger**: plain description of when the flow applies (used by the interpreter)
- **identify**: how to find the record (e.g. serial → `find_machine`; or company →
  `find_customer` → branch choice → `list_customer_machines` → machine choice)
- **fields**: from the API action (labels, must-ask, remember, derived) — already in blueprints
- **confirm**: customer confirms a summary before submit (default for writes)
- **outcome**: reference from API response; blocked → staff alert + tell customer; reset memory

## 5. Panel (for non-technical owners)

Settings › Business Engines › **Workflows**: each flow drawn as numbered steps in plain
words ("1. Find the machine — ask for the serial number, or the company and branch"),
who gets alerted when it is blocked, on/off switch, health warnings (e.g. no staff for an
area), and later a test bench and a form editor replacing the blueprint JSON.
AI Studio gets **Director models**: interpreter and communicator can be different models.

## 6. Scale (100+ tenants)

- One shared Director engine; all per-tenant behaviour is data (flows, blueprints, instructions).
- Per-conversation serialisation (one turn at a time per conversation) to avoid double submits;
  idempotency keys on every write (already).
- Small prompts per call (~1–3K tokens) so local models serve many conversations; cloud
  model fallback when the local queue is long.
- Every turn logged: commands, state transition, API calls, reply — for audit and the test bench.

## 7. Phases

| # | Work | Status |
|---|---|---|
| D1 | Director core: interpreter commands, controller (reuses blueprint engine), communicator tasks, code-attached reference | done 2026-10-19 |
| D2 | Marga service/ink flow on the Director; simulations with Winnow (identify, choices, correction, remembered customer, blocked) | done 2026-10-19 (success path needs South 3 staff) |
| D3 | Workflows panel (plain-language view, on/off, warnings) | done 2026-10-19 |
| D4 | Director models in AI Studio; per-conversation turn lock; turn log | pending |
| D5 | Flow editor + test bench replacing blueprint JSON | pending |
| D6 | More engines: bookings, order status, lead capture; tenants without API (AIStaff record + own references) | pending |
| D7 | Onboarding skill (draft flows from OpenAPI/business description) | pending |

## 8. Customer contact & status updates (decided 2026-10-19, not built yet)

Problem seen live: a request was blocked, the customer was told "tatawagan po kayo", nobody called, and the
customer's follow-ups got repeated apologies. Only the admin was emailed.

Rules:
1. **Email is required for every tenant's request flows.** The Director asks for the customer's email
   before a ticket is produced. Stored in the tenant's own system when its API has an email field
   (mapped like any other field); otherwise AIStaff keeps it on the customer profile.
2. **Email already on record:** the Director re-confirms it once a month — a yes/no question showing the
   email; "no" → ask for the new one. (Tracked by a confirmed-at date per customer.)
3. **Every unresolved outcome is reported immediately, to both sides:**
   blocked / error / failed lookup, *and* a customer follow-up or clarification that still ends unresolved →
   - admin/staff alert at once (notify email + admin copy), with the full request and the customer's words;
   - customer status message at once.
4. **Customer status channels (all that apply):**
   - **Email** — always (required field).
   - **SMS** — when the tenant has Pitch connected.
   - **Messenger** — only inside Meta's 24-hour window after the customer's last message.
5. Customer wording never exposes internal states (no "blocked", "409", "failed"); it says what happens
   next and that no reference number exists yet. No promise of a call unless a person is actually assigned.

Phase: **D2b** — required-email field in the Director + monthly re-confirm; unified customer-status notifier
(email / SMS via Pitch / Messenger 24h) used by every unresolved outcome and follow-up; panel shows these steps.

## 9. Channels page + email channel + staff resolve loop (planned 2026-10-19; steps 1-3 built 2026-10-20)

### Email roles (do not mix)
1. Tenant alert contacts (staff who fix problems) — Settings > General > Who gets alerts. Never a customer-service inbox.
2. Platform admin — ADMIN_ALERT_EMAIL (platform copy of every tenant problem).
3. AIStaff system sender — support@aistaff.click (later a transactional service).
4. Tenant customer-service inbox — e.g. care@marga.biz — an EMAIL CHANNEL: Closer reads and replies as the tenant.
5. Customer's own email — status updates/reference numbers, sent FROM the tenant inbox (4).

### Settings > Channels (new page)
Checkbox cards; ticking reveals the channel's settings; state Off / Needs setup / Connected / Problem.
- **Facebook Messenger — DO NOT MOVE OR CHANGE the existing Facebook Page Connection tab, flow or buttons.**
  Meta App Review knows and tests that exact flow. The Channels card only shows status (connected Page)
  and a button that opens the existing Settings > Facebook Page Connection tab.
- **Email** — address, sender name, provider (Hostinger/other IMAP+SMTP now; Google/Microsoft OAuth later),
  servers, password (encrypted, never shown again), signature, Test connection (required before enabling).
- **Website Chat Widget** — allowed sites, greeting, color, embed code, offline email capture.
- **Mobile Phone** — SMS (number, provider, status updates by SMS) and Voice via Pitch (open question).
Common per channel: AI replies on/off, business hours, language. Unticking pauses and keeps settings.
Health checks per channel -> tenant + platform alert with the resolve box.

### Behaviour
One Director for every channel; one customer profile across channels; status updates to every channel the
customer used, within each channel's rules (Messenger 24 h). Email channel protections: ignore auto-replies,
bounces, newsletters, noreply, own messages (no loops); rate limits; attachments; staff takeover in Inquiries.

### Staff resolve loop
Alert emails get signed one-request buttons (Retry now / Created manually: enter SR / I'll handle it) and accept
plain replies from alert contacts or the platform admin only. Retry re-runs the check + save with the collected
details; manual SR is verified in the tenant system for that customer; success -> customer told on Messenger
(<24 h) + email from the tenant inbox (+SMS later) with thanks, apology for the delay and the reference;
staff get a Done reply; still failing -> new resolve steps.

### Build order
1. Channels page (Facebook card = status + link to the existing tab, untouched).
2. Email channel live (care@marga.biz).
3. Staff resolve loop.
4. Website chat widget into Channels.
5. SMS (provider to choose) and Pitch voice link.

Decided 2026-10-20: Mobile Phone = AIStaff's own VoLTE router with SIP (already working for Pitch).
The card is shown now as "set up later"; calls and SMS through that router are wired in a later phase
(no third-party SMS provider). care@marga.biz: marga.biz mail is on Hostinger (MX mx1/mx2.hostinger.com).

### Built 2026-10-20 (steps 1-2)
- **Channels page**: Settings > Channels (last tab). Data in `tenant_channels`; API `src/routes/channels.js`; UI
  `public/channels-settings.js`. Facebook card only links to the untouched Facebook Page Connection tab; its pause /
  AI-replies switches are read by the Messenger webhook. Website widget + Mobile Phone shown as "Set up later".
- **Email channel**: `src/email-channel.js`. IMAP poll every 60 s (only mail after turning on), one conversation per
  customer address, same Closer/Director, replies threaded from the tenant inbox (+ copy in Sent), loop filters and
  6 replies/address/hour limit, problem alert after 15 min. Test connection required; changes re-require it.
- **Status emails** to customers go out from the tenant inbox when connected (fallback support@aistaff.click).
- AIStaff's own alert mail stays on Hostinger (decided 2026-10-20: no Postmark/SES).

### Still open in this section
- Business hours / language per channel; attachments are only named to Closer (not read); staff reply from Inquiries
  for email threads (staff takeover) not built; one customer profile across channels (an email from a Messenger
  customer starts a separate email conversation).
- Step 4 website widget, step 5 VoLTE calls + SMS.

### Built 2026-10-20 (step 3, staff resolve loop) — src/resolve-loop.js
- Buttons per recipient on ACTION NEEDED + URGENT alerts (signed, 7 days, confirm page then POST), code [R-xxxxxxxx].
- Plain email replies to support@aistaff.click understood by the Closer model (retry / manual / handle / unclear).
- Retry = dry run + save with a new idempotency key; manual reference verified via `director.resolve.verify` in the job's
  blueprint; success -> customer told on Messenger (<24 h) and/or email thread + status email from the tenant inbox,
  staff DONE email; failure -> new alert. Audit: `staff_resolve_actions`.
- Open: resolve from the AIStaff Inquiries screen (button for staff already logged in); SMS when VoLTE is wired;
  15-minute URGENT throttle per customer (waiting for Mike).

## 10. Cases: one open case per customer need (built 2026-10-20)

- A **request** (AIStaff, id shown to staff as R-xxxxxxxx) becomes a **ticket** only when the tenant system returns
  its reference (Marga SR-...). Customers only ever see that reference (decision: no AIStaff case number).
- **Need** = job + `workflow_config.director.case.keys` (Marga: customer, branch, machine, category).
- One open case per need (3 days): asking again replaces the old case (kept as "replaced", history moved);
  follow-ups are history entries (time, words, waiting minutes, alerted/held), never new requests.
- Staff alerts: at most one per case per 15 minutes; alerts list the follow-up history.
- Save (by Closer or by staff "fixed") closes every open case for the need with the same reference and tells each
  customer; other customers blocked by the same problem are retried automatically.
- Staff see **Open cases** on each workflow card (Business Engines) with Fixed — try again / Enter reference / Close.
- Code: `src/cases.js`, `business-engines.recordBlockedCase/afterCaseSaved`, `director.handleFollowup`,
  `resolve-loop.closeSameNeed/resolveOthersWaiting`, `workflows-view.openCasesFor/caseAction`, `scripts/cases-cleanup.js`.

### Section 10 update (2026-10-20 10:30) — cases v2
- No time limit: a case is open until done/cancelled/closed. Stages: waiting (no reference) -> ticket_open
  (reference; open until done in the tenant system) -> done / cancelled / closed.
- Before any new request while the customer has open ones, the Director asks (fixed step, numbered) whether each
  is still needed; nothing new is created first. Same need -> added to the open case/ticket (customer confirms).
- Tenant ticket jobs used only by code (policy staff_only): update_service_details, cancel_service,
  close_service_request, get_service_status (Marga API update/cancel/close + schedule state).
- Daily briefing report (default 16:00 Mon-Sat): every open case with problem, recommendation and buttons
  (Fixed - try again / Enter SR / Done - close / Still open / Cancel); finished tickets auto-closed.
- Open: SMS/VoLTE for reports; a briefing view inside AIStaff (today email only); multi-customer accounts
  (same company through different Messenger accounts) are separate conversations.

### Planned: cost per client (Mike, 2026-10-20)
- Every case ends as DONE (visit / delivery happened -> counts as cost) or CANCELLED / CLOSED (no visit -> no cost).
  Never cancel something that was delivered. Future report: per customer / branch / machine — visits, deliveries,
  items delivered, repeat visits, time to resolve — from closed tickets (Marga schedules with date_finished and
  purpose) joined with AIStaff case history. Needs item quantities per delivery (today only free text).

## 11. Scheduling cut-off (built 2026-10-20)
Generic per tenant, off by default (Settings > General > Scheduling cut-off): cut-off time, working days, earliest schedule (lead days), keywords that need preparation, prep days, holidays, order-of-calls note. AIStaff computes the target date (src/scheduling-rules.js), tells the AI, and sends it to the connected system's date field when the action has one. The system's saved schedule always wins over the estimate.
Later: per-staff daily capacity (push to the next day when full); Philippine holiday preset; using the original call time for staff retries.

Update 2026-10-20 12:30: §11 lives in Business Engines > Customer Service (tenant_engines.scheduling_rules), not Settings > General. Customers are never told a schedule day/date/time or promise unless the business ticks "Closer may tell customers the target day" (default off).

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

## 2026-10-21 14:50 — OGP (Colliers) email thread review fixes
- Case R-080d8c05 (Shirlyn Lecaros, One Global Place, Daiichi machine E78947G3H927850) blocked since 2026-10-20 11:34: "No active technician is assigned to area South 3". Areas with NO active technician: pasig, pms 1, pms 2, rizal 1, rizal 2, south 2, south 3 (Master Schedule > Settings > Setup Technicians). Needs staff.
- cases.openCasesForConversation: also cases this conversation was merged into + the same customer's open cases on other channels (calleremail / last 10 phone digits; email channel uses the sender address). Her 2026-10-21 14:05 email follow-up had found nothing -> generic AI.
- ai.js platform rule: never say forwarded / escalated / assigned / updated / scheduled / team reviewing unless a tool result this turn shows it (the generic reply invented "forwarded to our technical team").
- business-engines: name / phone / email the customer WROTE (e.g. email signature) are accepted without asking again (was: "Details was already provided earlier").
- Same caller + same machine + same kind -> added to the open request automatically and told (no "add or new?" question). merge_into.same_caller; added_to_open_request prints the reference when there is one.
- reply-style formal: closing line asks for a reply only when something was asked.
