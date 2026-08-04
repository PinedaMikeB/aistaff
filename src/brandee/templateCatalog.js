// Runtime template catalog — reads Super Admin-managed templates from
// Postgres (StaticAdTemplate / UgcTemplate) and adapts them into the same
// shape the image/video ad flows already consume (imageAdTemplates.js's
// `{id, name, description, bestUse, thumbnail, proofRequirement, fields}`
// and videoAdStyles.js's `{id, name, description, poster, ...}`), so the
// rest of the codebase (imageAdRenderer.js, the product-ad API routes, the
// client flow pages) does not need to know templates now live in the
// database.
//
// FALLBACK: if the database is unreachable (this exact condition is real —
// see the deliverables report's "no live DB in the sandbox" limitation) or
// no ACTIVE rows exist yet (fresh install, before the seed script has run),
// every function here falls back to the code-level defaults in
// imageAdTemplates.js/videoAdStyles.js. This keeps the public site
// functional even before/without a database, and is logged (not silent) so
// an operator notices the DB path isn't actually being used.

const { prisma } = require("../db");
const { IMAGE_AD_TEMPLATES, isTemplateAvailable: isStaticFallbackTemplateAvailable } = require("./imageAdTemplates");
const { VIDEO_AD_STYLES } = require("./videoAdStyles");

let loggedDbFallbackOnce = false;
function warnDbFallback(context, error) {
  if (loggedDbFallbackOnce) return;
  loggedDbFallbackOnce = true;
  console.warn(`[brandee-templates] Falling back to code-level template defaults (${context}): ${error?.message || "no ACTIVE rows in database yet"}`);
}

function fieldDefsFromDbTemplate(row) {
  return [...(row.requiredFieldsSchema || []), ...(row.optionalFieldsSchema || [])];
}

function adaptStaticRow(row) {
  return {
    id: row.slug,
    dbId: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    bestUse: row.category,
    thumbnail: row.thumbnailUrl || row.previewImageUrl,
    category: row.category,
    supportedAspectRatios: row.supportedAspectRatios,
    proofRequirement: (row.proofRequirements || [])[0] || null,
    fields: fieldDefsFromDbTemplate(row)
  };
}

function adaptUgcRow(row) {
  return {
    id: row.slug,
    dbId: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    poster: row.previewPosterUrl,
    category: row.category,
    suggestedLengthSeconds: (row.supportedDurations || [15])[0],
    requiredInputs: (row.requiredFieldsSchema || []).map((f) => f.key)
  };
}

async function listActiveStaticTemplates({ hasTestimonial = false } = {}) {
  try {
    const rows = await prisma.staticAdTemplate.findMany({ where: { status: "ACTIVE" }, orderBy: { sortOrder: "asc" } });
    if (rows.length) {
      return rows.map(adaptStaticRow).map((t) => ({ ...t, available: t.proofRequirement === "testimonial" ? hasTestimonial : true }));
    }
    warnDbFallback("no ACTIVE static templates in database");
  } catch (error) {
    warnDbFallback("listActiveStaticTemplates", error);
  }
  return IMAGE_AD_TEMPLATES.map((t) => ({ ...t, available: isStaticFallbackTemplateAvailable(t.id, { hasTestimonial }) }));
}

async function getStaticTemplateBySlug(slug) {
  try {
    const row = await prisma.staticAdTemplate.findFirst({ where: { slug, status: "ACTIVE" }, orderBy: { version: "desc" } });
    if (row) return adaptStaticRow(row);
    warnDbFallback(`getStaticTemplateBySlug(${slug})`);
  } catch (error) {
    warnDbFallback(`getStaticTemplateBySlug(${slug})`, error);
  }
  const fallback = IMAGE_AD_TEMPLATES.find((t) => t.id === slug);
  return fallback ? { ...fallback, dbId: null, version: null } : null;
}

async function listActiveUgcTemplates() {
  try {
    const rows = await prisma.ugcTemplate.findMany({ where: { status: "ACTIVE" }, orderBy: { sortOrder: "asc" } });
    if (rows.length) return rows.map(adaptUgcRow);
    warnDbFallback("no ACTIVE UGC templates in database");
  } catch (error) {
    warnDbFallback("listActiveUgcTemplates", error);
  }
  return VIDEO_AD_STYLES.map((s) => ({ ...s, dbId: null, version: null }));
}

async function getUgcTemplateBySlug(slug) {
  try {
    const row = await prisma.ugcTemplate.findFirst({ where: { slug, status: "ACTIVE" }, orderBy: { version: "desc" } });
    if (row) return adaptUgcRow(row);
    warnDbFallback(`getUgcTemplateBySlug(${slug})`);
  } catch (error) {
    warnDbFallback(`getUgcTemplateBySlug(${slug})`, error);
  }
  const fallback = VIDEO_AD_STYLES.find((s) => s.id === slug);
  return fallback ? { ...fallback, dbId: null, version: null } : null;
}

module.exports = {
  listActiveStaticTemplates,
  getStaticTemplateBySlug,
  listActiveUgcTemplates,
  getUgcTemplateBySlug,
  adaptStaticRow,
  adaptUgcRow
};
