"use strict";

/**
 * Piper voice catalogue for the admin UI.
 *
 * Reads the cached rhasspy/piper-voices index and annotates it with gender,
 * which the upstream index does not carry. Gender is curated for the English
 * voices we actually offer; everything else is reported as "unknown" rather
 * than guessed.
 */
const fs = require("fs");
const path = require("path");

const PIPER_DIR = path.join(__dirname, "..", "..", "local-runtime", "piper");
const INDEX_PATH = path.join(PIPER_DIR, "voices.json");
const VOICE_DIR = path.join(PIPER_DIR, "voices");

// Curated gender map. Sources: the original datasets behind each voice.
const GENDER = {
  // en_US female
  amy: "female", hfc_female: "female", kathleen: "female", kristin: "female",
  lessac: "female", ljspeech: "female",
  // en_US male
  bryce: "male", danny: "male", hfc_male: "male", joe: "male", john: "male",
  kusal: "male", norman: "male", ryan: "male", sam: "male", mike: "male",
  reza_ibrahim: "male",
  // en_GB female
  alba: "female", cori: "female", jenny_dioco: "female",
  southern_english_female: "female",
  // en_GB male
  alan: "male", northern_english_male: "male",
  // multi-speaker corpora — mixed genders inside one model
  aru: "mixed", semaine: "mixed", vctk: "mixed", arctic: "mixed",
  l2arctic: "mixed", libritts: "mixed", libritts_r: "mixed",
};

const QUALITY_ORDER = { low: 0, medium: 1, high: 2 };

function loadIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  } catch {
    return {};
  }
}

/** Which voices are actually downloaded and ready to use right now. */
function installedVoices() {
  try {
    return new Set(
      fs.readdirSync(VOICE_DIR)
        .filter((f) => f.endsWith(".onnx"))
        .map((f) => f.replace(/\.onnx$/, ""))
    );
  } catch {
    return new Set();
  }
}

/**
 * Full catalogue, grouped by language.
 * Each voice reports whether it is installed, so the UI can show a download
 * action rather than silently failing when someone picks a missing model.
 */
function listVoices({ language = null, gender = null } = {}) {
  const index = loadIndex();
  const installed = installedVoices();
  const out = [];

  for (const [key, meta] of Object.entries(index)) {
    const lang = meta.language || {};
    const code = lang.code || "";
    if (language && code !== language) continue;

    const speaker = meta.name || "";
    const g = GENDER[speaker] || "unknown";
    if (gender && g !== gender && g !== "mixed") continue;

    out.push({
      key,
      name: speaker,
      language: code,
      languageName: lang.name_english || code,
      country: lang.country_english || "",
      quality: meta.quality || "medium",
      gender: g,
      numSpeakers: meta.num_speakers || 1,
      speakerIds: meta.speaker_id_map || null,
      installed: installed.has(key),
      // Relative path inside the HF repo, for on-demand download.
      downloadPath: (meta.files ? Object.keys(meta.files).find((f) => f.endsWith(".onnx")) : null),
    });
  }

  out.sort((a, b) =>
    a.language.localeCompare(b.language)
    || a.name.localeCompare(b.name)
    || (QUALITY_ORDER[b.quality] - QUALITY_ORDER[a.quality]));
  return out;
}

/** Distinct languages, for the dropdown. */
function listLanguages() {
  const index = loadIndex();
  const map = new Map();
  for (const meta of Object.values(index)) {
    const lang = meta.language || {};
    if (!lang.code) continue;
    if (!map.has(lang.code)) {
      map.set(lang.code, {
        code: lang.code,
        name: lang.name_english || lang.code,
        country: lang.country_english || "",
        voices: 0,
      });
    }
    map.get(lang.code).voices += 1;
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

module.exports = { listVoices, listLanguages, installedVoices, VOICE_DIR, INDEX_PATH };
