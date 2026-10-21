const crypto = require("crypto");
const { prisma } = require("./db");
const { ENGINE_CATALOG } = require("./business-engine-catalog");
const {
  executeCompanyTool,
  approveExecution,
  testConnection,
  runBlueprintDryRun,
  prepareBlueprintConfirmation,
  commitBlueprintConfirmation
} = require("./integrations");
const {
  normalizeBlueprint,
  buildBlueprintToolSchema,
  prepareArguments,
  applyDerived,
  missingFields,
  fieldFacts,
  labelArguments,
  extractAnchors,
  blueprintWarnings,
  validateWorkflowConfig,
  scopeResultToCustomers
} = require("./engine-blueprint");

const READ_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DRAFT_STATUSES = ["collecting", "pending_customer_confirmation"];
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const { recommendEngineSetup } = require("./engine-recommendations");
const { notifyEngineRequest } = require("./notify");

const POLICIES = ["automatic", "customer_confirmation", "staff_approval", "staff_only"];
const POLICY_RANK = Object.fromEntries(POLICIES.map((value, index) => [value, index]));
const FALLBACK_POLICIES = [
  "create_human_task", "create_pending_action", "escalate_to_staff",
  "inform_customer_review", "ask_staff_manual", "log_missing_capability"
];

class BusinessEngineError extends Error {
  constructor(message, statusCode = 400, code = "BUSINESS_ENGINE_ERROR") {
    super(message);
    this.name = "BusinessEngineError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function cleanKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function logicalToolName(engineKey, operationKey) {
  return `engine_${cleanKey(engineKey)}_${cleanKey(operationKey)}`.slice(0, 64).replace(/_+$/g, "");
}

function engineInstructionKey(companyId, engineKey) {
  return `engine_instruction:${companyId}:${cleanKey(engineKey)}`;
}

function effectiveEngineInstruction(row) {
  const custom = String(row?.tenant_instruction || "").trim();
  return custom || String(row?.default_instruction_snapshot || "").trim();
}

function safeAuditMetadata(metadata) {
  const blocked = /secret|token|password|credential|authorization|api.?key/i;
  const walk = (value, depth = 0) => {
    if (depth > 5) return "[truncated]";
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => walk(item, depth + 1));
    if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 1000) : value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !blocked.test(key)).map(([key, item]) => [key, walk(item, depth + 1)]));
  };
  return walk(metadata || {});
}

async function auditTenantChange({ companyId, actor, action, targetType, targetId, metadata }) {
  await prisma.tenantAuditLog.create({
    data: {
      company_id: companyId,
      actor_id: actor?.id || null,
      actor_email: actor?.email || null,
      action,
      target_type: targetType,
      target_id: targetId || null,
      metadata: safeAuditMetadata(metadata)
    }
  });
}

let catalogReady = null;

async function ensureBusinessEngineCatalog() {
  if (catalogReady) return catalogReady;
  catalogReady = (async () => {
    for (const catalogEngine of ENGINE_CATALOG) {
      const engine = await prisma.businessEngine.upsert({
        where: { key: catalogEngine.key },
        create: {
          key: catalogEngine.key,
          name: catalogEngine.name,
          description: catalogEngine.description,
          default_instruction: catalogEngine.instruction,
          catalog_version: catalogEngine.version,
          active: true,
          display_order: catalogEngine.order
        },
        update: {
          name: catalogEngine.name,
          description: catalogEngine.description,
          default_instruction: catalogEngine.instruction,
          catalog_version: catalogEngine.version,
          active: true,
          display_order: catalogEngine.order
        }
      });
      await prisma.tenantEngine.updateMany({
        where: {
          engine_id: engine.id,
          catalog_version: { lt: engine.catalog_version }
        },
        data: {
          default_instruction_snapshot: engine.default_instruction,
          catalog_version: engine.catalog_version
        }
      });
      for (const field of catalogEngine.fields) {
        await prisma.engineFieldDefinition.upsert({
          where: { engine_id_field_key: { engine_id: engine.id, field_key: field.key } },
          create: {
            engine_id: engine.id,
            field_key: field.key,
            label: field.label,
            description: field.description,
            data_type: field.dataType,
            default_enabled: field.enabled,
            default_required: field.required,
            display_order: field.order
          },
          update: {
            label: field.label,
            description: field.description,
            data_type: field.dataType,
            default_enabled: field.enabled,
            default_required: field.required,
            display_order: field.order
          }
        });
      }
      for (const [index, operation] of catalogEngine.operations.entries()) {
        await prisma.engineOperationDefinition.upsert({
          where: { engine_id_operation_key: { engine_id: engine.id, operation_key: operation.key } },
          create: {
            engine_id: engine.id,
            operation_key: operation.key,
            name: operation.name,
            description: operation.description,
            operation_type: operation.type,
            required_fields: operation.required,
            default_policy: operation.defaultPolicy,
            minimum_policy: operation.minimumPolicy,
            default_fallback: operation.fallback,
            display_order: index + 1
          },
          update: {
            name: operation.name,
            description: operation.description,
            operation_type: operation.type,
            required_fields: operation.required,
            default_policy: operation.defaultPolicy,
            minimum_policy: operation.minimumPolicy,
            default_fallback: operation.fallback,
            display_order: index + 1
          }
        });
      }
    }
  })().catch((error) => {
    catalogReady = null;
    throw error;
  });
  return catalogReady;
}

async function engineDefinition(engineKey) {
  await ensureBusinessEngineCatalog();
  const engine = await prisma.businessEngine.findUnique({
    where: { key: engineKey },
    include: {
      fields: { orderBy: { display_order: "asc" } },
      operations: { orderBy: { display_order: "asc" } }
    }
  });
  if (!engine || !engine.active) throw new BusinessEngineError("Business engine not found.", 404, "ENGINE_NOT_FOUND");
  return engine;
}

async function ensureTenantEngine(companyId, engineKey) {
  const engine = await engineDefinition(engineKey);
  const tenantEngine = await prisma.tenantEngine.upsert({
    where: { company_id_engine_id: { company_id: companyId, engine_id: engine.id } },
    create: {
      company_id: companyId,
      engine_id: engine.id,
      default_instruction_snapshot: engine.default_instruction,
      catalog_version: engine.catalog_version
    },
    update: {}
  });
  if (engine.fields.length) {
    await prisma.tenantEngineField.createMany({
      data: engine.fields.map((field) => ({
        id: crypto.randomUUID(),
        company_id: companyId,
        tenant_engine_id: tenantEngine.id,
        definition_id: field.id,
        field_key: field.field_key,
        label: field.label,
        description: field.description,
        data_type: field.data_type,
        enabled: field.default_enabled,
        required: field.default_required,
        display_order: field.display_order
      })),
      skipDuplicates: true
    });
  }
  if (engine.operations.length) {
    await prisma.tenantEngineOperation.createMany({
      data: engine.operations.map((operation) => ({
        id: crypto.randomUUID(),
        company_id: companyId,
        tenant_engine_id: tenantEngine.id,
        operation_definition_id: operation.id,
        enabled: true,
        policy: operation.default_policy,
        fallback_policy: operation.default_fallback
      })),
      skipDuplicates: true
    });
  }
  return tenantEngine;
}

async function ensureAllTenantEngines(companyId) {
  await ensureBusinessEngineCatalog();
  for (const engine of ENGINE_CATALOG) await ensureTenantEngine(companyId, engine.key);
}

function serializeTenantEngine(row) {
  const mapped = row.operations.filter((operation) => operation.mapping?.status === "mapped").length;
  const available = row.operations.filter((operation) => operation.enabled && operation.policy !== "staff_only" && operation.mapping?.status === "mapped").length;
  return {
    id: row.id,
    key: row.engine.key,
    name: row.engine.name,
    description: row.engine.description,
    tenantId: row.company_id,
    enabled: row.enabled,
    defaultInstruction: row.default_instruction_snapshot,
    systemGuidanceEnabled: row.instruction_enabled,
    systemGuidance: row.instruction_enabled ? effectiveEngineInstruction(row) : "",
    usingDefaultInstruction: !String(row.tenant_instruction || "").trim(),
    catalogVersion: row.catalog_version,
    enabledAt: row.enabled_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    summary: { mapped, available, total: row.operations.length },
    fields: row.fields.map((field) => ({
      id: field.id,
      key: field.field_key,
      label: field.label,
      description: field.description,
      dataType: field.data_type,
      enabled: field.enabled,
      required: field.required,
      custom: field.is_custom,
      externalField: field.external_field || "",
      order: field.display_order
    })),
    operations: row.operations.map((operation) => ({
      id: operation.id,
      key: operation.definition.operation_key,
      name: operation.definition.name,
      description: operation.definition.description,
      type: operation.definition.operation_type,
      requiredFields: Array.isArray(operation.definition.required_fields) ? operation.definition.required_fields : [],
      enabled: operation.enabled,
      policy: operation.policy,
      minimumPolicy: operation.definition.minimum_policy,
      fallbackPolicy: operation.fallback_policy,
      mapping: operation.mapping ? {
        id: operation.mapping.id,
        status: operation.mapping.status,
        actionId: operation.mapping.integration_action_id,
        fieldMapping: operation.mapping.field_mapping || {},
        action: operation.mapping.integration_action ? {
          displayName: operation.mapping.integration_action.display_name,
          operationId: operation.mapping.integration_action.operation_id,
          method: operation.mapping.integration_action.http_method,
          path: operation.mapping.integration_action.path,
          connectionName: operation.mapping.integration_action.connection?.name || "",
          fields: Object.entries(operation.mapping.integration_action.input_schema?.properties || {}).map(([key, schema]) => ({
            key,
            type: Array.isArray(schema.type) ? schema.type.join("|") : (schema.type || ""),
            enum: Array.isArray(schema.enum) ? schema.enum : null,
            required: (operation.mapping.integration_action.input_schema?.required || []).includes(key),
            description: schema.description || ""
          }))
        } : null,
        workflowConfig: operation.mapping.workflow_config || {},
        blueprintWarnings: operation.mapping.integration_action
          ? blueprintWarnings(operation.mapping.integration_action, normalizeBlueprint(operation.mapping.workflow_config, operation.mapping.integration_action))
          : []
      } : null
    }))
  };
}

const tenantEngineInclude = {
  engine: true,
  fields: { orderBy: { display_order: "asc" } },
  operations: {
    orderBy: { definition: { display_order: "asc" } },
    include: {
      definition: true,
      mapping: { include: { integration_action: { include: { connection: true } } } }
    }
  }
};

async function loadTenantEngineRows(companyId, enabledOnly = false) {
  await ensureBusinessEngineCatalog();
  return prisma.tenantEngine.findMany({
    where: { company_id: companyId, ...(enabledOnly ? { enabled: true } : {}) },
    include: tenantEngineInclude,
    orderBy: { engine: { display_order: "asc" } }
  });
}

async function listBusinessEngines(companyId) {
  await ensureAllTenantEngines(companyId);
  const [rows, connections, requests, gaps, audit] = await Promise.all([
    loadTenantEngineRows(companyId),
    prisma.integrationConnection.findMany({
      where: { company_id: companyId },
      include: { actions: { orderBy: { display_name: "asc" } } },
      orderBy: { name: "asc" }
    }),
    prisma.businessOperationRequest.findMany({
      where: { company_id: companyId },
      include: { tenant_operation: { include: { definition: true, tenant_engine: { include: { engine: true } } } } },
      orderBy: { created_at: "desc" },
      take: 50
    }),
    prisma.capabilityGap.findMany({
      where: { company_id: companyId },
      orderBy: [{ frequency_count: "desc" }, { last_seen_at: "desc" }],
      take: 50
    }),
    prisma.tenantAuditLog.findMany({ where: { company_id: companyId }, orderBy: { created_at: "desc" }, take: 50 })
  ]);
  const serializedConnections = connections.map((connection) => ({
    id: connection.id,
    name: connection.name,
    status: connection.status,
    lastTestStatus: connection.last_test_status,
    hasSecret: Boolean(connection.auth_secret_encrypted),
    sourceUrl: connection.source_url,
    actions: connection.actions.map((action) => ({
      id: action.id,
      displayName: action.display_name,
      operationId: action.operation_id,
      description: action.description,
      method: action.http_method,
      path: action.path,
      riskLevel: action.risk_level,
      inputSchema: action.input_schema,
      category: action.category,
      enabled: action.enabled,
      approvalPolicy: action.approval_policy,
      minimumPolicy: action.minimum_approval_policy
    }))
  }));
  const serializedEngines = rows.map(serializeTenantEngine);
  for (const engine of serializedEngines) engine.recommendation = recommendEngineSetup(engine, serializedConnections);
  return {
    engines: serializedEngines,
    connections: serializedConnections,
    requests: requests.map((request) => ({
      id: request.id,
      engine: request.tenant_operation.tenant_engine.engine.name,
      operation: request.tenant_operation.definition.name,
      status: request.status,
      policy: request.policy,
      arguments: request.requested_arguments,
      fallbackUsed: request.fallback_used,
      requestedBy: request.requested_by,
      approvedBy: request.approved_by,
      createdAt: request.created_at,
      completedAt: request.completed_at
    })),
    gaps: gaps.map((gap) => ({ operationKey: gap.operation_key, count: gap.frequency_count, fallbackUsed: gap.fallback_used, lastSeenAt: gap.last_seen_at })),
    audit: audit.map((entry) => ({ id: entry.id, action: entry.action, targetType: entry.target_type, targetId: entry.target_id, actor: entry.actor_email, metadata: entry.metadata, createdAt: entry.created_at }))
  };
}

function assertPolicyAllowed(policy, minimumPolicy) {
  if (!POLICIES.includes(policy)) throw new BusinessEngineError("Choose a valid operation policy.");
  if (POLICY_RANK[policy] < POLICY_RANK[minimumPolicy]) {
    throw new BusinessEngineError(`This operation cannot be less restrictive than ${minimumPolicy.replaceAll("_", " ")}.`, 400, "POLICY_TOO_WEAK");
  }
}

async function updateTenantEngine({ companyId, engineKey, enabled, actor }) {
  const tenant = await ensureTenantEngine(companyId, engineKey);
  const previous = await prisma.tenantEngine.findUnique({ where: { id: tenant.id } });
  const updated = await prisma.tenantEngine.update({
    where: { id: tenant.id },
    data: {
      enabled,
      instruction_enabled: true,
      enabled_at: enabled ? (previous.enabled_at || new Date()) : null,
      updated_by: actor?.email || null
    }
  });
  await auditTenantChange({
    companyId, actor,
    action: enabled !== previous.enabled ? (enabled ? "engine.activated" : "engine.deactivated") : "engine.status_updated",
    targetType: "tenant_engine",
    targetId: updated.id,
    metadata: { engineKey, enabled }
  });
  return updated;
}

async function applyEngineSetup({ companyId, engineKey, mappings, actor }) {
  const tenant = await ensureTenantEngine(companyId, engineKey);
  const operations = await prisma.tenantEngineOperation.findMany({
    where: { company_id: companyId, tenant_engine_id: tenant.id },
    include: { definition: true, mapping: true }
  });
  const fields = await prisma.tenantEngineField.findMany({
    where: { company_id: companyId, tenant_engine_id: tenant.id, enabled: true }
  });
  const operationByKey = new Map(operations.map((operation) => [operation.definition.operation_key, operation]));
  const fieldKeys = new Set(fields.map((field) => field.field_key));
  const selections = [...new Map((mappings || []).map((mapping) => [mapping.operationKey, mapping])).values()];
  if (!selections.length) throw new BusinessEngineError("Choose at least one job before activating this engine.", 400, "NO_ENGINE_JOBS");
  for (const selection of selections) {
    if (!operationByKey.has(selection.operationKey)) throw new BusinessEngineError("One selected job does not belong to this engine.", 400, "INVALID_ENGINE_JOB");
  }

  const actionIds = [...new Set(selections.map((selection) => selection.actionId))];
  const actions = await prisma.integrationAction.findMany({
    where: { id: { in: actionIds }, company_id: companyId },
    include: { connection: true }
  });
  if (actions.length !== actionIds.length) throw new BusinessEngineError("One selected company function is unavailable.", 404, "ACTION_NOT_FOUND");
  const actionById = new Map(actions.map((action) => [action.id, action]));

  for (const connectionId of [...new Set(actions.map((action) => action.connection_id))]) {
    const test = await testConnection({ companyId, connectionId });
    if (test.status !== "passed") {
      throw new BusinessEngineError("The company connection could not be verified. Test or repair it before activation.", 409, "CONNECTION_TEST_FAILED");
    }
  }

  const normalized = selections.map((selection) => {
    const operation = operationByKey.get(selection.operationKey);
    const action = actionById.get(selection.actionId);
    const schema = action.input_schema && typeof action.input_schema === "object" ? action.input_schema : {};
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    const fieldMapping = selection.fieldMapping && typeof selection.fieldMapping === "object" ? selection.fieldMapping : {};
    for (const [logical, external] of Object.entries(fieldMapping)) {
      if (!fieldKeys.has(logical) || !Object.prototype.hasOwnProperty.call(properties, external)) {
        throw new BusinessEngineError(`Check the field matching for ${operation.definition.name}.`, 400, "INVALID_FIELD_MAPPING");
      }
    }
    const requiredLogical = Array.isArray(operation.definition.required_fields) ? operation.definition.required_fields : [];
    const missingLogical = requiredLogical.filter((name) => !fieldMapping[name]);
    if (missingLogical.length) {
      throw new BusinessEngineError(`${operation.definition.name} still needs ${missingLogical.length} business field ${missingLogical.length === 1 ? "match" : "matches"}.`, 400, "UNRESOLVED_LOGICAL_FIELDS");
    }
    const covered = new Set(Object.values(fieldMapping));
    const unresolved = (Array.isArray(schema.required) ? schema.required : []).filter((name) => !covered.has(name));
    if (unresolved.length) {
      throw new BusinessEngineError(`${operation.definition.name} still needs ${unresolved.length} field ${unresolved.length === 1 ? "match" : "matches"}.`, 400, "UNRESOLVED_FIELDS");
    }
    const policy = POLICIES[Math.max(
      POLICY_RANK[operation.policy] ?? 0,
      POLICY_RANK[operation.definition.minimum_policy] ?? 0,
      POLICY_RANK[action.minimum_approval_policy] ?? 0
    )];
    return { operation, action, fieldMapping, policy };
  });

  await prisma.$transaction(async (tx) => {
    const selectedOperationIds = new Set(normalized.map((item) => item.operation.id));
    for (const operation of operations) {
      if (!selectedOperationIds.has(operation.id) && !operation.mapping) {
        await tx.tenantEngineOperation.update({ where: { id: operation.id }, data: { enabled: false } });
      }
    }
    for (const item of normalized) {
      await tx.tenantEngineOperation.update({ where: { id: item.operation.id }, data: { enabled: true, policy: item.policy } });
      await tx.engineOperationMapping.upsert({
        where: { tenant_engine_operation_id: item.operation.id },
        create: { company_id: companyId, tenant_engine_operation_id: item.operation.id, integration_action_id: item.action.id, field_mapping: item.fieldMapping, status: "mapped" },
        update: { integration_action_id: item.action.id, field_mapping: item.fieldMapping, status: "mapped" }
      });
      await tx.integrationAction.update({ where: { id: item.action.id }, data: { enabled: true, approval_policy: item.policy } });
      await tx.integrationConnection.update({ where: { id: item.action.connection_id }, data: { status: "active" } });
    }
    await tx.tenantEngine.update({
      where: { id: tenant.id },
      data: { enabled: true, instruction_enabled: true, enabled_at: tenant.enabled_at || new Date(), updated_by: actor?.email || null }
    });
  });
  await auditTenantChange({
    companyId,
    actor,
    action: "engine.guided_setup_activated",
    targetType: "tenant_engine",
    targetId: tenant.id,
    metadata: { engineKey, mappedJobs: normalized.map((item) => item.operation.definition.operation_key) }
  });
  return { ok: true, enabled: true, mapped: normalized.length };
}

async function listTenantEngineInstructions({ companyId, engineKey }) {
  const tenant = await ensureTenantEngine(companyId, engineKey);
  const row = await prisma.tenantEngine.findFirst({
    where: { id: tenant.id, company_id: companyId },
    include: { engine: true }
  });
  const key = engineInstructionKey(companyId, engineKey);
  const revisions = await prisma.promptRevision.findMany({
    where: { key },
    orderBy: { version: "desc" },
    select: { id: true, version: true, content: true, note: true, created_by: true, is_active: true, created_at: true }
  });
  return {
    engineKey: row.engine.key,
    engineName: row.engine.name,
    enabled: row.instruction_enabled,
    defaultInstruction: row.default_instruction_snapshot,
    currentInstruction: effectiveEngineInstruction(row),
    usingDefault: !String(row.tenant_instruction || "").trim(),
    activeVersion: revisions.find((revision) => revision.is_active)?.version || null,
    revisions: revisions.map((revision) => ({
      id: revision.id,
      version: revision.version,
      content: revision.content,
      note: revision.note,
      createdBy: revision.created_by,
      active: revision.is_active,
      createdAt: revision.created_at
    }))
  };
}

async function saveTenantEngineInstruction({ companyId, engineKey, content, note, actor }) {
  const tenant = await ensureTenantEngine(companyId, engineKey);
  const key = engineInstructionKey(companyId, engineKey);
  const normalizedContent = String(content || "").trim();
  const latest = await prisma.promptRevision.findFirst({ where: { key }, orderBy: { version: "desc" } });
  const nextVersion = Number(latest?.version || 0) + 1;
  let revision;
  try {
    [, revision] = await prisma.$transaction([
      prisma.promptRevision.updateMany({ where: { key, is_active: true }, data: { is_active: false } }),
      prisma.promptRevision.create({
        data: {
          key,
          version: nextVersion,
          content: normalizedContent,
          note: String(note || "").trim() || null,
          created_by: actor?.email || null,
          is_active: true
        }
      }),
      prisma.tenantEngine.update({
        where: { id: tenant.id },
        data: { tenant_instruction: normalizedContent, instruction_enabled: true, updated_by: actor?.email || null }
      })
    ]);
  } catch (error) {
    if (error?.code === "P2002") throw new BusinessEngineError("Another version was saved at the same time. Refresh and try again.", 409, "INSTRUCTION_VERSION_CONFLICT");
    throw error;
  }
  await auditTenantChange({
    companyId, actor,
    action: "engine.instruction_version_created",
    targetType: "tenant_engine",
    targetId: tenant.id,
    metadata: { engineKey, version: revision.version }
  });
  return { ok: true, version: revision.version };
}

async function activateTenantEngineInstruction({ companyId, engineKey, version, actor }) {
  const tenant = await ensureTenantEngine(companyId, engineKey);
  const key = engineInstructionKey(companyId, engineKey);
  const target = await prisma.promptRevision.findFirst({ where: { key, version } });
  if (!target) throw new BusinessEngineError("That engine instruction version was not found.", 404, "INSTRUCTION_VERSION_NOT_FOUND");
  await prisma.$transaction([
    prisma.promptRevision.updateMany({ where: { key, is_active: true }, data: { is_active: false } }),
    prisma.promptRevision.update({ where: { id: target.id }, data: { is_active: true } }),
    prisma.tenantEngine.update({
      where: { id: tenant.id },
      data: { tenant_instruction: target.content, instruction_enabled: true, updated_by: actor?.email || null }
    })
  ]);
  await auditTenantChange({
    companyId, actor,
    action: "engine.instruction_version_activated",
    targetType: "tenant_engine",
    targetId: tenant.id,
    metadata: { engineKey, version }
  });
  return { ok: true, version };
}

async function deleteTenantEngineInstructionVersion({ companyId, engineKey, version, actor }) {
  const tenant = await ensureTenantEngine(companyId, engineKey);
  const key = engineInstructionKey(companyId, engineKey);
  const target = await prisma.promptRevision.findFirst({ where: { key, version } });
  if (!target) throw new BusinessEngineError("That engine instruction version was not found.", 404, "INSTRUCTION_VERSION_NOT_FOUND");
  if (target.is_active) {
    throw new BusinessEngineError("Restore another version or use the platform default before deleting this version.", 409, "ACTIVE_INSTRUCTION_VERSION");
  }
  await prisma.promptRevision.delete({ where: { id: target.id } });
  await auditTenantChange({
    companyId, actor,
    action: "engine.instruction_version_deleted",
    targetType: "tenant_engine",
    targetId: tenant.id,
    metadata: { engineKey, version }
  });
  return { ok: true };
}

async function resetTenantEngineInstruction({ companyId, engineKey, actor }) {
  const tenant = await ensureTenantEngine(companyId, engineKey);
  const key = engineInstructionKey(companyId, engineKey);
  await prisma.$transaction([
    prisma.promptRevision.updateMany({ where: { key, is_active: true }, data: { is_active: false } }),
    prisma.tenantEngine.update({
      where: { id: tenant.id },
      data: { tenant_instruction: null, instruction_enabled: true, updated_by: actor?.email || null }
    })
  ]);
  await auditTenantChange({
    companyId, actor,
    action: "engine.instruction_reset_to_default",
    targetType: "tenant_engine",
    targetId: tenant.id,
    metadata: { engineKey }
  });
  return { ok: true };
}
async function updateTenantField({ companyId, engineKey, fieldKey, enabled, required, externalField, actor }) {
  const tenant = await ensureTenantEngine(companyId, engineKey);
  const field = await prisma.tenantEngineField.findFirst({ where: { tenant_engine_id: tenant.id, company_id: companyId, field_key: fieldKey } });
  if (!field) throw new BusinessEngineError("Engine field not found.", 404, "FIELD_NOT_FOUND");
  const updated = await prisma.tenantEngineField.update({
    where: { id: field.id },
    data: { enabled, required: enabled ? required : false, external_field: externalField || null }
  });
  await auditTenantChange({ companyId, actor, action: "engine.field_updated", targetType: "tenant_engine_field", targetId: field.id, metadata: { engineKey, fieldKey, enabled, required, hasExternalMapping: Boolean(externalField) } });
  return updated;
}

async function createCustomField({ companyId, engineKey, fieldKey, label, description, dataType, required, actor }) {
  const tenant = await ensureTenantEngine(companyId, engineKey);
  const key = cleanKey(fieldKey);
  if (!key) throw new BusinessEngineError("Custom field key is required.");
  const maxOrder = await prisma.tenantEngineField.aggregate({ where: { tenant_engine_id: tenant.id }, _max: { display_order: true } });
  let field;
  try {
    field = await prisma.tenantEngineField.create({
      data: {
        company_id: companyId,
        tenant_engine_id: tenant.id,
        field_key: key,
        label,
        description: description || null,
        data_type: dataType,
        enabled: true,
        required,
        is_custom: true,
        display_order: Number(maxOrder._max.display_order || 0) + 1
      }
    });
  } catch (error) {
    if (error?.code === "P2002") throw new BusinessEngineError("That field key already exists.", 409, "DUPLICATE_FIELD");
    throw error;
  }
  await auditTenantChange({ companyId, actor, action: "engine.custom_field_created", targetType: "tenant_engine_field", targetId: field.id, metadata: { engineKey, fieldKey: key, dataType, required } });
  return field;
}

async function updateTenantOperation({ companyId, engineKey, operationKey, enabled, policy, fallbackPolicy, actionId, fieldMapping, actor }) {
  const tenant = await ensureTenantEngine(companyId, engineKey);
  const operation = await prisma.tenantEngineOperation.findFirst({
    where: { company_id: companyId, tenant_engine_id: tenant.id, definition: { operation_key: operationKey } },
    include: { definition: true, mapping: true }
  });
  if (!operation) throw new BusinessEngineError("Engine operation not found.", 404, "OPERATION_NOT_FOUND");
  assertPolicyAllowed(policy, operation.definition.minimum_policy);
  if (!FALLBACK_POLICIES.includes(fallbackPolicy)) throw new BusinessEngineError("Choose a valid fallback policy.");
  let action = null;
  if (actionId) {
    action = await prisma.integrationAction.findFirst({ where: { id: actionId, company_id: companyId }, include: { connection: true } });
    if (!action) throw new BusinessEngineError("Connector action not found for this tenant.", 404, "ACTION_NOT_FOUND");
  }
  const oldActionId = operation.mapping?.integration_action_id || null;
  await prisma.$transaction(async (tx) => {
    await tx.tenantEngineOperation.update({ where: { id: operation.id }, data: { enabled, policy, fallback_policy: fallbackPolicy } });
    if (action) {
      await tx.engineOperationMapping.upsert({
        where: { tenant_engine_operation_id: operation.id },
        create: { company_id: companyId, tenant_engine_operation_id: operation.id, integration_action_id: action.id, field_mapping: fieldMapping || {}, status: "mapped" },
        update: { integration_action_id: action.id, field_mapping: fieldMapping || {}, status: "mapped" }
      });
      await tx.integrationAction.update({ where: { id: action.id }, data: { enabled: true } });
      await tx.integrationConnection.update({ where: { id: action.connection_id }, data: { status: "active" } });
    } else if (operation.mapping) {
      await tx.engineOperationMapping.delete({ where: { id: operation.mapping.id } });
    }
    if (oldActionId && oldActionId !== action?.id) {
      const remaining = await tx.engineOperationMapping.count({ where: { integration_action_id: oldActionId } });
      if (!remaining) await tx.integrationAction.update({ where: { id: oldActionId }, data: { enabled: false } });
    }
  });
  await auditTenantChange({
    companyId, actor, action: "engine.operation_updated", targetType: "tenant_engine_operation", targetId: operation.id,
    metadata: { engineKey, operationKey, enabled, policy, fallbackPolicy, mapped: Boolean(actionId), mappedActionId: actionId || null, mappedFields: Object.keys(fieldMapping || {}) }
  });
  return { ok: true };
}

async function testEngineConnections({ companyId, engineKey }) {
  const tenant = await ensureTenantEngine(companyId, engineKey);
  const operations = await prisma.tenantEngineOperation.findMany({
    where: { company_id: companyId, tenant_engine_id: tenant.id, mapping: { isNot: null } },
    include: { mapping: { include: { integration_action: true } } }
  });
  const connectionIds = [...new Set(operations.map((operation) => operation.mapping?.integration_action?.connection_id).filter(Boolean))];
  if (!connectionIds.length) return { status: "configuration_error", message: "Map at least one operation before testing this engine.", results: [] };
  const results = [];
  for (const connectionId of connectionIds) results.push({ connectionId, ...(await testConnection({ companyId, connectionId })) });
  const passed = results.every((result) => result.status === "passed");
  return { status: passed ? "connected" : "failed", message: passed ? "All mapped systems responded." : "One or more mapped systems could not be verified.", results };
}

function toolSchemaForOperation(operation, fields) {
  const properties = {};
  for (const field of fields.filter((item) => item.enabled)) {
    const schema = { type: field.data_type === "number" ? "number" : field.data_type === "boolean" ? "boolean" : "string" };
    if (field.description) schema.description = field.description;
    properties[field.field_key] = schema;
  }
  const requiredByOperation = Array.isArray(operation.definition.required_fields) ? operation.definition.required_fields : [];
  const required = [...new Set([
    ...requiredByOperation,
    ...fields.filter((field) => field.enabled && field.required).map((field) => field.field_key)
  ])].filter((key) => properties[key]);
  if (operation.policy === "customer_confirmation") {
    properties._confirmation_id = { type: "string", description: "Use only after the customer explicitly confirms on a later turn." };
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function blueprintToolDescription(operation, action, isWrite) {
  const purpose = `${operation.definition.name}: ${String(action.description || action.display_name || operation.definition.description).replace(/[.\s]+$/, "")}`;
  let flow;
  if (!isWrite) flow = "Runs immediately and returns facts from the company system. Use the returned ids (numbers) in later calls.";
  else if (operation.policy === "customer_confirmation") flow = "Send the details you already have; values are saved between messages. If the result says needs_information, ask the customer only for the item in next. When complete, the result is awaiting_customer_confirmation with a summary: present it and ask the customer to confirm. After the customer confirms in a later message, call again with only _confirmation_id. Give the customer the reference returned when executed.";
  else if (operation.policy === "staff_approval") flow = "Send the details you have; missing items are listed in the result. When complete it is queued for staff approval, not completed.";
  else flow = "Send the details you have; missing items are listed in the result. When complete it runs and returns the reference.";
  return `${purpose}. ${flow}`.slice(0, 1200);
}

/**
 * Email the tenant notify list (comma separated) and the platform admin when a
 * Business Engine write is saved or queued. Never blocks or fails the reply.
 */
async function notifyEngineOutcome({ companyId, conversationId, operation, outcome, reference, details, reason, requestId = null }) {
  try {
    const [settings, company, conversation] = await Promise.all([
      prisma.companySetting.findUnique({ where: { company_id: companyId } }),
      prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
      conversationId ? prisma.conversation.findUnique({ where: { id: conversationId }, select: { customer_name: true } }).catch(() => null) : null
    ]);
    const { alertAudiences } = require("./notify");
    const { tenant, platform } = alertAudiences(settings);
    const mapping = await prisma.engineOperationMapping.findUnique({
      where: { tenant_engine_operation_id: operation.id },
      include: { integration_action: { include: { connection: { select: { name: true } } } } }
    }).catch(() => null);
    const plain = (key) => { const value = details?.[key]; return value && typeof value === "object" && "value" in value ? value.value : value; };
    const base = {
      systemName: mapping?.integration_action?.connection?.name || "",
      contact: { phone: plain("callerphone") || plain("phone") || "", email: plain("calleremail") || plain("email") || "" },
      companyName: company?.name || "your business",
      operationName: operation.definition.name,
      outcome,
      reference,
      details,
      reason,
      customerName: conversation?.customer_name || null,
      requestId
    };
    for (const t of tenant) await notifyEngineRequest({ ...base, to: t.email, audience: "tenant" });
    for (const email of platform) {
      if (tenant.some((t) => t.email.toLowerCase() === email.toLowerCase())) continue;
      await notifyEngineRequest({ ...base, to: email, audience: "platform", tenantRecipients: tenant.map((t) => t.label) });
    }
  } catch (error) {
    console.error("[engine] notification failed company=%s: %s", companyId, error.message);
  }
}

/**
 * Never fail silently: when Closer cannot finish a request, the tenant notify
 * list and the platform admin get the reason and everything collected so far.
 * Deduplicated per request + reason so a retry loop sends one email.
 */
const failureNotified = new Map();
async function notifyEngineFailure({ companyId, conversationId, operation, reason, details, dedupeKey, requestId = null, force = false }) {
  const key = `${companyId}:${operation.id}:${dedupeKey || conversationId || ""}:${String(reason).slice(0, 120)}`;
  const last = failureNotified.get(key);
  if (!force && last && Date.now() - last < 6 * 60 * 60 * 1000) return true;
  failureNotified.set(key, Date.now());
  if (failureNotified.size > 2000) failureNotified.delete(failureNotified.keys().next().value);
  console.warn("[engine] request blocked company=%s op=%s reason=%s", companyId, operation.definition?.operation_key, reason);
  await notifyEngineOutcome({ companyId, conversationId, operation, outcome: "failed", reference: null, details: details || {}, reason, requestId });
  return true;
}

/**
 * Cases (src/cases.js): a blocked request becomes THE open case for its need. An older open
 * case for the same need is replaced (closed as "replaced", history moved here) so there is
 * never more than one; staff are alerted at most once per 15 minutes per case.
 */
async function recordBlockedCase({ companyId, conversationId, operation, rowId, args, blueprint, reason, alreadyOpen = false }) {
  const cases = require("./cases");
  try {
    const needKey = cases.needKeyFor(operation.id, operation.mapping?.workflow_config, args);
    await prisma.businessOperationRequest.update({ where: { id: rowId }, data: { ...(needKey ? { need_key: needKey } : {}), case_status: "waiting" } });
    let caseId = rowId;
    let note = "";
    if (!alreadyOpen && needKey) {
      const open = await cases.findOpenCase({ companyId, needKey, excludeId: rowId });
      if (open) {
        // Never close the older case: add this attempt to it (one case per need).
        await cases.mergeIntoCase({ companyId, conversationId, openRow: open, newRowId: rowId, addition: String(args.description || "same request again"), actor: "Closer" });
        caseId = open.id;
        note = ` — Added to the open request ${open.reference || cases.shortCode(open.id)} (same need, waiting since ${cases.caseStartedAt(open).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}).`;
      }
    }
    const row = await prisma.businessOperationRequest.findUnique({ where: { id: caseId }, select: { last_alert_at: true } });
    if (!cases.alertDue(row)) {
      await cases.addHistory(caseId, { type: "alert_suppressed", reason: String(reason).slice(0, 300) });
      console.log("[cases] alert held for %s (15-minute limit)", cases.shortCode(caseId));
      return;
    }
    await notifyEngineFailure({ companyId, conversationId, operation, reason: `${reason}${note}`, details: labelArguments(args, blueprint), dedupeKey: caseId, requestId: caseId, force: true });
    await cases.markAlerted(caseId);
  } catch (error) {
    console.error("[cases] record blocked failed request=%s: %s", rowId, error.message);
    await notifyEngineFailure({ companyId, conversationId, operation, reason, details: labelArguments(args, blueprint), dedupeKey: rowId, requestId: rowId });
  }
}

/** Saved with a reference: every other open case for the same need closes with that reference. */
async function afterCaseSaved({ companyId, conversationId, operation, rowId, args, reference }) {
  const cases = require("./cases");
  try {
    const needKey = cases.needKeyFor(operation.id, operation.mapping?.workflow_config, args);
    if (!needKey) { await prisma.businessOperationRequest.update({ where: { id: rowId }, data: { case_status: "ticket_open", reference: reference ? String(reference) : null } }).catch(() => {}); return; }
    await prisma.businessOperationRequest.update({ where: { id: rowId }, data: { need_key: needKey, case_status: "ticket_open", reference: reference ? String(reference) : null } });
    await require("./resolve-loop").closeSameNeed({ companyId, needKey, keepId: rowId, reference, keepConversationId: conversationId, actorEmail: "closer", actorName: "Closer" });
  } catch (error) {
    console.error("[cases] after save failed request=%s: %s", rowId, error.message);
  }
}

/** Drafts the customer started but never finished (checked every 15 minutes). */
async function sweepStaleEngineDrafts({ olderThanMinutes = 60 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const drafts = await prisma.businessOperationRequest.findMany({
    where: { status: "collecting", updated_at: { lt: cutoff, gt: new Date(Date.now() - DRAFT_MAX_AGE_MS) } },
    include: { tenant_operation: { include: { definition: true, mapping: { include: { integration_action: true } } } } },
    take: 50
  });
  let notified = 0;
  for (const draft of drafts) {
    if (draft.result && draft.result.stale_notified) continue;
    const operation = draft.tenant_operation;
    const action = operation?.mapping?.integration_action;
    const blueprint = action ? normalizeBlueprint(operation.mapping.workflow_config, action) : null;
    const collected = draft.requested_arguments || {};
    const missing = action ? missingFields(action, blueprint, collected) : [];
    // The customer simply stopped replying: not a system problem, so no ACTION NEEDED email
    // (2026-10-20). It is listed in the daily briefing as "Incomplete — customer stopped replying".
    await prisma.businessOperationRequest.update({ where: { id: draft.id }, data: { result: { ...(draft.result || {}), stale_notified: new Date().toISOString(), stale_missing: missing } } });
    console.log("[engine] incomplete request %s (customer stopped replying; missing: %s) -> daily report", draft.id.slice(0, 8), missing.join(", ") || "confirmation");
    notified += 1;
  }
  return { checked: drafts.length, notified };
}

function notificationDetails(outcome, summary) {
  const facts = outcome?.facts && typeof outcome.facts === "object" && !Array.isArray(outcome.facts) ? outcome.facts : {};
  return { ...facts, ...(Object.keys(facts).length ? {} : summary || {}) };
}

async function historyStart(conversationId) {
  if (!conversationId) return new Date(0);
  const row = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { ai_history_from: true } }).catch(() => null);
  return row?.ai_history_from ? new Date(row.ai_history_from) : new Date(0);
}

/**
 * Customer memory per Messenger conversation (2026-10-19). Remembers who the
 * customer is (name, number, company, branch, machines) across requests, never
 * the requests themselves. After a request is finished (saved, or handed to
 * staff) the conversation history Closer sees starts fresh.
 */
async function loadProfile(conversationId) {
  if (!conversationId) return {};
  const row = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { customer_profile: true } }).catch(() => null);
  return row?.customer_profile && typeof row.customer_profile === "object" ? row.customer_profile : {};
}

async function rememberCustomerAndReset({ companyId, conversationId, blueprint, args }) {
  if (!conversationId) return;
  try {
    const profile = await loadProfile(conversationId);
    const known = { ...(profile.known || {}) };
    for (const key of blueprint.remember) if (args[key] !== undefined && args[key] !== null && args[key] !== "") known[key] = args[key];
    // Names for the ids, from this conversation's lookups (facts only).
    const lookups = await prisma.businessOperationRequest.findMany({
      where: { company_id: companyId, conversation_id: conversationId, status: "succeeded" },
      orderBy: { updated_at: "desc" },
      take: 10,
      select: { result: true }
    });
    let machine = null;
    for (const row of lookups) {
      const facts = row.result?.data?.facts || row.result?.data || {};
      const list = Array.isArray(facts.machines) ? facts.machines : Array.isArray(facts) ? facts : [];
      machine = list.find((item) => item && String(item.id || item.machineId) === String(args.machineid)) || null;
      if (machine) break;
    }
    const machines = Array.isArray(profile.machines) ? profile.machines.filter((item) => String(item.machine_id) !== String(args.machineid)) : [];
    if (args.machineid) {
      machines.unshift({
        machine_id: args.machineid,
        serial: machine?.serialNumber || machine?.serial || machine?.displaySerial || null,
        model: machine?.model || machine?.machineModel || null,
        customer_id: args.customerid ?? null,
        company: machine?.customerName || machine?.companyName || null,
        branch_id: args.branchid ?? null,
        branch: machine?.branchName || null
      });
    }
    const next = { ...profile, known, machines: machines.slice(0, 5), updated_at: new Date().toISOString() };
    if (profile.consent === "no") {
      // The customer asked not to be remembered: keep nothing after this request (email keeps its own address).
      const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { channel: true } }).catch(() => null);
      next.known = conv?.channel === "email" && profile.known?.calleremail ? { calleremail: profile.known.calleremail } : {};
      next.machines = [];
      delete next.last_identified;
    }
    await prisma.conversation.update({ where: { id: conversationId }, data: { customer_profile: next, ai_history_from: new Date() } });
    if (next.consent !== "no") await require("./contacts").syncFromConversation(companyId, conversationId);
  } catch (error) {
    console.error("[engine] remember/reset failed conversation=%s: %s", conversationId, error.message);
  }
}

/** Customer ids identified in this conversation (by serial lookup, customer
 * record or a remembered machine). Used to keep lookups to that customer. */
async function identifiedCustomerIds(companyId, conversationId) {
  const ids = new Set();
  if (!conversationId) return ids;
  const profile = await loadProfile(conversationId);
  for (const machine of profile.machines || []) if (machine.customer_id != null) ids.add(String(machine.customer_id));
  const rows = await prisma.businessOperationRequest.findMany({
    where: { company_id: companyId, conversation_id: conversationId, status: "succeeded", tenant_operation: { definition: { operation_key: { in: ["find_machine", "get_customer", "list_customer_machines"] } } } },
    select: { result: true, requested_arguments: true, tenant_operation: { select: { definition: { select: { operation_key: true } } } } },
    take: 20,
    orderBy: { updated_at: "desc" }
  });
  for (const row of rows) {
    const facts = row.result?.data?.facts || {};
    const key = row.tenant_operation.definition.operation_key;
    if (key === "find_machine") for (const machine of facts.machines || []) if (machine.customerId != null) ids.add(String(machine.customerId));
    if (key === "get_customer" && (facts.customer?.id ?? facts.id) != null) ids.add(String(facts.customer?.id ?? facts.id));
    if (key === "list_customer_machines" && row.requested_arguments?.customerid != null) ids.add(String(row.requested_arguments.customerid));
  }
  return ids;
}

async function findDraft(companyId, conversationId, operationId) {
  if (!conversationId) return null;
  return prisma.businessOperationRequest.findFirst({
    where: {
      company_id: companyId,
      conversation_id: conversationId,
      tenant_engine_operation_id: operationId,
      status: { in: DRAFT_STATUSES },
      updated_at: { gt: new Date(Date.now() - DRAFT_MAX_AGE_MS) },
      created_at: { gte: await historyStart(conversationId) }
    },
    orderBy: { updated_at: "desc" }
  });
}

/**
 * Tool results are not part of the stored chat history, so without this the
 * model forgets on the next customer message the ids a lookup already
 * returned (and asks again, or sends 0). Facts only, bounded in size.
 */
async function loadRecentLookups(companyId, conversationId) {
  const rows = await prisma.businessOperationRequest.findMany({
    where: { company_id: companyId, conversation_id: conversationId, status: "succeeded", updated_at: { gt: new Date(Date.now() - DRAFT_MAX_AGE_MS) }, created_at: { gte: await historyStart(conversationId) } },
    include: { tenant_operation: { include: { definition: true, tenant_engine: { include: { engine: true } } } } },
    orderBy: { updated_at: "desc" },
    take: 4
  });
  return rows.map((row) => {
    const data = row.result?.data && typeof row.result.data === "object" ? row.result.data : row.result || {};
    let facts = data.facts !== undefined ? data.facts : data;
    let text = JSON.stringify(facts);
    if (text && text.length > 1800) facts = `${text.slice(0, 1800)}…`;
    return {
      operation: `${row.tenant_operation.tenant_engine.engine.key}.${row.tenant_operation.definition.operation_key}`,
      arguments: row.requested_arguments,
      facts,
      at: row.updated_at
    };
  }).reverse();
}

async function loadDraftFacts(companyId, conversationId, rows) {
  const drafts = await prisma.businessOperationRequest.findMany({
    where: { company_id: companyId, conversation_id: conversationId, status: "collecting", updated_at: { gt: new Date(Date.now() - DRAFT_MAX_AGE_MS) }, created_at: { gte: await historyStart(conversationId) } },
    orderBy: { updated_at: "desc" },
    take: 5
  });
  const operations = rows.flatMap((row) => row.operations.map((operation) => ({ row, operation })));
  return drafts.map((draft) => {
    const hit = operations.find((item) => item.operation.id === draft.tenant_engine_operation_id);
    if (!hit?.operation.mapping?.integration_action) return null;
    const action = hit.operation.mapping.integration_action;
    const blueprint = normalizeBlueprint(hit.operation.mapping.workflow_config, action);
    const collected = draft.requested_arguments || {};
    return {
      operation: `${hit.row.engine.key}.${hit.operation.definition.operation_key}`,
      tool: logicalToolName(hit.row.engine.key, hit.operation.definition.operation_key),
      collected: labelArguments(collected, blueprint),
      missing: missingFields(action, blueprint, collected)
    };
  }).filter(Boolean);
}

async function loadBusinessEngineRuntime(companyId, conversationId = null) {
  const rows = await loadTenantEngineRows(companyId, true);
  const tools = [];
  const capabilities = [];
  const unavailable = [];
  const fallbackKeys = [];
  const instructionBlocks = [];
  for (const row of rows) {
    if (row.instruction_enabled) {
      instructionBlocks.push(`--- ${row.engine.name} Engine ---\n${effectiveEngineInstruction(row)}`);
    }
    for (const operation of row.operations.filter((item) => item.enabled)) {
      const key = `${row.engine.key}.${operation.definition.operation_key}`;
      const mapped = operation.mapping?.status === "mapped"
        && operation.mapping.integration_action?.enabled
        && operation.mapping.integration_action?.connection?.status === "active";
      if (mapped && operation.policy !== "staff_only") {
        const toolName = logicalToolName(row.engine.key, operation.definition.operation_key);
        const action = operation.mapping.integration_action;
        const blueprint = normalizeBlueprint(operation.mapping.workflow_config, action);
        const isWrite = !READ_HTTP_METHODS.has(action.http_method);
        tools.push({
          name: toolName,
          description: blueprintToolDescription(operation, action, isWrite),
          parameters: buildBlueprintToolSchema(action, blueprint, { confirmation: isWrite && operation.policy === "customer_confirmation" })
        });
        capabilities.push({ key, toolName, policy: operation.policy, type: operation.definition.operation_type });
      } else {
        unavailable.push({ key, reason: operation.policy === "staff_only" ? "staff_only" : "not_mapped", fallback: operation.fallback_policy });
        fallbackKeys.push(key);
      }
    }
  }
  if (fallbackKeys.length) {
    tools.push({
      name: "engine_request_human_help",
      description: "Use when the customer requests an enabled Business Engine operation that is unavailable or staff-only. This records the missing capability and creates the configured human-review request; it never calls an arbitrary API.",
      parameters: {
        type: "object",
        properties: {
          operation_key: { type: "string", enum: fallbackKeys, description: "The exact unavailable capability requested by the customer." },
          summary: { type: "string", description: "A concise factual summary for staff. Do not include passwords, tokens, or payment card data." }
        },
        required: ["operation_key", "summary"],
        additionalProperties: false
      }
    });
  }
  const drafts = conversationId ? await loadDraftFacts(companyId, conversationId, rows) : [];
  const recentLookups = conversationId ? await loadRecentLookups(companyId, conversationId) : [];
  const pending = conversationId ? await prisma.businessOperationRequest.findMany({
    where: { company_id: companyId, conversation_id: conversationId, status: { in: ["pending_customer_confirmation", "pending_staff_approval"] }, created_at: { gte: await historyStart(conversationId) } },
    include: { tenant_operation: { include: { definition: true, tenant_engine: { include: { engine: true } } } } },
    orderBy: { created_at: "desc" },
    take: 10
  }) : [];
  return {
    instructions: instructionBlocks.join("\n\n"),
    tools,
    manifest: {
      enabled_engines: rows.map((row) => row.engine.key),
      capabilities,
      unavailable_capabilities: unavailable,
      requests_in_progress: drafts,
      recent_lookup_results: recentLookups,
      pending_requests: pending.map((request) => ({
        id: request.integration_execution_id || request.id,
        status: request.status,
        operation: `${request.tenant_operation.tenant_engine.engine.key}.${request.tenant_operation.definition.operation_key}`,
        arguments: request.requested_arguments
      }))
    }
  };
}

function mapLogicalArguments(operation, args) {
  const mapping = operation.mapping?.field_mapping && typeof operation.mapping.field_mapping === "object"
    ? operation.mapping.field_mapping : {};
  const fieldDefaults = Object.fromEntries(operation.tenant_engine.fields.filter((field) => field.external_field).map((field) => [field.field_key, field.external_field]));
  const output = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (key === "_confirmation_id") output[key] = value;
    else output[mapping[key] || fieldDefaults[key] || key] = value;
  }
  return output;
}

async function executeBusinessEngineTool({ companyId, conversationId, name, args, turnStartedAt, requestedBy = "closer" }) {
  if (name === "engine_request_human_help") {
    const [engineKey, operationKey] = String(args?.operation_key || "").split(".");
    const operation = await prisma.tenantEngineOperation.findFirst({
      where: { company_id: companyId, enabled: true, tenant_engine: { enabled: true, engine: { key: engineKey } }, definition: { operation_key: operationKey } },
      include: { definition: true, mapping: true }
    });
    if (!operation || operation.company_id !== companyId || (operation.mapping && operation.policy !== "staff_only")) return { ok: false, executed: false, error: "capability_not_missing" };
    const context = { summary: String(args?.summary || "").slice(0, 2000) };
    const pending = operation.fallback_policy !== "log_missing_capability";
    const request = await prisma.businessOperationRequest.create({
      data: {
        company_id: companyId,
        tenant_engine_operation_id: operation.id,
        conversation_id: conversationId || null,
        status: pending ? "pending_staff" : "logged",
        policy: operation.policy,
        requested_arguments: context,
        fallback_used: operation.fallback_policy,
        requested_by: requestedBy
      }
    });
    await prisma.capabilityGap.upsert({
      where: { tenant_engine_operation_id: operation.id },
      create: { company_id: companyId, tenant_engine_operation_id: operation.id, operation_key: `${engineKey}.${operationKey}`, last_request_context: context, fallback_used: operation.fallback_policy },
      update: { frequency_count: { increment: 1 }, last_request_context: context, fallback_used: operation.fallback_policy, last_seen_at: new Date() }
    });
    return { ok: true, executed: false, submitted_for_review: pending, request_id: request.id, fallback: operation.fallback_policy };
  }

  const operations = await prisma.tenantEngineOperation.findMany({
    where: { company_id: companyId, enabled: true, tenant_engine: { enabled: true } },
    include: {
      definition: true,
      tenant_engine: { include: { engine: true, fields: true } },
      mapping: { include: { integration_action: { include: { connection: true } } } }
    }
  });
  const operation = operations.find((item) => logicalToolName(item.tenant_engine.engine.key, item.definition.operation_key) === name);
  if (!operation || operation.company_id !== companyId || operation.policy === "staff_only" || !operation.mapping?.integration_action) {
    return { ok: false, executed: false, error: "tool_not_available" };
  }
  const action = operation.mapping.integration_action;
  if (action.connection?.status !== "active" || !action.enabled) {
    const reason = `The connected app action "${action.display_name}" is ${!action.enabled ? "disabled" : `on a connection that is ${action.connection?.status || "missing"}`}, so Closer could not run ${operation.definition.name}.`;
    await notifyEngineFailure({ companyId, conversationId, operation, reason, details: args || {} });
    return { ok: false, executed: false, error: "tool_not_available", staff_notified: true };
  }
  const blueprint = normalizeBlueprint(operation.mapping.workflow_config, action);
  const fieldDefaults = Object.fromEntries(operation.tenant_engine.fields.filter((field) => field.external_field).map((field) => [field.field_key, field.external_field]));
  const fieldMap = { ...fieldDefaults, ...(operation.mapping.field_mapping && typeof operation.mapping.field_mapping === "object" ? operation.mapping.field_mapping : {}) };
  const logicalKey = `${operation.tenant_engine.engine.key}.${operation.definition.operation_key}`;
  const isWrite = !READ_HTTP_METHODS.has(action.http_method);

  const record = async (status, requestedArguments, result, extra = {}) => prisma.businessOperationRequest.create({
    data: {
      company_id: companyId,
      tenant_engine_operation_id: operation.id,
      conversation_id: conversationId || null,
      status,
      policy: operation.policy,
      requested_arguments: requestedArguments || {},
      result: result || undefined,
      error_message: result && result.ok === false ? String(result.detail || result.error || "Operation failed").slice(0, 1000) : null,
      requested_by: requestedBy,
      completed_at: ["succeeded", "failed"].includes(status) ? new Date() : null,
      ...extra
    }
  });
  const finalize = (result) => {
    const data = result?.data && typeof result.data === "object" ? result.data : {};
    const anchors = extractAnchors(data, blueprint);
    if (!result?.ok) {
      return { ok: false, executed: false, error: "system_rejected", http_status: result?.http_status, detail: data.message || data.code || result?.detail || result?.error || "The company system rejected the request.", logical_operation: logicalKey };
    }
    return { ok: true, executed: true, ...anchors, facts: data.facts !== undefined ? data.facts : data, logical_operation: logicalKey };
  };

  // The customer confirmed "add this to your open request" (one ticket per need).
  if (isWrite && String(args?._confirmation_id || "").startsWith("merge:")) {
    const cases = require("./cases");
    const openId = String(args._confirmation_id).slice(6);
    const openRow = await prisma.businessOperationRequest.findFirst({ where: { id: openId, company_id: companyId, case_status: { in: cases.OPEN_CASE } } });
    const draft = await findDraft(companyId, conversationId, operation.id);
    if (!openRow || !draft) return { ok: false, executed: false, error: "confirmation_not_valid", detail: "The open request changed; prepare it again.", logical_operation: logicalKey };
    const addition = additionText(draft.requested_arguments) || "additional request";
    const merged = await cases.mergeIntoCase({ companyId, conversationId, openRow, newRowId: draft.id, addition, actor: "Closer (customer confirmed)" });
    if (!merged.ok) {
      await notifyEngineFailure({ companyId, conversationId, operation, reason: `Could not add "${addition}" to ${openRow.reference || cases.shortCode(openRow.id)}: ${merged.detail}`, details: labelArguments(draft.requested_arguments || {}, blueprint), dedupeKey: draft.id, requestId: openRow.id, force: true });
      return { ok: false, executed: false, status: "blocked", staff_notified: true, detail: merged.detail, logical_operation: logicalKey };
    }
    if (openRow.case_status === "waiting") {
      // Still waiting for staff: they must see the added item on the same case.
      await recordBlockedCase({ companyId, conversationId, operation, rowId: openRow.id, args: { ...(openRow.requested_arguments || {}), description: merged.description }, blueprint, reason: `Customer added "${addition}" to this waiting request. ${openRow.error_message || ""}`.trim(), alreadyOpen: true });
    } else {
      await notifyEngineOutcome({ companyId, conversationId, operation, outcome: "executed", reference: openRow.reference, details: { Added: addition, "Request now": merged.description } });
    }
    return { ok: true, executed: merged.ticketUpdated, merged: true, status: "merged", reference: openRow.reference || null, waiting: openRow.case_status === "waiting", description: merged.description, logical_operation: logicalKey };
  }

  // Commit a summary the customer confirmed on a later turn.
  if (isWrite && operation.policy === "customer_confirmation" && args?._confirmation_id) {
    let raw = await commitBlueprintConfirmation({ companyId, conversationId, action, confirmationId: args._confirmation_id, turnStartedAt });
    let recovered = false;
    if (raw.error === "confirmation_not_valid") {
      // Already saved in the company system (e.g. the server restarted before the reply went out and the
      // customer's "yes" was replayed): finish the bookkeeping and report it as saved — never as an error.
      const done = await prisma.integrationExecution.findFirst({ where: { id: String(args._confirmation_id), company_id: companyId, status: "succeeded" } });
      if (!done?.result) return { ...raw, logical_operation: logicalKey };
      raw = done.result;
      recovered = true;
      console.log("[business-engines] confirmation %s was already committed; recovering", args._confirmation_id);
    }
    const outcome = finalize(raw);
    const draft = await prisma.businessOperationRequest.findFirst({ where: { company_id: companyId, integration_execution_id: String(args._confirmation_id) } });
    const status = outcome.ok ? "succeeded" : "failed";
    // Staff email AFTER the request is saved here, and without holding up the customer's reply.
    const notifySaved = () => (outcome.ok && !recovered
      ? notifyEngineOutcome({ companyId, conversationId, operation, outcome: "executed", reference: outcome.reference, details: notificationDetails(outcome, labelArguments(draft?.requested_arguments || {}, blueprint)) }).catch((e) => console.error("[business-engines] notify failed: %s", e.message))
      : null);
    if (!outcome.ok) outcome.staff_notified = true;
    const saved = draft
      ? await prisma.businessOperationRequest.update({ where: { id: draft.id }, data: { status, result: raw, error_message: outcome.ok ? null : String(outcome.detail).slice(0, 1000), completed_at: new Date() } })
      : await record(status, {}, raw, { integration_execution_id: String(args._confirmation_id) });
    if (!outcome.ok) await recordBlockedCase({ companyId, conversationId, operation, rowId: saved.id, args: draft?.requested_arguments || {}, blueprint, reason: `The company system refused to save it: ${outcome.detail}` });
    else await afterCaseSaved({ companyId, conversationId, operation, rowId: saved.id, args: draft?.requested_arguments || {}, reference: outcome.reference });
    await rememberCustomerAndReset({ companyId, conversationId, blueprint, args: draft?.requested_arguments || {} });
    notifySaved();
    return { ...outcome, business_request_id: saved.id };
  }

  const prepared = prepareArguments(action, blueprint, args || {}, fieldMap);
  const notes = {};
  if (prepared.ignored.length) notes.ignored_fields = prepared.ignored;
  if (prepared.invalid.length) notes.invalid = prepared.invalid;

  if (!isWrite) {
    let scopeIds = null;
    if (blueprint.customerScope) {
      scopeIds = await identifiedCustomerIds(companyId, conversationId);
      if (!scopeIds.size) {
        return { ok: false, executed: false, status: "needs_information", error: "customer_not_identified", note: "Identify the customer first (machine serial number, or company and department) before looking up their requests. Never look up records for anyone else.", logical_operation: logicalKey };
      }
      const arg = blueprint.customerScope.argument;
      if (arg) prepared.args[arg] = scopeIds.has(String(prepared.args[arg])) ? Number(prepared.args[arg]) : Number([...scopeIds][0]);
    }
    const missing = missingFields(action, { ...blueprint, steps: [] }, prepared.args);
    if (missing.length || prepared.invalid.length) {
      return { ok: false, executed: false, status: "needs_information", missing, next: fieldFacts(action, blueprint, (prepared.invalid[0]?.field) || missing[0]), ...notes, logical_operation: logicalKey };
    }
    const raw = await executeCompanyTool({ companyId, conversationId, name: action.tool_name, args: prepared.args, turnStartedAt, requestedBy, approvalPolicyOverride: operation.policy });
    const outcome = raw.requires_staff_approval
      ? { ok: true, executed: false, requires_staff_approval: true, approval_request_id: raw.approval_request_id, logical_operation: logicalKey }
      : finalize(raw);
    if (scopeIds && outcome.ok) {
      const scoped = scopeResultToCustomers(outcome.facts, blueprint.customerScope.field, scopeIds);
      if (scoped.blocked && (!scoped.data || !Object.keys(scoped.data).length)) {
        console.warn("[engine] blocked lookup of another customer's record op=%s company=%s", logicalKey, companyId);
        return { ok: false, executed: false, error: "not_found", detail: "No matching record for this customer.", logical_operation: logicalKey };
      }
      outcome.facts = scoped.data;
      if (raw.data && typeof raw.data === "object") raw.data.facts = scoped.data; // never store other customers' records
      if (scoped.removed) console.warn("[engine] removed %d record(s) of other customers from %s", scoped.removed, logicalKey);
    }
    // 400 = the customer typed something invalid (e.g. a too-short serial) and 404 = no match: Closer asks again; staff are only alerted for real system problems.
    if (!outcome.ok && ![400, 404].includes(Number(outcome.http_status))) {
      await notifyEngineFailure({ companyId, conversationId, operation, reason: `Lookup failed${outcome.http_status ? ` (HTTP ${outcome.http_status})` : ""}: ${outcome.detail}`, details: prepared.args });
      outcome.staff_notified = true;
    }
    const saved = await record(raw.requires_staff_approval ? "pending_staff_approval" : outcome.ok ? "succeeded" : "failed", prepared.args, raw, raw.approval_request_id ? { integration_execution_id: raw.approval_request_id } : {});
    return { ...outcome, ...notes, business_request_id: saved.id };
  }

  // Writes: accumulate a draft across customer messages.
  const draft = await findDraft(companyId, conversationId, operation.id);
  if (!draft && conversationId && requestedBy !== "director") {
    // Fixed rule (Mike, 2026-10-20): never start a new request while the customer has an open one
    // that was not confirmed as still needed. The Director asks; any other path is stopped here.
    const cases = require("./cases");
    const open = await cases.openCasesForConversation(companyId, conversationId);
    const unconfirmed = open.filter((row) => !(Array.isArray(row.followups) ? row.followups : []).some((f) => f.type === "still_needed" && Date.parse(f.at) > Date.now() - 3600 * 1000));
    if (unconfirmed.length) {
      return { ok: false, executed: false, status: "needs_information", error: "open_request_not_confirmed", open_requests: unconfirmed.map((row) => ({ summary: cases.caseSummary(row), reference: row.reference || null, since: cases.caseStartedAt(row).toISOString() })), note: "This customer still has an open request. Before taking a new one, ask whether that open request is still needed (1 = yes, 2 = no longer needed). Do not start a new request.", logical_operation: logicalKey };
    }
  }
  const previous = draft?.requested_arguments || {};
  // Must-ask fields: accept a value only after the customer was asked for it
  // in an EARLIER turn (or it is a correction of a value already accepted).
  // A model guessing "machine condition = Down" before asking is held.
  const askedAt = { ...((draft?.result && draft.result.asked) || {}) };
  const profileKnown = (await loadProfile(conversationId)).known || {};
  const accepted = { ...prepared.args };
  const held = {};
  // A value the customer WROTE (e.g. name and number in an email signature) is theirs: never ask for it
  // again (2026-10-21: "Details was already provided earlier."). Only guesses are held.
  let customerWords = null;
  const wroteIt = async (value) => {
    const text = String(value ?? "").trim().toLowerCase();
    if (text.length < 3 || /^\d{1,2}$/.test(text)) return false;
    if (customerWords === null) {
      const msgs = conversationId ? await prisma.message.findMany({ where: { conversation_id: conversationId, sender_type: "customer" }, orderBy: { created_at: "desc" }, take: 30, select: { message_text: true } }).catch(() => []) : [];
      customerWords = msgs.map((m) => String(m.message_text || "")).join("\n").toLowerCase();
    }
    const digits = text.replace(/\D/g, "");
    if (digits.length >= 7 && customerWords.replace(/\D/g, " ").split(/\s+/).some((d) => d.endsWith(digits.slice(-7)))) return true;
    return customerWords.includes(text);
  };
  for (const key of Object.keys(accepted)) {
    if (!blueprint.askCustomer.has(key) || previous[key] !== undefined) continue;
    if (profileKnown[key] !== undefined && String(profileKnown[key]).trim().toLowerCase() === String(accepted[key]).trim().toLowerCase()) continue;
    if (["callername", "callerphone", "calleremail"].includes(key) && await wroteIt(accepted[key])) continue;
    const when = askedAt[key] ? new Date(askedAt[key]) : null;
    if (!when || when >= turnStartedAt) {
      held[key] = accepted[key];
      delete accepted[key];
    }
  }
  const merged = applyDerived({ ...previous, ...accepted }, blueprint, action.input_schema);
  const missing = missingFields(action, blueprint, merged);
  for (const key of missing) if (blueprint.askCustomer.has(key) && !askedAt[key]) askedAt[key] = new Date().toISOString();
  const draftState = { asked: askedAt };
  const draftRow = draft
    ? await prisma.businessOperationRequest.update({ where: { id: draft.id }, data: { status: "collecting", requested_arguments: merged, integration_execution_id: null, result: draftState } })
    : await prisma.businessOperationRequest.create({
      data: { company_id: companyId, tenant_engine_operation_id: operation.id, conversation_id: conversationId || null, status: "collecting", policy: operation.policy, requested_arguments: merged, requested_by: requestedBy, result: draftState }
    });
  if (missing.length || prepared.invalid.length) {
    const heldKeys = Object.keys(held);
    return {
      ok: false,
      executed: false,
      status: "needs_information",
      collected: labelArguments(merged, blueprint),
      missing,
      next: fieldFacts(action, blueprint, prepared.invalid[0]?.field || heldKeys.find((key) => missing.includes(key)) || missing[0]),
      ...(heldKeys.length ? {
        not_yet_confirmed: labelArguments(held, blueprint),
        note: "The customer has not stated these yet in this conversation. Ask the customer for them (if they already mentioned one, confirm it in one short question). They are used only after the customer answers."
      } : {}),
      ...notes,
      logical_operation: logicalKey,
      business_request_id: draftRow.id
    };
  }

  if (operation.policy !== "customer_confirmation") {
    const raw = await executeCompanyTool({ companyId, conversationId, name: action.tool_name, args: merged, turnStartedAt, requestedBy, approvalPolicyOverride: operation.policy });
    if (raw.requires_staff_approval) {
      await prisma.businessOperationRequest.update({ where: { id: draftRow.id }, data: { status: "pending_staff_approval", integration_execution_id: raw.approval_request_id, result: raw } });
      await notifyEngineOutcome({ companyId, conversationId, operation, outcome: "staff_approval", reference: null, details: labelArguments(merged, blueprint) });
      return { ok: true, executed: false, requires_staff_approval: true, approval_request_id: raw.approval_request_id, collected: labelArguments(merged, blueprint), ...notes, logical_operation: logicalKey, business_request_id: draftRow.id };
    }
    const outcome = finalize(raw);
    await prisma.businessOperationRequest.update({ where: { id: draftRow.id }, data: { status: outcome.ok ? "succeeded" : "failed", result: raw, completed_at: new Date() } });
    if (outcome.ok) await notifyEngineOutcome({ companyId, conversationId, operation, outcome: "executed", reference: outcome.reference, details: notificationDetails(outcome, labelArguments(merged, blueprint)) });
    if (outcome.ok) await afterCaseSaved({ companyId, conversationId, operation, rowId: draftRow.id, args: merged, reference: outcome.reference });
    return { ...outcome, ...notes, business_request_id: draftRow.id };
  }

  {
    const cases = require("./cases");
    const needKey = cases.needKeyFor(operation.id, operation.mapping?.workflow_config, merged);
    const open = needKey ? await cases.findOpenCase({ companyId, needKey, excludeId: draftRow.id }) : null;
    if (open) {
      await prisma.businessOperationRequest.update({ where: { id: draftRow.id }, data: { need_key: needKey, status: "pending_customer_confirmation" } });
      return {
        ok: true, executed: false, status: "awaiting_customer_confirmation", confirmation_id: `merge:${open.id}`,
        merge_into: { reference: open.reference || null, current: cases.caseSummary(open), since: cases.caseStartedAt(open).toISOString(), waiting_for_staff: open.case_status === "waiting", same_caller: sameCaller(open.requested_arguments || {}, merged) },
        summary: { "Add to the open request": open.reference || "(waiting for schedule)", "Open request": cases.caseSummary(open), "Adding": additionText(merged).slice(0, 200) },
        note: "Same machine and same kind of request as an open one: it is added to that request (one ticket), not a new ticket.",
        logical_operation: logicalKey, business_request_id: draftRow.id
      };
    }
  }

  let preview = null;
  if (blueprint.dryRunField) {
    const dry = await runBlueprintDryRun({ companyId, conversationId, action, args: merged, dryRunField: blueprint.dryRunField, requestedBy });
    if (!dry.ok) {
      const rejected = finalize(dry);
      const status = Number(rejected.http_status);
      // 400 = a detail the customer/AI can correct; anything else (409 setup
      // problems such as no staff for the area, auth, outages) needs staff.
      if (status !== 400) {
        await prisma.businessOperationRequest.update({ where: { id: draftRow.id }, data: { status: "failed", error_message: String(rejected.detail).slice(0, 1000), result: dry, completed_at: new Date() } });
        await recordBlockedCase({ companyId, conversationId, operation, rowId: draftRow.id, args: merged, blueprint, reason: `The company system rejected the request${status ? ` (HTTP ${status})` : ""}: ${rejected.detail}` });
        await rememberCustomerAndReset({ companyId, conversationId, blueprint, args: merged });
        return { ...rejected, status: "blocked", staff_notified: true, collected: labelArguments(merged, blueprint), note: "This cannot be completed automatically. Staff have been notified with all the details; tell the customer the team will contact them. Do not give a reference number.", ...notes, business_request_id: draftRow.id };
      }
      return { ...rejected, status: "needs_information", collected: labelArguments(merged, blueprint), note: "The company system checked these details and rejected them. Correct the detail it names, then send it again.", ...notes, business_request_id: draftRow.id };
    }
    preview = dry.data && typeof dry.data === "object" && dry.data.facts !== undefined ? dry.data.facts : dry.data;
  }
  const pending = await prepareBlueprintConfirmation({ companyId, conversationId, action, args: merged, idempotencyField: blueprint.idempotencyField, requestedBy });
  await prisma.businessOperationRequest.update({ where: { id: draftRow.id }, data: { status: "pending_customer_confirmation", integration_execution_id: pending.id } });
  return {
    ok: true,
    executed: false,
    status: "awaiting_customer_confirmation",
    confirmation_id: pending.id,
    summary: labelArguments(merged, blueprint),
    system_check: preview,
    ...notes,
    logical_operation: logicalKey,
    business_request_id: draftRow.id
  };
}

/** Admin: save the tenant blueprint for one mapped operation. */
async function updateOperationBlueprint({ companyId, engineKey, operationKey, workflowConfig, actor }) {
  const tenant = await ensureTenantEngine(companyId, engineKey);
  const operation = await prisma.tenantEngineOperation.findFirst({
    where: { company_id: companyId, tenant_engine_id: tenant.id, definition: { operation_key: operationKey } },
    include: { mapping: { include: { integration_action: true } } }
  });
  if (!operation) throw new BusinessEngineError("Engine operation not found.", 404, "OPERATION_NOT_FOUND");
  if (!operation.mapping?.integration_action) throw new BusinessEngineError("Map this operation to a connected app action before adding a blueprint.");
  try {
    validateWorkflowConfig(workflowConfig, operation.mapping.integration_action);
  } catch (error) {
    throw new BusinessEngineError(error.message);
  }
  await prisma.engineOperationMapping.update({ where: { id: operation.mapping.id }, data: { workflow_config: workflowConfig } });
  await auditTenantChange({
    companyId, actor, action: "engine.blueprint_updated", targetType: "engine_operation_mapping", targetId: operation.mapping.id,
    metadata: { engineKey, operationKey, previous: operation.mapping.workflow_config || {}, next: workflowConfig }
  });
  const blueprint = normalizeBlueprint(workflowConfig, operation.mapping.integration_action);
  return { ok: true, warnings: blueprintWarnings(operation.mapping.integration_action, blueprint) };
}

async function approveBusinessOperation({ companyId, requestId, actor }) {
  const request = await prisma.businessOperationRequest.findFirst({ where: { id: requestId, company_id: companyId, status: "pending_staff_approval" } });
  if (!request?.integration_execution_id) throw new BusinessEngineError("Pending engine approval was not found.", 404, "REQUEST_NOT_FOUND");
  const result = await approveExecution({ companyId, executionId: request.integration_execution_id, actorEmail: actor?.email });
  const status = result.ok ? "succeeded" : "failed";
  await prisma.businessOperationRequest.update({
    where: { id: request.id },
    data: { status, result, error_message: result.ok ? null : String(result.detail || result.error || "Operation failed").slice(0, 1000), approved_by: actor?.email || null, approved_at: new Date(), completed_at: new Date() }
  });
  await auditTenantChange({ companyId, actor, action: "engine.operation_approved", targetType: "business_operation_request", targetId: request.id, metadata: { status } });
  return result;
}

/** What is being added to an open request: exact supply items first (e.g. "3 pc Yellow Ink"), then the customer's words. */
function additionText(args) {
  const items = Array.isArray(args?.releaseitems) ? args.releaseitems.filter((i) => i && i.item && i.quantity).map((i) => `${i.quantity} ${i.unit || "pc"} ${i.item}`) : [];
  const text = String(args?.description || "").trim();
  return items.length ? `${items.join("; ")}${text ? ` (customer: "${text}")` : ""}` : text;
}

/** The open request was made by the same person (email, phone or first name match). */
function sameCaller(a = {}, b = {}) {
  const norm = (v) => String(v || "").trim().toLowerCase();
  const tail = (v) => String(v || "").replace(/\D/g, "").slice(-7);
  if (norm(a.calleremail) && norm(a.calleremail) === norm(b.calleremail)) return true;
  if (tail(a.callerphone).length === 7 && tail(a.callerphone) === tail(b.callerphone)) return true;
  const first = (v) => norm(v).split(/\s+/)[0] || "";
  return Boolean(first(a.callername) && first(a.callername).length >= 3 && first(a.callername) === first(b.callername));
}

module.exports = {
  notifyEngineFailure,
  notifyEngineOutcome,
  historyStart,
  loadProfile,
  sweepStaleEngineDrafts,
  updateOperationBlueprint,
  blueprintToolDescription,
  POLICIES,
  FALLBACK_POLICIES,
  BusinessEngineError,
  ensureBusinessEngineCatalog,
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
  loadBusinessEngineRuntime,
  executeBusinessEngineTool,
  approveBusinessOperation,
  logicalToolName,
  engineInstructionKey,
  effectiveEngineInstruction,
  safeAuditMetadata,
  assertPolicyAllowed,
  toolSchemaForOperation,
  mapLogicalArguments
};
