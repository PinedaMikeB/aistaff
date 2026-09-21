"use strict";

const LANGUAGE_NAMES = {
  ar: "Arabic",
  ca: "Catalan",
  cs: "Czech",
  cy: "Welsh",
  da: "Danish",
  de: "German",
  el: "Greek",
  en: "English",
  es: "Spanish",
  fa: "Persian",
  fi: "Finnish",
  fr: "French",
  hu: "Hungarian",
  is: "Icelandic",
  it: "Italian",
  ka: "Georgian",
  kk: "Kazakh",
  lb: "Luxembourgish",
  ne: "Nepali",
  nl: "Dutch",
  no: "Norwegian",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  sk: "Slovak",
  sl: "Slovenian",
  sr: "Serbian",
  sv: "Swedish",
  sw: "Swahili",
  tr: "Turkish",
  uk: "Ukrainian",
  vi: "Vietnamese",
  zh: "Chinese",
};

function piperVoiceLanguage(voiceKey) {
  const key = String(voiceKey || "").trim();
  if (/^gab_taglish_/i.test(key) || /^fil_PH/i.test(key)) {
    return {
      mode: "taglish",
      languageName: "Filipino Taglish",
      speakOnly: false,
    };
  }

  const code = (key.match(/^([a-z]{2})(?:[_-]|$)/i) || [])[1]?.toLowerCase();
  const languageName = LANGUAGE_NAMES[code] || "the selected Piper voice language";
  return {
    mode: code || "selected",
    languageName,
    speakOnly: true,
  };
}

function buildPiperLanguageGuidance(voiceKey) {
  const voice = String(voiceKey || "").trim() || "the selected Piper voice";
  const info = piperVoiceLanguage(voice);

  if (info.mode === "taglish") {
    return `
## Selected Piper voice language

The selected Piper voice is ${voice}, a Filipino Taglish voice.

- Understand Tagalog, Taglish, and English.
- If the caller speaks English, reply in simple Philippine English.
- If the caller speaks Tagalog or Taglish, reply naturally in Tagalog or
  Taglish. Keep English words as English when Filipinos normally say them
  that way.
- If the caller switches languages, switch with them naturally.`.trim();
  }

  return `
## Selected Piper voice language

The selected Piper voice is ${voice}. Its speaking language is ${info.languageName}.

- You may understand the caller in Tagalog, Taglish, English, or any language
  the text brain can understand.
- Your spoken reply must be ${info.languageName} only, because Piper can only
  pronounce the selected voice language clearly.
- If the caller asks whether you speak Tagalog or another language, answer in
  ${info.languageName}: explain briefly that you can understand, but this
  selected voice speaks ${info.languageName}. Then keep helping in
  ${info.languageName}.
- Do not use Tagalog filler such as "po", "opo", "sige", "salamat", or
  "kamusta" unless ${info.languageName} is Filipino Taglish.`.trim();
}

module.exports = { piperVoiceLanguage, buildPiperLanguageGuidance };
