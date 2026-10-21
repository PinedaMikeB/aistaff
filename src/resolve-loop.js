/**
 * Staff resolve loop (docs/MASTERPLAN-director.md section 9, step 3). Added 2026-10-20.
 *
 * When Closer could not save a customer's request (e.g. Marga: no messenger for the
 * area), the ACTION NEEDED / URGENT alert carries three signed buttons and accepts
 * plain email replies from the tenant's alert contacts or the platform admin:
 *   retry  - "I fixed it, try again": run the check + save again with the collected details
 *   manual - "I created it manually: SR-...": verify the reference in the tenant system
 *   handle - "I'll handle it": record who is handling it (Closer tells the customer)
 * On success the customer gets the reference on Messenger (only inside Meta's 24-hour
 * window) and by email from the tenant inbox (Settings > Channels > Email), with thanks
 * and an apology; staff get a DONE email. Still failing -> new alert with the new reason.
 *
 * Generic for every tenant: what to verify a manual reference with comes from the
 * job's blueprint (workflow_config.director.resolve), never from tenant names in code.
 * Links open a confirm page first (mail scanners open links; only a POST acts).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { prisma } = require("./db");
const { normalizeBlueprint, labelArguments, extractAnchors } = require("./engine-blueprint");

const TTL_MS = 7 * 24 * 3600 * 1000;
const WINDOW_24H = 24 * 3600 * 1000;
const STATE_FILE = path.join(__dirname, "..", "data", "staff-reply-inbox.json");

/* ----------------------------- tokens & links ----------------------------- */

function key() { return crypto.createHash("sha256").update(`resolve-loop:${process.env.ENCRYPTION_SECRET || "local-dev"}`).digest(); }
function b64(value) { return Buffer.from(value).toString("base64url"); }
function sign(body) { return crypto.createHmac("sha256", key()).update(body).digest("base64url"); }
function shortCode(requestId) { return `R-${String(requestId).slice(0, 8)}`; }
function baseUrl() { return String(process.env.PUBLIC_BASE_URL || "https://aistaff.click").replace(/\/$/, ""); }

function makeToken(requestId, email) {
  const body = b64(JSON.stringify({ r: requestId, e: String(email || "").toLowerCase(), x: Date.now() + TTL_MS }));
  return `${body}.${sign(body)}`;
}

function readToken(token) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return data.x > Date.now() ? data : null;
  } catch { return null; }
}

function resolveLinks(requestId, email) {
  const url = `${baseUrl()}/resolve/${makeToken(requestId, email)}`;
  return { code: shortCode(requestId), page: url, retry: `${url}?do=retry`, manual: `${url}?do=manual`, handle: `${url}?do=handle` };
}

/* ------------------------------- context --------------------------------- */

async function loadContext(requestId) {
  const request = await prisma.businessOperationRequest.findUnique({
    where: { id: requestId },
    include: { tenant_operation: { include: { definition: true, tenant_engine: { include: { engine: true } }, mapping: { include: { integration_action: { include: { connection: true } } } } } } }
  });
  if (!request) return null;
  const operation = request.tenant_operation;
  const action = operation?.mapping?.integration_action || null;
  const blueprint = action ? normalizeBlueprint(operation.mapping.workflow_config, action) : null;
  const [company, settings, conversation] = await Promise.all([
    prisma.company.findUnique({ where: { id: request.company_id }, select: { id: true, name: true } }),
    prisma.companySetting.findUnique({ where: { company_id: request.company_id } }),
    request.conversation_id ? prisma.conversation.findUnique({ where: { id: request.conversation_id }, include: { facebook_page: true } }).catch(() => null) : null
  ]);
  const resolveConfig = (operation?.mapping?.workflow_config && operation.mapping.workflow_config.director && operation.mapping.workflow_config.director.resolve) || null;
  return { request, operation, action, blueprint, company, settings, conversation, resolveConfig };
}

function allowedActors(settings) {
  const { alertAudiences } = require("./notify");
  const { tenant } = alertAudiences(settings);
  const platform = String([process.env.ADMIN_ALERT_EMAILS, process.env.ADMIN_ALERT_EMAIL, process.env.SEED_ADMIN_EMAIL].filter(Boolean).join(","))
    .split(/[,;\s]+/).filter((e) => e.includes("@"));
  return new Set([...tenant.map((t) => t.email), ...platform].map((e) => e.toLowerCase()));
}

function actorName(settings, email) {
  const contact = (Array.isArray(settings?.alert_contacts) ? settings.alert_contacts : []).find((c) => String(c.email || "").toLowerCase() === email);
  return contact?.name || email;
}

function detailOf(raw) {
  const data = raw?.data && typeof raw.data === "object" ? raw.data : {};
  const text = data.message || data.error?.message || data.code || raw?.detail || raw?.error || "The company system rejected it.";
  return `${raw?.http_status ? `HTTP ${raw.http_status}: ` : ""}${typeof text === "string" ? text : JSON.stringify(text)}`.slice(0, 600);
}

async function logAction(data) {
  return prisma.staffResolveAction.create({ data }).catch((error) => console.error("[resolve] log failed: %s", error.message));
}

async function updateLastRequest(ctx, patch) {
  if (!ctx.conversation) return;
  const fresh = await prisma.conversation.findUnique({ where: { id: ctx.conversation.id }, select: { customer_profile: true } });
  const profile = fresh?.customer_profile || {};
  const last = profile.last_request;
  if (!last || (last.request_id && last.request_id !== ctx.request.id) || (!last.request_id && last.reference)) return;
  await prisma.conversation.update({ where: { id: ctx.conversation.id }, data: { customer_profile: { ...profile, last_request: { ...last, request_id: ctx.request.id, ...patch } } } }).catch(() => {});
}

/** Only one staff action at a time per request; a stuck "retrying" is released after 5 minutes. */
async function lockRequest(requestId) {
  const got = await prisma.businessOperationRequest.updateMany({ where: { id: requestId, status: "failed" }, data: { status: "retrying" } });
  if (got.count) return true;
  const stale = await prisma.businessOperationRequest.updateMany({ where: { id: requestId, status: "retrying", updated_at: { lt: new Date(Date.now() - 5 * 60 * 1000) } }, data: { status: "retrying" } });
  return Boolean(stale.count);
}

/* ------------------------------ the actions ------------------------------ */

async function performAction({ requestId, action, reference = "", actorEmail, via, messageId = null, trusted = false }) {
  const current = await require("./cases").currentCase(requestId).catch(() => null);
  if (current && current.id !== requestId) requestId = current.id;
  const ctx = await loadContext(requestId);
  if (!ctx || !ctx.action) return { outcome: "not_found", message: "This request no longer exists." };
  const email = String(actorEmail || "").toLowerCase();
  if (!trusted && !allowedActors(ctx.settings).has(email)) {
    await logAction({ company_id: ctx.request.company_id, request_id: requestId, action, actor_email: email, via, outcome: "not_allowed", message_id: messageId });
    return { outcome: "not_allowed", message: `${email} is not in this business's alert contacts, so it cannot resolve requests.` };
  }
  const base = { company_id: ctx.request.company_id, request_id: requestId, action, actor_email: email, via, message_id: messageId };
  const caseStatus = ctx.request.case_status;
  if (["done", "cancelled", "closed"].includes(caseStatus) || ctx.request.status === "closed") {
    await logAction({ ...base, outcome: "already_done" });
    return { outcome: "already_done", message: `This request is already ${caseStatus || "closed"}${ctx.request.reference ? ` (${ctx.request.reference})` : ""}. Nothing more to do.` };
  }
  if (["done", "still_open", "cancel"].includes(action)) {
    return ticketCaseAction(ctx, { action, email, name: actorName(ctx.settings, email), base, note: String(reference || "").trim().slice(0, 300) });
  }
  if (caseStatus === "ticket_open") {
    await logAction({ ...base, outcome: "already_done", reference: ctx.request.reference || null });
    return { outcome: "already_done", reference: ctx.request.reference, message: `This request is already saved as ${ctx.request.reference}. Use Done, Still open or Cancel for it.` };
  }
  if (ctx.request.status === "succeeded") {
    const ref = ctx.request.result?.manual_reference || extractAnchors(ctx.request.result?.data || {}, ctx.blueprint).reference || "";
    await logAction({ ...base, outcome: "already_done", reference: ref || null });
    return { outcome: "already_done", reference: ref, message: `This request is already saved${ref ? ` as ${ref}` : ""}. Nothing more to do.` };
  }
  const name = actorName(ctx.settings, email);

  if (action === "handle") {
    await updateLastRequest(ctx, { claimed_by: { name, email, at: new Date().toISOString() } });
    await logAction({ ...base, outcome: "claimed" });
    return { outcome: "claimed", message: `Recorded: ${name} is handling it. Closer tells the customer a team member is personally on it. When you have the reference, use "I created it manually" so the customer receives it.` };
  }

  if (!(await lockRequest(requestId))) {
    await logAction({ ...base, outcome: "busy" });
    return { outcome: "busy", message: "Someone is already retrying this request. Check your email in a minute." };
  }
  try {
    let resolvedReference = "";
    let raw = null;
    if (action === "manual") {
      const ref = String(reference || "").trim().slice(0, 80);
      if (!ref) throw Object.assign(new Error("Type the reference number you created."), { outcome: "unclear" });
      const verified = await verifyManualReference(ctx, ref);
      if (!verified.ok) {
        await prisma.businessOperationRequest.update({ where: { id: requestId }, data: { status: "failed" } });
        await logAction({ ...base, reference: ref, outcome: "not_verified", detail: verified.detail });
        return { outcome: "not_verified", message: verified.detail };
      }
      resolvedReference = ref;
      raw = { manual_reference: ref, verified: verified.verified, verified_detail: verified.detail || null };
    } else {
      const args = ctx.request.requested_arguments || {};
      const { runBlueprintDryRun, runStaffCommit } = require("./integrations");
      if (ctx.blueprint.dryRunField) {
        const dry = await runBlueprintDryRun({ companyId: ctx.request.company_id, conversationId: ctx.request.conversation_id, action: ctx.action, args, dryRunField: ctx.blueprint.dryRunField, requestedBy: "staff_retry" });
        if (!dry.ok) return await stillFailing(ctx, base, name, detailOf(dry));
      }
      raw = await runStaffCommit({ companyId: ctx.request.company_id, conversationId: ctx.request.conversation_id, action: ctx.action, args, idempotencyField: ctx.blueprint.idempotencyField, actor: email });
      if (!raw.ok) return await stillFailing(ctx, base, name, detailOf(raw));
      resolvedReference = String(extractAnchors(raw.data || {}, ctx.blueprint).reference || "");
    }

    await prisma.businessOperationRequest.update({ where: { id: requestId }, data: {
      status: "succeeded", case_status: "ticket_open", reference: resolvedReference || null, error_message: null, approved_by: email, approved_at: new Date(), completed_at: new Date(),
      result: action === "manual" ? { ...(ctx.request.result || {}), ...raw } : raw
    } });
    await updateLastRequest(ctx, { status: "submitted", reference: resolvedReference || null, resolved_at: new Date().toISOString(), resolved_by: name, problem: null });
    await logAction({ ...base, reference: resolvedReference || null, outcome: "done" });
    console.log("[resolve] request=%s %s by %s -> %s", requestId, action, email, resolvedReference || "(no reference returned)");
    // Customer + staff messages can take a while (the AI writes the customer message): run after answering.
    const originalProblem = ctx.request.error_message || "";
    setImmediate(async () => {
      await finishResolved(ctx, { reference: resolvedReference, how: action, name, email }).catch((error) => console.error("[resolve] finish failed: %s", error.stack || error.message));
      // "Fixed" once = every case for the same need gets this reference (no duplicate ticket),
      // and every other customer blocked by the same problem is retried automatically.
      const cases = require("./cases");
      const needKey = ctx.request.need_key || cases.needKeyFor(ctx.operation.id, ctx.operation.mapping?.workflow_config, ctx.request.requested_arguments || {});
      if (needKey) {
        await prisma.businessOperationRequest.update({ where: { id: ctx.request.id }, data: { need_key: needKey } }).catch(() => {});
        if (resolvedReference) await closeSameNeed({ companyId: ctx.request.company_id, needKey, keepId: ctx.request.id, reference: resolvedReference, keepConversationId: ctx.request.conversation_id, actorEmail: email, actorName: name }).catch((error) => console.error("[resolve] same-need close failed: %s", error.message));
      }
      if (via !== "auto_after_fix") await resolveOthersWaiting(ctx, { needKey, originalProblem, email }).catch((error) => console.error("[resolve] others failed: %s", error.stack || error.message));
    });
    return { outcome: "done", reference: resolvedReference, message: `Saved${resolvedReference ? ` as ${resolvedReference}` : ""}. Closer is now sending the customer the reference on Messenger and by email; you will get a DONE email in a minute.` };
  } catch (error) {
    await prisma.businessOperationRequest.updateMany({ where: { id: requestId, status: "retrying" }, data: { status: "failed" } });
    if (error.outcome === "unclear") return { outcome: "unclear", message: error.message };
    console.error("[resolve] %s failed request=%s: %s", action, requestId, error.stack || error.message);
    await logAction({ ...base, outcome: "error", detail: error.message });
    return { outcome: "error", message: `Something went wrong: ${error.message}` };
  }
}

/** Ticket actions from the briefing report / alert links: Done (close in the tenant system), Still open, Cancel. */
async function ticketCaseAction(ctx, { action, email, name, base, note }) {
  const cases = require("./cases");
  const row = ctx.request;
  const ref = row.reference;
  const label = ref || shortCode(row.id);
  if (action === "still_open") {
    await cases.addHistory(row.id, { type: "still_open", by: name, note });
    await logAction({ ...base, outcome: "still_open", reference: ref || null, detail: note || null });
    return { outcome: "still_open", message: `Noted: ${label} is still open${note ? ` (${note})` : ""}. It stays on the report until it is done.` };
  }
  if (action === "cancel") {
    if (ref && row.case_status === "ticket_open") {
      const r = await cases.ticketAction({ companyId: row.company_id, conversationId: row.conversation_id, operationKey: "cancel_service", args: { ticketReference: ref, reason: note || `Cancelled by ${name}`, cancelledBy: name }, actor: email });
      if (!r.ok && !/cancel/i.test(String(r.detail))) return { outcome: "error", message: `Could not cancel ${ref} in your system: ${r.detail}` };
    }
    await cases.setCase(row.id, { case_status: "cancelled", closed_at: new Date() });
    await cases.addHistory(row.id, { type: "cancelled", by: name, note: note || "cancelled by staff" });
    await updateLastRequest(ctx, { status: "cancelled", closed_at: new Date().toISOString(), closed_by: name });
    await logAction({ ...base, outcome: "cancelled", reference: ref || null, detail: note || null });
    return { outcome: "cancelled", message: `${label} is cancelled${ref ? " (schedule cancelled in your system)" : ""}.` };
  }
  // done
  if (!ref) return { outcome: "error", message: "This request has no ticket yet. Use \"Fixed — try again\" or \"Enter reference\" first." };
  if (row.case_status === "ticket_open") {
    const r = await cases.ticketAction({ companyId: row.company_id, conversationId: row.conversation_id, operationKey: "close_service_request", args: { ticketReference: ref, reason: note || `Confirmed done by ${name}`, closedBy: name }, actor: email });
    if (!r.ok && !/already.*done|ALREADY_DONE/i.test(String(r.detail))) return { outcome: "error", message: `Could not close ${ref} in your system: ${r.detail}` };
  }
  await cases.setCase(row.id, { case_status: "done", closed_at: new Date() });
  await cases.addHistory(row.id, { type: "done", by: name, note: note || "confirmed done" });
  await updateLastRequest(ctx, { status: "done", done_at: new Date().toISOString(), closed_by: name });
  await logAction({ ...base, outcome: "done", reference: ref, detail: note || null });
  setImmediate(() => finishResolved(ctx, { reference: ref, how: "done", name, email, kind: "done" }).catch((error) => console.error("[resolve] done notice failed: %s", error.message)));
  return { outcome: "done", reference: ref, message: `${ref} is closed as done in your system. The customer is being told.` };
}

async function stillFailing(ctx, base, name, detail) {
  await prisma.businessOperationRequest.update({ where: { id: ctx.request.id }, data: { status: "failed", error_message: detail.slice(0, 1000) } });
  await updateLastRequest(ctx, { problem: detail });
  await logAction({ ...base, outcome: "still_failing", detail });
  const { notifyEngineFailure } = require("./business-engines");
  await notifyEngineFailure({
    companyId: ctx.request.company_id, conversationId: ctx.request.conversation_id, operation: ctx.operation,
    reason: `Tried again after ${name} said it was fixed, but the company system still refused: ${detail}`,
    details: labelArguments(ctx.request.requested_arguments || {}, ctx.blueprint), requestId: ctx.request.id, force: true
  });
  return { outcome: "still_failing", message: `Tried again, but it still could not be saved: ${detail.replace(/[.\s]+$/, "")}. A new alert with the steps was emailed.` };
}

/** A manual reference must exist in the tenant system and belong to this customer (when configured). */
async function verifyManualReference(ctx, reference) {
  const cfg = ctx.resolveConfig?.verify;
  if (!cfg || !cfg.operation) return { ok: true, verified: false, detail: "Not checked: no verify step configured for this job." };
  const op = await prisma.tenantEngineOperation.findFirst({
    where: { company_id: ctx.request.company_id, enabled: true, definition: { operation_key: cfg.operation } },
    include: { mapping: { include: { integration_action: true } } }
  });
  const verifyAction = op?.mapping?.integration_action;
  if (!verifyAction) return { ok: true, verified: false, detail: `Not checked: ${cfg.operation} is not connected.` };
  const { executeCompanyTool } = require("./integrations");
  const raw = await executeCompanyTool({ companyId: ctx.request.company_id, conversationId: ctx.request.conversation_id, name: verifyAction.tool_name, args: { [cfg.argument]: reference }, requestedBy: "staff_verify", approvalPolicyOverride: "automatic" });
  if (!raw.ok) return { ok: false, detail: Number(raw.http_status) === 404 ? `${reference} was not found in your system. Check the number and try again.` : `Could not check ${reference}: ${detailOf(raw)}` };
  if (cfg.customer_field && cfg.customer_argument) {
    const facts = raw.data?.facts !== undefined ? raw.data.facts : raw.data;
    const found = String(cfg.customer_field).split(".").reduce((node, part) => (node == null ? undefined : node[part]), facts);
    const expected = (ctx.request.requested_arguments || {})[cfg.customer_argument];
    if (expected !== undefined && found !== undefined && String(found) !== String(expected)) {
      return { ok: false, detail: `${reference} exists but belongs to a different customer. Check the number.` };
    }
  }
  return { ok: true, verified: true };
}

/* ------------- one "fixed" handles every customer waiting on it ------------- */

function problemKey(text) {
  return String(text || "").replace(/^Unresolved — replaced by R-\w+\.\s*/, "").replace(/^Tried again after .*? still refused: /, "")
    .replace(/^HTTP \d{3}: /, "").replace(/\(from [^)]*\)/g, "").replace(/ — This replaces.*$/, "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 160);
}

/**
 * Same need already saved as `reference`: every other open case for it closes with that
 * reference (status "replaced", history kept on the saved case) and its customer is told on
 * their own channel (unless it is the conversation that already gets the reference).
 */
async function closeSameNeed({ companyId, needKey, keepId, reference, keepConversationId = null, actorEmail = "closer", actorName = "Closer" }) {
  const cases = require("./cases");
  const rows = await prisma.businessOperationRequest.findMany({ where: { company_id: companyId, need_key: needKey, case_status: "waiting", id: { not: keepId } }, orderBy: { created_at: "asc" } });
  for (const row of rows) {
    const sibling = await loadContext(row.id);
    await cases.replaceCase(row, keepId, `same need; closed with ${reference}`);
    await prisma.businessOperationRequest.update({ where: { id: row.id }, data: {
      case_status: "merged", reference, closed_at: new Date(),
      error_message: `Resolved with ${reference} (same need as ${cases.shortCode(keepId)}).`,
      result: { ...(row.result || {}), linked_reference: reference, linked_to_request: keepId }
    } });
    await logAction({ company_id: companyId, request_id: row.id, action: "link", actor_email: actorEmail, via: "same_need", reference, outcome: "done", detail: `closed with ${reference} (${cases.shortCode(keepId)})` });
    if (!sibling) continue;
    await updateLastRequest(sibling, { status: "submitted", reference, resolved_at: new Date().toISOString(), resolved_by: actorName, problem: null });
    if (sibling.conversation && sibling.conversation.id !== keepConversationId) {
      console.log("[resolve] %s closed with %s; telling its customer (conversation %s)", cases.shortCode(row.id), reference, sibling.conversation.id);
      await finishResolved(sibling, { reference, how: "linked", name: actorName, email: actorEmail }).catch((error) => console.error("[resolve] linked finish failed: %s", error.message));
    }
  }
  if (rows.length) console.log("[resolve] same need %s: %d open case(s) closed with %s", cases.shortCode(keepId), rows.length, reference);
  return rows.length;
}

/** Other customers (different need) blocked by the SAME problem: retry their current case automatically. */
async function resolveOthersWaiting(ctx, { needKey, originalProblem, email }) {
  const cases = require("./cases");
  const wanted = problemKey(originalProblem);
  if (!wanted) return;
  const rows = await prisma.businessOperationRequest.findMany({
    where: { company_id: ctx.request.company_id, tenant_engine_operation_id: ctx.request.tenant_engine_operation_id, case_status: "waiting", id: { not: ctx.request.id }, conversation_id: { not: null } },
    orderBy: { updated_at: "desc" }
  });
  const live = new Set((await prisma.conversation.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.conversation_id))] } }, select: { id: true } })).map((c) => c.id));
  const seen = new Set();
  let retried = 0;
  for (const row of rows) {
    if (!live.has(row.conversation_id) || seen.has(row.conversation_id)) continue;
    seen.add(row.conversation_id);
    if (needKey && row.need_key === needKey) continue;
    if (problemKey(row.error_message) !== wanted) continue;
    const result = await performAction({ requestId: row.id, action: "retry", actorEmail: email, via: "auto_after_fix", trusted: true });
    console.log("[resolve] auto retry %s (same problem) -> %s %s", cases.shortCode(row.id), result.outcome, result.reference || "");
    retried += 1;
  }
  if (retried) console.log("[resolve] after %s: %d other customer(s) retried", cases.shortCode(ctx.request.id), retried);
}

/* ------------------------- tell customer and staff ------------------------ */

async function composeCustomerMessage(ctx, kind = "saved") {
  const profile = ctx.conversation?.customer_profile || {};
  const history = ctx.conversation
    ? (await prisma.message.findMany({ where: { conversation_id: ctx.conversation.id }, orderBy: { created_at: "desc" }, take: 6, select: { sender_type: true, message_text: true } })).reverse()
    : [];
  const lastCustomer = [...history].reverse().find((m) => m.sender_type === "customer");
  const task = kind === "done"
    ? { task: "request_completed", tell: ["their request (reference below) is now completed", "thank them for their patience"], ask: [{ item: "to reply here if anything is still not right" }], do_not_promise_a_call: true }
    : {
      task: "resolved_by_staff",
      tell: ["thank them for waiting", "say sorry for the delay", "their request is now saved in the system; the reference number is added below by the system"],
      do_not_promise_a_call: true
    };
  try {
    const { communicatorPrompt } = require("./director");
    const { callCloserModelJSON } = require("./ai");
    const written = await callCloserModelJSON(communicatorPrompt({
      companyName: ctx.company?.name || "our business", tone: ctx.settings?.ai_custom_instructions || "",
      addressAs: profile.address_as || profile.known?.callername || "", history, message: lastCustomer?.message_text || "", language: "", task
    }));
    const reply = String(written?.reply || "").trim();
    if (reply) return reply;
  } catch (error) {
    console.warn("[resolve] AI could not write the customer message (%s); using plain text", error.message);
  }
  return kind === "done" ? "Your request is now completed. Thank you for your patience! Reply here if anything is still not right." : "Thank you for waiting, and sorry for the delay. Your request is now saved in our system.";
}

async function finishResolved(ctx, { reference, how, name, email, kind = "saved" }) {
  const conv = ctx.conversation;
  const args = ctx.request.requested_arguments || {};
  const profile = conv?.customer_profile || {};
  const report = { messenger: "not a Messenger customer", email_thread: null, email: "no customer email on file" };
  const body = await composeCustomerMessage(ctx, kind);
  const text = reference ? `${body}\n\nReference number: ${reference}` : body;

  if (conv?.channel === "facebook_messenger" && conv.psid && conv.facebook_page) {
    const lastCustomer = await prisma.message.findFirst({ where: { conversation_id: conv.id, sender_type: "customer" }, orderBy: { created_at: "desc" }, select: { created_at: true } });
    if (lastCustomer && Date.now() - new Date(lastCustomer.created_at).getTime() < WINDOW_24H) {
      try {
        await require("./messenger-webhook").sendMessengerText(conv.facebook_page, conv.psid, text);
        await prisma.message.create({ data: { company_id: conv.company_id, conversation_id: conv.id, sender_type: "ai", sender_id: "ai_sales_assistant", message_text: text, ai_generated: true } }).catch(() => {});
        report.messenger = "sent";
      } catch (error) {
        report.messenger = `failed: ${error.message}`;
      }
    } else {
      report.messenger = "not sent: the customer's last message is older than 24 hours (Meta's rule)";
    }
  }

  const emailChannel = require("./email-channel");
  if (conv?.channel === "email") {
    const lastIn = await prisma.emailMessageLog.findFirst({ where: { conversation_id: conv.id, direction: "in", skip_reason: null }, orderBy: { created_at: "desc" } });
    const subject = lastIn?.subject ? (/^re\s*:/i.test(lastIn.subject) ? lastIn.subject : `Re: ${lastIn.subject}`) : `Your request ${reference || ""}`.trim();
    const sent = await emailChannel.sendTenantEmail({
      companyId: conv.company_id, to: conv.external_id, subject, text, conversationId: conv.id,
      inReplyTo: lastIn?.message_id || null, references: [...String(lastIn?.references_header || "").split(/\s+/), lastIn?.message_id].filter(Boolean)
    });
    report.email_thread = sent.ok ? `sent to ${conv.external_id} from ${sent.via}` : `failed: ${sent.reason}`;
    if (sent.ok) await prisma.message.create({ data: { company_id: conv.company_id, conversation_id: conv.id, sender_type: "ai", sender_id: "ai_sales_assistant", message_text: text, ai_generated: true } }).catch(() => {});
  }

  const to = String(args.calleremail || profile.known?.calleremail || "").toLowerCase();
  if (to && !(conv?.channel === "email" && String(conv.external_id).toLowerCase() === to)) {
    const { notifyCustomerStatus } = require("./notify");
    const sent = await notifyCustomerStatus({
      companyId: ctx.request.company_id, conversationId: conv?.id || null, to,
      companyName: ctx.company?.name || "", customerName: args.callername || profile.known?.callername || "",
      statusText: kind === "done" ? "Your request is completed. Thank you for your patience!" : "Thank you for waiting, and sorry for the delay. Your request is now saved in our system.",
      nextStep: kind === "done" ? "Reply to this email if anything is still not right." : "Please keep this reference number for any follow-up.",
      reference: reference || null, details: labelArguments(args, ctx.blueprint)
    }).catch((error) => ({ ok: false, reason: error.message }));
    report.email = sent.ok ? `sent to ${to} from ${sent.via || process.env.NOTIFY_SMTP_USER || "AIStaff"}` : `failed: ${sent.reason}`;
  } else if (conv?.channel === "email") {
    report.email = "covered by the email thread above";
  }

  await updateLastRequest(ctx, { customer_emailed_at: /^sent/.test(report.email) ? new Date().toISOString() : undefined });
  if (kind !== "done") await notifyStaffDone(ctx, { reference, how, name, email, report });
  else console.log("[resolve] %s done: customer messenger=%s email=%s", reference, report.messenger, report.email);
}

async function notifyStaffDone(ctx, { reference, how, name, report }) {
  const { sendToTenantAndPlatform } = require("./notify");
  const opName = ctx.operation?.definition?.name || "Request";
  const rows = [
    ["Reference", reference || "(the system returned no reference)"],
    ["Resolved by", `${name} — ${how === "manual" ? "created manually" : how === "linked" ? "same request as one already saved; linked to that reference (no duplicate ticket)" : "fixed the problem; Closer saved it again"}`],
    ["Customer on Messenger", report.messenger],
    ...(report.email_thread ? [["Customer email thread", report.email_thread]] : []),
    ["Customer status email", report.email],
    ...Object.entries(labelArguments(ctx.request.requested_arguments || {}, ctx.blueprint)).map(([k, v]) => [k, v && typeof v === "object" && "label" in v ? `${v.label} (${v.value})` : v])
  ];
  const cases = require("./cases");
  const fresh = await prisma.businessOperationRequest.findUnique({ where: { id: ctx.request.id } }).catch(() => null);
  if (fresh) {
    const started = cases.caseStartedAt(fresh);
    const waited = Math.round((Date.now() - started.getTime()) / 360000) / 10;
    rows.splice(2, 0, ["Customer waited", `${waited} h (since ${started.toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})`], ["Follow-ups", String(cases.followupCount(fresh))]);
    const lines = cases.historyLines(fresh, 10);
    if (lines.length) rows.push(["Case history", lines.join(" | ")]);
  }
  const subject = `DONE: ${opName} saved${reference ? ` — ${reference}` : ""} [${shortCode(ctx.request.id)}]`;
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const text = [subject, "", ...rows.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#1a2233"><h2 style="color:#15803d;margin:0 0 12px">${esc(subject)}</h2><table style="font-size:14px;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6a7382;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(typeof v === "object" ? JSON.stringify(v) : v)}</td></tr>`).join("")}</table></div>`;
  await sendToTenantAndPlatform({ settings: ctx.settings, tenantName: ctx.company?.name || "", build: () => ({ subject, text, html }) });
}

/* --------------------------------- pages --------------------------------- */

function page(title, inner) {
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · AIStaff</title>
<style>
:root{color-scheme:light}body{margin:0;background:#f5f4fa;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1a2233}
main{max-width:620px;margin:0 auto;padding:24px 16px 48px}.card{background:#fff;border:1px solid #e6e3ef;border-radius:14px;padding:20px;margin:0 0 14px}
h1{font-size:20px;margin:0 0 6px}p{line-height:1.5}.muted{color:#6a7382;font-size:13px}table{border-collapse:collapse;font-size:14px;width:100%}
td{padding:4px 8px 4px 0;vertical-align:top}td:first-child{color:#6a7382;width:40%}.problem{background:#fff7ed;border-left:3px solid #ea580c;padding:10px 12px;border-radius:0 8px 8px 0;font-size:14px}
button{border:0;border-radius:9px;padding:12px 16px;font-weight:700;font-size:15px;color:#fff;cursor:pointer;width:100%;margin-top:8px}
.green{background:#15803d}.blue{background:#1d4ed8}.grey{background:#6b7280}input{width:100%;box-sizing:border-box;padding:11px;border:1px solid #cfcbe0;border-radius:9px;font-size:15px;margin-top:6px}
details{margin-top:6px}summary{cursor:pointer;font-weight:600;padding:6px 0}.ok{border-color:#86efac;background:#f0fdf4}.bad{border-color:#fca5a5;background:#fef2f2}
</style></head><body><main>${inner}</main></body></html>`;
}

function escapeHtml(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

async function renderForm(token, chosen) {
  const data = readToken(token);
  if (!data) return page("Link expired", `<div class="card bad"><h1>This link has expired or is not valid</h1><p>Use the buttons in the newest alert email, or open AIStaff.</p></div>`);
  const current = await require("./cases").currentCase(data.r).catch(() => null);
  const ctx = await loadContext(current?.id || data.r);
  if (!ctx) return page("Not found", `<div class="card bad"><h1>Request not found</h1></div>`);
  if (ctx.request.status === "closed" || ["done", "cancelled", "closed"].includes(ctx.request.case_status)) return page("Closed", `<div class="card ok"><h1>${escapeHtml(ctx.request.case_status === "done" ? "Done" : ctx.request.case_status === "cancelled" ? "Cancelled" : "Closed")}</h1><p>${escapeHtml(ctx.request.reference || shortCode(ctx.request.id))} needs nothing more.</p></div>`);
  const args = ctx.request.requested_arguments || {};
  const rows = Object.entries(labelArguments(args, ctx.blueprint)).map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v && typeof v === "object" && "label" in v ? `${v.label} (${v.value})` : (typeof v === "object" ? JSON.stringify(v) : v))}</td></tr>`).join("");
  const head = `<div class="card"><p class="muted">${escapeHtml(ctx.company?.name)} · ${escapeHtml(ctx.operation?.definition?.name)} · ${shortCode(ctx.request.id)}</p>
    <h1>${ctx.request.case_status === "ticket_open" ? `Ticket open: ${escapeHtml(ctx.request.reference || "")}` : ctx.request.status === "succeeded" ? "Already saved" : "Customer request waiting"}</h1>
    ${ctx.request.status !== "succeeded" && ctx.request.error_message ? `<p class="problem"><b>Why it was not saved:</b> ${escapeHtml(ctx.request.error_message)}</p>` : ""}
    <table>${rows}</table><p class="muted">You are: ${escapeHtml(data.e)}</p></div>`;
  if (ctx.request.case_status === "ticket_open") {
    const st = await require("./cases").ticketAction({ companyId: ctx.request.company_id, operationKey: "get_service_status", args: { ticketReference: ctx.request.reference } }).catch(() => null);
    const sch = st?.facts?.ticket?.schedule;
    const info = sch ? `<p>Scheduled: <b>${escapeHtml(sch.scheduledFor || "—")}</b> · Assigned: <b>${escapeHtml(sch.assignedTo || "—")}</b> · In your system: <b>${escapeHtml(sch.state)}</b></p>` : "";
    const f = (act, cls, label, extra = "") => `<form method="post"><input type="hidden" name="action" value="${act}">${extra}<button class="${cls}" type="submit">${label}</button></form>`;
    const o = (name) => (chosen === name ? " open" : "");
    return page("Ticket open", `${head}<div class="card">${info}
      <details${o("done") || (!chosen ? " open" : "")}><summary>Done — close it</summary><p class="muted">Closes the schedule in your system as done (same as Master Schedule office close) and tells the customer it is completed.</p>${f("done", "green", "Close as done", `<input name="reference" placeholder="How it was resolved (optional), e.g. Ink delivered" autocomplete="off">`)}</details>
      <details${o("still_open")}><summary>Still open</summary><p class="muted">Keeps it open; it stays on the briefing report.</p>${f("still_open", "grey", "Still open", `<input name="reference" placeholder="Note (optional), e.g. delivery moved to Friday" autocomplete="off">`)}</details>
      <details${o("cancel")}><summary>Cancel it</summary><p class="muted">Cancels the schedule in your system (nobody is sent).</p>${f("cancel", "blue", "Cancel ticket", `<input name="reference" placeholder="Reason (optional)" autocomplete="off">`)}</details>
    </div>`);
  }
  if (ctx.request.status === "succeeded") {
    const ref = ctx.request.result?.manual_reference || extractAnchors(ctx.request.result?.data || {}, ctx.blueprint).reference || "";
    return page("Already saved", `${head}<div class="card ok"><p>This request is already saved${ref ? ` as <b>${escapeHtml(ref)}</b>` : ""}. Nothing more to do.</p></div>`);
  }
  const form = (act, cls, label, extra = "") => `<form method="post"><input type="hidden" name="action" value="${act}">${extra}<button class="${cls}" type="submit">${label}</button></form>`;
  const open = (name) => (chosen === name ? " open" : "");
  return page("Resolve request", `${head}
  <div class="card">
    <details${open("retry") || (!chosen ? " open" : "")}><summary>I fixed the problem — try again</summary><p class="muted">Closer checks and saves it again with the details above. If it works, the customer gets the reference on Messenger and by email.</p>${form("retry", "green", "Try again now")}</details>
    <details${open("cancel")}><summary>Not needed — close it</summary><p class="muted">Closes this request without a ticket (for example the customer no longer needs it). It leaves the report.</p>${form("cancel", "blue", "Close request", `<input name="reference" placeholder="Reason (optional)" autocomplete="off">`)}</details>
  </div>`);
}

function buildRouter() {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: "10kb" }));
  router.get("/:token", async (req, res, next) => {
    try { res.set("Cache-Control", "no-store").type("html").send(await renderForm(req.params.token, String(req.query.do || ""))); } catch (error) { next(error); }
  });
  router.post("/:token", async (req, res, next) => {
    try {
      const data = readToken(req.params.token);
      if (!data) return res.status(400).type("html").send(page("Link expired", `<div class="card bad"><h1>This link has expired or is not valid</h1></div>`));
      const action = ["retry", "manual", "handle", "done", "still_open", "cancel"].includes(req.body.action) ? req.body.action : null;
      if (!action) return res.status(400).type("html").send(page("Choose an action", `<div class="card bad"><h1>Choose one of the buttons</h1></div>`));
      const result = await performAction({ requestId: data.r, action, reference: req.body.reference, actorEmail: data.e, via: "link" });
      const good = ["done", "claimed", "already_done", "still_open", "cancelled"].includes(result.outcome);
      res.set("Cache-Control", "no-store").type("html").send(page("Result", `<div class="card ${good ? "ok" : "bad"}"><h1>${good ? "Done" : "Not done yet"}</h1><p>${escapeHtml(result.message)}</p>${good ? "" : `<p><a href="${escapeHtml(req.originalUrl)}">Back</a></p>`}</div>`));
    } catch (error) { next(error); }
  });
  return router;
}

/* ------------------- plain email replies to the alerts ------------------- */

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; } }
function saveState(state) { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state)); }

function interpreterPrompt(reply, problem) {
  return [
    "A staff member replied to an alert email about a customer request that our system could not save.",
    `The alert said: ${problem || "the request could not be saved"}.`,
    `Their reply (only the new part): """${reply.slice(0, 1500)}"""`,
    "Decide what they want. Return JSON only: {\"action\": \"retry|manual|handle|unclear\", \"reference\": \"\"}",
    "retry = they fixed the problem (or ask to try again / generate it now) and want the system to save it again.",
    "manual = they created the request themselves; put the reference number exactly as they wrote it in reference.",
    "handle = they will take care of it personally.",
    "unclear = anything else, a question, or you are not sure. Never guess a reference."
  ].join("\n");
}

async function pollStaffReplies() {
  const user = process.env.NOTIFY_SMTP_USER;
  const pass = process.env.NOTIFY_SMTP_PASS;
  if (!user || !pass) return { skipped: "no_inbox" };
  if (!globalThis.crypto || !globalThis.crypto.getRandomValues) globalThis.crypto = crypto.webcrypto;
  const { ImapFlow } = require("imapflow");
  const { simpleParser } = require("mailparser");
  const client = new ImapFlow({ host: process.env.NOTIFY_IMAP_HOST || "imap.hostinger.com", port: Number(process.env.NOTIFY_IMAP_PORT || 993), secure: true, auth: { user, pass }, logger: false, socketTimeout: 60000 });
  const state = loadState();
  const items = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uidValidity = String(client.mailbox.uidValidity);
      const top = Number(client.mailbox.uidNext) - 1;
      if (state.uidvalidity !== uidValidity || !Number.isInteger(state.last_uid)) {
        saveState({ uidvalidity: uidValidity, last_uid: top, started_at: new Date().toISOString() });
        console.log("[resolve] staff-reply inbox %s: starting from uid %d", user, top);
        return { started: true };
      }
      if (top > state.last_uid) {
        for await (const msg of client.fetch(`${state.last_uid + 1}:${Math.min(top, state.last_uid + 20)}`, { uid: true, source: true }, { uid: true })) {
          if (msg.uid > state.last_uid) items.push({ uid: msg.uid, source: msg.source });
        }
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }

  let handled = 0;
  for (const item of items.sort((a, b) => a.uid - b.uid)) {
    try {
      const parsed = await simpleParser(item.source);
      await handleStaffReply(parsed);
      handled += 1;
    } catch (error) {
      console.error("[resolve] staff reply uid=%d failed: %s", item.uid, error.stack || error.message);
    }
    state.last_uid = item.uid;
    saveState(state);
  }
  return { handled };
}

async function handleStaffReply(parsed) {
  const subject = String(parsed.subject || "");
  const body = String(parsed.text || "");
  const match = `${subject}\n${body}`.match(/\bR-([0-9a-f]{8})\b/i);
  if (!match) return; // not about a request
  const emailChannel = require("./email-channel");
  const user = String(process.env.NOTIFY_SMTP_USER || "").toLowerCase();
  const skip = emailChannel.skipReason(parsed, { address: "", username: "" });
  if (skip && skip !== "aistaff_system_mail") return console.log("[resolve] reply ignored (%s) subject=%s", skip, subject);
  const from = String(parsed.from?.value?.[0]?.address || "").toLowerCase();
  if (!from || from === user) return;
  const auth = (parsed.headerLines || []).filter((h) => h.key === "authentication-results").map((h) => h.line).join(" ").toLowerCase();
  if (auth && (/dmarc=fail/.test(auth) || (/spf=fail/.test(auth) && !/dkim=pass/.test(auth)))) {
    return console.warn("[resolve] reply from %s failed sender checks; ignored", from);
  }
  const messageId = String(parsed.messageId || `${from}-${parsed.date?.toISOString()}`).slice(0, 500);
  if (await prisma.staffResolveAction.findUnique({ where: { message_id: messageId } })) return;
  const candidates = await prisma.businessOperationRequest.findMany({ where: { id: { startsWith: match[1].toLowerCase() } }, select: { id: true, error_message: true }, take: 2 });
  if (candidates.length !== 1) return console.warn("[resolve] reply code %s matched %d requests", match[1], candidates.length);
  const request = candidates[0];
  const text = emailChannel.newPartOfReply(body) || body.slice(0, 1500);

  let decision = { action: "unclear", reference: "" };
  try {
    const { callCloserModelJSON } = require("./ai");
    const out = await callCloserModelJSON(interpreterPrompt(text, request.error_message));
    if (["retry", "manual", "handle", "unclear"].includes(out?.action)) decision = { action: out.action, reference: String(out.reference || "").trim() };
  } catch (error) {
    console.warn("[resolve] could not interpret staff reply: %s", error.message);
  }
  if (decision.action === "manual" && !decision.reference) decision.action = "unclear";
  // A reference may only come from the staff member's own words.
  if (decision.action === "manual" && !text.toLowerCase().includes(decision.reference.toLowerCase())) decision.action = "unclear";

  let result;
  if (decision.action === "unclear") {
    const ctx = await loadContext(request.id);
    await logAction({ company_id: ctx.request.company_id, request_id: request.id, action: "unclear", actor_email: from, via: "email", outcome: "unclear", detail: text.slice(0, 500), message_id: messageId });
    result = { outcome: "unclear", message: "Closer could not tell what you want done. Fix the problem first, then reply \"fixed, try again\" or click \"I fixed it — try again\" in the alert email." };
  } else {
    result = await performAction({ requestId: request.id, action: decision.action, reference: decision.reference, actorEmail: from, via: "email", messageId });
  }
  console.log("[resolve] email reply from %s on %s -> %s %s", from, shortCode(request.id), decision.action, result.outcome);
  const { sendNotification } = require("./notify");
  await sendNotification({
    to: from,
    subject: `Re: ${subject.replace(/^(re:\s*)+/i, "")}`.slice(0, 250),
    text: `${result.message}\n\n(${shortCode(request.id)} · you wrote: "${text.slice(0, 200)}")`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px"><p>${escapeHtml(result.message)}</p><p style="color:#6a7382;font-size:12px">${shortCode(request.id)} · you wrote: “${escapeHtml(text.slice(0, 200))}”</p></div>`
  });
}

module.exports = { loadContextForReport: loadContext, finishResolvedPublic: finishResolved, closeSameNeed, resolveOthersWaiting, problemKey, resolveLinks, makeToken, readToken, shortCode, performAction, buildRouter, pollStaffReplies, handleStaffReply, verifyManualReference, interpreterPrompt };
