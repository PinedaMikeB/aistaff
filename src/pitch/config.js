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

require("dotenv").config({ override: true });

function bool(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  // Master feature flag. Pitch never affects Closer or Brandee when off.
  enabled: bool(process.env.PITCH_ENABLED, false),

  // Which speech-to-speech brain to use. "openai" today; "gemini" once a
  // GEMINI_API_KEY exists. Adapter selected in brain/index.js.
  brainProvider: process.env.PITCH_BRAIN_PROVIDER || "openai",

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
    realtimeModel: process.env.PITCH_REALTIME_MODEL || "gpt-realtime",
    voice: process.env.PITCH_VOICE || "marin",
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    // Native-audio (speech-to-speech) model. Must be a *live* / native-audio
    // model — a normal Gemini model cannot do audio in/audio out and would
    // force an STT->TTS chain, which is forbidden.
    // 3.1-flash-live measured 637ms to first audio vs 9515ms for
    // 2.5-flash-native-audio. On a phone call that gap is the whole product.
    liveModel: process.env.PITCH_GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview",
    // Prebuilt voice name only. There is deliberately no language setting.
    voice: process.env.PITCH_GEMINI_VOICE || "Aoede",
    // Plain text model for SMS. Live/native-audio models bill at audio rates,
    // which would be absurd for typed messages.
    // gemini-3.5-flash-lite: ~940ms, clean Taglish, and it does NOT burn the
    // output budget on internal reasoning the way 3.6-flash and flash-latest
    // do — both returned truncated fragments on a 200-token cap.
    // Do not pin 2.5-flash: it is closed to new accounts and fails at runtime.
    textModel: process.env.PITCH_GEMINI_TEXT_MODEL || "gemini-3.5-flash-lite",
  },

  // Business identity spoken on answer. Falls back to brand vars already
  // present in .env.
  business: {
    name: process.env.PITCH_BUSINESS_NAME || process.env.BUSINESS_BRAND_NAME || "AIStaff",
    agentName: process.env.PITCH_AGENT_NAME || "Pitch",
  },

  logLevel: process.env.PITCH_LOG_LEVEL || "info",
};

module.exports = { config };
