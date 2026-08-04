// AIStaff Super Admin — API routes.
//
// Mounted at /api/superadmin/* by src/server.js. Every route in this file
// enforces server-side authorization independently (requireAuth then
// requireSuperAdminApi) — there is no route here that relies on the client
// hiding a nav link or trusting a role value from the browser.
//
// Route naming intentionally diverges from the task brief's suggested
// /api/admin/* paths — see the deliverables report for why: this repo
// already uses /api/admin/* and /admin/* for the (not yet built out)
// CUSTOMER/tenant dashboard (see src/server.js's existing
// `/api/admin/payments/dashboard` + `/admin` -> `/admin/dashboard` redirect).
// Reusing that prefix for a global, cross-tenant platform console would be a
// dangerous naming collision, so this global system lives at
// /api/superadmin/* and /superadmin/* instead, leaving /admin/* completely
// untouched for its existing customer-facing purpose.

const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { requireAuth } = require("../auth");
const {
  PLATFORM_ROLES,
  ALL_ADMIN_ROLES,
  ADMIN_ERROR_CODES,
  requireSuperAdminApi,
  requireMfaIfEnabled,
  isLastActiveSuperadmin,
  countActiveSuperadmins
} = require("../adminAuth");
const { recordAuditEvent, listAuditLogs, AUDIT_ACTIONS } = require("./auditLog");
const { createRateLimiter } = require("./rateLimit");
const { getCreativeBrainStatus, validateAllResources, RESOURCE_VALIDATORS } = require("./creativeBrain");
const systemStatus = require("./systemStatus");
const brandeeRunLog = require("./brandeeRunLog");
const directory = require("./directory");
const totp = require("./totp");
const { encryptSecret, decryptSecret } = require("../crypto");
const { issueAdminMfaCookie, clearAdminMfaCookie } = require("./mfaSession");
const { WebsiteAnalysisError, safeFetchHtml, normalizeUrlInput } = require("../brandee/websiteAnalyzer");

const router = express.Router();

// ---------------------------------------------------------------------
// Rate limiters for costly/sensitive actions (per authenticated user id)
// ---------------------------------------------------------------------
const validateLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 10 });
const testServiceLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 10 });
const retryRunLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });
const mfaLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 8 });
const bulkActionLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });

function rateLimited(limiter, keyFn) {
  return (req, res, next) => {
    const key = keyFn(req);
    const result = limiter.check(key);
    if (!result.allowed) {
      return res.status(429).json({ error: "Too many requests. Please wait before trying again.", code: ADMIN_ERROR_CODES.RATE_LIMITED, retryAfterMs: result.retryAfterMs });
    }
    next();
  };
}
const byUserId = (req) => req.user?.id || req.ip || "unknown";

// Every route below requires a valid session first.
router.use(requireAuth);

function handleAsync(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => {
    console.error("[superadmin api]", req.method, req.originalUrl, error);
    if (error?.name === "ZodError") {
      return res.status(400).json({ error: "Invalid input.", code: ADMIN_ERROR_CODES.INVALID_INPUT, details: error.errors });
    }
    res.status(500).json({ error: "Something went wrong.", code: ADMIN_ERROR_CODES.UNKNOWN_ERROR });
  });
}

// ---------------------------------------------------------------------
// GET /api/superadmin/me — who am I, what can I do (drives the admin shell's
// nav + permission-gated UI; the UI never decides authorization on its own).
// ---------------------------------------------------------------------
router.get("/me", requireSuperAdminApi(ALL_ADMIN_ROLES), (req, res) => {
  res.json({
    user: { id: req.user.id, name: req.user.name, email: req.user.email, mfaEnabled: req.user.mfa_enabled, lastLoginAt: req.user.last_login_at },
    adminRole: req.adminRole,
    mfaWarning: req.user.mfa_enabled ? null : "MFA is not enabled on this account."
  });
});

// ---------------------------------------------------------------------
// SYSTEM STATUS / OVERVIEW
// ---------------------------------------------------------------------
router.get("/system/status", requireSuperAdminApi(ALL_ADMIN_ROLES), handleAsync(async (req, res) => {
  const [tenantCount, userCount, db, storage, queue] = await Promise.all([
    prisma.company.count({ where: { status: "active" } }),
    prisma.user.count(),
    systemStatus.checkDatabase(),
    systemStatus.checkStorage(),
    Promise.resolve(systemStatus.checkQueue())
  ]);
  const runStats = brandeeRunLog.getRunStats();

  res.json({
    totalActiveTenants: tenantCount,
    totalRegisteredUsers: userCount,
    brandee: {
      recentAttempts: runStats.totalAttempts,
      successRate: runStats.successRate,
      failedCount: runStats.failedCount,
      avgDurationMs: runStats.avgDurationMs,
      lastSuccessfulRun: runStats.lastSuccessfulRun,
      lastFailedRun: runStats.lastFailedRun
    },
    services: {
      database: db,
      storage,
      queue,
      config: req.adminRole === PLATFORM_ROLES.SUPERADMIN ? systemStatus.safeServiceConfigSnapshot() : undefined
    },
    creativeBrainVersion: getCreativeBrainStatus().version
  });
}));

router.post("/system/test-service", requireSuperAdminApi(ALL_ADMIN_ROLES), rateLimited(testServiceLimiter, byUserId), handleAsync(async (req, res) => {
  const body = z.object({ service: z.enum(["scraper", "extraction", "planner", "fallback", "database", "storage", "queue"]) }).parse(req.body);
  const start = Date.now();
  let result;
  switch (body.service) {
    case "scraper": result = await systemStatus.checkWebsiteScraper(); break;
    case "extraction": result = await systemStatus.checkExtractionModel(); break;
    case "planner": result = await systemStatus.checkPlannerModel(); break;
    case "fallback": result = await systemStatus.checkFallbackModel(); break;
    case "database": result = await systemStatus.checkDatabase(); break;
    case "storage": result = await systemStatus.checkStorage(); break;
    case "queue": result = systemStatus.checkQueue(); break;
    default: result = { status: "Invalid", message: "Unknown service" };
  }

  await recordAuditEvent({
    req, actorUserId: req.user.id, actorRole: req.adminRole,
    action: AUDIT_ACTIONS.SERVICE_TESTED, targetType: "service", targetId: body.service,
    metadata: { status: result.status, durationMs: result.durationMs ?? (Date.now() - start) }
  });

  res.json({ service: body.service, ...result, stage: body.service, timestamp: new Date().toISOString() });
}));

// ---------------------------------------------------------------------
// BRANDEE CREATIVE BRAIN
// ---------------------------------------------------------------------
router.get("/brandee/resources", requireSuperAdminApi(ALL_ADMIN_ROLES), (req, res) => {
  res.json({
    creativeBrain: getCreativeBrainStatus(),
    resources: validateAllResources()
  });
});

router.post("/brandee/validate", requireSuperAdminApi(ALL_ADMIN_ROLES), rateLimited(validateLimiter, byUserId), handleAsync(async (req, res) => {
  const body = z.object({
    resource: z.enum(["all", "adCreativeSkill", "staticAdFrameworks", "hookFramework", "goalMappings", "awarenessRules", "proofRules", "platformRules", "performanceDiagnostics", "plannerRules", "businessProfileSchema", "creativePlanSchema"]).default("all")
  }).parse(req.body || {});

  const start = Date.now();
  const result = body.resource === "all" ? validateAllResources() : { [body.resource]: RESOURCE_VALIDATORS[body.resource]() };
  const anyFailed = Object.values(result).some((r) => r.validationStatus === "Failed");

  await recordAuditEvent({
    req, actorUserId: req.user.id, actorRole: req.adminRole,
    action: AUDIT_ACTIONS.CREATIVE_BRAIN_VALIDATED, targetType: "creative_brain_resource", targetId: body.resource,
    metadata: { anyFailed, durationMs: Date.now() - start }
  });

  res.json({
    pass: !anyFailed,
    stage: body.resource,
    durationMs: Date.now() - start,
    errorCode: anyFailed ? ADMIN_ERROR_CODES.VALIDATION_FAILED : null,
    timestamp: new Date().toISOString(),
    result
  });
}));

router.get("/brandee/runs", requireSuperAdminApi(ALL_ADMIN_ROLES), (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  res.json({ runs: brandeeRunLog.listRuns({ limit }), stats: brandeeRunLog.getRunStats() });
});

router.post("/brandee/retry-run", requireSuperAdminApi(ALL_ADMIN_ROLES), requireMfaIfEnabled, rateLimited(retryRunLimiter, byUserId), handleAsync(async (req, res) => {
  const body = z.object({ requestId: z.string().min(1) }).parse(req.body);
  const run = brandeeRunLog.listRuns({ limit: 500 }).find((r) => r.requestId === body.requestId);
  if (!run) return res.status(404).json({ error: "Run not found.", code: ADMIN_ERROR_CODES.INVALID_INPUT });
  if (run.status !== "failed") return res.status(400).json({ error: "Only failed runs can be retried.", code: ADMIN_ERROR_CODES.INVALID_INPUT });
  if (!run.submittedDomain) return res.status(400).json({ error: "This run has no re-testable domain on file.", code: ADMIN_ERROR_CODES.INVALID_INPUT });

  // Design note (documented, not a shortcut): the original submitted form
  // text is never persisted in the run log for privacy reasons, so this
  // cannot literally replay the customer's exact original request. What it
  // CAN safely and honestly do is re-test whether the submitted domain is
  // reachable now — the most common cause of a failed run.
  const start = Date.now();
  let outcome;
  try {
    await safeFetchHtml(normalizeUrlInput(run.submittedDomain));
    outcome = { pass: true, message: "The website is reachable now. Ask the customer to resubmit through the normal Brandee flow to generate a fresh plan." };
  } catch (error) {
    outcome = { pass: false, message: error instanceof WebsiteAnalysisError ? `Still unreachable: ${error.code}` : "Still unreachable." };
  }

  await recordAuditEvent({
    req, actorUserId: req.user.id, actorRole: req.adminRole,
    action: AUDIT_ACTIONS.RUN_RETRIED, targetType: "brandee_run", targetId: body.requestId,
    metadata: { pass: outcome.pass, durationMs: Date.now() - start }
  });

  res.json({ requestId: body.requestId, stage: "domain_recheck", durationMs: Date.now() - start, timestamp: new Date().toISOString(), ...outcome });
}));

// ---------------------------------------------------------------------
// TENANT DIRECTORY
// ---------------------------------------------------------------------
router.get("/tenants", requireSuperAdminApi(ALL_ADMIN_ROLES), handleAsync(async (req, res) => {
  res.json({ tenants: await directory.listTenants({ limit: req.query.limit }) });
}));

router.get("/tenants/:id", requireSuperAdminApi(ALL_ADMIN_ROLES), handleAsync(async (req, res) => {
  const tenant = await directory.getTenantById(req.params.id);
  if (!tenant) return res.status(404).json({ error: "Tenant not found.", code: ADMIN_ERROR_CODES.INVALID_INPUT });
  await recordAuditEvent({ req, actorUserId: req.user.id, actorRole: req.adminRole, action: "admin.tenant_viewed", targetType: "tenant", targetId: tenant.id, metadata: {} });
  res.json({ tenant });
}));

// Destructive-ish (status change) — SUPERADMIN only, requires typed
// confirmation (must retype the tenant's exact name) + MFA if enabled.
router.post("/tenants/:id/status", requireSuperAdminApi([PLATFORM_ROLES.SUPERADMIN]), requireMfaIfEnabled, rateLimited(bulkActionLimiter, byUserId), handleAsync(async (req, res) => {
  const body = z.object({ status: z.enum(["active", "suspended", "disabled"]), confirmTenantName: z.string().min(1) }).parse(req.body);
  const tenant = await directory.getTenantById(req.params.id);
  if (!tenant) return res.status(404).json({ error: "Tenant not found.", code: ADMIN_ERROR_CODES.INVALID_INPUT });
  if (body.confirmTenantName !== tenant.name) {
    return res.status(400).json({ error: "Typed confirmation did not match the tenant name.", code: ADMIN_ERROR_CODES.INVALID_INPUT });
  }
  const updated = await directory.setTenantStatus(req.params.id, body.status);
  await recordAuditEvent({
    req, actorUserId: req.user.id, actorRole: req.adminRole,
    action: AUDIT_ACTIONS.TENANT_STATUS_CHANGED, targetType: "tenant", targetId: req.params.id,
    metadata: { fromKnownName: tenant.name, newStatus: body.status, mfaWarning: req.mfaWarning || null }
  });
  res.json({ ok: true, tenant: updated });
}));

// ---------------------------------------------------------------------
// USER DIRECTORY
// ---------------------------------------------------------------------
router.get("/users", requireSuperAdminApi(ALL_ADMIN_ROLES), handleAsync(async (req, res) => {
  res.json({ users: await directory.listUsers({ limit: req.query.limit }) });
}));

router.get("/users/:id", requireSuperAdminApi(ALL_ADMIN_ROLES), handleAsync(async (req, res) => {
  const user = await directory.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found.", code: ADMIN_ERROR_CODES.INVALID_INPUT });
  res.json({ user });
}));

router.post("/users/:id/status", requireSuperAdminApi([PLATFORM_ROLES.SUPERADMIN]), requireMfaIfEnabled, rateLimited(bulkActionLimiter, byUserId), handleAsync(async (req, res) => {
  const body = z.object({ status: z.enum(["active", "disabled"]) }).parse(req.body);
  const user = await directory.setUserStatus(req.params.id, body.status);
  await recordAuditEvent({
    req, actorUserId: req.user.id, actorRole: req.adminRole,
    action: AUDIT_ACTIONS.USER_STATUS_CHANGED, targetType: "user", targetId: req.params.id,
    metadata: { newStatus: body.status }
  });
  res.json({ ok: true, user });
}));

// Platform-role assignment — the single most sensitive endpoint in this
// system. SUPERADMIN only. Cannot be used to change your own role. Cannot
// remove the last active superadmin. Always audit logged. Always requires
// a fresh MFA challenge if the actor has MFA enabled.
const PlatformRoleBody = z.object({ platformRole: z.enum(["SUPERADMIN", "SUPPORT_ADMIN"]).nullable() });

router.post("/users/:id/platform-role", requireSuperAdminApi([PLATFORM_ROLES.SUPERADMIN]), requireMfaIfEnabled, rateLimited(bulkActionLimiter, byUserId), handleAsync(async (req, res) => {
  const body = PlatformRoleBody.parse(req.body);

  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You cannot change your own platform role. Ask another superadmin to make this change.", code: ADMIN_ERROR_CODES.INVALID_INPUT });
  }

  const target = await directory.getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found.", code: ADMIN_ERROR_CODES.INVALID_INPUT });

  if (body.platformRole !== "SUPERADMIN" && target.platform_role === "SUPERADMIN") {
    const activeCount = await countActiveSuperadmins(prisma);
    if (isLastActiveSuperadmin({ activeSuperadminCount: activeCount, targetIsSuperadmin: true })) {
      return res.status(400).json({
        error: "Refusing to remove the last active superadmin. Assign SUPERADMIN to another account first.",
        code: ADMIN_ERROR_CODES.INVALID_INPUT
      });
    }
  }

  const updated = await directory.setPlatformRole(req.params.id, body.platformRole);
  await recordAuditEvent({
    req, actorUserId: req.user.id, actorRole: req.adminRole,
    action: body.platformRole ? AUDIT_ACTIONS.ROLE_ASSIGNED : AUDIT_ACTIONS.ROLE_REMOVED,
    targetType: "user", targetId: req.params.id,
    metadata: { newPlatformRole: body.platformRole, previousPlatformRole: target.platform_role }
  });
  res.json({ ok: true, user: updated });
}));

// ---------------------------------------------------------------------
// AUDIT LOGS — SUPERADMIN only (not part of SUPPORT_ADMIN's permission set)
// ---------------------------------------------------------------------
router.get("/audit-logs", requireSuperAdminApi([PLATFORM_ROLES.SUPERADMIN]), handleAsync(async (req, res) => {
  const logs = await listAuditLogs({ limit: req.query.limit, action: req.query.action || null, targetType: req.query.targetType || null });
  res.json({ logs });
}));

// ---------------------------------------------------------------------
// MFA enrollment / challenge (self-service, any admin role)
// ---------------------------------------------------------------------
router.post("/mfa/enroll", requireSuperAdminApi(ALL_ADMIN_ROLES), rateLimited(mfaLimiter, byUserId), handleAsync(async (req, res) => {
  const secret = totp.generateSecret();
  await prisma.user.update({ where: { id: req.user.id }, data: { mfa_secret_encrypted: encryptSecret(secret) } });
  res.json({ otpauthUrl: totp.otpauthUrl({ secret, email: req.user.email }), secret });
}));

router.post("/mfa/confirm", requireSuperAdminApi(ALL_ADMIN_ROLES), rateLimited(mfaLimiter, byUserId), handleAsync(async (req, res) => {
  const body = z.object({ token: z.string().min(6).max(6) }).parse(req.body);
  const fresh = await prisma.user.findUnique({ where: { id: req.user.id }, select: { mfa_secret_encrypted: true } });
  if (!fresh?.mfa_secret_encrypted) return res.status(400).json({ error: "Start enrollment first.", code: ADMIN_ERROR_CODES.INVALID_INPUT });

  const secret = decryptSecret(fresh.mfa_secret_encrypted);
  if (!totp.verifyTotp(secret, body.token)) {
    return res.status(400).json({ error: "Incorrect code.", code: ADMIN_ERROR_CODES.INVALID_INPUT });
  }
  const backupCodes = totp.generateBackupCodes();
  const crypto = require("crypto");
  const hashed = backupCodes.map((c) => crypto.createHash("sha256").update(c).digest("hex"));
  await prisma.user.update({ where: { id: req.user.id }, data: { mfa_enabled: true, mfa_backup_codes_hash: hashed } });
  issueAdminMfaCookie(res, req.user.id);
  await recordAuditEvent({ req, actorUserId: req.user.id, actorRole: req.adminRole, action: "admin.mfa_enabled", targetType: "user", targetId: req.user.id, metadata: {} });
  res.json({ ok: true, backupCodes });
}));

router.post("/mfa/challenge", requireSuperAdminApi(ALL_ADMIN_ROLES), rateLimited(mfaLimiter, byUserId), handleAsync(async (req, res) => {
  const body = z.object({ token: z.string().min(6).max(6) }).parse(req.body);
  const fresh = await prisma.user.findUnique({ where: { id: req.user.id }, select: { mfa_secret_encrypted: true, mfa_enabled: true } });
  if (!fresh?.mfa_enabled || !fresh.mfa_secret_encrypted) {
    return res.status(400).json({ error: "MFA is not enabled on this account.", code: ADMIN_ERROR_CODES.INVALID_INPUT });
  }
  const secret = decryptSecret(fresh.mfa_secret_encrypted);
  if (!totp.verifyTotp(secret, body.token)) {
    return res.status(401).json({ error: "Incorrect code.", code: ADMIN_ERROR_CODES.UNAUTHORIZED });
  }
  issueAdminMfaCookie(res, req.user.id);
  res.json({ ok: true });
}));

router.post("/mfa/logout", requireSuperAdminApi(ALL_ADMIN_ROLES), (req, res) => {
  clearAdminMfaCookie(res);
  res.json({ ok: true });
});

module.exports = router;
