// Brandee Creative Plan persistence.
//
// This repo's Prisma/Postgres schema (prisma/schema.prisma) has no model for
// marketing-plan documents, and adding one requires a migration against
// Mike's live database that this change cannot safely apply or verify from
// here. Instead this follows the exact lightweight pattern already used
// elsewhere in this repo for non-relational app state — see
// data/marketing-state.json + src/marketing.js's loadState/saveState.
//
// LIMITATION (documented per the task brief's persistence guidance): this is
// a single JSON file, not a queryable table. It's fine for MVP volumes but
// does not scale, has no concurrent-write safety beyond a single writer
// process, and every plan is loaded into memory on each read. If Brandee
// plan volume grows, migrate this to a real Prisma model (e.g. `BrandeePlan`)
// — the shape here was deliberately kept close to a future Prisma row so
// that migration is a straight lift.

const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..", "..");
const storePath = path.join(rootDir, "data", "brandee-plans.json");

// We intentionally do NOT persist raw scraped HTML here (only normalized,
// already-extracted analysis + the plan) — see websiteAnalyzer.js, which
// never returns raw HTML past the extraction step.
function loadAll() {
  if (!fs.existsSync(storePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    return {};
  }
}

function saveAll(all) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(all, null, 2));
}

function savePlan({
  plan,
  websiteAnalysis,
  decisionConstraints = null,
  form,
  userId = null,
  sessionId = null,
  aiUsed = false,
  extractionModel = "deterministic",
  plannerModel = null,
  creativeBrainVersion = null,
  requestId = null,
  durationMs = null
}) {
  const all = loadAll();
  all[plan.planId] = {
    planId: plan.planId,
    requestId,
    submittedUrl: form.url,
    submittedBusinessDetails: {
      selectedGoal: form.selectedGoal,
      whatYouSell: form.whatYouSell,
      idealCustomer: form.idealCustomer,
      platform: form.platform,
      language: form.language,
      offer: form.offer || null,
      differentiator: form.differentiator || null,
      additionalInfo: form.additionalInfo || null
    },
    websiteAnalysis,
    decisionConstraints,
    selectedGoal: form.selectedGoal,
    plan,
    createdAt: plan.createdAt,
    status: "generated",
    userId,
    sessionId,
    aiUsed,
    extractionModel,
    plannerModel,
    creativeBrainVersion,
    durationMs
  };
  saveAll(all);
  return all[plan.planId];
}

function getPlan(planId) {
  const all = loadAll();
  return all[planId] || null;
}

function listPlansForSession(sessionId) {
  if (!sessionId) return [];
  const all = loadAll();
  return Object.values(all).filter((record) => record.sessionId === sessionId);
}

module.exports = { savePlan, getPlan, listPlansForSession, storePath };
