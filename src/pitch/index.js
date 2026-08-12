"use strict";

const { config } = require("./config");
const { log } = require("./log");
const smsAgent = require("./sms-agent");
const { SipUa } = require("./sip/ua");
const { Call } = require("./call");

/**
 * Pitch entry point — its own process, separate from src/server.js.
 *
 * Run:  npm run pitch
 * Off:  PITCH_ENABLED=false (default) — exits immediately, touching nothing.
 */

let ua = null;
let activeCall = null;
let nextRtpPort = config.rtp.portStart;

function allocateRtpPort() {
  // Even ports only, per RTP convention (odd is RTCP).
  const port = nextRtpPort;
  nextRtpPort += 2;
  if (nextRtpPort > config.rtp.portEnd) nextRtpPort = config.rtp.portStart;
  return port;
}

function preflight() {
  const problems = [];
  if (!config.sip.password) problems.push("PITCH_SIP_PASSWORD is empty — set the AIO100 extension password");
  if (config.brainProvider === "openai" && !config.openai.apiKey) problems.push("OPENAI_API_KEY is empty");
  if (config.sip.localHost.startsWith("127.")) {
    problems.push("PITCH_SIP_LOCAL_HOST is loopback — the gateway cannot send RTP there; use the LAN IP");
  }
  return problems;
}

async function main() {
  if (!config.enabled) {
    log.warn("PITCH_ENABLED is not set — exiting without starting. Set PITCH_ENABLED=true to run.");
    process.exit(0);
  }

  const problems = preflight();
  if (problems.length) {
    for (const p of problems) log.error(`preflight: ${p}`);
    process.exit(1);
  }

  log.info(
    `starting — extension ${config.sip.username} -> ${config.sip.gatewayHost}:${config.sip.gatewayPort}, ` +
    `local ${config.sip.localHost}:${config.sip.localPort}, brain=${config.brainProvider}`
  );

  ua = new SipUa(config.sip);

  ua.on("registered", () => log.info(`registered as extension ${config.sip.username} — ready for calls`));

  // Inbound SMS. Handled off the SIP path — the gateway already got its 200 OK,
  // so a slow model can never hold up the trunk.
  ua.on("sms", ({ from, text }) => {
    smsAgent.handleInbound({ from, text, ua }).catch((err) =>
      log.error(`sms: unhandled — ${err.message}`)
    );
  });

  ua.on("register_failed", (status, reason) =>
    log.error(`registration failed: ${status} ${reason || ""} — check extension + password on the AIO100`)
  );
  ua.on("error", (err) => log.error(`sip: ${err.message}`));

  ua.on("incoming_call", async (dialog, controls) => {
    if (activeCall && !activeCall.ended) {
      log.warn(`rejecting call from ${dialog.callerId} — channel busy`);
      return controls.reject(486, "Busy Here");
    }

    const call = new Call({ dialog, controls, rtpPort: allocateRtpPort(), ua });
    activeCall = call;

    try {
      const ok = await call.start();
      if (!ok) activeCall = null;
    } catch (err) {
      log.error(`call: failed to start — ${err.message}`);
      call.end("start_error");
      try { controls.reject(500, "Server Internal Error"); } catch { /* already responded */ }
      activeCall = null;
    }
  });

  ua.on("call_ended", (dialog, reason) => {
    if (activeCall) {
      activeCall.end(reason);
      activeCall = null;
    }
  });

  ua.start();
}

function shutdown(signal) {
  log.info(`${signal} received — shutting down`);
  try { activeCall?.end("shutdown"); } catch { /* noop */ }
  try { ua?.stop(); } catch { /* noop */ }
  setTimeout(() => process.exit(0), 250);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => log.error(`unhandled rejection: ${err?.message || err}`));

main().catch((err) => {
  log.error(`fatal: ${err.message}`);
  process.exit(1);
});
