// Product-ad project persistence (image/video flow). Follows the exact same
// lightweight JSON-file pattern already used for Brandee creative plans
// (store.js) and marketing app state (data/marketing-state.json) — no new
// Prisma model/migration needed for MVP volumes. See store.js's header
// comment for the documented limitation (single file, no concurrent-write
// safety, migrate to a real table if volume grows).
//
// A project starts anonymous (keyed by an anonymous session id set in a
// cookie) and is claimed by a user_id once they register — this is what
// lets "generate preview -> register -> resume the same project" work
// without losing the customer's work (PART 13).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.join(__dirname, "..", "..");
const storePath = path.join(rootDir, "data", "brandee-product-ad-projects.json");
const anonLimitsPath = path.join(rootDir, "data", "brandee-product-ad-anon-limits.json");

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

function loadAnonLimits() {
  if (!fs.existsSync(anonLimitsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(anonLimitsPath, "utf8"));
  } catch {
    return {};
  }
}

function saveAnonLimits(all) {
  fs.mkdirSync(path.dirname(anonLimitsPath), { recursive: true });
  fs.writeFileSync(anonLimitsPath, JSON.stringify(all, null, 2));
}

function createProject({ kind, anonymousSessionId = null, userId = null, product = {} }) {
  const all = loadAll();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const project = {
    id,
    kind, // "image" | "video"
    anonymousSessionId,
    userId,
    product,
    templateId: null,
    styleId: null,
    templateFields: {},
    videoFields: {},
    preview: null, // { generatedAt, watermarked, ... }
    finalAsset: null,
    // Structured creative-planning output (PART 12) for the CURRENT/latest
    // revision — see revisions[] below for full history.
    creativePlan: null,
    // Append-only revision history (PART 16/17/19). Every generated preview
    // (the first one AND every subsequent natural-language revision) is
    // pushed here; nothing is ever overwritten, so the customer can always
    // view/compare/restore an earlier version. `preview`/`creativePlan`
    // above always mirror the LATEST entry in this array for convenience.
    revisions: [],
    status: "draft", // draft -> previewed -> registered -> subscribed -> finalized
    createdAt: now,
    updatedAt: now
  };
  all[id] = project;
  saveAll(all);
  return project;
}

function getProject(id) {
  if (!id) return null;
  const all = loadAll();
  return all[id] || null;
}

function updateProject(id, patch) {
  const all = loadAll();
  if (!all[id]) return null;
  all[id] = { ...all[id], ...patch, updatedAt: new Date().toISOString() };
  saveAll(all);
  return all[id];
}

/**
 * Claims an anonymous project for a newly registered/logged-in user,
 * preserving all product data and any preview already generated (PART 13:
 * registration happens AFTER the preview, and must not lose it).
 */
function claimProjectForUser(id, userId) {
  return updateProject(id, { userId, anonymousSessionId: null, status: "registered" });
}

function listProjectsForUser(userId) {
  if (!userId) return [];
  const all = loadAll();
  return Object.values(all).filter((p) => p.userId === userId);
}

// --- Revision history (PART 16/17/19) ----------------------------------

/**
 * Appends one revision entry (the first preview counts as revision 1) and
 * updates the project's convenience `preview`/`creativePlan` mirror fields
 * to match. Never mutates or removes a prior entry — PART 19's "the
 * customer must be able to view/compare/restore an earlier revision"
 * requires every past entry to stay exactly as it was generated.
 */
function addRevision(projectId, { instruction = null, plan = null, svg, width, height, watermarked, aiUsed = false }) {
  const project = getProject(projectId);
  if (!project) return null;
  const revisionNumber = (project.revisions || []).length + 1;
  const entry = {
    revisionNumber,
    instruction,
    plan,
    svg,
    width,
    height,
    watermarked,
    aiUsed,
    createdAt: new Date().toISOString()
  };
  const revisions = [...(project.revisions || []), entry];
  return updateProject(projectId, {
    revisions,
    creativePlan: plan,
    preview: { generatedAt: entry.createdAt, watermarked, svg }
  });
}

function listRevisions(projectId) {
  const project = getProject(projectId);
  return project ? (project.revisions || []) : [];
}

/**
 * "Restore" never deletes newer revisions (PART 19) — it copies the chosen
 * older revision's content back into the convenience mirror fields AND
 * appends a NEW revision entry that is an exact copy of the restored one,
 * so the append-only history and "what is currently shown" stay consistent
 * without ever rewriting history.
 */
function restoreRevision(projectId, revisionNumber) {
  const project = getProject(projectId);
  if (!project) return null;
  const target = (project.revisions || []).find((r) => r.revisionNumber === revisionNumber);
  if (!target) return null;
  return addRevision(projectId, { instruction: `Restored revision ${revisionNumber}`, plan: target.plan, svg: target.svg, width: target.width, height: target.height, watermarked: target.watermarked, aiUsed: target.aiUsed });
}

// --- Anonymous preview rate limiting (PART 13/20) ---------------------

function canGenerateAnonymousPreview(anonymousSessionId, kind) {
  if (!anonymousSessionId) return false;
  const limits = loadAnonLimits();
  const record = limits[anonymousSessionId];
  if (!record) return true;
  return !record[`${kind}PreviewUsed`];
}

function recordAnonymousPreview(anonymousSessionId, kind) {
  if (!anonymousSessionId) return;
  const limits = loadAnonLimits();
  limits[anonymousSessionId] = { ...(limits[anonymousSessionId] || {}), [`${kind}PreviewUsed`]: true, lastUsedAt: new Date().toISOString() };
  saveAnonLimits(limits);
}

// PART 18 — a separate, smaller counter for free revisions (distinct from
// the initial-preview limit above), so "1 free preview + 1 free revision"
// can both be enforced independently for an anonymous visitor.
function canGenerateAnonymousRevision(anonymousSessionId, kind, { maxRevisions = 1 } = {}) {
  if (!anonymousSessionId) return false;
  const limits = loadAnonLimits();
  const used = limits[anonymousSessionId]?.[`${kind}RevisionsUsed`] || 0;
  return used < maxRevisions;
}

function recordAnonymousRevision(anonymousSessionId, kind) {
  if (!anonymousSessionId) return;
  const limits = loadAnonLimits();
  const current = limits[anonymousSessionId] || {};
  limits[anonymousSessionId] = { ...current, [`${kind}RevisionsUsed`]: (current[`${kind}RevisionsUsed`] || 0) + 1, lastUsedAt: new Date().toISOString() };
  saveAnonLimits(limits);
}

module.exports = {
  createProject,
  getProject,
  updateProject,
  claimProjectForUser,
  listProjectsForUser,
  canGenerateAnonymousPreview,
  recordAnonymousPreview,
  canGenerateAnonymousRevision,
  recordAnonymousRevision,
  addRevision,
  listRevisions,
  restoreRevision,
  storePath,
  anonLimitsPath
};
