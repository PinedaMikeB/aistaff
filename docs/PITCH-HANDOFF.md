# Pitch — handoff, 23 Sep 2026

Voice agent, now running on **Bosgame** (Ryzen AI MAX+ 395, ROCm GPU), not the
old Mac Mini setup this doc used to describe. Everything below reflects the
actual current state after a long, mostly-successful debugging session on
the new local (non-Gemini) pipeline.

---

## Update, 24 Sep 2026 morning — "going silent / hearing wrong" fix

**Why it was going completely silent:** `whisper-server` (port 8188) was
not running. It received a shutdown signal at ~22:56 on 23 Sep (end of the
last test session) and was never restarted, while Pitch itself kept running
and answering calls. With no STT, every caller turn failed → pure silence.
Restarted with the documented medium/CPU command (`--no-speech-thold 0.90`).
**Always check all four processes with `pgrep` before debugging anything else.**

**Why it was hearing things that weren't said:** `local-runtime/pitch-config.json`
overrides the defaults in `runtime-config.js`, and it still held the old
over-sensitive values (`vadPositiveSpeechThreshold 0.3`, negative `0.12`,
`minSpeechMs 192`, `redemptionMs 700`). The "validated baseline" in this doc
was only in the defaults — never in the file that actually wins. Result,
measured on the saved `pitch-whisper-debug/` clips from the 23 Sep 22:44 call:
3 of 7 segments sent to Whisper were line hiss / near-silence (RMS 29–38 dB
vs 65–74 dB for real speech). Two came back `[BLANK_AUDIO]`; one (4.7 s of
pure silence, peak 132) was hallucinated as **"Thank you for watching!"**, and
Pitch answered it with a goodbye. `redemptionMs 700` also chops callers
mid-sentence on any short pause.

**Changes made:**
1. `pitch-config.json` `local` block set to the validated baseline
   (0.5 / 0.35 / 256 / 640 / 2000), `whisperModel` label corrected to
   `ggml-medium`, new `minUtteranceRmsDb: 50`. `bargeInEnabled` left `false`
   (no echo cancellation on the AIO100 line — turn on only for barge-in tests).
2. `local-pipeline.js` `_transcribe()`: new **energy gate** — segments quieter
   than `minUtteranceRmsDb` (default 50 dB) are dropped before Whisper and
   logged as `skipped ... below energy gate`. Stops noise hallucinations and
   keeps Whisper free for the real next sentence.
3. Pitch restarted; registered as 8001. Backups: `/tmp/local-pipeline.js.bak-0924`,
   `/tmp/pitch-config.json.bak-0924` on Bosgame.

**Language test on the same 7 clips (medium, CPU):** `auto` transcribed all
real speech correctly (it detected "nynorsk" only on the silent clip, which the
gate now removes). `en` dropped Tagalog words ("mas romantic na place" →
"romantic place"). `tl` matched `auto` on speech with higher confidence —
worth a live A/B later; keep `auto` for now.

**Still true:** each turn costs ~4 s in Whisper medium on CPU plus the 2 s
`redemptionMs` wait — correctness first, latency is the next thing to tune.
No process supervisor yet (still-open #7) — this outage is exactly what one
would have prevented.

**Follow-up, same morning — "can I book a table for two" → "sorry, didn't catch that":**
Whisper returned `Pagkainan mo ang buk at panggunan mo.` Two causes, both fixed:
1. **Silero VAD was fed frames without its required 32-sample context**
   (Silero v5 needs the tail of the previous frame prefixed to every
   256-sample 8 kHz frame). Without it the model scored the caller's clear
   79 dB speech at **0.00**, so the turn was closed after "can I" and Whisper
   got a chopped clip. Fixed in `src/pitch/vad/silero.js` (`CONTEXT_SAMPLES`).
   Replay of the same call: speech now scores 0.9–1.0, silence 0.00.
   **This is the real reason the "phone voice only reaches 0.2–0.5" note
   above was true — it was never the phone line.** The 0.5/0.35 thresholds
   may now be revisited, but they work as-is.
2. **Whisper medium mis-heard narrowband phone audio** even on the full
   clip ("Pinag-a-book pa table for two"). Switched the live server to
   `models/ggml-large-v3-turbo.bin` (CPU, same flags). On the same clips it
   got "Can I book a table for two?", "September 25, 4 PM.",
   "mas romantic na place." correct with `auto`, `en` and `tl`. Speed about
   the same as medium (~4.8 s per clip on CPU).
New whisper start command:
`./build/bin/whisper-server --host 127.0.0.1 --port 8188 --model models/ggml-large-v3-turbo.bin --language auto --threads 16 --no-speech-thold 0.90`
Backup: `/tmp/silero.js.bak-0924`. Careful: `pkill -f whisper-server` over
SSH also kills the SSH shell itself (its command line contains the pattern) —
use `pgrep -f "[w]hisper-server"` style patterns.

**Follow-up 2 — Taglish too quiet / "pa-book" unclear (24 Sep):**
Method: synthesize → simulate the phone line (8 kHz μ-law, −6 dB) → Whisper
large-v3-turbo with `language=tl`, repeated 3–4× per phrase (the voice is
random per call). Scripts: `/tmp/rt*.py` on Bosgame.
- **"pabook" is the problem word, not the voice.** "Gusto mo ba itong pabook?"
  → "book" heard **0/4** on both the current voice and the Irenz voice.
  "…i-book natin ito?" → 4/4 on both; "…itong i-book?" → 4/4. espeak en-us
  reads "pabook" as one English-looking word "PAH-buk".
- **The voice trails off at the end of sentences:** last words measured
  3–7 dB quieter than the rest.
- Tried a Tagalog phonetic spelling layer (raw `[[ phonemes ]]` into Piper):
  **worse** (avg 0.45 → 0.25) — the voices learned from en-us phonemes, so
  feeding real Tagalog phonemes confuses them. Not used. Revisit only if a
  voice is retrained with Tagalog phonemes.
- Irenz checkpoint `epoch=3289` exported to
  `~/projects/piper-serve/voices/irenz_e3289.onnx` (not live). Scored about
  the same as the current voice overall (0.49–0.53 vs 0.45–0.50) — slightly
  better on some lines. A voice choice, not a fix.

Changes (Pitch restarted, live):
1. `src/pitch/audio-level.js` (new): automatic gain control on every Piper
   sentence — lifts the quiet tail, soft-limits peaks. Tail drop went from
   −5.5/−7.0 dB to −1.1/−3.6 dB. Off switch: `piperLevelSpeech: false`.
2. `prepareTaglishTtsText()` in `local-pipeline.js`, applied only to the Piper
   text: `pabook / pa-book / ipa-book / pina-book` (and reserve, schedule,
   order, confirm, … — explicit verb list so real Tagalog like "pakiulit"
   is untouched) → `i-book`; `PHP 3,500` / `₱3,500` → `3,500 pesos`.
3. Both reply prompts now tell the LLM: say "i-book natin ito", never
   "pabook", don't end a sentence on the English verb, prices as "3,500 pesos".
Backup: `/tmp/local-pipeline.js.bak-0924b`.

**Follow-up 3 — "magpabuk ng iba pang detalye" (24 Sep):**
Pitch said *"Gusto ninyo bang magpabuk ng iba pang detalye?"*. The voice was
fine here (round-trip heard "magpabok ng iba pang detalhe"). The **wording** was
the problem: the LLM copied Whisper's spelling "magpabuk" from the caller and
built an awkward sentence ("book other details?"). Separately, Whisper `auto`
heard the caller's "Ano? Ano sa nabi mo?" as Spanish.
Changes: both reply prompts now say: do not copy misspelled caller words; ask
"May gusto pa ba kayong idagdag sa booking?" / "May iba pa po ba kayong
kailangan?" (round-trip 4/4, score 1.00); do not comment on the language unless
asked. `pitch-config.json` `whisperLanguage` set to `tl` (same result as `auto`
on every English/Taglish clip from today, but no Spanish).
Backup `/tmp/local-pipeline.js.bak-0924c`.

**Follow-up 4 — "Ano ang iyong gustong lugar?" (24 Sep):**
The question was vague ("what place do you want?") and the voice only got
"lugar" across 2/4 times. Worse, when the caller said "Anong sinabi mo?" the
LLM repeated the same sentence word for word. Direct tests of the reply
prompt showed **Qwen3-8B's Tagalog is the weak link** (it produced nonsense
like "mag-imbuk", "salaping kape", re-asked the party size).
**Gemma-SEA-LION-v4.5-E2B-IT (Q8_0)** — already downloaded at
`/srv/models/sea-lion/` — gave natural Taglish ("Saan po ninyo gustong umupo,
sa loob, sa labas, o malapit sa bintana?"), rephrased properly on
"Anong sinabi mo?" ("Tinatanong ko lang po kung saan ninyo gustong umupo…"),
and is fast (~0.8 s per full reply).
Changes:
- New llama-server for it on **port 8090** (GPU/ROCm). Needs the same
  `LD_LIBRARY_PATH` as the port-8080 router (copy from
  `/proc/<router pid>/environ`), then:
  `./build/hip/bin/llama-server --host 127.0.0.1 --port 8090 --jinja -ngl 999 -c 16384 -m /srv/models/sea-lion/Gemma-SEA-LION-v4.5-E2B-IT-Q8_0.gguf --alias sealion`
- `pitch-config.json` → `qwenApiUrl: http://127.0.0.1:8090/v1/chat/completions`,
  `qwenModel: sealion` (the field names still say "qwen"; revert both to go
  back to Qwen3-8B on 8080).
- `.env`: `PITCH_LOCAL_TEMPERATURE=0.3` (was the 0.75 default — less random
  Tagalog), `PITCH_LOCAL_MAX_OUTPUT_TOKENS=80` (was 45 — Taglish questions
  with choices need more tokens). Backup `/tmp/env.bak-0924`.
- Prompt rules added: concrete questions with the choices spelled out, "po/ninyo",
  no "Mam/Sir", and rephrase simply (never repeat verbatim) when asked "Ano?".

**Parallel session warning (again):** a Qwen3-ASR test copy of Pitch lives in
`temp/qwen-asr/pitch-copy` (own config, own copy of the code from ~08:27).
Its README says it takes over extension 8001 by stopping production Pitch. It
did exactly that at 01:35:18Z, so **none of today's later fixes (TTS rewrite,
leveler, prompt rules, SEA-LION) are in the instance currently answering
calls** until production Pitch is started again. Only one of them can hold
8001 at a time.
---

## Run it

Bosgame is a plain Linux box, not launchd. Pitch is a foreground `npm`
process kept alive manually — there is no supervisor yet (see "Still open"
below). SSH alias: `bosgame`.

```bash
# restart Pitch itself
pkill -f "node src/pitch/index.js"; sleep 2
cd /srv/apps/aistaff && nohup npm run pitch > /tmp/pitch.log 2>&1 &

# the three backend services it depends on (local pipeline only)
pgrep -fa whisper-server      # port 8188
pgrep -fa "llama-server"      # port 8080 (Qwen3-8B router)
pgrep -fa "piper.http_server" # port 5001
```

**Known flake:** the first `nohup ... &` right after an SSH command often
silently fails to actually start the process (no error, just doesn't run).
Always verify with `pgrep` after starting anything, and retry the start
command once if it's not there — this happened dozens of times this session
and is a tooling quirk, not a code bug.

**A code change to any `.js` file requires a Pitch restart to take effect**
(Node caches required modules at startup). Swapping the Whisper/Piper model
files does NOT require a Pitch restart, since those are separate processes
Pitch talks to over HTTP per-utterance.

---

## The two pipelines

Switch in `local-runtime/pitch-config.json` (`{"pipeline": "local"}` or
`{"pipeline": "gemini-live"}`), then restart Pitch. **Note:** this file's
own admin-UI save flow (`pitch-admin.js`'s `/restart` route) depends on
`local-runtime/bin/restart-voice-stack.sh`, which does not exist on Bosgame
— it's a macOS-only script from the old setup, never ported. Until it's
rewritten for Linux, switching pipelines from the UI will save correctly
but **will not actually take effect** without someone manually restarting
Pitch over SSH, same as everything else in this doc.

| | Gemini Live | Local |
|---|---|---|
| Path | speech ↔ speech, Google-hosted | Whisper (STT) → Qwen3-8B (LLM) → Piper (TTS) |
| Reliability | Proven, always worked all session | Extensively debugged this session, now in a genuinely good state |
| Latency | ~500ms | Varies by config — see below |
| Voice | Google prebuilt | Piper `.onnx`, several test voices (below) |

**Use Gemini Live for anything that must not fail** (demos, visitors). Use
Local for continued tuning/testing — it's gotten much better this session
but still has open issues (below).

---

## Local pipeline — validated baseline configuration

This is the configuration confirmed working well across multiple real
calls. If a future session's experiments make things worse, **revert to
these exact values first** before assuming something else is wrong.

**`src/pitch/runtime-config.js`** (`local` block):
```js
vadPositiveSpeechThreshold: 0.5,   // lowered from Pithagoras's 0.65 -- see below
vadNegativeSpeechThreshold: 0.35,  // Pithagoras's own value, unchanged
vadMinSpeechMsSilero: 256,         // Pithagoras's own value, unchanged
vadPreSpeechPadMs: 640,            // raised from Pithagoras's 320 -- see below
vadRedemptionMs: 2000,             // raised from Pithagoras's 1000 -- see below
```
`bargeInEnabled: true`

**`src/pitch/config.js`** (barge-in specific, added this session):
```js
vadBargeInThreshold: 0.35,     // separate, more sensitive threshold just for barge-in
vadBargeInSustainMs: 120,      // ~one syllable, not a single 32ms frame
vadMaxSpeechMs: 12000,         // hard cap so a stuck utterance can't hang forever
```

**Whisper:** model `medium` (NOT `small`, NOT `base` — see "What was
learned" below), running on the **CPU** binary (`build/bin/whisper-server`,
NOT the GPU/ROCm `build-hip` one — the GPU build produced inconsistent,
occasionally-wrong transcriptions on identical clean audio; CPU did not),
with `--no-speech-thold 0.90` (raised from the 0.60 default — see below).
Full current start command:
```bash
cd ~/projects/whisper && ./build/bin/whisper-server \
  --host 127.0.0.1 --port 8188 --model models/ggml-medium.bin \
  --language auto --threads 16 --no-speech-thold 0.90
```

**Piper:** currently serving a temporary test voice,
`zonos1110_22050_epoch180.onnx` (in `~/projects/piper-serve/voices/` on
Bosgame). The original English voice (`en_US-lessac-medium.onnx`) is
**untouched on disk** — switching back is just restarting the port-5001
server pointed at it. An intermediate test voice, `zonos1110_22050_epoch25`,
also still exists, untouched.

**LLM:** Qwen3-8B-Q4_K_M via the `llama-server` router on port 8080 (ROCm
GPU build — this one is fine on GPU, no issue found here).

---

## What was learned this session (the "why" behind the above)

Roughly a dozen distinct bugs were found and fixed. In rough order of
discovery:

1. **VAD "too short" bug**: the original wall-clock-vs-confident-frames
   duration calculation undercounted real utterances with any quiet
   moments, silently discarding entire replies. Fixed: count every frame in
   the speaking span, not just confidently-voiced ones.
2. **No max-utterance safety valve**: an utterance that never got a clean
   `redemptionMs` of silence could hang forever. Added `maxSpeechMs` to
   force-close.
3. **Greeting-protection didn't protect the reply pipeline, only playback**:
   a sound during the greeting could still get queued and replied to (the
   "[coughing]" incident). Fixed to discard, not just ignore for barge-in
   purposes.
4. **Whisper prompt-leakage hallucination**: the original prompt
   ("Transcribe... Do not translate.") was instruction-shaped and Whisper
   sometimes echoed fragments of it back as if they were transcribed
   speech. Fixed: `translate` is now a real API parameter, not prompt text,
   and the prompt itself is a natural example phrase, not an instruction.
5. **Piper onset artifact**: Piper's raw output has a genuine, measurable
   burst of instability/noise in roughly the first 250-450ms of any
   greeting (confirmed directly against raw Piper output, independent of
   our code) — a known VITS-family characteristic. Fixed with a fade-in
   (currently 450ms, 10%→100% volume) applied only to the cached greeting.
   Needed re-tuning (300ms wasn't quite enough) when the voice changed to
   epoch180 — **a voice change may require re-checking this fade window.**
6. **Confidence + compression-ratio hallucination guards** added to
   `_transcribe()`: discards Whisper output with high `no_speech_prob` /
   very negative `avg_logprob`, or highly repetitive (gzip-ratio) text.
7. **Non-speech marker filter was a word-blacklist, not a pattern**: only
   matched `[BLANK_AUDIO]` etc. by name; Whisper can emit many different
   bracketed annotations (`[BIRD CHIRPING]` was seen live). Fixed to match
   the *pattern* (entirely bracketed content) instead of specific words.
8. **`positiveSpeechThreshold` (0.65, Pithagoras's own value) is measurably
   too strict for real phone-line audio.** Confirmed directly: this
   caller's real, clearly-audible voice on this line frequently produces
   Silero confidence scores in the 0.2-0.5 range, well under 0.65. Lowered
   to 0.5. This is a deliberate, evidence-based deviation from "copy
   Pithagoras exactly" — phone/PCMU audio is fundamentally lower-fidelity
   than the browser-mic audio Pithagoras's defaults were tuned for.
9. **Barge-in was gated behind the same slow `minSpeechMs` (256ms)
   accumulation as full utterance capture**, so a quick interruption whose
   confidence didn't sustain the full 256ms could simply never register.
   Fixed with a separate, faster, more sensitive path (`bargeInThreshold`
   0.35, `bargeInSustainMs` 120ms — deliberately more than a single 32ms
   frame, to still require something syllable-like rather than firing on
   noise).
10. **Whisper model/hardware reliability, the big one**: tested base (GPU),
    small (GPU), small (CPU), medium (CPU) against the *exact same* real
    recorded phrase ("Can you book me a table for two?"):
    - base (any hardware): confidently hallucinated in **random foreign
      scripts** (Korean, Arabic, Hebrew) for simple English/Taglish input.
    - small on the GPU/ROCm build: measurably inconsistent — sometimes
      correct, sometimes garbage, on identical repeated content.
    - small on CPU: much better, occasional garbling remained.
    - **medium on CPU: correct, repeatedly, on real saved audio from failed
      calls** — verified directly, not just assumed. ~2.5s slower per turn
      than small, judged worth it since a wrong transcription costs far
      more (a whole repeat-and-recover cycle) than a slower correct one.
11. **`no_speech_thold` (whisper.cpp's own internal "is this silence, don't
    bother transcribing" cutoff, default 0.60) was causing Whisper to
    refuse to even attempt transcribing genuine, clearly-audible speech**
    — confirmed by resending an actual saved segment (independently
    confirmed by ear to contain real speech: "can you book me a table for
    two") that Whisper had returned `[BLANK_AUDIO]` for with
    `no_speech_prob` 0.64-0.87. Raised to 0.90 so Whisper is much less
    willing to give up without trying. **This was mid-verification when the
    session ended — the fix was applied and the server restarted, but a
    live call confirming it actually resolves the issue had not yet
    happened.** This should be the first thing tested next session.
12. **A hallucinated booking confirmation**: the LLM said "I've noted your
    reservation..." without ever actually calling `book_appointment`. Real
    booking creation is wired correctly (reuses `createMessengerBooking`
    from `messenger-webhook.js`, confirmed working via a real database
    write in at least one call) but the prompt doesn't yet stop the model
    from *claiming* success without the tool's result. **Not yet fixed.**

### A note on parallel edits

Multiple times this session, VAD thresholds, the Whisper model file, and
even the Piper voice were found to have been changed by something other
than this conversation (very likely a concurrent Codex session working on
the same Bosgame box). Some of those changes were reasonable improvements
(new debug timing metrics, a wall-clock speech-duration fix identical in
spirit to one built here); others actively regressed things (VAD thresholds
tuned so aggressively sensitive that echo of Pitch's own voice was
triggering false detections, `bargeInEnabled` flipped off entirely). **If
behavior seems to have inexplicably changed between sessions, check
`runtime-config.js`, `config.js`, and `vad/silero.js` against the validated
baseline above before assuming new code is broken.**

---

## Debugging tools built this session (reusable)

- **`local-runtime/pitch-whisper-debug/`**: every single audio clip sent to
  Whisper is now saved here automatically (timestamped `.wav` files),
  matched to its log line. This is the most reliable way to inspect what a
  specific attempt actually contained — standalone VAD-replay against a
  full call recording was tried repeatedly and **does not reliably
  reconstruct real timing** (it can't replicate the live
  playback-protection gating), so don't trust that method for precise
  segment boundaries again. This debug folder will grow unboundedly; it has
  no cleanup yet.
- **`local-pipeline.js`'s new per-attempt debug log line**: logs the exact
  input audio duration, raw Whisper text, and per-segment
  `no_speech_prob`/`avg_logprob` for every attempt, including ones about to
  be discarded. Essential for diagnosing anything Whisper-related — read
  this before speculating.

---

## Still open, not yet done

1. **Verify the `no_speech_thold=0.90` fix actually works live** (see #11
   above) — this is the most likely next real win.
2. **Rewrite `restart-voice-stack.sh` for Linux** so pipeline-switching and
   settings changes actually take effect from the AI Studio admin UI
   instead of requiring manual SSH restarts every time.
3. **Stop the LLM from claiming a booking succeeded when the tool was never
   called** (#12 above) — needs a prompt change requiring the tool's actual
   result before confirming anything to the caller.
4. **A live/reviewable call transcript UI** — requested, doesn't exist yet.
   The raw material already exists in
   `local-runtime/pitch-conversations/*.jsonl` (one line per message,
   written in real time); this would be a viewer for that, not new data
   plumbing.
5. **A "sorry, didn't catch that" spoken acknowledgment on discard** —
   currently a correctly-discarded low-confidence/blank attempt produces
   pure silence, which feels to the caller like the system ignoring them
   rather than a working safety filter. Proposed, not yet built.
6. **The "pause after partial interruption, then check in" flow** the user
   described (2 seconds of silence after a partial interruption → ask if
   they want to continue → "go ahead" → resume with context) — discussed,
   not yet designed or built.
7. **No process supervisor for Pitch on Bosgame** — it's a manually-started
   foreground process. A brownout or reboot this session killed it (and
   the Piper training run) multiple times, requiring manual restart each
   time.
8. **Onset clipping**: the first word or two of an utterance can still get
   clipped occasionally even after raising `preSpeechPadMs` to 640ms —
   improved, not fully eliminated.

---

## ZONOS2 / Piper Taglish voice training

Full 1,110-line synthetic corpus (ZONOS2-generated) exists at
`~/projects/piper-train/dataset-zonos1110-22050-abs-*` on Bosgame (the
**22.05kHz preprocessing is important** — an earlier 44.1kHz-preprocessed
run against the 22.05kHz Lessac base is what caused a "monster/warbly"
voice; a from-scratch fresh-learning-rate run was also tried and
abandoned in favor of the corrected-sample-rate run once the real cause
was found).

Currently exported/tested checkpoints, none deleted:
- `zonos1110_22050_epoch25.onnx` (fine-tune epoch ~25)
- `zonos1110_22050_epoch180.onnx` (fine-tune epoch ~180, **currently live**)

Training itself is currently **paused**, not running. The full run's
checkpoints live at
`~/projects/piper-train/training-zonos1110-22050-cleanrun-*/lightning_logs/lightning_logs/version_1/checkpoints/`
if resuming is wanted later.

---

## Next planned direction: Qwen-Omni

Discussed but not started: adding a **third** option alongside Gemini Live
and the current Local (Whisper→Qwen3-8B→Piper relay) pipeline — Qwen-Omni,
a genuine speech-to-speech model, tested first in English only. The plan is
explicitly to **keep the current Local pipeline intact**, not replace it —
this would be a new, separate option to compare against. If it handles
barge-in well in English, the next step would be training it for Taglish.
Nothing has been built for this yet; it's the starting point for the next
session. Worth budgeting real time specifically to test barge-in behavior,
not just basic responsiveness — real-time duplex audio is a materially
different (and less mature) engineering problem than the turn-based
STT→LLM→TTS relay this session spent most of its time on.
