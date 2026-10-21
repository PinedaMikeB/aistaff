"use strict";

const crypto = require("crypto");
const zlib = require("zlib");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const { resample, int16ToBuffer, bufferToInt16 } = require("../audio/resample");
const { loadInstructions } = require("../prompt");
const { piperVoiceLanguage } = require("../voice-language");
const { log } = require("../log");

const PHONE_RATE = 8000;
const WHISPER_RATE = 16000;

/**
 * Linear volume ramp over the first `ms` of a clip, from `fromRatio` up to
 * full volume. Applied only to the greeting (see _prepareGreeting/greet
 * below) -- Piper's own raw output for that specific text was measured
 * hitting full digital clipping in its first ~250ms (a known VITS-family
 * onset artifact, confirmed against Piper's raw output directly, unrelated
 * to anything in this pipeline). Scoped to the greeting only for now, not
 * every reply, per instruction -- not yet verified whether replies show the
 * same artifact.
 */
function fadeIn(pcm, ms, sampleRate, fromRatio = 0.15) {
  const n = Math.min(pcm.length, Math.round((ms / 1000) * sampleRate));
  const out = new Int16Array(pcm.length);
  out.set(pcm);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const gain = fromRatio + (1 - fromRatio) * t;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * gain)));
  }
  return out;
}

function applyGainDb(pcm, gainDb) {
  const db = Number(gainDb);
  if (!Number.isFinite(db) || db === 0) return pcm;

  const gain = Math.pow(10, db / 20);
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * gain)));
  }
  return out;
}

const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const PH_MOBILE_NUMBER_RE = /(?<!\d)(?:\+?6[\s-]?3|0)[\s-]?9(?:[\s-]?\d){9}(?!\d)/g;
const TAGALOG_HOUR_WORD_RE = "(?:labing[- ]dalawa(?:ng)?|labing[- ]isa(?:ng)?|sampu(?:ng)?|isa(?:ng)?|dalawa(?:ng)?|tatlo(?:ng)?|apat(?:\s+na)?|lima(?:ng)?|anim(?:\s+na)?|pito(?:ng)?|walo(?:ng)?|siyam(?:\s+na)?|una|dos|tres|kwatro|singko|sais|siyete|otso|nuwebe|diyes|onse|dose)";
const TAGALOG_HOUR_WITH_MERIDIEM_RE = new RegExp(`\\b(${TAGALOG_HOUR_WORD_RE})\\s*(a\\.?m\\.?|p\\.?m\\.?)\\b`, "gi");
const ALAS_TAGALOG_TIME_RE = new RegExp(`\\balas\\s+(${TAGALOG_HOUR_WORD_RE})(?:\\s+ng)?\\s+(umaga|hapon|gabi)\\b`, "gi");

const TAGALOG_HOURS = new Map([
  ["isa", 1], ["isang", 1], ["una", 1],
  ["dalawa", 2], ["dalawang", 2], ["dos", 2],
  ["tatlo", 3], ["tatlong", 3], ["tres", 3],
  ["apat", 4], ["apat na", 4], ["kwatro", 4],
  ["lima", 5], ["limang", 5], ["singko", 5],
  ["anim", 6], ["anim na", 6], ["sais", 6],
  ["pito", 7], ["pitong", 7], ["siyete", 7],
  ["walo", 8], ["walong", 8], ["otso", 8],
  ["siyam", 9], ["siyam na", 9], ["nuwebe", 9],
  ["sampu", 10], ["sampung", 10], ["diyes", 10],
  ["labing isa", 11], ["labing isang", 11], ["onse", 11],
  ["labing dalawa", 12], ["labing dalawang", 12], ["dose", 12],
]);

function tagalogHour(value) {
  const key = String(value || "").toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
  return TAGALOG_HOURS.get(key);
}

function normalizeClockTimes(text) {
  return String(text || "")
    .replace(ALAS_TAGALOG_TIME_RE, (match, hourWord, period) => {
      const hour = tagalogHour(hourWord);
      if (!hour) return match;
      return `${hour} ${String(period).toLowerCase() === "umaga" ? "AM" : "PM"}`;
    })
    .replace(TAGALOG_HOUR_WITH_MERIDIEM_RE, (match, hourWord, meridiem) => {
      const hour = tagalogHour(hourWord);
      if (!hour) return match;
      return `${hour} ${String(meridiem).replace(/\./g, "").toUpperCase()}`;
    });
}

const SPOKEN_ROOM_PRICE_REPLACEMENTS = [
  [/\b(?:dalawang libo(?:ng)? limang daan|two thousand five hundred)\s+pesos?\b/gi, "2,500 pesos"],
  [/\b(?:tatlong libo(?:ng)? limang daan|three thousand five hundred)\s+pesos?\b/gi, "3,500 pesos"],
  [/\b(?:apat na libo(?:ng)? limang daan|four thousand five hundred)\s+pesos?\b/gi, "4,500 pesos"],
  [/\b(?:limang libo(?:ng)? limang daan|five thousand five hundred)\s+pesos?\b/gi, "5,500 pesos"],
];

function normalizeSpokenRoomPrices(text) {
  let result = String(text || "");
  for (const [pattern, replacement] of SPOKEN_ROOM_PRICE_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function preparePiperSpeechText(text) {
  return normalizeSpokenRoomPrices(normalizeClockTimes(text))
    .replace(PH_MOBILE_NUMBER_RE, (phone) => {
      const rawDigits = phone.replace(/\D/g, "");
      const digits = rawDigits.startsWith("63") ? `0${rawDigits.slice(2)}` : rawDigits;
      return digits.split("").map((digit) => DIGIT_WORDS[Number(digit)]).join(" ");
    })
    .replace(/\bdetalye\b/gi, "details")
    .replace(/\bPHP\s?(\d[\d,]*(?:\.\d+)?)/gi, "$1 pesos")
    .replace(/₱\s?(\d[\d,]*(?:\.\d+)?)/g, "$1 pesos");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * gzip-based compression ratio, the same signal Python's openai-whisper uses
 * internally (compression_ratio_threshold, default 2.4) to catch hallucinated
 * repetitive text -- a model confidently repeating the same phrase over and
 * over compresses far better than real speech does. whisper.cpp's server does
 * not report this itself, so it is computed here from the returned text.
 */
function compressionRatio(text) {
  if (!text || text.length < 8) return 1;
  const raw = Buffer.byteLength(text, "utf8");
  const compressed = zlib.gzipSync(Buffer.from(text, "utf8")).length;
  return raw / compressed;
}

function pcmRms(pcm) {
  if (!pcm || pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length);
}

function writeWavBuffer(pcm, sampleRate) {
  const data = int16ToBuffer(pcm);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function readWavPcm16(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" ||
      buffer.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }

  let offset = 12;
  let sampleRate = null;
  let channels = 1;
  let bitsPerSample = 16;
  let dataStart = null;
  let dataSize = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      channels = buffer.readUInt16LE(start + 2);
      sampleRate = buffer.readUInt32LE(start + 4);
      bitsPerSample = buffer.readUInt16LE(start + 14);
    } else if (id === "data") {
      dataStart = start;
      dataSize = size;
      break;
    }
    offset = start + size + (size % 2);
  }

  if (!sampleRate || dataStart == null || bitsPerSample !== 16) return null;
  const bytes = buffer.subarray(dataStart, dataStart + dataSize);
  const samples = new Int16Array(Math.floor(bytes.length / 2 / channels));
  for (let i = 0; i < samples.length; i++) {
    let mixed = 0;
    for (let c = 0; c < channels; c++) {
      mixed += bytes.readInt16LE((i * channels + c) * 2);
    }
    samples[i] = Math.round(mixed / channels);
  }
  return { sampleRate, pcm: samples };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function textFromGeminiResponse(data) {
  return (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
}

function textFromOpenAiResponse(data) {
  return String(data.choices?.[0]?.message?.content || "").trim();
}

function textFromOpenAiResponsesResponse(data) {
  if (data.output_text) return String(data.output_text).trim();
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
}

function base64ToBuffer(value) {
  if (!value) return null;
  const text = String(value);
  const comma = text.indexOf(",");
  const raw = comma >= 0 && /^data:/i.test(text.slice(0, comma)) ? text.slice(comma + 1) : text;
  return Buffer.from(raw, "base64");
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function isGpt5Model(model) {
  return /^gpt-5(?:$|[-.])/i.test(String(model || ""));
}

function usesOpenAiResponsesApi(model) {
  return /^gpt-5\.6(?:$|[-.])/i.test(String(model || ""));
}

function normalizedTranscript(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWhisperPromptEcho(text) {
  const normalized = normalizedTranscript(text);
  return normalized.includes("transcribe natural filipino taglish")
    || normalized.includes("exactly as spoken do not translate")
    || normalized.includes("hello po i would like to book a table for two available po ba today");
}

function isWhisperNonSpeechMarker(text) {
  // General pattern, not a word list: Whisper's caption-style non-speech
  // annotations always take the form [SOMETHING] or (something) -- the
  // specific word varies hugely (blank_audio, coughing, BIRD CHIRPING,
  // DOG BARKING, MUSIC, PHONE RINGING, ...) and trying to enumerate them
  // is the same losing game the old prompt-echo blacklist was. If the
  // ENTIRE returned text is nothing but one or more bracketed/parenthesized
  // segments, it is a non-speech annotation regardless of what word is
  // inside the brackets.
  return /^\s*(?:[[(][^\])]*[\])]\s*[.!?]?\s*)+$/.test(String(text || ""));
}

function asksTagalogCapability(text) {
  const normalized = normalizedTranscript(text);
  return (normalized.includes("speak tagalog") || normalized.includes("salita tagalog") || normalized.includes("mag tagalog"))
    && (normalized.includes("can") || normalized.includes("marunong") || normalized.includes("kaya"));
}

function mentionsTagalog(text) {
  const normalized = normalizedTranscript(text);
  return normalized.includes("tagalog")
    || normalized.includes("tawalog")
    || normalized.includes("mag tagalog")
    || normalized.includes("magtagalog");
}

function hasEnglishOnlyRefusal(text) {
  const normalized = normalizedTranscript(text);
  return normalized.includes("only speak english")
    || normalized.includes("english only")
    || normalized.includes("cannot speak tagalog")
    || normalized.includes("can t speak tagalog")
    || normalized.includes("speak in english on this line")
    || normalized.includes("answer you in english")
    || normalized.includes("english lang")
    || normalized.includes("pwede kong gamitin dito");
}

function hasFakeLookupLanguage(text) {
  const normalized = normalizedTranscript(text);
  return normalized.includes("let me check")
    || normalized.includes("i am checking")
    || normalized.includes("i m checking")
    || normalized.includes("pulling up")
    || normalized.includes("looking up")
    || normalized.includes("check the availability")
    || normalized.includes("check availability")
    || normalized.includes("table availability")
    || normalized.includes("reserve that")
    || normalized.includes("i have it right here");
}

function looksLikeReservationRequest(text) {
  const normalized = normalizedTranscript(text);
  return normalized.includes("restaurant")
    || normalized.includes("reserve")
    || normalized.includes("reservation")
    || normalized.includes("hotel")
    || normalized.includes("room")
    || normalized.includes("booking")
    || normalized.includes("table for")
    || normalized.includes("availability");
}

function callerGaveClosing(text) {
  const normalized = normalizedTranscript(text);
  return normalized === "bye"
    || normalized.includes("goodbye")
    || normalized.includes("thank you bye")
    || normalized.includes("thanks bye");
}

function mentionsRomanticSeat(text) {
  const normalized = normalizedTranscript(text);
  return normalized.includes("romantic")
    || normalized.includes("corner")
    || normalized.includes("window")
    || normalized.includes("quiet");
}

function missesRomanticSeat(reply) {
  const normalized = normalizedTranscript(reply);
  return !normalized.includes("corner")
    && !normalized.includes("window")
    && !normalized.includes("quiet");
}

function soundsLikeBookingDeadEnd(text) {
  const normalized = normalizedTranscript(text);
  return normalized.includes("office rather than a restaurant")
    || normalized.includes("do not have tables")
    || normalized.includes("don t have tables")
    || normalized.includes("do not serve food")
    || normalized.includes("don t serve food")
    || normalized.includes("restaurant reservation line")
    || normalized.includes("wrong number")
    || normalized.includes("someone from the team")
    || normalized.includes("call you back")
    || normalized.includes("leave your name and number")
    || normalized.includes("take down your details")
    || normalized.includes("follow up with you");
}

function bookingScenarioKind(callerText, history = []) {
  const context = normalizedTranscript([
    ...history.slice(-6).map((m) => m.text),
    callerText,
  ].join(" "));
  if (context.includes("hotel") || context.includes("room") || context.includes("check in")) return "hotel";
  if (context.includes("restaurant") || context.includes("table") || context.includes("reserve") || context.includes("reservation")) return "restaurant";
  return null;
}

function repairCallerTranscript(text, history = []) {
  const raw = String(text || "").trim();
  const normalized = normalizedTranscript(raw);
  const lastPitch = [...history].reverse().find((item) => item?.role === "pitch")?.text || "";
  const askedGuestCount = /\b(?:how many (?:people|guests)|ilang tao|for how many)\b/i.test(lastPitch);
  if (askedGuestCount && normalized === "delaware") return "Dalawa.";
  if (askedGuestCount && /\bthe long tao\b/.test(normalized)) {
    return raw.replace(/the long tao/i, "dalawang tao").trim();
  }

  const kind = bookingScenarioKind(text, history) || bookingScenarioKind("", history);
  if (!kind) return raw;

  // Whisper small commonly hears "four PM" over the phone as "for P.M.".
  if (normalized === "for p m that s okay" || normalized === "for p m thats okay" || normalized === "for p m") {
    return "4 PM.";
  }
  if (normalized === "corp en" || normalized === "core p m" || normalized === "for pm") {
    return "4 PM.";
  }

  return raw;
}

function knownGuestCount(history = [], callerText = "") {
  const callerTurns = [
    ...history.filter((item) => item?.role === "caller").map((item) => item.text),
    callerText,
  ];
  const numberWords = new Map([
    ["one", 1], ["isa", 1], ["isang", 1],
    ["two", 2], ["dalawa", 2], ["dalawang", 2],
    ["three", 3], ["tatlo", 3], ["tatlong", 3],
    ["four", 4], ["apat", 4],
    ["five", 5], ["lima", 5], ["limang", 5],
    ["six", 6], ["anim", 6],
  ]);

  for (let i = callerTurns.length - 1; i >= 0; i--) {
    const text = normalizedTranscript(callerTurns[i]);
    const match = text.match(/\b(?:room for|for|good for)\s+(\d|one|two|three|four|five|six)\b/)
      || text.match(/\b(\d|one|two|three|four|five|six|isa|isang|dalawa|dalawang|tatlo|tatlong|apat|lima|limang|anim)\s+(?:tao|people|guests?|pax)\b/)
      || text.match(/\b(\d|one|two|three|four|five|six|isa|isang|dalawa|dalawang|tatlo|tatlong|apat|lima|limang|anim)\s+kami\b/);
    if (!match) continue;
    const token = match[1];
    const count = /^\d$/.test(token) ? Number(token) : numberWords.get(token);
    if (count) return count;
  }
  return null;
}

function localLine({ taglish, english }, voiceInfo) {
  return voiceInfo?.mode === "taglish" ? taglish : english;
}

function replyLanguageRules(voiceInfo) {
  if (voiceInfo?.mode !== "taglish") return [];
  return [
    "LANGUAGE MATCHING IS REQUIRED. When the caller's latest meaningful sentence contains Tagalog or Taglish, reply primarily in natural conversational Tagalog or Taglish, never in English only.",
    "Common words such as ano, anong, magkano, gusto, kailangan, yung, ako, po, opo, hindi, and salamat establish Tagalog or Taglish. Keep ordinary hotel terms such as room, deluxe, check-in, and checkout in English when that sounds natural.",
    "When the latest caller turn is only a short answer, date, number, room name, yes, okay, or thank you, continue using the language established by the most recent meaningful caller sentence.",
    "Use English-only replies only when the caller's meaningful conversation is English-only or the caller clearly asks to switch to English.",
  ];
}

function hospitalityConversationRules() {
  return [
    "Sound like a warm, attentive hospitality professional, not a form or a price-reading robot.",
    "Usually speak 25 to 45 words and never more than two complete sentences: answer the question directly, add one genuinely useful relevant detail from approved knowledge, then ask one natural next question only when it fits completely. Never begin a third sentence.",
    "Vary acknowledgements and follow-up wording. Do not mechanically end every answer with 'Would you like to book it?' or repeat facts the caller already accepted.",
    "Make recommendations when the known facts support them, such as matching a room type to the caller's group, budget, or occasion. Be helpful and gently enthusiastic, never pushy.",
    "Do not say or imply that you will check live availability unless a real availability tool has returned a result. You may ask for the date to continue noting the demo request, but never say 'para ma-check kung available'.",
    "Warmth and creativity must never become fabrication. Do not invent amenities, views, bed types, addresses, availability, promotions, policies, or confirmed reservations that are absent from the approved knowledge or explicit demo facts.",
  ];
}

function temporaryDemoKnowledge() {
  return `
=== AUTHORITATIVE TEMPORARY DEMO KNOWLEDGE BASE ===
Use this section as the only source of hotel and restaurant facts during the temporary demo. It overrides generic examples elsewhere in the prompt.

BUSINESS IDENTITY
- Name: AIStaff Demo Hotel
- Type: Three-star city hotel with an in-house Filipino restaurant
- Address: 100 Demo Avenue, Legazpi Village, Makati City, Metro Manila
- Website: demo-hotel.aistaff.click
- Reservations email: reservations@demo-hotel.aistaff.click
- Reservations mobile: 0-9-1-7-1-2-3-4-5-6-7
- Contact person: Maria Santos, Front Desk Manager

DIRECTIONS AND LANDMARKS
- The hotel is near Greenbelt 1 and Legazpi Active Park.
- From Greenbelt 1, walk toward Legazpi Active Park, turn onto Demo Avenue, and the hotel is beside the Demo Pharmacy.
- From Ayala MRT, take a taxi or ride-hailing car; the usual travel time is about 10 to 15 minutes when traffic is light.
- Parking entrance is on Demo Avenue.

HOTEL HOURS AND POLICIES
- Standard check-in: 2 PM
- Checkout: 12 noon
- Front desk and security: 24 hours
- Early check-in and late checkout depend on availability and are not guaranteed.
- Reservations in this voice demo are requests only and are not final until confirmed by a real booking system or staff member.
- Free cancellation is allowed until 24 hours before check-in. Later cancellation may cost the first night's rate.
- Children 7 years old and below may share existing beds at no extra room charge. Extra meals are charged separately.
- Pets are not allowed, except trained service animals.
- Smoking is prohibited inside rooms. A designated outdoor smoking area is available.
- Accepted payments: cash, Visa, Mastercard, and GCash.
- To prepare a booking request, collect the guest name, mobile number, check-in date, number of nights, guest count, and room type. Do not claim the request is confirmed.

SHARED HOTEL AMENITIES
- Complimentary Wi-Fi throughout the hotel
- Outdoor swimming pool, open 7 AM to 9 PM
- 24-hour front desk and security
- CCTV in common areas
- One complimentary parking space per room, subject to availability
- Daily housekeeping
- Elevator access
- In-house Filipino restaurant, open 6 AM to 10 PM
- Breakfast service: 6 AM to 10 AM

FEATURES NOT AVAILABLE
- The hotel does not have a sauna, gym, spa, airport shuttle, room service, laundry service, or minibar.

ROOM TYPES AND NIGHTLY RATES
- Standard Room: 2,500 pesos per night. Good for 2 guests. One queen bed. Includes breakfast for 2, Wi-Fi, pool access, 24-hour security, daily housekeeping, and one parking space subject to availability.
- Deluxe Room: 3,500 pesos per night. Good for 2 guests. One king bed, city view, and work desk. Includes breakfast for 2, Wi-Fi, pool access, 24-hour security, daily housekeeping, and one parking space subject to availability.
- Family Room: 4,500 pesos per night. Good for up to 4 guests. Two queen beds and a dining table. Includes breakfast for 4, Wi-Fi, pool access, 24-hour security, daily housekeeping, and one parking space subject to availability.
- Suite: 5,500 pesos per night. Good for 2 guests. One king bed, separate living area, bathtub, city view, and work desk. Includes breakfast for 2, Wi-Fi, pool access, 24-hour security, daily housekeeping, and one parking space subject to availability.

RESTAURANT MENU
- Chicken adobo with rice: 350 pesos
- Sinigang na bangus with rice: 420 pesos
- Kare-kare with rice: 450 pesos
- Pancit canton: 280 pesos
- Additional steamed rice: 50 pesos
- Iced tea or soft drink: 100 pesos
- Fresh fruit shake: 160 pesos
- Leche flan: 180 pesos

SET MENUS
- Solo Set: 450 pesos. Includes chicken adobo, steamed rice, iced tea, and leche flan. Good for 1 guest.
- Couple Set: 850 pesos. Includes chicken adobo, sinigang na bangus, 2 steamed rice servings, 2 iced teas, and 1 leche flan for sharing. Good for 2 guests.
- Family Set: 1,650 pesos. Includes chicken adobo, kare-kare, pancit canton, 4 steamed rice servings, 4 iced teas, and 2 leche flans. Good for 4 guests.

SALES GUIDANCE
- Recommend only features and inclusions explicitly listed above.
- Connect known benefits to the caller's needs. Example: for two guests who value comfort, mention the Deluxe Room's king bed, city view, breakfast for 2, Wi-Fi, pool access, security, and parking.
- It is acceptable to say warm sales lines such as "Magandang choice po iyon," "Kasama na po ang breakfast at pool access," or "I think you will really enjoy your stay."
- Never invent a room feature, menu item, price, discount, landmark, address, availability result, or policy.
- Missing information is unknown, not negative. If a requested fact is absent, say exactly that it is not listed in the current hotel information; never turn missing information into a claim that the hotel does not have it.
- Preserve every qualification attached to a fact. Whenever mentioning parking, say it is subject to availability. Never shorten a conditional feature into a guarantee.
- Offer a listed alternative or ask a useful next question after clearly identifying an absent detail as unlisted.
=== END TEMPORARY DEMO KNOWLEDGE BASE ===`;
}

function containsTagalogSpeech(text) {
  const normalized = normalizedTranscript(text);
  return /\b(?:ako|akin|ikaw|iyo|kami|kayo|sila|ano|anong|magkano|magano|makanon|gusto|kailangan|kailangan|yung|iyon|ito|ay|hindi|oo|opo|po|pwede|puwede|salamat|ngayon|bukas|kahapon|namin|ninyo|nyo|ko|mo|ba|lang|naman|para|mula|hanggang|kada|kuwarto)\b/.test(normalized);
}

function callerPrefersTaglish(callerText, history = []) {
  const current = normalizedTranscript(callerText);
  if (/\b(?:speak|answer|reply|continue|switch) (?:in |to )?english\b/.test(current)
      || /\benglish (?:please|only|lang)\b/.test(current)) return false;
  if (containsTagalogSpeech(current)) return true;

  const words = current.split(/\s+/).filter(Boolean);
  const isShortOrNeutral = words.length <= 4
    || /^(?:yes|yeah|yep|okay|ok|sure|correct|right|thanks|thank you|\d[\w\s-]*)[.!?]*$/.test(current);
  if (!isShortOrNeutral) return false;

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role !== "caller") continue;
    const prior = String(history[i]?.text || "");
    if (containsTagalogSpeech(prior)) return true;
    if (normalizedTranscript(prior).split(/\s+/).filter(Boolean).length > 4) return false;
  }
  return false;
}

function greetingTextForVoice(voiceInfo) {
  return localLine({
    taglish: "Hello po, this is Pitch, your AI sales and support staff. Paano ko po kayo matutulungan today?",
    english: "Hello, this is Pitch, your AI sales and support staff. How can I help you today?",
  }, voiceInfo);
}

function safeCacheToken(value) {
  return String(value || "default").replace(/[^\w.-]+/g, "_").slice(0, 80) || "default";
}

function bookingScenarioReply(callerText, history = [], voiceInfo = { mode: "taglish" }) {
  const kind = bookingScenarioKind(callerText, history);
  if (!kind) return null;

  const normalized = normalizedTranscript(callerText);
  if (callerGaveClosing(callerText)) {
    return localLine({
      taglish: "Before we end po, noted ang booking details so far. Would that be all, or may gusto pa po kayong idagdag?",
      english: "Before we end, I have the booking details noted so far. Would that be all, or is there anything else you need?",
    }, voiceInfo);
  }

  if (kind === "hotel") {
    if (normalized.includes("this afternoon") || normalized.includes("today") || normalized.includes("mamaya")) {
      return localLine({
        taglish: "For this afternoon, meron po tayong available rooms. Good for how many guests po, and anong room type ang gusto ninyo?",
        english: "For this afternoon, we have rooms available. How many guests, and what room type would you like?",
      }, voiceInfo);
    }
    if (normalized.includes("sms") || normalized.includes("text") || normalized.includes("remind")) {
      return localLine({
        taglish: "Sige po, noted ang reminder. I-confirm muna natin ang booking details: date, number of guests, and room type po.",
        english: "Sure, I noted the reminder. Let us confirm the booking details first: date, number of guests, and room type.",
      }, voiceInfo);
    }
    return localLine({
      taglish: "Sure po. What date po, ilang guests, and what kind of room ang gusto ninyo?",
      english: "Sure. What date, how many guests, and what kind of room would you like?",
    }, voiceInfo);
  }

  if (normalized.includes("romantic") || normalized.includes("corner") || normalized.includes("window")) {
    return localLine({
      taglish: "Noted po. I-request natin ang quiet corner by the window para romantic ang setting. Ano pong name ilalagay natin sa booking?",
      english: "Noted. We can request a quiet corner by the window for a more romantic setting. What name should I put on the booking?",
    }, voiceInfo);
  }
  if (/\b([1-9]|1[0-2])\s*p\s*m\b/.test(normalized) || /\b([1-9]|1[0-2])pm\b/.test(normalized)) {
    const time = (normalized.match(/\b([1-9]|1[0-2])\s*p\s*m\b/) || normalized.match(/\b([1-9]|1[0-2])pm\b/))?.[1];
    return localLine({
      taglish: `${time} PM, noted po. For a romantic setup, pwede nating i-request ang quiet corner by the window. Ano pong name para sa booking?`,
      english: `${time} PM, noted. For a romantic setup, we can request a quiet corner by the window. What name should I put on the booking?`,
    }, voiceInfo);
  }
  if (normalized.includes("this afternoon") || normalized.includes("today") || normalized.includes("mamaya")) {
    return localLine({
      taglish: "Meron po tayong available this afternoon for two. Anong oras po ninyo gusto?",
      english: "We have availability this afternoon for two. What time would you like?",
    }, voiceInfo);
  }
  if (normalized.includes("two") || normalized.includes("2") || normalized.includes("dalawa")) {
    return localLine({
      taglish: "Sure po, table for two. Anong oras po kayo darating?",
      english: "Sure, table for two. What time will you arrive?",
    }, voiceInfo);
  }
  return localLine({
    taglish: "Sure po. For how many people and what time po?",
    english: "Sure. For how many people, and what time?",
  }, voiceInfo);
}

function sanitizeLocalReply(reply, callerText, history = [], voiceInfo = { mode: "taglish" }) {
  if ((asksTagalogCapability(callerText) || mentionsTagalog(callerText)) && hasEnglishOnlyRefusal(reply)) {
    return localLine({
      taglish: "Opo, pwede po akong mag-Tagalog o Taglish. Ano po ang kailangan ninyo?",
      english: `I can understand Tagalog, but this selected voice speaks ${voiceInfo.languageName || "English"}. How can I help?`,
    }, voiceInfo);
  }

  const scenarioReply = bookingScenarioReply(callerText, history, voiceInfo);
  if (scenarioReply && mentionsRomanticSeat(callerText) && missesRomanticSeat(reply)) {
    return scenarioReply;
  }
  if (scenarioReply && callerGaveClosing(callerText) && normalizedTranscript(reply).includes("goodbye")) {
    return scenarioReply;
  }
  if (scenarioReply && (hasFakeLookupLanguage(reply) || soundsLikeBookingDeadEnd(reply))) {
    return scenarioReply;
  }

  if (hasFakeLookupLanguage(reply)) {
    const fallback = bookingScenarioReply(callerText, history, voiceInfo);
    if (fallback) return fallback;
    return localLine({
      taglish: "Hindi ko kailangan mag-check para diyan. Sagutin natin diretso: ano po ang next detail na gusto ninyong ayusin?",
      english: "I do not need to check for that. Let us answer it directly: what detail would you like to arrange next?",
    }, voiceInfo);
  }

  return reply;
}

/**
 * Local speech pipeline:
 *   phone RTP audio -> local energy VAD -> OpenAI Whisper -> Gemini text
 *   -> local VoxCPM2 TTS -> phone RTP audio
 *
 * This is deliberately a separate brain provider from Gemini Live. If the
 * local chain is down, switch PITCH_BRAIN_PROVIDER back to `gemini`.
 */
class LocalPipelineBrain extends EventEmitter {
  constructor({ geminiApiKey, openaiApiKey, localConfig, businessName, agentName, callerId }) {
    super();
    this.geminiApiKey = geminiApiKey;
    this.openaiApiKey = openaiApiKey;
    this.localConfig = localConfig;
    this.voiceInfo = piperVoiceLanguage(localConfig?.piperVoice);
    this.businessName = businessName;
    this.agentName = agentName;
    this.callerId = callerId;
    this.ready = false;
    this.closed = false;
    this.history = [];
    this.systemPrompt = null;   // loaded from AI Studio in connect()
    this.greetingText = String(localConfig?.greetingText || greetingTextForVoice(this.voiceInfo)).trim();
    this.greetingPcm8k = null;
    this.greetingCacheFile = null;
    this.greetingTimer = null;
    this.greetingProtectedUntil = 0;
    this.vadSuppressedForGreeting = false;
    this.playbackProtectedUntil = 0;
    this.vadSuppressedForPlayback = false;
    this.queue = [];
    this.processing = false;
    this.replyChain = Promise.resolve();
    this.generatingReply = false;
    this.speaking = false;
    this.speechChunks = [];
    this.speechMs = 0;
    this.silenceMs = 0;
    // Sustained-speech run used to tell a real interruption from line noise.
    this.voiceRunMs = 0;
    this.bargedThisTurn = false;
    this.replyEpoch = 0;
    // Whether the caller may interrupt at all. Set from AI Studio -> Pitch.
    this.bargeInEnabled = require("../runtime-config").readConfig().bargeInEnabled !== false;
  }

  async connect() {
    // Live body from AI Studio -> Pitch, with a final runtime rule for the
    // selected Piper voice language.
    this.systemPrompt = await loadInstructions({
      businessName: this.businessName,
      agentName: this.agentName,
      callerId: this.callerId,
      smsEnabled: false,
      pipeline: "local",
    });

    if (this.localConfig.brainProvider === "openai" && !this.openaiApiKey) {
      throw new Error("PITCH: OPENAI_API_KEY is required for the local OpenAI text brain");
    }
    if (this.localConfig.brainProvider === "gemini" && !this.geminiApiKey) {
      throw new Error("PITCH: GEMINI_API_KEY is required for the local Gemini text brain");
    }
    if (this.localConfig.brainProvider === "qwen" && !this.localConfig.qwenApiUrl) {
      throw new Error("PITCH: qwenApiUrl is required for the qwen local brain");
    }
    if (!this.localConfig.whisperUrl) throw new Error("PITCH: PITCH_LOCAL_WHISPER_URL is required for the local pipeline");
    if (this.localConfig.ttsEngine === "piper" && !this.localConfig.piperUrl) {
      throw new Error("PITCH: piperUrl is required when ttsEngine is piper");
    }
    if (this.localConfig.ttsEngine !== "piper" && this.localConfig.ttsEngine !== "zonos2" && !this.localConfig.voxcpmUrl) {
      throw new Error("PITCH: PITCH_VOXCPM2_URL is required for this ttsEngine");
    }

    this.vad = new (require("../vad/silero").SileroVad)({
      positiveSpeechThreshold: this.localConfig.vadPositiveSpeechThreshold,
      negativeSpeechThreshold: this.localConfig.vadNegativeSpeechThreshold,
      minSpeechMs: this.localConfig.vadMinSpeechMsSilero,
      preSpeechPadMs: this.localConfig.vadPreSpeechPadMs,
      redemptionMs: this.localConfig.vadRedemptionMs,
      maxSpeechMs: this.localConfig.vadMaxSpeechMs,
      bargeInThreshold: this.localConfig.vadBargeInThreshold,
      bargeInSustainMs: this.localConfig.vadBargeInSustainMs,
    });
    await this.vad.ready;

    await this._prepareGreeting();
    this.ready = true;
  }

  /**
   * Turn detection, on real Silero VAD instead of a flat RMS-amplitude
   * threshold. write() itself stays synchronous (it is called directly from
   * the RTP 'audio' event) by chaining VAD inference through a per-call
   * promise -- frames are still processed strictly in order, one at a time,
   * without ever blocking the RTP event loop.
   */
  write(pcm8k) {
    if (!this.ready || this.closed || !pcm8k?.length) return;

    // The SIP gateway does not provide acoustic echo cancellation. In the
    // reliable half-duplex mode, never feed Pitch's own returned phone audio
    // back into VAD/Whisper while it is playing (or during the short echo
    // tail). Otherwise that echo is treated as caller barge-in and flushes the
    // playout queue after one or two words.
    if (!this.bargeInEnabled && this.playbackProtectedUntil
        && Date.now() < this.playbackProtectedUntil) {
      if (!this.vadSuppressedForPlayback) {
        this.vad.reset();
        this.vadSuppressedForPlayback = true;
      }
      return;
    }
    if (this.vadSuppressedForPlayback) {
      this.vad.reset();
      this.vadSuppressedForPlayback = false;
    }

    if (this.greetingProtectedUntil && Date.now() < this.greetingProtectedUntil) {
      if (!this.vadSuppressedForGreeting) {
        this.vad.reset();
        this.vadSuppressedForGreeting = true;
      }
      return;
    }
    if (this.vadSuppressedForGreeting) {
      this.vad.reset();
      this.vadSuppressedForGreeting = false;
    }

    this._vadChain = (this._vadChain || Promise.resolve())
      .then(() => this._handleVadFrame(pcm8k))
      .catch((error) => this.emit("error", error));
  }

  async _handleVadFrame(pcm8k) {
    const agentTalking = this.speakingUntil && Date.now() < this.speakingUntil;
    const greetingProtected = this.greetingProtectedUntil && Date.now() < this.greetingProtectedUntil;
    const events = await this.vad.process(pcm8k);

    for (const event of events) {
      if (event.type === "barge_in_signal") {
        // Fast path: a short sustained run (roughly one syllable) at the
        // more sensitive bargeInThreshold. Stops playback immediately
        // rather than waiting for the slower, full speech_start below --
        // that wait was the actual reported bug: a quick interruption
        // whose confidence never sustained a full minSpeechMs sometimes
        // never registered as barge-in at all.
        if (agentTalking && this.bargeInEnabled && !greetingProtected && !this.bargedThisTurn) {
          this.bargedThisTurn = true;
          this.replyEpoch++;
          this.speakingUntil = 0;
          log.debug("local-pipeline: barge-in (fast signal)");
          this.emit("barge_in");
        }
      } else if (event.type === "speech_start") {
        // Silero already required minSpeechMs of continuous voiced audio
        // before firing this -- that sustained-speech requirement is what
        // used to be a separate voiceRunMs/bargeInMinMs counter on the RMS
        // path. Folding it into the VAD model itself is more accurate: it is
        // judging actual speech, not just amplitude, so a loud breath or a
        // click on the line no longer counts.
        if (!agentTalking
            && (this.processing || this.generatingReply)
            && this.bargeInEnabled
            && !greetingProtected
            && !this.bargedThisTurn) {
          this.bargedThisTurn = true;
          this.replyEpoch++;
          log.debug("local-pipeline: cancelled stale reply (silero speech_start)");
          this.emit("barge_in");
        }
      } else if (event.type === "speech_end" && event.audio && event.audio.length) {
        // greetingProtectedUntil previously only suppressed barge-in (stopping
        // the greeting mid-playback) -- it never stopped a sound detected
        // during that same window from being queued as a full utterance and
        // sent to the brain. Live example: a cough (Whisper transcribed it
        // literally as "[coughing]") landed right as the greeting was still
        // finishing, and got a full reply with no real waiting gap at all,
        // because nothing here checked the protection window before queueing.
        if (greetingProtected) {
          log.debug("local-pipeline: discarded utterance detected during greeting-protected window");
        } else {
          this.queue.push([event.audio]);
          this._drainQueue();
        }
      }
    }
  }

  async _drainQueue() {
    if (this.processing || this.closed) return;
    this.processing = true;
    try {
      while (this.queue.length && !this.closed) {
        const chunks = this.queue.shift();
        const turnStarted = Date.now();
        const audioMs = chunks.reduce((n, c) => n + (c.length / PHONE_RATE) * 1000, 0);
        const t0 = Date.now();
        const rawCallerText = await this._transcribe(chunks);
        const whisperMs = Date.now() - t0;
        if (!rawCallerText || this.closed) continue;
        const callerText = repairCallerTranscript(rawCallerText, this.history);
        if (callerText !== rawCallerText) {
          log.warn(`local-pipeline: repaired transcript "${rawCallerText}" -> "${callerText}"`);
        }
        this.emit("transcript", { role: "caller", text: callerText });
        this.history.push({ role: "caller", text: callerText });
        await this._scheduleReply(callerText, { turnStarted, audioMs, whisperMs });
      }
    } catch (error) {
      this.emit("error", error);
    } finally {
      this.processing = false;
    }
  }

  async _transcribe(chunks) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Int16Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    const pcm16 = resample(merged, PHONE_RATE, WHISPER_RATE);
    const wav = writeWavBuffer(pcm16, WHISPER_RATE);
    const inputSec = (merged.length / PHONE_RATE).toFixed(2);

    // Energy gate (added 24 Sep 2026). Measured on real debug clips: actual
    // caller speech on this AIO100 line sits at ~65-74 dB RMS (int16 scale),
    // while the clips VAD wrongly fired on were line hiss/near-silence at
    // ~29-38 dB. Whisper turns those into [BLANK_AUDIO] at best, and at worst
    // hallucinates text ("Thank you for watching!") that the brain then
    // answers. Drop them before Whisper: no bogus reply, and Whisper is not
    // tied up for ~4 s while the caller's real next sentence waits in queue.
    {
      let sumSq = 0;
      for (let i = 0; i < merged.length; i++) sumSq += merged[i] * merged[i];
      const rmsDb = 20 * Math.log10(Math.sqrt(sumSq / Math.max(1, merged.length)) + 1);
      const minDb = Number.isFinite(Number(this.localConfig.minUtteranceRmsDb))
        ? Number(this.localConfig.minUtteranceRmsDb) : 50;
      if (rmsDb < minDb) {
        log.warn(`local-pipeline: skipped ${inputSec}s segment below energy gate (rms=${rmsDb.toFixed(1)}dB < ${minDb}dB) -- line noise, not speech`);
        return "";
      }
    }

    // Save exactly what Whisper receives, matched to the log line it
    // produces. Standalone VAD-replay against the full call recording has
    // repeatedly failed to reconstruct the right segment boundaries (the
    // live playback-protection gating isn't replicated offline), so this is
    // the only reliable way to inspect what a specific attempt actually
    // contained.
    try {
      const dir = path.join(__dirname, "..", "..", "..", "local-runtime", "pitch-whisper-debug");
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.writeFileSync(path.join(dir, `${stamp}.wav`), wav);
    } catch (_) { /* debug-only, never block on this */ }

    const form = new FormData();
    form.set("file", new Blob([wav], { type: "audio/wav" }), "caller.wav");
    // Do not prime with a sample booking sentence. On weak or chopped audio,
    // Whisper can emit the prompt itself instead of what the caller said.
    form.set("translate", "false");
    form.set("response_format", "verbose_json");
    form.set("temperature", "0.0");
    form.set("language", this.localConfig.whisperLanguage || "auto");
    if (this.localConfig.asrContext) form.set("context", this.localConfig.asrContext);

    const res = await fetchWithTimeout(this.localConfig.whisperUrl, {
      method: "POST",
      body: form,
    }, this.localConfig.requestTimeoutMs);
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || data.error || `local whisper failed with HTTP ${res.status}`);
    }

    // Ground-truth debug line: exactly what Whisper saw and returned, for
    // every attempt -- including ones about to be discarded below. Needed
    // because the standalone-VAD-replay method used for earlier debugging
    // does not apply the live playback-protection timing, so it cannot be
    // trusted to reconstruct what actually happened frame-for-frame.
    {
      const segs = Array.isArray(data.segments) ? data.segments : [];
      const segSummary = segs.map((s) => `[${s.start?.toFixed(2)}-${s.end?.toFixed(2)} nsp=${(s.no_speech_prob ?? 0).toFixed(2)} lp=${(s.avg_logprob ?? 0).toFixed(2)}]`).join(" ");
      log.info(`local-pipeline: whisper input=${inputSec}s raw="${(data.text || "").trim()}" ${segSummary}`);
    }

    // Confidence-based hallucination guard. Whisper reports per-segment
    // no_speech_prob (how likely this segment is not speech at all) and
    // avg_logprob (how confident it is in the words it chose) even when it
    // still emits text -- a live example: it returned "Do not translate."
    // with high confidence numbers that looked fine on paper, but genuine
    // hallucinations on short/unclear audio typically show as either a high
    // no_speech_prob or a very negative avg_logprob. This is a general
    // check, not a blacklist of specific bad phrases, which is what the
    // previous isWhisperPromptEcho attempt was and why it kept missing new
    // hallucinated phrasings.
    const segments = Array.isArray(data.segments) ? data.segments : [];
    if (segments.length > 0) {
      const worstNoSpeech = Math.max(...segments.map((s) => s.no_speech_prob ?? 0));
      const worstLogprob = Math.min(...segments.map((s) => s.avg_logprob ?? 0));
      // Silence padding can make no_speech_prob high even when the decoded
      // words are correct. Reject it only together with poor token confidence.
      if ((worstNoSpeech > 0.80 && worstLogprob < -0.80) || worstLogprob < -1.20) {
        log.warn(`local-pipeline: discarded low-confidence whisper result (no_speech_prob=${worstNoSpeech.toFixed(2)} avg_logprob=${worstLogprob.toFixed(2)}) text="${(data.text || "").trim().slice(0, 80)}"`);
        return "";
      }
    }

    const text = String(data.text || data.transcription || "").trim();

    if (isWhisperNonSpeechMarker(text)) {
      log.warn(`local-pipeline: ignored whisper non-speech marker: ${text.slice(0, 90)}`);
      return "";
    }

    // Repetition-based hallucination check (compression_ratio_threshold in
    // Python's openai-whisper, not exposed by whisper.cpp's server). Catches
    // a different failure mode than the confidence check above: a model
    // confidently repeating the same phrase over and over rather than being
    // unsure -- the no_speech_prob/avg_logprob check would not flag this on
    // its own since it can happen with high stated confidence.
    const ratio = compressionRatio(text);
    if (ratio > 2.4) {
      log.warn(`local-pipeline: discarded repetitive/likely-hallucinated whisper result (compression_ratio=${ratio.toFixed(2)}) text="${text.slice(0, 80)}"`);
      return "";
    }

    if (isWhisperPromptEcho(text)) {
      log.warn(`local-pipeline: ignored whisper prompt echo: ${text.slice(0, 90)}`);
      return "";
    }
    return text;
  }

  _buildReplyPrompt(callerText) {
    const historyTurns = Math.max(2, this.localConfig.historyTurns || 6);
    const prompt = [
      this.systemPrompt,
      temporaryDemoKnowledge(),
      "",
      "You are in the local voice pipeline. Write only the next spoken turn for Pitch.",
      "No labels, no markdown, no stage directions. Keep it short enough for a live phone call.",
      ...hospitalityConversationRules(),
      ...replyLanguageRules(this.voiceInfo),
      "For phone demos, prioritize the caller's scenario over AIStaff sales intake. If they ask about booking, rooms, tables, appointments, availability, or dates, play that scenario forward naturally.",
      "Do not ask for name, email, subscription details, or contact information unless the caller explicitly asks to subscribe, receive a callback, get an invoice, or have details sent to them.",
      "If a transcript is ambiguous but contains booking-like words such as book, pabuk, room, table, available, today, tomorrow, date, or time, ask the next booking detail instead of redirecting to AIStaff products.",
      this.voiceInfo.mode === "taglish"
        ? "If the caller asks whether you speak Tagalog, answer yes in Tagalog or light Taglish and continue helping."
        : `If the caller asks whether you speak Tagalog, answer in ${this.voiceInfo.languageName}: say you can understand, but this selected voice speaks ${this.voiceInfo.languageName}.`,
      "If the caller is clearly testing a demo scenario such as restaurant table booking, hotel room booking, or appointment booking, play the scenario forward naturally. Ask the next useful detail instead of redirecting them back to AIStaff.",
      "In demo booking scenarios, do not loop on contact details or team follow-up. Ask about date, time, number of people, room type, table preference, or reminder wording.",
      "BOOKING MEMORY IS MANDATORY: Track details the caller already supplied, including guest count, date, room type, and time. Never ask for a detail again after it is known; acknowledge it briefly and move to the next missing detail.",
      "For demo restaurant seating, be helpful and concrete: if the caller asks for romantic seating, offer a quiet corner by the window instead of asking generic indoor/outdoor questions.",
      "If the caller gives a time like four PM, 4 PM, or for P.M., treat it as a booking time and move to the next detail.",
      "Do not say goodbye immediately after a partial booking. First summarize what is noted and ask: would that be all, or is there anything else?",
      "For real business facts outside a demo scenario, do not invent prices, schedules, addresses, or final confirmations.",
      "HARD MOBILE-NUMBER RULE: For Philippine mobile numbers and caller ID, convert +63 or 63 to local 09 format, then write every digit separately with hyphens, for example 0-9-1-7-5-7-6-9-8-1-7. Never start the spoken number with 6-3, never say the word dash, and never write it as one large number.",
      "HARD CLOCK-TIME RULE: Always write and speak clock times using an Arabic hour number plus English AM or PM, such as 2 PM or 9 AM. Keep 12 noon as English. Never write Tagalog-number times such as 'dalawang PM', 'alas dos', or 'labing-dalawang PM'.",
      "Use the English word 'details', never the Filipino spelling 'detalye', because the selected voice pronounces 'details' more clearly.",
      "HARD PRICE RULE: Always write and speak peso prices with Arabic digits and comma formatting, such as '2,500 pesos' or '3,500 pesos'. Never spell prices as 'dalawang libo limang daan' or 'two thousand five hundred'. Never use PHP, P, or the peso symbol in spoken text.",
      "For a demo hotel when no real business policy is provided: standard check-in is 2 PM and checkout is 12 noon. Use these defaults directly instead of saying someone will confirm later.",
      "For a demo hotel when no real rate is provided, use consistent sample nightly rates: Standard room 2,500 pesos, Deluxe room 3,500 pesos, Family room 4,500 pesos, and Suite 5,500 pesos.",
      "For the temporary hotel and restaurant demo, use the exact authoritative demo knowledge base above. Do not substitute generic price ranges or create additional menu items.",
      "Never say 'our team will get back to you', 'someone will contact you', or promise a later confirmation in a demo scenario. Answer from the demo defaults, continue the booking, and clearly avoid claiming a real payment or finalized reservation.",
      "",
      "Conversation so far:",
      ...this.history.slice(-historyTurns).map((m) => `${m.role === "caller" ? "Caller" : "Pitch"}: ${m.text}`),
      "",
      `Latest caller turn: ${callerText}`,
    ].join("\n");
    return prompt;
  }

  async _waitForPlayout() {
    while (!this.closed && this.speakingUntil && Date.now() < this.speakingUntil) {
      await sleep(Math.min(120, this.speakingUntil - Date.now()));
    }
  }

  _scheduleReply(callerText, metrics = {}) {
    this.replyChain = this.replyChain
      .catch(() => {})
      .then(async () => {
        await this._waitForPlayout();
        if (!this.closed) await this._replyTo(callerText, metrics);
      });
    return this.replyChain;
  }

  _greetingCachePath() {
    if (!this.localConfig.piperGreetingCacheDir) return null;
    const engine = this.localConfig.ttsEngine || "piper";
    const voice = safeCacheToken(
      engine === "zonos2"
        ? (this.localConfig.zonos2SpeakerId || "zonos2-default")
        : (this.localConfig.piperVoice || this.localConfig.voxcpmVoice || "piper")
    );
    const signature = JSON.stringify({
      engine,
      text: this.greetingText,
      voice,
      speakerId: this.localConfig.piperSpeakerId ?? null,
      lengthScale: this.localConfig.piperLengthScale,
      noiseScale: this.localConfig.piperNoiseScale,
      volumeDb: this.localConfig.piperVolumeDb,
      zonos2Seed: this.localConfig.zonos2Seed,
      zonos2Speed: this.localConfig.zonos2Speed,
      zonos2MaxTokens: this.localConfig.zonos2MaxTokens,
      sampleRate: PHONE_RATE,
    });
    const hash = crypto.createHash("sha1").update(signature).digest("hex").slice(0, 12);
    return path.join(this.localConfig.piperGreetingCacheDir, `${voice}-greeting-${hash}.wav`);
  }

  async _prepareGreeting() {
    const file = this._greetingCachePath();
    if (!file) return;
    this.greetingCacheFile = file;

    try {
      if (fs.existsSync(file)) {
        const wav = readWavPcm16(fs.readFileSync(file));
        if (wav?.pcm?.length) {
          this.greetingPcm8k = resample(wav.pcm, wav.sampleRate, PHONE_RATE);
          log.info(`local-pipeline: loaded cached greeting ${path.basename(file)}`);
          return;
        }
      }
    } catch (error) {
      log.warn(`local-pipeline: could not read cached greeting — ${error.message}`);
    }

    const started = Date.now();
    const rawPcm8k = await this._synthesize(this.greetingText);
    // 15% -> 100% volume over the first 300ms. Piper's own raw output for
    // this greeting was measured hitting full digital clipping in that
    // window before settling -- see the fadeIn() comment above.
    const pcm8k = fadeIn(rawPcm8k, 450, PHONE_RATE, 0.10);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, writeWavBuffer(pcm8k, PHONE_RATE));
    this.greetingPcm8k = pcm8k;
    log.info(`local-pipeline: generated cached greeting in ${Date.now() - started}ms`);
  }

  _playGreeting(pcm8k) {
    this.history.push({ role: "pitch", text: this.greetingText });
    this.emit("transcript", { role: "pitch", text: this.greetingText });
    this.speakingUntil = Date.now() + Math.ceil((pcm8k.length / PHONE_RATE) * 1000);
    this.greetingProtectedUntil = this.speakingUntil + 200;
    this.playbackProtectedUntil = this.greetingProtectedUntil;
    this.bargedThisTurn = false;
    this.emit("audio", pcm8k);
  }

  async _generateReply(prompt) {
    if (this.localConfig.brainProvider === "openai") {
      const started = Date.now();
      const model = this.localConfig.openaiTextModel || "gpt-4.1-mini";
      const outputLimit = usesOpenAiResponsesApi(model)
        ? Math.max(256, this.localConfig.maxOutputTokens || 120)
        : Math.max(40, this.localConfig.maxOutputTokens || 120);
      if (usesOpenAiResponsesApi(model)) {
        const res = await fetchWithTimeout("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.openaiApiKey}`,
          },
          body: JSON.stringify({
            model,
            input: prompt,
            max_output_tokens: outputLimit,
          }),
        }, this.localConfig.requestTimeoutMs);
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error?.message || `openai responses failed with HTTP ${res.status}`);
        }
        return { reply: textFromOpenAiResponsesResponse(data), modelMs: Date.now() - started, provider: "openai" };
      }

      const body = {
        model,
        messages: [{ role: "user", content: prompt }],
      };
      if (isGpt5Model(model)) {
        body.max_completion_tokens = outputLimit;
      } else {
        body.temperature = clampNumber(this.localConfig.temperature, 0, 2);
        body.max_tokens = outputLimit;
      }
      const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.openaiApiKey}`,
        },
        body: JSON.stringify(body),
      }, this.localConfig.requestTimeoutMs);
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || `openai text failed with HTTP ${res.status}`);
      }
      return { reply: textFromOpenAiResponse(data), modelMs: Date.now() - started, provider: "openai" };
    }

    const started = Date.now();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.localConfig.geminiTextModel}:generateContent?key=${encodeURIComponent(this.geminiApiKey)}`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: clampNumber(this.localConfig.temperature, 0, 2),
          maxOutputTokens: Math.max(40, this.localConfig.maxOutputTokens || 120),
        },
      }),
    }, this.localConfig.requestTimeoutMs);
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || `gemini text failed with HTTP ${res.status}`);
    }
    return { reply: textFromGeminiResponse(data), modelMs: Date.now() - started, provider: "gemini" };
  }

  /** Chat-formatted messages for Qwen, in place of the single flattened
   * prompt string the Gemini/OpenAI generateContent-style calls use -- Qwen3
   * is chat-tuned and expects proper role structure, not everything folded
   * into one user turn. */
  _buildReplyMessages(callerText) {
    const historyTurns = Math.max(2, this.localConfig.historyTurns || 6);
    const systemContent = [
      this.systemPrompt,
      temporaryDemoKnowledge(),
      "",
      "You are in the local voice pipeline. Write only the next spoken turn for Pitch.",
      "No labels, no markdown, no stage directions. Keep it short enough for a live phone call.",
      ...hospitalityConversationRules(),
      ...replyLanguageRules(this.voiceInfo),
      "For phone demos, prioritize the caller's scenario over AIStaff sales intake. If they ask about booking, rooms, tables, appointments, availability, or dates, play that scenario forward naturally.",
      "Do not ask for name, email, subscription details, or contact information unless the caller explicitly asks to subscribe, receive a callback, get an invoice, or have details sent to them.",
      "If a transcript is ambiguous but contains booking-like words such as book, pabuk, room, table, available, today, tomorrow, date, or time, ask the next booking detail instead of redirecting to AIStaff products.",
      this.voiceInfo.mode === "taglish"
        ? "If the caller asks whether you speak Tagalog, answer yes in Tagalog or light Taglish and continue helping."
        : `If the caller asks whether you speak Tagalog, answer in ${this.voiceInfo.languageName}: say you can understand, but this selected voice speaks ${this.voiceInfo.languageName}.`,
      "If the caller is clearly testing a demo scenario such as restaurant table booking, hotel room booking, or appointment booking, play the scenario forward naturally. Ask the next useful detail instead of redirecting them back to AIStaff.",
      "In demo booking scenarios, do not loop on contact details or team follow-up. Ask about date, time, number of people, room type, table preference, or reminder wording.",
      "BOOKING MEMORY IS MANDATORY: Track details the caller already supplied, including guest count, date, room type, and time. Never ask for a detail again after it is known; acknowledge it briefly and move to the next missing detail.",
      "For demo restaurant seating, be helpful and concrete: if the caller asks for romantic seating, offer a quiet corner by the window instead of asking generic indoor/outdoor questions.",
      "If the caller gives a time like four PM, 4 PM, or for P.M., treat it as a booking time and move to the next detail.",
      "Do not say goodbye immediately after a partial booking. First summarize what is noted and ask: would that be all, or is there anything else?",
      "For real business facts outside a demo scenario, do not invent prices, schedules, addresses, or final confirmations.",
      "HARD MOBILE-NUMBER RULE: For Philippine mobile numbers and caller ID, convert +63 or 63 to local 09 format, then write every digit separately with hyphens, for example 0-9-1-7-5-7-6-9-8-1-7. Never start the spoken number with 6-3, never say the word dash, and never write it as one large number.",
      "HARD CLOCK-TIME RULE: Always write and speak clock times using an Arabic hour number plus English AM or PM, such as 2 PM or 9 AM. Keep 12 noon as English. Never write Tagalog-number times such as 'dalawang PM', 'alas dos', or 'labing-dalawang PM'.",
      "Use the English word 'details', never the Filipino spelling 'detalye', because the selected voice pronounces 'details' more clearly.",
      "HARD PRICE RULE: Always write and speak peso prices with Arabic digits and comma formatting, such as '2,500 pesos' or '3,500 pesos'. Never spell prices as 'dalawang libo limang daan' or 'two thousand five hundred'. Never use PHP, P, or the peso symbol in spoken text.",
      "For a demo hotel when no real business policy is provided: standard check-in is 2 PM and checkout is 12 noon. Use these defaults directly instead of saying someone will confirm later.",
      "For a demo hotel when no real rate is provided, use consistent sample nightly rates: Standard room 2,500 pesos, Deluxe room 3,500 pesos, Family room 4,500 pesos, and Suite 5,500 pesos.",
      "For the temporary hotel and restaurant demo, use the exact authoritative demo knowledge base above. Do not substitute generic price ranges or create additional menu items.",
      "Never say 'our team will get back to you', 'someone will contact you', or promise a later confirmation in a demo scenario. Answer from the demo defaults, continue the booking, and clearly avoid claiming a real payment or finalized reservation.",
    ].join("\n");

    const messages = [{ role: "system", content: systemContent }];
    for (const m of this.history.slice(-historyTurns)) {
      messages.push({ role: m.role === "caller" ? "user" : "assistant", content: m.text });
    }
    const turnRules = [];
    if (this.voiceInfo.mode === "taglish" && callerPrefersTaglish(callerText, this.history)) {
      turnRules.push("Mandatory reply language for this turn: Sumagot sa natural na Tagalog o Taglish. Huwag sumagot sa English lamang. Keep common hotel terms in English when natural.");
    }
    const guests = knownGuestCount(this.history, callerText);
    if (guests) {
      turnRules.push(`KNOWN BOOKING FACT: The caller already said the booking is for ${guests} guest${guests === 1 ? "" : "s"}. Do not ask how many people or guests again. Use this fact and ask only for another missing detail.`);
    }
    if (turnRules.length) turnRules.push("Output only Pitch's spoken reply.");
    const userContent = turnRules.length ? `${callerText}\n\n${turnRules.join("\n")}` : callerText;
    messages.push({ role: "user", content: userContent });
    return messages;
  }

  /**
   * Split accumulated streamed text into complete sentences as soon as they
   * close, returning [completeSentences[], remainder]. Same sentence-boundary
   * chunking technique Pithagoras uses for its own TTS streaming.
   */
  _extractSentences(buffer) {
    const sentences = [];
    let rest = buffer;
    const re = /[^.!?\n]*[.!?]+[)\]"']*(?=\s|$)/;
    while (true) {
      const m = rest.match(re);
      if (!m || m.index !== 0) break;
      const piece = m[0].trim();
      rest = rest.slice(m[0].length).replace(/^\s+/, "");
      if (piece) sentences.push(piece);
      else break;
    }
    return [sentences, rest];
  }

  /**
   * Qwen3-8B via a direct llama.cpp OpenAI-compatible call, streamed. As each
   * sentence completes in the stream, its TTS starts immediately -- the
   * technique proven in Pithagoras: the model keeps writing while Piper is
   * already synthesizing what it already wrote, instead of waiting for the
   * whole reply before saying a single word. No pi, no agent framework --
   * this is a plain fetch to the same llama.cpp router Pithagoras uses.
   */
  async _replyToStreaming(callerText, metrics = {}) {
    const replyEpoch = this.replyEpoch;
    this.generatingReply = true;
    const started = Date.now();
    let firstTokenMs = null;
    let fullReply = "";
    let sentenceCount = 0;
    let firstAudioMs = null;
    let turnFirstAudioMs = null;
    let ttsTotalMs = 0;
    let synthChain = Promise.resolve();
    let emittedAny = false;

    const speakSentence = (sentence) => {
      sentenceCount++;
      synthChain = synthChain.then(async () => {
        if (this.closed || replyEpoch !== this.replyEpoch) return;
        const ttsStarted = Date.now();
        let pcm8k;
        try {
          pcm8k = await this._synthesize(sentence);
        } catch (error) {
          log.error(`local-pipeline: tts failed for sentence "${sentence.slice(0, 60)}" — ${error.message}`);
          return;
        }
        if (this.closed || replyEpoch !== this.replyEpoch) return;
        const ttsMs = Date.now() - ttsStarted;
        ttsTotalMs += ttsMs;
        if (firstAudioMs === null) {
          firstAudioMs = Date.now() - started;
          turnFirstAudioMs = metrics.turnStarted
            ? Date.now() - metrics.turnStarted
            : (metrics.whisperMs || 0) + firstAudioMs;
        }
        this.speakingUntil = Math.max(this.speakingUntil || 0, Date.now())
          + Math.ceil((pcm8k.length / PHONE_RATE) * 1000);
        this.playbackProtectedUntil = this.speakingUntil + 300;
        this.bargedThisTurn = false;
        emittedAny = true;
        this.emit("audio", pcm8k);
        if (this.localConfig.logMetrics) {
          log.debug(`local-pipeline: sentence #${sentenceCount} tts=${ttsMs}ms "${sentence.slice(0, 60)}"`);
        }
      });
    };

    try {
      const messages = this._buildReplyMessages(callerText);
      const res = await fetchWithTimeout(this.localConfig.qwenApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.localConfig.qwenModel,
          messages,
          stream: true,
          temperature: clampNumber(this.localConfig.temperature, 0, 2),
          max_tokens: Math.max(40, this.localConfig.maxOutputTokens || 120),
          chat_template_kwargs: { enable_thinking: false },
        }),
      }, this.localConfig.requestTimeoutMs);

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(`qwen stream failed with HTTP ${res.status}: ${errText.slice(0, 160)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let textBuffer = "";

      while (true) {
        if (this.closed || replyEpoch !== this.replyEpoch) break;
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = sseBuffer.indexOf("\n\n")) !== -1) {
          const rawEvent = sseBuffer.slice(0, idx);
          sseBuffer = sseBuffer.slice(idx + 2);
          const line = rawEvent.replace(/^data:\s*/, "").trim();
          if (!line || line === "[DONE]") continue;
          let json;
          try { json = JSON.parse(line); } catch { continue; }
          const delta = json.choices?.[0]?.delta?.content || "";
          if (!delta) continue;
          if (firstTokenMs === null) firstTokenMs = Date.now() - started;
          textBuffer += delta;
          fullReply += delta;

          const [sentences, rest] = this._extractSentences(textBuffer);
          textBuffer = rest;
          for (const sentence of sentences) speakSentence(sentence);
        }
      }

      const tail = textBuffer.trim();
      if (tail) speakSentence(tail);

      await synthChain;
      if (this.closed || replyEpoch !== this.replyEpoch) return;

      const reply = sanitizeLocalReply(fullReply.trim(), callerText, this.history, this.voiceInfo);
      if (reply) {
        this.history.push({ role: "pitch", text: reply });
        this.emit("transcript", { role: "pitch", text: reply });
      } else {
        log.warn("local-pipeline: qwen returned empty reply");
      }

      if (!emittedAny) {
        const fallback = bookingScenarioReply(callerText, this.history, this.voiceInfo) || localLine({
          taglish: "Pasensya na po, hindi ko nakuha nang malinaw. Pwede po bang ulitin ninyo?",
          english: "Sorry, I did not catch that clearly. Could you say it one more time?",
        }, this.voiceInfo);
        const pcm8k = await this._synthesize(fallback);
        if (this.closed || replyEpoch !== this.replyEpoch) return;
        this.speakingUntil = Date.now() + Math.ceil((pcm8k.length / PHONE_RATE) * 1000);
        this.playbackProtectedUntil = this.speakingUntil + 300;
        this.bargedThisTurn = false;
        this.emit("audio", pcm8k);
      }

      if (this.localConfig.logMetrics) {
        const totalMs = Date.now() - started;
        const turnTotalMs = metrics.turnStarted
          ? Date.now() - metrics.turnStarted
          : (metrics.whisperMs || 0) + totalMs;
        log.info(
          `local-pipeline: audio=${Math.round(metrics.audioMs || 0)}ms whisper=${metrics.whisperMs || 0}ms ` +
          `firstToken=${firstTokenMs ?? "n/a"}ms firstAudio=${firstAudioMs ?? "n/a"}ms ` +
          `turnFirstAudio=${turnFirstAudioMs ?? "n/a"}ms tts=${ttsTotalMs}ms sentences=${sentenceCount} ` +
          `replyTotal=${totalMs}ms turnTotal=${turnTotalMs}ms words=${fullReply.split(/\s+/).filter(Boolean).length}`
        );
      }
    } catch (error) {
      if (!this.closed && replyEpoch === this.replyEpoch) this.emit("error", error);
    } finally {
      this.generatingReply = false;
    }
  }

  async _replyTo(callerText, metrics = {}) {
    if (this.localConfig.brainProvider === "qwen") {
      return this._replyToStreaming(callerText, metrics);
    }
    const replyEpoch = this.replyEpoch;
    this.generatingReply = true;
    try {
      const prompt = this._buildReplyPrompt(callerText);
      const generated = await this._generateReply(prompt);
      if (this.closed || replyEpoch !== this.replyEpoch) return;
      let rawReply = generated.reply;
      if (!rawReply) {
        rawReply = bookingScenarioReply(callerText, this.history, this.voiceInfo) || localLine({
          taglish: "Pasensya na po, hindi ko nakuha nang malinaw. Pwede po bang ulitin ninyo?",
          english: "Sorry, I did not catch that clearly. Could you say it one more time?",
        }, this.voiceInfo);
        log.warn(`local-pipeline: ${generated.provider} returned empty reply; used fallback`);
      }
      const reply = sanitizeLocalReply(rawReply, callerText, this.history, this.voiceInfo);
      if (reply !== rawReply) {
        log.warn(`local-pipeline: replaced unsafe reply "${rawReply.slice(0, 90)}"`);
      }
      if (this.closed || replyEpoch !== this.replyEpoch) return;

      this.history.push({ role: "pitch", text: reply });
      this.emit("transcript", { role: "pitch", text: reply });
      const ttsStarted = Date.now();
      const pcm8k = await this._synthesize(reply);
      const ttsMs = Date.now() - ttsStarted;
      if (this.closed || replyEpoch !== this.replyEpoch) return;
      this.speakingUntil = Date.now() + Math.ceil((pcm8k.length / PHONE_RATE) * 1000);
      this.playbackProtectedUntil = this.speakingUntil + 300;
      // New agent turn — the caller is allowed to interrupt this one.
      this.bargedThisTurn = false;
      this.emit("audio", pcm8k);

      if (this.localConfig.logMetrics) {
        const totalMs = metrics.turnStarted
          ? Date.now() - metrics.turnStarted
          : (metrics.whisperMs || 0) + generated.modelMs + ttsMs;
        log.info(
          `local-pipeline: audio=${Math.round(metrics.audioMs || 0)}ms ` +
          `whisper=${metrics.whisperMs || 0}ms ${generated.provider}=${generated.modelMs}ms tts=${ttsMs}ms total=${totalMs}ms ` +
          `inTok~${estimateTokens(prompt)} outTok~${estimateTokens(reply)} words=${reply.split(/\s+/).filter(Boolean).length}`
        );
      }
    } finally {
      this.generatingReply = false;
    }
  }

  async _synthesize(text) {
    if (this.localConfig.ttsEngine === "zonos2") {
      return this._synthesizeZonos2(text);
    }
    if (this.localConfig.ttsEngine === "piper") {
      return this._synthesizePiper(text);
    }

    const payload = {
      text,
      prompt: text,
      voice: this.localConfig.voxcpmVoice || undefined,
      sample_rate: this.localConfig.voxcpmSampleRate,
      speaker_id: this.localConfig.piperSpeakerId ?? undefined,
      length_scale: this.localConfig.piperLengthScale,
      noise_scale: this.localConfig.piperNoiseScale,
    };
    const res = await fetchWithTimeout(this.localConfig.voxcpmUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, this.localConfig.requestTimeoutMs);

    const contentType = res.headers.get("content-type") || "";
    const raw = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new Error(`voxcpm2 failed with HTTP ${res.status}: ${raw.toString("utf8").slice(0, 160)}`);

    let sampleRate = this.localConfig.voxcpmSampleRate;
    let pcm = null;

    if (/json/i.test(contentType)) {
      const data = JSON.parse(raw.toString("utf8") || "{}");
      sampleRate = Number(data.sample_rate || data.sampleRate || sampleRate);
      const audio = base64ToBuffer(data.audio_base64 || data.audioBase64 || data.audio || data.wav);
      if (!audio) throw new Error("voxcpm2 JSON response did not include audio");
      const wav = readWavPcm16(audio);
      if (wav) {
        sampleRate = wav.sampleRate;
        pcm = wav.pcm;
      } else {
        pcm = bufferToInt16(audio);
      }
    } else {
      const wav = readWavPcm16(raw);
      if (wav) {
        sampleRate = wav.sampleRate;
        pcm = wav.pcm;
      } else {
        pcm = bufferToInt16(raw);
      }
    }

    if (!pcm || pcm.length === 0) throw new Error("voxcpm2 returned empty audio");
    return resample(pcm, sampleRate, PHONE_RATE);
  }

  async _synthesizeZonos2(text) {
    const payload = {
      text,
      stream: false,
      format: "wav",
      seed: Number.isFinite(Number(this.localConfig.zonos2Seed)) ? Number(this.localConfig.zonos2Seed) : 12,
      speed: Number.isFinite(Number(this.localConfig.zonos2Speed)) ? Number(this.localConfig.zonos2Speed) : 0.85,
      text_normalization: false,
      max_tokens: Number.isFinite(Number(this.localConfig.zonos2MaxTokens)) ? Number(this.localConfig.zonos2MaxTokens) : 700,
    };
    if (this.localConfig.zonos2SpeakerId) {
      payload.speaker_embedding_id = this.localConfig.zonos2SpeakerId;
    }

    const headers = { "Content-Type": "application/json" };
    if (this.localConfig.zonos2SessionId) {
      headers["X-TTS-Session-ID"] = this.localConfig.zonos2SessionId;
    }

    const res = await fetchWithTimeout(this.localConfig.zonos2Url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }, this.localConfig.requestTimeoutMs);

    const raw = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new Error(`zonos2 failed with HTTP ${res.status}: ${raw.toString("utf8").slice(0, 160)}`);

    let sampleRate = 44100;
    let pcm = null;
    const contentType = res.headers.get("content-type") || "";
    if (/json/i.test(contentType)) {
      const data = JSON.parse(raw.toString("utf8") || "{}");
      sampleRate = Number(data.sample_rate || data.sampleRate || sampleRate);
      const audio = base64ToBuffer(data.audio_base64 || data.audioBase64 || data.audio || data.wav);
      if (!audio) throw new Error("zonos2 JSON response did not include audio");
      const wav = readWavPcm16(audio);
      if (wav) {
        sampleRate = wav.sampleRate;
        pcm = wav.pcm;
      } else {
        pcm = bufferToInt16(audio);
      }
    } else {
      const wav = readWavPcm16(raw);
      if (wav) {
        sampleRate = wav.sampleRate;
        pcm = wav.pcm;
      } else {
        pcm = bufferToInt16(raw);
      }
    }

    if (!pcm || pcm.length === 0) throw new Error("zonos2 returned empty audio");
    return resample(pcm, sampleRate, PHONE_RATE);
  }

  /**
   * The actual, correct Piper integration. Previously `ttsEngine: "piper"`
   * fell through to a request shaped for a different, never-actually-wired
   * service (VoxCPM), so no amount of retraining Gab or Irenz ever changed
   * what left the phone -- English, Gab, and Irenz were all going through
   * that same broken path. This is a plain call to the real Piper HTTP
   * server: POST {text}, get a WAV back.
   */
  async _synthesizePiper(text) {
    const url = this.localConfig.piperUrl || "http://127.0.0.1:5001/synthesize";
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: preparePiperSpeechText(text),
        voice: this.localConfig.piperVoice || undefined,
        speaker_id: this.localConfig.piperSpeakerId ?? undefined,
        length_scale: this.localConfig.piperLengthScale,
        noise_scale: this.localConfig.piperNoiseScale,
      }),
    }, this.localConfig.requestTimeoutMs);

    const raw = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      throw new Error(`piper failed with HTTP ${res.status}: ${raw.toString("utf8").slice(0, 160)}`);
    }

    const wav = readWavPcm16(raw);
    if (!wav || !wav.pcm || wav.pcm.length === 0) {
      throw new Error("piper returned empty or unparseable audio");
    }
    const pcm8k = resample(wav.pcm, wav.sampleRate, PHONE_RATE);
    return applyGainDb(pcm8k, this.localConfig.piperVolumeDb);
  }

  greet() {
    if (!this.greetingPcm8k?.length) {
      this.generatingReply = true;
      this._synthesize(this.greetingText)
        .then((pcm8k) => {
          if (!this.closed) this._playGreeting(fadeIn(pcm8k, 450, PHONE_RATE, 0.10));
        })
        .catch((error) => this.emit("error", error))
        .finally(() => {
          this.generatingReply = false;
        });
      return;
    }

    const delayMs = clampNumber(this.localConfig.greetingStartDelayMs, 0, 1000);
    const durationMs = Math.ceil((this.greetingPcm8k.length / PHONE_RATE) * 1000);
    this.speakingUntil = Date.now() + delayMs + durationMs;
    this.greetingProtectedUntil = this.speakingUntil + 200;
    this.greetingTimer = setTimeout(() => {
      this.greetingTimer = null;
      if (!this.closed) this._playGreeting(this.greetingPcm8k);
    }, delayMs);
  }

  toolResult() {
    // The local text pipeline does not advertise function tools yet.
  }

  close() {
    this.closed = true;
    this.ready = false;
    this.queue = [];
    this.speechChunks = [];
    this.replyChain = Promise.resolve();
    if (this.greetingTimer) clearTimeout(this.greetingTimer);
    this.greetingTimer = null;
  }
}

module.exports = {
  LocalPipelineBrain,
  pcmRms,
  writeWavBuffer,
  readWavPcm16,
  isWhisperPromptEcho,
  isWhisperNonSpeechMarker,
  sanitizeLocalReply,
  bookingScenarioReply,
  greetingTextForVoice,
  isGpt5Model,
  usesOpenAiResponsesApi,
  repairCallerTranscript,
  preparePiperSpeechText,
};
