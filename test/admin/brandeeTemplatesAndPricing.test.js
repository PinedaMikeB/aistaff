// Super Admin Brandee template + pricing management tests (PART 17-20, 25).
//
// DB-backed (StaticAdTemplate/UgcTemplate/BrandeePricingConfig) — self-skips
// in this sandbox (no reachable database; see _prismaSandboxGuard.js's
// header) and is meant to run for real once `npx prisma migrate deploy` has
// been applied against a live database.

require("./_prismaSandboxGuard");
const test = require("node:test");
const assert = require("node:assert/strict");

const { prisma } = require("../../src/db");
const brandeeTemplates = require("../../src/admin/brandeeTemplates");
const brandeePricingAdmin = require("../../src/admin/brandeePricingAdmin");

async function dbReachable() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function uniqueSlug(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

test("createTemplate creates a DRAFT static template; new templates never start ACTIVE", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment.");
  const slug = uniqueSlug("test_static");
  const template = await brandeeTemplates.createTemplate("static", { slug, name: "Test Template", description: "A test.", category: "Test" }, "test-actor");
  try {
    assert.equal(template.status, "DRAFT");
    assert.equal(template.version, 1);
    assert.equal(template.parentTemplateId, null);
  } finally {
    await prisma.staticAdTemplate.deleteMany({ where: { slug: { startsWith: slug } } });
  }
});

test("setStatus(ACTIVE) publishes a template and stamps publishedAt", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment.");
  const slug = uniqueSlug("test_static_activate");
  const template = await brandeeTemplates.createTemplate("static", { slug, name: "Test Template", description: "A test.", category: "Test" }, "test-actor");
  try {
    const activated = await brandeeTemplates.setStatus("static", template.id, "ACTIVE", "test-actor");
    assert.equal(activated.status, "ACTIVE");
    assert.ok(activated.publishedAt);
  } finally {
    await prisma.staticAdTemplate.deleteMany({ where: { slug: { startsWith: slug } } });
  }
});

test("updateTemplate on a published template creates a NEW version rather than mutating history (PART 25)", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment.");
  const slug = uniqueSlug("test_static_version");
  const v1 = await brandeeTemplates.createTemplate("static", { slug, name: "V1", description: "First version.", category: "Test" }, "test-actor");
  await brandeeTemplates.setStatus("static", v1.id, "ACTIVE", "test-actor");
  try {
    const v2 = await brandeeTemplates.updateTemplate("static", v1.id, { slug, name: "V2", description: "Second version.", category: "Test" }, "test-actor");
    assert.notEqual(v2.id, v1.id, "editing a published template must create a new row, not mutate the old one");
    assert.equal(v2.version, 2);
    assert.equal(v2.parentTemplateId, v1.id);
    assert.equal(v2.status, "DRAFT", "a new version starts as DRAFT until explicitly activated");

    // The original v1 row must be completely untouched.
    const stillV1 = await prisma.staticAdTemplate.findUnique({ where: { id: v1.id } });
    assert.equal(stillV1.name, "V1");
    assert.equal(stillV1.status, "ACTIVE");
  } finally {
    await prisma.staticAdTemplate.deleteMany({ where: { slug: { startsWith: slug } } });
  }
});

test("updateTemplate on a still-DRAFT template edits in place (no customer project could reference it yet)", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment.");
  const slug = uniqueSlug("test_static_draft_edit");
  const draft = await brandeeTemplates.createTemplate("static", { slug, name: "Draft V1", description: "First.", category: "Test" }, "test-actor");
  try {
    const edited = await brandeeTemplates.updateTemplate("static", draft.id, { slug, name: "Draft V1 Edited", description: "First, edited.", category: "Test" }, "test-actor");
    assert.equal(edited.id, draft.id, "editing a still-DRAFT template should update the same row");
    assert.equal(edited.version, 1);
  } finally {
    await prisma.staticAdTemplate.deleteMany({ where: { slug: { startsWith: slug } } });
  }
});

test("duplicateTemplate creates a new DRAFT copy with an adjusted slug", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment.");
  const slug = uniqueSlug("test_static_dup");
  const original = await brandeeTemplates.createTemplate("static", { slug, name: "Original", description: "Original.", category: "Test" }, "test-actor");
  try {
    const copy = await brandeeTemplates.duplicateTemplate("static", original.id, "test-actor");
    assert.notEqual(copy.id, original.id);
    assert.equal(copy.status, "DRAFT");
    assert.equal(copy.slug, `${slug}_copy`);
  } finally {
    await prisma.staticAdTemplate.deleteMany({ where: { slug: { startsWith: slug } } });
  }
});

test("listTemplates filters by status (only ACTIVE templates should be offered publicly)", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment.");
  const slug = uniqueSlug("test_static_filter");
  const draft = await brandeeTemplates.createTemplate("static", { slug, name: "Filter Test", description: "Test.", category: "Test" }, "test-actor");
  try {
    const activeOnly = await brandeeTemplates.listTemplates("static", { status: "ACTIVE" });
    assert.ok(!activeOnly.some((t2) => t2.id === draft.id), "a DRAFT template must not appear in an ACTIVE-only listing");
    const draftOnly = await brandeeTemplates.listTemplates("static", { status: "DRAFT" });
    assert.ok(draftOnly.some((t2) => t2.id === draft.id));
  } finally {
    await prisma.staticAdTemplate.deleteMany({ where: { slug: { startsWith: slug } } });
  }
});

test("UGC templates follow the same create/activate/version lifecycle as static templates", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment.");
  const slug = uniqueSlug("test_ugc");
  const template = await brandeeTemplates.createTemplate("ugc", { slug, name: "Test UGC Style", description: "A test.", category: "Test" }, "test-actor");
  try {
    assert.equal(template.status, "DRAFT");
    const activated = await brandeeTemplates.setStatus("ugc", template.id, "ACTIVE", "test-actor");
    assert.equal(activated.status, "ACTIVE");
  } finally {
    await prisma.ugcTemplate.deleteMany({ where: { slug: { startsWith: slug } } });
  }
});

test("pricing draft/publish workflow: publishing archives the previously published row", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment.");
  const samplePlans = [
    { slug: "image_starter", name: "Image Starter", monthlyPrice: 599, currency: "PHP", entitlements: { IMAGE_FINAL: 10, VIDEO_SECONDS: 0 }, limits: { brandKits: 1, savedProducts: 5, aspectRatios: ["4:5"], priorityRendering: false }, features: [], featured: false, visible: true, sortOrder: 1 },
    { slug: "video_starter", name: "Video Starter", monthlyPrice: 1199, currency: "PHP", entitlements: { IMAGE_FINAL: 0, VIDEO_SECONDS: 60 }, limits: { brandKits: 1, savedProducts: 5, aspectRatios: ["9:16"], priorityRendering: false }, features: [], featured: false, visible: true, sortOrder: 2 },
    { slug: "brandee_combo", name: "Brandee Combo", monthlyPrice: 2999, currency: "PHP", entitlements: { IMAGE_FINAL: 20, VIDEO_SECONDS: 120 }, limits: { brandKits: 3, savedProducts: 20, aspectRatios: ["4:5", "9:16"], priorityRendering: true }, features: [], featured: true, visible: true, sortOrder: 3 }
  ];

  const draft1 = await brandeePricingAdmin.saveDraft({ taxMode: "NON_VAT", pricesAreTaxInclusive: true, vatRatePercent: 12, plans: samplePlans }, "test-actor");
  const published1 = await brandeePricingAdmin.publishDraft(draft1.id, "test-actor");
  assert.equal(published1.status, "published");

  const draft2 = await brandeePricingAdmin.saveDraft({ taxMode: "NON_VAT", pricesAreTaxInclusive: true, vatRatePercent: 12, plans: samplePlans }, "test-actor");
  const published2 = await brandeePricingAdmin.publishDraft(draft2.id, "test-actor");

  const reloadedFirst = await prisma.brandeePricingConfig.findUnique({ where: { id: published1.id } });
  assert.equal(reloadedFirst.status, "archived", "publishing a new config must archive the previous published one");
  assert.equal(published2.status, "published");

  const current = await brandeePricingAdmin.getPublished();
  assert.equal(current.id, published2.id);

  await prisma.brandeePricingConfig.deleteMany({ where: { id: { in: [draft1.id, draft2.id] } } });
});

test("publishDraft refuses to publish a row that is not currently a draft", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment.");
  const minimalPlan = [{ slug: "image_starter", name: "Image Starter", monthlyPrice: 599, currency: "PHP", entitlements: { IMAGE_FINAL: 10, VIDEO_SECONDS: 0 }, limits: { brandKits: 1, savedProducts: 5, aspectRatios: ["4:5"], priorityRendering: false }, features: [], featured: false, visible: true, sortOrder: 1 }];
  const draft = await brandeePricingAdmin.saveDraft({ taxMode: "NON_VAT", pricesAreTaxInclusive: true, vatRatePercent: 12, plans: minimalPlan }, "test-actor");
  const published = await brandeePricingAdmin.publishDraft(draft.id, "test-actor");
  try {
    await assert.rejects(() => brandeePricingAdmin.publishDraft(published.id, "test-actor"));
  } finally {
    await prisma.brandeePricingConfig.deleteMany({ where: { id: draft.id } });
  }
});
