// Product-ad project persistence (image/video flow) — Postgres-backed via
// Prisma (prisma/schema.prisma's ProductAdProject/ProductAdRevision/
// ProductAdImageAsset models). Was a lightweight JSON-file store; migrated
// because uploaded images now live as real files on disk referenced by URL
// (imageAssetStore.js) instead of embedded base64 blobs, and growing
// multi-customer volume made a single JSON file with no concurrent-write
// safety a real risk. Every exported function keeps the exact same name
// and argument shape as the old store — the difference callers must
// account for is that every one of these now returns a Promise and must
// be awaited (they touch a real database now, not an in-memory object).
//
// Anonymous per-session rate-limit flags (canGenerateAnonymousPreview/
// Revision) stay in the small JSON file they were already in — low
// per-customer footprint (a couple of booleans), not the thing that was
// actually growing unboundedly, so migrating them isn't warranted yet.

const fs = require("fs");
const path = require("path");
const { prisma } = require("../db");

const rootDir = path.join(__dirname, "..", "..");
const anonLimitsPath = path.join(rootDir, "data", "brandee-product-ad-anon-limits.json");

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

function mapRevision(r) {
  return { revisionNumber: r.revisionNumber, instruction: r.instruction, plan: r.plan, svg: r.svg, width: r.width, height: r.height, watermarked: r.watermarked, aiUsed: r.aiUsed, createdAt: r.createdAt.toISOString() };
}

function serializeProject(project, revisions) {
  if (!project) return null;
  return { ...project, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString(), revisions: (revisions || []).map(mapRevision) };
}

async function attachRevisions(project) {
  if (!project) return null;
  const revisions = await prisma.productAdRevision.findMany({ where: { projectId: project.id }, orderBy: { revisionNumber: "asc" } });
  return serializeProject(project, revisions);
}

async function createProject({ kind, anonymousSessionId = null, userId = null, product = {} }) {
  const project = await prisma.productAdProject.create({ data: { kind, anonymousSessionId, userId, product } });
  return serializeProject(project, []);
}

async function getProject(id) {
  if (!id) return null;
  try {
    const project = await prisma.productAdProject.findUnique({ where: { id } });
    return attachRevisions(project);
  } catch {
    return null;
  }
}

async function updateProject(id, patch) {
  if (!id) return null;
  try {
    const project = await prisma.productAdProject.update({ where: { id }, data: patch });
    return attachRevisions(project);
  } catch {
    return null;
  }
}

async function claimProjectForUser(id, userId) {
  return updateProject(id, { userId, anonymousSessionId: null, status: "registered" });
}

async function listProjectsForUser(userId) {
  if (!userId) return [];
  const projects = await prisma.productAdProject.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return Promise.all(projects.map(attachRevisions));
}

// --- Revision history (append-only; nothing is ever overwritten/deleted, so
// the customer can always view/compare/restore an earlier version) --------

async function addRevision(projectId, { instruction = null, plan = null, svg, width, height, watermarked, aiUsed = false }) {
  const count = await prisma.productAdRevision.count({ where: { projectId } });
  const revisionNumber = count + 1;
  await prisma.productAdRevision.create({
    data: { projectId, revisionNumber, instruction, plan: plan ?? undefined, svg, width, height, watermarked, aiUsed }
  });
  return updateProject(projectId, {
    creativePlan: plan ?? undefined,
    preview: { generatedAt: new Date().toISOString(), watermarked, svg }
  });
}

async function listRevisions(projectId) {
  const revisions = await prisma.productAdRevision.findMany({ where: { projectId }, orderBy: { revisionNumber: "asc" } });
  return revisions.map(mapRevision);
}

async function restoreRevision(projectId, revisionNumber) {
  const target = await prisma.productAdRevision.findUnique({ where: { projectId_revisionNumber: { projectId, revisionNumber } } });
  if (!target) return null;
  return addRevision(projectId, { instruction: `Restored revision ${revisionNumber}`, plan: target.plan, svg: target.svg, width: target.width, height: target.height, watermarked: target.watermarked, aiUsed: target.aiUsed });
}

// --- "Analyze Product" persistence --------------------------------------

async function saveAnalysis(projectId, analysis) {
  return updateProject(projectId, { analysis });
}

async function recordSuggestionDecision(projectId, suggestionId, decision) {
  const project = await getProject(projectId);
  if (!project) return null;
  const suggestionDecisions = { ...(project.suggestionDecisions || {}), [suggestionId]: decision };
  return updateProject(projectId, { suggestionDecisions });
}

// --- Anonymous preview/revision rate limiting (unchanged JSON-file logic) --

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
  saveAnalysis,
  recordSuggestionDecision,
  anonLimitsPath
};
