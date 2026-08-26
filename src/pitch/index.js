"use strict";

const { config } = require("./config");
const { log } = require("./log");
const smsAgent = require("./sms-agent");
const { SipUa } = require("./sip/ua");
const { Call } = require("./call");
const { startInternalApi } = require("./internal-api");
const { CallRegistry } = require("./call-registry");
const { resolveCompany } = require("./tenant");

/**
 * Pitch entry point — its own process, separate from src/server.js.
 *
 * Run:  npm run pitch
 * Off:  PITCH_ENABLED=false (default) — exits immediately, touching nothing.
 */

let ua = null;
const registry = new CallRegistry();

function preflight() {
  const problems = [];
  if (!config.sip.password) problems.push("PITCH_SIP_PASSWORD is empty — set the AIO100 extension password");
  if (config.brainProvider === "openai" && !config.openai.apiKey) problems.push("OPENAI_API_KEY is empty");
  if (config.brainProvider === "gemini" && !config.gemini.apiKey) problems.push("GEMINI_API_KEY is empty");
  if (config.brainProvider === "local" || config.brainProvider === "local-pipeline") {
    if (!config.gemini.apiKey) problems.push("GEMINI_API_KEY is empty — local pipeline needs Gemini text");
    if (!config.localPipeline.whisperUrl) problems.push("PITCH_LOCAL_WHISPER_URL is empty — local pipeline needs whisper.cpp");
    if (!config.localPipeline.voxcpmUrl) problems.push("PITCH_VOXCPM2_URL is empty — local pipeline needs VoxCPM2 TTS");
  }
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
    // Which tenant is this for? Today one gateway means one company and this
    // falls back to PITCH_COMPANY_ID. Once boxes register to our own Asterisk,
    // the SIP auth username arrives on the dialog and resolves the tenant with
    // no change to anything below this line.
    const tenant = await resolveCompany({
      authUsername: dialog.authUsername || dialog.toUser || null,
    });

    if (tenant.maxChannels === 0) {
      log.warn(`rejecting ${dialog.callerId} — tenant ${tenant.source}`);
      return controls.reject(503, "Service Unavailable");
    }

    const verdict = registry.admit(tenant);
    if (!verdict.ok) {
      log.warn(`rejecting ${dialog.callerId} — ${verdict.log}`);
      return controls.reject(verdict.status, verdict.reason);
    }

    const rtpPort = registry.allocatePort();
    if (rtpPort == null) {
      log.error("rejecting call — RTP port range exhausted");
      return controls.reject(503, "Service Unavailable");
    }

    const callId = dialog.callId || dialog.id;
    const call = new Call({ dialog, controls, rtpPort, ua, tenant });
    registry.add(callId, call, tenant.companyId);

    try {
      const ok = await call.start();
      if (!ok) registry.remove(callId);
      else log.info(`call: active ${registry.size}/${registry.maxConcurrent}`);
    } catch (err) {
      log.error(`call: failed to start — ${err.message}`);
      call.end("start_error");
      registry.remove(callId);
      try { controls.reject(500, "Server Internal Error"); } catch { /* already responded */ }
    }
  });

  ua.on("call_ended", (dialog, reason) => {
    const callId = dialog.callId || dialog.id;
    const call = registry.remove(callId);
    if (call) call.end(reason);
  });

  ua.start();

  // Loopback bridge so the API process can send SMS through this SIP UA.
  // Off unless PITCH_INTERNAL_TOKEN is set; never fatal if it cannot bind.
  startInternalApi({
    getUa: () => ua,
    isCallActive: () => registry.size > 0,
    getCallStats: () => registry.stats()
  });
}

function shutdown(signal) {
  log.info(`${signal} received — shutting down`);
  try { registry.endAll("shutdown"); } catch { /* noop */ }

  // Drop our binding on the gateway before we go. Without this the AIO100
  // keeps routing INVITEs to a dead socket and the caller hears one ring then
  // busy, until the registration times out. Give it a moment to go out, but
  // never block exit on it.
  try { ua?.unregister(); } catch { /* noop */ }

  setTimeout(() => {
    try { ua?.stop(); } catch { /* noop */ }
    process.exit(0);
  }, 600);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => log.error(`unhandled rejection: ${err?.message || err}`));

main().catch((err) => {
  log.error(`fatal: ${err.message}`);
  process.exit(1);
});
