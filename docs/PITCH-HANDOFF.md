# Pitch — handoff, 24 Aug 2026

Voice agent. Where it stands after a long debugging session, what was fixed,
and what to do next.

---

## Run it

Pitch is a **launchd service**, `com.aistaff.pitch`, with `KeepAlive`.

```bash
# restart (NEVER pkill — launchd respawns and the manual copy loses the port)
launchctl kickstart -k "gui/$(id -u)/com.aistaff.pitch"

# the real log
tail -f ~/Library/Logs/AIStaff/pitch.launchd.log

# whole stack (whisper + piper + pitch), reads local-runtime/pitch-config.json
bash local-runtime/bin/restart-voice-stack.sh
```

`logs/pitch-live.log` is NOT the live log — it only ever held hand-started
copies. Ignore it.

---

## The two pipelines

Switch in **AI Studio → Pitch**. Setting saved to
`local-runtime/pitch-config.json`; applies on restart.

| | Pipeline 1 | Pipeline 2 |
|---|---|---|
| Name | Gemini Live | Local (Piper) |
| Path | speech ↔ speech | whisper → Gemini text → Piper |
| Latency | ~500 ms | ~1.4 s |
| TTS cost/call | ≈ ₱1.30 | ≈ ₱0.02 |
| Taglish | native | **English only** (see below) |
| Voice | 8 Google prebuilt | any Piper `.onnx` |

Local services: whisper.cpp `:8080`, Piper `:9891`.

---

## Prompts

Both pipelines have a **complete** prompt in the database, editable in
AI Studio → Pitch with version history and rollback.

| Key | Pipeline |
|---|---|
| `pitch_system_gemini` | Gemini Live |
| `pitch_system_local` | Local (Piper) |

Nothing about the prompt is hardcoded. `src/pitch/prompt.js` `buildSeed()`
runs only to seed an empty database or as a fallback if Postgres is down
mid-call.

Variables filled at call time: `{{business_name}}`, `{{agent_name}}`,
`{{caller_number}}`, `{{knowledge_base}}`.

**Pitch and Closer share the knowledge base, never the prompt.** Same facts
both channels; behaviour on a phone has nothing in common with Messenger.

---

## Bugs found and fixed today

**1. Barge-in fired on a single 20 ms frame.** `local-pipeline.js` flushed the
agent's playout the instant one frame crossed the energy threshold — a click,
a breath, or the agent's own voice echoing back through the gateway. That is
why greetings died after two words before the caller said anything.
Now requires 300 ms of *continuous* speech (`PITCH_LOCAL_BARGE_IN_MIN_MS`),
once per agent turn, and honours the AI Studio toggle.

**2. Aliasing in the resampler.** `audio/resample.js` downsamples with a box
average. Fine for Gemini Live (24k→8k is exactly 3:1, already band-limited),
wrong for Piper's full-band 22.05 kHz — 22050/8000 = 2.756, so the window
jitters between 2 and 3 samples and everything above 4 kHz folds into the
voice band. Audibly garbled. Piper now emits 8 kHz itself via ffmpeg soxr;
`resample.js` is untouched because Gemini Live depends on it.

**3. No de-registration on shutdown.** Every restart left the AIO100 holding a
contact pointing at a dead socket → caller gets one ring then busy until it
times out. `ua.unregister()` now sends `expires: 0` on SIGTERM.

**4. `prompt-store.js` is unsafe for any key but Closer's.** Its
`ensureSeeded()` writes `BOOTSTRAP_CLOSER_INSTRUCTIONS` for ANY key, and its
cache is a single module-level variable with no key check. Seeding Pitch
through it put Closer's Messenger prompt into `pitch_system`. Pitch now owns
its own rows and its own per-key cache and does not touch that file.
**This bug is still there for the next person who adds a third key.**

**5. Machine-level memory, not code.** The original choppiness was 100.8
million pageins and 6.7 GB of compressed memory after 14 days uptime — the
VoxCPM2 attempt had pushed the box into permanent swap. A reboot cleared it.
RTP needs a packet every 20 ms; a thrashing box cannot deliver that.

---

## Whisper tuning (earned from real call logs)

Model: `ggml-small` (465 MB, ~500 ms/turn). `medium` is 6× slower on this M1
(~1.2 s) and pushes the box back into swap. `base` mishears badly.

Flags in `restart-voice-stack.sh`:

| Flag | Why |
|---|---|
| `-sns` | Kills `[inaudible]` / `[SIDE CONVERSATION]` subtitle hallucinations |
| `-bs 5 -bo 5` | Beam search — turns "may may" back into "Mike Pineda" |
| `-l en` | Auto-detect was decoding Taglish as broken Tagalog |
| `--prompt` | Biases toward real names and vocabulary. **Cheapest accuracy win — extend this** |
| `-nth 0.75` | Higher no-speech threshold |

---

## Prompt lesson

**Soft limits get ignored; hard caps get followed.**

- "Use po at most one sentence in four" → said "Goodbye po" every call
- "Do NOT use po at all — absolute: zero" → gone completely
- "Use the name sparingly" → "Sir Mike" in 6 of 8 turns
- "AT MOST TWICE in the whole call" → fixed

Write rules as absolutes.

---

## Tenancy — the open architectural gap

`PITCH_COMPANY_ID` in `.env` names the tenant. Pitch reads that company's
`name` and knowledge base; `PITCH_BUSINESS_NAME` is now only a fallback for
when the database is unreachable.

**This is one value for the whole process.** It breaks the moment a second
client has a gateway. Multi-tenant needs:

1. A `device` table — one row per AIO100: serial, SIM number, status,
   `company_id`. Many devices to one company. **Add this before client #2:**
   an hour now, a migration across live accounts later.
2. Inbound call → which SIM → which device → which company → that company's
   name, prompt and knowledge base.
3. `pitch-config.json` moves into the database keyed by company.

The module boundary is already right: only `loadTenantContext()` in
`src/pitch/prompt.js` would change.

**Knowledge base budget matters for voice.** Closer allows 60,000 characters —
fine for Messenger where the prompt is sent once per typed reply. Voice
re-sends the whole prompt EVERY turn, so 60k is ~15,000 extra input tokens
per turn: seconds of latency and a cost multiple. Capped at 6,000
(`PITCH_KB_MAX_CHARS`). Voice needs a tight curated set, not the catalogue.

---

## Known-broken / not done

- **Pitch cannot book anything.** It says "someone will get back to you".
  No booking tool is wired. Biggest functional gap.
- **`[Date]` placeholder shipped in a real SMS** to a customer once. There is
  now a prompt rule against it; a regex guard in the send path would be safer.
- **RTP still ~48/50 packets per second.** Roughly 1 s of gaps per minute.
  Memory pressure; Chrome alone holds ~1.5 GB on a 16 GB M1.
- **Taglish on Piper is impossible.** espeak-ng has no Tagalog rules, so the
  local pipeline is prompted English-only. This blocks the two-tier pricing
  plan — the standard tier cannot serve Taglish callers until a Tagalog voice
  is trained. See the voice-lab work below.
- **Internal disk was at 2.4 GB free.** Worth clearing; it drives the swap
  pressure that causes the RTP gaps.

---

## Voice-lab (Taglish TTS training)

`local-runtime/voice-lab/` — recorder for building a Piper training dataset.
`node recorder.js` → http://127.0.0.1:9890. Records via ffmpeg + avfoundation
(lossless 22050 Hz mono PCM), auto-analyses peak/RMS/noise floor per take,
exports LJSpeech `metadata.csv`.

Script: 1,050 lines across 9 categories, 70% Taglish / 20% English / 10%
Tagalog. Category 1 (greetings, 100 lines) is done and in
`scripts/raw/01-greetings.json`. `node scripts/merge.js` merges and validates.

**The blocker is not the dataset — it is espeak-ng.** No Tagalog rules exist
(open since 2019). A `tl_rules` file would unlock Tagalog for Piper, Kokoro
and every espeak-based system. Tagalog is an easy target: Latin script, ~20
phonemes, five pure vowels, highly phonemic spelling. The Tigrinya project is
the working template. That file does not exist anywhere in the world and is
worth more than the voice itself.

---

## Files touched today

```
src/pitch/prompt.js            restructured — DB-backed, per-pipeline, tenant-aware
src/pitch/config.js            resolveBrainProvider, bargeInMinMs, Piper defaults
src/pitch/runtime-config.js    NEW — pipeline/voice settings as JSON
src/pitch/voice-catalogue.js   NEW — Piper voice listing, 55 languages
src/pitch/brain/*.js           load prompt from AI Studio in connect()
src/pitch/sip/ua.js            unregister() with expires: 0
src/pitch/index.js             de-register on shutdown
src/routes/pitch-admin.js      NEW — admin API
src/server.js                  one line: mount pitch-admin
public/app.js                  Closer/Pitch tabs + Pitch settings view
local-runtime/bin/restart-voice-stack.sh   NEW
local-runtime/piper/            NEW — shim, voices, samples
local-runtime/voice-lab/        NEW — dataset recorder
```

Backups: `.env.backup-gemini`, `.env.bak-*`.

---

## Session 2 — 25 Aug 2026 (multi-call + scale foundations)

### Done this session

**Pitch handles concurrent calls.** `activeCall` (one call for the ENTIRE
platform) is gone.

- `src/pitch/call-registry.js` — NEW. Calls keyed by SIP Call-ID.
- RTP ports are now **tracked and released**, not a rolling counter. The old
  version could hand out a port a hung-up call still held the socket for.
- **Per-tenant channel caps** enforced server-side (`SipDevice.max_channels`).
  A one-line plan gets one line no matter what the customer configures on
  their own box.
- Global cap `PITCH_MAX_CONCURRENT_CALLS` (default 8) → 503, not a crash.
- Tested: two tenants concurrent, correct 486 on a tenant's second call, ports
  released on hangup.

**Tenant resolution on the call path.** `src/pitch/tenant.js` — NEW.
Every call resolves a company before admission. Falls back to
`PITCH_COMPANY_ID` today; once boxes register to our Asterisk the SIP auth
username arrives on the dialog and resolves the real tenant, with **no change
below that line**.

**Business name now comes from the tenant**, not `.env`. `PITCH_BUSINESS_NAME`
is a database-unreachable fallback only. `{{business_name}}` resolves from
`company.name`.

**Knowledge base shared with Closer, capped for voice.** Closer allows 60,000
chars — fine when the prompt is sent once per typed reply. Voice re-sends the
whole prompt EVERY turn, so 60k is ~15,000 extra input tokens per turn.
Capped at 6,000 (`PITCH_KB_MAX_CHARS`).

**Prompt fixes** (both now absolute rules, in the DB, editable in AI Studio):
- `pitch_system_local` v2 — "po" banned outright. A frequency limit ("at most
  one in four") was ignored every single call.
- v3 — name/honorific capped at twice per call. "Sir Mike" appeared in 6 of 8
  turns under "use it sparingly".

**Whisper tuned** — see the flags table in session 1. `-sns -bs 5 -bo 5 -l en`
plus `--prompt` vocabulary. On test audio it now gets "Mike Pineda" and
"GCash" exactly right.

**Piper outputs 8 kHz directly** via ffmpeg soxr, bypassing the box-average
downsample that was aliasing everything above 4 kHz into the voice band.

**Call recording on** — `PITCH_RECORD_DIR=/Users/mike/Desktop/pitch-calls`.
Two WAVs per call, caller and agent separately. Use these to test whisper
settings against real phone audio instead of guessing.

### Written but NOT applied

- `docs/proposed-sip-device.prisma` — the `SipDevice` model. **Mike applies
  this**, deliberately: `npx prisma migrate dev --name add_sip_device`.
  `src/pitch/tenant.js` already handles its absence gracefully.
- `docs/PITCH-SIP-SCALE-DESIGN.md` — full architecture for 1,000+ tenants.
  Read before writing any telephony code.

### Next session — refining the Piper pipeline

Current state: local pipeline works end to end. Choppiness gone, "po" gone,
transcription much improved. What remains is quality tuning against **real**
call audio, which now exists in `~/Desktop/pitch-calls/`.

**Start here — use the recordings, stop guessing.** Every earlier fix was
tested on synthetic Piper audio, which transcribes perfectly and taught us
nothing about real VoLTE codec + Filipino accent + room noise.

Open questions worth measuring:

1. **How accurate is whisper small on Mike's real voice?** Run the recorded
   `*-caller-in.wav` files through small vs medium and diff the transcripts
   against what he actually said. That settles the model question with data.
   Medium costs ~1.2 s/turn and 1.74 GB — only worth it if the gap is large.

2. **Does the `--prompt` vocabulary help on real audio?** Extend it with real
   product names, customer names, street names, and measure.

3. **Is Piper's 8 kHz output actually clean now?** Listen to
   `*-pitch-out.wav`. The aliasing fix is unverified on a real call.

4. **VAD tuning.** `vadSilenceMs` is 1100 ms, raised from 700 because "Mike
   Pineda" was arriving as "My hit cut". Check the recordings for utterances
   still being clipped, and whether 1100 adds noticeable dead air.

5. **RTP gap rate.** Last calls ran ~48/50 packets per second — roughly 1 s of
   gaps per minute. Memory pressure. Check `free` before and after closing
   Chrome (~1.5 GB on a 16 GB box).

**Do not start the Asterisk work in the same session as prompt tuning.** They
need different heads and the prompt work needs many short test calls.

### After that, in order

1. **Whisper pool abstraction** — Pitch should call `whisper-pool`, not
   `127.0.0.1:8080`, with health checks and retry-elsewhere. Do this BEFORE
   buying the Ryzen box so adding a node is a config line, not a refactor.
   Use `faster-whisper` on GPU nodes, not `whisper.cpp` — CTranslate2 batches
   requests into one GPU pass: ~80 concurrent per card versus ~8.
2. **Apply the `SipDevice` migration.**
3. **Asterisk + PJSIP realtime**, then prove it with a SECOND AIO100 on a
   different network. Re-proving the LAN case teaches nothing.
4. **Channel-scoped knowledge base** (`both | closer | pitch`) with a Pitch
   view showing the 6,000-char budget.
5. **`prompt-store.js`** — `ensureSeeded()` writes Closer's text for ANY key
   and its cache ignores keys. Still unfixed. Its own session, with a test
   call after, because it sits in Closer's live reply path.

### Things that will bite

- **Onboarding is the real constraint, not compute.** Each client needs a SIM
  activated, box configured, forwarding set on their carrier, knowledge base
  populated. Hours of human work per client. Solve provisioning before
  concurrency.
- **Taglish on Piper is impossible** until espeak-ng has Tagalog rules. This
  blocks the two-tier pricing — the cheap tier cannot serve a Taglish caller
  at all. `tl_rules` does not exist anywhere in the world; Tagalog is an easy
  target (Latin script, ~20 phonemes, phonemic spelling) and the Tigrinya
  project is the working template.
- **Pitch cannot book anything.** Says "someone will get back to you". The
  `Booking` and `BookingSetting` models exist; no tool is wired.
