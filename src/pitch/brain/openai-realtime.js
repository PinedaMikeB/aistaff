"use strict";

const WebSocket = require("ws");
const { EventEmitter } = require("events");
const { resample, int16ToBuffer, bufferToInt16 } = require("../audio/resample");
const { buildInstructions } = require("../prompt");
const { log } = require("../log");

/**
 * OpenAI Realtime adapter — speech in, speech out, one WebSocket per call.
 *
 * Chosen over an STT -> LLM -> TTS chain for two reasons that matter here:
 *   1. Language adaptation is inherent. A chain would force us to pick a TTS
 *      voice per detected language, which is exactly the hardcoding we are
 *      avoiding. Here the model simply answers in whatever it heard.
 *   2. One network round trip instead of three, which is the difference
 *      between a conversation and an awkward radio call.
 *
 * Turn detection (VAD) runs server-side, so barge-in is handled by the API
 * telling us speech started; we then flush queued audio locally.
 */

const REALTIME_RATE = 24000; // OpenAI Realtime PCM16 rate
const PHONE_RATE = 8000;

class OpenAiRealtimeBrain extends EventEmitter {
  constructor({ apiKey, model, voice, businessName, agentName, callerId }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.voice = voice;
    this.businessName = businessName;
    this.agentName = agentName;
    // Whatever the INVITE presented, unfiltered. prompt.js decides whether it
    // amounts to a usable number and phrases the turn accordingly.
    this.callerId = callerId;
    this.ws = null;
    this.ready = false;
    this.closed = false;
  }

  async connect() {
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.model)}`;

    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          // NO OpenAI-Beta header. Realtime went GA and the beta interface was
          // retired; sending "realtime=v1" is rejected outright with
          // "The Realtime Beta API is no longer supported."
        },
      });

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

    // GA session shape. Differs from the beta in ways that all fail loudly:
    //   - session.type: "realtime" is REQUIRED, else the config is rejected
    //   - modalities -> output_modalities
    //   - input_audio_format / output_audio_format -> audio.input.format /
    //     audio.output.format, and each is an OBJECT, not a string
    //   - input_audio_transcription -> audio.input.transcription
    // Audio stays PCM16 @ 24 kHz so resample.js and codec.js are unchanged.
    this._send({
      type: "session.update",
      session: {
        type: "realtime",
        model: this.model,
        output_modalities: ["audio"],
        instructions: buildInstructions({
          businessName: this.businessName,
          agentName: this.agentName,
          callerId: this.callerId,
          smsEnabled: (this.tools || []).some((t) => t.name === "send_sms"),
        }),
        audio: {
          input: {
            format: { type: "audio/pcm", rate: REALTIME_RATE },
            // Transcription is for our call log only — it does not drive the
            // reply, and it must never be used to pin a language.
            transcription: { model: "whisper-1" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              // Filipino speech has frequent short pauses; too low a value
              // here makes Pitch interrupt the caller mid-thought.
              silence_duration_ms: 700,
            },
          },
          output: {
            format: { type: "audio/pcm", rate: REALTIME_RATE },
            voice: this.voice,
          },
        },
      },
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
      return;
    }

    switch (msg.type) {
      // GA renamed these to response.output_audio.*; the beta names are kept
      // alongside so a stale name can never silently swallow the audio.
      case "response.output_audio.delta":
      case "response.audio.delta": {
        // 24 kHz PCM16 base64 -> 8 kHz for the phone.
        const pcm24 = bufferToInt16(Buffer.from(msg.delta, "base64"));
        this.emit("audio", resample(pcm24, REALTIME_RATE, PHONE_RATE));
        break;
      }

      case "input_audio_buffer.speech_started":
        // Caller barged in. Everything queued for playout is now stale.
        log.debug("realtime: caller speech_started");
        this.emit("barge_in");
        break;

      case "input_audio_buffer.speech_stopped":
        log.debug("realtime: caller speech_stopped");
        break;

      case "input_audio_buffer.committed":
        log.debug("realtime: caller turn committed");
        break;

      case "session.updated":
        log.debug("realtime: session config accepted");
        break;

      case "conversation.item.input_audio_transcription.completed":
        this.emit("transcript", { role: "caller", text: msg.transcript });
        break;

      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        this.emit("transcript", { role: "pitch", text: msg.transcript });
        break;

      case "response.done":
        this.emit("response_done");
        break;

      case "error":
        this.emit("error", new Error(msg.error?.message || "realtime error"));
        break;

      default:
        // Anything unrecognised is logged rather than dropped, so a renamed
        // GA event can never fail silently the way response.audio.delta did.
        log.debug(`realtime: unhandled event ${msg.type}`);
        break;
    }
  }

  /** Feed 8 kHz Int16 PCM from the caller. */
  write(pcm8k) {
    if (!this.ready || this.closed) return;
    const pcm24 = resample(pcm8k, PHONE_RATE, REALTIME_RATE);
    this._send({
      type: "input_audio_buffer.append",
      audio: int16ToBuffer(pcm24).toString("base64"),
    });
  }

  /** Ask the model to speak first, before the caller has said anything. */
  greet() {
    this._send({ type: "response.create" });
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

module.exports = { OpenAiRealtimeBrain };
