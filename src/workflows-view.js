/**
 * Plain-language view of each Director workflow, for business owners who are
 * not technical (Settings › Business Engines › "How your AI employee handles
 * requests"). Everything is generated from the tenant's configuration, so it
 * always matches what the Director actually does.
 */
const { prisma } = require("./db");
const { normalizeBlueprint, blueprintWarnings, labelArguments } = require("./engine-blueprint");
const cases = require("./cases");

/** Open cases (one per customer need) for staff: who, what, how long waiting, follow-ups, why. */
async function openCasesFor(companyId, op, blueprint) {
  const rows = await prisma.businessOperationRequest.findMany({
    where: { company_id: companyId, tenant_engine_operation_id: op.id, case_status: { in: cases.OPEN_CASE } },
    orderBy: { updated_at: "desc" }, take: 40
  });
  const convIds = [...new Set(rows.map((r) => r.conversation_id).filter(Boolean))];
  const convs = new Map((await prisma.conversation.findMany({ where: { id: { in: convIds } }, select: { id: true, customer_name: true, channel: true, external_id: true } })).map((c) => [c.id, c]));
  return rows.map((row) => {
    const args = row.requested_arguments || {};
    const labelled = labelArguments(args, blueprint);
    const plain = (v) => (v && typeof v === "object" && "label" in v ? v.label : v);
    const conv = convs.get(row.conversation_id);
    const started = cases.caseStartedAt(row);
    return {
      id: row.id,
      code: cases.shortCode(row.id),
      customer: conv?.customer_name || plain(args.callername) || conv?.external_id || "Customer",
      channel: conv ? (conv.channel === "email" ? "Email" : "Messenger") : "no conversation (test or deleted)",
      need: [plain(labelled.category || args.category), plain(args.description)].filter(Boolean).join(" — ").slice(0, 160),
      waitingMinutes: Math.round((Date.now() - started.getTime()) / 60000),
      followups: cases.followupCount(row),
      problem: String(row.error_message || "").replace(/^.*?:\s*/, "").slice(0, 200),
      lastAlertAt: row.last_alert_at,
      status: row.status,
      caseStatus: row.case_status,
      reference: row.reference || null
    };
  });
}

/** Staff actions from the Open cases list (tenant admin, logged in). */
async function caseAction({ companyId, requestId, action, reference, note, actor }) {
  const row = await prisma.businessOperationRequest.findFirst({ where: { id: requestId, company_id: companyId } });
  if (!row) { const error = new Error("Case not found."); error.statusCode = 404; throw error; }
  const email = String(actor?.email || "admin").toLowerCase();
  if (action === "close") {
    if (row.case_status === "ticket_open") return require("./resolve-loop").performAction({ requestId: row.id, action: "cancel", reference: note, actorEmail: email, via: "admin", trusted: true });
    await prisma.businessOperationRequest.update({ where: { id: row.id }, data: { status: "closed", case_status: "closed", closed_at: new Date(), completed_at: new Date(), error_message: `Closed by ${email}${note ? `: ${note}` : ""}`.slice(0, 1000) } });
    await cases.addHistory(row.id, { type: "closed", by: email, note: String(note || "").slice(0, 300) });
    if (row.conversation_id) {
      const conv = await prisma.conversation.findUnique({ where: { id: row.conversation_id }, select: { customer_profile: true } });
      const profile = conv?.customer_profile || {};
      if (profile.last_request && (!profile.last_request.request_id || profile.last_request.request_id === row.id) && !profile.last_request.reference) {
        await prisma.conversation.update({ where: { id: row.conversation_id }, data: { customer_profile: { ...profile, last_request: { ...profile.last_request, request_id: row.id, closed_at: new Date().toISOString(), closed_by: email } } } });
      }
    }
    return { outcome: "closed", message: "Case closed. Closer will not alert about it again." };
  }
  return require("./resolve-loop").performAction({ requestId: row.id, action, reference: action === "manual" ? reference : (note || reference), actorEmail: email, via: "admin", trusted: true });
}

function plainLabel(key, schema, blueprint) {
  const note = blueprint.fieldNotes[key];
  const description = String(schema?.description || "");
  const first = (text) => String(text || "").split(/[.:;]/)[0].trim();
  const candidate = first(description) || first(note);
  if (candidate && candidate.length <= 70) return candidate.charAt(0).toUpperCase() + candidate.slice(1);
  return key.replace(/_/g, " ").replace(/id$/i, " ID").replace(/^\w/, (c) => c.toUpperCase());
}

async function describeWorkflows(companyId) {
  const [operations, settings, connections] = await Promise.all([
    prisma.tenantEngineOperation.findMany({
      where: { company_id: companyId },
      include: { definition: true, tenant_engine: { include: { engine: true } }, mapping: { include: { integration_action: { include: { connection: true } } } } }
    }),
    prisma.companySetting.findUnique({ where: { company_id: companyId } }),
    prisma.integrationConnection.findMany({ where: { company_id: companyId }, select: { id: true, name: true } })
  ]);
  const notify = String(settings?.notify_email || "").split(/[,;\s]+/).filter((email) => email.includes("@"));
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const flows = [];
  for (const op of operations) {
    const action = op.mapping?.integration_action;
    if (!action || ["GET", "HEAD"].includes(action.http_method)) continue;
    const config = op.mapping.workflow_config || {};
    const blueprint = normalizeBlueprint(config, action);
    const director = config.director || {};
    const props = action.input_schema?.properties || {};
    const systemName = action.connection?.name ? `${action.connection.name} system` : "your company system";
    const identifySet = new Set(Object.keys(director.identify?.set || {}));
    const derivedFields = new Set(blueprint.derived.map((rule) => rule.field));
    const steps = [];
    steps.push({ icon: "chat", title: "Starts when", text: director.trigger || op.definition.description || op.definition.name });
    if (director.identify) {
      steps.push({ icon: "search", title: "Finds the customer's record", text: `Asks for ${director.identify.ask || "an identifier"}, looks it up in the ${systemName}, and confirms the match (${(director.identify.describe || []).join(", ")}). If the customer already used this before, it reuses the same record.` });
    }
    const order = [...blueprint.steps, ...(action.input_schema?.required || []).filter((key) => !blueprint.steps.includes(key))];
    const asked = order.filter((key, index) => order.indexOf(key) === index && props[key] && !identifySet.has(key) && !blueprint.hidden.has(key) && !derivedFields.has(key));
    for (const key of asked) {
      const labels = blueprint.valueLabels[key];
      const options = labels && Object.keys(labels).length ? Object.entries(labels).map(([value, label]) => `${value} = ${label}`) : Array.isArray(props[key].enum) ? props[key].enum.map(String) : null;
      steps.push({
        icon: "ask",
        title: `Asks: ${plainLabel(key, props[key], blueprint)}`,
        text: [
          blueprint.askCustomer.has(key) ? "The customer must say this themselves (the AI is not allowed to guess it)." : "The AI may fill this from what the customer already said.",
          blueprint.remember.has(key) ? "Remembered for next time." : ""
        ].filter(Boolean).join(" "),
        options
      });
    }
    for (const rule of blueprint.derived) {
      steps.push({ icon: "auto", title: `Sets automatically: ${plainLabel(rule.field, props[rule.field], blueprint)}`, text: `Decided by the system from ${plainLabel(rule.from, props[rule.from], blueprint).toLowerCase()}: ${Object.entries(rule.map).map(([from, to]) => `${blueprint.valueLabels[rule.from]?.[from] || from} → ${to}`).join(", ")}.` });
    }
    if (blueprint.dryRunField) steps.push({ icon: "check", title: "Checks before saving", text: `Asks the ${systemName} to check everything (without saving) — including who will be assigned.` });
    if (op.policy === "customer_confirmation") steps.push({ icon: "confirm", title: "Customer confirms", text: "Shows the customer a short summary and waits for their 'yes'." });
    else if (op.policy === "staff_approval") steps.push({ icon: "confirm", title: "Staff approves", text: "A staff member approves it in AIStaff before it is saved." });
    steps.push({ icon: "save", title: "Saves the request", text: `Saves it in the ${systemName} and sends the customer the reference number exactly as the system returns it (the AI never types it).` });
    steps.push({ icon: "alert", title: "If something blocks it", text: `Nothing is guessed: the customer is told the team will contact them, and ${notify.length ? notify.join(", ") : "the notify email (not set!)"} gets an email with every detail.` });
    steps.push({ icon: "memory", title: "Afterwards", text: "Remembers the customer's name, number and record for next time; past requests are looked up from the system when asked, not remembered." });

    const failures = await prisma.businessOperationRequest.groupBy({
      by: ["error_message"],
      where: { company_id: companyId, tenant_engine_operation_id: op.id, status: "failed", updated_at: { gte: since }, error_message: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { error_message: "desc" } },
      take: 3
    }).catch(() => []);
    const done = await prisma.businessOperationRequest.count({ where: { company_id: companyId, tenant_engine_operation_id: op.id, status: "succeeded", updated_at: { gte: since } } }).catch(() => 0);
    const warnings = [
      ...(!notify.length ? ["No notify email is set, so nobody is told when a request is blocked (Settings › General › Notify email)."] : []),
      ...failures.map((row) => `Blocked ${row._count._all}× this week: ${String(row.error_message).replace(/^.*?:\s*/, "").slice(0, 200)}`),
      ...blueprintWarnings(action, blueprint)
    ];
    flows.push({
      engine: op.tenant_engine.engine.key,
      operation: op.definition.operation_key,
      name: op.definition.name,
      engineName: op.tenant_engine.engine.name,
      enabled: op.enabled && director.enabled === true,
      available: op.enabled,
      steps,
      warnings,
      stats: { saved7d: done, blocked7d: failures.reduce((sum, row) => sum + row._count._all, 0) },
      openCases: await openCasesFor(companyId, op, blueprint).catch(() => [])
    });
  }
  return { workflows: flows, connections: connections.map((c) => c.name) };
}

async function setWorkflowEnabled({ companyId, engineKey, operationKey, enabled, actor }) {
  const op = await prisma.tenantEngineOperation.findFirst({
    where: { company_id: companyId, definition: { operation_key: operationKey }, tenant_engine: { engine: { key: engineKey } } },
    include: { mapping: true }
  });
  if (!op?.mapping) throw new Error("This job is not connected to an app action yet.");
  const config = { ...(op.mapping.workflow_config || {}) };
  config.director = { ...(config.director || {}), enabled: Boolean(enabled) };
  await prisma.engineOperationMapping.update({ where: { id: op.mapping.id }, data: { workflow_config: config } });
  console.log("[workflows] %s %s.%s by %s", enabled ? "enabled" : "disabled", engineKey, operationKey, actor?.email || "?");
  return { ok: true, enabled: config.director.enabled };
}

module.exports = { describeWorkflows, setWorkflowEnabled, caseAction, openCasesFor };
