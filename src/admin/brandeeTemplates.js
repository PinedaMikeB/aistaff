// Super Admin template management service layer (PART 17-19, 25).
// Thin wrapper over Prisma for both StaticAdTemplate and UgcTemplate —
// shares the versioning/status-transition logic since both models use the
// same DRAFT/ACTIVE/INACTIVE/ARCHIVED lifecycle and version/parentTemplateId
// scheme (PART 25: editing a published template creates a new version rather
// than mutating the historical one, so existing customer projects that
// recorded a specific template id+version are never silently changed).

const { prisma } = require("../db");
const { StaticTemplateInput, UgcTemplateInput } = require("../brandee/templateSchemas");

function modelFor(kind) {
  if (kind === "static") return { model: prisma.staticAdTemplate, schema: StaticTemplateInput };
  if (kind === "ugc") return { model: prisma.ugcTemplate, schema: UgcTemplateInput };
  throw new Error(`Unknown template kind: ${kind}`);
}

async function listTemplates(kind, { category = null, status = null, search = null } = {}) {
  const { model } = modelFor(kind);
  const where = {};
  if (category) where.category = category;
  if (status) where.status = status;
  if (search) where.OR = [{ name: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }];
  return model.findMany({ where, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
}

async function getTemplateById(kind, id) {
  const { model } = modelFor(kind);
  return model.findUnique({ where: { id } });
}

/**
 * Creates the FIRST version of a new template (version 1, no parent). Every
 * new template starts as DRAFT — an explicit "Activate" action is required
 * before it's ever offered publicly (PART 18: "Do not permit platform
 * templates to be changed by tenant admins" implies the reverse guarantee
 * too — nothing goes live without an explicit admin action).
 */
async function createTemplate(kind, input, actorUserId) {
  const { model, schema } = modelFor(kind);
  const data = schema.parse(input);
  return model.create({ data: { ...data, status: "DRAFT", version: 1, createdByPlatformUserId: actorUserId, updatedByPlatformUserId: actorUserId } });
}

/**
 * Publishes an edit as a NEW version (PART 25) rather than mutating the
 * existing row in place, UNLESS the existing row is still DRAFT (never
 * shown publicly yet), in which case editing it in place is safe since no
 * customer project could possibly reference it yet.
 */
async function updateTemplate(kind, id, input, actorUserId) {
  const { model, schema } = modelFor(kind);
  const existing = await model.findUnique({ where: { id } });
  if (!existing) return null;
  const data = schema.parse(input);

  if (existing.status === "DRAFT") {
    return model.update({ where: { id }, data: { ...data, updatedByPlatformUserId: actorUserId } });
  }

  // Existing row is (or was) published — create a new DRAFT version linked
  // back to it instead of mutating history.
  return model.create({
    data: {
      ...data,
      status: "DRAFT",
      version: existing.version + 1,
      parentTemplateId: existing.id,
      createdByPlatformUserId: actorUserId,
      updatedByPlatformUserId: actorUserId
    }
  });
}

async function setStatus(kind, id, status, actorUserId) {
  const { model } = modelFor(kind);
  const patch = { status, updatedByPlatformUserId: actorUserId };
  if (status === "ACTIVE") patch.publishedAt = new Date();
  if (status === "ARCHIVED") patch.archivedAt = new Date();
  if (status === "INACTIVE") patch.retiredAt = new Date();
  return model.update({ where: { id }, data: patch });
}

async function duplicateTemplate(kind, id, actorUserId) {
  const { model } = modelFor(kind);
  const existing = await model.findUnique({ where: { id } });
  if (!existing) return null;
  const {
    id: _id, createdAt, updatedAt, publishedAt, archivedAt, retiredAt, status, version, parentTemplateId,
    ...rest
  } = existing;
  return model.create({
    data: {
      ...rest,
      slug: `${existing.slug}_copy`,
      name: `${existing.name} (copy)`,
      status: "DRAFT",
      version: 1,
      parentTemplateId: null,
      createdByPlatformUserId: actorUserId,
      updatedByPlatformUserId: actorUserId
    }
  });
}

module.exports = { listTemplates, getTemplateById, createTemplate, updateTemplate, setStatus, duplicateTemplate };
