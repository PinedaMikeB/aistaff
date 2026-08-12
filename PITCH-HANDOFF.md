# Pitch Voice Agent — Session Handoff

**Date:** 2026-08-10
**Goal:** call the GOMO SIM in the AIO100, have Pitch answer in whatever
language the caller uses.
**State:** code complete and tested; gateway config ~60% done; **no call
attempted yet**.

**Decided this session (see §10):** mobile number — not PSID — is the identity
key. Pitch stands alone; Closer is a future referrer, not a dependency. Caller
ID is read from the INVITE and **confirmed, not asked**.

---

## 1. What Pitch is

Third AIStaff agent, after Closer (chat sales) and Brandee (UGC ads). Fills
the "AI Voice Sales Agent" slot already advertised on the aistaff.click
homepage ticker but never built.

Call path:

```
caller's phone -> PH mobile network -> GOMO SIM
  -> AIO100 VoLTE trunk -> inbound route -> SIP extension 8001
  -> Pitch (Node process on the Mac Mini)
  -> OpenAI Realtime (speech-to-speech)
  -> back down the same path
```

No Twilio (metered = expensive). No Asterisk/FreeSWITCH — the AIO100 has a
built-in SIP server with 32 extensions, enough for one channel. A softswitch
goes in later when concurrency or transfer trees are needed.

---

## 2. NON-NEGOTIABLE: language is never configured

There is no language setting, locale, or Taglish flag anywhere in the code,
and there must not be one. `src/pitch/prompt.js` instructs the model to listen
to the caller and match them — English, Tagalog, or Taglish — and to switch
mid-call without comment when the caller switches.

This is why **OpenAI Realtime (speech-to-speech)** was chosen over an
STT -> LLM -> TTS chain: a chain forces picking a TTS voice per detected
language, which is exactly the hardcoding being avoided. It is also one
network round trip instead of three.

This follows `docs/handoff-masterplan.md`: **AI writes; code gathers facts.**
Tools must return `{available: true, slots: [...]}`, never
`{say: "Yes ma'am, available po ang Wednesday"}`. A test in
`test/pitch.test.js` asserts the prompt contains no verbatim script and no
fixed greeting. Do not add one.

---

## 3. Code written this session (all new, nothing existing modified)

```
src/pitch/
  index.js                  entry point; own process; PITCH_ENABLED gate
  config.js                 all env config
  call.js                   wires SIP + RTP + brain per call
  prompt.js                 style principles only, zero scripted lines
  log.js
  sip/ua.js                 REGISTER w/ MD5 digest auth, INVITE/BYE/CANCEL
  sip/sdp.js                G.711-only offer/answer
  rtp/session.js            RTP framing, 20ms playout clock, barge-in flush
  rtp/codec.js              mu-law / A-law, table-driven
  audio/resample.js         8kHz <-> 24kHz
  brain/index.js            provider selection (openai | gemini later)
  brain/openai-realtime.js  WebSocket speech-to-speech
test/pitch.test.js          7 tests, all passing
docs/PITCH-SETUP.md         gateway config + troubleshooting
```

Also changed: `package.json` (scripts `pitch`, `pitch:test`; deps `sip`, `ws`),
`.env.example` (Pitch block appended).

**Deliberately NOT touched:** `src/server.js`, `prisma/schema.prisma`, any
Brandee or Closer file.

### Verified by test
- G.711 round-trip 41.2 dB SNR (PCMU) / 40.4 dB (PCMA) — textbook
- 160 bytes per 20 ms frame
- RTP symmetric-address learning (learns remote from arriving packets)
- 20 ms outbound pacing
- barge-in flush clears playout queue
- SDP parsing against an AIO100-shaped offer, prefers far end's G.711 choice
- prompt contains no hardcoded language and no fixed greeting

`npm run pitch:test` -> 7/7 pass.
Full suite `npm test` -> 437/439. **The 2 failures are pre-existing**, in the
Brandee image workspace, tied to uncommitted `workspace/index.html` edits —
the asserted string is absent from HEAD too. Not caused by Pitch.

---

## 4. Repo state — READ BEFORE COMMITTING

Branch: `feat/brandee-image-creative-approaches`
There is **uncommitted Brandee work in `src/server.js`** (+87/-10) and 6 other
files, from the GPT Image 2 / AI_GENERATED_LAYOUT effort.

Pitch was written entirely as new files to avoid tangling with it. Before
committing Pitch, either commit/stash the Brandee work or move Pitch to its
own branch off main.

---

## 5. AIO100 gateway — hardware state

Reachable at `http://192.168.100.200` (admin/admin unless changed).

- Firmware 1.53.5.6 (2021) — older than the device's real capabilities
- Module: Quectel EC20F, `boardtype = VOLTE`
- VoLTE Online, SIM OK, Carrier **GOMO**, Mode **Auto / 4G / FDD LTE**
- WAN: 192.168.100.200 static, gateway 192.168.100.1
- LAN port (192.168.11.1) is **dead/unused** — do not plug into it. A previous
  session created a routing hazard by doing so.
- Config backup before SIM insert:
  `aio100-backup-2026-08-08-pre-sim.bin` (Dinstar proprietary format, restore
  via System -> Backup/Restore -> Restore from the backup)

### SIM history (resolved)
SIM initially not detected — `simpin_state = SIMPIN_NOT_INSERTED`,
`cme_error_str = 10`, 11 failed retries. Fixed by power-off + reseat.
Diagnose with **System -> Command Line -> `gsm status`**.

---

## 6. Gateway config — DONE

**Extension -> SIP -> index 1** (saved):
- Name `Pitch`, Extension `8001`, Password set (also in `.env`)
- DID **blank** (a DID bypasses routing entirely and would mask route bugs)
- Max Concurrent Call `1`
- Register Source `Any`
- SIP Profile **`2-< wan_default >`**  <- critical, port 5080 not 5060
- Status Enabled

**Profile -> SIP -> index 2 (wan_default)** (saved):
- Local Listening Port `5080`, Interface WAN
- DTMF `RFC2833`, RFC2833-PT `101`
- Detect Extension is Online **On**, Detect Period 30
- Allow Unknown Call **Off**
- Inbound Source Filter **`192.168.100.1/24`**
  (the validator rejects `192.168.100.0/24` — it wants a host address with a
  prefix, per its own examples)

---

## 7. Gateway config — REMAINING

### Step A — Trunk -> VoLTE (was mid-edit when session ended)

Top half of the form, not yet confirmed:

| Field | Value |
|---|---|
| Extension | `8002` (must differ from 8001) |
| Autodial Number | blank — use a route instead, one mechanism to debug |
| **Register to SIP Server** | **`Off`** |
| **Band Type** | **`All`** |
| Carrier | `Auto` |
| GSM Codec | `Auto` |
| Reactive when register fail | `On` |
| CLIR | `Auto` |

Bottom half (already reviewed):

| Field | Value |
|---|---|
| PIN Code | blank |
| DSP RX / TX Gain | `0dB` both |
| Module RX / TX Gain | lowest available (`+1dB`) |
| SIM Number Learning Profile | `Off` |
| SIM Balance Check Profile | `Off` |
| Status | `Enable` |

*Register to SIP Server must be Off:* the SIM is the source of calls, not
something that registers outward. On = gateway tries to register the cellular
line to a nonexistent upstream server, and inbound fails confusingly.

*Band Type All:* `gsm status` reported `bandmode = GSM850_EGSM_DCS_PCS_MODE`
— four 2G bands, no LTE. It is attached on 4G now, but a re-scan could drop it
to 2G, which GOMO barely supports for voice.

*Gains neutral:* boosting to fix quiet audio adds distortion; the model
handles quiet speech far better than clipped speech. Adjust only after
hearing a real call, one side at a time.

*SIM profiles Off:* they poll the carrier via USSD, which can interrupt voice.

### Step B — Call Control -> Route -> New (inbound)

| Field | Value |
|---|---|
| Priority | `10` |
| Name | `lte-in-to-pitch` |
| Source | the VoLTE/GSM trunk |
| Number Profile | `Off` |
| Caller Number Prefix | blank |
| Called Number Prefix | blank |
| Time Profile | `Any` |
| Manipulation | `Off` |
| Destination | SIP Extension / `8001` |

**Higher number = LOWER priority on this device.**

### Step C — Apply

Click **Apply** in the orange "Unapplied Changes" bar. Was at 36 unapplied
changes at session end. **Nothing takes effect until Apply is clicked.**

---

## 8. Then run it

`.env` needs:

```bash
PITCH_ENABLED=true
PITCH_SIP_PASSWORD="<extension 8001 password>"
PITCH_SIP_LOCAL_HOST=192.168.100.72   # verify: ipconfig getifaddr en1
PITCH_BUSINESS_NAME=Marga Enterprises  # or whoever is answering
```

`PITCH_SIP_LOCAL_HOST` must be the LAN IP. If loopback, the gateway has
nowhere to send RTP -> connected call, total silence. There is a preflight
check for this.

```bash
npm run pitch
```

Expect:
```
[pitch:info] starting — extension 8001 -> 192.168.100.200:5080 ...
[pitch:info] registered as extension 8001 — ready for calls
```

Confirm on gateway: **Status -> SIP**, extension 8001 should read
`Registered`. Then dial the GOMO number.

End-of-call log shows `rtpIn=` / `rtpOut=`. Both should be roughly
`duration_seconds * 50`. If one is zero, media only flowed one way.

---

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| `registration failed: 401` | Wrong password, or extension on lan_default not wan_default |
| `registration failed: 403` | Register Source restriction, or Inbound Source Filter excludes the Mac |
| No registration attempt | Wrong port — must be 5080 |
| Rings, never answers | Inbound route missing or misrouted |
| Connects, total silence | `PITCH_SIP_LOCAL_HOST` wrong, or macOS firewall blocking UDP 40000-40100 |
| One-way audio | Asymmetric RTP |
| Busy signal | Previous call did not clean up; restart the process |
| Pitch talks over caller | Raise `silence_duration_ms` in `brain/openai-realtime.js` (currently 700ms, tuned for Filipino speech pauses) |

---

## 10. Known gaps / next steps

**Network quality.** The AIO100 was measured at 84 ms with 50% packet loss on
WiFi, versus 3.6 ms two days earlier. **Move it to wired ethernet before
judging call quality** — otherwise good code will sound broken.

**Nothing is persisted yet.** No Conversation / Lead / AiLog rows. Transcripts
go to stdout only. The identity model below is **decided** (Mike, 2026-08-10)
and is the next thing to build.

### DECIDED: mobile number is the identity key, not PSID

The original framing ("a phone call has no PSID") was wrong-headed. The real
problem is that **PSID was the wrong key to build on**. A hotel guest who
finds the number on Google, on the Page's About tab, or on a business card has
no Facebook relationship at all — demanding a Page-Scoped ID from them is
nonsense.

Mobile number is the better key for a concrete reason: **PSID is scoped to a
single Facebook Page**, so the same human messaging two clients' Pages has two
different PSIDs. A phone number identifies the person across voice, SMS, and
Messenger at once. `Lead.mobile_number` already exists and Closer already
captures it, so the funnel already holds the join key — it just is not used
as one.

**Do NOT** make `psid` nullable (a patch), and do **NOT** create a separate
`VoiceCall` table (forks the customer timeline). Generalize the key instead:

```prisma
model Conversation {
  channel        String   @default("facebook_messenger")  // already exists
  external_id    String   // psid | phone number | future channel id
  psid           String?  // kept, nullable, backward compat
  contact_number String?
  contact_name   String?

  @@unique([company_id, channel, external_id])
}
```

Migration is mechanical: copy `psid` into `external_id` for every existing
row, then swap the unique constraint. Existing Messenger rows keep working —
`channel` already defaults correctly and their `external_id` is their old
psid. Voice rows are `channel: "voice"`, `external_id: "+639171234567"`.

**Caveats to build around:**

- **Caller ID is not identity.** It can be withheld, spoofed, or shared
  (office landlines, family phones, a receptionist dialling for a guest).
  Fine for "have we spoken before?"; NOT fine for anything sensitive, which
  still needs the PIN/OTP flow from `PITCH-BUILD-PROMPT.md`.
- **Name must be asked, never assumed.** The network gives a number, never a
  name. `contact_name` is self-reported — may be a nickname or a spelling
  Pitch would get wrong. Store what they said; do not treat it as verified.

### DECIDED: the workflow

Pitch works **standing alone**. Closer is a future *referrer* into voice, not
a dependency. Nothing in the voice path may assume Closer exists.

```
NOW (Pitch alone):
  guest finds hotel — Google, Facebook About tab, business card
    -> dials the hotel's AI voice number
    -> Pitch answers, adapts to their language
    -> Pitch already has caller ID; asks for name + email

LATER (Closer added):
  guest messages the hotel's Facebook Page
    -> Closer handles the inbox; when voice is the better path
       ("can I check availability?"), hands over the voice number
    -> guest dials -> Pitch
```

### Caller ID: confirm, do not ask

`sip/ua.js` already extracts the caller's number from the INVITE From header
as `dialog.callerId` — **Pitch knows the number before it says hello.**

Asking "what's your mobile number?" when it is already on screen is what makes
an AI feel dumb. Pitch should confirm instead:

> "Is this the best number to reach you, or would you prefer another?"

One turn instead of a collection, and it handles the real case of someone
calling from a front-desk phone who wants the confirmation on their own
mobile. When caller ID is **absent** (withheld, or stripped by some carrier
paths), Pitch falls back to asking. This is a **runtime branch, not a config
setting** — the model is told whether a number was detected and phrases the
turn accordingly, same principle as language.

| Field | Source |
|---|---|
| Mobile number | **Caller ID, automatic** — confirm, don't ask |
| First name | Ask |
| Last name | Ask |
| Email | Ask |

**Email over a phone call is genuinely hard.** Filipino names, `@`, dots, and
cellular audio combine badly — `maria.delacruz@gmail.com` will get mangled.
Pitch must read it back for confirmation. Longer term an SMS confirmation link
is far more reliable than collecting email by voice (see the SMS note below).

**Do not front-load the form.** A guest calling to ask "may available ba kayo
this weekend?" wants an answer, not an interrogation. Answer first; collect
details when there is a reason to — a booking, a callback, a follow-up. The
consultative principle from `docs/handoff-masterplan.md` applies to voice too:
gather naturally, never run a script.

**Knowledge base gap.** `KnowledgeBase` is Q&A pairs (category/question/
answer/tags). No documents, chunks, embeddings, versioning, approval status,
or effective dates. No pgvector. Pitch's spec needs a new model family
alongside — not replacing — the existing table.

**No tools.** Pitch cannot check availability or book anything. It is
instructed never to claim otherwise.

**One concurrent call.** `PITCH_MAX_CONCURRENT_CALLS=1`. Second caller gets an
honest 486 Busy. Assume one VoLTE module = one channel until tested.

**No marketing page.** `/agents/pitch/` does not exist — it falls through to
the SPA catch-all and serves the homepage. Needs
`public/agents/pitch/index.html` following the Closer/Brandee pattern (288
lines, `assets/slide-N.jpg`). Also `src/server.js` ~line 1055 contains the
site-chat assistant's routing instructions, which mention only Closer and
Brandee.

**Pricing undecided.** Closer bills by conversations (1,500/8,000/25,000 at
P4,999/24,999/59,999). The Pitch draft bills by AI talk minutes
(500/1,500/4,000 at P7,999/14,999/29,999). Different meters, colliding tiers.
Mike deferred this — build first, fix pricing later. Keep plan limits in the
DB, not in business logic.

**SMS is unused but available.** Call Control -> SMS and SMS Route exist on
the gateway (170 chars, ucs2). Good Phase 2 additions: post-call confirmation
texts, or SMS as a second channel using the same brain. Check what GOMO's plan
actually covers — unlimited usually means calls, with SMS metered separately.

**Gemini Live not wired.** `GEMINI_API_KEY` is empty in `.env`. The adapter
interface exists (`brain/index.js`); implementing Gemini means matching the
same surface — `connect()`, `write(pcm8k)`, `greet()`, `close()`, events
`audio` / `barge_in` / `transcript` / `error` — then setting
`PITCH_BRAIN_PROVIDER=gemini`. No call-handling code should change.

---

## 11. Infrastructure notes (from docs/WEBSITE-MARKETING-HANDOFF.md)

- `localhost:3000` and `aistaff.click` are the **same process** via Cloudflare
  Tunnel. No separate deploy step.
- The main API runs under launchd: `launchctl kickstart -k gui/$(id -u)/com.aistaff.api`.
  **Never** start it with a manual `npm run dev` — that leaves orphan processes.
- Pitch is a **separate process** and needs its own launchd job for production.
  Currently run manually with `npm run pitch`.
- Cloudflare CDN caches static assets independently of origin; local and live
  can disagree. Use Development Mode when iterating.
