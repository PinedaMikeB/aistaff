"use strict";

const { RtpSession } = require("./rtp/session");
const { createBrain } = require("./brain");
const { parseSdp, buildSdp } = require("./sip/sdp");
const { config } = require("./config");
const { log } = require("./log");
const tools = require("./tools");

const fs = require("fs");
const path = require("path");

/**
 * Diagnostic recording. Set PITCH_RECORD_DIR to capture each call as two WAVs
 * — what the caller sent us, and what we sent back. Off unless set; this is
 * for debugging a silent call, not for production (calls are private).
 */
function writeWav(file, chunks, rate = 8000) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (total === 0) return { file, seconds: 0, peak: 0 };
  const pcm = new Int16Array(total);
  let o = 0;
  for (const c of chunks) { pcm.set(c, o); o += c.length; }

  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));

  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) data.writeInt16LE(pcm[i], i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return { file, seconds: total / rate, peak };
}

/**
 * One live call: SIP dialog + RTP session + brain, tied together.
 *
 * Audio flows both ways continuously:
 *   caller -> RTP -> brain.write()
 *   brain  -> 'audio' event -> rtp.write() -> caller
 *
 * Barge-in is the one place ordering matters: when the API reports the caller
 * started speaking, we drop everything already queued for playout. Without
 * that flush, Pitch keeps talking over the caller for as long as the queue is
 * deep, which is the single most irritating failure mode on a phone call.
 */
class Call {
  constructor({ dialog, controls, rtpPort, ua }) {
    this.dialog = dialog;
    this.controls = controls;
    this.rtpPort = rtpPort;
    // Needed for tools that send SIP requests (SMS via MESSAGE).
    this.ua = ua;
    this.toolState = {};
    this.rtp = null;
    this.brain = null;
    this.ended = false;
    this.maxTimer = null;
    this.transcript = [];
    this.recording = !!process.env.PITCH_RECORD_DIR;
    this.recIn = [];
    this.recOut = [];
  }

  async start() {
    const remote = parseSdp(this.dialog.remoteSdp);
    if (!remote.host || !remote.port) {
      log.warn("call: unusable remote SDP, rejecting");
      this.controls.reject(488, "Not Acceptable Here");
      return false;
    }

    const codec = remote.codec || "PCMU";
    log.info(`call: from=${this.dialog.callerId} codec=${codec} remote=${remote.host}:${remote.port}`);

    this.controls.ring();

    this.rtp = new RtpSession({ localPort: this.rtpPort, codec });
    await this.rtp.start();
    this.rtp.setRemote(remote.host, remote.port);
    this.rtp.on("error", (err) => log.error(`rtp: ${err.message}`));
    this.rtp.on("relatched", ({ from, to }) =>
      log.warn(`rtp: gateway sends from ${to}, not the ${from} it advertised — switched`));

    // Connect the brain BEFORE answering. If the model is unreachable we
    // would rather the caller hear a busy tone than dead air on an answered
    // call — dead air makes people think the business is broken.
    this.brain = createBrain({
      callerId: this.dialog.callerId,
      tools: tools.declarations(),
    });

    // Tool execution. The model decides IF and WHEN; limits are enforced in
    // tools.js, and the result handed back is facts, never words to speak.
    this.brain.on("tool_call", async ({ id, name, args }) => {
      const result = await tools.execute({
        name, args,
        ua: this.ua,
        callerId: this.dialog.callerId,
        state: this.toolState,
        log,
      });
      try { this.brain.toolResult(id, name, result); } catch (err) {
        log.error(`tool: could not return result — ${err.message}`);
      }
    });
    this.brain.on("error", (err) => {
      log.error(`brain: ${err.message}`);
      this.end("brain_error");
    });

    try {
      await this.brain.connect();
    } catch (err) {
      log.error(`brain: connect failed — ${err.message}`);
      this.rtp.close();
      this.controls.reject(503, "Service Unavailable");
      return false;
    }

    this.brain.on("audio", (pcm8k) => {
      if (this.recording) this.recOut.push(pcm8k);
      if (!this.ended) this.rtp.write(pcm8k);
    });

    this.brain.on("barge_in", () => {
      this.rtp.flush();
      log.debug("caller barged in — playout flushed");
    });

    this.brain.on("transcript", ({ role, text }) => {
      if (!text) return;
      this.transcript.push({ role, text, at: Date.now() });
      log.info(`[${role}] ${text}`);
    });

    this.rtp.on("audio", (pcm8k) => {
      if (this.recording) this.recIn.push(pcm8k);
      if (!this.ended) this.brain.write(pcm8k);
    });

    this.controls.answer(
      buildSdp({ localHost: config.sip.localHost, localPort: this.rtpPort, codec })
    );

    // Speak first — the caller dialled us and expects to be greeted.
    this.brain.greet();

    this.maxTimer = setTimeout(() => {
      log.warn("call: max duration reached");
      this.end("max_duration");
    }, config.call.maxDurationMs);

    return true;
  }

  end(reason = "ended") {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.maxTimer);

    const seconds = ((Date.now() - this.dialog.startedAt) / 1000).toFixed(1);
    const stats = this.rtp?.stats;
    log.info(
      `call: ended reason=${reason} duration=${seconds}s ` +
      `rtpIn=${stats?.packetsIn ?? 0} rtpOut=${stats?.packetsOut ?? 0} ` +
      `speechOut=${stats?.speechOut ?? 0} lost=${stats?.lost ?? 0}`
    );

    try { this.brain?.close(); } catch { /* noop */ }
    try { this.rtp?.close(); } catch { /* noop */ }

    if (this.recording) {
      try {
        const dir = process.env.PITCH_RECORD_DIR;
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const a = writeWav(path.join(dir, `${stamp}-caller-in.wav`), this.recIn);
        const b = writeWav(path.join(dir, `${stamp}-pitch-out.wav`), this.recOut);
        // Peak is the useful number: a full stream of packets carrying near
        // zero amplitude means the media path is up but no voice is on it.
        log.info(`recorded caller-in ${a.seconds.toFixed(1)}s peak=${a.peak} | pitch-out ${b.seconds.toFixed(1)}s peak=${b.peak}`);
        log.info(`recordings in ${dir}`);
      } catch (err) {
        log.warn(`recording failed: ${err.message}`);
      }
    }
  }
}

module.exports = { Call };
