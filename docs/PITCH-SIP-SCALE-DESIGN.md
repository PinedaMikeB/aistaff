# Pitch at scale — SIP architecture for 1,000+ tenants

Design, 24 Aug 2026. Read this before writing any telephony code.

---

## The decision that matters

**Do not write a SIP registrar.** RFC 3261 registration, digest auth, NAT
keepalive, TLS, re-INVITE, DoS resistance and fork handling are years of
hardened work in Asterisk, FreeSWITCH and Kamailio. A hand-rolled one fails in
ways that take clients' phone lines down at 2am.

Asterisk owns SIP. Pitch becomes a **media application** behind it — which is
what it already is, minus the SIP client bolted on the front.

---

## Target shape

```
  CLIENT PREMISES                    YOUR INFRASTRUCTURE
  ┌────────────────┐
  │ AIO100 + SIM   │   REGISTER      ┌──────────────────────┐
  │                │ ───outbound────►│ Asterisk             │
  │ customer dials │    TLS 5061     │  · registrar         │
  │ their existing │                 │  · per-tenant auth   │
  │ mobile number  │ ─── INVITE ────►│  · PJSIP realtime    │
  └────────────────┘                 └──────────┬───────────┘
   nothing to configure                         │ AudioSocket
   on their router                              │ TCP, 8 kHz slin
                                                ▼
                                     ┌──────────────────────┐
                                     │ Pitch media service  │
                                     │  · N concurrent calls│
                                     │  · tenant resolution │
                                     │  · whisper/brain/TTS │
                                     └──────────────────────┘
```

**Why outbound registration solves everything.** The AIO100 dials out to you,
so the client's router keeps a pinhole open for the replies. You never reach
into their network, they configure nothing, and their existing mobile number
keeps working. Confirmed available: Trunk / VoLTE / Edit → Register to SIP
Server = On, with Master/Slave servers, Username, Auth Username, Password,
Expire 1800s, Retry 60s.

---

## Tenant identity: Auth Username

Not the SIM, not the serial.

| Candidate | Why not |
|---|---|
| SIM number | changes on carrier switch, damage, replacement |
| Device serial | tied to hardware; dies with an RMA |
| Source IP | changes whenever their ISP feels like it |
| **Auth Username** | **you issue it, you control it, it survives everything** |

It also works unchanged if a client later moves from a gateway to a SIP trunk,
so the device table never needs migrating.

Format: `t{company_short}-{seq}` e.g. `t4f2a-01`. Opaque, no PII, no guessable
sequence across tenants.

---

## Why Asterisk over the alternatives

| | Asterisk | FreeSWITCH | Kamailio |
|---|---|---|---|
| Registrar | yes | yes | yes |
| Media handling | built in | built in | **none** (needs RTPengine + media server) |
| External audio app | AudioSocket, ARI ExternalMedia | mod_audio_fork | n/a |
| Concurrent calls, one box | ~500–1,000 | ~2,000+ | 10,000+ signalling only |
| Operational complexity | low | medium | high |

Peak concurrency for 1,000 tenants is roughly 130 calls (see capacity below).
Asterisk handles that on one machine with room to spare, and AudioSocket is
purpose-built for exactly what Pitch needs. Kamailio is the right answer at
10,000 tenants, not 1,000 — and it can be put in front later without changing
Pitch at all.

---

## Capacity, honestly

Assume 1,000 tenants, ~20 calls/day each, ~4 min average, over a 10-hour day:

- 80,000 call-minutes/day → **~133 concurrent at average**
- realistic peak (clustering) → **~250–350 concurrent**

That is the number that sizes everything:

| Component | At 300 concurrent |
|---|---|
| Asterisk signalling + RTP | one 8-core VM, comfortable |
| Whisper (500 ms/turn, ~30% duty) | ~90 parallel transcriptions — **needs GPU or a whisper farm** |
| Piper (RTF 0.035, ~45% duty) | ~5 parallel streams — trivial, CPU is fine |
| Gemini Flash Lite | elastic, no capacity concern |

**Whisper is the bottleneck, not TTS and not SIP.** Plan for a horizontally
scaled STT tier well before 1,000 tenants — this is the piece that forces real
hardware.

---

## Provisioning: PJSIP realtime

Asterisk can read endpoints, auths and AORs straight from PostgreSQL. Adding a
client becomes a database insert — no config file to regenerate, no reload, no
SSH. That is what makes 1,000 tenants operationally possible.

Asterisk owns these tables and their column names are fixed by Asterisk:
`ps_endpoints`, `ps_auths`, `ps_aors`, `ps_contacts`.

**Do not put business data in them.** They are Asterisk's schema and Asterisk
will migrate them on upgrade. Instead:

```
Company ──1:N── SipDevice ──1:1── ps_endpoint / ps_auth / ps_aor
                    │                    (Asterisk's own tables)
                    │
              our source of truth:
              serial, SIM, status, company_id,
              label, shipped_at, last_seen_at
```

`SipDevice` is ours and holds everything the business cares about. A small
sync writes the three Asterisk rows when a device is created or its password
rotates. If Asterisk's schema changes, only the sync changes.

---

## Concurrency: the blocker in today's code

`src/pitch/index.js:18` — `let activeCall = null`. A second concurrent call is
rejected with `486 Busy Here`. That is one call for the **entire platform**,
not one per tenant.

Everything call-scoped has to move off module globals and into a per-call
object keyed by call ID:

- `activeCall` → `Map<callId, Call>`
- brain instance, VAD buffers, RTP session, prompt, tenant context — all per call
- the whisper and TTS HTTP clients stay shared and stateless

This refactor is required regardless of which SIP stack is chosen, and it is
independent of Asterisk. **Do it first** — it can be tested on the existing
single-gateway setup before any registrar exists.

---

## Migration path, in the order that de-risks

**Phase 0 — foundations (no new infrastructure)**
1. `SipDevice` model + tenant resolver keyed on auth username
2. Per-call refactor of Pitch; verify two simultaneous calls on the current box
3. Channel-scoped knowledge base (`both | closer | pitch`)

**Phase 1 — one remote client**
4. Asterisk on a public VM, PJSIP realtime against the existing Postgres
5. TLS on 5061 with a real certificate; SIP over UDP through consumer routers
   is fragile and gets blocked by ALGs
6. AudioSocket bridge: Asterisk dialplan → Pitch, one TCP connection per call
7. Prove it with a **second** AIO100 on a different network — a friend's shop
   or a phone hotspot. Re-proving the LAN case teaches nothing.

**Phase 2 — operations**
8. Provisioning UI: create device, issue credentials, print a config sheet
9. Registration monitoring + alerting (a client's line dying silently is the
   worst failure mode; today it logged for two weeks unnoticed)
10. Master/Slave registrar for failover — the AIO100 already supports it

**Phase 3 — scale**
11. Whisper tier horizontally scaled, GPU-backed
12. Kamailio in front only if Asterisk signalling becomes the limit

---

## What must not be skipped

- **TLS + SRTP.** Unencrypted SIP over the public internet exposes credentials
  and call audio. Also stops SIP ALGs mangling packets.
- **Fail2ban or equivalent.** A public 5060 gets brute-forced within hours.
  Every Asterisk on the internet is scanned continuously.
- **Rate limiting per endpoint.** One compromised client credential must not
  become toll fraud on your account.
- **Per-tenant call caps.** Enforced server-side, matching their plan.

---

## Open decisions for Mike

1. **Where does Asterisk run?** A Manila VPS keeps latency low for PH callers.
   Needs a static IP and a real domain.
2. **What tier caps concurrent calls?** The pricing conversation assumed one
   line per box; server-side enforcement should match whatever is sold.
3. **Who is on call when registration drops at 2am?** At fifty clients this
   stops being a hobby.
