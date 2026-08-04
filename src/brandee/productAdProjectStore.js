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

module.exports = {
  createProject,
  getProject,
  updateProject,
  claimProjectForUser,
  listProjectsForUser,
  canGenerateAnonymousPreview,
  recordAnonymousPreview,
  storePath,
  anonLimitsPath
};
