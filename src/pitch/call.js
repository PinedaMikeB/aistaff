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

function safeFileToken(value) {
  return String(value || "unknown").replace(/[^\w.-]+/g, "_").slice(0, 80) || "unknown";
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
  constructor({ dialog, controls, rtpPort, ua, tenant }) {
    this.dialog = dialog;
    this.controls = controls;
    this.rtpPort = rtpPort;
    // Which company this call is answering for. Resolved from the SIP account
    // before the call was admitted, so the brain and the prompt can be that
    // tenant's without any lookup on the hot path.
    this.tenant = tenant || { companyId: null, deviceId: null, source: "none" };
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
    this.conversationFile = null;
  }

  _appendConversationEvent(event) {
    try {
      if (!this.conversationFile) return;
      fs.appendFileSync(this.conversationFile, `${JSON.stringify({
        at: new Date().toISOString(),
        callId: this.dialog.callId || this.dialog.id || null,
        callerId: this.dialog.callerId,
        ...event,
      })}\n`);
    } catch (err) {
      log.warn(`conversation log failed: ${err.message}`);
    }
  }

  _openConversationLog({ remote, codec }) {
    const dir = process.env.PITCH_CONVERSATION_LOG_DIR
      || path.join(__dirname, "..", "..", "local-runtime", "pitch-conversations");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const caller = safeFileToken(this.dialog.callerId);
    fs.mkdirSync(dir, { recursive: true });
    this.conversationFile = path.join(dir, `${stamp}-${caller}.jsonl`);
    this._appendConversationEvent({
      type: "call_start",
      remote,
      codec,
      tenant: this.tenant,
    });
    log.info(`conversation log: ${this.conversationFile}`);
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
    this._openConversationLog({ remote, codec });

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
    // Live transcript into Inquiries (one thread per caller number). Never blocks the call.
    try { this.inbox = require("./inbox").forCall(this.tenant, this.dialog.callerId, this.dialog.callId || this.dialog.id); }
    catch (err) { log.warn(`inbox: ${err.message}`); this.inbox = null; }

    this.brain = createBrain({
      callerId: this.dialog.callerId,
      tools: tools.declarations(),
      tenant: this.tenant,
      inbox: this.inbox,
    });

    // Tool execution. The model decides IF and WHEN; limits are enforced in
    // tools.js, and the result handed back is facts, never words to speak.
    this.brain.on("tool_call", async ({ id, name, args }) => {
      // The tenant decides what its assistant may do (Settings > Channels > Mobile Phone).
      const allow = this.tenant?.pitch || {};
      if ((name === "send_sms" && allow.allow_sms === false) || (name === "book_appointment" && allow.allow_booking === false)) {
        try { this.brain.toolResult(id, name, { ok: false, error: "not_enabled_for_this_business" }); } catch { /* noop */ }
        return;
      }
      const result = await tools.execute({
        name, args,
        ua: this.ua,
        callerId: this.dialog.callerId,
        companyId: this.tenant?.companyId || null,
        callId: this.callId,
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
      this._appendConversationEvent({ type: "message", role, text });
      log.info(`[${role}] ${text}`);
      if (this.inbox) this.inbox.add(role, text);
      this._checkStuck(role, text);
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

  // --- Stuck: the assistant keeps asking the same thing (the caller is hard to hear). ---
  _checkStuck(role, text) {
    if (role !== "pitch" || this.stuckHandled) return;
    const words = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9\u00c0-\u024f ]/g, " ").split(/\s+/).filter((w) => w.length > 2));
    const same = (a, b) => {
      const A = words(a), B = words(b);
      if (!A.size || !B.size) return false;
      let n = 0; for (const w of A) if (B.has(w)) n += 1;
      return n / Math.min(A.size, B.size) >= 0.6;
    };
    this.recentAsks = (this.recentAsks || []).concat(text).slice(-3);
    if (this.recentAsks.length === 3 && same(this.recentAsks[0], this.recentAsks[1]) && same(this.recentAsks[1], this.recentAsks[2])) {
      this.stuckHandled = true;
      this._handleStuck().catch((err) => log.warn(`stuck: ${err.message}`));
    }
  }

  async _handleStuck() {
    // No hand-over on calls unless the caller asks (Mike 2026-10-21): staff get a quiet alert, the assistant
    // keeps helping, nothing is texted. Set PITCH_STUCK_HANDOFF=on for the old behaviour (apologise + SMS).
    if (process.env.PITCH_STUCK_HANDOFF !== "on") {
      const tail = (this.transcript || []).slice(-8).map((t) => `${t.role === "caller" ? "Caller" : "Assistant"}: ${t.text}`).join("\n");
      const url = process.env.PITCH_PLATFORM_URL, token = process.env.PITCH_PLATFORM_TOKEN;
      log.warn(`stuck: same question 3 times on call from ${this.dialog.callerId} — quiet staff alert, call continues`);
      if (url && token && this.inbox?.conversationId) {
        try {
          const r = await fetch(`${url.replace(/\/$/, "")}/api/internal/pitch/handoff`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-pitch-token": token },
            body: JSON.stringify({ conversation_id: this.inbox.conversationId, company_id: this.inbox.companyId, caller: this.dialog.callerId, quiet: true,
              reason: "The phone assistant asked the same question 3 times. The call is continuing; please review it.", transcript: tail }),
            signal: AbortSignal.timeout(8000),
          });
          log.info(`stuck: quiet alert ${r.ok ? "sent" : "failed " + r.status}`);
        } catch (err) { log.warn(`stuck: quiet alert failed — ${err.message}`); }
      }
      // Watch for the next repeat again later in the call.
      this.recentAsks = []; this.stuckHandled = false;
      return;
    }
    const allowSms = this.tenant?.pitch?.allow_sms !== false;
    log.warn(`stuck: same question 3 times on call from ${this.dialog.callerId} — alerting staff${allowSms ? " and texting the caller" : ""}`);

    // 1) The next spoken turn: the model writes the words, this only states the facts.
    if (this.brain && typeof this.brain.systemPrompt === "string") {
      this.brain.systemPrompt += "\n\n## Right now\nYou have asked the same thing several times and the caller is hard to understand on this line. "
        + "On your next turn, apologise briefly, say a staff member has been alerted and will follow up"
        + (allowSms ? ", and that a text message is being sent to this number so they can reply with the details in writing." : ".")
        + " Then stop asking for the missing detail.";
    }

    // 2) Staff alert + 'needs human' on the conversation (the web app sends the email).
    const tail = (this.transcript || []).slice(-8).map((t) => `${t.role === "caller" ? "Caller" : "Assistant"}: ${t.text}`).join("\n");
    if (this.inbox) await this.inbox.done();
    const url = process.env.PITCH_PLATFORM_URL, token = process.env.PITCH_PLATFORM_TOKEN;
    if (url && token && this.inbox?.conversationId) {
      try {
        const r = await fetch(`${url.replace(/\/$/, "")}/api/internal/pitch/handoff`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-pitch-token": token },
          body: JSON.stringify({ conversation_id: this.inbox.conversationId, company_id: this.inbox.companyId, caller: this.dialog.callerId,
            reason: "The phone assistant asked the same question 3 times — the caller may be hard to hear on the line.", transcript: tail }),
          signal: AbortSignal.timeout(8000),
        });
        log.info(`stuck: staff alert ${r.ok ? "sent" : "failed " + r.status}`);
      } catch (err) { log.warn(`stuck: staff alert failed — ${err.message}`); }
    } else {
      log.warn("stuck: PITCH_PLATFORM_URL / PITCH_PLATFORM_TOKEN not set — no staff alert");
    }

    // 3) SMS to the caller, written by the model (no fixed copy), sent through the router's SIM.
    if (!allowSms) return;
    const lp = require("./config").config.localPipeline || {};
    const business = this.tenant?.businessName || "the business";
    const agent = this.tenant?.pitch?.agent_name || "the assistant";
    let message = "";
    try {
      const r = await fetch(lp.qwenApiUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: lp.qwenModel, temperature: 0.3, max_tokens: 160, messages: [
          { role: "system", content: `You write one text message (SMS) from ${agent}, the AI assistant of ${business}, to a caller who was hard to understand on a phone call that is still going on. `
            + "At most 280 characters. Use the same language the caller used (English, Tagalog or Taglish). Say a staff member will follow up, and ask them to reply to this text with the details needed to help them. "
            + "No links, no emoji. Output only the message text." },
          { role: "user", content: tail || "(no transcript)" },
        ] }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      message = String(j?.choices?.[0]?.message?.content || "").replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 300);
    } catch (err) { log.warn(`stuck: could not write the SMS — ${err.message}`); }
    if (!message) return;
    const tools = require("./tools");
    const result = await tools.execute({ name: "send_sms", args: { message }, ua: this.ua, callerId: this.dialog.callerId,
      companyId: this.tenant?.companyId || null, callId: this.callId, state: this.toolState, log });
    log.info(`stuck: SMS ${result && result.sent ? "sent" : "not sent (" + (result && result.reason) + ")"}`);
    if (result && result.sent && this.inbox) this.inbox.add("sms", message);
  }

  end(reason = "ended") {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.maxTimer);

    const seconds = ((Date.now() - this.dialog.startedAt) / 1000).toFixed(1);
    require("./tenant").recordCall(this.tenant, { callerId: this.dialog.callerId, seconds, mode: this.tenant?.mode || null });
    const stats = this.rtp?.stats;
    log.info(
      `call: ended reason=${reason} duration=${seconds}s ` +
      `rtpIn=${stats?.packetsIn ?? 0} rtpOut=${stats?.packetsOut ?? 0} ` +
      `speechOut=${stats?.speechOut ?? 0} lost=${stats?.lost ?? 0}`
    );
    this._appendConversationEvent({
      type: "call_end",
      reason,
      durationSeconds: Number(seconds),
      rtp: {
        packetsIn: stats?.packetsIn ?? 0,
        packetsOut: stats?.packetsOut ?? 0,
        speechOut: stats?.speechOut ?? 0,
        lost: stats?.lost ?? 0,
      },
    });

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
