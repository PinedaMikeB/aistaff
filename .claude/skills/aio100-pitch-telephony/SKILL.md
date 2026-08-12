---
name: aio100-pitch-telephony
description: Use this skill whenever working on Pitch's telephony layer — configuring the AIO100-1V VoLTE gateway from scratch, adding a new SIM or number, or debugging any call problem (rings then busy, registration fails, call connects but is silent, one-way audio, Pitch talks over the caller). Also use before changing anything in src/pitch/sip, src/pitch/rtp, or the brain adapters, since it records the exact API and library pitfalls already hit and solved. This captures the verified-working gateway configuration field by field, the measurement-based debugging ladder that isolates gateway faults from code faults, and the two non-negotiable product rules that govern the voice agent.
---

# AIO100-1V → Pitch telephony

First verified working end to end on **2026-08-10**: GOMO SIM, inbound
cellular call answered by Pitch, natural Taglish in both directions.

## The two rules that govern everything

1. **No language setting, ever.** No `PITCH_LANGUAGE`, no locale, no Taglish
   flag, anywhere — code, env, or gateway. Pitch hears the caller and matches
   them, switching mid-call if they switch. `test/pitch.test.js` asserts this.
2. **No hardcoded spoken copy.** Tools return facts; the model writes the
   words. See `docs/handoff-masterplan.md` for the canned-reply mistake this
   exists to prevent. It is far more obvious in speech than in text.

Both rules are why the architecture is **speech-to-speech** (one model, audio
in / audio out) rather than STT → LLM → TTS. A chain forces you to pick a TTS
voice per detected language, which *is* a language setting. It also cannot
handle mid-sentence code-switching, which is how Filipinos actually talk:
"depende po sa model at duration ng pag-upa."

## Call path

```
caller's phone -> PH mobile network -> GOMO SIM
  -> AIO100 VoLTE trunk
     (internally: FreeSWITCH `gsmopen/1-VOLTE` bridged to `user/8001`,
      media through a C300 DSP over a PCM bus to the Quectel EC20F module)
  -> inbound route -> SIP extension 8001
  -> Pitch (own Node process on the Mac Mini, NOT inside src/server.js)
  -> OpenAI Realtime GA over WebSocket -> back down the same path
```

No Twilio (metered = expensive). No Asterisk/FreeSWITCH of our own — the
AIO100 has a built-in SIP server with 32 extensions, enough for one channel.
A real softswitch goes in when concurrency or transfer trees are needed.

---

## Part 1 — Physical setup

| Item | Value / rule |
|---|---|
| Web UI | `http://192.168.100.200` (admin/admin unless changed) |
| WAN port | **Ethernet, into the 192.168.100.x segment.** Not WiFi. |
| LAN port | `192.168.11.1` — **dead/unused. Never plug into it.** A previous session created a routing hazard doing so. |
| Firmware | 1.53.5.6 (2021-11-16) — older than the hardware's capabilities |
| Module | Quectel EC20F, `boardtype = VOLTE` |
| Model / SN | AIO100-1V / DD18-0515-5004-1296 |

**Wired ethernet is not optional.** On WiFi this gateway measured 84 ms with
50% packet loss; wired it measures ~3.9 ms with 0% loss. Bad network makes
correct code sound broken and wastes whole sessions.

Verify before trusting any call quality judgement:
```bash
ping -c 8 192.168.100.200    # want <10ms, 0% loss
```

### SIM

Insert with the unit **powered off**. If the SIM is not detected
(`simpin_state = SIMPIN_NOT_INSERTED`, `cme_error_str = 10`), power off and
reseat — this has happened and reseating fixed it. Diagnose via
**System → Command Line → `gsm status`**.

Confirm on **Status**: VoLTE Network Online, Module READY, SIM Card OK,
Carrier GOMO, Mode Auto / 4G / FDD LTE.

## Part 2 — Gateway configuration

**Nothing takes effect until you click Apply** in the orange "Unapplied
Changes" bar. Save only stages a change. This has bitten every session.

Back up first: **System → Backup/Restore → Download** (tick System, Network,
Service). Beware — the *middle* Restore button on that page is "restore to
defaults" and will wipe the config. Backups live in `backups/aio100/`
(gitignored). The device also keeps its own history snapshots.

### 2a. Profile → SIP → index 2 (`wan_default`)

| Field | Value |
|---|---|
| Local Listening Port | **`5080`** (NOT 5060 — `lan_default` is 5060) |
| Interface | WAN |
| DTMF Type / RFC2833-PT | `RFC2833` / `101` |
| Detect Extension is Online | `On`, Detect Period `30` |
| Allow Unknown Call | `Off` |
| Inbound Source Filter | `192.168.100.1/24` |

Port 5080 is the single most common mistake here. The validator rejects
`192.168.100.0/24` — it wants a host address with a prefix, per its own
examples. The Mac's IP must fall inside that filter.

### 2b. Extension → SIP → index 1

| Field | Value |
|---|---|
| Name / Extension | `Pitch` / `8001` |
| Password | strong; must match `.env` exactly |
| DID | **blank** — a DID bypasses routing entirely and masks route bugs |
| Max Concurrent Call | `1` |
| Register Source | `Any` |
| NAT | `Off` (same LAN) |
| SIP Profile | **`2 - wan_default`** |
| Status | `Enabled` |

### 2c. Trunk → VoLTE

| Field | Value |
|---|---|
| Extension | `8002` (must differ from 8001) |
| Autodial Number | blank — use a route, so there's one mechanism to debug |
| Register to SIP Server | **`Off`** |
| Display Name / Username Format | `Caller ID / Caller ID` |
| Process Call Hold by Carrier | `Off` |
| Reactive when register fail | `On` |
| CLIR / Carrier | `Auto` / `Auto` |
| DSP RX / TX Gain | `0dB` / `0dB` |
| Module RX / TX Gain | `+7dB` / `+1dB` (as shipped; leave alone) |
| Busytone Detect | unchecked |
| SIM Number Learning / Balance Check | `Off` / `Off` (they poll via USSD and can interrupt voice) |
| Status | `Enable` |

*Register to SIP Server must be Off:* the SIM is the source of calls, not
something that registers outward. On = the gateway tries to register the
cellular line to a nonexistent upstream server and inbound fails confusingly.

**Correction to older docs:** `PITCH-HANDOFF.md` and `docs/PITCH-SETUP.md`
listed **Band Type** and **GSM Codec** under Trunk → VoLTE. Those fields do
**not exist** on the VoLTE trunk page in this firmware — they belong to a GSM
trunk. Do not go looking for them; there is no 2G fallback to configure here.

### 2d. Call Control → Route → New (inbound)

| Field | Value |
|---|---|
| Priority | `10` (**higher number = LOWER priority** on this device) |
| Name | `lte-in-to-pitch` |
| **Source** | **the VoLTE Trunk** — not a SIP extension |
| Number Profile / Manipulation | `Off` / `Off` |
| Caller & Called Number Prefix | blank (match all) |
| Time Profile | `Any` |
| Callback / Failover Action | unchecked |
| **Destination** | `SIP Extension / Pitch / 8001` |

The New Route form defaults Source to a SIP extension — leaving it there
routes Pitch to itself. Without this route the call rings then gives a busy
tone, and **no INVITE reaches Pitch at all** (the log stays silent).

### 2e. Call Control → Setting (verified defaults, change nothing)

`Disconnect call when no RTP packet` unchecked · `PLC` unchecked ·
`EPCD` checked · `NLP` Low · `Echo Canceller Tail Length` 128ms ·
`RTP Port Range` **16000-16200** · FAX Send Mode `T.30` ·
**`Tone Detection by Local` unchecked** (if enabled, a mis-detected fax tone
flips the call into fax mode and voice audio dies while the call stays up) ·
no SDP fax params · `Local extension call` and `extension dial out (VoLTE)`
both enabled.

## Part 3 — `.env` and running Pitch

```bash
PITCH_ENABLED=true
PITCH_SIP_PASSWORD="<extension 8001 password>"   # quote it; @ and specials
PITCH_SIP_LOCAL_HOST=192.168.100.66              # verify, do not assume
PITCH_BUSINESS_NAME=Marga Enterprises            # spoken aloud on answer
```

**`PITCH_SIP_LOCAL_HOST` must be this Mac's current LAN IP.** Check it, never
copy it from a doc — it was stale (`.72` vs actual `.66`) and that alone
produces a connected call with total silence, because the gateway sends RTP
to a machine that isn't there.

```bash
ipconfig getifaddr en1        # or en0 if wired
```

`config.js` calls `dotenv.config({ override: true })`, so **`.env` beats any
exported shell variable.** Setting `PITCH_SIP_PASSWORD` in the shell will not
work; an empty value in `.env` silently wins. Edit the file.

```bash
cd "/Volumes/Wotg Drive Mike/GitHub/AIStaff"     # quote it, path has spaces
npm run pitch
```

Expect `registered as extension 8001 — ready for calls`, and **Status → SIP**
on the gateway showing 8001 `Registered`.

## Part 4 — Debug by measurement, not by guessing

The whole point: **each layer produces a number that proves or clears it.**
Never change a setting on a hunch — take the measurement that isolates which
side is at fault first. On 2026-08-10 this ladder took a silent call down to
a one-line DSP error in about forty minutes, after hours of guessing.

### Layer 1 — Did the call even reach Pitch?

Log line `call: from=+63... codec=PCMU remote=...`

- **Absent** → the gateway never sent an INVITE. Route or trunk problem.
  Registration is irrelevant to this. Rings-then-busy is the usual symptom.
- **Present** → SIP is done. Stop looking at routes, extensions, and ports.

### Layer 2 — Did media flow, and did it contain anything?

End-of-call line: `rtpIn=` / `rtpOut=` / `speechOut=`

- Both `rtpIn`/`rtpOut` should be roughly `duration × 50`. Zero on one side is
  a routing/firewall problem (macOS firewall on UDP 40000-40100).
- `speechOut` counts **non-silent** frames only. `rtpOut` alone proves nothing
  — the session streams silence on the 20 ms clock whenever the queue is dry.

### Layer 3 — Record it and read the peak

```bash
PITCH_LOG_LEVEL=debug PITCH_RECORD_DIR="$HOME/Desktop/pitch-calls" npm run pitch
```

Writes `*-caller-in.wav` and `*-pitch-out.wav` per call and logs a peak.

| caller-in peak | pitch-out peak | Meaning |
|---|---|---|
| ~23000 | ~25000 | **Working.** This is what a good call looks like. |
| **0** | healthy | Gateway is handing us digital silence. Not a code bug. |
| healthy | 0 | Model produced no audio — brain/API problem. |

`peak=0` is mathematically zero, not "quiet". No gain setting can cause it.

### Layer 4 — Make the gateway show its own DSP

**Call Control → Diagnostics** → tick **all five** boxes (SIP Stack, SIP
Message, GSM/LTE/VoLTE, **DSP**, **Voice**) → Start → call → Stop & Download.
DSP and Voice are the ones that matter; SIP Message only re-confirms
signalling you already proved in Layer 1.

The tarball contains `calltrace.txt`, `rtp_capture.pcap`, and — the decisive
artifact — **`pcm_recv_0.pcm` / `pcm_send_0.pcm`**, raw 8 kHz mono LE PCM of
the *module side* of the DSP.

```bash
tar -xf <download> -C /tmp/aio-trace && cd /tmp/aio-trace/tmp
python3 -c "
import struct, math
for name in ['pcm_recv_0.pcm','pcm_send_0.pcm']:
    b=open(name,'rb').read(); n=len(b)//2
    s=struct.unpack('<%dh'%n, b[:n*2])
    print(name, 'peak', max(abs(x) for x in s),
          'rms', round(math.sqrt(sum(x*x for x in s)/n),1))
"
```

`pcm_recv` = module → gateway (the caller's voice). `pcm_send` = gateway →
module (Pitch's voice). If `pcm_recv` is zero while `pcm_send` has audio, the
gateway's own DSP is getting nothing from the cellular module, and every
component you control is exonerated.

## Part 5 — THE FIX: reboot when the DSP channel is stuck

**Symptom (2026-08-10):** call connects, caller ID passes, RTP flows both ways
at the right rate with zero loss — and `caller-in peak=0` for 20+ seconds.
Every gateway setting checked and correct.

**Root cause, from `calltrace.txt`:**
```
user.err   c300_crcx:dsp:0 chan:0 state DSP_CHAN_STATE_BUSY is not booked:
           pPeerIpAddr:172.16.255.255, usPeerPort:8000
user.warn  read cng
user.warn  Unkown dsp event...: 14
```
A DSP channel was stuck in `BUSY` and never bound, with a nonsense peer
address. FreeSWITCH fell back to comfort-noise generation (`read cng`) — which
is exactly why we received well-formed RTP carrying zeros. PCM DMA counters
showed the bus clocked and running with `loss:0` in both directions; the
highway was open, the module just wasn't putting anything on it.

**Fix: reboot the gateway.** A full power cycle clears the leaked DSP channel.
After reboot, `caller-in peak` went 0 → 23932 and the call worked.

**So: if audio is silent and the config is verified, reboot before doing
anything else.** It costs a minute. Signs it's this and not a real
misconfiguration: the error appears *once* at call setup rather than
repeatedly, and the DMA counters show no loss.

Suspect a stale DSP channel after: many config applies in one session, an
earlier crashed/abandoned call, or long uptime with failed call attempts.

If a reboot does **not** fix it, escalate to Dinstar with: model AIO100-1V,
SN DD18-0515-5004-1296, firmware 1.53.5.6, GOMO on Auto/4G/FDD LTE, the three
log lines above, and the PCM peak measurements. Evidence from the working
session is kept in `backups/aio100/trace-2026-08-10/`.

## Part 6 — Code-side pitfalls already hit and fixed

Do not re-introduce these. All are in `src/pitch/`.

**SIP auth challenge is pre-parsed.** The `sip` npm module registers a parser
for `www-authenticate` / `proxy-authenticate`, so the challenge arrives as an
**object** (`{scheme, realm, nonce}`) with values still quoted — not a string.
`String()`-ing it yields `"[object Object]"`, the nonce vanishes, and
registration dies with "SIP auth challenge missing nonce". `parseAuthHeader`
in `sip/ua.js` handles both shapes and strips quotes. Sending the
`authorization` header as a plain string is fine (sip.js emits strings
verbatim); only the parse side was broken.

**OpenAI Realtime is GA — the beta interface is retired.** Sending
`OpenAI-Beta: realtime=v1` is rejected outright. GA also restructured
`session.update`: `type: "realtime"` is required, `modalities` →
`output_modalities`, and `input_audio_format`/`output_audio_format` →
`audio.input.format`/`audio.output.format` as **objects**
(`{type:"audio/pcm", rate:24000}`), with `input_audio_transcription` →
`audio.input.transcription`. Response events renamed to
`response.output_audio.delta` and `response.output_audio_transcript.done`.
The adapter accepts both old and new event names, and the `default` branch
logs unhandled types so a future rename can't silently swallow audio again.

**Symmetric RTP latching.** `rtp/session.js` latches onto the source address
of the first inbound packet even when a remote was already set from the SDP,
and emits `relatched` if they differ. Gateways often advertise one port and
transmit from another. (The AIO100 does *not* — no relatch was observed — but
the guard is cheap and one-way audio is expensive to diagnose.)

## Part 7 — Quick symptom index

| Symptom | Look here |
|---|---|
| `registration failed: 401` | Password mismatch, or extension on `lan_default` not `wan_default` |
| `registration failed: 403` | Register Source restriction, or Inbound Source Filter excludes the Mac |
| `registration failed: 408` (loop) | **macOS Local Network permission — see Part 11.** Check this BEFORE touching the gateway. Also: Mac lost Wi-Fi, or gateway genuinely unreachable |
| No registration attempt at all | Wrong port — must be 5080 |
| `SIP auth challenge missing nonce` | The pre-parsed header bug (Part 6) |
| `preflight: PITCH_SIP_PASSWORD is empty` | Set it **in `.env`**, not the shell |
| Rings, then busy, **no INVITE in log** | Inbound route missing or Source wrong |
| Rings, never answers, INVITE present | Brain failed to connect — check the error line |
| Connects, silent, `caller-in peak=0` | **Reboot the gateway** (Part 5) |
| Connects, silent, `speechOut=0` | Model produced no audio — API/session config |
| One-way audio | Check for a `relatched` warning; then Layer 4 |
| Busy signal on a fresh call | Previous call didn't clean up; restart the process |
| Pitch talks over the caller | Raise `silence_duration_ms` in `brain/openai-realtime.js` (currently 700ms, tuned for Filipino speech pauses) |

## Part 8 — What "working" looks like

Keep these as the reference readings:

```
call: from=+639175769817 codec=PCMU remote=192.168.100.200:16116
[pitch]  Magandang araw, Marga Enterprises po. Ano po ang maitutulong ko?
[caller] Hi. Kailangan ko kasi book ng hotel, na room.
[pitch]  Sige, tutulungan kita. Ano pong dates at ilang tao po ang
         kailangan ninyo para sa room?
call: ended reason=remote_bye duration=27.4s rtpIn=1248 rtpOut=1340
      speechOut=483 lost=0
recorded caller-in 24.7s peak=23932 | pitch-out 9.7s peak=28470
```

Note across three consecutive calls the greeting was **different every time** —
English, then Taglish with "po", then full Tagalog — with no language setting
anywhere. That variation is the rules working, and is worth re-checking after
any prompt change.

## Part 9 — Known gaps (update as they close)

- **Nothing is persisted.** No Conversation / Lead / AiLog rows; transcripts go
  to stdout only. Next step is the `external_id` migration: copy `psid` into
  `external_id`, swap the unique constraint to
  `[company_id, channel, external_id]`, add `contact_number` / `contact_name`.
  Mobile number — not PSID — is the identity key.
- **No tools.** Pitch cannot check availability or book anything, and is
  instructed never to claim otherwise. It will happily *discuss* a booking.
- **One concurrent call.** `PITCH_MAX_CONCURRENT_CALLS=1`; a second caller gets
  an honest 486 Busy.
- **Recording is a debug feature.** `PITCH_RECORD_DIR` writes real customer
  audio to disk. Leave it unset in production.
- ~~Gemini Live adapter~~ — **built and shipped 2026-08-10, now the default.** See Part 10.
  native speech-to-speech, so it preserves rule 1. Implement the same surface
  in `brain/` — `connect()`, `write(pcm8k)`, `greet()`, `close()`, events
  `audio` / `barge_in` / `transcript` / `error` — and set
  `PITCH_BRAIN_PROVIDER=gemini`. No call-handling code should change.
- **No launchd job.** Pitch runs manually; production needs its own job,
  separate from `com.aistaff.api`.
- **No marketing page** at `/agents/pitch/`.

---

## Part 10 — Gemini Live brain (added 2026-08-10, now the default)

`PITCH_BRAIN_PROVIDER=gemini` · `src/pitch/brain/gemini-live.js` ·
model `gemini-2.5-flash-native-audio-preview-12-2025` · voice `Aoede`.

Verified on a live cellular call: natural English and Taglish, with emotion.
Native speech-to-speech, so rule 1 survives — the model still hears the caller
and matches them; no language is ever configured.

**Measured cost: ~$0.02/min** (2 minutes of live calls = $0.04, AI Studio
Tier 1). OpenAI Realtime measured ~$0.05/min. So Gemini is ~2.5x cheaper, not
the 5x that list prices imply. Re-measure with a longer sample — the spend
page lags up to 24h.

Use the **paid tier**. On the free tier Google may use the traffic to improve
its products, which is not acceptable for real customer calls.

### Protocol differences that will bite (all found the hard way)

| | OpenAI Realtime GA | Gemini Live |
|---|---|---|
| Auth | `Authorization` header | **API key in the URL** |
| Handshake | send `session.update` any time | `setup` **first**, and you must wait for `setupComplete` before sending audio |
| Input rate | 24 kHz | **16 kHz** |
| Output rate | 24 kHz | 24 kHz |
| Audio in | `input_audio_buffer.append` | `realtimeInput.audio` + `mimeType: audio/pcm;rate=16000` |
| Audio out | `response.output_audio.delta` | `serverContent.modelTurn.parts[].inlineData.data` |
| Barge-in | `input_audio_buffer.speech_started` | `serverContent.interrupted` |
| Transcripts | whole utterances | **streaming fragments** — buffer to `turnComplete` or the log reads as confetti |
| Speak first | `response.create`, no content | **no contentless trigger exists** |

### Making it speak first

Tested and all produce NOTHING: empty `turns` array, `turnComplete` alone,
empty user `parts`, `realtimeInput.audioStreamEnd`, `activityStart/End`.
Gemini requires actual content to open a turn.

Solution: send a **fact about the call**, never words to say —
`"The call connected at 8:14 PM on a Monday."` This is not decoration:

**Gemini Live is strongly deterministic.** With identical context it returns a
byte-identical greeting on every call, even at `temperature: 1.5` (tested 4
runs at each setting). OpenAI varied naturally. Real varying context is what
restores variation — the time cue produces "Magandang gabi" in the evening and
a different opening in the morning. That is rule 2 being protected by feeding
facts, exactly as the masterplan prescribes.

### Watch for

- **Invented human names.** One bare-prompt test had it answer "this is Rina",
  which nothing configured. The production prompt's honesty section should
  prevent it. If a name appears on a real call, tighten the prompt.
- **Occasional dropped turn.** One probe run in eight returned no speech.
  Preview models churn; keep the OpenAI adapter working as a fallback.
- **`speechConfig.languageCode` exists. Never set it.** That is precisely the
  language setting this design forbids.

### Switching brains

One line in `.env` plus a restart. `call.js` never learns which brain it got.
```bash
PITCH_BRAIN_PROVIDER=gemini   # or openai
```

---

## Part 11 — macOS Local Network permission (Sequoia+)

**Symptom:** `registration failed: 408` on a loop, callers get a busy signal,
and the gateway looks dead from the shell — but the browser on the *same Mac*
loads `http://192.168.100.200` fine.

**Tell it apart from a real network fault:**

| | Local Network permission | Genuinely down |
|---|---|---|
| `ping 192.168.100.200` | **instant** `No route to host` | times out after ~1s each |
| Internet (Gemini/OpenAI) | works | usually also affected |
| Browser to the gateway | works | fails too |
| ARP entry for the gateway | present and fresh | missing/incomplete |

The instant refusal is the giveaway — the OS blocks the packet before it
leaves, so there is nothing to time out.

**Cause.** macOS 15 (Sequoia) added per-app Local Network Privacy. Every app
needs explicit permission to reach devices on the LAN. Chrome has it; the
`node` process running Pitch needs its own grant.

**Fix.** System Settings → Privacy & Security → **Local Network** → enable
`node` (or Terminal, or whatever launched Pitch).

**Then RESTART the Pitch process.** This is the part that wastes time: the
grant is applied at process launch, so a process that was already running
keeps the old blocked behaviour even after the toggle goes green. On
2026-08-10 the toggle was already on and registration still failed for 30+
minutes; a restart fixed it on the first REGISTER.

```bash
pkill -f "src/pitch/index.js"
cd "/Volumes/Wotg Drive Mike/GitHub/AIStaff" && npm run pitch
```

Expect this to recur after macOS updates, after the node binary is upgraded,
and possibly after the permission list is reset. It is not a gateway fault —
check this before touching any AIO100 setting.

**Related trap on the same machine:** Wi-Fi → Details → **Private Wi-Fi
address** was set to `Rotating`. A rotating MAC can pull a different DHCP
lease, which silently invalidates `PITCH_SIP_LOCAL_HOST` and produces
connected-but-silent calls. Set it to Fixed, or better, put the Mac Mini on
wired ethernet — it carries the RTP and is currently the weakest link in the
chain, with the AIO100 wired and the Mac on Wi-Fi.

**There is still no alerting.** On 2026-08-10 registration failed for ~35
minutes while callers got busy signals and nothing surfaced it. When the
launchd job is built, add a health check that shouts if registration fails for
more than a couple of minutes.

---

## Part 12 — SMS (added 2026-08-10, working)

Pitch can send one text per call. Verified end to end: SIP MESSAGE → gateway
→ SMS Route → GOMO → handset, arriving from the AIO100's own mobile number.

### Gateway config — Call Control → SMS Route → New

| Field | Value |
|---|---|
| Priority | `10` |
| Name | `pitch-sms-out` |
| Source | `SIP Extension / 8001` |
| Content Has the Words | blank |
| Action | `Forward` |
| Destination | **`SIM 1 / VOLTE / SMS`** (not USSD, not a SIP extension) |
| **Dest Number Src** | **`Get from To Header Field`** |
| Dest Number | blank — comes from the To header |
| **Add Prefix in Content** | **`None`** |
| Add Suffix in Content | `None` |

Two traps on this form. The New Route form defaults **Destination to SIP
Extension 8001**, which loops 8001 back to itself and never reaches the
network. And **Add Prefix defaults to `From ${from_user} :`**, which makes
every customer text start with "From 8001 :" and eats the 170-char budget.

`Dest Number Src = Get from To Header Field` is the setting that makes this
per-call: the code puts the recipient in the SIP To header, so Pitch texts
whoever it just spoke to rather than one number fixed on the gateway.

Test the SIM independently first via **Call Control → SMS** (web form) before
blaming code — that proves GOMO permits outbound SMS on this plan at all.

### Code

- `sip/ua.js` → `sendMessage(toNumber, text)` sends a SIP MESSAGE with digest
  auth retry, same as REGISTER. Resolves on 2xx (the gateway returns **202
  Accepted**), rejects otherwise, 15s timeout.
- `tools.js` → declaration + execution. **All guardrails live here, in code:**
  one SMS per call (`PITCH_SMS_MAX_PER_CALL`), 170-char limit enforced rather
  than silently truncated, recipient must contain 7+ digits, defaults to the
  verified caller ID from the INVITE.
- `brain/gemini-live.js` → `tools` in `setup`, `toolCall` → `tool_call` event,
  `toolResult()` sends `toolResponse.functionResponses`.
- `call.js` → wires execution, holds `toolState` for per-call limits.
- `prompt.js` → `smsEnabled` adds a **principles** section: only after the
  caller agrees, model writes the wording in the call's language, one per call.

`PITCH_SMS_ENABLED` defaults to **false**. Something that costs money and
reaches real people must never switch itself on.

### Design rule this follows

The tool takes the message the MODEL composed and returns `{sent: true}` —
facts, never words to speak. A Taglish call produces a Taglish text with no
template anywhere. Same principle as `assess_ai_fit` in
`docs/handoff-masterplan.md`.

Prompt instructions are requests; code checks are guarantees. The consent rule
currently lives in the prompt only — if the model ever texts someone who did
not agree, move that check into `tools.js` too.

### Open

- **Sender ID is a raw mobile number.** A text from an unknown 09xx number
  claiming to be a business looks exactly like a scam text. Mitigate by naming
  the business in the body (the model usually does) and saying on the call
  that a text is coming.
- **202 Accepted ≠ delivered.** The gateway acknowledges; the carrier may
  still drop it. There is no delivery receipt wired up.
- **Check what GOMO charges per SMS.** "Unlimited" plans usually mean calls,
  with SMS metered separately — this is a per-message cost that does not
  appear in the Gemini bill.

---

## Part 13 — SMS replies (added 2026-08-11)

Pitch answers texts the customer sent first. Inbound MESSAGE → `sms` event →
`sms-agent.js` → Gemini **text** model → reply back out via `ua.sendMessage`.

### Gateway — the second SMS Route

| Field | Value |
|---|---|
| Priority | `20` (10 is taken by `pitch-sms-out`) |
| Name | `sms-in-to-pitch` |
| Source | **`SIM 1 / VOLTE / SMS`** |
| Destination | **`SIP Extension / 8001`** |
| Prefix / Suffix | `None` / `None` |

Priority never matters between these two — they have different Sources, so
they cannot compete for the same message.

**The gateway's Receive List shows inbound texts as "unread" forever.** That is
its own web-UI flag and says nothing about whether Pitch got the message. Check
the Pitch log, not that column.

### Why a text model, not Gemini Live

Live is a speech-to-speech session billed at audio rates. Using it for typed
messages would be slow and absurdly expensive. SMS uses a plain
`generateContent` call.

**Model choice matters more than expected.** Measured on a real Taglish
message:

| Model | Result |
|---|---|
| `gemini-2.5-flash` | **fails** — closed to new accounts, runtime error |
| `gemini-flash-latest` | returned `*Tone:*` — spent the budget reasoning |
| `gemini-3.6-flash` | truncated mid-word at 16 chars |
| **`gemini-3.5-flash-lite`** | **940ms, 117 chars, clean Taglish with "po"** |

Newer models burn output tokens on internal reasoning before writing, which
truncates a short SMS. `maxOutputTokens` is 400 for headroom. If replies come
back empty or clipped, suspect the model before the code.

### Guardrails — all in code, none in the prompt

- 2 replies per inbound message, 2 per call (`PITCH_SMS_MAX_PER_INBOUND`,
  `PITCH_SMS_MAX_PER_CALL`)
- Uncapped genuine back-and-forth, but a **loop guard**: 4 rapid exchanges
  under 4s apart stops it. This is for auto-responders on the other end, which
  would otherwise ping-pong all night and look exactly like spam to the carrier.
- 30 messages per number per day
- Quiet hours 21:00–07:00 Asia/Manila
- Stop words in both languages (`stop`, `tigil`, `ayaw`, `huwag`, `wag na`…)
  are absolute and need no model call
- On the last allowed reply the model is told to say so **in its own words**
  and invite a call — because after the cap we cannot text to explain the cap

### Known limits

- **State is in memory.** A restart forgets every thread. Pitch cannot link a
  text to a call from the same number, and cannot greet anyone by name. Both
  need the `external_id` migration.
- **Reply-only.** Proactive sending (appointment reminders) is deliberately
  not built yet. Broadcast to a list must never run on a consumer SIM — that
  is the pattern that gets a SIM throttled or disconnected, which would take
  the client's phone line down with it.

---

## Part 14 — Running Pitch as a service (launchd)

`com.aistaff.pitch` · wrapper `~/.aistaff-launchd/start-aistaff-pitch.sh` ·
logs `~/Library/Logs/AIStaff/pitch.launchd.log` (+ `.err.log`).

Verified 2026-08-11: `kill -9` on the process, back and registered 30s later.

```bash
launchctl list | grep pitch                       # 0 = healthy, 2 = failing
tail -f ~/Library/Logs/AIStaff/pitch.launchd.log  # watch calls live
launchctl unload ~/Library/LaunchAgents/com.aistaff.pitch.plist   # really stop
launchctl load   ~/Library/LaunchAgents/com.aistaff.pitch.plist
```

`pkill` no longer stops Pitch — KeepAlive brings it straight back. Unload it.

### THE TRAP: launchd's bash cannot read the external drive

**Symptom:** the service exits with status 2 and the error log shows
```
shell-init: error retrieving current directory: getcwd: ... Operation not permitted
grep: .env: Operation not permitted
```

**Cause:** macOS TCC. A `/bin/bash` spawned by launchd has no permission for
removable volumes, so anything under `/Volumes/...` is unreadable to it.
`node` *does* have the grant. This is why `start-aistaff-api.sh` works — its
bash only `cd`s and `exec`s, and node performs every file read.

**Rules for any new service on this Mac (they all live on the Wotg drive):**

1. **The wrapper must never read a file on the volume.** No `grep .env`, no
   `cat`, no `source`. Only `cd` then `exec node`. Let node read `.env` itself
   via dotenv.
2. **`WorkingDirectory` in the plist must be `/Users/mike`,** not the volume.
   launchd chdir's before the process exists and fails on a removable volume.
   The script does its own `cd`. (Every `com.marga.*` service follows this;
   `com.aistaff.api` points at the volume and survives only by historical
   accident — do not copy it.)
3. **Wait for the dependency in the wrapper, then `exec`.** The API waits for
   `pg_isready`; Pitch pings the gateway (up to 180s). Anything network-bound
   needs this or launchd thrashes on KeepAlive at boot.
4. **`ThrottleInterval` 30** so a genuinely broken config retries calmly
   instead of hammering.
5. Absolute paths everywhere — `/opt/homebrew/bin/node`, not `node`. launchd
   has almost no PATH; set it in `EnvironmentVariables`.

The gateway-ping wait also covers the Mac booting onto the wrong Wi-Fi: Pitch
waits rather than crash-looping, and KeepAlive retries until the network is
right.

### Still missing: alerting

launchd restarts a *crashed* process. A Pitch that is running fine but cannot
reach the gateway looks healthy to launchd and gives every caller a busy
signal. On 2026-08-10/11 that happened three times (Local Network permission,
dropped Wi-Fi association, roamed to the wrong SSID) and each was found only
because someone tried a call.
