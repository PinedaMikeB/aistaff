# Pitch — Voice Agent Setup (Phase 1 vertical slice)

Goal: **call the GOMO SIM in the AIO100 and have Pitch answer, adapting to
whatever language you speak.**

## Architecture

```
your phone -> GOMO/LTE -> AIO100 VoLTE trunk
   -> inbound route -> SIP extension 8001
   -> Pitch (Node process on the Mac Mini)
   -> OpenAI Realtime (speech-to-speech)
   -> back down the same path
```

No Asterisk or FreeSWITCH. The AIO100 has a built-in SIP server (32
extensions), which is enough for one channel. A softswitch goes in later when
we need concurrency or transfer trees.

## Language is not configured anywhere

There is no language setting, no locale, no Taglish flag. `src/pitch/prompt.js`
tells the model to match the caller and switch mid-call if they switch. Adding
a language env var would be a regression — see `docs/handoff-masterplan.md`.

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
PITCH_SIP_PASSWORD=<the extension password from Step 1>
PITCH_SIP_LOCAL_HOST=192.168.100.72   # verify with: ipconfig getifaddr en1
PITCH_BUSINESS_NAME=Marga Enterprises # or whichever business is answering
```

`PITCH_SIP_LOCAL_HOST` must be the LAN IP. If it is `127.0.0.1` the gateway
has nowhere to send RTP and you get a connected call with total silence.

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
- **No tools.** Pitch cannot check availability or book anything yet. It is
  instructed to never claim otherwise.
- **Gateway is on WiFi.** Latency measured 84ms with 50% packet loss during
  setup, versus 3.6ms two days earlier. Move the AIO100 to wired ethernet
  before judging call quality.
