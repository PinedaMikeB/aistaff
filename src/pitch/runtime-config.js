"use strict";

/**
 * Pitch runtime configuration — the switchable half of Pitch's settings.
 *
 * WHY A FILE AND NOT .env:
 *   src/pitch/config.js calls dotenv.config({ override: true }), so .env wins
 *   over process.env. A UI toggle therefore cannot work through env vars.
 *
 * WHY NOT THE DATABASE:
 *   CompanySetting is fixed-column, so Pitch settings would need a migration.
 *   Pitch is one local process per gateway, so a JSON file next to it is
 *   simpler and lets Pitch reload without touching Postgres.
 *
 * The file is the source of truth for anything the admin UI can change.
 * Everything else (SIP credentials, API keys) stays in .env.
 */
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = process.env.PITCH_RUNTIME_CONFIG
  || path.join(__dirname, "..", "..", "local-runtime", "pitch-config.json");

const DEFAULTS = {
  // "gemini-live"     = Google native speech-to-speech
  // "openai-realtime" = OpenAI native speech-to-speech
  // "local"           = Qwen3-ASR -> SEA-LION -> Piper epoch 180 (Stack 4)
  pipeline: "gemini-live",

  // Pipeline 1 settings. Gemini Live picks from Google's prebuilt voices;
  // there is no custom voice and no language setting (the model matches
  // whatever the caller speaks).
  geminiLive: {
    model: "gemini-3.1-flash-live-preview",
    voice: "Aoede",
  },

  openaiRealtime: {
    model: "gpt-realtime",
    voice: "marin",
  },

  business: {
    name: "AIStaff",
    agentName: "Pitch",
  },

  local: {
    // Piper is only the voice. This chooses the LLM that thinks/orchestrates.
    // The existing "qwen" provider is the generic local OpenAI-compatible
    // adapter. Stack 4 points it at Gemma-SEA-LION on llama.cpp; no Gemini API
    // is used.
    brainProvider: "qwen",
    asrUrl: "http://127.0.0.1:8190/inference",
    asrContext: "",
    qwenApiUrl: "http://127.0.0.1:8090/v1/chat/completions",
    qwenModel: "sealion",

    // Which local TTS engine the local pipeline uses.
    ttsEngine: "piper",             // piper | kokoro | zonos2
    piperUrl: "http://127.0.0.1:5001/synthesize",
    piperVoice: "zonos1110_22050_epoch180",
    piperSpeakerId: null,           // for multi-speaker models
    piperLengthScale: 1.0,          // >1 slower, <1 faster
    piperNoiseScale: 0.667,
    piperVolumeDb: -4,
    zonos2Url: "http://127.0.0.1:1919/tts/generate",
    zonos2SpeakerId: "",            // e.g. default_ad689b18cfb01a0d = AmericanFemale
    zonos2SessionId: "",            // only needed for uploaded/cached speakers
    zonos2Seed: 12,
    zonos2Speed: 0.85,
    zonos2MaxTokens: 700,
    greetingText: "Hello, this is Pitch, your AI sales and support staff. How can I help you today?",
    greetingStartDelayMs: 250,
    maxOutputTokens: 90,
    temperature: 0.3,
    historyTurns: 6,
    requestTimeoutMs: 20000,
    whisperModel: "Qwen3-ASR-0.6B",
    whisperLanguage: "taglish",

    // Tuned against the 8 kHz AIO100 caller channel. The desktop defaults
    // detected only the last 1.5 seconds of a four-second phone utterance.
    vadPositiveSpeechThreshold: 0.5, // lowered from Pithagoras's 0.65 -- confirmed across two real calls that this caller's actual phone-line voice tops out around 0.45-0.74, often sitting well under 0.65
    vadNegativeSpeechThreshold: 0.35,
    vadMinSpeechMsSilero: 256,
    vadPreSpeechPadMs: 640, // raised from 320 -- confirmed live cutting off the first 1-2 words of an utterance
    vadRedemptionMs: 2000,
    vadMaxSpeechMs: 12000,
    vadBargeInThreshold: 0.35,
    vadBargeInSustainMs: 120,
  },

  // Barge-in: cutting the agent off when the caller starts speaking.
  // Endpoint VAD is NOT affected by this — the pipeline cannot work without it.
  // Keep the SIP pipeline half-duplex until acoustic echo cancellation is
  // available. Otherwise returned agent audio can flush its own RTP playout.
  bargeInEnabled: true,

  updatedAt: null,
};

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = deepMerge(base[k] || {}, v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/** Read the config file, falling back to defaults for anything missing. */
function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return deepMerge(DEFAULTS, raw);
  } catch {
    return { ...DEFAULTS };
  }
}

/** Merge a partial update into the file and return the full new config. */
function writeConfig(patch) {
  const next = deepMerge(readConfig(), patch);
  next.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

/**
 * Which brain provider should run, accounting for the runtime override.
 * Falls back to PITCH_BRAIN_PROVIDER from .env when no file exists yet, so
 * behaviour is unchanged until someone actually uses the UI.
 */
function resolveBrainProvider(envValue) {
  const cfg = readConfig();
  if (cfg.pipeline === "local") return "local";
  if (cfg.pipeline === "gemini-live") return "gemini";
  if (cfg.pipeline === "openai-realtime") return "openai";
  return envValue || "gemini";
}

module.exports = { CONFIG_PATH, DEFAULTS, readConfig, writeConfig, resolveBrainProvider };
