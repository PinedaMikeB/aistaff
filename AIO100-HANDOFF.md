# AIO100-1V Voice Gateway — Handoff (2026-08-08)

## Device
- Model: AIO100-1V (Dinstar) — LTE/VoLTE only. No FXS, no FXO, no WiFi.
- SN: DD18-0515-5004-1296 | Hardware ID: D3 67 04 44 1B 31 1C 2A
- Firmware: 1.53.5.6 (2021-11-16) — OLD. Request latest from Dinstar support if VoLTE fails.
- Capacity: 32 SIP extensions, 8 concurrent calls.
- Codecs available: PCMA (G.711A), PCMU, G729, G723. No G.722.
- Power: 12VDC 1A. Antenna attached. RST button 6-12s = factory reset.

## Network — DONE and APPLIED
- WAN: STATIC 192.168.100.200 / 255.255.255.0 / GW 192.168.100.1
  - DNS: 192.168.100.1 primary, 1.1.1.1 alternate
  - Cabled: Converge router LAN port -> AIO100 WAN port
- LAN: 192.168.11.1 (static, DHCP server pool from .99) — config backdoor, needs physical cable
- Network Model: Route (NOT bridge)
- MAC WAN: F8-A0-3D-59-77-2E | MAC LAN: F8-A0-3D-59-77-2D
- Web UI: http://192.168.100.200 — admin / password CHANGED from default (was admin@123#)
- NOTE: "Restart Network" was required after Apply. Confirm it was clicked.

## SIP ports — IMPORTANT
- Profile `lan_default` listens 192.168.11.1:5060
- Profile `wan_default` listens :5080  <-- USE THIS
  Register softphone / agent to 192.168.100.200:5080
- RTP range: 16000-16200 (Call Control -> Setting)
- Verified open on WAN side: tcp/80, tcp/443, tcp/5080

## Mac Mini context
- en0 = built-in ethernet -> Converge router, 192.168.100.65
- en8 = USB eth adapter -> AIO100 LAN, pulled 192.168.11.144 by DHCP
- en1 = WiFi
- ISSUE: en8 holds a default route to 192.168.11.1 (dead end, no internet behind it).
  Fix: set en8 IPv4 Manual 192.168.11.2 / 255.255.255.0 with ROUTER FIELD EMPTY,
  or just unplug the LAN cable. Otherwise risks odd routing for Postgres /
  Cloudflare Tunnel / 9100 / 9200 services.

## REMAINING STEPS
1. Verify: ping -c 3 192.168.100.200  (should reply)
2. Network -> Access Control: uncheck "Allow WAN access" for Telnet and SSH
3. Extension -> SIP: create ext 8001
   - strong password, DID 8001
   - Register Source = Specified, 192.168.100.0/24
   - SIP Profile = 2-<wan_default>
   - Status = Enable
4. Profile -> SIP (edit wan_default):
   - DTMF Type = RFC2833, RFC2833-PT = 101
   - Allow Unknown Call = Off
   - Inbound Source Filter = 192.168.100.0/24
5. POWER OFF. Insert SIM. Power on. (Never hot-insert — can wedge the module.)
   - SIM LED slow flash (every 4s) = module/SIM NOT detected
   - SIM LED fast flash (every 2s) = SIM inserted AND registered  <-- want this
6. Trunk -> LTE:
   - Register to SIP Server = OFF (box is the SIP server, not a client)
   - Set Band Type, click Refresh on Carrier
   - PIN Code only if SIM is PIN-locked (3 wrong attempts = PUK lock)
   - Status = Enable
7. Call Control -> Route: TWO rules required
   - Inbound:  Source = GSM trunk           -> Destination = SIP Extension / 8001
   - Outbound: Source = SIP Extension / 8001 -> Destination = GSM trunk
   MISSING ONE = silent one-way failure. Most common cause of "registers but no calls."
8. Test with a softphone (extension-to-extension first, then real call) BEFORE
   wiring the AI agent stack.

## Diagnostics
- Status -> Overview: SIM card state, carrier, signal
- Status -> PSTN: GSM channel state, SIP register status, talking state
- Status -> SIP: profile / trunk / extension registration state
- Call Control -> Diagnostics: call trace (tick SIP Message + GSM/LTE), then export
- System -> Diagnostics: module health check
- System -> Command Line: gsm status, gsm oper, sip status

## Known risks
- VoLTE is the #1 risk. PH carriers shut down most 3G. Module must support VoLTE on
  B3/B28 (Globe + Smart) and B41 (Smart). If SIM attaches but calls fail:
  firmware update first, then try the other carrier's SIM to isolate.
- Do NOT port-forward 5060/5080/RTP to the internet. Toll fraud on a live SIM = real bill.
- NTC treats bulk third-party call termination over GSM gateways as SIM-boxing.
  Own SIMs for own business calls is fine.
- Converge DHCP pool may be wide; .200 was verified free but consider narrowing the
  pool to .2-.150 in the router so nothing collides later.

## Next phase
Point extension 8001 at the AI voice agent stack (Gemini Live API: STT + LLM + TTS).
Hard ceiling: 8 concurrent calls on this hardware. Plan pricing/capacity around that.
