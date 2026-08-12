"use strict";

const dgram = require("dgram");
const { EventEmitter } = require("events");
const codec = require("./codec");

/**
 * One RTP session per call.
 *
 * Receive path : UDP -> strip 12-byte RTP header -> G.711 decode -> emit 8 kHz PCM
 * Send path    : queue 8 kHz PCM -> 20 ms frames -> G.711 encode -> UDP
 *
 * The send side is clocked, not reactive. The model emits audio in bursts of
 * arbitrary size; the phone network needs exactly one 160-byte packet every
 * 20 ms. So we buffer whatever arrives and drain it on a fixed interval,
 * emitting silence when the buffer is dry. Sending bursts directly would
 * arrive as garbled or dropped audio.
 */

const RTP_HEADER_SIZE = 12;
const SAMPLES_PER_FRAME = 160; // 20 ms @ 8 kHz

class RtpSession extends EventEmitter {
  constructor({ localPort, codec: codecName = "PCMU" }) {
    super();
    this.localPort = localPort;
    this.codecName = codecName;
    this.socket = null;

    this.remoteHost = null;
    this.remotePort = null;
    // Whether we have seen inbound RTP and latched onto its real source.
    this.remoteLatched = false;

    this.sequence = Math.floor(Math.random() * 0xffff);
    this.timestamp = Math.floor(Math.random() * 0xffffffff);
    this.ssrc = Math.floor(Math.random() * 0xffffffff);

    // Outbound PCM waiting to be packetised (8 kHz Int16 samples).
    this.playoutQueue = [];
    this.playoutLength = 0;
    this.sendTimer = null;

    this.stats = { packetsIn: 0, packetsOut: 0, speechOut: 0, bytesIn: 0, lastSeq: null, lost: 0 };
    this.closed = false;
  }

  async start() {
    await new Promise((resolve, reject) => {
      this.socket = dgram.createSocket("udp4");
      this.socket.once("error", reject);
      this.socket.bind(this.localPort, () => {
        this.socket.removeListener("error", reject);
        resolve();
      });
    });

    this.socket.on("message", (msg, rinfo) => this._onPacket(msg, rinfo));
    this.socket.on("error", (err) => this.emit("error", err));

    this.sendTimer = setInterval(() => this._tick(), 20);
  }

  setRemote(host, port) {
    this.remoteHost = host;
    this.remotePort = port;
  }

  _onPacket(msg, rinfo) {
    if (msg.length < RTP_HEADER_SIZE) return;

    // Symmetric RTP: latch onto where the gateway ACTUALLY sends from, even
    // if we already set a remote from the SDP. Gateways frequently advertise
    // one port and transmit from another; sending to the advertised port then
    // gives the classic one-way call — we hear them, they hear nothing.
    if (!this.remoteLatched) {
      this.remoteLatched = true;
      if (this.remoteHost !== rinfo.address || this.remotePort !== rinfo.port) {
        this.emit("relatched", {
          from: `${this.remoteHost}:${this.remotePort}`,
          to: `${rinfo.address}:${rinfo.port}`,
        });
        this.setRemote(rinfo.address, rinfo.port);
      }
    }

    const payloadType = msg[1] & 0x7f;
    const seq = msg.readUInt16BE(2);

    if (this.stats.lastSeq !== null) {
      const expected = (this.stats.lastSeq + 1) & 0xffff;
      if (seq !== expected) {
        const gap = (seq - expected) & 0xffff;
        if (gap < 100) this.stats.lost += gap;
      }
    }
    this.stats.lastSeq = seq;
    this.stats.packetsIn++;
    this.stats.bytesIn += msg.length;

    const name = codec.codecForPayloadType(payloadType);
    if (!name) return; // ignore comfort noise / telephone-event / unknown

    // Skip CSRC list if present.
    const csrcCount = msg[0] & 0x0f;
    const offset = RTP_HEADER_SIZE + csrcCount * 4;
    if (msg.length <= offset) return;

    const pcm = codec.decode(msg.subarray(offset), name);
    this.emit("audio", pcm);
  }

  /** Queue 8 kHz Int16 PCM for transmission. */
  write(pcm8k) {
    if (this.closed || !pcm8k || pcm8k.length === 0) return;
    this.playoutQueue.push(pcm8k);
    this.playoutLength += pcm8k.length;
  }

  /** Drop anything not yet sent — used when the caller barges in. */
  flush() {
    this.playoutQueue = [];
    this.playoutLength = 0;
  }

  _takeFrame() {
    const frame = new Int16Array(SAMPLES_PER_FRAME);
    if (this.playoutLength === 0) return { frame, silent: true };

    let filled = 0;
    while (filled < SAMPLES_PER_FRAME && this.playoutQueue.length > 0) {
      const head = this.playoutQueue[0];
      const need = SAMPLES_PER_FRAME - filled;

      if (head.length <= need) {
        frame.set(head, filled);
        filled += head.length;
        this.playoutQueue.shift();
        this.playoutLength -= head.length;
      } else {
        frame.set(head.subarray(0, need), filled);
        this.playoutQueue[0] = head.subarray(need);
        this.playoutLength -= need;
        filled += need;
      }
    }
    return { frame, silent: false };
  }

  _tick() {
    if (this.closed || !this.remoteHost || !this.socket) return;

    const { frame, silent } = this._takeFrame();
    const payload = codec.encode(frame, this.codecName);
    const packet = Buffer.allocUnsafe(RTP_HEADER_SIZE + payload.length);

    packet[0] = 0x80; // version 2
    packet[1] = codec.PAYLOAD_TYPES[this.codecName] ?? 0;
    packet.writeUInt16BE(this.sequence, 2);
    packet.writeUInt32BE(this.timestamp >>> 0, 4);
    packet.writeUInt32BE(this.ssrc, 8);
    payload.copy(packet, RTP_HEADER_SIZE);

    this.sequence = (this.sequence + 1) & 0xffff;
    this.timestamp = (this.timestamp + SAMPLES_PER_FRAME) >>> 0;

    this.socket.send(packet, this.remotePort, this.remoteHost, (err) => {
      if (err) this.emit("error", err);
    });
    this.stats.packetsOut++;
    if (!silent) this.stats.speechOut++;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.sendTimer) clearInterval(this.sendTimer);
    this.sendTimer = null;
    this.playoutQueue = [];
    this.playoutLength = 0;
    if (this.socket) {
      try { this.socket.close(); } catch { /* already closed */ }
      this.socket = null;
    }
    this.emit("closed", this.stats);
  }
}

module.exports = { RtpSession, SAMPLES_PER_FRAME };
