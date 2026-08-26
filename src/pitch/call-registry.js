"use strict";

const { config } = require("./config");
const { log } = require("./log");

/**
 * The set of calls in flight.
 *
 * Replaces the single `activeCall` module global, which meant ONE call for the
 * entire platform — tenant A talking made tenant B's caller hear a busy tone.
 * That was fine for one gateway on a desk and is the first thing that breaks
 * with two paying clients.
 *
 * Everything call-scoped lives in the Call object; this only tracks which ones
 * exist, enforces the caps, and hands out RTP ports without collisions.
 */
class CallRegistry {
  constructor() {
    /** @type {Map<string, {call: object, companyId: string|null, startedAt: number}>} */
    this.calls = new Map();

    // RTP ports are allocated in pairs (even = RTP, odd = RTCP). With one call
    // a rolling counter was fine; with many, a port could be reused while the
    // previous call still held the socket, so ports are tracked and released.
    this.usedPorts = new Set();
    this.nextPort = config.rtp.portStart;

    this.maxConcurrent = Number(process.env.PITCH_MAX_CONCURRENT_CALLS || 8);
  }

  get size() { return this.calls.size; }

  /** How many calls this tenant currently has up — enforces their plan. */
  countForCompany(companyId) {
    if (!companyId) return 0;
    let n = 0;
    for (const entry of this.calls.values()) {
      if (entry.companyId === companyId) n += 1;
    }
    return n;
  }

  /**
   * Reserve an even RTP port that no live call is using.
   * Returns null when the configured range is exhausted, which the caller
   * must treat as "reject with 503", not as a crash.
   */
  allocatePort() {
    const span = config.rtp.portEnd - config.rtp.portStart;
    for (let tried = 0; tried <= span; tried += 2) {
      const port = this.nextPort;
      this.nextPort += 2;
      if (this.nextPort > config.rtp.portEnd) this.nextPort = config.rtp.portStart;
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    return null;
  }

  releasePort(port) {
    if (port != null) this.usedPorts.delete(port);
  }

  /**
   * Whether a new call may proceed.
   * @returns {{ok: true} | {ok: false, status: number, reason: string, log: string}}
   */
  admit({ companyId, maxChannels }) {
    if (this.calls.size >= this.maxConcurrent) {
      return {
        ok: false, status: 503, reason: "Service Unavailable",
        log: `server at capacity (${this.calls.size}/${this.maxConcurrent})`,
      };
    }
    // A tenant on a one-line plan gets one line. Enforced here because the
    // customer can edit their gateway but not this.
    const limit = Number(maxChannels || 1);
    if (companyId && this.countForCompany(companyId) >= limit) {
      return {
        ok: false, status: 486, reason: "Busy Here",
        log: `tenant ${companyId} at its ${limit}-channel limit`,
      };
    }
    return { ok: true };
  }

  add(callId, call, companyId) {
    this.calls.set(callId, { call, companyId, startedAt: Date.now() });
  }

  get(callId) {
    const entry = this.calls.get(callId);
    return entry ? entry.call : null;
  }

  /** Remove a call and give its RTP port back. Safe to call twice. */
  remove(callId) {
    const entry = this.calls.get(callId);
    if (!entry) return null;
    this.calls.delete(callId);
    this.releasePort(entry.call.rtpPort);
    return entry.call;
  }

  /** End everything — shutdown only. */
  endAll(reason) {
    for (const [callId, entry] of this.calls) {
      try { entry.call.end(reason); } catch { /* noop */ }
      this.releasePort(entry.call.rtpPort);
      this.calls.delete(callId);
    }
  }

  stats() {
    const byCompany = {};
    for (const e of this.calls.values()) {
      const k = e.companyId || "unknown";
      byCompany[k] = (byCompany[k] || 0) + 1;
    }
    return { active: this.calls.size, max: this.maxConcurrent, byCompany };
  }
}

module.exports = { CallRegistry };
