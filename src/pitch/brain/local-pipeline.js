"use strict";

const crypto = require("crypto");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const { resample, int16ToBuffer, bufferToInt16 } = require("../audio/resample");
const { loadInstructions } = require("../prompt");
const { piperVoiceLanguage } = require("../voice-language");
const { log } = require("../log");

const PHONE_RATE = 8000;
const WHISPER_RATE = 16000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return /^gpt-5(?:$|[-.])/i.test(String(model || ""));
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
    || normalized.includes("exactly as spoken do not translate");
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
  const kind = bookingScenarioKind(text, history) || bookingScenarioKind("", history);
  if (!kind) return String(text || "").trim();
  const normalized = normalizedTranscript(text);

  // Whisper small commonly hears "four PM" over the phone as "for P.M.".
  if (normalized === "for p m that s okay" || normalized === "for p m thats okay" || normalized === "for p m") {
    return "4 PM.";
  }
  if (normalized === "corp en" || normalized === "core p m" || normalized === "for pm") {
    return "4 PM.";
  }
  return String(text || "").trim();
}

function localLine({ taglish, english }, voiceInfo) {
  return voiceInfo?.mode === "taglish" ? taglish : english;
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
    if (this.localConfig.brainProvider !== "openai" && !this.geminiApiKey) {
      throw new Error("PITCH: GEMINI_API_KEY is required for the local Gemini text brain");
    }
    if (!this.localConfig.whisperUrl) throw new Error("PITCH: PITCH_LOCAL_WHISPER_URL is required for the local pipeline");
    if (!this.localConfig.voxcpmUrl) throw new Error("PITCH: PITCH_VOXCPM2_URL is required for the local pipeline");
    await this._prepareGreeting();
    this.ready = true;
  }

  write(pcm8k) {
    if (!this.ready || this.closed || !pcm8k?.length) return;

    const rms = pcmRms(pcm8k);
    const frameMs = Math.max(1, Math.round((pcm8k.length / PHONE_RATE) * 1000));
    const voice = rms >= this.localConfig.vadThreshold;
    const agentTalking = this.speakingUntil && Date.now() < this.speakingUntil;
    const greetingProtected = this.greetingProtectedUntil && Date.now() < this.greetingProtectedUntil;

    if (voice) {
      if (!this.speaking) {
        this.speaking = true;
        this.speechChunks = [];
        this.speechMs = 0;
        this.silenceMs = 0;
        this.voiceRunMs = 0;
      }
      this.speechChunks.push(pcm8k);
      this.speechMs += frameMs;
      this.voiceRunMs += frameMs;
      this.silenceMs = 0;

      // Barge-in only after SUSTAINED speech. A single frame over the
      // threshold used to flush the agent mid-word: on a phone line that is
      // a click, a breath, or the agent's own voice echoing back through the
      // gateway. Requiring a continuous run makes a real interruption
      // distinguishable from line noise.
      if (agentTalking
          && this.bargeInEnabled
          && !greetingProtected
          && !this.bargedThisTurn
          && this.voiceRunMs >= this.localConfig.bargeInMinMs) {
        this.bargedThisTurn = true;
        this.replyEpoch++;
        this.speakingUntil = 0;
        log.debug(`local-pipeline: barge-in after ${this.voiceRunMs}ms of speech (rms=${rms})`);
        this.emit("barge_in");
      }

      if (!agentTalking
          && (this.processing || this.generatingReply)
          && this.bargeInEnabled
          && !greetingProtected
          && !this.bargedThisTurn
          && this.voiceRunMs >= this.localConfig.bargeInMinMs) {
        this.bargedThisTurn = true;
        this.replyEpoch++;
        log.debug(`local-pipeline: cancelled stale reply after ${this.voiceRunMs}ms of caller speech (rms=${rms})`);
        this.emit("barge_in");
      }

      if (this.speechMs >= this.localConfig.vadMaxSpeechMs) this._finishUtterance();
      return;
    }

    // Silence resets the run, so noise spread across a sentence never adds up
    // to a false interruption.
    this.voiceRunMs = 0;

    if (!this.speaking) return;
    this.speechChunks.push(pcm8k);
    this.silenceMs += frameMs;
    if (this.silenceMs >= this.localConfig.vadSilenceMs) this._finishUtterance();
  }

  _finishUtterance() {
    const chunks = this.speechChunks;
    const speechMs = this.speechMs;
    this.speaking = false;
    this.speechChunks = [];
    this.speechMs = 0;
    this.silenceMs = 0;
    if (speechMs < this.localConfig.vadMinSpeechMs || chunks.length === 0) return;
    this.queue.push(chunks);
    this._drainQueue();
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

    const form = new FormData();
    form.set("file", new Blob([wav], { type: "audio/wav" }), "caller.wav");
    form.set("prompt", "Transcribe natural Filipino Taglish, Tagalog, or English exactly as spoken. Do not translate.");
    form.set("response_format", "json");
    form.set("temperature", "0.0");
    form.set("language", this.localConfig.whisperLanguage || "auto");

    const res = await fetchWithTimeout(this.localConfig.whisperUrl, {
      method: "POST",
      body: form,
    }, this.localConfig.requestTimeoutMs);
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || data.error || `local whisper failed with HTTP ${res.status}`);
    }
    const text = String(data.text || data.transcription || "").trim();
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
      "",
      "You are in the local voice pipeline. Write only the next spoken turn for Pitch.",
      "No labels, no markdown, no stage directions. Keep it short enough for a live phone call.",
      "Prefer 15 to 30 spoken words unless the caller clearly needs a longer explanation.",
      "For phone demos, prioritize the caller's scenario over AIStaff sales intake. If they ask about booking, rooms, tables, appointments, availability, or dates, play that scenario forward naturally.",
      "Do not ask for name, email, subscription details, or contact information unless the caller explicitly asks to subscribe, receive a callback, get an invoice, or have details sent to them.",
      "If a transcript is ambiguous but contains booking-like words such as book, pabuk, room, table, available, today, tomorrow, date, or time, ask the next booking detail instead of redirecting to AIStaff products.",
      this.voiceInfo.mode === "taglish"
        ? "If the caller asks whether you speak Tagalog, answer yes in Tagalog or light Taglish and continue helping."
        : `If the caller asks whether you speak Tagalog, answer in ${this.voiceInfo.languageName}: say you can understand, but this selected voice speaks ${this.voiceInfo.languageName}.`,
      "If the caller is clearly testing a demo scenario such as restaurant table booking, hotel room booking, or appointment booking, play the scenario forward naturally. Ask the next useful detail instead of redirecting them back to AIStaff.",
      "In demo booking scenarios, do not loop on contact details or team follow-up. Ask about date, time, number of people, room type, table preference, or reminder wording.",
      "For demo restaurant seating, be helpful and concrete: if the caller asks for romantic seating, offer a quiet corner by the window instead of asking generic indoor/outdoor questions.",
      "If the caller gives a time like four PM, 4 PM, or for P.M., treat it as a booking time and move to the next detail.",
      "Do not say goodbye immediately after a partial booking. First summarize what is noted and ask: would that be all, or is there anything else?",
      "For real business facts outside a demo scenario, do not invent prices, schedules, addresses, or final confirmations.",
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
    const pcm8k = await this._synthesize(this.greetingText);
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

  async _replyTo(callerText, metrics = {}) {
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

  greet() {
    if (!this.greetingPcm8k?.length) {
      this.generatingReply = true;
      this._synthesize(this.greetingText)
        .then((pcm8k) => {
          if (!this.closed) this._playGreeting(pcm8k);
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
  sanitizeLocalReply,
  bookingScenarioReply,
  greetingTextForVoice,
  isGpt5Model,
  usesOpenAiResponsesApi,
  repairCallerTranscript,
};
