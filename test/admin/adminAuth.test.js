const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PLATFORM_ROLES,
  ALL_ADMIN_ROLES,
  ADMIN_ERROR_CODES,
  requireSuperAdminApi,
  requireSuperAdminPage,
  isLastActiveSuperadmin,
  scrubMetadata
} = require("../../src/adminAuth");

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    redirectedTo: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(code, url) { this.statusCode = code; this.redirectedTo = url; return this; },
    type() { return this; },
    send(body) { this.body = body; return this; }
  };
  return res;
}

test("requireSuperAdminApi returns 401 ADMIN_UNAUTHORIZED when there is no authenticated user at all", () => {
  const req = { user: null };
  const res = fakeRes();
  let nextCalled = false;
  requireSuperAdminApi(ALL_ADMIN_ROLES)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, ADMIN_ERROR_CODES.UNAUTHORIZED);
});

test("requireSuperAdminApi returns 403 ADMIN_FORBIDDEN for an authenticated tenant user with no platform_role (TENANT_ADMIN/TENANT_MEMBER)", () => {
  const req = { user: { id: "u1", platform_role: null } };
  const res = fakeRes();
  let nextCalled = false;
  requireSuperAdminApi(ALL_ADMIN_ROLES)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, ADMIN_ERROR_CODES.FORBIDDEN);
});

test("requireSuperAdminApi never trusts a client-supplied role string that isn't on req.user (simulated spoof attempt)", () => {
  // Simulates someone tampering with the request body/headers to claim an
  // admin role — the middleware must only ever look at req.user (populated
  // server-side from a fresh DB read), never req.body or req.headers.
  const req = { user: { id: "u1", platform_role: null }, body: { platform_role: "SUPERADMIN" }, headers: { "x-role": "SUPERADMIN" } };
  const res = fakeRes();
  let nextCalled = false;
  requireSuperAdminApi(ALL_ADMIN_ROLES)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("requireSuperAdminApi allows SUPPORT_ADMIN through a route that permits it", () => {
  const req = { user: { id: "u2", platform_role: PLATFORM_ROLES.SUPPORT_ADMIN } };
  const res = fakeRes();
  let nextCalled = false;
  requireSuperAdminApi(ALL_ADMIN_ROLES)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.adminRole, PLATFORM_ROLES.SUPPORT_ADMIN);
});

test("requireSuperAdminApi rejects SUPPORT_ADMIN from a SUPERADMIN-only route (e.g. role assignment, audit logs)", () => {
  const req = { user: { id: "u2", platform_role: PLATFORM_ROLES.SUPPORT_ADMIN } };
  const res = fakeRes();
  let nextCalled = false;
  requireSuperAdminApi([PLATFORM_ROLES.SUPERADMIN])(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("requireSuperAdminApi allows SUPERADMIN through any admin route", () => {
  const req = { user: { id: "u3", platform_role: PLATFORM_ROLES.SUPERADMIN } };
  const res = fakeRes();
  let nextCalled = false;
  requireSuperAdminApi([PLATFORM_ROLES.SUPERADMIN])(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test("requireSuperAdminPage redirects unauthenticated visitors to the admin login page (never serves the shell)", () => {
  const req = { user: null, originalUrl: "/superadmin/tenants" };
  const res = fakeRes();
  let nextCalled = false;
  requireSuperAdminPage(ALL_ADMIN_ROLES)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 302);
  assert.match(res.redirectedTo, /^\/superadmin\/login\?redirect=/);
});

test("requireSuperAdminPage serves a 403 page (not the shell) to an authenticated non-admin", () => {
  const req = { user: { id: "u1", platform_role: null }, originalUrl: "/superadmin" };
  const res = fakeRes();
  let nextCalled = false;
  requireSuperAdminPage(ALL_ADMIN_ROLES)(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /403/);
});

test("isLastActiveSuperadmin protects the final active superadmin from demotion/removal", () => {
  assert.equal(isLastActiveSuperadmin({ activeSuperadminCount: 1, targetIsSuperadmin: true }), true);
  assert.equal(isLastActiveSuperadmin({ activeSuperadminCount: 2, targetIsSuperadmin: true }), false);
  assert.equal(isLastActiveSuperadmin({ activeSuperadminCount: 1, targetIsSuperadmin: false }), false);
  assert.equal(isLastActiveSuperadmin({ activeSuperadminCount: 0, targetIsSuperadmin: true }), true);
});

test("scrubMetadata strips anything that looks like a secret before it would be audit-logged", () => {
  const clean = scrubMetadata({
    apiKey: "sk-should-not-appear",
    password: "hunter2",
    normalField: "safe value",
    nested: { bearer_token: "should-be-removed", ok: "keep-me" }
  });
  assert.equal(clean.apiKey, undefined);
  assert.equal(clean.password, undefined);
  assert.equal(clean.normalField, "safe value");
  assert.equal(clean.nested.bearer_token, undefined);
  assert.equal(clean.nested.ok, "keep-me");
});

test("scrubMetadata handles null/undefined/non-object input safely", () => {
  assert.deepEqual(scrubMetadata(null), {});
  assert.deepEqual(scrubMetadata(undefined), {});
  assert.deepEqual(scrubMetadata("not an object"), {});
});
