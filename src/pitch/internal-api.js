/**
 * Loopback-only control surface for Pitch.
 *
 * WHY: SMS goes out through the SIP UA, which lives inside THIS process. The
 * API process (src/server.js) has no access to it, so the public demo could
 * never text anyone. This is the smallest bridge that fixes that.
 *
 * SAFETY, in order of importance — Pitch answers real phone calls and must
 * never be destabilised by this:
 *
 *   1. Binds to 127.0.0.1 ONLY. Never reachable from the LAN or the tunnel.
 *   2. Requires a shared secret (PITCH_INTERNAL_TOKEN). No token set means
 *      the listener does not start at all — off by default.
 *   3. Refuses to send while a call is active. The SIM is single-channel;
 *      a MESSAGE mid-call risks the call, and the call is worth more.
 *   4. Every failure is caught. A bad request logs and returns JSON; it can
 *      never throw into the SIP event loop.
 *   5. If the port is taken, it logs and Pitch continues WITHOUT the bridge.
 *      SMS-from-demo failing is an inconvenience; Pitch not answering calls
 *      is an outage.
 */

const http = require("http");
const { log } = require("./log");

const DEFAULT_PORT = 5199;

function readBody(req, limitBytes = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > limitBytes) {
        reject(new Error("body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

/**
 * @param {object} deps
 * @param {function} deps.getUa          () => SipUa | null
 * @param {function} deps.isCallActive   () => boolean
 */
function startInternalApi({ getUa, isCallActive }) {
  const token = process.env.PITCH_INTERNAL_TOKEN;
  if (!token) {
    log.info("internal api: disabled (no PITCH_INTERNAL_TOKEN)");
    return null;
  }

  const port = Number(process.env.PITCH_INTERNAL_PORT || DEFAULT_PORT);

  const server = http.createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    try {
      if (req.method !== "POST" || req.url !== "/internal/sms") {
        return send(404, { ok: false, error: "not_found" });
      }
      if (req.headers["x-pitch-token"] !== token) {
        return send(401, { ok: false, error: "unauthorized" });
      }

      const body = JSON.parse((await readBody(req)) || "{}");
      const to = String(body.to || "").trim();
      const message = String(body.message || "").trim();

      if (!/^\+?\d{7,15}$/.test(to)) return send(400, { ok: false, error: "bad_number" });
      if (!message) return send(400, { ok: false, error: "empty_message" });

      const ua = getUa();
      if (!ua) return send(503, { ok: false, error: "sip_not_ready" });
      if (isCallActive()) return send(409, { ok: false, error: "call_in_progress" });

      await ua.sendMessage(to, message);
      log.info(`internal api: sms sent to ${to} (${message.length} chars)`);
      return send(200, { ok: true, to });
    } catch (error) {
      log.error(`internal api: ${error.message}`);
      try {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "internal_error" }));
      } catch { /* response already gone */ }
    }
  });

  server.on("error", (error) => {
    // Never fatal. Pitch answering calls matters more than this bridge.
    log.error(`internal api: not listening — ${error.message}`);
  });

  server.listen(port, "127.0.0.1", () => {
    log.info(`internal api: listening on 127.0.0.1:${port}`);
  });

  return server;
}

module.exports = { startInternalApi, DEFAULT_PORT };
