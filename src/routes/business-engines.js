const express = require("express");
const { z } = require("zod");
const {
  listBusinessEngines,
  updateTenantEngine,
  applyEngineSetup,
  listTenantEngineInstructions,
  saveTenantEngineInstruction,
  activateTenantEngineInstruction,
  deleteTenantEngineInstructionVersion,
  resetTenantEngineInstruction,
  updateTenantField,
  createCustomField,
  updateTenantOperation,
  testEngineConnections,
  approveBusinessOperation,
  updateOperationBlueprint
} = require("../business-engines");

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch((error) => {
  if (error?.statusCode >= 400 && error.statusCode < 600) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code || "BUSINESS_ENGINE_ERROR" });
  }
  return next(error);
});

function requireTenantAdmin(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();
  const isTenantAdmin = ["admin", "account_admin", "owner"].includes(role);
  const isAuditedPlatformAssist = Boolean(req.user?.platform_role && req.assistSessionId);
  if (!isTenantAdmin && !isAuditedPlatformAssist) {
    return res.status(403).json({ error: "Only a tenant administrator can configure Business Engines." });
  }
  next();
}

function buildRouter({ requireAuth }) {
  const router = express.Router();
  router.use(requireAuth, requireTenantAdmin);

  // Plain-language workflow view (Director) — see docs/MASTERPLAN-director.md.
  router.get("/workflows", asyncRoute(async (req, res) => {
    res.json(await require("../workflows-view").describeWorkflows(req.companyId));
  }));
  // Open cases (one per customer need): retry / sent reference / handle / close.
  router.post("/cases/:id/:action", asyncRoute(async (req, res) => {
    const action = req.params.action;
    if (!["retry", "manual", "handle", "close", "done", "still_open", "cancel"].includes(action)) return res.status(400).json({ error: "Unknown action." });
    const body = z.object({ reference: z.string().max(80).optional(), note: z.string().max(300).optional() }).parse(req.body || {});
    res.json(await require("../workflows-view").caseAction({ companyId: req.companyId, requestId: req.params.id, action, reference: body.reference, note: body.note, actor: req.user }));
  }));
  router.put("/workflows/:engineKey/:operationKey", asyncRoute(async (req, res) => {
    const body = z.object({ enabled: z.boolean() }).parse(req.body || {});
    res.json(await require("../workflows-view").setWorkflowEnabled({ companyId: req.companyId, engineKey: req.params.engineKey, operationKey: req.params.operationKey, enabled: body.enabled, actor: req.user }));
  }));

  router.get("/", asyncRoute(async (req, res) => {
    res.json(await listBusinessEngines(req.companyId));
  }));

  router.get("/:engineKey/instructions", asyncRoute(async (req, res) => {
    res.json(await listTenantEngineInstructions({ companyId: req.companyId, engineKey: req.params.engineKey }));
  }));

  router.post("/:engineKey/instructions", asyncRoute(async (req, res) => {
    const body = z.object({
      content: z.string().trim().min(1).max(12000),
      note: z.string().trim().max(300).optional().default("")
    }).parse(req.body || {});
    res.status(201).json(await saveTenantEngineInstruction({ companyId: req.companyId, engineKey: req.params.engineKey, ...body, actor: req.user }));
  }));

  router.post("/:engineKey/instructions/activate", asyncRoute(async (req, res) => {
    const body = z.object({ version: z.number().int().positive() }).parse(req.body || {});
    res.json(await activateTenantEngineInstruction({ companyId: req.companyId, engineKey: req.params.engineKey, version: body.version, actor: req.user }));
  }));

  router.delete("/:engineKey/instructions/:version", asyncRoute(async (req, res) => {
    const version = z.coerce.number().int().positive().parse(req.params.version);
    res.json(await deleteTenantEngineInstructionVersion({ companyId: req.companyId, engineKey: req.params.engineKey, version, actor: req.user }));
  }));

  router.delete("/:engineKey/instructions", asyncRoute(async (req, res) => {
    res.json(await resetTenantEngineInstruction({ companyId: req.companyId, engineKey: req.params.engineKey, actor: req.user }));
  }));

  router.put("/:engineKey", asyncRoute(async (req, res) => {
    const body = z.object({ enabled: z.boolean() }).parse(req.body || {});
    await updateTenantEngine({ companyId: req.companyId, engineKey: req.params.engineKey, ...body, actor: req.user });
    res.json({ ok: true });
  }));

  router.post("/:engineKey/setup", asyncRoute(async (req, res) => {
    const body = z.object({
      mappings: z.array(z.object({
        operationKey: z.string().trim().min(1).max(120),
        actionId: z.string().uuid(),
        fieldMapping: z.record(z.string().trim().min(1).max(160)).default({})
      })).min(1).max(60)
    }).parse(req.body || {});
    res.json(await applyEngineSetup({ companyId: req.companyId, engineKey: req.params.engineKey, mappings: body.mappings, actor: req.user }));
  }));

  router.put("/:engineKey/fields/:fieldKey", asyncRoute(async (req, res) => {
    const body = z.object({
      enabled: z.boolean(),
      required: z.boolean(),
      externalField: z.string().trim().max(160).optional().default("")
    }).parse(req.body || {});
    await updateTenantField({ companyId: req.companyId, engineKey: req.params.engineKey, fieldKey: req.params.fieldKey, ...body, actor: req.user });
    res.json({ ok: true });
  }));

  router.post("/:engineKey/fields", asyncRoute(async (req, res) => {
    const body = z.object({
      fieldKey: z.string().trim().min(1).max(80),
      label: z.string().trim().min(1).max(120),
      description: z.string().trim().max(500).optional().default(""),
      dataType: z.enum(["string", "number", "boolean", "date"]).default("string"),
      required: z.boolean().default(false)
    }).parse(req.body || {});
    const field = await createCustomField({ companyId: req.companyId, engineKey: req.params.engineKey, ...body, actor: req.user });
    res.status(201).json({ ok: true, id: field.id, key: field.field_key });
  }));

  router.put("/:engineKey/operations/:operationKey", asyncRoute(async (req, res) => {
    const body = z.object({
      enabled: z.boolean(),
      policy: z.enum(["automatic", "customer_confirmation", "staff_approval", "staff_only"]),
      fallbackPolicy: z.enum(["create_human_task", "create_pending_action", "escalate_to_staff", "inform_customer_review", "ask_staff_manual", "log_missing_capability"]),
      actionId: z.string().uuid().nullable().optional(),
      fieldMapping: z.record(z.string().trim().min(1).max(160)).optional().default({})
    }).parse(req.body || {});
    await updateTenantOperation({ companyId: req.companyId, engineKey: req.params.engineKey, operationKey: req.params.operationKey, ...body, actor: req.user });
    res.json({ ok: true });
  }));

  router.put("/:engineKey/operations/:operationKey/blueprint", asyncRoute(async (req, res) => {
    const body = z.object({ workflowConfig: z.record(z.any()) }).parse(req.body || {});
    const result = await updateOperationBlueprint({
      companyId: req.companyId,
      engineKey: req.params.engineKey,
      operationKey: req.params.operationKey,
      workflowConfig: body.workflowConfig,
      actor: req.user
    });
    res.json(result);
  }));

  router.post("/:engineKey/test", asyncRoute(async (req, res) => {
    res.json(await testEngineConnections({ companyId: req.companyId, engineKey: req.params.engineKey }));
  }));

  router.post("/requests/:requestId/approve", asyncRoute(async (req, res) => {
    res.json(await approveBusinessOperation({ companyId: req.companyId, requestId: req.params.requestId, actor: req.user }));
  }));

  return router;
}

module.exports = { buildRouter, requireTenantAdmin };
