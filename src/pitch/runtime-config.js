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
  // "local"           = whisper -> text brain -> local TTS
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

  local: {
    // Piper is only the voice. This chooses the LLM that thinks/orchestrates.
    brainProvider: "gemini",        // gemini | openai
    geminiTextModel: "gemini-3.5-flash-lite",
    openaiTextModel: "gpt-4.1-mini",

    // Which local TTS engine the local pipeline uses.
    ttsEngine: "piper",             // piper | kokoro | zonos2
    piperVoice: "gab_taglish_epoch59",
    piperSpeakerId: null,           // for multi-speaker models
    piperLengthScale: 1.0,          // >1 slower, <1 faster
    piperNoiseScale: 0.667,
    piperVolumeDb: -5,              // lower Gab without retraining
    zonos2Url: "http://127.0.0.1:1919/tts/generate",
    zonos2SpeakerId: "",            // e.g. default_ad689b18cfb01a0d = AmericanFemale
    zonos2SessionId: "",            // only needed for uploaded/cached speakers
    zonos2Seed: 12,
    zonos2Speed: 0.85,
    zonos2MaxTokens: 700,
    greetingText: "Hello, this is Pitch, your AI sales and support staff. How can I help you today?",
    greetingStartDelayMs: 250,
    whisperModel: "ggml-medium",
    whisperLanguage: "auto",        // auto | en | tl
  },

  // Barge-in: cutting the agent off when the caller starts speaking.
  // Endpoint VAD is NOT affected by this — the pipeline cannot work without it.
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
