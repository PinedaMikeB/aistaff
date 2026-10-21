/**
 * Cases (added 2026-10-20): ONE open case per customer need.
 *
 * A "need" = the tenant job + the job's case keys (workflow_config.director.case.keys;
 * default: the identification fields). Marga: customer + branch + machine + category.
 * - A new attempt for a need that already has an open (unresolved) case REPLACES it:
 *   the old one becomes status "replaced" (replaced_by_id = new), its history moves to the
 *   new one, and no second ticket is ever created for the same need.
 * - Customer follow-ups are recorded in the case history (time, words, minutes waiting).
 * - Staff alerts for a case: at most one every 15 minutes (URGENT throttle).
 * - When the need is saved (reference returned), every other open case for it is closed
 *   with the same reference and those customers are told (resolve-loop.linkAndNotify).
 * A case only becomes a TICKET when the tenant system returns its reference (e.g. SR-...);
 * customers never get another number.
 */
const { prisma } = require("./db");

// Request status values that mean "not saved yet" (business_operation_requests.status).
const OPEN_STATUSES = ["failed", "retrying"];
// Case lifecycle (case_status). Open cases never expire: they stay open until done/cancelled/closed.
const OPEN_CASE = ["waiting", "ticket_open"];
const OPEN_DAYS = null; // no limit (Mike, 2026-10-20)
const ALERT_EVERY_MS = 15 * 60 * 1000;
const MAX_HISTORY = 60;

function caseKeys(workflowConfig) {
  const director = (workflowConfig && workflowConfig.director) || {};
  if (Array.isArray(director.case?.keys) && director.case.keys.length) return director.case.keys.map(String);
  return Object.keys(director.identify?.set || {});
}

function needKeyFor(operationId, workflowConfig, args = {}) {
  const keys = caseKeys(workflowConfig);
  if (!operationId || !keys.length) return null;
  const parts = [];
  for (const key of keys) {
    const raw = args[key] && typeof args[key] === "object" && "value" in args[key] ? args[key].value : args[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") return null;
    parts.push(`${key}=${String(raw).trim().toLowerCase()}`);
  }
  return `${operationId}|${parts.join("|")}`;
}

function shortCode(id) { return `R-${String(id).slice(0, 8)}`; }

/** When this case really started: its own creation or the oldest request it replaced. */
function caseStartedAt(row) {
  const times = [new Date(row.created_at).getTime()];
  for (const item of Array.isArray(row.followups) ? row.followups : []) {
    if (item && item.type === "replaced" && item.since) times.push(new Date(item.since).getTime());
  }
  return new Date(Math.min(...times.filter(Number.isFinite)));
}

function followupCount(row) {
  return (Array.isArray(row.followups) ? row.followups : []).filter((item) => item && item.type === "followup").length;
}

async function findOpenCase({ companyId, needKey, excludeId = null }) {
  if (!needKey) return null;
  return prisma.businessOperationRequest.findFirst({
    where: { company_id: companyId, need_key: needKey, case_status: { in: OPEN_CASE }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { created_at: "asc" }
  });
}

/**
 * Every open case of one customer (any age), oldest first: this conversation's own cases, cases this
 * conversation was MERGED into, and the same customer's open cases on another channel (same email or
 * phone). 2026-10-21: a customer who started on Messenger and followed up by email was not linked, so
 * her follow-up alerted nobody and the AI answered with a made-up "forwarded to the team".
 */
async function openCasesForConversation(companyId, conversationId) {
  if (!conversationId) return [];
  const byId = new Map();
  const own = await prisma.businessOperationRequest.findMany({
    where: { company_id: companyId, conversation_id: conversationId, case_status: { in: OPEN_CASE } },
    orderBy: { created_at: "asc" }
  });
  own.forEach((row) => byId.set(row.id, row));
  // Merged / replaced into a case of another conversation.
  const moved = await prisma.businessOperationRequest.findMany({
    where: { company_id: companyId, conversation_id: conversationId, replaced_by_id: { not: null } },
    select: { replaced_by_id: true }
  }).catch(() => []);
  for (const m of moved) {
    const target = await currentCase(m.replaced_by_id).catch(() => null);
    if (target && OPEN_CASE.includes(target.case_status)) byId.set(target.id, target);
  }
  // Same customer on another channel: email or phone they gave (or the email address they write from).
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { channel: true, external_id: true, customer_profile: true } }).catch(() => null);
  const known = conv?.customer_profile?.known || {};
  const email = String(known.calleremail || (conv?.channel === "email" ? conv.external_id : "") || "").trim().toLowerCase();
  const digits = String(known.callerphone || "").replace(/\D/g, "").slice(-10);
  if (email || digits.length >= 7) {
    const others = await prisma.$queryRawUnsafe(
      `select id from business_operation_requests
        where company_id = $1 and case_status = any($2::text[])
          and (($3 <> '' and lower(requested_arguments->>'calleremail') = $3)
            or ($4 <> '' and right(regexp_replace(coalesce(requested_arguments->>'callerphone',''), '\\D', '', 'g'), 10) = $4))`,
      companyId, OPEN_CASE, email, digits.length >= 7 ? digits : ""
    ).catch(() => []);
    for (const o of others) if (!byId.has(o.id)) { const row = await prisma.businessOperationRequest.findUnique({ where: { id: o.id } }); if (row) byId.set(row.id, row); }
  }
  return [...byId.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

async function setCase(requestId, patch) {
  return prisma.businessOperationRequest.update({ where: { id: requestId }, data: patch });
}

/** Short plain description of a case for customers and staff. */
function caseSummary(row) {
  const a = row?.requested_arguments || {};
  const v = (x) => (x && typeof x === "object" && "value" in x ? x.value : x);
  return String(v(a.description) || v(a.category) || "request").replace(/\s+/g, " ").slice(0, 160);
}

/**
 * The customer confirmed the new request is for the same need: add it to the open case (one case,
 * one ticket). A ticket that already has a reference is updated in the tenant system.
 */
async function mergeIntoCase({ companyId, conversationId, openRow, newRowId, addition, actor }) {
  const text = String(addition || "").replace(/\s+/g, " ").trim().slice(0, 300);
  let ticket = null;
  if (openRow.case_status === "ticket_open" && openRow.reference) {
    ticket = await ticketAction({ companyId, conversationId, operationKey: "update_service_details", args: { ticketReference: openRow.reference, addition: text, updatedBy: actor || "Closer" }, actor });
    if (!ticket.ok) return { ok: false, detail: ticket.detail };
  }
  const args = { ...(openRow.requested_arguments || {}) };
  if (args.description !== undefined) args.description = `${args.description}\n+ ${text}`.slice(0, 2000);
  await prisma.businessOperationRequest.update({ where: { id: openRow.id }, data: { requested_arguments: args } });
  await addHistory(openRow.id, { type: "added", addition: text, from: newRowId ? shortCode(newRowId) : null, ticket_updated: Boolean(ticket?.ok) });
  if (newRowId) {
    await prisma.businessOperationRequest.update({ where: { id: newRowId }, data: {
      status: "merged", case_status: "merged", replaced_by_id: openRow.id, reference: openRow.reference || null, completed_at: new Date(), closed_at: new Date(),
      error_message: `Added to ${openRow.reference || shortCode(openRow.id)} (same need) at the customer's confirmation.`
    } });
  }
  console.log("[cases] + \"%s\" added to %s", text, openRow.reference || shortCode(openRow.id));
  return { ok: true, reference: openRow.reference || null, ticketUpdated: Boolean(ticket?.ok), description: args.description || null };
}

async function addHistory(requestId, entry) {
  const row = await prisma.businessOperationRequest.findUnique({ where: { id: requestId }, select: { followups: true } });
  if (!row) return null;
  const list = [...(Array.isArray(row.followups) ? row.followups : []), { at: new Date().toISOString(), ...entry }].slice(-MAX_HISTORY);
  return prisma.businessOperationRequest.update({ where: { id: requestId }, data: { followups: list } });
}

/** The newer attempt takes over: old -> "replaced", its history moves to the new case. */
async function replaceCase(oldRow, newId, reason = "") {
  const fresh = await prisma.businessOperationRequest.findUnique({ where: { id: newId }, select: { followups: true, last_alert_at: true } });
  const inherited = Array.isArray(oldRow.followups) ? oldRow.followups : [];
  const entry = {
    type: "replaced", at: new Date().toISOString(), request: oldRow.id, code: shortCode(oldRow.id),
    since: caseStartedAt(oldRow).toISOString(), previous_details: oldRow.requested_arguments || {},
    previous_problem: oldRow.error_message || null, note: reason || "customer asked again; older unresolved request replaced"
  };
  const merged = [...inherited, ...(Array.isArray(fresh?.followups) ? fresh.followups : []), entry].slice(-MAX_HISTORY);
  const lastAlert = [oldRow.last_alert_at, fresh?.last_alert_at].filter(Boolean).map((d) => new Date(d).getTime());
  await prisma.businessOperationRequest.update({
    where: { id: newId },
    data: { followups: merged, ...(lastAlert.length ? { last_alert_at: new Date(Math.max(...lastAlert)) } : {}) }
  });
  await prisma.businessOperationRequest.update({
    where: { id: oldRow.id },
    data: { status: "replaced", replaced_by_id: newId, completed_at: new Date(), error_message: `Unresolved — replaced by ${shortCode(newId)}. ${oldRow.error_message || ""}`.slice(0, 1000) }
  });
  console.log("[cases] %s replaced by %s", shortCode(oldRow.id), shortCode(newId));
}

function alertDue(row) {
  return !row?.last_alert_at || Date.now() - new Date(row.last_alert_at).getTime() >= ALERT_EVERY_MS;
}

async function markAlerted(requestId) {
  await prisma.businessOperationRequest.update({ where: { id: requestId }, data: { last_alert_at: new Date() } }).catch(() => {});
}

/** Follow the replaced chain to the case that is current now. */
async function currentCase(requestId) {
  let row = await prisma.businessOperationRequest.findUnique({ where: { id: requestId } });
  for (let i = 0; row && (row.status === "replaced" || row.status === "merged" || row.case_status === "merged") && row.replaced_by_id && i < 10; i += 1) {
    row = await prisma.businessOperationRequest.findUnique({ where: { id: row.replaced_by_id } });
  }
  return row;
}

/** Plain history lines for staff emails. */
function historyLines(row, limit = 8) {
  const items = (Array.isArray(row?.followups) ? row.followups : []).filter((item) => item && ["followup", "replaced", "alert_suppressed", "closed", "added", "still_needed", "cancelled", "done", "overdue", "still_open", "asked_still_needed", "complaint", "feedback"].includes(item.type));
  const time = (iso) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return items.slice(-limit).map((item) => {
    if (item.type === "followup") return `${time(item.at)} — customer followed up (${item.minutes_waiting || "?"} min waiting): "${String(item.said || "").slice(0, 120)}"${item.alerted === false ? " · alert held (15-min limit)" : ""}`;
    if (item.type === "replaced") return `${time(item.at)} — customer asked again; earlier unresolved request ${item.code} replaced`;
    if (item.type === "alert_suppressed") return `${time(item.at)} — alert held (15-min limit)`;
    if (item.type === "added") return `${time(item.at)} — customer added: ${item.addition}${item.ticket_updated ? " (ticket updated)" : ""}`;
    if (item.type === "still_needed") return `${time(item.at)} — customer confirmed it is still needed`;
    if (item.type === "cancelled") return `${time(item.at)} — cancelled: ${item.note || ""}`;
    if (item.type === "done") return `${time(item.at)} — done: ${item.note || ""}`;
    if (item.type === "still_open") return `${time(item.at)} — staff: still open${item.note ? ` (${item.note})` : ""}`;
    if (item.type === "asked_still_needed") return `${time(item.at)} — customer asked whether it is still needed`;
    if (item.type === "overdue") return `${time(item.at)} — overdue: ${item.note || ""}`;
    if (item.type === "complaint") return `${time(item.at)} — COMPLAINT: ${item.note || ""}${item.ticket_flagged ? " (With Complain ticked)" : ""}`;
    if (item.type === "feedback") return `${time(item.at)} — customer feedback: ${item.note || ""}`;
    return `${time(item.at)} — closed: ${item.note || ""}`;
  });
}

/**
 * Run a tenant ticket job that is NOT exposed to the AI (policy staff_only): update / cancel / close /
 * status. Called only by fixed Director steps after the customer or staff confirmed.
 * operationKey: update_service_details | cancel_service | close_service_request | get_service_status.
 */
async function ticketAction({ companyId, conversationId = null, operationKey, args, actor = "closer" }) {
  const op = await prisma.tenantEngineOperation.findFirst({
    where: { company_id: companyId, enabled: true, definition: { operation_key: operationKey } },
    include: { mapping: { include: { integration_action: { include: { connection: true } } } } }
  });
  const action = op?.mapping?.integration_action;
  if (!action || !action.enabled || action.connection?.status !== "active") return { ok: false, error: "not_connected", detail: `${operationKey} is not connected for this business.` };
  // Imported action fields are lower-case (ticketreference, dryrun, ...).
  const props = Object.keys(action.input_schema?.properties || {});
  const fieldArgs = Object.fromEntries(Object.entries(args || {}).map(([key, value]) => [props.find((p) => p.toLowerCase() === key.toLowerCase()) || key.toLowerCase(), value]));
  const raw = await require("./integrations").runStaffCommit({ companyId, conversationId, action, args: fieldArgs, idempotencyField: null, actor });
  const data = raw?.data && typeof raw.data === "object" ? raw.data : {};
  return { ok: Boolean(raw?.ok), facts: data.facts !== undefined ? data.facts : data, http_status: raw?.http_status, detail: raw?.ok ? null : (data.message || data.code || raw?.detail || raw?.error || "refused") };
}

module.exports = {
  OPEN_CASE, openCasesForConversation, setCase, caseSummary, mergeIntoCase,
  ticketAction,
  OPEN_STATUSES, OPEN_DAYS, ALERT_EVERY_MS, caseKeys, needKeyFor, shortCode, caseStartedAt, followupCount,
  findOpenCase, addHistory, replaceCase, alertDue, markAlerted, currentCase, historyLines
};
