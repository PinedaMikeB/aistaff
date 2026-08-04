// Product-ad project persistence tests (PART 16/17/19/20).
//
// This store is a plain JSON-file-backed module (no Prisma/database
// dependency), so these tests exercise the real read/write functions
// directly. To avoid ever touching or losing any real data that might
// already be sitting in data/brandee-product-ad-projects.json or
// data/brandee-product-ad-anon-limits.json on a real deployment, every test
// here only ever touches keys it creates itself (fresh crypto.randomUUID()
// project ids, and uniquely-prefixed anonymous session ids), and an `after`
// hook deletes exactly those keys again afterward — never a wholesale
// reset/overwrite of the file.

const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

const {
  createProject,
  getProject,
  updateProject,
  claimProjectForUser,
  addRevision,
  listRevisions,
  restoreRevision,
  canGenerateAnonymousRevision,
  recordAnonymousRevision,
  storePath,
  anonLimitsPath
} = require("../../src/brandee/productAdProjectStore");

const createdProjectIds = [];
const usedAnonSessionIds = [];

function trackProject(project) {
  createdProjectIds.push(project.id);
  return project;
}

after(() => {
  // Clean up ONLY the specific keys this file created — never rewrite the
  // rest of either JSON file.
  if (fs.existsSync(storePath)) {
    const all = JSON.parse(fs.readFileSync(storePath, "utf8"));
    for (const id of createdProjectIds) delete all[id];
    fs.writeFileSync(storePath, JSON.stringify(all, null, 2));
  }
  if (fs.existsSync(anonLimitsPath)) {
    const all = JSON.parse(fs.readFileSync(anonLimitsPath, "utf8"));
    for (const id of usedAnonSessionIds) delete all[id];
    fs.writeFileSync(anonLimitsPath, JSON.stringify(all, null, 2));
  }
});

test("createProject starts a project in draft status with an empty revision history", () => {
  const project = trackProject(createProject({ kind: "image", anonymousSessionId: "anon-test-1", product: { productName: "Test Widget" } }));
  assert.equal(project.status, "draft");
  assert.equal(project.userId, null);
  assert.deepEqual(project.revisions, []);
  assert.equal(project.preview, null);
});

test("getProject returns null for an unknown id (never throws)", () => {
  assert.equal(getProject("does-not-exist-xyz"), null);
});

test("updateProject merges a patch and bumps updatedAt without dropping other fields", () => {
  const project = trackProject(createProject({ kind: "image", product: { productName: "Widget" } }));
  const originalUpdatedAt = project.updatedAt;
  const updated = updateProject(project.id, { templateId: "offer_promo" });
  assert.equal(updated.templateId, "offer_promo");
  assert.equal(updated.product.productName, "Widget"); // untouched field survives
  assert.ok(new Date(updated.updatedAt).getTime() >= new Date(originalUpdatedAt).getTime());
});

test("addRevision appends to history AND mirrors the latest entry onto project.preview/creativePlan (PART 19)", () => {
  const project = trackProject(createProject({ kind: "image", product: { productName: "Widget" } }));

  const afterFirst = addRevision(project.id, { plan: { headline: "Hello" }, svg: "<svg>1</svg>", width: 1080, height: 1350, watermarked: true, aiUsed: false });
  assert.equal(afterFirst.revisions.length, 1);
  assert.equal(afterFirst.revisions[0].revisionNumber, 1);
  assert.equal(afterFirst.preview.svg, "<svg>1</svg>");
  assert.equal(afterFirst.creativePlan.headline, "Hello");

  const afterSecond = addRevision(project.id, { instruction: "remove the price", plan: { headline: "Hello", price: null }, svg: "<svg>2</svg>", width: 1080, height: 1350, watermarked: true, aiUsed: false });
  assert.equal(afterSecond.revisions.length, 2, "first revision must still be present — history is append-only");
  assert.equal(afterSecond.revisions[0].svg, "<svg>1</svg>", "revision 1 must be unchanged");
  assert.equal(afterSecond.revisions[1].revisionNumber, 2);
  assert.equal(afterSecond.preview.svg, "<svg>2</svg>", "convenience mirror follows the latest revision");
});

test("listRevisions returns the full ordered history for a project", () => {
  const project = trackProject(createProject({ kind: "image", product: { productName: "Widget" } }));
  addRevision(project.id, { plan: {}, svg: "<svg>a</svg>", width: 1080, height: 1350, watermarked: true });
  addRevision(project.id, { plan: {}, svg: "<svg>b</svg>", width: 1080, height: 1350, watermarked: true });
  const revisions = listRevisions(project.id);
  assert.equal(revisions.length, 2);
  assert.deepEqual(revisions.map((r) => r.revisionNumber), [1, 2]);
});

test("listRevisions returns an empty array (not null/throw) for an unknown project", () => {
  assert.deepEqual(listRevisions("does-not-exist-xyz"), []);
});

test("restoreRevision never deletes a newer revision — it APPENDS a copy of the restored one (PART 19)", () => {
  const project = trackProject(createProject({ kind: "image", product: { productName: "Widget" } }));
  addRevision(project.id, { plan: { headline: "v1" }, svg: "<svg>v1</svg>", width: 1080, height: 1350, watermarked: true });
  addRevision(project.id, { plan: { headline: "v2" }, svg: "<svg>v2</svg>", width: 1080, height: 1350, watermarked: true });

  const restored = restoreRevision(project.id, 1);
  assert.equal(restored.revisions.length, 3, "restoring must append, not truncate");
  assert.equal(restored.revisions[0].svg, "<svg>v1</svg>", "original revision 1 still present");
  assert.equal(restored.revisions[1].svg, "<svg>v2</svg>", "original revision 2 still present");
  assert.equal(restored.revisions[2].svg, "<svg>v1</svg>", "revision 3 is a copy of revision 1's content");
  assert.equal(restored.preview.svg, "<svg>v1</svg>", "the mirror now reflects the restored content");
});

test("restoreRevision returns null for a revision number that does not exist", () => {
  const project = trackProject(createProject({ kind: "image", product: { productName: "Widget" } }));
  addRevision(project.id, { plan: {}, svg: "<svg>only</svg>", width: 1080, height: 1350, watermarked: true });
  assert.equal(restoreRevision(project.id, 99), null);
});

test("claimProjectForUser attaches a userId, clears the anonymous session id, and preserves the preview (PART 20)", () => {
  const project = trackProject(createProject({ kind: "image", anonymousSessionId: "anon-test-2", product: { productName: "Widget" } }));
  addRevision(project.id, { plan: { headline: "Kept" }, svg: "<svg>kept</svg>", width: 1080, height: 1350, watermarked: true });

  const claimed = claimProjectForUser(project.id, "user-123");
  assert.equal(claimed.userId, "user-123");
  assert.equal(claimed.anonymousSessionId, null);
  assert.equal(claimed.status, "registered");
  assert.equal(claimed.preview.svg, "<svg>kept</svg>", "the generated preview must survive registration");
  assert.equal(claimed.revisions.length, 1, "revision history must survive registration");
});

test("canGenerateAnonymousRevision allows exactly one free revision by default, then blocks", () => {
  const sessionId = `test-anon-revision-${Date.now()}`;
  usedAnonSessionIds.push(sessionId);

  assert.equal(canGenerateAnonymousRevision(sessionId, "image"), true);
  recordAnonymousRevision(sessionId, "image");
  assert.equal(canGenerateAnonymousRevision(sessionId, "image"), false);
});

test("canGenerateAnonymousRevision returns false for a missing session id (never allows unlimited anonymous use)", () => {
  assert.equal(canGenerateAnonymousRevision(null, "image"), false);
  assert.equal(canGenerateAnonymousRevision(undefined, "image"), false);
});

test("image and video revision counters are tracked independently for the same anonymous session", () => {
  const sessionId = `test-anon-revision-kinds-${Date.now()}`;
  usedAnonSessionIds.push(sessionId);

  recordAnonymousRevision(sessionId, "image");
  assert.equal(canGenerateAnonymousRevision(sessionId, "image"), false);
  assert.equal(canGenerateAnonymousRevision(sessionId, "video"), true, "video's counter must not be consumed by an image revision");
});
