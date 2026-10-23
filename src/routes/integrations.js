const express = require("express");
const { z } = require("zod");
const {
  createConnection,
  discoverConnection,
  retryConnectionDiscovery,
  listConnections,
  updateConnectionAuth,
  startOAuth,
  completeOAuth,
  updateAction,
  testConnection,
  markManualVerification,
  updateConnectionAdvanced,
  importConnectionSpec,
  refreshConnectionSpec,
  createManualAction,
  setConnectionStatus,
  listAssignableEngineOperations,
  assignAction,
  testIntegrationAction,
  listExecutions,
  getExecutionDetail,
  approveExecution
} = require("../integrations");

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
  if (error?.name === "ZodError") return res.status(400).json({ error: error.issues?.[0]?.message || "Check the submitted fields.", code: "VALIDATION_ERROR" });
  if (error?.statusCode >= 400 && error.statusCode < 600) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code || "INTEGRATION_ERROR" });
  }
  return next(error);
});

function requireTenantAdmin(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();
  const isTenantAdmin = ["admin", "account_admin", "owner"].includes(role);
  const isAuditedPlatformAssist = Boolean(req.user?.platform_role && req.assistSessionId);
  if (!isTenantAdmin && !isAuditedPlatformAssist) return res.status(403).json({ error: "Only a tenant administrator can configure application connections." });
  next();
}

const discoveryWindows = new Map();
function limitDiscovery(req, res, next) {
  const key = `${req.companyId}:${req.ip}`;
  const now = Date.now();
  const recent = (discoveryWindows.get(key) || []).filter((time) => now - time < 10 * 60 * 1000);
  if (recent.length >= 10) return res.status(429).json({ error: "Too many discovery attempts. Wait a few minutes and try again." });
  recent.push(now);
  discoveryWindows.set(key, recent);
  next();
}

const authBody = z.object({
  authType: z.enum(["none", "bearer", "api_key_header", "api_key_query", "basic", "oauth2_pkce"]),
  parameterName: z.string().trim().max(120).optional().default(""),
  username: z.string().trim().max(320).optional().default(""),
  authSecret: z.string().max(8000).optional().default("")
});

function buildRouter({ requireAuth }) {
  const router = express.Router();
  router.use(requireAuth, requireTenantAdmin);

  router.get("/", asyncRoute(async (req, res) => {
    const [connections, executions, engineOperations] = await Promise.all([
      listConnections(req.companyId),
      listExecutions(req.companyId),
      listAssignableEngineOperations(req.companyId)
    ]);
    res.json({ connections, executions, engineOperations });
  }));

  router.get("/oauth/callback", asyncRoute(async (req, res) => {
    const connection = await completeOAuth({ companyId: req.companyId, state: req.query.state, code: req.query.code });
    res.redirect(`/admin/settings/connections-actions?manage=${encodeURIComponent(connection.id)}&oauth=complete`);
  }));

  router.post("/discover", limitDiscovery, asyncRoute(async (req, res) => {
    const body = z.object({
      sourceUrl: z.string().trim().url("Enter a complete HTTPS website or API documentation URL.").max(2000)
    }).parse(req.body || {});
    const connection = await discoverConnection({ companyId: req.companyId, actor: req.user, ...body });
    res.status(201).json({ ok: true, connectionId: connection.id, discoveryStatus: connection.discovery_status, message: connection.discovery_message, actionsDiscovered: connection.actions.length });
  }));

  router.post("/:connectionId/discover", limitDiscovery, asyncRoute(async (req, res) => {
    const body = z.object({
      sourceUrl: z.string().trim().url("Enter a complete HTTPS website or API documentation URL.").max(2000)
    }).parse(req.body || {});
    const connection = await retryConnectionDiscovery({
      companyId: req.companyId,
      connectionId: req.params.connectionId,
      actor: req.user,
      sourceUrl: body.sourceUrl
    });
    res.json({ ok: true, discoveryStatus: connection.discovery_status, message: connection.discovery_message, actionsDiscovered: connection.actions.length });
  }));

  // Backward-compatible Advanced Settings importer.
  router.post("/", limitDiscovery, asyncRoute(async (req, res) => {
    const body = z.object({
      name: z.string().trim().min(1).max(120),
      baseUrl: z.string().trim().max(2000).optional().default(""),
      specUrl: z.string().trim().max(2000).optional().default(""),
      specText: z.string().max(1024 * 1024).optional().default(""),
      authType: z.enum(["none", "bearer", "api_key_header", "api_key_query", "basic"]).default("none"),
      parameterName: z.string().trim().max(120).optional().default(""),
      authUsername: z.string().trim().max(320).optional().default(""),
      authSecret: z.string().max(8000).optional().default("")
    }).parse(req.body || {});
    if (!body.specUrl && !body.specText.trim()) return res.status(400).json({ error: "Provide an OpenAPI JSON or YAML document or its HTTPS URL." });
    const authConfig = { parameterName: body.parameterName, username: body.authUsername };
    const connection = await createConnection({ companyId: req.companyId, actorEmail: req.user.email, name: body.name, baseUrl: body.baseUrl, specUrl: body.specUrl, specText: body.specText, authType: body.authType, authConfig, authSecret: body.authSecret });
    res.status(201).json({ ok: true, connectionId: connection.id, name: connection.name, actionsDiscovered: connection.actions.length });
  }));

  router.put("/:connectionId/auth", asyncRoute(async (req, res) => {
    const body = authBody.parse(req.body || {});
    const connection = await updateConnectionAuth({
      companyId: req.companyId,
      connectionId: req.params.connectionId,
      actor: req.user,
      authType: body.authType,
      authConfig: { parameterName: body.parameterName, username: body.username },
      authSecret: body.authSecret
    });
    res.json({ ok: true, credentialStatus: connection.credential_status });
  }));

  router.post("/:connectionId/oauth/start", asyncRoute(async (req, res) => {
    const body = z.object({ clientId: z.string().trim().min(1).max(500), scopes: z.array(z.string().trim().max(200)).max(30).optional().default([]) }).parse(req.body || {});
    res.json(await startOAuth({ companyId: req.companyId, connectionId: req.params.connectionId, actor: req.user, ...body }));
  }));

  router.post("/:connectionId/test", asyncRoute(async (req, res) => {
    res.json(await testConnection({ companyId: req.companyId, connectionId: req.params.connectionId }));
  }));

  router.post("/:connectionId/manual-verification", asyncRoute(async (req, res) => {
    const body = z.object({ reason: z.string().trim().min(10).max(300) }).parse(req.body || {});
    res.json(await markManualVerification({ companyId: req.companyId, connectionId: req.params.connectionId, actor: req.user, reason: body.reason }));
  }));

  router.put("/:connectionId/advanced", asyncRoute(async (req, res) => {
    const body = z.object({
      baseUrl: z.string().trim().url().max(2000),
      apiVersion: z.string().trim().max(80).optional().default(""),
      behaviorConfig: z.object({ timeoutMs: z.coerce.number().optional(), requestsPerMinute: z.coerce.number().optional(), maxResponseChars: z.coerce.number().optional(), retryReads: z.coerce.number().optional() }).optional().default({})
    }).parse(req.body || {});
    await updateConnectionAdvanced({ companyId: req.companyId, connectionId: req.params.connectionId, actor: req.user, ...body });
    res.json({ ok: true });
  }));

  router.post("/:connectionId/spec", limitDiscovery, asyncRoute(async (req, res) => {
    const body = z.object({ baseUrl: z.string().trim().max(2000).optional().default(""), specUrl: z.string().trim().max(2000).optional().default(""), specText: z.string().max(1024 * 1024).optional().default("") }).parse(req.body || {});
    if (!body.specUrl && !body.specText.trim()) return res.status(400).json({ error: "Provide an OpenAPI JSON or YAML URL or paste the document." });
    res.json({ ok: true, ...(await importConnectionSpec({ companyId: req.companyId, connectionId: req.params.connectionId, actor: req.user, ...body })) });
  }));

  router.post("/:connectionId/spec/refresh", limitDiscovery, asyncRoute(async (req, res) => {
    const body = z.object({ specUrl: z.string().trim().max(2000).optional().default(""), specText: z.string().max(1024 * 1024).optional().default("") }).parse(req.body || {});
    res.json({ ok: true, ...(await refreshConnectionSpec({ companyId: req.companyId, connectionId: req.params.connectionId, actor: req.user, ...body })) });
  }));

  router.post("/:connectionId/actions/manual", asyncRoute(async (req, res) => {
    const body = z.object({ operationId: z.string().trim().min(1).max(180), displayName: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).optional().default(""), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]), path: z.string().trim().min(1).max(1000), inputSchema: z.record(z.any()), approvalPolicy: z.enum(["automatic", "customer_confirmation", "staff_approval"]) }).parse(req.body || {});
    const action = await createManualAction({ companyId: req.companyId, connectionId: req.params.connectionId, actor: req.user, ...body });
    res.status(201).json({ ok: true, actionId: action.id });
  }));

  for (const operation of ["disable", "enable", "revoke"]) {
    router.post(`/:connectionId/${operation}`, asyncRoute(async (req, res) => {
      res.json(await setConnectionStatus({ companyId: req.companyId, connectionId: req.params.connectionId, actor: req.user, operation }));
    }));
  }

  router.put("/actions/:actionId", asyncRoute(async (req, res) => {
    const body = z.object({ enabled: z.boolean(), approvalPolicy: z.enum(["automatic", "customer_confirmation", "staff_approval"]), acknowledgeHighImpact: z.boolean().optional().default(false) }).parse(req.body || {});
    const action = await updateAction({ companyId: req.companyId, actionId: req.params.actionId, actor: req.user, ...body });
    res.json({ ok: true, action: { id: action.id, enabled: action.enabled, approvalPolicy: action.approval_policy } });
  }));

  router.put("/actions/:actionId/assignments", asyncRoute(async (req, res) => {
    const body = z.object({ tenantOperationIds: z.array(z.string().uuid()).max(50) }).parse(req.body || {});
    res.json(await assignAction({ companyId: req.companyId, actionId: req.params.actionId, tenantOperationIds: body.tenantOperationIds, actor: req.user }));
  }));

  router.post("/actions/:actionId/test", asyncRoute(async (req, res) => {
    const body = z.object({
      args: z.record(z.any()).optional().default({}),
      confirmLiveWrite: z.boolean().optional().default(false),
      acknowledgeHighImpact: z.boolean().optional().default(false)
    }).parse(req.body || {});
    res.json(await testIntegrationAction({
      companyId: req.companyId,
      actionId: req.params.actionId,
      actor: req.user,
      args: body.args,
      confirmLiveWrite: body.confirmLiveWrite,
      acknowledgeHighImpact: body.acknowledgeHighImpact
    }));
  }));

  router.get("/executions/:executionId", asyncRoute(async (req, res) => {
    res.json(await getExecutionDetail(req.companyId, req.params.executionId));
  }));

  router.post("/executions/:executionId/approve", asyncRoute(async (req, res) => {
    res.json(await approveExecution({ companyId: req.companyId, executionId: req.params.executionId, actorEmail: req.user.email }));
  }));

  return router;
}

module.exports = { buildRouter, requireTenantAdmin };
