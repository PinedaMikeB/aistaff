"use strict";

const crypto = require("crypto");
const sip = require("sip");
const { EventEmitter } = require("events");

/**
 * SIP user agent — registers Pitch as an extension on the AIO100 and answers
 * inbound INVITEs.
 *
 * The AIO100 has a built-in SIP server (32 extensions), so no Asterisk or
 * FreeSWITCH is needed for a single channel. When we need multiple concurrent
 * calls or transfer trees, a real softswitch goes in between; the events this
 * class emits are intended to stay the same when that happens.
 */

function digestResponse({ username, password, realm, nonce, method, uri, qop, nc, cnonce }) {
  const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  if (qop) return md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  return md5(`${ha1}:${nonce}:${ha2}`);
}

function parseAuthHeader(header) {
  const unquote = (v) => String(v ?? "").trim().replace(/^"|"$/g, "");
  const out = {};

  // The `sip` module registers a parser for www-authenticate /
  // proxy-authenticate, so by the time we see the challenge it is ALREADY an
  // object — { scheme: "Digest", realm: '"..."', nonce: '"..."' } — with each
  // value still carrying its surrounding quotes. Passing that through String()
  // yields "[object Object]", the nonce disappears, and registration dies with
  // "auth challenge missing nonce". The raw-string branch below is kept for
  // transports that hand the header over unparsed.
  if (header && typeof header === "object" && (header.nonce || header.scheme)) {
    for (const [k, v] of Object.entries(header)) {
      if (k !== "scheme") out[k] = unquote(v);
    }
    return out;
  }

  const body = String(header?.value ?? header ?? "").replace(/^Digest\s+/i, "");
  for (const part of body.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    out[k] = unquote(part.slice(idx + 1));
  }
  return out;
}

class SipUa extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.started = false;
    this.registered = false;
    this.registerTimer = null;
    this.cseq = Math.floor(Math.random() * 1000) + 1;
    this.callId = null;
    this.activeDialog = null;
  }

  get uri() {
    return `sip:${this.cfg.username}@${this.cfg.gatewayHost}`;
  }

  get contact() {
    return `<sip:${this.cfg.username}@${this.cfg.localHost}:${this.cfg.localPort}>`;
  }

  start() {
    if (this.started) return;
    sip.start(
      { address: this.cfg.localHost, port: this.cfg.localPort, publicAddress: this.cfg.localHost },
      (req) => this._onRequest(req)
    );
    this.started = true;
    this.register();
  }

  register() {
    return this._doRegister(this.cfg.registerExpires);
  }

  /**
   * Tell the gateway to drop our binding (REGISTER with expires 0).
   *
   * Without this, every restart leaves the AIO100 holding a contact that
   * points at a dead socket. It then delivers INVITEs there and the caller
   * hears one ring and a busy tone until the binding times out. Restarting
   * often — as happens while tuning — stacks several dead contacts up.
   */
  unregister() {
    clearTimeout(this.registerTimer);
    this.registered = false;
    return this._doRegister(0);
  }

  _doRegister(expires) {
    const callId = this.callId || (this.callId = `pitch-reg-${crypto.randomBytes(8).toString("hex")}`);
    const send = (authHeaders) => {
      this.cseq += 1;
      const req = {
        method: "REGISTER",
        uri: `sip:${this.cfg.gatewayHost}:${this.cfg.gatewayPort}`,
        headers: {
          to: { uri: this.uri },
          from: { uri: this.uri, params: { tag: crypto.randomBytes(6).toString("hex") } },
          "call-id": callId,
          cseq: { method: "REGISTER", seq: this.cseq },
          contact: [{ uri: `sip:${this.cfg.username}@${this.cfg.localHost}:${this.cfg.localPort}` }],
          expires,
          ...authHeaders,
        },
      };

      sip.send(req, (res) => {
        if (res.status === 401 || res.status === 407) {
          const isProxy = res.status === 407;
          const hdr = isProxy ? res.headers["proxy-authenticate"] : res.headers["www-authenticate"];
          const challenge = parseAuthHeader(Array.isArray(hdr) ? hdr[0] : hdr);
          if (!challenge.nonce) return this.emit("error", new Error("SIP auth challenge missing nonce"));

          const nc = "00000001";
          const cnonce = crypto.randomBytes(8).toString("hex");
          const uri = `sip:${this.cfg.gatewayHost}:${this.cfg.gatewayPort}`;
          const response = digestResponse({
            username: this.cfg.username,
            password: this.cfg.password,
            realm: challenge.realm,
            nonce: challenge.nonce,
            method: "REGISTER",
            uri,
            qop: challenge.qop ? "auth" : null,
            nc,
            cnonce,
          });

          let auth =
            `Digest username="${this.cfg.username}", realm="${challenge.realm}", ` +
            `nonce="${challenge.nonce}", uri="${uri}", response="${response}", algorithm=MD5`;
          if (challenge.opaque) auth += `, opaque="${challenge.opaque}"`;
          if (challenge.qop) auth += `, qop=auth, nc=${nc}, cnonce="${cnonce}"`;

          return send(isProxy ? { "proxy-authorization": auth } : { authorization: auth });
        }

        if (res.status >= 200 && res.status < 300) {
          // expires 0 is a de-registration — nothing to refresh, and marking
          // ourselves registered would be a lie.
          if (expires === 0) {
            this.registered = false;
            this.emit("unregistered");
            return;
          }
          const wasRegistered = this.registered;
          this.registered = true;
          if (!wasRegistered) this.emit("registered");
          const refresh = Math.max(30, this.cfg.registerExpires - 30) * 1000;
          clearTimeout(this.registerTimer);
          this.registerTimer = setTimeout(() => this.register(), refresh);
        } else {
          this.registered = false;
          if (expires === 0) return;   // failing to de-register is not retryable
          this.emit("register_failed", res.status, res.reason);
          clearTimeout(this.registerTimer);
          this.registerTimer = setTimeout(() => this.register(), 15000);
        }
      });
    };

    send({});
  }

  _onRequest(req) {
    switch (req.method) {
      case "INVITE":
        return this._onInvite(req);
      case "BYE": {
        sip.send(sip.makeResponse(req, 200, "OK"));
        const dialog = this.activeDialog;
        this.activeDialog = null;
        if (dialog) this.emit("call_ended", dialog, "remote_bye");
        return;
      }
      case "ACK":
        return; // dialog confirmed; nothing to do
      case "CANCEL":
        sip.send(sip.makeResponse(req, 200, "OK"));
        if (this.activeDialog) {
          const dialog = this.activeDialog;
          this.activeDialog = null;
          this.emit("call_ended", dialog, "cancelled");
        }
        return;
      case "OPTIONS":
        return sip.send(sip.makeResponse(req, 200, "OK"));
      case "MESSAGE": {
        // Inbound SMS, delivered by the gateway's SMS Route as a SIP MESSAGE.
        // Acknowledge immediately — the gateway should never wait on a model.
        sip.send(sip.makeResponse(req, 200, "OK"));
        const smsFrom = req.headers.from?.uri || "";
        const sender = (smsFrom.match(/sip:([^@]+)@/) || [])[1] || "unknown";
        const text = String(req.content || "").trim();
        if (!text) return;
        this.emit("sms", { from: sender, text, at: Date.now() });
        return;
      }
      default:
        return sip.send(sip.makeResponse(req, 405, "Method Not Allowed"));
    }
  }

  _onInvite(req) {
    if (this.activeDialog) {
      // One cellular channel. Anything beyond that is honestly busy.
      return sip.send(sip.makeResponse(req, 486, "Busy Here"));
    }

    sip.send(sip.makeResponse(req, 100, "Trying"));

    const from = req.headers.from?.uri || "";
    const callerId = (from.match(/sip:([^@]+)@/) || [])[1] || "unknown";

    const dialog = {
      request: req,
      callId: req.headers["call-id"],
      callerId,
      remoteSdp: req.content,
      startedAt: Date.now(),
    };
    this.activeDialog = dialog;

    this.emit("incoming_call", dialog, {
      ring: () => sip.send(sip.makeResponse(req, 180, "Ringing")),
      answer: (sdp) => {
        const res = sip.makeResponse(req, 200, "OK");
        res.headers.contact = [{ uri: `sip:${this.cfg.username}@${this.cfg.localHost}:${this.cfg.localPort}` }];
        res.headers["content-type"] = "application/sdp";
        res.content = sdp;
        sip.send(res);
      },
      reject: (code = 486, reason = "Busy Here") => {
        sip.send(sip.makeResponse(req, code, reason));
        this.activeDialog = null;
      },
      hangup: () => this.hangup(dialog),
    });
  }

  hangup(dialog) {
    const target = dialog || this.activeDialog;
    if (!target) return;
    const req = target.request;
    this.cseq += 1;

    sip.send({
      method: "BYE",
      uri: req.headers.contact?.[0]?.uri || this.uri,
      headers: {
        to: req.headers.from,
        from: req.headers.to,
        "call-id": target.callId,
        cseq: { method: "BYE", seq: this.cseq },
      },
    }, () => {});

    if (this.activeDialog === target) this.activeDialog = null;
    this.emit("call_ended", target, "local_bye");
  }

  /**
   * Send an SMS out through the gateway as a SIP MESSAGE.
   *
   * The AIO100 turns this into a real text via an SMS Route configured as:
   *   Source = SIP Extension 8001, Destination = SIM 1 / VOLTE / SMS,
   *   Dest Number Src = "Get from To Header Field", prefix/suffix None.
   * That last setting is why the recipient goes in the To header rather than
   * a fixed number on the gateway — the code picks who to text, per call.
   *
   * Resolves on a 2xx, rejects otherwise. 170 character limit on the SIM.
   */
  sendMessage(toNumber, text) {
    return new Promise((resolve, reject) => {
      const uri = `sip:${toNumber}@${this.cfg.gatewayHost}:${this.cfg.gatewayPort}`;
      const callId = `pitch-sms-${crypto.randomBytes(8).toString("hex")}`;

      const send = (authHeaders, attempt = 0) => {
        this.cseq += 1;
        const req = {
          method: "MESSAGE",
          uri,
          headers: {
            to: { uri: `sip:${toNumber}@${this.cfg.gatewayHost}` },
            from: { uri: this.uri, params: { tag: crypto.randomBytes(6).toString("hex") } },
            "call-id": callId,
            cseq: { method: "MESSAGE", seq: this.cseq },
            "content-type": "text/plain",
            ...authHeaders,
          },
          content: text,
        };

        sip.send(req, (res) => {
          if ((res.status === 401 || res.status === 407) && attempt === 0) {
            const isProxy = res.status === 407;
            const hdr = isProxy ? res.headers["proxy-authenticate"] : res.headers["www-authenticate"];
            const challenge = parseAuthHeader(Array.isArray(hdr) ? hdr[0] : hdr);
            if (!challenge.nonce) return reject(new Error("SMS auth challenge missing nonce"));

            const nc = "00000001";
            const cnonce = crypto.randomBytes(8).toString("hex");
            const response = digestResponse({
              username: this.cfg.username,
              password: this.cfg.password,
              realm: challenge.realm,
              nonce: challenge.nonce,
              method: "MESSAGE",
              uri,
              qop: challenge.qop ? "auth" : null,
              nc,
              cnonce,
            });

            let auth =
              `Digest username="${this.cfg.username}", realm="${challenge.realm}", ` +
              `nonce="${challenge.nonce}", uri="${uri}", response="${response}", algorithm=MD5`;
            if (challenge.opaque) auth += `, opaque="${challenge.opaque}"`;
            if (challenge.qop) auth += `, qop=auth, nc=${nc}, cnonce="${cnonce}"`;

            return send(isProxy ? { "proxy-authorization": auth } : { authorization: auth }, 1);
          }

          if (res.status >= 200 && res.status < 300) return resolve(res.status);
          reject(new Error(`SMS rejected: ${res.status} ${res.reason || ""}`.trim()));
        });
      };

      send({});
      setTimeout(() => reject(new Error("SMS timed out after 15s")), 15000);
    });
  }

  stop() {
    clearTimeout(this.registerTimer);
    this.registerTimer = null;
    if (this.started) {
      try { sip.stop(); } catch { /* not running */ }
      this.started = false;
    }
    this.registered = false;
  }
}

module.exports = { SipUa };
