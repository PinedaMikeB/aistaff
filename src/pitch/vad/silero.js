"use strict";

const path = require("path");
const ort = require("onnxruntime-node");

/**
 * Silero VAD -- a real neural speech-detection model, replacing the previous
 * flat RMS-amplitude threshold. That approach could not tell a natural
 * mid-sentence pause (a breath, a beat before the next Taglish clause) from
 * the caller actually finishing, which is what caused Pitch to think callers
 * had said goodbye mid-turn.
 *
 * Thresholds match Pithagoras's own voice config exactly, per instruction --
 * these are the values Pithagoras already ships with (positiveSpeechThreshold,
 * negativeSpeechThreshold, minSpeechMs, preSpeechPadMs, redemptionMs), not a
 * fresh guess:
 *   { positiveSpeechThreshold: 0.65, negativeSpeechThreshold: 0.35,
 *     minSpeechMs: 256, preSpeechPadMs: 320, redemptionMs: 1000 }
 *
 * Silero natively accepts 8kHz or 16kHz PCM -- the phone side is already
 * 8kHz, so no resampling is needed to feed it.
 */

const SAMPLE_RATE = 8000;
const FRAME_SAMPLES = 256; // Silero's native 8kHz frame size
// Silero v5 (the "state"-input model in vad-model/) expects every 256-sample
// frame to be prefixed with the last 32 samples of the previous frame
// (64 at 16 kHz) -- this is what the official silero-vad wrapper does. Feeding
// bare 256-sample frames makes the model nearly blind: on the 24 Sep call it
// scored the caller's clear 79 dB "book a table for two" at 0.00, so VAD ended
// the turn early and Whisper only got the first word. This missing context is
// also the real reason phone speech "only reached 0.2-0.5" in earlier sessions.
const CONTEXT_SAMPLES = 32;

const DEFAULTS = {
  positiveSpeechThreshold: 0.65,
  negativeSpeechThreshold: 0.35,
  minSpeechMs: 256,
  preSpeechPadMs: 320,
  redemptionMs: 1000,
  // Safety valve, not part of Pithagoras's own config: without this, an
  // utterance that never gets a full redemptionMs of clean silence (real
  // phone lines have background/comfort noise that can keep nudging the
  // probability just above negativeSpeechThreshold, resetting the countdown
  // each time) waits forever and never reaches speech_end at all -- a real
  // caller experience of "it heard me, then total silence, no reply." The
  // old RMS-based VAD had this same cap (vadMaxSpeechMs); porting it over.
  maxSpeechMs: 12000,
  // Separate, more sensitive threshold used only to decide "stop talking
  // right now, something is happening" (barge-in) -- distinct from
  // positiveSpeechThreshold, which decides "start capturing a real
  // utterance to transcribe." A false-positive on the first is cheap (Pitch
  // pauses briefly, can resume); a false-negative -- genuinely missing a
  // caller's interruption because their voice sat just under threshold on
  // this specific phone line -- is the actual reported problem. Defaults to
  // positiveSpeechThreshold if not set, so this is opt-in.
  bargeInThreshold: null,
  // How long confidence must stay continuously at or above bargeInThreshold
  // before barge-in fires. Silero's own frame is 32ms -- shorter than any
  // real syllable (roughly 150-300ms) -- so firing on a single frame reacts
  // to clicks and breath noise, not just words. This is deliberately much
  // shorter than minSpeechMs (which decides whether to bother transcribing
  // at all): enough to represent one real syllable, not a full utterance.
  bargeInSustainMs: 120,
};

class SileroVad {
  constructor(options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    if (this.opts.bargeInThreshold == null) {
      this.opts.bargeInThreshold = this.opts.positiveSpeechThreshold;
    }
    this.session = null;
    this.h = null;
    this.c = null;
    this.ready = this._load();

    this.buffer = new Int16Array(0);
    this.speaking = false;
    this.speechFrames = 0;
    this.startEventEmitted = false;
    this.candidateVoiceMs = 0;
    this.silenceMsAccum = 0;
    this.preSpeechBuffer = [];
    this.activeAudio = null;
  }

  async _load() {
    const modelPath = path.join(__dirname, "..", "vad-model", "silero_vad.onnx");
    this.session = await ort.InferenceSession.create(modelPath);
    this._resetState();
  }

  _resetState() {
    // Silero v4/v5 combines h and c into one input, literally named "state",
    // shape (2, 1, 128) -- confirmed against this exact model file via
    // session.inputNames, not assumed from older Silero versions that used
    // separate h/c tensors.
    this.state = new ort.Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
    this.context = new Float32Array(CONTEXT_SAMPLES);
  }

  /** Run one 256-sample (32ms @ 8kHz) frame through the model. Returns speech probability 0..1. */
  async _frameProbability(frameInt16) {
    const input = new Float32Array(CONTEXT_SAMPLES + frameInt16.length);
    input.set(this.context, 0);
    for (let i = 0; i < frameInt16.length; i++) input[CONTEXT_SAMPLES + i] = frameInt16[i] / 32768;
    this.context = input.slice(input.length - CONTEXT_SAMPLES);

    const feeds = {
      input: new ort.Tensor("float32", input, [1, input.length]),
      sr: new ort.Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)])),
      state: this.state,
    };
    const out = await this.session.run(feeds);
    this.state = out.stateN;
    return out.output.data[0];
  }

  /**
   * Feed one chunk of 8kHz Int16 PCM (any length -- frames of FRAME_SAMPLES
   * are carved out internally). Returns an array of events that occurred
   * within this chunk, in order:
   *   {type: "speech_start"}
   *   {type: "speech_end", audio: Int16Array | null, tooShort?: true}
   */
  async process(chunk) {
    await this.ready;
    const events = [];

    const combined = new Int16Array(this.buffer.length + chunk.length);
    combined.set(this.buffer);
    combined.set(chunk, this.buffer.length);
    this.buffer = combined;

    const frameMs = (FRAME_SAMPLES / SAMPLE_RATE) * 1000;

    while (this.buffer.length >= FRAME_SAMPLES) {
      const frame = this.buffer.subarray(0, FRAME_SAMPLES);
      this.buffer = this.buffer.subarray(FRAME_SAMPLES);

      const prob = await this._frameProbability(frame);

      if (!this.speaking) {
        // Keep a rolling pre-speech pad so we do not clip the first syllable.
        this.preSpeechBuffer.push(Int16Array.from(frame));
        const padFrames = Math.ceil(this.opts.preSpeechPadMs / frameMs);
        while (this.preSpeechBuffer.length > padFrames) this.preSpeechBuffer.shift();

        if (prob >= this.opts.positiveSpeechThreshold) {
          this.speaking = true;
          this.speechFrames = 1;
          this.startEventEmitted = false;
          this.bargeInSignalEmitted = false;
          this.bargeInCandidateMs = 0;
          this.candidateVoiceMs = frameMs;
          this.silenceMsAccum = 0;
          this.activeAudio = [...this.preSpeechBuffer];
        }
      } else {
        this.activeAudio.push(Int16Array.from(frame));
        // Total speech duration is the wall-clock span from speech_start to
        // speech_end, counting every frame in that span -- not just frames
        // individually above threshold. Real phone audio dips below
        // positiveSpeechThreshold mid-utterance often (pauses between
        // Taglish clauses, a quieter word); undercounting those as "not
        // speech" was making minSpeechMs reject entire real utterances,
        // which is what was silently discarding every reply attempt.
        this.speechFrames++;

        // Fast, separate signal for "stop talking, something is happening" --
        // requires bargeInSustainMs of continuous confidence at or above
        // bargeInThreshold (roughly one syllable), reset immediately on any
        // frame that drops below it. This is deliberately not gated behind
        // the slower minSpeechMs accumulation below, which exists to decide
        // whether something is worth sending to Whisper (a real cost);
        // barge-in has no equivalent cost to being occasionally wrong, so it
        // should not wait on that same, longer timer -- but a single 32ms
        // frame is shorter than any real syllable, so a short sustained
        // run is required rather than firing on the very first frame.
        if (!this.bargeInSignalEmitted) {
          this.bargeInCandidateMs = prob >= this.opts.bargeInThreshold
            ? this.bargeInCandidateMs + frameMs
            : 0;
          if (this.bargeInCandidateMs >= this.opts.bargeInSustainMs) {
            this.bargeInSignalEmitted = true;
            events.push({ type: "barge_in_signal" });
          }
        }

        if (!this.startEventEmitted) {
          this.candidateVoiceMs = prob >= this.opts.negativeSpeechThreshold
            ? this.candidateVoiceMs + frameMs
            : 0;
          if (this.candidateVoiceMs >= this.opts.minSpeechMs) {
            this.startEventEmitted = true;
            events.push({ type: "speech_start" });
          }
        }

        if (prob < this.opts.negativeSpeechThreshold) {
          this.silenceMsAccum += frameMs;
        } else {
          this.silenceMsAccum = 0;
        }

        if (this.silenceMsAccum >= this.opts.redemptionMs) {
          const totalSpeechMs = this.speechFrames * frameMs;
          this.speaking = false;
          this.preSpeechBuffer = [];
          const audio = concatInt16(this.activeAudio);
          this.activeAudio = null;
          if (this.startEventEmitted && totalSpeechMs >= this.opts.minSpeechMs) {
            events.push({ type: "speech_end", audio });
          } else {
            events.push({ type: "speech_end", audio: null, tooShort: true });
          }
        } else if (this.speechFrames * frameMs >= this.opts.maxSpeechMs) {
          // Force-close: this utterance has run past maxSpeechMs without
          // ever getting a clean redemption window. Cut it here and process
          // what has been captured so far rather than waiting indefinitely.
          this.speaking = false;
          this.preSpeechBuffer = [];
          const audio = concatInt16(this.activeAudio);
          this.activeAudio = null;
          events.push({ type: "speech_end", audio, forced: true });
        }
      }
    }

    return events;
  }

  reset() {
    this.buffer = new Int16Array(0);
    this.speaking = false;
    this.speechFrames = 0;
    this.startEventEmitted = false;
    this.candidateVoiceMs = 0;
    this.silenceMsAccum = 0;
    this.preSpeechBuffer = [];
    this.activeAudio = null;
    this._resetState();
  }
}

function concatInt16(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Int16Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

module.exports = { SileroVad, DEFAULTS };
