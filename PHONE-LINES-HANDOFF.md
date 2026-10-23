# Phone Lines (Pitch routers) — HANDOFF

Built 2026-10-21 in the preview copy `/srv/apps/aistaff-phonelines` (Ryzen), port 3177, background jobs OFF.
Not merged into live `/srv/apps/aistaff` yet. **Not connected to Pitch yet** (on purpose).

## What it does (dual mode)

| Who | Where | What |
| --- | --- | --- |
| AIStaff staff (admin, manager) | Platform › Phone Lines | Add router (model, serial, SIM, carrier, phone number, router address) → private SIP login is generated → Assign to a customer → handoff kit with one-time setup code (copy / print / new code) → suspend, resume, unassign, mark returned → view SIP login (audited) |
| Tenant admin (or staff in Assist) | Settings › Channels › Mobile Phone | 1 Enter setup code → 2 Plug in + Check connection → 3 Personalise (assistant name e.g. Marie, greeting, voice, business hours, after-hours, extra phone instructions) → 4 Allowed actions (SMS, booking, service requests, alert contact) → 5 Test & go live (locked until Pitch is connected) |

## Files

- `prisma/schema.prisma` — `SipDevice` model (`sip_devices`), `Company.sip_devices`
- `prisma/migrations/20261021163000_sip_devices/` — **already applied to the production DB** (additive only; the auto-diff also wanted to drop `leads_company_id_lead_qualification_status_idx`, which was removed from the migration on purpose)
- `src/routes/phone-lines.js` — platform router + tenant helpers (setup codes, reachability check, approved voices)
- `src/routes/channels.js` — Mobile Phone card data, `POST /mobile_phone/claim`, `POST /mobile_phone/check`, `PUT /mobile_phone` with `pitch` settings (stored in `tenant_channels.config.pitch`)
- `src/server.js` — mounts `/api/platform/phone-lines`; `me.can.phoneLines`; **`APP_BACKGROUND_JOBS=off` switch** wrapping all timers (default on)
- `src/platform-roles.js` — new permission `phonelines.manage` (admin, manager)
- `public/phone-lines-admin.js`, `public/platform.js`, `public/channels-settings.js`, `public/index.html`, `public/style.css`
- `scripts/phone-lines-e2e.js` — 15-check end-to-end test (uses `testcompany`, cleans up after itself). Run: `node scripts/phone-lines-e2e.js` while the preview runs.

## Run the preview

`~/preview-phonelines.sh` on the Ryzen (restarts it on 3177). From the Mac: `ssh -fN -L 3177:127.0.0.1:3177 aistaff`, then open http://localhost:3177/admin (login cookies need localhost or https).

## Merge to live (not done)

1. Copy the files above from the preview into `/srv/apps/aistaff` (do NOT copy the preview `.env`).
2. `npx prisma generate` in live (migration is already applied).
3. Restart `aistaff-api` (`systemctl --user restart aistaff-api`).
4. Run `scripts/phone-lines-e2e.js` against live port 3000 (change BASE) or test by hand.

## Manual steps still required (to remove next)

- **Pitch does not read these settings yet.** Live Pitch (Bosgame) still uses `PITCH_COMPANY_ID` / `PITCH_BUSINESS_NAME` in its `.env` and AI Studio's single agent name. Next step: Pitch resolves the company per router via `sip_devices.auth_username` (already designed in `src/pitch/tenant.js`) and reads `tenant_channels.config.pitch` for agent name, greeting, voice, hours, allowed actions; then "Test call" and "Go live" unlock.
- **Approved voices list is in code** (`APPROVED_VOICES` in `src/routes/phone-lines.js`). Should become an AI Studio (platform) setting.
- **Router configuration is by hand:** the installer types the SIP login into the router's web page. Later: provisioning from the panel.
- **Connection check** pings the router address from the Ryzen; for routers at a customer's site this becomes "registered to AIStaff's SIP server" once Pitch/Asterisk is connected.
- **"Create service requests"** is saved as a permission, but Pitch has no service-ticket tool yet (Closer's Marga service-request action must be shared with Pitch).

## Update 2026-10-21 (later)

- **Router location:** `sip_devices.location` = `aistaff` (hosted and managed at AIStaff, default and recommended) or `customer` (at the customer's site). Migration `20261021173000_sip_device_location` applied (additive column).
  - Hosted: the customer skips the plug-in step; the kit and email say "nothing to install"; AIStaff staff run **Check connection** from Platform › Phone Lines.
  - Customer site: the customer plugs in and checks the connection themselves.
- **Email to customer** button on the handoff kit: suggests the tenant's admin users and alert contacts (editable), sends the code, the steps, and a direct link to Settings › Channels › Mobile Phone through the existing tenant mailer (`sendNotification`). Audited.
- The Mobile Phone card shows the same guidance ("How setup works") before the code is entered.
- Hosted-routers checklist for later: SIM registered in the client's business name; signal at AIStaff's site; UPS and failover cover all hosted lines.

## Update 2026-10-21 evening — Pitch connected to tenant settings (LIVE)

- **Pitch (Bosgame `/srv/apps/aistaff/src/pitch`)** now finds the line's tenant by the router it registers to: `sip_devices.gateway_host = PITCH_SIP_GATEWAY_HOST` with `claimed_at` set (`tenant.js resolveByGateway`, 10 s cache). It uses that tenant's business name, knowledge base, and `tenant_channels.config.pitch`: agent name, greeting, hours, after-hours, allow_sms/allow_booking, extra instructions, ASR hint words. No claimed line means the old behaviour (PITCH_COMPANY_ID + AI Studio).
- **Test mode / Go live:** until the tenant presses Go live (`tenant_channels.enabled`), only their test numbers (`pitch.test_numbers`) are answered; other callers get SIP 480. Go live sets `sip_devices.status = active`; Pause sets it back to `assigned`.
- **Last call** on the line: Pitch writes `sip_devices.last_call_*` (migration `20261021180000_sip_device_last_call`), shown in step 5.
- **ASR hint words per tenant:** "Words callers often say" in step 3, with "Suggest from my knowledge base" (non-dictionary words and model numbers from the KB). Pitch sends AI Studio's global ASR context plus the tenant's words on every Qwen3-ASR request.
- **Knowledge budget on the Bosgame:** `KB_PROMPT_BUDGET_CHARS=36000` and `PITCH_KB_MAX_CHARS=36000` (both were 0, so Anne had no Marga knowledge). A bigger prompt means a slower first reply; measure. TODO (dual mode): make this an AI Studio control, and consider per-question retrieval instead of sending the whole KB.
- Backups: Bosgame `~/backups/pitch-before-tenant-settings-20261021-1738.tgz`, `~/backups/env-before-kb-*`, `*.backup-asrwords-*`; Ryzen `*.backup-golive-20261021174014`, `*.backup-asrwords-*`.
- Still manual: the SEA-LION start script lacks the GPU library path; Stack 4 does not auto-start on boot; the Ryzen `aistaff-pitch` service is stopped but still enabled (it would conflict on extension 8001 if the Ryzen reboots).

## Update 2026-10-21 night — AI Studio audit and fixes

What AI Studio really controls (checked against the code):
- **Pitch tab** saves through Pitch Control (Bosgame system service `aistaff-pitch-control`, `services/pitch-control/server.js`) into `local-runtime/pitch-config.json`; Pitch reads it on start, so use **Save & restart voice stack**. Works: pipeline, ASR endpoint/context/language, VAD, LLM endpoint/temperature/tokens/history/timeout, Piper voice/length/noise/volume, greeting delay, barge-in, Pitch instructions (versions, read per call), and now **Knowledge budget** (`local.kbMaxChars`, 0–60000; sets `PITCH_KB_MAX_CHARS` + `KB_PROMPT_BUDGET_CHARS` at Pitch start; the `.env` value 36000 applies until it is saved once).
- The STT and LLM **Model** dropdowns each list the one installed model (Qwen3-ASR 0.6B, SEA-LION E2B Q8). Kept on purpose: the phone uses the fastest working SEA-LION.
- **Default business identity / Default opening greeting** are fallbacks for lines without tenant settings; a tenant's own name, assistant name and greeting come from Settings › Channels › Mobile Phone.
- **Closer tab and the model picker** are read on every reply (`closer_reply` → Winnow 12B via `LOCAL_LLM_BASE_URL` → Bosgame proxy :18080 → router :46607).

Fixes made:
- `scripts/start-sealion.sh`: exports the AMD GPU library path (it failed with `libamdhip64.so.7` not found), so Save & restart can bring SEA-LION back.
- AI Studio reaches Pitch Control over the **wired** Converge address: Ryzen `.env` `PITCH_CONTROL_URL=http://192.168.100.105:5198`; Bosgame `/etc/aistaff/pitch-control.env` allows `192.168.100.92`.
- `aistaff-pitch-control` drop-in `KillMode=process`: restarting the control service no longer stops the voice stack it launched.
- **SEA-LION added to Closer's model picker** ("Gemma SEA-LION v4.5 E2B Q8") for comparison with Winnow: router entry `[sea-lion-v4.5-e2b]` in `~/projects/llama-cpp/router-models-qwen38/models.ini` (same Q8 file as Pitch, ctx 32768, `chat-template-kwargs = {"enable_thinking":false}`; without it the model "thinks" first and replies empty or leaks its reasoning). The router loads one model at a time, so selecting it unloads Winnow.
- Backups: `*.backup-aistudio-*` (Bosgame scripts/service code, Ryzen app.js/model-registry.js/.env), `models.ini.backup-sealion-*`, `/etc/aistaff/pitch-control.env.backup-*`.

## Update 2026-10-21 night — Phone turns through the Director (LIVE)

- Each caller turn on a tenant's line: Pitch saves the caller's words (Inquiries), then calls the web app `POST /api/internal/pitch/turn` (token `PITCH_PLATFORM_TOKEN`), which runs `generateSalesReply` — the same Director, workflows, guardrails, Business Engine actions and lead/handoff updates as the website chat widget — and returns the reply text; Pitch speaks it sentence by sentence (`local-pipeline.js _replyViaDirector`).
- If the Director takes longer than 1.5 s (`PITCH_DIRECTOR_ACK_MS`), SEA-LION writes and Anne speaks one short acknowledgement first (`_speakQuickAck`, no fixed copy). If the Director fails, returns nothing, or the conversation needs a human, Anne answers with the local model as before (`_replyToStreaming`).
- Tenant switch: `tenant_channels.config.pitch.use_director` (default on). TODO dual mode: show it as a toggle in Settings › Channels › Mobile Phone.
- Model: new picker row **"Voice replies (Phone + Website Call)"** (`voice_reply`), default `local/sealion` = Pitch's own SEA-LION server via `VOICE_LLM_BASE_URL=http://192.168.100.105:8090` (Ryzen `.env`); Winnow and the router SEA-LION are also selectable for comparison. Closer chat stays on `closer_reply` (Winnow).
- Spoken reply style for voice channels (`reply-style.js`): 1–2 short sentences, one question, no lists/links, numbers in small groups. Channel keys: `phone` → Mobile Phone card instructions; `website_call` reserved for the planned 5th channel **Website Call**.
- SEA-LION :8090 now `--host 0.0.0.0 -c 65536 -np 2 --chat-template-kwargs {"enable_thinking":false}` (LAN-reachable for the Director; firewall zone already allows LAN ports). Restart it with `~/restart-sealion.sh` on the Bosgame (also restarts Pitch).
- Measured (dry run, Marga): 2.7–3.2 s per Director turn on SEA-LION; it started `customer_service.create_service_request` and asked only for missing fields.
- Inquiries: transcript stays pinned to the newest message (live-refresh 2 s); phone conversations show "Caller <number>" and a Phone number row; a new call resets the handoff flag (history kept).
- CAUTION for test calls: when a workflow completes, the Director creates a REAL request in Marga's system.

## Update 2026-10-21 late — Voice fixes + voice subject router (LIVE, voice only)

Closer (Messenger, email, website chat) is unchanged: every change below is gated on channel `phone` / `website_call` or lives in voice-only files. Regression check: 3 Marga Messenger messages gave the same Director decisions before and after (`/tmp/closer-before.json` vs `after*.json` on the Ryzen).

- `src/voice-router.js` (new): CODE decides each voice turn; AI only labels.
  1. Workflow in progress (`director.activeDraft`, now exported) → Director continues.
  2. Each workflow: one yes/no check against its `trigger` text (small models do yes/no reliably) → Director starts it.
  3. Otherwise one label from fixed subjects: sales, billing, business_question, small_talk, unrelated; the same call copies the caller's name/company, which the endpoint saves to the lead/conversation.
  4. Actions: sales/billing/business_question → fast spoken answer from the knowledge slice (`VOICE_KB_PROMPT_BUDGET_CHARS`, default 12000) + next step decided in code (`nextStep`: quotation details, account, anything else); small_talk → short reply; unrelated → polite redirect listing what the business helps with.
  5. Log line `[voice-router] subject=… action=… ms=…`.
- `server.js /api/internal/pitch/turn`: language requests ("Do you speak English?") continue the open workflow step or get a short reply; caller answering the quote question stays in sales (`conversation.intent === "voice:sales"`).
- `director.js` (voice only): one missing item per spoken turn; interpreter hint to set named options at once; reply language decided in code (`spokenLanguage`: explicit request sticks, else Tagalog words in the latest message → Taglish, otherwise English); "spoken phone" wording.
- `reply-style.js` spoken rules: options said naturally, never re-ask, no guessed Ma'am/Sir, keep the item type the caller said, language switch on request.
- `ai.js` / `knowledge-base.js`: `renderKnowledgeForPrompt(…, budget)` (new optional arg); voice fallback uses `VOICE_KB_PROMPT_BUDGET_CHARS`.
- Pitch: quick "checking" line only after 3 s (`PITCH_DIRECTOR_ACK_MS=3000`), timeout 6 s, never spoken after the answer started.
- Measured: small talk / unrelated / sales / language ≈ 0.9–1.8 s; workflow turns ≈ 2.4–2.9 s.
- Backups: `*.backup-voicefix-*`, `*.backup-voicefix2-*`, `*.backup-router*-*`.

## Update 2026-10-21 ~22:10 — Spoken choices (voice only)
- `director.js spokenChoice()`: while a choice list is pending (`state.choices`), a bare spoken pick ("number one", "una", "yung pangalawa po", "the second one", "#3") is turned into `{type:"choose"}` by code and replaces the interpreter output (the interpreter had mistaken "number one" for `branchid=1`, resetting identification). Any other content word (e.g. "two yellow") means it is not a pick.
- Spoken rules: the caller cannot see a list — say each option name when there are four or fewer, otherwise ask for name/area/serial; never invent options, colours or examples.
- OPEN DECISION (privacy): anyone who names a company hears its branches/machines (phone and Messenger). Proposed: on the phone, list them only when the caller ID matches a contact on file; otherwise ask for the sticker serial.

## Update 2026-10-21 ~22:15 — Voice = Closer's rules (FINAL DIRECTION)
Mike's decision: voice calls use exactly Closer's rules and the Director; only speech-specific tweaks differ.
- Every voice turn goes through `generateSalesReply` (Closer + Director), same as Messenger / website chat.
- The voice subject router (`src/voice-router.js`) is OFF; it only runs with `VOICE_ROUTER=on` in the Ryzen `.env`.
- Voice-only tweaks (all gated on channel `phone` / `website_call`): spoken reply style; one missing item per turn; spoken picks read by code (`spokenChoice`); reply language from the caller's latest words / explicit request; speech-recognition hint for the interpreter; smaller knowledge slice in the non-workflow answer (`VOICE_KB_PROMPT_BUDGET_CHARS`, speed); the phone assistant name from Settings › Channels › Mobile Phone (e.g. Anne) instead of "Closer"; "Do you speak English?" continues the current step.
- Pitch mechanics (not rules): quick "checking" line after 3 s, stuck alert + SMS, live transcript into Inquiries.
- Measured: non-workflow turns about 7 s (Closer full prompt on SEA-LION), workflow turns about 2–4 s.
- OPEN: privacy rule A needs contact numbers — Marga's `find_customer` returns only id/name/counts. Options: (a) add contact numbers to that lookup; (b) AIStaff saved contacts (caller verified once, number linked to the company).

## Update 2026-10-21 ~22:30 — Company name retry on calls (voice only)
- `director.js`: when a company name is not found on a call, ask once more (said slowly or spelled) before the hand-over (`state.voice_name_retry`, task `ask_company_again`); spelled names are joined by code ("F E R R E R Studio" → "FERRER Studio").
- Hand-over on a call: "our team will call or text them back at this phone number" + "anything else on this call?" (chat keeps "we will message them here").
- Seen in the 22:16 call: "Ferrer" heard as "Brother" (likely biased by the hint word "Brother"); a quiet reply was dropped by the volume filter (44 dB < AI Studio "Minimum utterance RMS" 50 dB).

## Update 2026-10-21 ~22:45 — Voice company identification (replaces the "extra try")
Mike's rule for calls: no hand-over to a person unless the caller asks; we observe many runs before deciding where hand-over is needed.
- The "one extra try / spelled letters" change was undone (restored `director.js.backup-nameretry-20261021221941`).
- `director.js` (voice only): company not found → `confirm_heard` ("we heard X, is that correct?"); a new name → normal lookup again; same name confirmed → `ask_caller_context` (caller name + area/building); then code matches: `find_customer` per word of the heard name, similarity score (Levenshtein), +0.3 when a branch name contains a location word → best ≥ 0.5 → `confirm_close_match` → "yes" continues with that company; "no"/no match → `ask_more` (exact name on documents or sticker serial). Never `needsHuman` on calls for this.
- `state.voice_id` and `state.voice_alias` (confirmed mishearing → right company for the rest of the call) are saved with the Director state.
- Log: `[director] voice company match heard=… best=…`.
- Data gaps (Marga lookup): branch records have only `branchName` (no address/area), and no contact names or mobile numbers — location / contact / caller-number matching and privacy rule A need these fields added to Marga's lookups.
- Dry run: "Brother Studio" → confirmed → Johnny, Guadalupe → "closest is Ferrer Studio" → yes → branch "Ferrer Studio Additional" → machine HP 3035 RXN2303161 confirmed.


## 2026-10-21 late — Branch contacts in Marga's API + voice identification script

### Marga Business API (`/srv/apps/marga-app/scripts/lib/marga-business-api.mjs`, runs in `marga-app-proxy` user service)
- Serial search, customer lookup and machine list now return per branch: `branchAddress`, `contacts` (name, phone, emails, department, source) and `emails` (every email on file).
- Contact sources (same as the app.marga.biz service form): branch file (service contact / number / email + saved `emails` list), `tbl_deliveryinfo` contact, branch delivery contact, signatory, and the contacts list `tbl_branchcontact`.
- A known contact (same number) giving a **different email**: the email is **added** to that contact's `emails` list; the old one stays; logged in `marga_customer_change_log`.
- Branch email is still only filled when blank (unchanged).
- Backups: `marga-business-api.mjs.backup-contacts-*`, `.backup-contacts2-*`.
- Marga's API tests: 13 pass, 3 ticket tests fail **before and after** this change (old tests vs current ticket rules) — to be updated.

### app.marga.biz service form (`service/js/dispatch-board.js`)
- When staff confirm a new branch email, the new one becomes the main email and **the old one is kept** in the branch's `emails` list (was: replaced, kept only in the change log). Backup `dispatch-board.js.backup-keepemails-*`.

### Director — voice identification script (calls only; chat unchanged)
Serial → (none) contact name → company → "pulled up your records, you have N branches, which one?" (count only) → (unknown) location → one match: confirm → not confirmed / several: mobile then email (owner check) → only then read branch names in that location (max 4). Built and live in `src/director.js` (`voiceBranchTask`, `state.vflow`); **NOT yet tested**.

### Next (agreed with Mike)
1. Director uses the new contacts: greet a known contact by name; always ask the email (different → saved as additional via the ticket); a mobile/email that matches records = owner check (can pinpoint the branch); blank name/mobile/email → required and asked; new contact name → saved for that branch.
2. Test the voice script on a real call.
3. app.marga.biz Customers page: show each branch's contacts and all emails (expand to view), staff can add/edit.


## 2026-10-22 00:30 — Voice call fixes after the 11:36 PM test call (calls only; chat unchanged)

The 11:36 PM call went wrong because: an old call's Director notes leaked in ("Brother Studio"), a question was matched to the branch "Back up", ink colours were invented for a laser printer, and the stuck rule handed the call over + texted the caller. All fixed and replayed with simulated calls.

**Live now**
1. **Fresh start per call** (`src/server.js`, `/api/internal/pitch/turn`): first turn after 5+ min silence moves `ai_history_from` to the call start, clears "needs a person", clears the per-call notes. Customer profile kept.
2. **No hand-over on calls** (Bosgame `src/pitch/call.js` `_handleStuck`): stuck = quiet staff alert only (`quiet: true` → hand-over record "[Alert only — call continues]", conversation NOT marked needs-human), no SMS, no "stop asking". Old behaviour: `PITCH_STUCK_HANDOFF=on`.
3. **Call script** (`src/director.js`): serial → (no serial) contact name → company → "pulled up the records" → **where is the machine** (address/city + floor/room/department) → match by branch address → model by name (≤4, serial-free) or confirm the one machine. Branch names are never matched or read on calls.
4. **Location note on the request**: description gets "Machine location (caller said): … — branch/department to be verified by admin"; a department word fills `callerDepartment`. When the branch was not certain, a separate **"Branch / department to verify"** email goes to the tenant alert list after the request is saved.
5. **Questions are answered, never taken as answers** ("what company did you pull up?").
6. **Serials never spoken**; when the caller asks, spelled one character at a time (E, 6, 6, 8…). Model names (with a dash) are kept.
7. **Items**: laser / toner → toner for the whole call; "only black" settles the colour; "two" answers "how many"; "first one" is not a quantity; no example colours on calls; invented "choose 1, 2, 3" removed in code.
8. **English / Tagalog / Taglish only**: Indonesian/Malay replies are rewritten in English; no re-greeting after the first turn.
9. **Per-call notes** (`VOICE_FLOWS` in director.js): call steps, choices, picked machine, request type — kept for the live call (30 min), cleared on a new call. Needed because the early steps happen before any draft exists.

Backups: `src/director.js.backup-voicefixes*`, `src/server.js.backup-freshcall-*`, `src/reply-style.js.backup-voicefixes*`, Bosgame `src/pitch/call.js.backup-quietstuck-*`.
Real 11:36 PM call: nothing was sent to Marga (stopped at a draft).

**Next**
- Real test call from 0917 576 9817 (Anne should follow: serial → name → company → location → model → items → contact).
- Director uses Marga branch contacts (greet known contact, always ask email, matching mobile/email = owner check, caller-ID shortcut for repeat callers).
- app.marga.biz Customers page: Contacts section per branch.
- Bosgame Pitch restart: restart ONLY `node src/pitch/index.js` with `setsid nohup … &` from ssh `ai-server@192.168.100.105` (a plain ssh session kills it on exit).


## 2026-10-22 09:30 — Model step on calls (after the 9:04 AM test call)

- **No lists on calls.** After the location, Anne asks "what is the model of the printer?" (no options). The machine-condition question is also asked openly ("how is the machine working right now?"); the interpreter maps the answer to the allowed status. Spoken rule updated in `src/reply-style.js`; invented "choose / options 1, 2, 3" removed in code.
- **Spoken models understood** (`spokenDigits` in `src/director.js`): "thirty thirty five" = 3035, "twenty seven forty" = 2740, "seven zero six five" = 7065. One model matches → "is this for your HP3035?" (yes/no). Same model in several branches → saved, flagged for admin. Not matched twice → saved under the first machine, "model said: …" added to the location note, flagged for admin.
- **Location tolerates speech-to-text spelling** ("Guadeloupe" = Guadalupe), small edit distance.
- **Model / location answers are never quantities** ("thirty thirty **five**" is not 5 ink).
- **Toner / ink word kept from turn 1** (before the serial question).
- **Pitch pronunciation** (Bosgame `src/pitch/brain/local-pipeline.js`, `speakModelCodes` in `preparePiperSpeechText`, speech only): HP3035 → "H P thirty thirty-five", MFC-2740 → "M F C twenty-seven forty", DCP-7065DN → "D C P seventy sixty-five D N", HP 3005 → "H P thirty oh five". The Inquiries transcript still shows "HP3035".
- Replayed the 9:04 call: serial → name → company → location → model ("thirty thirty five" → HP3035 → yes) → only black → two → "printing fine" → contact number; request = toner, 2 pcs, status Running / Print OK, location note + admin check.
- Backups: `src/director.js.backup-voicemodel*`, `src/reply-style.js.backup-nolists-*`, Bosgame `local-pipeline.js.backup-models-*`.


## 2026-10-22 10:00 — Serial wording + caller's name on calls

- First question: "the serial number of the machine" (no "sticker"). "Where can I find it?" is answered from the business's phone instructions, then asked again. "Can't find / don't have / can't read it" = no serial.
- Marga's "Extra instructions for phone calls" (Mobile Phone card, `tenant_channels.config.instructions`, channel `mobile_phone`) rewritten to the call order + "serial is usually on the sticker on the control panel" + "Sir/Ma'am + first name". Old text in `config.instructions_previous`.
- The caller is the contact: Anne asks "your name, so we can address you properly" (saved as caller name). Sir / Ma'am is used ONLY when the business's phone instructions mention Sir/Ma'am: common Filipino first names in code first, SEA-LION as backup, unisex/unknown = name only. Log line: `[director] caller title`.
- Company step: a no-digit "identifier" is treated as the company name (the interpreter sometimes labels "Ferrer Studio" as an identifier).
- Bug fixed: the serial-hiding filter removed the words "serial number of" from Anne's own questions (source of "machine sticker number" / "Do you need the machine?"). It now removes only real serials (with digits).
- Spoken rule (`src/reply-style.js`): Sir/Ma'am allowed when the caller asks or the business's instructions say so.


## 2026-10-22 09:50 — "Hotel reservation" on a Marga call: cause and protection

**Cause (9:45 AM call):** the Bosgame reached the database over Wi-Fi (`192.168.254.125`), which dropped. Pitch could not tell which business owns the line, so it used its built-in default: "this is Pitch, your AI sales and support staff" + the old hotel demo prompt.

**Fixed**
1. Bosgame `.env` `DATABASE_URL` now uses the **wired** Ryzen address `192.168.100.92` (old Wi-Fi line kept as a comment; backup `.env.backup-wireddb-*`). Pitch Control and the Director were already wired.
2. **Saved line settings** (`src/pitch/tenant.js`): every successful lookup writes `local-runtime/pitch-line-cache.json`; if the database is unreachable, the call uses those saved settings (log: `line: database unreachable … using saved settings for …`). Tested with a dead database address → Marga / Anne / Anne's greeting.
3. **Demo brain OFF on business lines** (`src/pitch/brain/local-pipeline.js`): no Director reply → one retry → fixed safe line ("Sorry, our system is having a problem right now. Please send us a text message at this number…"); caller asked for a person → "I have let our team know, and they will contact you shortly." No business found at all → neutral greeting ("Hello, thank you for calling") + safe line. The free-form local model (hotel demo) only runs with `PITCH_ALLOW_LOCAL_BRAIN=on` (for demos; not set).
4. Waiting line ("Sure, one sec") uses its own tiny prompt — no demo content.

Backups: `src/pitch/tenant.js.backup-nofallback-*`, `src/pitch/brain/local-pipeline.js.backup-nofallback-*`.
**Pitch restart tip:** stop, wait until the process is gone, THEN start in a separate ssh call — starting too soon gives `EADDRINUSE 192.168.100.105:5062`.


## 2026-10-22 10:00 — SMS status + safe Pitch restart

**SMS today (not a Closer channel yet):** texts to the router SIM reach Pitch's old standalone SMS bot (`src/pitch/sms-agent.js`): logged on the Bosgame only, NOT saved to Inquiries, no staff alert, replies from its own prompt, silent 9 PM–7 AM.
**Decision (Mike):** later, add **SMS as a channel** in Settings › Channels, run by Closer + Director (save every text to Inquiries in the same thread as calls from that number, SMS-style replies, staff alerts, toggle on the card). Until then Anne's safe line says "Please call again in a few minutes" (no promise of a text reply).

**Restart Pitch safely:** `ssh bosgame '/srv/apps/aistaff/scripts/restart-pitch-only.sh'` — restarts only Pitch, waits for "ready for calls". (A plain `pgrep -f "node src/pitch/index.js"` inside an ssh command also matches the ssh shell itself and kills it — that caused the earlier restart hiccups.)
Note: from the Mac, `bosgame` (Wi-Fi 192.168.254.128) may answer when the wired 192.168.100.105 does not; Bosgame ↔ Ryzen wired link is separate and was OK.


## 2026-10-22 10:10 — Safe line per business + why Closer replies were slow

- **"If the system has a problem" line** is now a Mobile Phone card setting (`pitch.fallback_line`, collapsed section under the greeting; saved by `normalisePitch`). Pitch speaks it when the Director cannot answer; default for businesses without one: "…message us on our Facebook page or website, or send us an email…". Marga's: "…message us on our Facebook page, Marga Biz, chat with us on marga.biz, or email care@marga.biz…". Included in the Bosgame's saved line copy, so it works with the database down.
- **No demo fallback in Closer**: the AIStaff website reply ("1. See how Closer works…") was real Closer, only slow; on a real failure the website shows an error and staff are alerted.
- **Slow first replies (all Closer channels):** `KB_PROMPT_BUDGET_CHARS=60000` on the Ryzen → first prompt ~21,300 tokens → Winnow needs ~44 s just to read it (website chat took 51 s, widget showed "Could not connect"). Later turns are faster (prompt reuse). **Decision pending (Mike):** lower the knowledge budget (e.g. 20,000) and test answer quality.
- 9:34 Messenger "Hi" to Marga: reply was cut off by an AIStaff app restart during the call fixes; recovery answered after the restart. Guard blocked a reply that repeated an old reference number (working as intended).
- Router note: Bosgame AI router runs `--models-max 1` (one model in memory); different models (winnow-12b / qwen3-8b) swap and queue.

## 2026-10-22 — Fresh start after a STAFF-resolved request
- Bug: `finishResolved()` in `src/resolve-loop.js` (staff fixes a waiting request, system messages the customer the reference) never moved `conversations.ai_history_from` or cleared needs_human. Closer kept seeing the whole waiting-period chat (Mike test convo 9bc5206c, SR-2026-000005 saved Oct 20 08:17).
- Fix: `finishResolved()` now sets `ai_history_from = now` (just before the reference message, so that message stays visible) and clears needs_human/handoff. Customer memory (name, company, branch, machines) untouched. Backup: `src/resolve-loop.js.backup-freshstart-20261022`.
- Data: only conversation 9bc5206c was affected (checked all conversations with a reference newer than their marker); marker moved, set back to open, last_request carries SR-2026-000005.

## 2026-10-22 — Remembered machine is confirmed first (all channels)
- `src/director.js`: a machine remembered from the last request (`customer_profile.last_identified`) is no longer used silently. The first reply asks whether it is the same company, branch and machine, showing model — company — branch — serial (serial left out on phone/website calls). Only on oo/yes are customer/branch/machine filled; hindi/no goes back to the normal serial / company questions.
- Label fallback: when `last_identified.label` is empty it is built from `customer_profile.machines` (fixes the "we do not have your machine on file" reply and the missing Machine line). The summary now always prints the Machine line.
- Bug fixed: `VOICE`/serial helpers moved to the top of `runDirectorTurn()`; the "open request still needed?" check crashed with `Cannot access 'VOICE' before initialization`.
- Backups: `src/director.js.backup-memlabel-20261022`, `src/director.js.backup-memconfirm-20261022`.
- Test script `scripts/simulate-closer-with-memory.js` (env `PROFILE_FROM=<conversation id>` copies that customer memory). WARNING: runs against LIVE Marga; a merge into an open ticket really updates it. The Oct 22 test added "2 black" to SR-2026-000009; reverted by hand (portal_service_tickets id 9, ticket event 10 deleted, tbl_schedule doc 999202611088, AIStaff request f573b299).

## 2026-10-22 — Item kind from earlier messages; ink/toner wording locked
- `src/director.js` items step: when the request kind is not set yet, it is taken from the customer's recent messages (e.g. "can I order ink" two turns earlier), so "Request type: 1 service 2 toner 3 ink..." is no longer asked.
- After the writer: on submitted / added_to_open_request / confirm_summary replies, if the facts only say ink, any "toner" the writer typed becomes "ink" (and the reverse). Backup `src/director.js.backup-kind-20261022`.
- Verified with simulate-closer-with-memory (stopped before any write) + direct check of the wording guard.

## 2026-10-22 13:35 — Slow replies on Messenger + website chat: knowledge budget lowered
- Symptom: replies took 90-120 s after Pitch went live. Pitch was NOT the cause (SEA-LION idle). Cause: `KB_PROMPT_BUDGET_CHARS=60000` -> every new chat ~21,400 tokens; three new chats at once on Winnow -> 72-115 s just reading.
- Changed Ryzen `.env` `KB_PROMPT_BUDGET_CHARS=20000` (backup `.env.backup-kb-20261022`). New chat now ~12,400 tokens, read ~23 s, full first reply ~34 s.
- Revert: restore the backup line to 60000 and `systemctl --user restart aistaff-api`.

## 2026-10-22 13:55 — Test data wiped (Mike asked)
- SR-2026-000009 cancelled in Marga via `cancel_service` (case cancelled in AIStaff).
- Mike's Messenger conversation 9bc5206c: 188 messages deleted, customer memory cleared, fresh state (conversation row kept so Messenger keeps working).
- aistaff.click website chat test conversation vis_0b302ac8 deleted (messages, lead).
- The aistaff.click widget reply "Hey! I'd love to help you out... 1. See how Closer works..." is a real AI reply (AIStaff's own assistant greeting menu), not a fallback; ~28 s.

## 2026-10-22 14:15 — Full knowledge base restored + first-reply notice
- `KB_PROMPT_BUDGET_CHARS` back to 60000 (Mike: keep full KB; customers accept a slower first reply).
- `src/ai.js`: `generateSalesReply()` is now a small wrapper around `_generateSalesReplyInner()`. On the FIRST AI reply of a fresh chat (no AI message since `ai_history_from`; not phone/website_call): website chat status after 8 s = "Preparing your reply... the first reply can take up to a minute."; Messenger sends one line after 12 s = "One moment po, preparing your reply..." (saved to Inquiries). Timers are cancelled when the reply is ready. Backup `src/ai.js.backup-firstwait-20261022`.

## 2026-10-22 21:50 — Chat shows only the last 4 of a serial (not on calls)
- `src/director.js` end of `runDirectorTurn()`: on chat channels (not phone / website_call) every serial in the reply becomes "serial ending 1234" (or "serial number ends in 1234"), unless the customer asked for their serial. Remembered-machine confirmation uses the same style. Calls unchanged: serials are never spoken. Staff emails still carry the full serial. Backup `src/director.js.backup-serial4-20261022`.

## 2026-10-22 21:50 — "One moment po" notice blocked reply recovery (fixed)
- An API restart at 21:42:33 cut off Mike's Messenger reply. Reply recovery (`src/reply-recovery.js`) only answers chats whose LAST message is the customer's; the first-reply notice was the last message, so it skipped.
- Fix: the notice is saved with `sender_id = "ai_wait_notice"` (`src/ai.js`) and recovery ignores those messages. Mike's chat was recovered (answered). Backup `src/reply-recovery.js.backup-waitnotice-20261022`.
- Lesson: restarting `aistaff-api` while a reply is being written loses it until recovery picks it up; check the log for in-flight `[director]` lines before restarting.


## 2026-10-22 23:30 — Phone Director: fixed call script (src/voice-director.js) — LIVE
Mike: calls must be deterministic. Identity first, then the need, then follow-up. Every question is a fixed line written by code; the AI does not write replies on calls any more.
- **Order**: 1) name ("May I know your name, please?") -> 2) serial (lookup `find_machine`); no serial -> company (`find_customer`, not asked again if said in the first sentence) -> branch / department (`list_customer_machines` + `src/branch-match.js`; two branches with the same name -> ask the model; "mismo / main" = main office; 2 misses -> closest one asked as yes/no; still unsure -> saved + admin email to verify) -> machine (model asked openly; same model in the branch -> not asked) -> identity CONFIRMED -> 3) need (ink / toner / cartridge -> how many + colours via `src/supply-items.js`; repair -> what is wrong; follow-up -> staff alert) -> machine condition -> 4) contact number (caller ID offered first; read back digit by digit "zero nine one seven, five seven six, ..."; 11 digits 09... or landline checked) -> email (read back "juan dot cruz at gmail dot com") -> 5) spoken summary -> yes -> saved -> reference read digit by digit.
- Lists never read; serials never spoken; Sir/Ma'am + first name (Marga phone instructions); English or Tagalog lines (Tagalog when the caller speaks it); "repeat" repeats the last line; non-answers to yes/no questions -> "Sorry, is that a yes or a no?".
- Open earlier request -> staff email with both requests, caller told the team will contact them.
- Wiring: `/api/internal/pitch/turn` (src/server.js) calls `voice-director.turn()` first; `VOICE_DIRECTOR=off` in Ryzen `.env` returns calls to the old Closer + Director path.
- `src/business-engines.js`: values sent with `requestedBy: "voice_director"` are not held as "not asked yet" (the script asked them itself). Backup `src/business-engines.js.backup-voicedirector-20261022`.
- State per call: `conversations.customer_profile.voice_call` (a call = turns < 5 min apart).
- SEA-LION (`VOICE_DIRECTOR_LLM_URL`, default http://192.168.100.105:8090) only as a fallback: name not understood, Sir/Ma'am for unknown first names.
- Test: `node scripts/simulate-voice-director.js '["line 1","line 2"]' +639xxxxxxxxx` (no audio; cleans up unless the caller says yes to the summary — that SAVES a real ticket). SR-2026-000011 was a save test and is cancelled.
- Backup of the first version: `src/voice-director.js.backup-v1-20261022`.


## 2026-10-23 00:45 — Urgent alerts that repeat until handled + open requests settled on the call
Mike: never promise "the team will contact you". The Director settles open requests itself; anything it cannot finish must email AND text Mike, repeating until he says he did something.
- **`src/escalations.js`** (new): `raise({companyId, conversationId, title, details})` sends an email + an SMS to the urgent contacts right away, then every `ESCALATION_REPEAT_MIN` minutes (default 15) until someone opens `https://aistaff.click/e/<code>` and presses "I handled it" (optional note + name). Table `staff_escalations` (created automatically, additive). Sweep every minute in the background jobs (`src/server.js`). Route `/e` in `src/server.js`.
- **Urgent contacts**: Settings > Alert contacts now has an "Urgent alerts" tick box (`public/app.js`, saved as `alert_contacts[].urgent` by `src/server.js`). None ticked -> the first contact. Marga: Michael Pineda ticked.
- **SMS**: through Pitch's SIM router. Pitch internal API now listens on the wired address (`PITCH_INTERNAL_HOST=192.168.100.105` in Bosgame `.env`; `src/pitch/internal-api.js`, backup `.backup-host-20261023`). Ryzen `.env`: `PITCH_SMS_URL=http://192.168.100.105:5199/internal/sms` + `PITCH_INTERNAL_TOKEN` (same token as Bosgame). A text cannot go out during an active call (409); the next round retries.
- **Phone Director** (`src/voice-director.js`, backup `.backup-v2-20261023`): right after identity is confirmed it looks up open requests for that customer + machine and asks "still needed, already done, or no longer needed?" — kept (still_needed), closed as done (`close_service_request`), or cancelled (`cancel_service`) in Marga; if Marga cannot be updated -> urgent alert. Every "could not save / blocked / follow-up" now raises an urgent alert and Anne only says it was flagged as urgent (no promise of a call back).
- `src/business-engines.js`: the open-request stop is skipped for `requestedBy: "voice_director"` (the call settled it).
- Tested: test alert (email + SMS sent to Mike), "I handled it" page public 200; simulated calls: open request kept / cancelled (SR-2026-000012 cancelled in Marga by the call). SR-2026-000011 and 000012 were test tickets, both cancelled.
- Lesson: patch scripts written with Python non-raw strings turn `\b` into a control character; fixed in voice-director.js (6). Use raw strings (r''' ''') for JS regex.


## 2026-10-23 01:30 — Phone Director listens and talks naturally; branch list on request
Mike's 12:10 AM call: robotic fixed wording, "it's not there" not understood, asked twice for the list of departments and was ignored, said "No" to the main office and it kept the main office.
- **Understanding** (`understand()` in src/voice-director.js): when the caller's words are not a plain yes/no, SEA-LION labels what they MEANT (answer / dont_know / wants_list / wants_count / yes / no / repeat / pick N). Plus fast word rules (`WANTS_LIST`, `NOT_THERE`, `DONT_KNOW`).
- **Natural speech** (`natural()`): code still picks the step; SEA-LION writes the sentence from the step's GOAL (`GOALS`) and the caller's last words, ~0.4 s. Required words (`KEEP`: Sir/Ma'am name, company, branch, model) must be in it and a question must stay a question, else the fixed line is used. EXACT lines (numbers, email, lists, summary, reference) are never reworded. `VOICE_NATURAL=off` = fixed lines only.
- **Branch list**: read when the caller asks, does not know, no match, or says "No" to a branch: "We have 3 branches for Bosch...: 1, main office, with the MFC J3530DW; 2, Additional, with the MP C3003; ...". Picks by "the second one" / "number 2" / model / name. A rejected branch is never kept and is left out of the next list. "the third one" on a 2-item list -> list read again. Address asked if they still cannot choose; then closest + admin verify email.
- **Models**: "I don't know the model" -> the models at that branch are read. Machines with no model on record are ignored when deciding.
- Backup before this: `src/voice-director.js.backup-v3-20261023`.


## 2026-10-23 09:50 — Every phone reply is written by the AI (Director only nudges)
Mike: the Director nudges what to ask; the AI is the communicator — no canned words.
- `src/voice-director.js`: every reply goes through `talk(step)` -> `natural()`: SEA-LION writes it from the step's nudge (`GOALS`), the call so far (last 6 lines, `st.hist`) and the caller's last words. This now includes lists, number / email read-backs, the summary, the reference number, open-request questions, "yes or no?", repeats, goodbyes and "flagged as urgent".
- Facts that must be said exactly are in `KEEP` (names, company, branch, models, list items, phone digits, email, reference); checked ignoring punctuation. Prompt rules: one question, no greeting mid-call, items/models/numbers said exactly, no promises outside the nudge, no question in the goodbye.
- Outcomes that used to be fixed sentences ("that request stays open / marked done / cancelled") are passed as "first tell them ..." in the next nudge.
- Backup sentence only when SEA-LION gives nothing usable twice; logged as `[voice-director] AI reply not usable for step X — backup sentence used`.
- `VOICE_NATURAL=off` = backup sentences only (emergency). Backup before this change: `src/voice-director.js.backup-v4-20261023`.


## 2026-10-23 10:20 — AI as mediator; Director validates every field and reviews every reply
Mike: the AI is the mediator between the customer and the Director. The Director accepts only the fields it requires, keeps analysing every turn, anticipates every field, and nudges the AI back and forth until every detail is satisfied.
Loop per caller sentence (`src/voice-director.js`):
1. **Mediator** `mediate()`: SEA-LION pulls EVERY detail from the sentence as candidates (name, serial, company, branch, model, need, items, condition, problem, phone, email + intent / pick), not only the answer to the current question.
2. **Director validates** each candidate: name (1-3 words), serial (only if found by `find_machine`), company (searched in the identity step), need (allowed kinds), items (`parseSupplyItems`, not from model/serial/number answers), condition (must map to 1-4), phone (complete PH number -> read back before use), email (valid -> read back before use). Rejected values get a reason that goes into the next nudge ("the number is incomplete (10 digits)"). Accepted values are never asked again. Logged: `[voice-director] mediator accepted: ...`.
3. **Director nudges** the next missing field in Mike's order (name -> identity -> need -> condition -> number -> email -> summary).
4. **Director reviews the AI's reply** (`reviewReply()`): it must be about the nudged field (`TOPIC`), contain the required facts (`KEEP`), contain no number it was not given, make no promise (`PROMISE`), ask one question. Rejected replies go back to the AI with the reason (up to 3 tries). Logged: `[voice-director] reply sent back (step X): reason | reply`.
- Test: one sentence with name + company + items + condition + number + email -> only serial and branch asked, number and email read back, saved. SR-2026-000013 was that test and is cancelled.
- Backup before this: `src/voice-director.js.backup-v5-20261023`.
- Next (not done): the same reply review for the CHAT Director (Messenger / website / email) — it already has interpreter -> Director -> communicator, but the communicator's replies are not checked yet.


## 2026-10-23 10:50 — Call order in the tenant panel (dual mode)
Mike: the Director controls the priority order (name -> serial / company -> branch / department -> ...). Now visible and editable per business.
- **Tenant panel**: Settings > Channels > Mobile Phone > step 4 "Choose what it can do" > **Call order** (collapsed; summary line shows the current order). Rows with ↑/↓ and on/off; "Ask for the serial number first" tick box; "Save call order". Steps the business's own system requires to save (read from its connected action's `input_schema.required`) are locked on and marked "required by your system". Open requests always right after identity; summary + save always last.
- **Stored**: `tenant_channels.config.pitch.call_order = [{key, on}]` and `call_serial_first` (per company, DB). Validated in `normalisePitch()` (src/routes/phone-lines.js). Described to the panel by `describe()` in src/routes/channels.js (`mobilePhone.call_order`).
- **Director**: src/voice-director.js now runs one function per step (`step_name`, `step_identity`, `step_open_requests`, `step_need`, `step_condition`, `step_phone`, `step_email`) in the saved order (`callOrder()`), then summary -> save. Defaults (no saved order) = Mike's order. Generic: no Marga-only code; the required fields come from each business's own action.
- Takes effect on the next call (read every turn); no restart needed for panel changes.
- Backups: `*.backup-callorder-20261023` (phone-lines.js, channels.js, channels-settings.js), `src/voice-director.js.backup-v6-20261023`.
- New business checklist: Platform > Phone Lines (assign router) -> tenant Mobile Phone steps 1-3 -> step 4 incl. Call order (defaults OK) -> test call -> Go live. All panel actions.
- Manual steps still required: none for the call order. (Spoken nudges/goals are code-level English/Tagalog instructions to the AI, not customer copy.)


## 2026-10-23 11:30 — Getting the email right on calls
Mike's 10:50 call: email repeated many times, never caught. Causes: speech-to-text mishears name-like emails (pineda -> peneda / vineda / Ineda / Tinder); the email reader kept only the last word before "at" ("vineda myd" -> "myd"); "spell it out" got "yes or no?"; spelled letters were not collected; speech-to-text noise (its hint words echoed on silence) was taken as an answer.
Fixes in `src/voice-director.js` (`step_email`):
- **Known email first**: emails on this caller's earlier requests (same number, most recent first, cancelled/failed ignored) + customer memory -> "Can we send the updates to p, i, n, e, d, a, ... at yahoo dot com?". Branch emails on record are also used for matching.
- **Misheard -> known**: a heard email or name part close to a known one (`closestKnownEmail`, letter-pair similarity >= 0.5) is offered as the known one, always read back for a yes.
- **Read-backs are spelled** letter by letter (`spellEmail`); "spell it / letter by letter" spells it again.
- **Spelling by the caller** (`spelledLetters`): "P, I, N" / "P as in Peter" / NATO words, collected over several turns until "at gmail dot com" (`domainFrom`).
- `parseEmail` keeps every word of the local part after "my email is".
- **Noise filter**: a "sentence" that is >= 60% speech-to-text hint words is treated as not heard (question repeated).
- After 3 failed tries: the caller's known email, else the branch email on file (caller told); none -> urgent alert + "flagged as urgent".
- Reply review: "contact them / contact us" in a reply to the caller is sent back.
- Backup before this: `src/voice-director.js.backup-v7-20261023`.


## 2026-10-23 13:30 — Speech-to-text listening modes (email / digits / serial) + training data
Mike: tell the speech model when an email is coming, with examples of how emails sound (names joined with numbers and words, not normal English), and train it.
- **Director -> Pitch** (`asrFor()` in src/voice-director.js, returned by `/api/internal/pitch/turn` as `asr`): while Anne waits for an email the next answer is decoded in **email mode** with `emailContext()`: how emails are spoken + neutral examples (mariasantos@gmail.com, juan_delacruz23@yahoo.com, jreyes81@outlook.com), the caller's known emails, the caller's name, the company's email domain(s), common domains, common Filipino surnames. **digits mode** for phone numbers, **serial mode** for serials.
- **Pitch** (src/pitch/brain/local-pipeline.js, backup `.backup-asrmodes-20261023`): `this.nextAsr` from the Director goes to the speech model for that one answer (language english, mode, context, candidates). Logs `local-pipeline: listening mode=email picked=... text=... raw=...`.
- **Speech server** (services/qwen3-asr/server.py, backup `.backup-modes-20261023`): `mode=email` decodes twice (with / without the email context), converts spoken to written (`spoken_to_email`: at -> @, dot -> ., underscore -> _, number words -> digits, joins the name parts), prefers a known email (letter-pair similarity >= 0.6), else the context decode. `mode=digits` -> digits (`spoken_to_digits`, "double five" ok). Restart: `kill <pid>; scripts/start-qwen3-asr.sh` (then `scripts/restart-pitch-only.sh`).
- **Result on Mike's real 10:50 recordings**: old "pineta mic b" / "vineda myd" / "Pineda Mike B" -> email mode **pinedamikeb@yahoo.com** on all 3 complete answers, also as an unknown caller.
- **Training data for fine-tuning**: every clip decoded in a mode is saved to Bosgame `local-runtime/asr-dataset/<mode>/<stamp>.wav + .json`; when the caller confirms (yes), the Director sends `asr_label` and Pitch appends `{label, clips}` to `local-runtime/asr-dataset/labels.jsonl`. After a few hundred labelled email/phone/serial clips: fine-tune Qwen3-ASR-0.6B on them (planned, not done).
- Echo note: on noise, email mode can return an email; it is always read back letter by letter for a yes.


## 2026-10-23 13:40 — Emails read back as words; wipe for an honest voice test
- Mike: spelling the email letter by letter on read-back sounds foreign. `sayEmailWords()` reads it as English words: pinedamikeb@yahoo.com -> "pineda mike b at yahoo dot com" (name parts split with the Filipino first-name + surname lists; a part that would become 2+ loose letters is read as one word: "jeffry dot lansang", "care"). Letter by letter (`spellEmail`) only when the caller asks to spell.
- Speech model email context now lists endings: dot com, dot com dot ph, dot ph, dot net, dot org, dot edu dot ph, dot gov dot ph; domains incl. yahoo.com.ph, ymail.com.
- Fixed: "come again" / repeat never worked during calls (`st.stage !== "start"` was always false; now `st.ask`), and the repeat + noise checks ran before `talk()` existed (now flagged and answered after).
- "Do you need my email?" -> a friendly ask again.
- Wipe (Mike asked, to prove voice capture): SR-2026-000014 cancelled; calleremail + callername removed from 31 requests on 0917 576 9817; 2 contact_profiles deleted; phone conversation a27a2b39 (263 msgs) and Messenger 9bc5206c (19 msgs) cleared with customer memory.
- Backups: `src/voice-director.js.backup-v9-20261023`.


## 2026-10-23 14:00 — Sir / Ma'am + first name through the whole call
- Mike: after the name, address callers with Sir or Ma'am. Before: only in the first thank-you, and only if the phone instructions mentioned "sir".
- Now: tenant setting **Settings > Channels > Mobile Phone > step 3 > "Address callers as Sir / Ma'am + first name"** (`config.pitch.address_title`, default on; saved by `normalisePitch`). Every name gets a title (first-name lists, else SEA-LION must pick Sir or Ma'am). The AI is nudged to use "Sir John" once in a reply, about every other reply (`turns_since_name`), not in every sentence.
- The caller can correct it ("Ma'am po ako", "it's sir", "I'm a woman") and the title switches right away.
- Backups: `src/voice-director.js.backup-v10-20261023`, `*.backup-title-20261023` (phone-lines.js, channels-settings.js).

## 2026-10-23 14:15 — Mike's 13:27 voice test (wiped, unknown caller)
- Email captured from voice: speech heard "pinedamikeb@yahoo.com", read back "Pineda Mike B at Yahoo dot com", spelled on request. Works.
- My API restart at ~13:29:40 cut one turn of that call (lesson: check `journalctl ... pitch/turn` count is 0 before restarting).
- Fixes: name must be >= 2 letters ("J." = clipped "John" -> asked again); name listening mode (common Filipino first names) for the speech model; a field rejected by the business system (HTTP 400, e.g. "callerName is required") goes back to that question instead of failing + urgent alert; "Did you get my email?" / "I already told you" -> read back the email already heard; after the call is finished, "nothing" is not answered with "yes or no?".
- The urgent alert wsWBAszr (13:30) was caused by the name bug, not a real problem.
- Backup: `src/voice-director.js.backup-v11-20261023`.

## 2026-10-23 14:30 — Email read-back pronunciation (voice untouched)
- Voice zonos1110_22050_epoch180 NOT changed (Mike: Taglish sounds OK). Its phonemizer is espeak en-us (as trained), so Filipino names inside emails sounded English ("Pineda" -> "pain-duh").
- Pitch `speakEmailNames()` (src/pitch/brain/local-pipeline.js, backup `.backup-emailsay-20261023`): only the words right before "at <domain> dot com" are respelled for Piper (`EMAIL_NAME_SAY`: Pineda -> Peeneda, Santos -> Sahn-tos, Reyes -> Reh-yes, ...). Transcript and saved email unchanged. Respellings checked with `espeak-ng -v en-us --ipa`.
- Spelling only when the caller asks, with a full stop after each letter (pauses): `spellEmail()` in src/voice-director.js (backup `.backup-v12-20261023`).
