// Safe model/service/system status checks for the Super Admin overview and
// the Creative Brain "integrity actions". Every check here returns a small,
// safe result shape — never a raw secret, never a full stack trace.
//
// STATUS values used throughout: Active | Missing | Invalid | Unreachable | Not tested

const fs = require("fs");
const path = require("path");

const fetchImpl = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

function envConfigured(name) {
  return process.env[name] ? "Configured" : "Not configured";
}

async function withTiming(fn) {
  const start = Date.now();
  try {
    const result = await fn();
    return { ...result, durationMs: Date.now() - start };
  } catch (error) {
    return { status: "Invalid", errorCode: "ADMIN_UNKNOWN_ERROR", message: safeMessage(error), durationMs: Date.now() - start };
  }
}

function safeMessage(error) {
  // Never forward raw stack traces or provider payloads to the browser.
  const msg = String(error?.message || error || "Unknown error");
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

async function timeoutAfter(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out")), ms));
}

// ---------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------

async function checkDatabase() {
  return withTiming(async () => {
    // Lazily required — only this one check needs a Prisma client, so
    // nothing else in this module forces a database connection attempt.
    const { prisma } = require("../db");
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeoutAfter(5000)]);
    return { status: "Active", errorCode: null, message: "Connected." };
  });
}

// ---------------------------------------------------------------------
// Storage (local filesystem — no object storage is configured in this repo)
// ---------------------------------------------------------------------

async function checkStorage() {
  return withTiming(async () => {
    const dataDir = path.join(__dirname, "..", "..", "data");
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      // Overwrite a single fixed marker file rather than create-then-delete a
      // probe file — some mounted/synced filesystems allow writes but not
      // deletes from this process, which would otherwise read as a false
      // "storage unwritable" failure.
      const probePath = path.join(dataDir, ".admin-storage-check");
      fs.writeFileSync(probePath, `last checked: ${new Date().toISOString()}`);
      return { status: "Active", errorCode: null, message: "Local filesystem storage (data/) is writable. No object storage (e.g. S3) is configured in this project." };
    } catch (error) {
      return { status: "Invalid", errorCode: "ADMIN_SERVICE_UNAVAILABLE", message: safeMessage(error) };
    }
  });
}

// ---------------------------------------------------------------------
// Queue / job system
// ---------------------------------------------------------------------

function checkQueue() {
  // No BullMQ/Redis (or any queue) dependency exists in package.json today.
  // The Remotion render pipeline (src/marketing.js) is a separate, unrelated
  // legacy feature and does not back Brandee's plan generation.
  return { status: "Not tested", errorCode: null, message: "Not configured — Brandee plan generation runs synchronously in the request; no queue/job system is present.", durationMs: 0 };
}

// ---------------------------------------------------------------------
// Website scraper — functional self-test only. Per instructions this must
// NOT fetch any real external site (the owner tests real sites through the
// normal Brandee customer flow). Instead this proves the SSRF-safety logic
// itself is intact: known-bad inputs must still be rejected.
// ---------------------------------------------------------------------

async function checkWebsiteScraper() {
  return withTiming(async () => {
    const { normalizeUrlInput, parseUrlOrThrow, isBlockedIp } = require("../brandee/websiteAnalyzer");
    const stages = [];

    // Stage 1: protocol/host blocklist must still reject localhost.
    try {
      parseUrlOrThrow(normalizeUrlInput("http://localhost/"));
      stages.push("FAILED: localhost was not rejected");
    } catch {
      stages.push("OK: localhost rejected");
    }

    // Stage 2: a normal public-looking hostname must still be accepted by
    // the parser (this does not perform any network request).
    try {
      parseUrlOrThrow(normalizeUrlInput("example.com"));
      stages.push("OK: public hostname accepted by parser");
    } catch (error) {
      stages.push(`FAILED: public hostname rejected unexpectedly (${safeMessage(error)})`);
    }

    // Stage 3: private IPv4 must be blocked at the IP layer.
    if (typeof isBlockedIp === "function") {
      stages.push(isBlockedIp("10.0.0.5") ? "OK: private IPv4 blocked" : "FAILED: private IPv4 not blocked");
    }

    const failed = stages.some((s) => s.startsWith("FAILED"));
    return {
      status: failed ? "Invalid" : "Active",
      errorCode: failed ? "ADMIN_VALIDATION_FAILED" : null,
      message: stages.join("; ")
    };
  });
}

// ---------------------------------------------------------------------
// Extraction — this repo's extraction path is a deterministic heuristic
// (regex-based), not an LLM call (see src/brandee/websiteAnalyzer.js), so
// there is no external "extraction model" to test today. Report accurately
// rather than inventing a model status.
// ---------------------------------------------------------------------

async function checkExtractionModel() {
  return {
    status: "Not tested",
    errorCode: null,
    message: "Extraction is a deterministic heuristic (regex-based content parsing), not an external model call. Nothing to test.",
    durationMs: 0
  };
}

// ---------------------------------------------------------------------
// Planner model — the optional AI-polish layer on top of the deterministic
// planner (src/brandee/planner.js). Safe, generic connectivity check only —
// no domain/company-specific content is sent.
// ---------------------------------------------------------------------

async function checkPlannerModel() {
  const provider = process.env.AI_PROVIDER || "mock";
  if (provider === "mock") {
    return { status: "Not tested", errorCode: null, message: "AI_PROVIDER=mock — deterministic planning only, no external planner model configured.", durationMs: 0 };
  }

  return withTiming(async () => {
    if (provider === "openai") {
      if (!process.env.OPENAI_API_KEY) return { status: "Missing", errorCode: "ADMIN_SERVICE_UNAVAILABLE", message: "OPENAI_API_KEY is not configured." };
      const res = await Promise.race([
        fetchImpl("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }),
        timeoutAfter(6000)
      ]);
      if (res.status === 401 || res.status === 403) return { status: "Invalid", errorCode: "ADMIN_SERVICE_UNAVAILABLE", message: "Credentials rejected by OpenAI." };
      if (!res.ok) return { status: "Unreachable", errorCode: "ADMIN_SERVICE_UNAVAILABLE", message: `OpenAI responded with HTTP ${res.status}.` };
      return { status: "Active", errorCode: null, message: `Reachable using model ${process.env.OPENAI_MODEL || "gpt-4.1-mini"}.` };
    }
    if (provider === "gemini") {
      if (!process.env.GEMINI_API_KEY) return { status: "Missing", errorCode: "ADMIN_SERVICE_UNAVAILABLE", message: "GEMINI_API_KEY is not configured." };
      const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
      const res = await Promise.race([
        fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${process.env.GEMINI_API_KEY}`),
        timeoutAfter(6000)
      ]);
      if (res.status === 401 || res.status === 403) return { status: "Invalid", errorCode: "ADMIN_SERVICE_UNAVAILABLE", message: "Credentials rejected by Gemini." };
      if (!res.ok) return { status: "Unreachable", errorCode: "ADMIN_SERVICE_UNAVAILABLE", message: `Gemini responded with HTTP ${res.status}.` };
      return { status: "Active", errorCode: null, message: `Reachable using model ${model}.` };
    }
    return { status: "Invalid", errorCode: "ADMIN_INVALID_INPUT", message: `Unknown AI_PROVIDER value: ${provider}` };
  });
}

async function checkFallbackModel() {
  // No distinct fallback-model provider is configured in this repo today —
  // the deterministic planner itself is the fallback whenever the AI-polish
  // call fails (see src/brandee/planner.js enhancePlanWithAi()).
  return { status: "Active", errorCode: null, message: "The deterministic planning engine itself serves as the fallback whenever the configured AI provider is unavailable.", durationMs: 0 };
}

function safeServiceConfigSnapshot() {
  return {
    AI_PROVIDER: process.env.AI_PROVIDER || "mock",
    OPENAI_API_KEY: envConfigured("OPENAI_API_KEY"),
    OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    GEMINI_API_KEY: envConfigured("GEMINI_API_KEY"),
    GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    DATABASE_URL: envConfigured("DATABASE_URL"),
    JWT_SECRET: envConfigured("JWT_SECRET"),
    ENCRYPTION_SECRET: envConfigured("ENCRYPTION_SECRET"),
    XENDIT_SECRET_KEY: envConfigured("XENDIT_SECRET_KEY"),
    STRIPE_SECRET_KEY: envConfigured("STRIPE_SECRET_KEY"),
    META_APP_SECRET: envConfigured("META_APP_SECRET"),
    META_PAGE_ACCESS_TOKEN: envConfigured("META_PAGE_ACCESS_TOKEN"),
    NODE_ENV: process.env.NODE_ENV || "development"
  };
}

module.exports = {
  envConfigured,
  checkDatabase,
  checkStorage,
  checkQueue,
  checkWebsiteScraper,
  checkExtractionModel,
  checkPlannerModel,
  checkFallbackModel,
  safeServiceConfigSnapshot
};
