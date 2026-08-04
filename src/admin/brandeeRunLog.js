// Brandee plan-generation run log — for Super Admin monitoring only.
//
// This is purely additive instrumentation around the EXISTING
// POST /api/public/brandee/analyze route (src/server.js). It does not change
// any scraping/extraction/planning behavior — it only records the outcome
// (timestamp, tenant/session, domain, goal, status, timing, model config)
// of each attempt so the admin overview and Brandee Runs page have real
// data instead of fabricated metrics.
//
// Same lightweight JSON-file convention as data/brandee-plans.json
// (src/brandee/store.js) — see that file's own header comment for the
// documented limitation (single file, no concurrent-write safety, not a
// substitute for a real table at higher volume).
//
// Privacy: never store full submitted text (whatYouSell/idealCustomer/
// additionalInfo/etc.) here — only the submitted domain (hostname), goal
// slugs, and safe diagnostic fields. Full plan content already lives in
// data/brandee-plans.json behind its own planId and is not duplicated here.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const storePath = path.join(__dirname, "..", "..", "data", "brandee-run-log.json");
const MAX_ENTRIES = 500;

function loadAll() {
  if (!fs.existsSync(storePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(entries) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(entries.slice(0, MAX_ENTRIES), null, 2));
}

function safeHostname(rawUrl) {
  if (!rawUrl) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(withProtocol).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Records one plan-generation attempt (success or failure). Never throws —
 * a logging failure must not break the customer-facing Brandee flow.
 */
function recordRun({
  status, // "success" | "failed"
  submittedUrl = null,
  sessionId = null,
  userId = null,
  sourceMode = "guided", // "guided" | "pro" — reserved for when Pro Mode has a production backend
  selectedGoal = null,
  recommendedGoal = null,
  failedStage = null,
  safeErrorCode = null,
  durationMs = null,
  extractionModel = "heuristic",
  plannerModel = null,
  creativeBrainVersion = null,
  retryCount = 0,
  requestId = null,
  // PART 28 — safe (no page content, no secrets) crawl diagnostics for
  // Super Admin visibility into how deeply Brandee actually read a site.
  crawlDiagnostics = null
}) {
  try {
    const all = loadAll();
    const entry = {
      requestId: requestId || crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      sessionId,
      userId,
      submittedDomain: safeHostname(submittedUrl),
      sourceMode,
      selectedGoal,
      recommendedGoal,
      status,
      failedStage,
      safeErrorCode,
      durationMs,
      extractionModel,
      plannerModel,
      creativeBrainVersion,
      retryCount,
      crawlDiagnostics
    };
    all.unshift(entry);
    saveAll(all);
    return entry;
  } catch (error) {
    console.error("[brandee-run-log] failed to record run (non-fatal):", error.message);
    return null;
  }
}

function listRuns({ limit = 50 } = {}) {
  return loadAll().slice(0, Math.min(Math.max(Number(limit) || 50, 1), MAX_ENTRIES));
}

function getRunStats() {
  const all = loadAll();
  const total = all.length;
  const successes = all.filter((r) => r.status === "success");
  const failures = all.filter((r) => r.status === "failed");
  const durations = all.map((r) => r.durationMs).filter((d) => typeof d === "number" && d >= 0);
  const avgDurationMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  return {
    totalAttempts: total,
    successCount: successes.length,
    failedCount: failures.length,
    successRate: total > 0 ? Number(((successes.length / total) * 100).toFixed(1)) : null,
    avgDurationMs,
    lastSuccessfulRun: successes[0] || null,
    lastFailedRun: failures[0] || null
  };
}

module.exports = { recordRun, listRuns, getRunStats, storePath };
