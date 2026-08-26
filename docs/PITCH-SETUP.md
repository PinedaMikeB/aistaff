# Pitch — Voice Agent Setup (Phase 1 vertical slice)

Goal: **call the GOMO SIM in the AIO100 and have Pitch answer, adapting to
whatever language you speak.**

## Architecture

```
your phone -> GOMO/LTE -> AIO100 VoLTE trunk
   -> inbound route -> SIP extension 8001
   -> Pitch (Node process on the Mac Mini)
   -> selected brain provider
   -> back down the same path
```

No Asterisk or FreeSWITCH. The AIO100 has a built-in SIP server (32
extensions), which is enough for one channel. A softswitch goes in later when
we need concurrency or transfer trees.

## Language is not configured anywhere

There is no language setting, no locale, no Taglish flag. `src/pitch/prompt.js`
tells the model to match the caller and switch mid-call if they switch. Adding
a language env var would be a regression — see `docs/handoff-masterplan.md`.

## Brain provider switch

Pitch now supports two production-useful voice paths:

| Provider | Env | Path | Use |
|---|---|---|---|
| Gemini Live | `PITCH_BRAIN_PROVIDER=gemini` | Gemini native audio in/out | Known-good fallback. Use this whenever the local stack is unhealthy. |
| Local pipeline | `PITCH_BRAIN_PROVIDER=local` | whisper.cpp/VAD -> Gemini text -> VoxCPM2 TTS | Experimental/local voice path. Requires local Whisper and VoxCPM2 services. |

Switching is deliberately an env change plus process restart, not a runtime
toggle inside a live call. A broken local TTS/STT chain should never leave the
caller waiting while Pitch tries to rebuild itself mid-conversation.

Gemini Live and local pipeline use separate settings. Do not edit
`PITCH_GEMINI_LIVE_MODEL` or `PITCH_GEMINI_VOICE` when experimenting locally;
switch only `PITCH_BRAIN_PROVIDER`.

Product positioning:

- **Support tier:** use `local`. This is the cost-control path for daily
  repetitive support calls. The target is short turns, fast enough latency, and
  acceptable warmth.
- **Prestige tier:** use `gemini`. This is the premium path for accounts that
  pay for the smoothest interruption handling, pacing, and emotional voice
  quality.

---

## Step 1 — AIO100: create the extension

Web UI at `http://192.168.100.200` -> **Extension -> SIP -> New**

| Field | Value |
|---|---|
| Name | Pitch |
| Extension | `8001` |
| Password | pick a strong one, put it in `.env` |
| DID | leave **blank** (a DID bypasses routing entirely) |
| Register Source | Any (tighten to `192.168.100.0/24` once working) |
| NAT | Off (same LAN) |
| SIP Profile | **2 - wan_default** |
| Status | Enable |

`wan_default` listens on **5080**, not 5060. That is the single most common
mistake here.

## Step 2 — AIO100: SIP profile

**Profile -> SIP -> wan_default (index 2)**

- DTMF Type: `RFC2833`, RFC2833-PT `101`
- Allow Unknown Call: **Off**
- Inbound Source Filter: `192.168.100.0/24`
- Detect Extension is Online: **On**
- Local Listening Port: `5080`

## Step 3 — AIO100: LTE trunk

**Trunk -> LTE**

- **Register to SIP Server: OFF** — the SIM is the trunk, it must not try to
  register anywhere.
- Band Type: **All** (it currently reports `GSM850_EGSM_DCS_PCS_MODE`, which is
  2G-only; leaving it there will eventually drop you off LTE)
- Extension: `8002` (distinct from Pitch's 8001)
- Autodial Number: leave blank — use a route instead, so there is one
  mechanism to debug rather than two.

## Step 4 — AIO100: inbound route

**Call Control -> Route -> New**

| Field | Value |
|---|---|
| Priority | `10` |
| Name | `lte-in-to-pitch` |
| Source | GSM/LTE trunk |
| Called Number Prefix | leave blank (match all) |
| Destination | SIP Extension / 8001 |

Higher number = **lower** priority on this device.

Click **Apply** in the orange unsaved-changes bar. Config does not take effect
until you do.

## Step 5 — `.env`

```bash
PITCH_ENABLED=true
PITCH_BRAIN_PROVIDER=gemini
PITCH_SIP_PASSWORD=<the extension password from Step 1>
PITCH_SIP_LOCAL_HOST=192.168.100.72   # verify with: ipconfig getifaddr en1
PITCH_BUSINESS_NAME=Marga Enterprises # or whichever business is answering
```

`PITCH_SIP_LOCAL_HOST` must be the LAN IP. If it is `127.0.0.1` the gateway
has nowhere to send RTP and you get a connected call with total silence.

For the local pipeline instead:

```bash
PITCH_BRAIN_PROVIDER=local
PITCH_LOCAL_WHISPER_URL=http://127.0.0.1:8080/inference
PITCH_LOCAL_WHISPER_MODEL=ggml-base
PITCH_LOCAL_GEMINI_TEXT_MODEL=gemini-3.5-flash-lite
PITCH_VOXCPM2_URL=http://127.0.0.1:9880/tts
PITCH_VOXCPM2_SAMPLE_RATE=24000
VOXCPM2_DEVICE=mps
PITCH_LOCAL_TEMPERATURE=0.75
PITCH_LOCAL_MAX_OUTPUT_TOKENS=120
PITCH_LOCAL_HISTORY_TURNS=6
PITCH_LOCAL_LOG_METRICS=true
PITCH_LOCAL_VAD_THRESHOLD=650
PITCH_LOCAL_VAD_SILENCE_MS=700
PITCH_LOCAL_VAD_MIN_SPEECH_MS=260
PITCH_LOCAL_VAD_MAX_SPEECH_MS=12000
```

The VoxCPM2 endpoint may return raw WAV/PCM bytes or JSON containing
`audio_base64`/`audio` plus an optional `sample_rate`. If your local wrapper
uses a different route, keep the code unchanged and point `PITCH_VOXCPM2_URL`
at that route.

Start the local services in separate terminals before switching Pitch:

```bash
scripts/start-local-whisper.sh
scripts/start-local-voxcpm2.sh
```

Both scripts keep heavy files under `local-runtime/` on the external drive.
The VoxCPM2 launcher defaults to `VOXCPM2_DEVICE=mps` for Apple Silicon/Metal,
with CUDA unused on the Mac Mini.

Local pipeline experiment knobs:

| Env | What to tune |
|---|---|
| `PITCH_LOCAL_VAD_THRESHOLD` | Higher ignores noise; lower catches quiet callers faster. |
| `PITCH_LOCAL_VAD_SILENCE_MS` | Lower responds faster; higher avoids cutting off Filipino mid-thought pauses. |
| `PITCH_LOCAL_MAX_OUTPUT_TOKENS` | Lower keeps replies short and cheap; too low can sound abrupt. |
| `PITCH_LOCAL_HISTORY_TURNS` | Lower reduces cost/latency; higher remembers more context. |
| `PITCH_LOCAL_TEMPERATURE` | Lower is steadier; higher can sound more natural but less controlled. |
| `PITCH_VOXCPM2_VOICE` | Voice/emotion preset if the local wrapper supports one. |

When `PITCH_LOCAL_LOG_METRICS=true`, each local turn logs approximate stage
timing and token/word counts:

```text
local-pipeline: audio=1420ms whisper=610ms gemini=430ms tts=520ms total=1560ms inTok~920 outTok~36 words=24
```

Use those numbers to tune. If `whisper` dominates, use a smaller/local model
or shorter VAD segments. If `tts` dominates, tune VoxCPM2. If `gemini`
dominates, reduce history/output tokens.

## Step 6 — run

```bash
npm run pitch
```

Expected:

```
[pitch:info] starting — extension 8001 -> 192.168.100.200:5080 ...
[pitch:info] registered as extension 8001 — ready for calls
```

Confirm on the gateway: **Status -> SIP**, SIP Extension 8001 should read
`Registered`.

Then call the GOMO number from your mobile.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `registration failed: 401` | Wrong password, or extension is on `lan_default` instead of `wan_default` |
| `registration failed: 403` | Register Source restriction, or extension disabled |
| No registration attempt at all | Wrong port — must be 5080 for wan_default |
| Phone rings, Pitch never answers | Inbound route missing or pointing elsewhere |
| Call connects, total silence | `PITCH_SIP_LOCAL_HOST` wrong, or macOS firewall blocking UDP 40000-40100 |
| One-way audio only | Asymmetric RTP — check the gateway is not behind its own NAT |
| Busy signal | A previous call did not clean up; restart the process |
| Pitch talks over you | Raise `silence_duration_ms` in `brain/openai-realtime.js` |
| Local pipeline rejects calls | Check `GEMINI_API_KEY`, `PITCH_LOCAL_WHISPER_URL`, and `PITCH_VOXCPM2_URL`; switch back to `PITCH_BRAIN_PROVIDER=gemini` while fixing it |

Log line `rtpIn=` / `rtpOut=` at the end of each call tells you whether media
flowed in each direction. Both should be roughly `duration_seconds * 50`.

## Known constraints

- **One concurrent call.** `PITCH_MAX_CONCURRENT_CALLS=1`. A second caller
  gets a genuine busy signal. Assume one VoLTE module is one channel until
  tested otherwise.
- **Nothing is persisted yet.** No `Conversation`, `Lead`, or `AiLog` rows.
  Transcripts are logged to stdout only. That is deliberate for Phase 1 —
  writing voice calls into the CRM needs the `Conversation.psid` decision
  resolved first (it is currently required and uniquely constrained, and a
  phone call has no PSID).
- **No booking tools.** Pitch cannot check availability or book anything yet.
  It is instructed to never claim otherwise. Gemini Live can use the SMS tool;
  the local text pipeline does not advertise function tools yet.
- **Gateway is on WiFi.** Latency measured 84ms with 50% packet loss during
  setup, versus 3.6ms two days earlier. Move the AIO100 to wired ethernet
  before judging call quality.
