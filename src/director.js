/**
 * Closer Director — code-controlled workflows (docs/MASTERPLAN-director.md).
 *
 * The AI only (1) INTERPRETS a customer message into commands and (2) WRITES
 * the reply for a task the code chose. This module decides what is missing,
 * runs identification lookups, submits, and reports — reusing the blueprint
 * engine (must-ask fields, dry run, confirmation, idempotency, customer scope,
 * staff alerts, memory reset) through executeBusinessEngineTool.
 *
 * Nothing here is tenant-specific: a flow is an engine operation whose
 * blueprint has a `director` block, e.g.
 *   "director": {
 *     "enabled": true,
 *     "trigger": "Customer wants ink/toner delivered or a technician visit",
 *     "identify": { "operation": "customer_service.find_machine", "input": "serialnumber",
 *                   "list": "machines", "set": { "machineid": "id", "customerid": "customerId", "branchid": "branchId" },
 *                   "describe": ["customerName", "branchName", "model", "serial"],
 *                   "ask": "the machine serial number (sticker on the machine)" }
 *   }
 */
const { prisma } = require("./db");
const be = require("./business-engines");
const { normalizeBlueprint, fieldFacts, labelArguments } = require("./engine-blueprint");
const { parseSupplyItems } = require("./supply-items");

const ACTIVE_STATUSES = ["collecting", "pending_customer_confirmation"];

async function loadFlows(companyId) {
  const rows = await prisma.tenantEngineOperation.findMany({
    where: { company_id: companyId, enabled: true, tenant_engine: { enabled: true } },
    include: { definition: true, tenant_engine: { include: { engine: true } }, mapping: { include: { integration_action: true } } }
  });
  return rows
    .filter((op) => op.mapping?.integration_action && op.mapping.workflow_config?.director?.enabled === true)
    .map((op) => {
      const config = op.mapping.workflow_config;
      return {
        id: op.id,
        key: `${op.tenant_engine.engine.key}.${op.definition.operation_key}`,
        tool: be.logicalToolName(op.tenant_engine.engine.key, op.definition.operation_key),
        name: op.definition.name,
        trigger: String(config.director.trigger || op.definition.description || op.definition.name),
        identify: config.director.identify || null,
        items: config.director.items || null,
        origin: config.director.origin || null,
        codeFields: config.director.code_fields || [],
        summary: config.director.summary || null,
        action: op.mapping.integration_action,
        blueprint: normalizeBlueprint(config, op.mapping.integration_action)
      };
    });
}

function toolForKey(key) {
  const [engine, operation] = String(key || "").split(".");
  return engine && operation ? be.logicalToolName(engine, operation) : null;
}

async function activeDraft(companyId, conversationId, flows) {
  if (!conversationId || !flows.length) return null;
  const from = await be.historyStart(conversationId);
  const draft = await prisma.businessOperationRequest.findFirst({
    where: {
      company_id: companyId,
      conversation_id: conversationId,
      tenant_engine_operation_id: { in: flows.map((flow) => flow.id) },
      status: { in: ACTIVE_STATUSES },
      created_at: { gte: from },
      updated_at: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    },
    orderBy: { updated_at: "desc" }
  });
  if (!draft) return null;
  return { draft, flow: flows.find((flow) => flow.id === draft.tenant_engine_operation_id) };
}

/** Fields the interpreter may set: the action's fields minus server-owned and identification-owned ones. */
function interpreterFields(flow) {
  const props = flow.action.input_schema?.properties || {};
  const owned = new Set([...flow.blueprint.hidden, ...flow.blueprint.derived.map((rule) => rule.field), ...Object.keys(flow.identify?.set || {}), ...(flow.items?.field ? [flow.items.field] : []), ...(flow.origin?.field ? [flow.origin.field] : []), ...(Array.isArray(flow.codeFields) ? flow.codeFields : [])]);
  return Object.keys(props).filter((key) => !owned.has(key)).map((key) => fieldFacts(flow.action, flow.blueprint, key));
}

function interpreterPrompt({ companyName, flows, active, state, collected, missing, history, message, lastRequest }) {
  const flowList = flows.map((flow) => ({ flow: flow.key, when: flow.trigger }));
  const activePart = active ? {
    flow: active.key,
    fields: interpreterFields(active),
    already_collected: collected,
    still_missing: missing,
    identified: state.identified || null,
    waiting_for: state.pending_pick ? "the customer to confirm whether the record we found is theirs (yes/no)"
      : state.confirmation_id ? "the customer to confirm the summary (yes/no)"
      : state.choices ? `the customer to choose one of: ${state.choices.map((choice, index) => `${index + 1}) ${choice.label}`).join("; ")}`
      : null
  } : null;
  return [
    `You read ONE customer message sent to ${companyName} on Messenger and convert it into commands for a workflow system. You do not reply to the customer.`,
    "",
    `Workflows this business handles: ${JSON.stringify(flowList)}`,
    activePart ? `Workflow in progress: ${JSON.stringify(activePart)}` : "No workflow is in progress.",
    !activePart && lastRequest ? `This customer's last request (sent ${lastRequest.minutes_ago} minutes ago, ${lastRequest.reference ? `reference ${lastRequest.reference}` : "no reference number yet"}): ${JSON.stringify(lastRequest.summary)}` : "",
    "",
    "Recent conversation:",
    history.length ? history.map((m) => `${m.sender_type === "ai" ? "Business" : "Customer"}: ${String(m.message_text || "").slice(0, 400)}`).join("\n") : "(none)",
    `Customer's new message: ${message}`,
    "",
    "Return JSON only: {\"commands\": [ ... ], \"language\": \"taglish|tagalog|english\"}. Allowed commands:",
    "{\"type\":\"start_flow\",\"flow\":\"<flow>\"} — the customer asks for something a listed workflow handles (only if none is in progress).",
    "{\"type\":\"identify\",\"value\":\"<identifier exactly as the customer wrote it>\"} — e.g. a machine serial number.",
    "{\"type\":\"company\",\"value\":\"<company / organisation / school / office / branch name as written>\"} — whenever the customer names their company or branch (e.g. \"Sa Suhay ito\", \"Kettle Foods, warehouse\"). Always return it, even together with a serial. A PERSON's name is never a company: that is callername. Never put a name into an id field (customerid, branchid, machineid) — those are numbers the system fills.",
    "{\"type\":\"set\",\"field\":\"<field>\",\"value\":<value>} — ONLY for fields listed in the workflow, ONLY for what the customer actually said in this or earlier messages. Map words to allowed values (e.g. 'gumagana pa, okay print' -> the value whose label means running/print OK). Use numbers for numeric codes. For a description field, write a short summary of what they need in their words.",
    "{\"type\":\"choose\",\"option\":<number>} — ONLY when waiting_for lists records to choose from. A number answering a numbered field question (like machine condition 1-4) is a set command for that field.",
    "{\"type\":\"confirm\",\"answer\":\"yes\"|\"no\"} — the customer answered the summary confirmation.",
    "{\"type\":\"cancel\"} — the customer no longer wants the request.",
    "{\"type\":\"forget_me\"} — the customer asks us to delete / forget / not keep their saved details.",
    "{\"type\":\"question\"} — the customer asks something else (prices, information, small talk).",
    "{\"type\":\"handoff\"} — the customer asks for a person or is upset.",
    "{\"type\":\"followup\",\"about\":\"status|complaint|other\"} — no workflow in progress and the customer asks about, chases or complains about their last request (when, why no reference/schedule, nobody called, still waiting, hello again while waiting).",
    "{\"type\":\"contact\",\"field\":\"callername|callerphone|calleremail\",\"value\":\"...\"} — the customer gives their name, phone or email outside a workflow.",
    "{\"type\":\"update_previous\",\"change\":\"<what they want changed>\"} — ONLY when the customer changes a detail of that SAME last request (quantity, colour, contact, condition). A different need (for example a technician visit after an ink request) is a NEW request: use start_flow instead.",
    "Fill EVERY listed field the customer's words already answer (e.g. asking for ink means the request type is ink). Several commands may be returned. Never invent values the customer did not give."
  ].join("\n");
}

/** Voice calls: "number one", "one", "una", "yung pangalawa", "the second one", "#2" -> 1-based option, else 0. */
function spokenChoice(message, count) {
  const t = String(message || "").toLowerCase().replace(/[^a-z0-9#\s]/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\b(first|second|third|fourth|fifth|sixth|pangalawa|pangatlo|pangapat|panglima)\s+one\b/g, "$1");
  if (!t) return 0;
  const words = { one: 1, first: 1, una: 1, isa: 1, two: 2, second: 2, pangalawa: 2, dalawa: 2, three: 3, third: 3, pangatlo: 3, tatlo: 3,
    four: 4, fourth: 4, pangapat: 4, apat: 4, five: 5, fifth: 5, panglima: 5, lima: 5, six: 6, sixth: 6, anim: 6 };
  // Only a bare pick: the number plus filler words. "two yellow" is a quantity, not a pick.
  const filler = new Set(["number", "num", "no", "option", "choice", "the", "a", "yung", "ung", "iyong", "ang", "po", "opo", "please", "ok", "okay",
    "branch", "machine", "department", "that", "is", "it", "its", "mine", "this", "pick", "choose", "i", "ako", "we", "sa", "nasa", "si", "ito", "yes", "oo", "sige", "lang"]);
  const tokens = t.replace(/#/g, " ").split(" ").filter(Boolean);
  let n = 0;
  for (const tok of tokens) {
    if (/^\d{1,2}$/.test(tok)) { if (n) return 0; n = Number(tok); continue; }
    if (words[tok] !== undefined) { if (n && n !== words[tok]) return 0; n = words[tok]; continue; }
    if (!filler.has(tok)) return 0;
  }
  return n >= 1 && n <= count ? n : 0;
}

/** Voice calls: the caller's language from their own words. An explicit request wins and sticks. */
function spokenLanguage(history = [], message = "") {
  const said = [...(history || []).filter((m) => m.sender_type !== "ai").map((m) => String(m.message_text || "")), String(message || "")];
  let asked = "";
  for (const t of said) {
    if (/\b(english|ingles)\b/i.test(t) && /\b(speak|talk|use|in|please|pwede|can|lang|po)\b/i.test(t)) asked = "English";
    if (/\b(tagalog|filipino|taglish)\b/i.test(t) && /\b(speak|talk|use|in|please|pwede|can|lang|po|mag)\b/i.test(t)) asked = "Taglish";
  }
  if (asked) return asked;
  const tagalog = /\b(po|opo|ako|ko|ikaw|kayo|namin|natin|ang|ng|nang|mga|sa|para|kung|pwede|puwede|ba|hindi|oo|kailangan|wala|meron|sige|salamat|lang|naman|yung|ito|iyan|gusto)\b/i;
  return tagalog.test(String(message || "")) ? "Taglish" : "English";
}

function communicatorPrompt({ companyName, tone, addressAs, history, message, language, task, replyStyle = "casual", channel = "facebook_messenger", channelInstructions = "" }) {
  const voiceLanguage = ["phone", "website_call"].includes(channel) ? spokenLanguage(history, message) : "";
  const formal = replyStyle === "formal";
  return [
    `You write ONE ${channel === "email" ? "email" : channel === "website_chat" ? "website chat" : ["phone", "website_call"].includes(channel) ? "spoken phone" : "Messenger"} reply for ${companyName}.`,
    require("./reply-style").rules(replyStyle, channel),
    require("./reply-style").instructionLine(channelInstructions, channel),
    tone ? `Business tone and identity: ${tone}` : "",
    addressAs ? `Address the customer as: ${addressAs}.` : "If you do not know the customer's name yet, do not invent one.",
    voiceLanguage
      ? (voiceLanguage === "English"
        ? "Reply ONLY in English: no Tagalog words, no po/opo."
        : "Reply in natural Taglish (mostly Tagalog with common English words), with po/opo.")
      : formal ? "" : /taglish|tagalog|filipino/i.test(String(language)) || /\b(po|opo|ko|ng|na|ba|ang|kailangan|gumagana|pa)\b/i.test(String(message))
      ? "The customer writes in Tagalog/Taglish, so you MUST reply in natural Taglish (mostly Tagalog with common English words), with po/opo. Do not reply in plain English."
      : "Reply in the same language the customer used.",
    "",
    "Recent conversation:",
    history.length ? history.slice(-4).map((m) => `${m.sender_type === "ai" ? "Business" : "Customer"}: ${String(m.message_text || "").slice(0, 300)}`).join("\n") : "(none)",
    `Customer's new message: ${message}`,
    "",
    `Your task (decided by the system — say only this, nothing more): ${JSON.stringify(task)}`,
    (formal ? "Rules: follow the FORMAL reply style above, in your own words (never copy the task text)." : "Rules: 1-3 short, warm sentences in your own words (never copy the task text).") + " Never tell a schedule day, date or time and never promise when the team will come, deliver or finish unless it is written in tell. Convey every point in tell, ask for every item in ask in one message, and offer allowed options as a short numbered list. Do not ask any question that is not in ask. Never invent numbers, dates, names, staff, references, prices, schedules or promises. Never write a reference number yourself; the system adds it.",
    "Return JSON only: {\"reply\": \"...\"}"
  ].filter(Boolean).join("\n");
}

function readPath(node, path) {
  return String(path || "").split(".").reduce((value, part) => (value && typeof value === "object" ? value[part] : undefined), node);
}

const { notifyCustomerStatus, notifyUnresolvedFollowup } = require("./notify");

function manilaTime(iso) {
  try { return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }).format(new Date(iso)); }
  catch { return ""; }
}

/**
 * A message about the customer's last request (status, chasing, complaint,
 * or giving their contact details). Deterministic: every such message
 * produces actions — staff re-alerted while it is unresolved, the customer
 * emailed the status, missing contact details asked for.
 */
async function handleFollowup({ companyId, conversationId, companyName, message, profile, last, commands, flows }) {
  const known = { ...(profile?.known || {}) };
  for (const item of commands.filter((c) => c.type === "contact")) {
    const value = String(item.value || "").trim();
    if (item.field === "calleremail" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) known.calleremail = value.toLowerCase();
    if (item.field === "callerphone" && value.replace(/\D/g, "").length >= 7) known.callerphone = value;
    if (item.field === "callername" && value.length >= 2) known.callername = value;
  }
  const minutesWaiting = Math.max(1, Math.round((Date.now() - new Date(last.at).getTime()) / 60000));
  const complaint = commands.some((c) => c.type === "followup" && c.about === "complaint");
  // No reference yet = unresolved. A complaint about a saved ticket goes through the complaint alert below.
  let unresolved = !last.reference;
  const settings = await prisma.companySetting.findUnique({ where: { company_id: companyId } });
  const staffTo = require("./notify").alertAudiences(settings).tenant;
  const alertCount = Number(last.alerts || 1) + 1;
  let problem = last.problem;
  let systemName = "";
  const flow = flows.find((item) => item.key === last.flow) || flows[0];
  if (flow) {
    const failed = !problem ? await prisma.businessOperationRequest.findFirst({
      where: { conversation_id: conversationId, tenant_engine_operation_id: flow.id, status: "failed", error_message: { not: null } },
      orderBy: { updated_at: "desc" }, select: { error_message: true }
    }) : null;
    if (failed) problem = failed.error_message;
    const conn = await prisma.integrationConnection.findFirst({ where: { id: flow.action.connection_id } , select: { name: true } }).catch(() => null);
    systemName = conn?.name || "";
  }
  let alerted = false;
  // Which saved request the staff buttons act on (older profiles have no request_id).
  const requestId = last.request_id || (flow ? (await prisma.businessOperationRequest.findFirst({
    where: { conversation_id: conversationId, tenant_engine_operation_id: flow.id, status: { in: ["failed", "retrying"] } },
    orderBy: { updated_at: "desc" }, select: { id: true }
  }).catch(() => null))?.id : null) || null;
  // One case per need (src/cases.js): follow-ups are recorded on the open case, and staff get at
  // most one URGENT alert per case every 15 minutes (the history lists every follow-up).
  const cases = require("./cases");
  const caseRow = requestId ? await cases.currentCase(requestId).catch(() => null) : null;
  const openCase = caseRow && (cases.OPEN_CASE.includes(caseRow.case_status) || (!caseRow.case_status && cases.OPEN_STATUSES.includes(caseRow.status))) ? caseRow : null;
  // A ticket with a reference stays open until done: check it live in the tenant system.
  let ticket = null;
  let overdue = false;
  if (openCase?.case_status === "ticket_open" && openCase.reference) {
    require("./progress").step(conversationId, "Checking the status of your request…");
    const st = await cases.ticketAction({ companyId, conversationId, operationKey: "get_service_status", args: { ticketReference: openCase.reference } }).catch(() => null);
    ticket = st?.ok ? (st.facts?.ticket?.schedule || null) : null;
    if (ticket?.state === "done") {
      await cases.setCase(openCase.id, { case_status: "done", closed_at: new Date() });
      await cases.addHistory(openCase.id, { type: "done", note: `finished in the system ${ticket.finishedAt || ""}`.trim() });
    } else if (ticket?.state === "cancelled") {
      await cases.setCase(openCase.id, { case_status: "cancelled", closed_at: new Date() });
      await cases.addHistory(openCase.id, { type: "cancelled", note: "cancelled in the system" });
    } else if (ticket?.scheduledFor && Date.parse(`${String(ticket.scheduledFor).replace(" ", "T")}+08:00`) < Date.now()) {
      overdue = true;
      unresolved = true;
      problem = `Scheduled ${ticket.scheduledFor} (${ticket.assignedTo || "assigned staff"}) but not finished yet — the customer is following up.`;
    }
  }
  const waitedMinutes = openCase ? Math.max(1, Math.round((Date.now() - cases.caseStartedAt(openCase).getTime()) / 60000)) : minutesWaiting;
  const alertDue = openCase ? cases.alertDue(openCase) : true;
  let heldMinutesAgo = 0;
  // Complaint (Mike 2026-10-20): the customer followed up 3+ times on the same open need, or their
  // words are a complaint. Marks "With Complain" on the ticket once and tells staff it is a complaint.
  const caseOpenNow = Boolean(openCase && cases.OPEN_CASE.includes(openCase.case_status) && !['done', 'cancelled'].includes(ticket?.state));
  const doneButUnhappy = Boolean(complaint && ticket?.state === 'done');
  const followupsNow = openCase ? cases.followupCount(openCase) + 1 : alertCount;
  const isComplaint = Boolean(caseOpenNow && (complaint || followupsNow >= 3));
  const firstComplaint = isComplaint && !(Array.isArray(openCase.followups) ? openCase.followups : []).some((f) => f && f.type === "complaint");
  if (firstComplaint) {
    let flagged = false;
    if (openCase.case_status === "ticket_open" && openCase.reference) {
      const upd = await cases.ticketAction({ companyId, conversationId, operationKey: "update_service_details", args: { ticketReference: openCase.reference, withComplain: true, updatedBy: "Closer" }, actor: "Closer" }).catch(() => ({ ok: false }));
      flagged = Boolean(upd.ok);
    } else {
      // Not a ticket yet: the ticket is created with "With Complain" when staff save it.
      const args = { ...(openCase.requested_arguments || {}), withcomplain: true };
      await prisma.businessOperationRequest.update({ where: { id: openCase.id }, data: { requested_arguments: args } }).catch(() => {});
      flagged = true;
    }
    await cases.addHistory(openCase.id, { type: "complaint", note: complaint ? "the customer's words are a complaint" : `${followupsNow} follow-ups`, said: String(message || "").slice(0, 300), ticket_flagged: flagged });
  }
  if ((isComplaint || doneButUnhappy) && !unresolved && alertDue) {
    // The ticket is open and on time, but the customer is complaining: staff must call them.
    const sent = await require("./notify").notifyComplaint({
      settings, companyName, customerMessage: message, followups: followupsNow, reference: openCase.reference,
      reason: doneButUnhappy ? "The job is marked DONE in the system but the customer says it is not OK." : complaint ? "Their message is a complaint." : `They followed up ${followupsNow} times about the same request.`,
      ticket, details: last.summary, history: cases.historyLines(openCase), ticked: isComplaint,
      contact: { name: known.callername, phone: known.callerphone, email: known.calleremail }
    }).catch(() => ({ ok: false }));
    if (sent.ok) { alerted = true; if (openCase) await cases.markAlerted(openCase.id); }
    if (doneButUnhappy && openCase) await cases.addHistory(openCase.id, { type: "complaint", note: "done in the system but the customer says it is not OK", said: String(message || "").slice(0, 300) });
  }
  if (unresolved && alertDue) {
    const followups = followupsNow;
    const sent = await notifyUnresolvedFollowup({
      complaint: isComplaint,
      settings, companyName, minutesWaiting: waitedMinutes, customerMessage: message, problem, systemName,
      details: last.summary, alertCount: followups, requestId: openCase?.id || requestId, claimedBy: last.claimed_by || null,
      history: openCase ? cases.historyLines(openCase) : [],
      contact: { name: known.callername, phone: known.callerphone, email: known.calleremail }
    }).catch(() => ({ ok: false }));
    alerted = Boolean(sent.ok);
  } else if (unresolved && openCase?.last_alert_at) {
    heldMinutesAgo = Math.max(1, Math.round((Date.now() - new Date(openCase.last_alert_at).getTime()) / 60000));
  }
  // Every follow-up on an open case is counted (3+ = complaint), not only the unresolved ones.
  if (caseOpenNow) {
    await cases.addHistory(openCase.id, { type: "followup", said: String(message || "").slice(0, 300), minutes_waiting: waitedMinutes, alerted });
    if (alerted && unresolved) await cases.markAlerted(openCase.id);
  }
  // Customer status email: when the email is new, or at most every 30 min.
  let emailed = false;
  const emailIsNew = known.calleremail && known.calleremail !== profile?.known?.calleremail;
  const lastEmailAt = last.customer_emailed_at ? new Date(last.customer_emailed_at).getTime() : 0;
  if (known.calleremail && (emailIsNew || Date.now() - lastEmailAt > 30 * 60 * 1000)) {
    const sent = await notifyCustomerStatus({
      companyId, conversationId,
      to: known.calleremail, companyName, customerName: known.callername || "",
      statusText: last.reference
        ? `Your request is saved under reference ${last.reference} and our team is handling it.`
        : `Your request (sent ${manilaTime(last.at)}) is with our team for scheduling. ${alerted ? "We have reminded them again as urgent." : ""}`.trim(),
      nextStep: last.reference ? "" : "You will receive the reference number as soon as it is scheduled.",
      reference: last.reference || null,
      details: last.summary
    }).catch(() => ({ ok: false }));
    emailed = Boolean(sent.ok);
  }
  const updatedLast = { ...last, alerts: unresolved && alerted ? alertCount : last.alerts, last_alert_at: alerted ? new Date().toISOString() : last.last_alert_at, customer_emailed_at: emailed ? new Date().toISOString() : last.customer_emailed_at };
  const fresh = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { customer_profile: true } });
  await prisma.conversation.update({ where: { id: conversationId }, data: { customer_profile: { ...(fresh?.customer_profile || {}), known, last_request: updatedLast } } }).catch(() => {});

  // Customers are never told a schedule day/time unless the business allows it (Customer Service > Scheduling cut-off).
  const showDate = (await require("./scheduling-rules").settingsForEngine(companyId, "customer_service")).tell_customer_schedule;
  const tell = [`their request was passed to the team at ${manilaTime(openCase ? cases.caseStartedAt(openCase).toISOString() : last.at)} (${waitedMinutes} minutes ago)`];
  if (ticket?.state === "done") tell.push(`it was completed${ticket.finishedAt ? ` on ${ticket.finishedAt}` : ""}; ask them to reply if anything is still not right`);
  else if (ticket?.state === "cancelled") tell.push("it was cancelled in our system; ask whether they still need it");
  else if (overdue) tell.push(`it was scheduled${showDate ? ` for ${ticket.scheduledFor}` : ""} and is not finished yet; the team was alerted to follow up urgently`);
  else if (ticket?.scheduledFor) tell.push(showDate ? `it is saved and scheduled for ${ticket.scheduledFor}; the system adds the reference number below` : "it is saved and in our team's schedule (do not give any day, date or time); the system adds the reference number below");
  else if (last.reference) tell.push(`it is saved; the system adds the reference number below`);
  else tell.push("there is no reference number yet because the team still has to schedule it; the number will be sent as soon as it is scheduled");
  if (last.claimed_by?.name && !last.reference) tell.push(`${last.claimed_by.name} from the team is personally handling it`);
  if (isComplaint || doneButUnhappy) tell.push("we are sorry for the trouble; their concern is marked as a complaint so a senior team member looks at it");
  if (alerted) tell.push("we alerted the team again just now and marked it urgent");
  else if (heldMinutesAgo) tell.push(`the team was alerted ${heldMinutesAgo} minutes ago and it is marked urgent`);
  if (emailed) tell.push(`a status update was emailed to ${known.calleremail}`);
  const ask = [];
  if (!known.calleremail) ask.push({ item: "their email address, so we can send the reference number and status updates" });
  if (!known.callerphone) ask.push({ item: "a mobile or landline number where the team can reach them" });
  return {
    task: { task: "status_update", tell, ask: ask.length ? ask : undefined, reference: last.reference || null, do_not_promise_a_call: true, do_not_apologize_more_than_once: true },
    alerted, emailed
  };
}

/** Ask about ONE open request (numbered, required before anything new): still needed / received / cancel. */
function stillNeededTask(row, count) {
  const cases = require("./cases");
  const since = cases.caseStartedAt(row).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return {
    task: "confirm_open_case",
    tell: [
      `they still have an open request: ${cases.caseSummary(row)} (since ${since}${row.reference ? `, reference ${row.reference}` : ", still waiting for the team to schedule it"})`,
      count > 1 ? `they have ${count} open requests; we check each one before taking a new one` : "before taking a new request we confirm what happened to that one"
    ],
    ask: [{ item: "what happened to that open request", options: ["1 = Still needed", "2 = Already received / done", "3 = No longer needed (cancel it)"] }],
    do_not_promise_a_call: true
  };
}

/** Before asking: a ticket already finished/cancelled in the tenant system is closed, not asked about. */
async function refreshOpenTickets(companyId, conversationId, rows) {
  const cases = require("./cases");
  const open = [];
  for (const row of rows) {
    if (row.case_status === "ticket_open" && row.reference) {
      const st = await cases.ticketAction({ companyId, conversationId, operationKey: "get_service_status", args: { ticketReference: row.reference } }).catch(() => null);
      const state = st?.ok ? st.facts?.ticket?.schedule?.state : null;
      if (state === "done" || state === "cancelled") {
        await cases.setCase(row.id, { case_status: state, closed_at: new Date() });
        await cases.addHistory(row.id, { type: state, note: `${state} in the system` });
        continue;
      }
    }
    open.push(row);
  }
  return open;
}

/**
 * The customer's answer about an open request (fixed step):
 *   1 / "still needed"  -> keep it open
 *   2 / "received, done" -> DONE: ticket closed in the tenant system (counts as a visit/delivery)
 *   3 / "not needed"    -> CANCELLED: ticket cancelled (counts as nothing)
 * Worded answers meaning done or cancel are confirmed once ("1 = Yes / 2 = No, still needed").
 */
async function handleOpenCheckAnswer({ companyId, conversationId, message, commands, pendingCheck, profile, flows, writeReply, runAgain, callModelJSON }) {
  const cases = require("./cases");
  const text = String(message || "").trim();
  const confirmCmd = commands.find((item) => item.type === "confirm");
  const chooseCmd = commands.find((item) => item.type === "choose" && [1, 2, 3].includes(Number(item.option)));
  const num = (/^\s*([123])\s*[.)]?\b/.exec(text) || [])[1] || (chooseCmd ? String(chooseCmd.option) : null);
  const ids = [...pendingCheck.case_ids];
  let row = null;
  while (ids.length && !row) {
    const candidate = await prisma.businessOperationRequest.findUnique({ where: { id: ids[0] } });
    if (candidate && cases.OPEN_CASE.includes(candidate.case_status)) row = candidate; else ids.shift();
  }
  const saveCheck = async (next) => {
    const fresh = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { customer_profile: true } });
    const prof = { ...(fresh?.customer_profile || {}) };
    if (next) prof.pending_open_check = next; else delete prof.pending_open_check;
    await prisma.conversation.update({ where: { id: conversationId }, data: { customer_profile: prof } });
  };
  const confirmTask = (what) => ({
    task: "confirm_open_case_action",
    tell: [what === "done"
      ? `to be sure: we will record their open request ${cases.caseSummary(row)}${row.reference ? ` (${row.reference})` : ""} as received / completed`
      : `to be sure before cancelling: their open request ${cases.caseSummary(row)}${row.reference ? ` (${row.reference})` : ""} will be cancelled${row.reference ? " and its schedule removed" : ""}`],
    ask: [{ item: "confirmation", options: [what === "done" ? "1 = Yes, it was received / done" : "1 = Yes, cancel it", "2 = No, it is still needed"] }],
    do_not_promise_a_call: true
  });

  let answer = null; // keep | done | cancel
  if (row && pendingCheck.confirm_action && pendingCheck.confirm_case_id === row.id) {
    // Second question after a worded "received" or "not needed": 1 = yes / 2 = no, still needed.
    if (num === "1" || confirmCmd?.answer === "yes") answer = pendingCheck.confirm_action;
    else if (num === "2" || confirmCmd?.answer === "no") answer = "keep";
    if (!answer) return { reply: await writeReply({ task: { ...confirmTask(pendingCheck.confirm_action), tell: ["we still need a clear answer first", ...confirmTask(pendingCheck.confirm_action).tell] } }), needsHuman: false, handoffReason: "", task: "confirm_open_case_action" };
  } else if (row) {
    let worded = null;
    if (num === "1") answer = "keep";
    else if (num === "2") answer = "done";
    else if (num === "3") answer = "cancel";
    else if (callModelJSON && text) {
      try {
        const out = await callModelJSON([
          `A customer was asked about their OPEN request ${JSON.stringify(cases.caseSummary(row))}: 1 = still needed, 2 = already received / done, 3 = no longer needed (cancel).`,
          `Customer's reply: ${JSON.stringify(text.slice(0, 500))}`,
          'Return JSON only: {"answer": "keep" | "done" | "cancel" | "unclear"}.',
          "keep = still needed. done = they already received it / it was done or delivered. cancel = they do not need it anymore. unclear = anything else (a new request, a question, a serial number, a greeting)."
        ].join("\n"), "open_check");
        if (["keep", "done", "cancel"].includes(out?.answer)) worded = out.answer;
      } catch (error) { console.warn("[director] open-check classify failed: %s", error.message); }
    }
    if (worded === "keep") answer = "keep";
    else if (worded === "done" || worded === "cancel") {
      await saveCheck({ ...pendingCheck, case_ids: ids, confirm_action: worded, confirm_case_id: row.id });
      return { reply: await writeReply({ task: confirmTask(worded) }), needsHuman: false, handoffReason: "", task: "confirm_open_case_action" };
    }
    if (!answer) {
      const t = stillNeededTask(row, ids.length);
      return { reply: await writeReply({ task: { ...t, tell: ["we still need their answer about the open request before we take the new one", ...t.tell] } }), needsHuman: false, handoffReason: "", task: "confirm_open_case" };
    }
  }

  const notes = [];
  if (row && answer) {
    const label = `${cases.caseSummary(row)}${row.reference ? `, ${row.reference}` : ""}`;
    const settings = await prisma.companySetting.findUnique({ where: { company_id: companyId } });
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    const tellStaff = async (subject, body) => require("./notify").sendToTenantAndPlatform({ settings, tenantName: company?.name || "", build: () => ({ subject, text: body, html: `<p>${body.replace(/\n/g, "<br>")}</p>` }) }).catch(() => {});
    if (answer === "keep") {
      await cases.addHistory(row.id, { type: "still_needed" });
      notes.push(`their open request (${label}) stays open as they confirmed`);
    } else if (answer === "done") {
      let closedInSystem = false;
      if (row.case_status === "ticket_open" && row.reference) {
        const r = await cases.ticketAction({ companyId, conversationId, operationKey: "close_service_request", args: { ticketReference: row.reference, reason: "Customer confirmed it was received / done", closedBy: "Closer (customer confirmed)" }, actor: "closer" });
        closedInSystem = r.ok || /already/i.test(String(r.detail));
      }
      await cases.setCase(row.id, { case_status: "done", closed_at: new Date() });
      await cases.addHistory(row.id, { type: "done", note: `customer confirmed it was received / done${closedInSystem ? "; closed in the system" : ""}` });
      const ref = row.reference || cases.shortCode(row.id);
      await tellStaff(
        row.reference ? `Customer confirmed received: ${ref} — ${cases.caseSummary(row)}` : `ACTION NEEDED: customer says received but there is NO ticket — ${cases.caseSummary(row)}`,
        row.reference
          ? `The customer said ${ref} was already received / done.${closedInSystem ? " It was closed as done in your system." : " Please close it as done in your system (it could not be closed automatically)."}`
          : `The customer said this request (${ref}) was already received / done, but it was never saved as a ticket. Please record the delivery/visit in your system so it counts in the customer's costs.`
      );
      notes.push(`their open request (${label}) is recorded as received / done as they said`);
    } else if (answer === "cancel") {
      let cancelledInSystem = false;
      if (row.case_status === "ticket_open" && row.reference) {
        const r = await cases.ticketAction({ companyId, conversationId, operationKey: "cancel_service", args: { ticketReference: row.reference, reason: "Customer said it is no longer needed", cancelledBy: "Closer (customer confirmed)" }, actor: "closer" });
        cancelledInSystem = r.ok;
      }
      await cases.setCase(row.id, { case_status: "cancelled", closed_at: new Date() });
      await cases.addHistory(row.id, { type: "cancelled", note: `customer said it is no longer needed${cancelledInSystem ? "; schedule cancelled in the system" : ""}` });
      await tellStaff(`Customer cancelled ${row.reference || cases.shortCode(row.id)}: ${cases.caseSummary(row)}`,
        `The customer said this request is no longer needed.${row.reference ? (cancelledInSystem ? " The schedule was cancelled in your system." : " Please cancel the schedule in your system (it could not be cancelled automatically).") : ""}`);
      notes.push(`their old request (${label}) is cancelled as they said`);
    }
    ids.shift();
  }
  while (ids.length) {
    const next = await prisma.businessOperationRequest.findUnique({ where: { id: ids[0] } });
    if (next && cases.OPEN_CASE.includes(next.case_status)) {
      await saveCheck({ ...pendingCheck, case_ids: ids, confirm_action: null, confirm_case_id: null });
      const t = stillNeededTask(next, ids.length);
      t.tell = [...notes, ...t.tell];
      return { reply: await writeReply({ task: t }), needsHuman: false, handoffReason: "", task: "confirm_open_case" };
    }
    ids.shift();
  }
  await saveCheck(null);
  // All open requests answered: now take the new request; details added while answering are kept.
  const freshProfile = (await prisma.conversation.findUnique({ where: { id: conversationId }, select: { customer_profile: true } }))?.customer_profile || {};
  const answerOnly = /^\s*[123]\s*[.)]?\s*$/.test(text) || text.length <= 12;
  const continuation = answerOnly ? pendingCheck.new_message : `${pendingCheck.new_message}\n${text}`;
  const continued = await runAgain({ message: continuation, profile: freshProfile, skipOpenCheck: true, extraTell: notes, forceFlowKey: pendingCheck.flow || null });
  if (continued) return continued;
  return { reply: await writeReply({ task: { task: "open_requests_confirmed", tell: notes } }), needsHuman: false, handoffReason: "", task: "open_requests_confirmed" };
}

/**
 * Run one customer turn through the Director. Returns null when no workflow
 * applies (the normal Closer path answers), or { reply, needsHuman, handoffReason, task }.
 */

const { cleanIdentifier, closest, contextScore } = require("./fuzzy-match");
const branchMatch = require("./branch-match");

// Call-step notes per live call (serial -> name -> company -> location ...). Kept here because the early
// steps happen before any request draft exists to hold them. Cleared at the start of each new call.
const VOICE_FLOWS = new Map();
const VOICE_KEEP = ["vflow", "choices", "pending_pick", "branch_list", "branch_company", "branch_ask", "items_colors", "identified", "identified_set", "voice_kind", "voice_models"];
function clearVoiceFlow(conversationId) { VOICE_FLOWS.delete(String(conversationId || "")); }

async function runDirectorTurn({ companyId, conversationId, message, history, companyName, tone, profile, callModelJSON, turnStartedAt, skipOpenCheck = false, extraTell = [], forceFlowKey = null, channel = "facebook_messenger", replyStyle = "casual", channelInstructions = "" }) {
  // Voice helpers first: writeReply (used by early returns) needs them (2026-10-22).
  const VOICE = ["phone", "website_call"].includes(channel);
  const SERIAL_RE = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10,}\b/gi; // serials: 10+ letters+digits, no dash (models keep their dash)
  const noSerial = (t) => String(t || "").replace(/\s*[—-]?\s*serial( number)?( ending)?\s*(?=[A-Z0-9-]*\d)[A-Z0-9-]+/gi, "").replace(SERIAL_RE, "").replace(/\s*—\s*—\s*/g, " — ").replace(/(^\s*—\s*|\s*—\s*$)/g, "").trim();
  const spellSerial = (t) => String(t || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().split("").join(", ");
  const isQuestion = (t) => /\?\s*$/.test(String(t || "").trim()) || /^\s*(what|which|who|where|when|why|how|can you|could you|did you|do you|is it|are you|ano|alin|sino|saan|paano|bakit|pwede|puwede|ilan)\b/i.test(String(t || ""));
  const flows = await loadFlows(companyId);
  if (!flows.length || !conversationId) return null;
  // Live steps for the website chat ("Looking up your machine…"), src/progress.js.
  const P = (text) => require("./progress").step(conversationId, text);
  P("Reading your message…");
  let current = await activeDraft(companyId, conversationId, flows);
  let active = current?.flow || null;
  const state = { ...((current?.draft?.result && current.draft.result.director) || {}) };
  if (["phone", "website_call"].includes(channel)) {
    const kept = VOICE_FLOWS.get(String(conversationId));
    if (kept && Date.now() - kept.at < 30 * 60 * 1000) {
      for (const k of VOICE_KEEP) if (state[k] === undefined || state[k] === null) state[k] = kept.state[k] ?? state[k];
      // The request type stays open for the whole call, even before a draft exists.
      if (!active && kept.flow) active = flows.find((f) => f.key === kept.flow) || null;
    }
    if (/\btoners?\b|\blaser\b/i.test(String(message || ""))) state.voice_kind = "toner";
    else if (/\b(inks?|tinta)\b/i.test(String(message || "")) && !state.voice_kind) state.voice_kind = "ink";
    {
    }
  }
  const collected = current ? labelArguments(current.draft.requested_arguments || {}, active.blueprint) : {};
  const missingNow = current ? (current.draft.result?.last_missing || []) : [];

  // Open cases come from the database and never expire (waiting for staff, or ticket open until done).
  const cases = require("./cases");
  const openCases = await cases.openCasesForConversation(companyId, conversationId).catch(() => []);
  const newestOpen = openCases[openCases.length - 1] || null;
  let last = profile?.last_request && profile.last_request.at ? profile.last_request : null;
  if (newestOpen) {
    const flowOf = flows.find((flow) => flow.id === newestOpen.tenant_engine_operation_id) || flows[0];
    last = {
      ...(last && (!last.request_id || last.request_id === newestOpen.id) ? last : {}),
      flow: flowOf?.key, request_id: newestOpen.id, at: cases.caseStartedAt(newestOpen).toISOString(),
      reference: newestOpen.reference || null, summary: labelArguments(newestOpen.requested_arguments || {}, flowOf?.blueprint || { valueLabels: {} }),
      problem: newestOpen.case_status === "waiting" ? newestOpen.error_message : null, case_status: newestOpen.case_status
    };
  }
  // Unresolved requests stay "open" for follow-ups for 3 days, resolved ones for 2 hours.
  const lastAge = last ? Date.now() - new Date(last.at).getTime() : Infinity;
  const lastOpen = newestOpen ? true : (last && !last.closed_at ? lastAge < 2 * 60 * 60 * 1000 : false);
  const lastRequest = last && lastOpen
    ? { summary: last.summary, reference: last.reference || null, minutes_ago: Math.round(lastAge / 60000) }
    : null;
  const iPrompt = interpreterPrompt({ companyName, flows, active, state, collected, missing: missingNow, history, message, lastRequest });
  // Voice calls: the words come from speech recognition and the caller will not repeat themselves.
  const iPromptVoice = ["phone", "website_call"].includes(channel)
    ? `${iPrompt}\n\nPHONE CALL: whenever the caller names something that matches an allowed option of a field (for example the request type), output a "set" command for that field in this same answer. Do not wait for them to repeat it.`
    : iPrompt;
  let interpreted = await callModelJSON(iPromptVoice, "interpreter");
  // The local model sometimes answers lazily (["start_flow","company","set"]: names only, no details).
  // Ask once more, strictly, instead of losing the request (2026-10-20).
  const lazy = (r) => !Array.isArray(r?.commands) || r.commands.some((item) => !item || typeof item !== "object");
  if (lazy(interpreted)) {
    console.warn("[director] interpreter answer unusable (%s), asking again", JSON.stringify(interpreted).slice(0, 160));
    const again = await callModelJSON(`${iPrompt}\n\nIMPORTANT: your previous answer was invalid. Every command MUST be a JSON object with a "type" key and its details, for example {"type":"start_flow","flow":"${flows[0]?.key || "<flow>"}"} or {"type":"company","value":"<name>"}. Plain strings are not allowed.`, "interpreter").catch(() => null);
    if (again && !lazy(again)) interpreted = again;
  }
  let commands = Array.isArray(interpreted?.commands) ? interpreted.commands.filter((item) => item && typeof item === "object") : [];
  // Voice calls: a spoken pick from a pending list is read by code, not by the AI (which mistook
  // "number one" for a branch id, 2026-10-21). Only when the caller says nothing else of substance.
  if (["phone", "website_call"].includes(channel) && Array.isArray(state?.choices) && state.choices.length) {
    const n = spokenChoice(message, state.choices.length);
    if (n) commands = [{ type: "choose", option: n }];
  }
  const language = interpreted?.language || "";
  const has = (type) => commands.some((item) => item.type === type);
  const call = (tool, args) => be.executeBusinessEngineTool({ companyId, conversationId, name: tool, args, turnStartedAt, requestedBy: "director" });

  // Saved details with permission (Mike 2026-10-20), every channel: consent answer and "forget my details".
  const contacts = require("./contacts");
  const consentCmd = commands.find((item) => item.type === "consent" && ["yes", "no"].includes(String(item.answer).toLowerCase()));
  if (consentCmd) {
    const answer = String(consentCmd.answer).toLowerCase();
    await contacts.setConsent(companyId, conversationId, answer);
    profile = { ...(profile || {}), consent: answer };
  }
  if (has("forget_me")) {
    await contacts.forget(companyId, conversationId);
    profile = { consent: "no" };
    if (!commands.some((item) => ["start_flow", "set", "identify", "confirm", "choose"].includes(item.type))) {
      return { reply: await writeReply({ task: { task: "forgot_details", tell: ["their saved details were deleted as they asked", "next time we will ask for them again"] } }), needsHuman: false, handoffReason: "", task: "forgot_details" };
    }
  }

  // FIXED STEP (code, not the AI): before any NEW request while this customer has open ones,
  // the customer must say whether each open request is still needed. Nothing new is created first.
  const pendingCheck = profile?.pending_open_check && Array.isArray(profile.pending_open_check.case_ids) && profile.pending_open_check.case_ids.length ? profile.pending_open_check : null;
  if (pendingCheck && !skipOpenCheck) {
    return handleOpenCheckAnswer({ companyId, conversationId, message, commands, pendingCheck, profile, flows, writeReply, callModelJSON, runAgain: (args) => runDirectorTurn({ companyId, conversationId, history, companyName, tone, callModelJSON, turnStartedAt, channel, replyStyle, channelInstructions, ...args }) });
  }
  // With open requests, adding or changing something also goes through the fixed "what happened to it?" step.
  const startsRequest = commands.some((item) => (item.type === "start_flow" && flows.some((flow) => flow.key === item.flow)) || ["set", "identify", "company", "update_previous"].includes(item.type));
  if (!active && !skipOpenCheck && openCases.length && startsRequest) {
    const stillOpen = await refreshOpenTickets(companyId, conversationId, openCases);
    if (stillOpen.length) {
      const fresh = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { customer_profile: true } });
      // Keep what the customer asked for (their recent request messages, not bare "1"/"2"), so the
      // new request is not lost whichever message triggered this check.
      const asks = [...(history || []).filter((m) => m.sender_type === "customer").map((m) => String(m.message_text || "")), String(message || "")]
        .map((t) => t.trim()).filter((t) => t.length > 3 && !/^[12]\s*[.)]?$/.test(t)).slice(-3);
      const askedFlow = (commands.find((item) => item.type === "start_flow" && flows.some((flow) => flow.key === item.flow)) || {}).flow || (flows.find((flow) => flow.id === stillOpen[0].tenant_engine_operation_id) || flows[0])?.key;
      const check = { flow: askedFlow, case_ids: stillOpen.map((row) => row.id), new_message: [...new Set(asks)].join("\n").slice(0, 1000) || String(message || "").slice(0, 1000), asked_at: new Date().toISOString() };
      await prisma.conversation.update({ where: { id: conversationId }, data: { customer_profile: { ...(fresh?.customer_profile || {}), pending_open_check: check } } });
      const first = stillOpen[0];
      await cases.addHistory(first.id, { type: "asked_still_needed" });
      const reply = await writeReply({ task: stillNeededTask(first, stillOpen.length) });
      console.log("[director] company=%s open-case check: %d open, asking about %s", companyId, stillOpen.length, first.reference || cases.shortCode(first.id));
      return { reply, needsHuman: false, handoffReason: "", task: "confirm_open_case" };
    }
  }

  if (!active && lastRequest && !commands.some((item) => item.type === "start_flow")
    && (commands.some((item) => item.type === "followup") || commands.some((item) => item.type === "contact"))
    && !commands.some((item) => item.type === "update_previous")) {
    const result = await handleFollowup({ companyId, conversationId, companyName, message, profile, last, commands, flows });
    const reply = await writeReply({ task: result.task });
    if (!reply) throw new Error("Director communicator returned an empty reply");
    console.log("[director] company=%s followup task=%s alerted=%s emailed=%s", companyId, result.task.task, result.alerted, result.emailed);
    return { reply: result.task.reference ? `${reply}\n\nReference number: ${result.task.reference}` : reply, needsHuman: false, handoffReason: "", task: result.task.task };
  }
  if (!active && lastRequest && commands.some((item) => item.type === "update_previous") && !commands.some((item) => item.type === "start_flow")) {
    // A change to a request already handed to the team: the team must hear it.
    const change = commands.find((item) => item.type === "update_previous").change || message;
    const reply = await writeReply({ task: { task: "update_previous", tell: ["the team handling their request has been told about this change and will update it"], change, do_not_say_it_is_already_updated: true } });
    return { reply, needsHuman: true, handoffReason: `Customer changed their last request (${last.flow || "request"}): ${String(change).slice(0, 300)}. Request: ${JSON.stringify(last.summary).slice(0, 300)}`, task: "update_previous" };
  }
  if (!active) {
    const start = commands.find((item) => item.type === "start_flow" && flows.some((flow) => flow.key === item.flow));
    // After the "still needed?" check the system already knows a new request is being made.
    const forced = !start && forceFlowKey ? flows.find((flow) => flow.key === forceFlowKey) : null;
    if (!start && !forced) { console.log("[director] not a request: commands=%s", JSON.stringify(commands).slice(0, 300)); return null; } // not a workflow message: normal Closer answers
    active = forced || flows.find((flow) => flow.key === start.flow);
  } else if (!commands.some((item) => ["set", "identify", "company", "choose", "confirm", "cancel", "handoff"].includes(item.type))) {
    // Calls in the middle of the identification steps: the Director answers the question itself.
    if (has("question") && !(["phone", "website_call"].includes(channel) && state.vflow?.stage && !state.identified)) return null; // digression: normal Closer answers; the request stays open and resumes
  }

  let task;
  let needsHuman = false;
  let handoffReason = "";
  const args = {};
  const allowed = new Set(interpreterFields(active).map((field) => field.field));
  // Name / phone / email given during a request count as request fields ("contact" or "set").
  for (const item of commands) if ((item.type === "set" || item.type === "contact") && allowed.has(item.field) && item.value !== undefined && item.value !== null && item.value !== "") args[item.field] = item.value;
  // A value under a field name the action does not have (e.g. "request_type": "toner"): put it in the
  // field whose allowed values contain it (e.g. category). Only exact allowed values are accepted.
  for (const item of commands) {
    if (item.type !== "set" || allowed.has(item.field) || item.value === undefined || item.value === null || item.value === "") continue;
    const value = String(item.value).trim().toLowerCase();
    const props = active.action?.input_schema?.properties || {};
    const target = [...allowed].find((field) => args[field] === undefined && (
      (Array.isArray(props[field]?.enum) && props[field].enum.map((v) => String(v).toLowerCase()).includes(value)) ||
      Object.entries(active.blueprint?.valueLabels?.[field] || {}).some(([v, label]) => String(v).toLowerCase() === value || String(label).toLowerCase() === value)
    ));
    if (target) {
      const exact = (props[target]?.enum || []).find((v) => String(v).toLowerCase() === value);
      args[target] = exact !== undefined ? exact : item.value;
    }
  }

  if (has("handoff")) {
    needsHuman = true;
    handoffReason = "The customer asked for a person during a request.";
    task = { task: "handoff", tell: ["a team member will take over this conversation"] };
  } else if (has("cancel") && current) {
    await prisma.businessOperationRequest.update({ where: { id: current.draft.id }, data: { status: "cancelled", completed_at: new Date() } });
    return { reply: await writeReply({ task: { task: "cancelled", tell: ["the request is cancelled as they asked"] } }), needsHuman: false, handoffReason: "", task: "cancelled" };
  }

  // Remembered contact details (name, number) are reused, not asked again.
  if (!current && profile?.known && profile.consent !== "no") {
    for (const key of active.blueprint.remember) if (profile.known[key] !== undefined && args[key] === undefined) args[key] = profile.known[key];
  }
  // Remembered record from this customer's earlier request (e.g. same machine).
  if (!current && active.identify && profile?.consent !== "no" && profile?.last_identified?.flow === active.key && profile.last_identified.set) {
    // Remembered machine is CONFIRMED with the customer first (Mike 2026-10-22): company, branch and
    // serial are shown and only used after a yes. Serial is never spoken on calls (model + company + branch there).
    const remembered = (profile.machines || []).find((m) => m && String(m.machine_id) === String(profile.last_identified.set.machineid));
    const label = profile.last_identified.label
      || (remembered ? [remembered.model, remembered.company, remembered.branch].filter(Boolean).join(" — ") : null);
    const serial = remembered?.serial && !["phone", "website_call"].includes(channel) && !String(label || "").includes(remembered.serial) ? `serial ending ${String(remembered.serial).slice(-4)}` : null;
    state.pending_pick = { set: profile.last_identified.set, full: [label, serial].filter(Boolean).join(" — ") || "the machine from their last request" };
    state.memory_confirm_now = true;
  }

  // Identification (code runs the lookup, never the model).
  // "1" answering a numbered question is a value for that field, not a record choice.
  if (!Array.isArray(state.choices) && state.last_options_field) {
    for (const item of commands) {
      if (item.type === "choose" && Number(item.option) > 0 && args[state.last_options_field] === undefined) args[state.last_options_field] = Number(item.option);
    }
  }
  // Several machines matched a partial serial: pick by the company / branch words the customer gives.
  let narrowedNow = false;
  const hadCandidates = Array.isArray(state.candidates) && state.candidates.length > 0;
  if (!task && active.identify && hadCandidates) {
    const words = String(message || "").toLowerCase().split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !["the", "and", "ang", "kami", "po", "dept", "department", "branch", "corp", "inc", "company"].includes(w));
    const scored = state.candidates.map((option) => ({ option, score: words.filter((w) => String(option.label).toLowerCase().includes(w)).length })).filter((x) => x.score > 0);
    const best = scored.length ? Math.max(...scored.map((x) => x.score)) : 0;
    const top = scored.filter((x) => x.score === best).map((x) => x.option);
    if (top.length === 1) { Object.assign(args, top[0].set); state.identified = top[0].label; state.candidates = null; narrowedNow = true; }
    else if (top.length > 1) { state.candidates = top; task = { task: "narrow_down", tell: ["still more than one machine matches"], ask: [{ item: "the exact branch / department name, or the full serial number on the machine sticker" }], do_not_list_records: true }; }
  }
  // While narrowing down, a repeated short identifier (e.g. the same last 4 digits) is ignored; a full serial still counts.
  let identifyCommand = narrowedNow ? null : commands.find((item) => item.type === "identify" && item.value && !(hadCandidates && String(item.value).replace(/\s/g, "").length < 6));
  // Resuming after the "still needed?" step: the customer may already have given the identifier
  // (e.g. the serial). Try identifier-looking words from what they wrote; only a single exact match counts.
  if (!identifyCommand && forceFlowKey && !current && active.identify && !state.identified) {
    const tokens = [...new Set(String(message || "").split(/[^A-Za-z0-9-]+/).filter((t) => t.length >= 6 && /\d/.test(t) && /^[A-Za-z0-9-]+$/.test(t)))].slice(0, 3);
    for (const token of tokens) {
      const found = await call(toolForKey(active.identify.operation), { [active.identify.input]: token }).catch(() => null);
      const list = found?.ok ? (readPath(found.facts, active.identify.list) || []) : [];
      if (Array.isArray(list) && list.length === 1) {
        Object.assign(args, Object.fromEntries(Object.entries(active.identify.set || {}).map(([field, path]) => [field, readPath(list[0], path)])));
        state.identified = (active.identify.describe || []).map((path) => readPath(list[0], path)).filter(Boolean).join(" — ");
        break;
      }
    }
  }
  // ---- Identification, done by CODE (2026-10-20, Mike: "remove all possible errors") ----
  // 1) serial: from the interpreter AND from the raw message, cleaned (labels, punctuation), exact ->
  //    letters+digits only -> last 6 characters (only a single match counts);
  // 2) company / branch name (not a person): customer search -> that customer's machines -> choose;
  // 3) still nothing: ask once for the company name, then hand to staff. Never "check it again" loops.
  const lookupTool = active.identify ? toolForKey(active.identify.operation) : null;
  const byName = active.identify?.by_name || null;
  const idFields = new Set(Object.keys(active.identify?.set || {}));
  const toOption = (item, extra = {}) => {
    const set = Object.fromEntries(Object.entries(active.identify.set || {}).map(([field, path]) => [field, readPath(item, path) ?? extra[field]]));
    return { set, label: [...new Set((active.identify.describe || []).map((path) => readPath(item, path)).filter(Boolean).map(String))].join(" — ") };
  };
  const idCfg = active.identify || {};
  const what = idCfg.name || "number";                 // e.g. "serial number", "room number", "plan id"
  const cleanId = (raw) => cleanIdentifier(raw, idCfg.labels || []);
  async function lookupSerial(raw) {
    P("Looking up your machine in our records…");
    const cleaned = cleanId(raw);
    const tries = [...new Set([cleaned, cleaned.replace(/[^A-Za-z0-9]/g, "")])].filter((v) => v.length >= (idCfg.min_length || 4));
    for (const value of tries) {
      const found = await call(lookupTool, { [idCfg.input]: value }).catch(() => null);
      const list = found?.ok ? (readPath(found.facts, idCfg.list) || []) : [];
      if (Array.isArray(list) && list.length && !found.facts?.fuzzy) return { value, options: list.map((item) => toOption(item)), exact: true };
    }
    const compact = cleaned.replace(/[^A-Za-z0-9]/g, "");
    if (compact.length >= 8 && idCfg.tail_search !== false) {
      const tail = compact.slice(-6);
      const found = await call(lookupTool, { [idCfg.input]: tail }).catch(() => null);
      const list = found?.ok ? (readPath(found.facts, idCfg.list) || []) : [];
      if (Array.isArray(list) && list.length === 1 && !found.facts?.fuzzy) return { value: tail, options: list.map((item) => toOption(item)), exact: false };
    }
    return { value: cleaned || String(raw || "").trim(), options: [], close: await closeMatches(cleaned || raw) };
  }
  // Close matches (typos): the business's own search when it has one (identify.fuzzy.param), otherwise
  // AIStaff compares against a list the business returns (identify.fuzzy.index = { operation, list, field }).
  async function closeMatches(raw) {
    const fz = idCfg.fuzzy || null;
    if (!fz) return [];
    const matchFields = idCfg.confirm?.match || [];
    const shape = (item, distance) => {
      const option = toOption(item);
      return { set: option.set, full: option.label, distance, match_text: matchFields.map((f) => readPath(item, f)).filter(Boolean).join(" ") };
    };
    if (fz.param) {
      const found = await call(lookupTool, { [idCfg.input]: raw, [fz.param]: true }).catch(() => null);
      const list = found?.ok ? (readPath(found.facts, idCfg.list) || []) : [];
      return (Array.isArray(list) ? list : []).slice(0, 5).map((item) => shape(item, Number(item.distance ?? 1)));
    }
    if (fz.index?.operation) {
      const found = await call(toolForKey(fz.index.operation), fz.index.args || {}).catch(() => null);
      const list = found?.ok ? (readPath(found.facts, fz.index.list) || []) : [];
      return closest(raw, Array.isArray(list) ? list : [], (item) => readPath(item, fz.index.field)).map((x) => shape(x.item, x.distance));
    }
    return [];
  }
  // Pick the close match whose company / branch / name fits what the customer told us.
  function pickByContext(text) {
    const list = state.fuzzy?.candidates || [];
    if (!list.length || !String(text || "").trim()) return null;
    const scored = list.map((c) => ({ c, score: contextScore(text, c.match_text) })).filter((x) => x.score > 0);
    if (!scored.length) return null;
    const best = Math.max(...scored.map((x) => x.score));
    const top = scored.filter((x) => x.score === best).sort((a, b) => a.c.distance - b.c.distance);
    return top.length === 1 || top[0].c.distance < top[1].c.distance ? top[0].c : null;
  }
  async function machinesOfCustomer(customerId) {
    if (!byName?.machines) return [];
    const found = await call(toolForKey(byName.machines.operation), { [byName.machines.input]: Number(customerId) || customerId }).catch(() => null);
    const list = found?.ok ? (readPath(found.facts, byName.machines.list) || []) : [];
    const ownerId = readPath(found?.facts || {}, byName.machines.customer || "customerId") ?? customerId;
    const extra = Object.fromEntries([...idFields].filter((f) => /customer/i.test(f)).map((f) => [f, ownerId]));
    const sorted = (Array.isArray(list) ? list : []).slice().sort((a, b) => (String(b.machineInventoryStatus || "") === "DELIVERED") - (String(a.machineInventoryStatus || "") === "DELIVERED"));
    return sorted.map((item) => {
      const option = toOption(item, extra);
      const serial = String(item.serial || item.serialNumber || "");
      option.label = [item.model, serial ? `serial ending ${serial.slice(-4)}` : "", item.branchName].filter(Boolean).join(" — ");
      option.short = [item.model, serial ? `serial ending ${serial.slice(-4)}` : ""].filter(Boolean).join(" — ") || option.label;
      option.full = toOption(item, extra).label;
      option.branch = { id: String(readPath(item, byName.machines.branch_id || "branchId") ?? ""), name: String(readPath(item, byName.machines.branch_name || "branchName") || "") };
      option.branch.address = String(item.branchAddress || item.address || "");
      option.model = String(item.model || "");
      return option;
    });
  }
  // ---- Company name given (Mike 2026-10-20) ----
  // A serial pins company + branch, so nothing more is asked. A company name with several branches /
  // departments: ASK which one (and where) first; match the answer in code (src/branch-match.js).
  // One match -> its machine (confirmed). Up to 5 -> show those. More (e.g. "Accounting" of 200
  // branches) -> ask the location and narrow within them. A list only after 2 unclear answers, and
  // then only the 5 closest. One machine is always CONFIRMED, never picked silently.
  // ---- Voice helpers (calls only, Mike 2026-10-21) ----
  const GENERIC = new Set(["additional", "branch", "inc", "corp", "corporation", "philippines", "phils", "the", "and", "company", "co", "ltd", "back", "main", "office", "building", "bldg", "floor", "room", "street", "st", "ave", "avenue", "road", "city"]);
  const words = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !GENERIC.has(w));
  // "thirty thirty five" -> 3035, "twenty seven forty" -> 2740, "seven zero six five" -> 7065
  const spokenDigits = (t) => {
    const ONES = { zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
    const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
    const toks = String(t || "").toLowerCase().replace(/-/g, " ").match(/[a-z]+|\d+/g) || [];
    let out = "", run = "";
    for (let i = 0; i < toks.length; i += 1) {
      const w = toks[i];
      if (/^\d+$/.test(w)) { run += w; continue; }
      if (TENS[w] !== undefined) {
        const next = ONES[toks[i + 1]];
        if (next !== undefined && next > 0 && next < 10) { run += String(TENS[w] + next); i += 1; } else run += String(TENS[w]);
        continue;
      }
      if (w === "hundred" && run) { run += "00"; continue; }
      if (ONES[w] !== undefined && !(w === "o" && !run)) { run += String(ONES[w]).padStart(w === "oh" || w === "zero" || w === "o" ? 1 : 1, "0"); continue; }
      if (run) { out += ` ${run} `; run = ""; }
      out += ` ${w} `;
    }
    if (run) out += ` ${run} `;
    return out.replace(/\s+/g, " ").trim();
  };
  const near = (a, b) => { // small spelling slips from speech-to-text
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 2 || a.length < 5) return false;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length] <= (a.length >= 7 ? 2 : 1);
  };
  const branchLine = (g) => `${g.name} (${g.machines.length} machine${g.machines.length > 1 ? "s" : ""})`;
  function offerMachinesIn(branchName, machines) {
    state.branch_ask = null;
    if (machines.length === 1) {
      const m = machines[0];
      state.choices = null;
      state.pending_pick = { set: m.set, full: m.full };
      return { task: "confirm_machine", tell: [`their machine at ${branchName}: ${m.full}`], ask: [{ item: "confirmation that this is the branch / department and machine for this request (oo/hindi)" }] };
    }
    state.choices = machines.slice(0, 12).map((m) => ({ set: m.set, label: m.short || m.label, full: m.full }));
    return { task: "choose_machine", tell: [`the machines at ${branchName}`], ask: [{ item: "which machine this request is for (the serial number is on the machine sticker)", options: state.choices.map((c, i) => `${i + 1} = ${c.label}`) }] };
  }
  function showBranches(list, why) {
    state.branch_ask = { ...(state.branch_ask || { tries: 0 }), pool: list.map((g) => g.key) };
    state.choices = list.map((g) => ({ branch: g.key, name: g.name, label: branchLine(g), set: {} }));
    return { task: "choose_branch", tell: [why], ask: [{ item: "which one is theirs (or the serial number on the machine sticker)", options: state.choices.map((c, i) => `${i + 1} = ${c.label}`) }] };
  }
  function branchTask(text, firstTime = false) {
    if (["phone", "website_call"].includes(channel)) return voiceBranchTask(text, firstTime);
    const all = state.branch_list || [];
    const ba = state.branch_ask || { tries: 0, pool: null };
    state.branch_ask = ba;
    const pool = ba.pool ? all.filter((g) => ba.pool.includes(g.key)) : all;
    const hits = branchMatch.match(text, pool, all, { allowPlain: !firstTime, companyName: state.branch_company || "" });
    const best = hits[0]?.score || 0;
    const top = hits.filter((h) => h.score === best).map((h) => h.branch);
    state.choices = null;
    if (best > 0 && top.length === 1) return offerMachinesIn(top[0].name, top[0].machines);
    if (best > 0 && top.length <= 5) return showBranches(top, "these branches / departments match what they said");
    if (best > 0) {
      ba.pool = top.map((g) => g.key);
      ba.tries += 1;
      return { task: "ask_branch", tell: [`${top.length} of their branches / departments match that`], ask: [{ item: "the location of that branch / department (city, building or floor) so we pick the right one" }] };
    }
    if (!firstTime) ba.tries += 1;
    if (ba.tries >= 2) return showBranches(branchMatch.closestByText(text, pool.length ? pool : all, all, 5, state.branch_company || ""), "to make it easy, these are the closest branches / departments we have for them");
    return {
      task: "ask_branch",
      tell: firstTime
        ? [`we found ${state.branch_company || "their company"} in our records; it has several branches / departments`, "we confirm the exact one so the delivery or technician goes to the right place"]
        : ["we could not match that to one of their branches / departments yet"],
      ask: [{ item: "which branch / department the machine is in and where (for example: the department name, the floor, or the city)" }, { item: "or the serial number on the machine sticker" }]
    };
  }
  function voiceBranchTask(text, firstTime) {
    // Calls (Mike 2026-10-22): branch names are often unclear ("Additional", "Additional 2"), so they are never
    // matched or read out. Ask where the machine is; match by address / city; note it; flag it if unsure.
    const all = state.branch_list || [];
    const vf = state.vflow || (state.vflow = {});
    const company = state.branch_company || "their company";
    const askWhere = { item: "where the machine is: the building address or city, and the floor, room or department" };
    if (firstTime) {
      vf.stage = "location";
      return { task: "ask_location", tell: [`you asked them to wait a moment and pulled up the records of ${company}`], ask: [askWhere], do_not_list: true };
    }
    if (isQuestion(text)) {
      return { task: "ask_location", tell: [`FIRST answer their question in one short sentence: the records you pulled up are for ${company}`], ask: [askWhere], do_not_list: true };
    }
    const said = String(text || "").split(company).join(" ").replace(/\s+/g, " ").replace(/[\s.;,]+$/, "").trim().slice(0, 160);
    if (said) vf.location_note = vf.location_note ? `${vf.location_note}; ${said}` : said;
    const companyWords = new Set(words(company));
    const told = words(vf.location_note).filter((w) => !companyWords.has(w));
    const scored = all.map((g) => {
      const own = new Set([...words(g.address), ...words(g.name)].filter((w) => !companyWords.has(w)));
      const ownList = [...own];
      return { g, score: told.filter((w) => own.has(w) || ownList.some((o) => near(w, o))).length };
    });
    const best = Math.max(0, ...scored.map((x) => x.score));
    const top = best > 0 ? scored.filter((x) => x.score === best).map((x) => x.g) : all;
    const exact = best > 0 && top.length === 1;
    if (!exact) vf.verify_branch = true;
    const machines = top.flatMap((g) => g.machines.map((m) => ({ ...m, branchName: g.name })));
    const modelKey = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const models = [];
    for (const m of machines) { const n = noSerial(m.model || m.short || m.label); if (n && !models.some((x) => modelKey(x) === modelKey(n))) models.push(n); }
    if (machines.length === 1 || models.length === 1) {
      const m = machines[0];
      state.pending_pick = { set: m.set, full: m.full };
      state.choices = null;
      vf.stage = "confirm_machine";
      return { task: "confirm_machine", tell: [`noted where the machine is: ${said}`, `the machine on file is the ${models[0] || "printer"}`],
        ask: [{ item: `confirmation that the request is for their ${models[0] || "printer"} (yes / no)` }], do_not_list: true };
    }
    {
      // Calls: the caller cannot remember a list, so no options are read; we ask the model and match it in code.
      state.voice_models = machines.map((m) => ({ set: m.set, full: m.full, model: noSerial(m.model || m.short || m.label) }));
      state.choices = null;
      vf.stage = "ask_model";
      vf.model_tries = 0;
      return { task: "ask_model", tell: [`noted where the machine is: ${said}`], ask: [{ item: "the model of the printer (the name and number on the front of the machine)" }], do_not_list: true };
    }
    // Too many to choose by model: save under the closest branch, flagged for the admin to verify.
    const m = machines[0];
    Object.assign(args, m.set); state.identified = m.full; state.choices = null; state.branch_list = null;
    vf.verify_branch = true; vf.stage = "noted";
    return null;
  }
  function offerByBranch(options, companyName, text = "") {
    const groups = [];
    for (const o of options) {
      const key = o.branch?.id || "";
      let g = groups.find((x) => x.key === key);
      if (!g) { g = { key, name: o.branch?.name || companyName, address: o.branch?.address || "", machines: [] }; groups.push(g); }
      g.machines.push({ set: o.set, short: o.short, label: o.label, full: o.full, model: o.model || "" });
    }
    if (groups.length <= 1) { state.branch_list = null; return offerMachinesIn(groups[0]?.name || companyName, groups[0]?.machines || options); }
    state.branch_list = groups.map((g) => ({ ...g, machines: g.machines.slice(0, 12) }));
    state.branch_company = companyName;
    state.branch_ask = { tries: 0, pool: null };
    return branchTask(text, true);
  }
  function offerMachines(options, companyName) {
    if (options.length === 1) { Object.assign(args, options[0].set); state.identified = options[0].full || options[0].label; state.choices = null; return null; }
    state.choices = options.slice(0, 12).map((o) => ({ set: o.set, label: o.label, full: o.full }));
    return { task: "choose_machine", tell: [`we found ${companyName} and its machines`], ask: [{ item: "which machine this request is for", options: state.choices.map((c, i) => `${i + 1} = ${c.label}`) }] };
  }

  let choose = commands.find((item) => item.type === "choose" && Number(item.option) > 0);
  let voiceRepeatModels = false;
  if (["phone", "website_call"].includes(channel) && state.vflow?.stage === "choose_machine" && Array.isArray(state.choices) && !choose) {
    const key = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const said = key(message);
    const digits = (t) => (String(t).match(/\d{3,}/g) || []);
    const hit = state.choices.findIndex((c) => (said && said.includes(key(c.label))) || digits(c.label).some((d) => said.includes(d)));
    if (hit >= 0) choose = { type: "choose", option: hit + 1 };
    else voiceRepeatModels = !/\b(one|two|three|four|1|2|3|4|una|pangalawa|pangatlo|first|second|third|fourth)\b/i.test(String(message || ""));
  }
  // A bare "1" / "2." answering a list we showed is always a choice (code, not the model).
  if (!choose && Array.isArray(state.choices) && /^\s*\d{1,2}\s*[.)]?\s*$/.test(String(message || ""))) {
    choose = { type: "choose", option: Number(String(message).replace(/\D/g, "")) };
  }
  if (!task && active.identify && choose && Array.isArray(state.choices)) {
    const picked = state.choices[Number(choose.option) - 1];
    if (picked?.customer) {
      const machines = await machinesOfCustomer(picked.customer);
      task = machines.length ? offerByBranch(machines, picked.label, message) : null;
      if (!machines.length) state.choices = null;
    } else if (picked && picked.branch !== undefined) {
      const group = (state.branch_list || []).find((g) => g.key === picked.branch);
      task = group ? offerMachinesIn(group.name, group.machines) : null;
    } else if (picked) { Object.assign(args, picked.set); state.identified = picked.full || picked.label; state.choices = null; state.branch_list = null; }
  }

  // Remembered machine: ask first, before anything else is collected.
  if (!task && active.identify && state.pending_pick && state.memory_confirm_now) {
    state.memory_confirm_now = false;
    task = { task: "confirm_machine", tell: [`from their last request we have this machine on file: ${state.pending_pick.full}`], ask: [{ item: "confirmation that this request is for the same company, branch and machine (oo/hindi)" }] };
  }
  // A close match is waiting for the customer's yes / no (code reads the answer too).
  if (!task && active.identify && state.pending_pick) {
    const confirmCmd = commands.find((item) => item.type === "confirm");
    const text = String(message || "").trim().toLowerCase();
    const yes = confirmCmd ? confirmCmd.answer === "yes" : /^(yes|yep|yup|oo|opo|oo po|tama|correct|sige|that'?s it|yan po|yes po)\b/.test(text);
    const no = confirmCmd ? confirmCmd.answer === "no" : /^(no|nope|hindi|hindi po|mali|wrong|not)\b/.test(text);
    if (yes) {
      Object.assign(args, state.pending_pick.set); state.identified = state.pending_pick.full;
      state.pending_pick = null; state.fuzzy = null; state.identify_fails = 0;
    } else if (no) {
      state.pending_pick = null; state.fuzzy = null;
      if (["phone", "website_call"].includes(channel) && Array.isArray(state.branch_list) && state.branch_list.length > 1) {
        // Voice: a branch they did not confirm -> owner check (mobile, then email) before naming branches.
        state.vflow = { ...(state.vflow || {}), stage: "location", verify_branch: true };
        task = { task: "ask_location", tell: ["no problem, we will find the right one"], ask: [{ item: "the exact address or city of the machine, and the floor, room or department" }], do_not_list: true };
      } else if (Array.isArray(state.branch_list) && state.branch_list.length > 1) {
        state.branch_ask = { tries: 0, pool: null };
        task = { task: "ask_branch", tell: ["no problem, we will find the right one"], ask: [{ item: "which branch / department the machine is in and where" }, { item: "or the serial number on the machine sticker" }] };
      }
    }
    if (yes) { state.branch_list = null; state.branch_ask = null; }
  }

  // A company / branch name typed where an id belongs is a name to search, never an id.
  let companyQuery = String((commands.find((item) => item.type === "company" && item.value) || {}).value || "").trim();
  // Voice: a name the caller confirmed as a mishearing keeps meaning the right company for the rest of the call.
  if (["phone", "website_call"].includes(channel) && state.voice_alias && companyQuery.toLowerCase() === String(state.voice_alias.heard || "").toLowerCase()) companyQuery = state.voice_alias.name;
  // Also from the words themselves (the model sometimes calls a correction "update_previous"):
  // "my company is Ferrer Studio", "company name: X", "wait it's X" / "ay X pala".
  if (!companyQuery && active?.identify) {
    const texts = [String(message || ""), ...commands.filter((c) => c.type === "update_previous").map((c) => String(c.change || ""))];
    for (const t of texts) {
      const m = t.match(/\b(?:company|kompanya|compan?y|comapny|compny|business|office|opisina)(?:\s+name)?\s*(?:is|ay|:|=|-)\s*([A-Za-z0-9][\w .&'()-]{1,60})/i)
        || t.match(/\b(?:wait|ay|ah|sorry|mali|correction)[, ]+(?:it'?s|its|ito ay|yung|sa)\s+([A-Za-z0-9][\w .&'()-]{1,60})/i);
      if (m) { companyQuery = m[1].replace(/\s+(po|pala|na|lang)\b.*$/i, "").replace(/[.!?,]+$/, "").trim(); break; }
    }
  }
  for (const item of commands) {
    if ((item.type === "set" || item.type === "contact") && idFields.has(item.field) && item.value != null && !/^\d+$/.test(String(item.value).trim())) {
      if (!companyQuery) companyQuery = String(item.value).trim();
      delete args[item.field];
    }
  }
  // Serial-looking words straight from the message (letters AND digits, 8-20 long; not phones / emails).
  const idPattern = idCfg.pattern ? new RegExp(idCfg.pattern, "i") : null;
  const serialsInMessage = [...new Set(String(message || "").split(/[\s,;|]+/).map(cleanId)
    .filter((t) => !t.includes("@") && (idPattern ? idPattern.test(t)
      : t.length >= 8 && t.length <= 24 && /\d/.test(t) && /[A-Za-z]/.test(t) && !/^(model|printer)/i.test(t))))].slice(0, 3);
  const serialTries = [...new Set([...(identifyCommand ? [identifyCommand.value] : []), ...(narrowedNow || hadCandidates ? [] : serialsInMessage)])]
    .filter((t) => !["phone", "website_call"].includes(channel) || (/\d/.test(String(t)) && String(t).replace(/[^A-Za-z0-9]/g, "").length >= 5));

  if (["phone", "website_call"].includes(channel) && !task && state.vflow?.stage === "ask_model" && Array.isArray(state.voice_models) && state.voice_models.length) {
    const vf = state.vflow;
    const key = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const heard = spokenDigits(message);
    const heardKey = key(heard);
    const heardNums = heard.match(/\d{3,}/g) || [];
    const hits = state.voice_models.filter((m) => {
      const mk = key(m.model); const nums = m.model.match(/\d{3,}/g) || [];
      return (heardKey && mk && heardKey.includes(mk)) || nums.some((n) => heardNums.some((h) => h === n || h.includes(n) || (n.length >= 4 && n.includes(h) && h.length >= 4)));
    });
    const sameModel = hits.length && hits.every((h) => key(h.model) === key(hits[0].model));
    if (hits.length && sameModel) {
      const m = hits[0];
      if (hits.length > 1) vf.verify_branch = true; // same model in several places: saved, admin checks
      vf.model_said = heard.slice(0, 60);
      state.pending_pick = { set: m.set, full: m.full };
      state.voice_models = null; vf.stage = "confirm_machine";
      task = { task: "confirm_machine", tell: [`the machine on file is the ${m.model}`], ask: [{ item: `confirmation that the request is for their ${m.model} (yes / no)` }], do_not_list: true };
    } else if (isQuestion(message)) {
      task = { task: "ask_model", tell: ["answer their question briefly if you can"], ask: [{ item: "the model of the printer (the name and number on the front of the machine)" }], do_not_list: true };
    } else if ((vf.model_tries = (vf.model_tries || 0) + 1) < 2) {
      task = { task: "ask_model", tell: ["we could not match that model yet"], ask: [{ item: "the model name and number again, slowly (for example the brand and the number on the front)" }], do_not_list: true };
    } else {
      // Still unclear: save under the first machine, note what they said, admin verifies.
      const m = state.voice_models[0];
      Object.assign(args, m.set); state.identified = m.full; state.voice_models = null; state.branch_list = null;
      vf.verify_branch = true; vf.model_said = heard.slice(0, 60); vf.stage = "noted";
      vf.location_note = `${vf.location_note || ""}${vf.location_note ? "; " : ""}model said: ${heard.slice(0, 60)}`;
    }
  }
  if (voiceRepeatModels && !task && Array.isArray(state.choices)) {
    task = { task: "choose_machine", tell: ["we still need to know which printer it is"], ask: [{ item: "which printer model the request is for", options: state.choices.map((c, i) => `${i + 1} = ${c.label}`) }] };
  }
  // ---- Voice identification script (calls only) ----
  if (["phone", "website_call"].includes(channel) && !companyQuery && identifyCommand && state.vflow?.stage === "company" && !/\d/.test(String(identifyCommand.value || ""))) {
    companyQuery = String(identifyCommand.value).trim();
  }
  if (["phone", "website_call"].includes(channel) && active.identify && !state.identified && !task && state.vflow?.stage === "contact" && !serialTries.length) {
    companyQuery = ""; // the answer to "the contact person's name" is a name, not a company
  }
  if (["phone", "website_call"].includes(channel) && active.identify && !state.identified && !task) {
    const vf = state.vflow || (state.vflow = {});
    const txt = String(message || "");
    const dontKnow = /\b(no|none|wala|walang|hindi ko alam|di ko alam|don'?t know|do not know|not sure|forgot|nakalimutan|i don'?t have|do not have|can'?t find|cannot find|can not find|could not find|couldn'?t find|di ko makita|hindi ko makita|no sticker|can'?t see|cannot see|can'?t read|cannot read)\b/i.test(txt);
    if (vf.stage === "verify_mobile") {
      const digits = txt.replace(/\D/g, "");
      if (digits.length >= 10) {
        vf.mobile = digits.length > 11 ? digits.slice(-11) : digits;
        if (allowed.has("callerphone")) args.callerphone = vf.mobile;
        vf.stage = "verify_email";
        task = { task: "ask_email", tell: [`noted their mobile number ${vf.mobile}`], ask: [{ item: "their email address, to confirm they are the owner of the machine (they may spell it)" }] };
      } else {
        task = { task: "ask_mobile", tell: [], ask: [{ item: "their mobile number, digit by digit" }] };
      }
    } else if (vf.stage === "verify_email") {
      const spoken = txt.toLowerCase().replace(/\s+(at|@)\s+/g, "@").replace(/\s+(dot|period|tuldok)\s+/g, ".").replace(/\s+/g, "");
      const email = (spoken.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/) || [])[0];
      if (email) {
        vf.email = email;
        if (allowed.has("calleremail")) args.calleremail = email;
        vf.stage = "verified";
        const all = state.branch_list || [];
        const pool = vf.pool ? all.filter((g) => vf.pool.includes(g.key)) : all;
        task = pool.length && pool.length <= 4
          ? showBranches(pool, `their details are noted; these are their branches or departments${vf.location ? ` in ${vf.location}` : ""}`)
          : { task: "ask_branch", tell: [`their details are noted; there are ${pool.length} branches or departments${vf.location ? ` in ${vf.location}` : ""}`], ask: [{ item: "the department name or floor, so we can find the right one" }], do_not_list: true };
        if (pool.length > 4) vf.stage = "branch";
      } else {
        task = { task: "ask_email", tell: [], ask: [{ item: "their email address, spelled slowly" }] };
      }
    } else if (!state.branch_list && !serialTries.length && !companyQuery && !state.voice_id) {
      if (!vf.stage) {
        vf.stage = "serial";
        task = { task: "ask_serial", tell: [], ask: [{ item: "the serial number of the machine" }] };
      } else if (vf.stage === "serial" && !dontKnow && isQuestion(txt)) {
        // "Where can I find it?" -> answer from the business's own phone instructions, then ask again.
        task = { task: "ask_serial", tell: ["FIRST answer their question briefly; where to find the serial number comes from the business's phone instructions (if none, say it is printed on the machine)"], ask: [{ item: "the serial number of the machine" }] };
      } else if (vf.stage === "serial" && dontKnow) {
        vf.stage = "contact";
        task = { task: "ask_caller_name", tell: ["no problem, we can find it another way"], ask: [{ item: "the caller's own name, so we can address them properly" }] };
      } else if (vf.stage === "contact") {
        const nameCmd = commands.find((c) => (c.type === "set" || c.type === "contact") && /name/i.test(String(c.field || "")) && c.value);
        const name = String(nameCmd?.value || txt).replace(/^(it'?s|i am|i'?m|this is|ako si|si|my name is)\s+/i, "").replace(/[.!?]+$/, "").trim().slice(0, 60);
        vf.contact = name;
        if (allowed.has("callername")) args.callername = name;
        const first = name.replace(/^(sir|ma'?am|mam|mr\.?|ms\.?|mrs\.?)\s+/i, "").split(/\s+/)[0] || name;
        let title = (name.match(/^(sir|mr\.?)\b/i) && "Sir") || (name.match(/^(ma'?am|mam|ms\.?|mrs\.?)\b/i) && "Ma'am") || "";
        // Common Filipino first names first (unisex names are left out on purpose); the model only for others.
        const MEN = new Set("paul john mark michael mike jose juan carlo carlos james joseph daniel ryan kevin christian angelo miguel rafael gabriel joshua jerome jomar ronald roberto robert rodel ramon antonio eduardo edgar eric francis gerald jeffrey jeff jayson jason kenneth leo luis manuel marlon nestor noel oscar patrick peter ramil rey richard rommel ruben samuel vincent victor william arnold alvin allan benjamin bryan brian carl cesar danilo dennis dominic emmanuel ferdinand george henry jerry jimmy joel jonathan julius lawrence lester louie mario martin nathan paolo ralph renato ricardo rolando ronnie sergio steven tony wilfredo edwin mateo andrew adrian aaron albert arnel arturo bernard boy dante efren elmer ernesto felix fernando gilbert gregorio jaime jesus jojo jonel jose lito marvin melvin nelson orlando pedro reynaldo rodrigo romeo rudy teodoro virgilio willy zaldy darwin jerwin mhark jhon rogelio armando alfredo".split(" "));
        const WOMEN = new Set("karen maria mary anne ann ana anna grace joy jenny jennifer jessica kristine christine catherine kathleen liza lisa mae marie michelle nicole rose rosa sarah sheila shiela angela angelica april carmen charlotte cherry claire cristina diana elena ella emily gina hazel irene jasmine jocelyn joan joanna judith julie karla lea leah lorna lourdes lucy lyn marissa maricel marilyn melissa mila nancy nina norma pamela patricia pia precious rachel rhea rica rowena ruby ruth sandra sofia sophia stephanie susan teresa tess vanessa veronica vilma wendy yvonne aileen alma amy andrea arlene beth carla celia cora daisy dolores edna elizabeth evelyn faith flor gemma gloria helen imelda ivy jane janet jean josephine kate katherine laura linda liezl lilia luz margarita marlene merly mylene nerissa rebecca rosario sally shirley thelma trisha vicky zenaida princess analyn mariel camille bea kaye mylyn rosemarie ma marites lorena ofelia remedios corazon".split(" "));
        const low = first.toLowerCase();
        if (!title && MEN.has(low)) title = "Sir";
        if (!title && WOMEN.has(low)) title = "Ma'am";
        if (!title && /\bsir\b/i.test(channelInstructions || "") && /\bma'?am\b/i.test(channelInstructions || "")) {
          const g = await callModelJSON(`Is "${first}" usually a man's or a woman's first name in the Philippines? Reply only JSON: {"title":"Sir"} for a man, {"title":"Ma'am"} for a woman, {"title":""} if unisex or unsure.`, "interpreter").catch(() => null);
          const raw = String(g?.title ?? g?.answer ?? JSON.stringify(g || "")).toLowerCase();
          title = /ma'?am|mam|woman|female/.test(raw) ? "Ma'am" : /\bsir\b|\bman\b|male/.test(raw) ? "Sir" : "";
          console.log("[director] caller title name=%s model=%s title=%s", first, JSON.stringify(g).slice(0, 80), title || "(none)");
        }
        vf.address = /\bsir\b/i.test(channelInstructions || "") && title ? `${title} ${first}` : first;
        vf.stage = "company";
        task = { task: "ask_company", tell: [`thank them as "${vf.address || name}"`], ask: [{ item: "the company name" }] };
      } else if (vf.stage === "company") {
        task = { task: "ask_company", tell: [], ask: [{ item: "the company name" }] };
      }
    }
  }

  // The customer corrects the company ("wait, it's Ferrer Studio") after one was picked or listed:
  // forget the old match and identify again with the new name (2026-10-20, a test kept "C.A Ferrer").
  if (!task && active.identify && companyQuery && !serialTries.length && !choose) {
    const normC = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();
    const q = normC(companyQuery);
    const companyChoices = Array.isArray(state.choices) && state.choices.some((c) => c.customer);
    const otherThanIdentified = state.identified && !normC(state.identified).includes(q);
    const notInChoices = companyChoices && !state.choices.some((c) => normC(c.label).includes(q));
    const otherThanPending = state.pending_pick && !normC(state.pending_pick.full).includes(q);
    // While asking for a branch, the answer is a branch, not a company (unless it names another company).
    const otherCompany = state.branch_company && !normC(state.branch_company).includes(q) && !normC(q).includes(normC(state.branch_company))
      && !(state.branch_list || []).some((g) => normC(g.name).includes(q));
    if (q.length >= 3 && (otherThanIdentified || notInChoices || otherThanPending || (otherCompany && /\b(company|kompanya|compny|comapny|wait|mali|wrong|not|hindi)\b/i.test(String(message || ""))))) {
      console.log("[director] company corrected to \"%s\" (was %s): identifying again", companyQuery, state.identified || "a company list");
      Object.assign(state, { identified: null, identified_from_memory: false, choices: null, pending_pick: null, fuzzy: null, candidates: null, branch_list: null, branch_ask: null, branch_company: null, confirmation_id: null, identify_fails: 0 });
      for (const f of idFields) delete args[f];
      if (current?.draft) {
        const kept = { ...(current.draft.requested_arguments || {}) };
        for (const f of idFields) delete kept[f];
        await prisma.businessOperationRequest.update({ where: { id: current.draft.id }, data: { requested_arguments: kept } }).catch(() => {});
      }
    }
  }
  if (!task && active.identify && !state.identified && Array.isArray(state.branch_list) && state.branch_list.length && !state.pending_pick && !serialTries.length && !choose
      && (!Array.isArray(state.choices) || state.choices.some((c) => c.branch !== undefined))) {
    task = branchTask([message, companyQuery].filter(Boolean).join(" "));
  }
  if (!task && active.identify && !state.identified && state.fuzzy && !state.pending_pick) {
    const fit = pickByContext([companyQuery, message].filter(Boolean).join(" "));
    if (fit) {
      state.pending_pick = fit;
      task = { task: "confirm_close_match", tell: [`the closest record to "${state.fuzzy.typed}" is: ${fit.full}`], ask: [{ item: "whether this is their record (oo/hindi)" }] };
    } else if (companyQuery) {
      state.fuzzy = null; // the company does not fit any close match: search the company itself below
    }
  }
  if (!task && ["phone", "website_call"].includes(channel) && active.identify && byName && !state.identified && state.voice_id) {
    const vid = state.voice_id;
    const yes = /\b(yes|yeah|yep|yup|correct|right|exactly|oo|opo|oho|tama|iyon|yun|siya)\b/i.test(message);
    const no = /\b(no|nope|not|wrong|hindi|mali|hinde|di)\b/i.test(message);
    if (vid.stage === "pick") {
      if (yes && !no) { companyQuery = vid.pick.name; state.voice_alias = { heard: vid.heard, name: vid.pick.name }; state.voice_id = null; }
      else {
        state.voice_id = { ...vid, stage: "open" };
        task = { task: "ask_more", tell: ["that was not their company"], ask: [{ item: "the exact company name as written on their documents, or the serial number on the machine sticker" }] };
      }
    } else if (companyQuery && companyQuery.toLowerCase() !== String(vid.heard || "").toLowerCase()) {
      state.voice_id = { ...vid, heard: companyQuery, stage: "confirm" };   // a new name: the normal lookup below runs
    } else if (vid.stage === "confirm" && !companyQuery) {
      if (yes && !no) {
        state.voice_id = { ...vid, stage: "context" };
        task = { task: "ask_caller_context", tell: [`"${vid.heard}" is not in our records under that exact name`], ask: [{ item: "their name and the area or building where the machine is, so we can find their company" }] };
      } else {
        task = { task: "ask_company_name", tell: [], ask: [{ item: "the correct company name" }] };
      }
    } else if (vid.stage === "context" || vid.stage === "open") {
      // Match by similar company name + branch location (contact name / caller number when the business's records provide them).
      const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const lev = (a, b) => { const m = a.length, n = b.length; if (!m || !n) return Math.max(m, n); const d = Array.from({ length: m + 1 }, (_, i) => [i]); for (let j = 1; j <= n; j += 1) d[0][j] = j; for (let i = 1; i <= m; i += 1) for (let j = 1; j <= n; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; };
      const sim = (a, b) => { a = norm(a); b = norm(b); return a && b ? 1 - lev(a, b) / Math.max(a.length, b.length) : 0; };
      const heard = vid.heard || "";
      const words = [...new Set(norm(heard).split(" ").filter((w) => w.length >= 3))].slice(0, 4);
      const cands = new Map();
      for (const w of words) {
        const found = await call(toolForKey(byName.operation), { [byName.input]: w }).catch(() => null);
        const list = found?.ok ? (readPath(found.facts, byName.list) || []) : [];
        for (const c of list.slice(0, 25)) cands.set(String(readPath(c, byName.id || "id")), String(readPath(c, byName.label || "name") || ""));
      }
      const place = norm(message).split(" ").filter((w) => w.length >= 4);
      let best = null;
      for (const [id, name] of [...cands.entries()].sort((a, b) => sim(heard, b[1]) - sim(heard, a[1])).slice(0, 5)) {
        let score = sim(heard, name);
        let branch = "";
        const machines = await machinesOfCustomer(id).catch(() => []);
        for (const mc of machines) {
          const bn = String(mc.branch?.name || mc.full || "");
          if (place.some((w) => norm(bn).includes(w))) { score += 0.3; branch = mc.branch?.name || ""; break; }
        }
        if (!best || score > best.score) best = { id, name, branch, score };
      }
      console.log("[director] voice company match heard=%j best=%j", heard, best);
      if (best && best.score >= 0.5) {
        state.voice_id = { ...vid, stage: "pick", pick: best };
        task = { task: "confirm_close_match", tell: [`the closest company in our records is ${best.name}${best.branch ? ` (${best.branch})` : ""}`], ask: [{ item: "whether this is their company (yes or no)" }] };
      } else {
        state.voice_id = { ...vid, stage: "open" };
        task = { task: "ask_more", tell: ["we could not match it yet"], ask: [{ item: "the company name as written on their documents, or the serial number on the machine sticker" }] };
      }
    }
  }
  if (!task && active.identify && lookupTool && !state.identified && !narrowedNow && !state.pending_pick && !state.fuzzy && !Array.isArray(state.choices) && (serialTries.length || companyQuery)) {
    let result = null;
    for (const raw of serialTries) {
      result = await lookupSerial(raw);
      if (result.options.length) break;
    }
    const options = result?.options || [];
    if (options.length === 1) {
      Object.assign(args, options[0].set); state.identified = options[0].label; state.choices = null; state.identify_fails = 0;
    } else if (options.length > 1) {
      // Privacy: never read out other customers' companies/branches. Ask, then narrow down in code.
      state.candidates = options.slice(0, 40);
      state.choices = null;
      task = { task: "narrow_down", tell: [`several machines match "${result.value}"`], ask: [{ item: "their company name and branch / department (or the full serial number on the machine sticker)" }], do_not_list_records: true };
      if (!current) await call(active.tool, args).catch(() => null); // a draft holds the candidates until the next message
    } else if (result?.close?.length) {
      // Typo: never reveal the close matches; ask who they are, then confirm the one that fits.
      state.fuzzy = { typed: result.value, candidates: result.close };
      const fit = pickByContext([companyQuery, message].filter(Boolean).join(" "));
      if (fit && (companyQuery || fit.distance === 0)) {
        state.pending_pick = fit;
        task = { task: "confirm_close_match", tell: [`the closest record to "${result.value}" is: ${fit.full}`], ask: [{ item: "whether this is their record (oo/hindi)" }] };
      } else {
        task = { task: "ask_context_for_close_match", tell: [`we are checking the ${what} "${result.value}" they gave; it may have a small typo`], ask: [{ item: idCfg.confirm?.ask || "their company name and branch / department" }, { item: "their name and contact number (if not given yet)" }] };
      }
      if (!current) await call(active.tool, args).catch(() => null);
    } else {
      // No serial match: try the company name.
      let byCompany = null;
      if (companyQuery && byName) {
        const found = await call(toolForKey(byName.operation), { [byName.input]: companyQuery }).catch(() => null);
        const customers = found?.ok ? (readPath(found.facts, byName.list) || []) : [];
        if (Array.isArray(customers) && customers.length === 1) {
          const machines = await machinesOfCustomer(readPath(customers[0], byName.id || "id"));
          if (machines.length) byCompany = offerByBranch(machines, readPath(customers[0], byName.label || "name"), message);
          else byCompany = { none: true };
          if (!byCompany.none) task = byCompany;
        } else if (Array.isArray(customers) && customers.length > 1) {
          state.choices = customers.slice(0, 6).map((c) => ({ customer: readPath(c, byName.id || "id"), label: String(readPath(c, byName.label || "name") || ""), set: {} }));
          task = { task: "choose_company", tell: [`a few companies match "${companyQuery}"`], ask: [{ item: "which company is theirs", options: state.choices.map((c, i) => `${i + 1} = ${c.label}`) }] };
          byCompany = task;
        }
      }
      if (!state.identified && !task) {
        state.identify_fails = Number(state.identify_fails || 0) + 1;
        const tried = [result?.value ? `serial "${result.value}"` : "", companyQuery ? `company "${companyQuery}"` : ""].filter(Boolean).join(" and ");
        if (state.identify_fails === 1 && !companyQuery && byName) {
          task = { task: "ask_company", tell: [`we could not match ${tried} in our records yet`, "no problem: we can look it up by company instead"], ask: [{ item: "the company name and branch / department where the machine is" }] };
        } else if (["phone", "website_call"].includes(channel)) {
          // Voice: no hand-over unless the caller asks. Repeat what was heard and ask if it is right.
          const heard = companyQuery || result?.value || "";
          const prev = state.voice_id;
          if (heard && prev && prev.heard && prev.heard.toLowerCase() === heard.toLowerCase() && prev.stage === "confirm") {
            state.voice_id = { ...prev, stage: "context" };
            task = { task: "ask_caller_context", tell: [`"${heard}" is not in our records under that exact name`], ask: [{ item: "their name and the area or building where the machine is, so we can find their company" }] };
          } else if (heard) {
            state.voice_id = { stage: "confirm", heard };
            task = { task: "confirm_heard", tell: [`we heard the company name as "${heard}" but could not find it yet`], ask: [{ item: `whether "${heard}" is correct, or the correct company name` }] };
          } else {
            task = { task: "ask_company", tell: ["we could not find it yet"], ask: [{ item: "their company name, or the serial number on the machine sticker" }] };
          }
        } else {
          needsHuman = true;
          handoffReason = `Machine could not be identified automatically (tried ${tried || "the details given"}). Please find the customer's machine and continue the request.`;
          task = { task: "team_will_identify", tell: ["our team will look up their machine in our records and continue the request", "they do not need to send anything else for now; we will message them here"] };
        }
        if (!current) await call(active.tool, args).catch(() => null); // keep a draft so the next message resumes
      }
    }
  }

  if (task && ["choose_machine", "choose_company", "choose_branch", "ask_branch", "confirm_machine"].includes(task.task) && !current) await call(active.tool, args).catch(() => null);

  // Confirmation of a summary prepared in an earlier turn.
  if (!task && state.confirmation_id && has("confirm")) {
    const answer = commands.find((item) => item.type === "confirm").answer;
    if (answer === "yes") {
      P("Saving your request in our system…");
      const result = await call(active.tool, { _confirmation_id: state.confirmation_id });
      if (result?.executed || result?.merged) P("Saved ✓ Getting your reference number…");
      state.confirmation_id = null;
      if (result?.merged) {
        task = result.waiting
          ? { task: "added_to_open_request", tell: [`it was added to their open request (now: ${String(result.description || "").replace(/\n/g, " ")})`, "it is with our team to schedule; the reference number will be sent as soon as it is scheduled"], do_not_give_reference: true }
          : { task: "added_to_open_request", tell: [`it was added to their existing ticket (now: ${String(result.description || "").replace(/\n/g, " ")})`, "no new ticket is needed; the system adds the reference number below"], reference: result.reference || null };
      } else if (result?.executed) {
        task = { task: "submitted", tell: ["the request is saved and the team will handle it"], reference: result.reference || null };
      } else if (result?.staff_notified) {
        task = { task: "blocked", tell: ["their request with all details was passed to our team to schedule", "there is no reference number yet; it will be sent as soon as the team schedules it"], do_not_give_reference: true };
      } else {
        needsHuman = true; handoffReason = `Director could not submit: ${result?.detail || result?.error || "unknown error"}`;
        task = { task: "error", tell: ["it could not be saved", "a team member will follow up"], do_not_give_reference: true };
      }
    } else {
      state.confirmation_id = null;
      task = { task: "ask_change", ask: [{ item: "what they want to change in the request" }] };
    }
  }

  // Where the request came from (Request Origin in the form): set by code from the real channel.
  if (active.origin?.field) args[active.origin.field] = active.origin.map?.[channel] || active.origin.default || channel;

  // Supply items (quantity + colour) are read by CODE from the customer's own words, never guessed
  // (Mike 2026-10-20: no human checks these). "3, yellow, ink" -> 3 pc Yellow Ink.
  let itemsAsk = null;
  if (!task && active.items?.field) {
    const cfg = active.items;
    const prior = current?.draft?.requested_arguments || {};
    const whenField = cfg.when?.field || "category";
    let cat = String(args[whenField] ?? prior[whenField] ?? "").trim().toLowerCase();
    const values = (cfg.when?.values || []).map((v) => String(v).toLowerCase());
    // Kind not set yet: take it from what the customer already said ("can I order ink" two turns ago),
    // so it is never asked again as a list (Mike 2026-10-22).
    if (!cat) {
      const recent = [String(message || ""), ...(history || []).filter((m) => m.sender_type === "customer").slice(-6).reverse().map((m) => String(m.message_text || ""))];
      for (const t of recent) {
        const k = /\btoners?\b/i.test(t) ? "toner" : /\b(inks?|tinta)\b/i.test(t) ? "ink" : /\bcartridges?\b/i.test(t) ? "cartridge" : null;
        if (k && values.includes(k)) { args[whenField] = k; cat = k; break; }
      }
    }
    // The customer's own word for the items wins ("2 black toners" after "I need ink" -> toner).
    const saidKind = /\btoners?\b/i.test(message) || (VOICE && /\blaser\b/i.test(message)) ? "toner" : /\b(inks?|tinta)\b/i.test(message) ? "ink" : /\bcartridges?\b/i.test(message) ? "cartridge" : null;
    if (VOICE && saidKind) state.voice_kind = saidKind;
    if (VOICE && !saidKind && state.voice_kind && cat && cat !== state.voice_kind && values.includes(cat) && values.includes(state.voice_kind)) {
      args[whenField] = state.voice_kind;
      cat = state.voice_kind;
    }
    if (cat && saidKind && saidKind !== cat && values.includes(cat) && values.includes(saidKind)) {
      args[whenField] = saidKind;
      cat = saidKind;
    }
    if (cat && values.includes(cat)) {
      const kind = cat.includes("toner") ? "toner" : cat.includes("cartridge") ? "cartridge" : "ink";
      const category = cfg.category_map?.[cat] || "Others";
      const hadItems = Array.isArray(prior[cfg.field]) && prior[cfg.field].length > 0;
      const bareNumber = (t) => /^\s*\d{1,2}\s*[.)]?\s*$/.test(String(t || ""));
      let parsed = choose || bareNumber(message) ? { items: [] } : parseSupplyItems(message, kind);
      const idAnswer = (t) => /\bmodel\b/i.test(String(t || "")) || /\d{3,}/.test(spokenDigits(t)) || /\b(floor|room|building|street|located|we are in|nasa)\b/i.test(String(t || ""));
      if (VOICE && idAnswer(message)) parsed = { items: [] };
      if (VOICE) {
        // "first one / second one" are picks, never quantities; "only black" / laser / mono settles the colour;
        // a plain number ("two", "2") answers "how many" once the colour is known (Mike 2026-10-22).
        const label = kind === "toner" ? "Toner" : kind === "cartridge" ? "Cartridge" : "Ink";
        const cleaned = String(message || "").replace(/\b(first|second|third|fourth|last|una|unang|pangalawa|pangatlo)\s+(one|po|isa)?\b/gi, " ").replace(/\bthe one\b/gi, " ");
        if (!choose && !idAnswer(message)) parsed = parseSupplyItems(cleaned, kind);
        const blackOnly = /\b(only|just|lang)\s+(black|itim|block)\b|\b(black|itim|block)\s+(only|lang)\b|\blaser\b|\bmono(chrome)?\b|\bblack\s*(and|&)\s*white\b/i.test(message);
        if (blackOnly) state.items_colors = ["Black"];
        const NUM = { one: 1, isa: 1, two: 2, dalawa: 2, three: 3, tatlo: 3, four: 4, apat: 4, five: 5, lima: 5, six: 6, anim: 6, seven: 7, pito: 7, eight: 8, walo: 8, nine: 9, siyam: 9, ten: 10, sampu: 10 };
        const qm = cleaned.toLowerCase().match(/\b(\d{1,2}|one|isa|two|dalawa|three|tatlo|four|apat|five|lima|six|anim|seven|pito|eight|walo|nine|siyam|ten|sampu)\b/);
        const qty = qm ? (Number(qm[1]) || NUM[qm[1]] || 0) : 0;
        if (!parsed.items.length && Array.isArray(state.items_colors) && state.items_colors.length === 1 && qty >= 1 && qty <= 50) {
          parsed = { items: [{ item: `${state.items_colors[0]} ${label}`, quantity: qty, unit: "pc" }] };
        } else if (!parsed.items.length && blackOnly && parsed.quantity) {
          parsed = { items: [{ item: `Black ${label}`, quantity: parsed.quantity, unit: "pc" }] };
        } else if (!parsed.items.length && parsed.needQty && Array.isArray(parsed.colors) && parsed.colors.length) {
          state.items_colors = parsed.colors;
        }
        if (parsed.items.length) state.items_colors = null;
      }
      if (!parsed.items.length && !hadItems) {
        const since = current?.draft?.created_at ? new Date(current.draft.created_at).getTime() - 10 * 60 * 1000 : 0;
        const earlier = (history || []).filter((m) => m.sender_type === "customer" && (!since || !m.created_at || new Date(m.created_at).getTime() >= since)).slice(since ? -6 : -3).reverse();
        for (const m of earlier) {
          if (bareNumber(m.message_text)) continue; // "2" answering a numbered list, not a quantity
          if (VOICE && idAnswer(m.message_text)) continue; // a model or location answer, not a quantity
          const p = parseSupplyItems(m.message_text, kind);
          if (p.items.length) { parsed = p; break; }
          if (!parsed.needColor && !parsed.needQty && (p.needColor || p.needQty)) parsed = p;
        }
      }
      if (parsed.items.length) args[cfg.field] = parsed.items.map((item) => ({ category, ...item }));
      else if (!hadItems) {
        itemsAsk = VOICE && Array.isArray(state.items_colors) && state.items_colors.length === 1
          ? { item: `how many ${state.items_colors[0].toLowerCase()} ${kind} they need (just the number)` }
          : VOICE && parsed.needColor
          ? { item: `which colour(s) for the ${parsed.quantity} ${kind} they need` }
          : parsed.needColor
          ? { item: `which colour(s) for the ${parsed.quantity} ${kind} they need (for example "2 black, 1 yellow")` }
          : parsed.needQty
            ? { item: `how many of each colour they want: ${parsed.colors.join(", ")} (for example "2 ${parsed.colors[0].toLowerCase()}")` }
            : { item: kind === "ink" ? 'how many and which colours of ink they need (for example "3 yellow" or "2 black, 1 cyan")' : `how many ${kind} they need${kind === "toner" ? " (and the colour, if it is a colour printer)" : ""}` };
      }
    }
  }

  // Calls: the caller's words for where the machine is go on the request (Mike 2026-10-22).
  if (VOICE && state.vflow?.location_note) {
    const tag = "Machine location (caller said):";
    const note = `${tag} ${state.vflow.location_note}${state.vflow.verify_branch ? " — branch/department to be verified by admin" : ""}`;
    if (allowed.has("description")) {
      const prev = String(args.description ?? current?.draft?.requested_arguments?.description ?? "");
      args.description = prev.includes(tag) ? prev.replace(new RegExp(`${tag}[^\n]*`), note) : (prev ? `${prev}\n${note}` : note);
    }
    const dept = state.vflow.location_note.match(/\b(accounting|acctg|hr|human resources|billing|admin|administration|finance|purchasing|sales|marketing|it|operations|warehouse|reception|legal|payroll)\b/i);
    if (dept && allowed.has("callerdepartment") && !args.callerdepartment) args.callerdepartment = dept[1].slice(0, 80);
  }

  // Calls: the machine picked earlier in this call stays on the request.
  if (VOICE && state.identified && state.identified_set) for (const [k, v] of Object.entries(state.identified_set)) if (args[k] == null) args[k] = v;

  // Collect / check / prepare confirmation through the blueprint engine.
  if (!task) {
    P("Checking your request details…");
    const result = await call(active.tool, args);
    if (itemsAsk && result?.status !== "needs_information" && !result?.executed && result?.ok !== false) {
      // Everything else is ready but the exact items are not: ask for them before any summary.
      task = { task: "ask_items", identified: state.identified || undefined, tell: ["to prepare the exact items for delivery we need the quantity and colour; we never guess these"], ask: [itemsAsk] };
    } else if (result?.status === "needs_information") {
      const ask = [];
      if (active.identify && !state.identified && (result.missing || []).some((key) => Object.keys(active.identify.set || {}).includes(key))) ask.push({ item: active.identify.ask || "an identifier" });
      if (itemsAsk) ask.push(itemsAsk);
      for (const key of result.missing || []) {
        if (active.identify && Object.keys(active.identify.set || {}).includes(key)) continue;
        const facts = fieldFacts(active.action, active.blueprint, key);
        ask.push(VOICE && facts.allowed
          ? { item: `${facts.description || key} — ask it as an open question in plain words (for example "how is the machine working right now?"); do NOT read the choices or numbers` }
          : { item: facts.description || key, options: facts.allowed ? facts.allowed.map((option) => `${option.value} = ${option.label || option.value}`) : undefined });
      }
      // Email: ask for everything in one message (each reply can take hours); chat: a few at a time.
      const askAll = channel === "email";
      // Voice calls (phone, website call): one item per turn — a spoken list of questions is too much to follow.
      const voiceCall = ["phone", "website_call"].includes(channel);
      task = { task: "ask_missing", identified: state.identified || undefined, ask: askAll ? ask : voiceCall ? ask.slice(0, 1) : ask.slice(0, 3) };
      // Saved by default (Mike 2026-10-20, like a browser cache but in our database): just say it is needed once.
      const firstTime = !profile?.known?.callername;
      if (firstTime && ask.length >= 2) {
        task.tell = [...(task.tell || []),
          ...(askAll ? ["to process the request in one go and avoid back-and-forth, ask them to reply once with ALL the items below"] : []),
          "we need these details only once, so we can address them properly and make their future inquiries and requests faster; thank them for their patience"];
      }
      const optionsField = (result.missing || []).find((key) => fieldFacts(active.action, active.blueprint, key).allowed);
      state.last_options_field = optionsField || null;
      if (result.not_yet_confirmed) task.confirm_what_they_said = result.not_yet_confirmed;
      state.last_missing = result.missing || [];
    } else if (result?.status === "awaiting_customer_confirmation" && result.merge_into && result.merge_into.same_caller) {
      // Same person, same machine, same kind of work: it IS their open request. Add it and tell them;
      // asking "add or new?" confused a customer (2026-10-21: "I have not raised any additional concerns").
      P("Adding this to your open request…");
      const merged = await call(active.tool, { _confirmation_id: result.confirmation_id });
      task = merged?.merged
        ? (merged.waiting
          ? { task: "added_to_open_request", tell: ["this is the same as their open request, so we added these details to it (no new ticket)", "it is with our team to schedule; the reference number will be sent as soon as it is scheduled"], do_not_give_reference: true }
          : { task: "added_to_open_request", tell: ["this is the same as their open request, so we added these details to it (no new ticket)"], reference: merged.reference || null })
        : { task: "blocked", tell: ["their request with all details was passed to our team"], do_not_give_reference: true };
    } else if (result?.status === "awaiting_customer_confirmation" && result.merge_into) {
      state.confirmation_id = result.confirmation_id;
      task = { task: "confirm_add_to_open_request", tell: [`this is the same machine and the same kind of request as their open request: ${result.merge_into.current}${result.merge_into.reference ? ` (reference ${result.merge_into.reference})` : " (still waiting for the team to schedule it)"}`, "so we add it to that request instead of opening a new ticket"], summary: result.summary, ask: [{ item: "confirmation to add it to the open request (oo/hindi)" }] };
    } else if (result?.status === "awaiting_customer_confirmation") {
      state.confirmation_id = result.confirmation_id;
      task = { task: "confirm_summary", identified: state.identified || undefined, summary: result.summary, tell: ["the system lists the request details right below your message: refer to them as \"the details below\" and do not repeat them"], ask: [{ item: "confirmation that the details below are correct (oo/hindi)" }] };
    } else if (result?.status === "blocked" || result?.staff_notified) {
      task = { task: "blocked", tell: ["their request with all details was passed to our team to schedule", "there is no reference number yet; it will be sent as soon as the team schedules it"], do_not_give_reference: true };
    } else if (result?.executed) {
      task = { task: "submitted", tell: ["the request is saved and the team will handle it"], reference: result.reference || null };
      if (VOICE && state.vflow?.verify_branch) {
        // Branch / department not certain: the admin is emailed to check and correct it (Mike 2026-10-22).
        be.notifyEngineOutcome({ companyId, conversationId, operation: { id: active.id, definition: { name: "Branch / department to verify (phone call)" } },
          outcome: "executed", reference: result.reference || null,
          details: { "Action needed": "Please verify the branch / department of this request and correct it in the records.",
            "Caller said the machine is at": state.vflow.location_note || "(not given)", "Saved under": state.identified ? noSerial(state.identified) : "(see request)" } })
          .catch((e) => console.error("[director] verify-branch email failed: %s", e.message));
        state.vflow.verify_branch = false;
      }
    } else if (result && result.ok === false) {
      needsHuman = true; handoffReason = `Director: ${result.detail || result.error || "request failed"}`;
      task = { task: "error", tell: ["something went wrong", "a team member will follow up"], do_not_give_reference: true };
    }
  }

  let blockedProblem = "";
  let customerEmailedAt = null;
  if (task && task.task === "blocked") {
    const failed = await prisma.businessOperationRequest.findFirst({ where: { conversation_id: conversationId, tenant_engine_operation_id: active.id }, orderBy: { updated_at: "desc" }, select: { error_message: true, requested_arguments: true } });
    blockedProblem = String(failed?.error_message || "").replace(/^.*?:\s*/, "").slice(0, 300);
    const email = failed?.requested_arguments?.calleremail || profile?.known?.calleremail;
    if (email) {
      const sent = await notifyCustomerStatus({
      companyId, conversationId,
        to: email, companyName, customerName: failed?.requested_arguments?.callername || profile?.known?.callername || "",
        statusText: "We received your request and passed it to our team to schedule.",
        nextStep: `You will receive the reference number as soon as it is scheduled. ${channel === "email" ? "Reply to this email" : "Reply on Messenger"} anytime to follow up.`,
        details: labelArguments(failed?.requested_arguments || {}, active.blueprint)
      }).catch(() => ({ ok: false }));
      if (sent.ok) { task.tell = [...task.tell, `a status update was emailed to ${email}`]; customerEmailedAt = new Date().toISOString(); }
    }
  }
  if (task && ["blocked", "submitted"].includes(task.task)) {
    // Remember what was identified and what was asked, for the next request.
    const fresh = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { customer_profile: true } });
    const done = await prisma.businessOperationRequest.findFirst({ where: { conversation_id: conversationId, tenant_engine_operation_id: active.id }, orderBy: { updated_at: "desc" }, select: { id: true, requested_arguments: true } });
    const identifySet = Object.fromEntries(Object.keys(active.identify?.set || {}).map((key) => [key, done?.requested_arguments?.[key]]).filter(([, value]) => value !== undefined));
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { customer_profile: {
        ...(fresh?.customer_profile || {}),
        ...(Object.keys(identifySet).length && fresh?.customer_profile?.consent !== "no" ? { last_identified: { flow: active.key, set: identifySet, label: state.identified || null } } : {}),
        last_request: { flow: active.key, request_id: done?.id || null, at: new Date().toISOString(), status: task.task, reference: task.reference || null, summary: labelArguments(done?.requested_arguments || {}, active.blueprint), problem: blockedProblem || null, alerts: 1, customer_emailed_at: customerEmailedAt }
      } }
    }).catch(() => {});
  }
  if (task && state.identified_from_memory && state.identified && task.task === "ask_missing") task.tell = [...(task.tell || []), `we already have their machine on file: ${state.identified} — say this machine by name and ask them to tell us if the request is for a different one`];

  // Persist Director state on the draft (survives restarts; next turn resumes).
  const refreshed = await activeDraft(companyId, conversationId, [active]);
  if (refreshed?.draft) {
    await prisma.businessOperationRequest.update({
      where: { id: refreshed.draft.id },
      data: { result: { ...(refreshed.draft.result || {}), director: { identified: state.identified || null, choices: state.choices || null, candidates: state.candidates || null, confirmation_id: state.confirmation_id || null, last_options_field: state.last_options_field || null, identify_fails: state.identify_fails || 0, fuzzy: state.fuzzy || null, pending_pick: state.pending_pick || null, branch_list: state.branch_list || null, branch_ask: state.branch_ask || null, branch_company: state.branch_company || null, voice_id: state.voice_id || null, voice_alias: state.voice_alias || null, vflow: state.vflow || null }, last_missing: state.last_missing || refreshed.draft.result?.last_missing || [] } }
    }).catch(() => {});
  }

  async function writeReply({ task: t }) {
    P("Writing your reply…");
    if (VOICE && t) {
      const asked = /\bserial\b/i.test(String(message || "")) && isQuestion(message);
      const raw = state.identified || state.pending_pick?.full || "";
      const serial = (String(raw).match(SERIAL_RE) || [])[0] || "";
      const clean = (v) => typeof v === "string" ? noSerial(v).replace(/\s*\(?(on|from) the (machine )?sticker( of the machine)?\)?/gi, "").replace(/\bmachine sticker( number)?\b/gi, "serial number") : Array.isArray(v) ? v.map(clean) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v;
      t = clean(t);
      const callerName = state.vflow?.contact || args.callername || current?.draft?.requested_arguments?.callername || "";
      const addressAs = state.vflow?.address || callerName;
      if (addressAs) t.tell = [...(t.tell || []), `address the caller as "${addressAs}" when you use their name (not in every sentence)`];
      t.tell = asked && serial
        ? [`FIRST answer their question: the serial number on file, read ONE CHARACTER AT A TIME exactly like this: ${spellSerial(serial)}`, ...(t.tell || [])]
        : [...(t.tell || []), "never say a serial number"];
    }
    if (VOICE && state.identified && active?.identify) {
      const ids = Object.fromEntries(Object.keys(active.identify.set || {}).filter((k) => args[k] != null).map((k) => [k, args[k]]));
      if (Object.keys(ids).length) state.identified_set = ids;
    }
    if (VOICE) VOICE_FLOWS.set(String(conversationId), { at: Date.now(), flow: active?.key || null, state: Object.fromEntries(VOICE_KEEP.map((k) => [k, state[k] ?? null])) });
    let written = await callModelJSON(communicatorPrompt({ companyName, tone, addressAs: profile?.address_as || profile?.known?.callername || "", history, message, language, task: t, replyStyle, channel, channelInstructions }), "communicator");
    // Calls: SEA-LION sometimes drifts into Indonesian / Malay. Only English, Tagalog or Taglish may be spoken.
    if (VOICE && /\b(apakah|saya|bisa|mohon|terima\s+kasih|bolehkah|nomor|hitam|silakan|anda|untuk|dengan|tidak|sudah|boleh|adalah|kami|halo)\b/i.test(String(written?.reply || ""))) {
      const again = await callModelJSON(communicatorPrompt({ companyName, tone, addressAs: profile?.address_as || profile?.known?.callername || "", history, message, language: "English",
        task: { ...t, tell: ["IMPORTANT: reply in English only (never Indonesian or Malay)", ...(t.tell || [])] }, replyStyle, channel, channelInstructions }), "communicator").catch(() => null);
      if (again?.reply) written = again;
    }
    let spoken = String(written?.reply || "").trim();
    // Calls: no made-up choices ("You can choose 1, 2, or 3") when the step has no list (Mike 2026-10-22).
    if (VOICE && !(t?.ask || []).some((a) => Array.isArray(a?.options) && a.options.length)) {
      spoken = spoken.replace(/\s*(you can |please )?(choose|pick|select)( from)? (1|one)\b[^.?!]*[.?!]?/gi, "").replace(/\s*or choose from[^.?!]*[.?!]?/gi, "").replace(/\s*(we can provide|we have|you can (choose|pick|say)|available)?\s*(these |the )?options?\s*(are|:)?\s*(1|one)\b[^.?!]*[.?!]?/gi, "").trim();
    }
    return spoken;
  }

  if (task && extraTell.length) task.tell = [...extraTell, ...(task.tell || [])];
  let reply = await writeReply({ task });
  if (!reply) throw new Error("Director communicator returned an empty reply");
  // Critical values are attached by code, never typed by the model.
  // Item kind is never changed by the writer: ink stays ink, toner stays toner (Mike 2026-10-22).
  if (["submitted", "added_to_open_request", "confirm_summary"].includes(task.task)) {
    const facts = JSON.stringify(task.tell || []) + JSON.stringify(task.summary || {});
    const hasInk = /\bink\b/i.test(facts), hasToner = /\btoner\b/i.test(facts);
    if (hasInk && !hasToner) reply = reply.replace(/\btoners\b/g, "inks").replace(/\btoner\b/g, "ink").replace(/\bToner\b/g, "Ink");
    if (hasToner && !hasInk) reply = reply.replace(/\binks\b/g, "toners").replace(/\bink\b/g, "toner").replace(/\bInk\b/g, "Toner");
  }
  if (["submitted", "added_to_open_request"].includes(task.task) && task.reference) reply = `${reply}\n\nReference number: ${task.reference}`;
  if (["confirm_machine", "confirm_close_match"].includes(task.task) && state.pending_pick?.full && !reply.includes(state.pending_pick.full)) {
    reply = `${reply}\n\nMachine: ${state.pending_pick.full}`;
  }
  // The summary the customer confirms is printed by code (exact values), not retyped by the model.
  if (task.task === "confirm_summary" && task.summary && typeof task.summary === "object") {
    const sumCfg = active.summary || {};
    const hide = new Set(sumCfg.hide || []);
    const show = (v) => {
      if (Array.isArray(v)) return v.map((i) => (i && typeof i === "object" && i.quantity !== undefined ? `\n  - ${i.quantity} ${i.unit || "pc"} ${i.item}` : `\n  - ${typeof i === "object" ? JSON.stringify(i) : i}`)).join("");
      if (v && typeof v === "object") return v.label !== undefined ? v.label : JSON.stringify(v);
      return v;
    };
    const entries = [];
    if (state.identified) entries.push([sumCfg.labels?._machine || "Machine", state.identified]);
    for (const [k, v] of Object.entries(task.summary)) {
      if (v === null || v === undefined || v === "" || hide.has(k) || (Array.isArray(v) && !v.length)) continue;
      entries.push([sumCfg.labels?.[k] || k, show(v)]);
    }
    const lines = entries.map(([k, v]) => `- ${k}:${String(v).startsWith("\n") ? "" : " "}${v}`);
    if (lines.length) {
      const block = `Request details:\n${lines.join("\n")}`;
      const parts = reply.split(/\n\s*\n/);
      // Formal: keep the closing line last (details go before it).
      reply = replyStyle === "formal" && parts.length > 2 ? [...parts.slice(0, -1), block, parts[parts.length - 1]].join("\n\n") : `${reply}\n\n${block}`;
    }
  }
  // Chat only (Mike 2026-10-22): a serial is shown as "serial ending 1234", never in full, unless the
  // customer asked for their serial. Calls are untouched (serials are never spoken there).
  if (!VOICE && !(/\bserial\b/i.test(String(message || "")) && isQuestion(message))) {
    reply = reply.replace(/\bserial( number)?(?: ending)?(\s+is)?\s*[:#]?\s*([A-Z0-9-]{6,})\b/gi, (m, num, is, sn) => (/\d/.test(sn) ? (is ? `serial number ends in ${sn.replace(/-/g, "").slice(-4)}` : `serial ending ${sn.replace(/-/g, "").slice(-4)}`) : m))
      .replace(SERIAL_RE, (sn, offset, whole) => (/serial ending\s*$/i.test(whole.slice(Math.max(0, offset - 16), offset)) ? sn : `serial ending ${sn.slice(-4)}`));
  }
  console.log("[director] company=%s flow=%s commands=%s task=%s", companyId, active.key, JSON.stringify(commands).slice(0, 300), task.task);
  return { reply, needsHuman, handoffReason, task: task.task, reference: task.reference || null };
}

module.exports = { runDirectorTurn, loadFlows, activeDraft, interpreterPrompt, communicatorPrompt, cleanIdentifier, clearVoiceFlow };
