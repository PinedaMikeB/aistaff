"use strict";

const { EventEmitter } = require("events");
const { resample, int16ToBuffer, bufferToInt16 } = require("../audio/resample");
const { loadInstructions } = require("../prompt");
const { log } = require("../log");

const PHONE_RATE = 8000;
const WHISPER_RATE = 16000;

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

/**
 * Local speech pipeline:
 *   phone RTP audio -> local energy VAD -> OpenAI Whisper -> Gemini text
 *   -> local VoxCPM2 TTS -> phone RTP audio
 *
 * This is deliberately a separate brain provider from Gemini Live. If the
 * local chain is down, switch PITCH_BRAIN_PROVIDER back to `gemini`.
 */
class LocalPipelineBrain extends EventEmitter {
  constructor({ geminiApiKey, localConfig, businessName, agentName, callerId }) {
    super();
    this.geminiApiKey = geminiApiKey;
    this.localConfig = localConfig;
    this.businessName = businessName;
    this.agentName = agentName;
    this.callerId = callerId;
    this.ready = false;
    this.closed = false;
    this.history = [];
    this.systemPrompt = null;   // loaded from AI Studio in connect()
    this.queue = [];
    this.processing = false;
    this.speaking = false;
    this.speechChunks = [];
    this.speechMs = 0;
    this.silenceMs = 0;
    // Sustained-speech run used to tell a real interruption from line noise.
    this.voiceRunMs = 0;
    this.bargedThisTurn = false;
    // Whether the caller may interrupt at all. Set from AI Studio -> Pitch.
    this.bargeInEnabled = require("../runtime-config").readConfig().bargeInEnabled !== false;
  }

  async connect() {
    // Live body from AI Studio -> Pitch. The language section is generated
    // for "local", which holds the agent to English: Piper phonemizes through
    // espeak-ng, which has no Tagalog rules.
    this.systemPrompt = await loadInstructions({
      businessName: this.businessName,
      agentName: this.agentName,
      callerId: this.callerId,
      smsEnabled: false,
      pipeline: "local",
    });

    if (!this.geminiApiKey) throw new Error("PITCH: GEMINI_API_KEY is required for the local pipeline");
    if (!this.localConfig.whisperUrl) throw new Error("PITCH: PITCH_LOCAL_WHISPER_URL is required for the local pipeline");
    if (!this.localConfig.voxcpmUrl) throw new Error("PITCH: PITCH_VOXCPM2_URL is required for the local pipeline");
    this.ready = true;
  }

  write(pcm8k) {
    if (!this.ready || this.closed || !pcm8k?.length) return;

    const rms = pcmRms(pcm8k);
    const frameMs = Math.max(1, Math.round((pcm8k.length / PHONE_RATE) * 1000));
    const voice = rms >= this.localConfig.vadThreshold;
    const agentTalking = this.speakingUntil && Date.now() < this.speakingUntil;

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
          && !this.bargedThisTurn
          && this.voiceRunMs >= this.localConfig.bargeInMinMs) {
        this.bargedThisTurn = true;
        log.debug(`local-pipeline: barge-in after ${this.voiceRunMs}ms of speech (rms=${rms})`);
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
        const callerText = await this._transcribe(chunks);
        const whisperMs = Date.now() - t0;
        if (!callerText) continue;
        this.emit("transcript", { role: "caller", text: callerText });
        this.history.push({ role: "caller", text: callerText });
        await this._replyTo(callerText, { turnStarted, audioMs, whisperMs });
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

    const res = await fetchWithTimeout(this.localConfig.whisperUrl, {
      method: "POST",
      body: form,
    }, this.localConfig.requestTimeoutMs);
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || data.error || `local whisper failed with HTTP ${res.status}`);
    }
    return String(data.text || data.transcription || "").trim();
  }

  _buildReplyPrompt(callerText) {
    const historyTurns = Math.max(2, this.localConfig.historyTurns || 6);
    const prompt = [
      this.systemPrompt,
      "",
      "You are in the local voice pipeline. Write only the next spoken turn for Pitch.",
      "No labels, no markdown, no stage directions. Keep it short enough for a live phone call.",
      "Prefer 15 to 30 spoken words unless the caller clearly needs a longer explanation.",
      "",
      "Conversation so far:",
      ...this.history.slice(-historyTurns).map((m) => `${m.role === "caller" ? "Caller" : "Pitch"}: ${m.text}`),
      "",
      `Latest caller turn: ${callerText}`,
    ].join("\n");
    return prompt;
  }

  async _replyTo(callerText, metrics = {}) {
    const prompt = this._buildReplyPrompt(callerText);
    const geminiStarted = Date.now();
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
    const geminiMs = Date.now() - geminiStarted;
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || `gemini text failed with HTTP ${res.status}`);
    }
    const reply = textFromGeminiResponse(data);
    if (!reply) throw new Error("gemini text returned an empty reply");

    this.history.push({ role: "pitch", text: reply });
    this.emit("transcript", { role: "pitch", text: reply });
    const ttsStarted = Date.now();
    const pcm8k = await this._synthesize(reply);
    const ttsMs = Date.now() - ttsStarted;
    if (this.closed) return;
    this.speakingUntil = Date.now() + Math.ceil((pcm8k.length / PHONE_RATE) * 1000);
    // New agent turn — the caller is allowed to interrupt this one.
    this.bargedThisTurn = false;
    this.emit("audio", pcm8k);

    if (this.localConfig.logMetrics) {
      const totalMs = metrics.turnStarted ? Date.now() - metrics.turnStarted : metrics.whisperMs + geminiMs + ttsMs;
      log.info(
        `local-pipeline: audio=${Math.round(metrics.audioMs || 0)}ms ` +
        `whisper=${metrics.whisperMs || 0}ms gemini=${geminiMs}ms tts=${ttsMs}ms total=${totalMs}ms ` +
        `inTok~${estimateTokens(prompt)} outTok~${estimateTokens(reply)} words=${reply.split(/\s+/).filter(Boolean).length}`
      );
    }
  }

  async _synthesize(text) {
    const payload = {
      text,
      prompt: text,
      voice: this.localConfig.voxcpmVoice || undefined,
      sample_rate: this.localConfig.voxcpmSampleRate,
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

  greet() {
    const now = new Date();
    const cue = `The call connected at ${now.toLocaleTimeString("en-PH", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Manila",
    })} on a ${now.toLocaleDateString("en-PH", {
      weekday: "long", timeZone: "Asia/Manila",
    })}.`;
    this.history.push({ role: "caller", text: cue });
    this._replyTo(cue).catch((error) => this.emit("error", error));
  }

  toolResult() {
    // The local text pipeline does not advertise function tools yet.
  }

  close() {
    this.closed = true;
    this.ready = false;
    this.queue = [];
    this.speechChunks = [];
  }
}

module.exports = {
  LocalPipelineBrain,
  pcmRms,
  writeWavBuffer,
  readWavPcm16,
};
