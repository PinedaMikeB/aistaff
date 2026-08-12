"use strict";

const WebSocket = require("ws");
const { EventEmitter } = require("events");
const { resample, int16ToBuffer, bufferToInt16 } = require("../audio/resample");
const { buildInstructions } = require("../prompt");
const { log } = require("../log");

/**
 * Gemini Live adapter — native speech-to-speech over one WebSocket per call.
 *
 * Same contract as OpenAiRealtimeBrain: connect(), write(pcm8k), greet(),
 * close(), events audio / barge_in / transcript / error. call.js does not
 * know or care which brain it got.
 *
 * Chosen for cost (~5x cheaper than OpenAI Realtime) WITHOUT giving up the
 * rule that matters: this is native audio in / audio out, not STT->LLM->TTS,
 * so the model still hears the caller and matches their language itself.
 *
 * Protocol differences from OpenAI that will bite if forgotten:
 *   - The API key goes in the URL, not a header.
 *   - `setup` MUST be the first message and MUST be acknowledged with
 *     `setupComplete` before anything else is sent, or the session is dropped.
 *   - INPUT is 16 kHz, OUTPUT is 24 kHz. Not the same rate. OpenAI is 24/24.
 *   - Every client message carries exactly one of: setup, clientContent,
 *     realtimeInput, toolResponse.
 *
 * NEVER set speechConfig.languageCode. It exists, and using it would be
 * exactly the language setting this whole design forbids.
 */

const GEMINI_IN_RATE = 16000;  // what Gemini wants from us
const GEMINI_OUT_RATE = 24000; // what Gemini sends back
const PHONE_RATE = 8000;

// ~100 ms of 16 kHz audio per WebSocket message. See write() — sending at the
// 20 ms RTP cadence makes Gemini ignore the stream entirely.
const SEND_INTERVAL_MS = 100;
const SAMPLES_PER_SEND = (GEMINI_IN_RATE * SEND_INTERVAL_MS) / 1000;

const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/" +
  "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

class GeminiLiveBrain extends EventEmitter {
  constructor({ apiKey, model, voice, businessName, agentName, callerId, tools }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.voice = voice;
    this.businessName = businessName;
    this.agentName = agentName;
    this.callerId = callerId;
    // Function declarations offered to the model. The model decides IF and
    // WHEN to call them and writes any wording itself; call.js executes.
    this.tools = tools || [];
    this.ws = null;
    this.ready = false;
    this.closed = false;
    this._inBuf = "";
    this._outBuf = "";
    this._inQueue = [];
    this._inQueued = 0;
  }

  _flushTranscripts() {
    const caller = this._inBuf.trim();
    const pitch = this._outBuf.trim();
    this._inBuf = "";
    this._outBuf = "";
    if (caller) this.emit("transcript", { role: "caller", text: caller });
    if (pitch) this.emit("transcript", { role: "pitch", text: pitch });
  }

  async connect() {
    const url = `${WS_BASE}?key=${encodeURIComponent(this.apiKey)}`;

    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      const onError = (err) => reject(err);
      this.ws.once("error", onError);
      this.ws.once("open", () => {
        this.ws.removeListener("error", onError);
        resolve();
      });
    });

    this.ws.on("message", (raw) => this._onMessage(raw));
    this.ws.on("error", (err) => this.emit("error", err));
    this.ws.on("close", () => {
      this.ready = false;
      this.emit("closed");
    });

    // setup goes first and must be acknowledged before any audio.
    this._send({
      setup: {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            // Voice only. NO languageCode — see file header.
            voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } },
          },
        },
        systemInstruction: {
          parts: [{
            text: buildInstructions({
              businessName: this.businessName,
              agentName: this.agentName,
              callerId: this.callerId,
              smsEnabled: (this.tools || []).some((t) => t.name === "send_sms"),
            }),
          }],
        },
        // Transcripts are for our call log only. They never drive the reply
        // and must never be used to pin a language.
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        ...(this.tools.length
          ? { tools: [{ functionDeclarations: this.tools }] }
          : {}),
      },
    });

    // Wait for setupComplete — sending audio before it drops the session.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("gemini: no setupComplete within 10s")), 10000);
      this.once("_setup_complete", () => { clearTimeout(timer); resolve(); });
      this.once("error", (err) => { clearTimeout(timer); reject(err); });
    });

    this.ready = true;
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // Live API can send binary/blob frames we don't use
    }

    if (msg.setupComplete) {
      log.debug("gemini: setup complete");
      this.emit("_setup_complete");
      return;
    }

    if (msg.toolCall) {
      for (const fc of msg.toolCall.functionCalls || []) {
        log.info(`gemini: tool call ${fc.name} ${JSON.stringify(fc.args || {})}`);
        this.emit("tool_call", { id: fc.id, name: fc.name, args: fc.args || {} });
      }
      return;
    }

    const sc = msg.serverContent;
    if (!sc) {
      if (msg.error) {
        this.emit("error", new Error(msg.error.message || "gemini error"));
      } else if (!msg.usageMetadata) {
        log.debug(`gemini: unhandled ${Object.keys(msg).join(",")}`);
      }
      return;
    }

    // Barge-in. Gemini's VAD cancels its own turn and tells us; everything
    // already queued for playout is stale and must be dropped.
    if (sc.interrupted) {
      log.debug("gemini: caller interrupted");
      this.emit("barge_in");
    }

    if (sc.inputTranscription?.text) this._inBuf += sc.inputTranscription.text;
    if (sc.outputTranscription?.text) this._outBuf += sc.outputTranscription.text;

    // Gemini streams transcripts as fragments ("po." / "Paano" / "ko po"),
    // where OpenAI sends whole utterances. Buffer to the end of the turn so
    // the call log reads as sentences instead of confetti.
    if (sc.turnComplete || sc.generationComplete) this._flushTranscripts();

    for (const part of sc.modelTurn?.parts || []) {
      const data = part.inlineData?.data;
      if (!data) continue;
      // 24 kHz PCM16 base64 -> 8 kHz for the phone.
      const pcm24 = bufferToInt16(Buffer.from(data, "base64"));
      this.emit("audio", resample(pcm24, GEMINI_OUT_RATE, PHONE_RATE));
    }
  }

  /**
   * Feed 8 kHz Int16 PCM from the caller. Gemini wants 16 kHz.
   *
   * CRITICAL: buffered to ~100 ms before sending. RTP delivers a frame every
   * 20 ms, and sending one WebSocket message per frame (50/s) makes Gemini
   * SILENTLY IGNORE the stream — no error, no transcription, no reply, the
   * call just goes deaf after the greeting. Google's docs specify ~100 ms
   * chunks. This was diagnosed on 2026-08-10 by replaying a recorded call at
   * both rates: 20 ms produced nothing, 100 ms produced full transcription.
   */
  write(pcm8k) {
    if (!this.ready || this.closed) return;
    const pcm16k = resample(pcm8k, PHONE_RATE, GEMINI_IN_RATE);

    this._inQueue.push(pcm16k);
    this._inQueued += pcm16k.length;
    if (this._inQueued < SAMPLES_PER_SEND) return;

    const merged = new Int16Array(this._inQueued);
    let o = 0;
    for (const c of this._inQueue) { merged.set(c, o); o += c.length; }
    this._inQueue = [];
    this._inQueued = 0;

    this._send({
      realtimeInput: {
        audio: {
          data: int16ToBuffer(merged).toString("base64"),
          mimeType: `audio/pcm;rate=${GEMINI_IN_RATE}`,
        },
      },
    });
  }

  /**
   * Ask the model to speak first.
   *
   * Unlike OpenAI there is no contentless "generate now" event — every
   * contentless trigger was tested (empty turns, turnComplete alone, empty
   * parts, audioStreamEnd, activityEnd) and NONE produce a turn. Gemini needs
   * content. So we hand it a FACT about the call, not words to say.
   *
   * The timestamp is not decoration. Gemini Live is far more deterministic
   * than OpenAI Realtime: with an identical context it returns a byte-identical
   * greeting every call, even at temperature 1.5. Real varying context is what
   * produces natural variation ("...how can I help you tonight?" in the
   * evening), which is what rule 2 is actually protecting.
   */
  greet() {
    const now = new Date();
    const cue = `The call connected at ${now.toLocaleTimeString("en-PH", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Manila",
    })} on a ${now.toLocaleDateString("en-PH", {
      weekday: "long", timeZone: "Asia/Manila",
    })}.`;
    this._send({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: cue }] }],
        turnComplete: true,
      },
    });
  }

  /**
   * Hand a tool's result back. The result is FACTS — {sent: true} — never
   * words to speak. The model decides how to tell the caller, in whatever
   * language the call is in.
   */
  toolResult(id, name, response) {
    this._send({
      toolResponse: {
        functionResponses: [{ id, name, response }],
      },
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    if (this.ws) {
      try { this.ws.close(); } catch { /* already closing */ }
      this.ws = null;
    }
  }
}

module.exports = { GeminiLiveBrain };
