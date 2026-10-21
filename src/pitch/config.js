"use strict";

/**
 * Pitch — configuration and feature flag.
 *
 * Pitch runs as its OWN process (scripts/pitch-dev.sh / its own launchd job),
 * NOT inside src/server.js. RTP is latency sensitive and must not share an
 * event loop with Express, Brandee image generation, or Prisma queries.
 *
 * Everything here is env-driven. Nothing about language, voice, or persona
 * wording is configured — Pitch adapts to the caller at runtime.
 */

const path = require("path");

require("dotenv").config({ override: true });

function bool(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const { resolveBrainProvider, readConfig } = require("./runtime-config");
const runtimeConfig = readConfig();

const config = {
  // Master feature flag. Pitch never affects Closer or Brandee when off.
  enabled: bool(process.env.PITCH_ENABLED, false),

  // Which voice pipeline to use. `gemini` is the proven live fallback.
  // `local` is whisper.cpp/VAD -> Gemini text -> local TTS (Piper).
  //
  // The AI Studio "Pitch" tab writes local-runtime/pitch-config.json, which
  // takes priority over the env var so the toggle actually reroutes calls.
  // When no config file exists the env var wins, so behaviour is unchanged
  // until someone uses the UI. Read at startup — a restart applies a change.
  brainProvider: resolveBrainProvider(process.env.PITCH_BRAIN_PROVIDER || "openai"),

  sip: {
    // The AIO100 gateway acts as the SIP server (built-in IPPBX).
    gatewayHost: process.env.PITCH_SIP_GATEWAY_HOST || "192.168.100.200",
    // wan_default profile listens on 5080, NOT 5060. lan_default is 5060.
    gatewayPort: int(process.env.PITCH_SIP_GATEWAY_PORT, 5080),

    // Extension credentials created on the AIO100 (Extension -> SIP).
    username: process.env.PITCH_SIP_USERNAME || "8001",
    password: process.env.PITCH_SIP_PASSWORD || "",

    // This machine, as reachable BY the gateway. Must be the LAN IP, not
    // 127.0.0.1 — the gateway sends RTP here.
    localHost: process.env.PITCH_SIP_LOCAL_HOST || "192.168.100.72",
    localPort: int(process.env.PITCH_SIP_LOCAL_PORT, 5062),

    registerExpires: int(process.env.PITCH_SIP_REGISTER_EXPIRES, 300),
  },

  rtp: {
    portStart: int(process.env.PITCH_RTP_PORT_START, 40000),
    portEnd: int(process.env.PITCH_RTP_PORT_END, 40100),
    // 20ms @ 8kHz = 160 samples = 160 bytes of G.711.
    ptimeMs: 20,
  },

  call: {
    // Hard ceiling so a stuck call can never run forever.
    maxDurationMs: int(process.env.PITCH_MAX_CALL_MS, 10 * 60 * 1000),
    // Assume ONE cellular channel until hardware proves otherwise.
    maxConcurrent: int(process.env.PITCH_MAX_CONCURRENT_CALLS, 1),
  },

  sms: {
    // Off unless explicitly enabled. Sending texts costs money and reaches
    // real people, so it must never switch itself on.
    enabled: bool(process.env.PITCH_SMS_ENABLED, false),
    // Replying to inbound texts. Separate flag from sending during a call:
    // a reply is a conversation the customer started, which is the safe half.
    replyEnabled: bool(process.env.PITCH_SMS_REPLY_ENABLED, false),
    // Hard caps enforced in code, NOT in the prompt. A model with a messaging
    // tool and no limit is a liability.
    maxPerCall: int(process.env.PITCH_SMS_MAX_PER_CALL, 2),
    maxPerInbound: int(process.env.PITCH_SMS_MAX_PER_INBOUND, 2),
    // The SIM truncates beyond this; we refuse rather than send a cut-off text.
    maxChars: int(process.env.PITCH_SMS_MAX_CHARS, 170),

    // Loop guard. Uncapped back-and-forth is fine for a human, but an
    // auto-responder on the other end will ping-pong forever — burning
    // messages, looking exactly like spam to the carrier, and running all
    // night. These never fire for a real person texting about a booking.
    maxPerThreadPerDay: int(process.env.PITCH_SMS_MAX_PER_THREAD_DAY, 30),
    // Replies closer together than this count as a possible machine loop.
    loopWindowMs: int(process.env.PITCH_SMS_LOOP_WINDOW_MS, 4000),
    maxRapidExchanges: int(process.env.PITCH_SMS_MAX_RAPID, 4),
    // Nothing sent outside these hours (Asia/Manila), whatever the trigger.
    quietStartHour: int(process.env.PITCH_SMS_QUIET_START, 21),
    quietEndHour: int(process.env.PITCH_SMS_QUIET_END, 7),
    // Threads idle longer than this start fresh.
    threadIdleMs: int(process.env.PITCH_SMS_THREAD_IDLE_MS, 6 * 60 * 60 * 1000),
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    realtimeModel: runtimeConfig.openaiRealtime?.model
      || process.env.PITCH_REALTIME_MODEL || "gpt-realtime",
    voice: runtimeConfig.openaiRealtime?.voice
      || process.env.PITCH_VOICE || "marin",
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    // Native-audio (speech-to-speech) model. Must be a *live* / native-audio
    // model — a normal Gemini model cannot do audio in/audio out and would
    // force an STT->TTS chain, which is forbidden.
    // 3.1-flash-live measured 637ms to first audio vs 9515ms for
    // 2.5-flash-native-audio. On a phone call that gap is the whole product.
    liveModel: runtimeConfig.geminiLive?.model
      || process.env.PITCH_GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview",
    // Prebuilt voice name only. There is deliberately no language setting.
    // The AI Studio Pitch tab overrides this; env is the fallback.
    voice: runtimeConfig.geminiLive?.voice
      || process.env.PITCH_GEMINI_VOICE || "Aoede",
    // Plain text model for SMS. Live/native-audio models bill at audio rates,
    // which would be absurd for typed messages.
    // gemini-3.5-flash-lite: ~940ms, clean Taglish, and it does NOT burn the
    // output budget on internal reasoning the way 3.6-flash and flash-latest
    // do — both returned truncated fragments on a 200-token cap.
    // Do not pin 2.5-flash: it is closed to new accounts and fails at runtime.
    textModel: process.env.PITCH_GEMINI_TEXT_MODEL || "gemini-3.5-flash-lite",
  },

  localPipeline: {
    // Stack 4 uses Qwen3-ASR with deterministic English/Filipino comparison.
    whisperUrl: runtimeConfig.local?.asrUrl
      || process.env.PITCH_LOCAL_ASR_URL || "http://127.0.0.1:8190/inference",
    whisperModel: runtimeConfig.local?.whisperModel
      || process.env.PITCH_LOCAL_WHISPER_MODEL || "whisper-1",
    // Qwen's auto detector can mistake short phone audio for another language.
    // Taglish mode compares auto, English, and Filipino decodes per utterance.
    whisperLanguage: runtimeConfig.local?.whisperLanguage
      || process.env.PITCH_LOCAL_WHISPER_LANGUAGE || "taglish",
    asrContext: runtimeConfig.local?.asrContext
      || process.env.PITCH_LOCAL_ASR_CONTEXT || "",
    // Text reasoning model. Separate from Live because this path already has
    // audio handled by Whisper/VoxCPM2.
    // "qwen" is the Pithagoras-proven local brain: Qwen3-8B on Bosgame's GPU
    // via a plain llama.cpp OpenAI-compatible endpoint, called directly (no
    // pi, no agent framework -- see brain/local-pipeline.js _replyToStreaming).
    brainProvider: runtimeConfig.local?.brainProvider
      || process.env.PITCH_LOCAL_BRAIN_PROVIDER || "qwen",
    qwenApiUrl: runtimeConfig.local?.qwenApiUrl
      || process.env.PITCH_LOCAL_QWEN_API_URL || "http://127.0.0.1:8080/v1/chat/completions",
    qwenModel: runtimeConfig.local?.qwenModel
      || process.env.PITCH_LOCAL_QWEN_MODEL || "Qwen3-8B-Q4_K_M",
    geminiTextModel: runtimeConfig.local?.geminiTextModel
      || process.env.PITCH_LOCAL_GEMINI_TEXT_MODEL ||
      process.env.PITCH_GEMINI_TEXT_MODEL || "gemini-3.5-flash-lite",
    openaiTextModel: runtimeConfig.local?.openaiTextModel
      || process.env.PITCH_LOCAL_OPENAI_TEXT_MODEL || "gpt-4.1-mini",
    piperVoice: runtimeConfig.local?.piperVoice || "",
    piperSpeakerId: runtimeConfig.local?.piperSpeakerId ?? null,
    piperLengthScale: Number.isFinite(Number(runtimeConfig.local?.piperLengthScale))
      ? Number(runtimeConfig.local.piperLengthScale) : 1.0,
    piperNoiseScale: Number.isFinite(Number(runtimeConfig.local?.piperNoiseScale))
      ? Number(runtimeConfig.local.piperNoiseScale) : 0.667,
    piperVolumeDb: Number.isFinite(Number(runtimeConfig.local?.piperVolumeDb))
      ? Number(runtimeConfig.local.piperVolumeDb) : -6,
    piperGreetingCacheDir: process.env.PITCH_PIPER_GREETING_CACHE_DIR
      || path.join(__dirname, "..", "..", "local-runtime", "pitch-greetings"),
    greetingText: runtimeConfig.local?.greetingText
      || process.env.PITCH_PIPER_GREETING_TEXT
      || "Hello, this is Pitch, your AI sales and support staff. How can I help you today?",
    greetingStartDelayMs: Number.isFinite(Number(runtimeConfig.local?.greetingStartDelayMs))
      ? Number(runtimeConfig.local.greetingStartDelayMs)
      : int(process.env.PITCH_PIPER_GREETING_START_DELAY_MS, 250),

    ttsEngine: runtimeConfig.local?.ttsEngine
      || process.env.PITCH_LOCAL_TTS_ENGINE || "piper",

    // The real, correct Piper endpoint. Previously ttsEngine="piper" fell
    // through to voxcpmUrl below with a VoxCPM-shaped payload -- a request
    // format Piper's own server has never understood, and (separately)
    // voxcpmUrl's own default pointed at "/" rather than a real endpoint.
    // Every prior local-pipeline test (English, Gab, Irenz) went through
    // that broken path, which is why the voice used never mattered. This is
    // a plain call to Piper's actual /synthesize route.
    piperUrl: runtimeConfig.local?.piperUrl
      || process.env.PITCH_LOCAL_PIPER_URL || "http://127.0.0.1:5001/synthesize",

    // Historical VoxCPM endpoint. Still used only if ttsEngine is set to
    // anything other than "piper" or "zonos2" -- kept for backward
    // compatibility, not part of the normal local pipeline anymore.
    voxcpmUrl: process.env.PITCH_VOXCPM2_URL || "http://127.0.0.1:9891/",
    voxcpmVoice: process.env.PITCH_VOXCPM2_VOICE || "",
    voxcpmSampleRate: int(process.env.PITCH_VOXCPM2_SAMPLE_RATE, 24000),

    // ZONOS2 local TTS. Used when ttsEngine="zonos2".
    zonos2Url: runtimeConfig.local?.zonos2Url
      || process.env.PITCH_ZONOS2_URL || "http://127.0.0.1:1919/tts/generate",
    zonos2SpeakerId: runtimeConfig.local?.zonos2SpeakerId
      || process.env.PITCH_ZONOS2_SPEAKER_ID || "",
    zonos2SessionId: runtimeConfig.local?.zonos2SessionId
      || process.env.PITCH_ZONOS2_SESSION_ID || "",
    zonos2Seed: int(runtimeConfig.local?.zonos2Seed ?? process.env.PITCH_ZONOS2_SEED, 12),
    zonos2Speed: Number.isFinite(Number(runtimeConfig.local?.zonos2Speed ?? process.env.PITCH_ZONOS2_SPEED))
      ? Number(runtimeConfig.local?.zonos2Speed ?? process.env.PITCH_ZONOS2_SPEED) : 0.85,
    zonos2MaxTokens: int(runtimeConfig.local?.zonos2MaxTokens ?? process.env.PITCH_ZONOS2_MAX_TOKENS, 700),

    requestTimeoutMs: int(
      runtimeConfig.local?.requestTimeoutMs ?? process.env.PITCH_LOCAL_REQUEST_TIMEOUT_MS,
      20000
    ),
    temperature: Number.isFinite(Number(runtimeConfig.local?.temperature ?? process.env.PITCH_LOCAL_TEMPERATURE))
      ? Number(runtimeConfig.local?.temperature ?? process.env.PITCH_LOCAL_TEMPERATURE) : 0.75,
    maxOutputTokens: int(
      runtimeConfig.local?.maxOutputTokens ?? process.env.PITCH_LOCAL_MAX_OUTPUT_TOKENS,
      120
    ),
    historyTurns: int(runtimeConfig.local?.historyTurns ?? process.env.PITCH_LOCAL_HISTORY_TURNS, 6),
    logMetrics: bool(process.env.PITCH_LOCAL_LOG_METRICS, true),

    // Old simple energy VAD fields. No longer used for turn detection (see
    // vad/silero.js) but left here since other code may still reference them.
    vadThreshold: int(process.env.PITCH_LOCAL_VAD_THRESHOLD, 650),
    vadSilenceMs: int(process.env.PITCH_LOCAL_VAD_SILENCE_MS, 700),
    vadMinSpeechMs: int(process.env.PITCH_LOCAL_VAD_MIN_SPEECH_MS, 260),
    vadMaxSpeechMs: int(runtimeConfig.local?.vadMaxSpeechMs ?? process.env.PITCH_LOCAL_VAD_MAX_SPEECH_MS, 12000),

    // Real turn detection: Silero VAD (vad/silero.js), replacing the energy
    // threshold above. This fixes "detects goodbye while I'm still talking" --
    // a flat amplitude threshold cannot tell a natural mid-sentence pause
    // from actually finishing. Values copied exactly from Pithagoras's own
    // voice config, per instruction.
    vadPositiveSpeechThreshold: Number.isFinite(Number(runtimeConfig.local?.vadPositiveSpeechThreshold))
      ? Number(runtimeConfig.local.vadPositiveSpeechThreshold) : 0.65,
    vadNegativeSpeechThreshold: Number.isFinite(Number(runtimeConfig.local?.vadNegativeSpeechThreshold))
      ? Number(runtimeConfig.local.vadNegativeSpeechThreshold) : 0.35,
    vadMinSpeechMsSilero: int(runtimeConfig.local?.vadMinSpeechMsSilero, 256),
    vadPreSpeechPadMs: int(runtimeConfig.local?.vadPreSpeechPadMs, 320),
    vadRedemptionMs: int(runtimeConfig.local?.vadRedemptionMs, 1000),
    // Separate, faster path specifically for barge-in (stopping playback the
    // instant the caller starts talking over Pitch) -- distinct from the
    // thresholds above, which decide whether to bother transcribing
    // something. See vad/silero.js for the full reasoning.
    vadBargeInThreshold: Number.isFinite(Number(runtimeConfig.local?.vadBargeInThreshold))
      ? Number(runtimeConfig.local.vadBargeInThreshold) : 0.35,
    vadBargeInSustainMs: int(runtimeConfig.local?.vadBargeInSustainMs, 120),

    // How long the caller must speak CONTINUOUSLY before we cut the agent off.
    // A single frame over the threshold is a click, a breath, or the agent's
    // own voice echoing back through the gateway — flushing on that truncated
    // the greeting after two words. 300 ms is long enough to be a real word
    // and short enough that interrupting still feels immediate.
    bargeInMinMs: int(process.env.PITCH_LOCAL_BARGE_IN_MIN_MS, 300),
  },

  // Business identity spoken on answer. Falls back to brand vars already
  // present in .env.
  business: {
    name: runtimeConfig.business?.name
      || process.env.PITCH_BUSINESS_NAME || process.env.BUSINESS_BRAND_NAME || "AIStaff",
    agentName: runtimeConfig.business?.agentName
      || process.env.PITCH_AGENT_NAME || "Pitch",
  },

  logLevel: process.env.PITCH_LOG_LEVEL || "info",
};

module.exports = { config };
