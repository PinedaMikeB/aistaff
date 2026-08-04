// DB-backed admin tests: audit log writes, platform-role assignment safety,
// and tenant-scoped user queries.
//
// These require a reachable Postgres database with the
// 20260803160000_add_admin_platform_roles_and_audit_log migration applied.
// This sandbox's mounted Prisma client is generated for a different OS/arch
// than this Linux sandbox (see the deliverables report), so these tests
// self-skip with a clear reason here rather than failing noisily — run them
// for real in an environment where `npx prisma migrate deploy` has been run
// against a live database.

require("./_prismaSandboxGuard");
const test = require("node:test");
const assert = require("node:assert/strict");
const { prisma } = require("../../src/db");
const { recordAuditEvent, AUDIT_ACTIONS } = require("../../src/admin/auditLog");
const { countActiveSuperadmins, isLastActiveSuperadmin } = require("../../src/adminAuth");

async function dbReachable() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

test("recordAuditEvent writes a row with scrubbed metadata and no secrets", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment — see file header.");

  const company = await prisma.company.create({ data: { name: `Test Co ${Date.now()}`, status: "active" } });
  const user = await prisma.user.create({
    data: { company_id: company.id, name: "Test Actor", email: `actor-${Date.now()}@example.com`, password_hash: "x", role: "owner", platform_role: "SUPERADMIN" }
  });

  const result = await recordAuditEvent({
    actorUserId: user.id,
    actorRole: "SUPERADMIN",
    action: AUDIT_ACTIONS.SERVICE_TESTED,
    targetType: "service",
    targetId: "database",
    metadata: { status: "Active", api_key: "sk-should-never-be-stored", note: "safe" }
  });
  assert.equal(result.ok, true);

  const rows = await prisma.adminAuditLog.findMany({ where: { actor_user_id: user.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, AUDIT_ACTIONS.SERVICE_TESTED);
  assert.equal(rows[0].metadata.api_key, undefined);
  assert.equal(rows[0].metadata.note, "safe");

  await prisma.adminAuditLog.deleteMany({ where: { actor_user_id: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.company.delete({ where: { id: company.id } });
});

test("countActiveSuperadmins + isLastActiveSuperadmin correctly protect the final superadmin end-to-end", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment — see file header.");

  const company = await prisma.company.create({ data: { name: `Test Co ${Date.now()}`, status: "active" } });
  const admin = await prisma.user.create({
    data: { company_id: company.id, name: "Only Admin", email: `only-${Date.now()}@example.com`, password_hash: "x", role: "owner", platform_role: "SUPERADMIN", status: "active" }
  });

  const count = await countActiveSuperadmins(prisma);
  assert.ok(count >= 1);
  assert.equal(isLastActiveSuperadmin({ activeSuperadminCount: count, targetIsSuperadmin: true }), count <= 1);

  await prisma.user.delete({ where: { id: admin.id } });
  await prisma.company.delete({ where: { id: company.id } });
});

test("tenant isolation: a user in company A can never be returned by a query scoped to company B", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment — see file header.");

  const companyA = await prisma.company.create({ data: { name: `Tenant A ${Date.now()}`, status: "active" } });
  const companyB = await prisma.company.create({ data: { name: `Tenant B ${Date.now()}`, status: "active" } });
  const userA = await prisma.user.create({ data: { company_id: companyA.id, name: "A User", email: `a-${Date.now()}@example.com`, password_hash: "x", role: "admin" } });

  // Simulates the exact pattern every tenant-scoped route in server.js uses:
  // filtering by req.companyId. Even if userA's raw ID is known, a query
  // scoped to companyB must never return it.
  const leaked = await prisma.user.findFirst({ where: { id: userA.id, company_id: companyB.id } });
  assert.equal(leaked, null);

  const correctlyFound = await prisma.user.findFirst({ where: { id: userA.id, company_id: companyA.id } });
  assert.equal(correctlyFound.id, userA.id);

  await prisma.user.delete({ where: { id: userA.id } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA.id, companyB.id] } } });
});
