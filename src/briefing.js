/**
 * Daily briefing report (added 2026-10-20). Settings > General > Daily briefing report.
 * Default 4:00 PM Manila, Mon-Sat, before the 5 PM briefing for tomorrow's schedule.
 *
 * One email with every UNRESOLVED case of the business (with or without a reference), oldest
 * first, each with the problem, a recommendation and signed buttons (Fixed - try again / Enter SR /
 * Done - close / Still open / Cancel). Before writing it, tickets already finished or cancelled in
 * the tenant system are closed automatically (customer told when done) and listed as closed.
 * Recipients: "Who gets alerts" rows ticked "Daily report" (all alert contacts when none ticked)
 * + the platform admin copy. Generic for every tenant.
 */
const { prisma } = require("./db");
const cases = require("./cases");

const SECTIONS = {
  waiting: "Waiting for staff — no ticket yet",
  overdue: "Overdue — scheduled date passed, not done",
  due_tomorrow: "Due tomorrow — for the briefing",
  open_tickets: "Open tickets — pending delivery / service",
  followups: "Customer follow-ups and complaints (last 24 h)",
  feedback: "Customer feedback after finished jobs (since the last report)",
  incomplete: "Incomplete — customer stopped replying (last 3 days)",
  closed: "Closed since the last report"
};
const DEFAULTS = { enabled: false, days: [1, 2, 3, 4, 5, 6], time: "16:00", sections: Object.fromEntries(Object.keys(SECTIONS).map((k) => [k, true])), last_sent_date: null };

function normalize(raw = {}) {
  const days = Array.isArray(raw.days) ? raw.days.map(Number).filter((d) => d >= 0 && d <= 6) : DEFAULTS.days;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw.time || "")) ? raw.time : DEFAULTS.time;
  const sections = { ...DEFAULTS.sections, ...(raw.sections && typeof raw.sections === "object" ? Object.fromEntries(Object.entries(raw.sections).filter(([k]) => SECTIONS[k]).map(([k, v]) => [k, Boolean(v)])) : {}) };
  return { enabled: Boolean(raw.enabled), days: [...new Set(days)].sort(), time, sections, last_sent_date: raw.last_sent_date || null, last_sent_at: raw.last_sent_at || null };
}

function manilaNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(date).map((p) => [p.type, p.value]));
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday];
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`, dow };
}
function manilaDate(offsetDays = 0) { return manilaNow(new Date(Date.now() + offsetDays * 86400000)).date; }
function esc(v) { return String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
function fmt(iso) { return new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function waited(row) {
  const h = (Date.now() - cases.caseStartedAt(row).getTime()) / 3600000;
  return h >= 48 ? `${Math.round(h / 24)} days` : `${Math.max(1, Math.round(h))} h`;
}

function recipientsFor(settings) {
  const contacts = Array.isArray(settings?.alert_contacts) ? settings.alert_contacts.filter((c) => c && c.email) : [];
  const ticked = contacts.filter((c) => c.daily_report);
  const list = (ticked.length ? ticked : contacts).map((c) => ({ email: String(c.email).toLowerCase(), name: c.name || "" }));
  return list.length ? list : String(settings?.notify_email || "").split(/[,;\s]+/).filter((e) => e.includes("@")).map((email) => ({ email: email.toLowerCase(), name: "" }));
}

/** Collect and classify every open case; refresh tickets from the tenant system. */
async function collect(companyId, sinceIso) {
  const rows = await prisma.businessOperationRequest.findMany({ where: { company_id: companyId, case_status: { in: cases.OPEN_CASE } }, orderBy: { created_at: "asc" } });
  const convIds = [...new Set(rows.map((r) => r.conversation_id).filter(Boolean))];
  const convs = new Map((await prisma.conversation.findMany({ where: { id: { in: convIds } }, select: { id: true, customer_name: true, channel: true, external_id: true } })).map((c) => [c.id, c]));
  const out = { waiting: [], overdue: [], due_tomorrow: [], open_tickets: [], followups: [], feedback: [], incomplete: [], closed: [] };
  const tomorrow = manilaDate(1);
  const nowMs = Date.now();
  for (const row of rows) {
    const conv = convs.get(row.conversation_id);
    const args = row.requested_arguments || {};
    const entry = {
      row, id: row.id, code: cases.shortCode(row.id), reference: row.reference || null,
      customer: conv?.customer_name || args.callername || conv?.external_id || "Customer",
      channel: conv ? (conv.channel === "email" ? "Email" : "Messenger") : "—",
      contact: [args.callerphone, args.calleremail].filter(Boolean).join(" · "),
      need: cases.caseSummary(row), waited: waited(row), followups: cases.followupCount(row),
      lastWords: (Array.isArray(row.followups) ? row.followups : []).filter((f) => f.type === "followup").slice(-1)[0]?.said || ""
    };
    if (row.case_status === "ticket_open" && row.reference) {
      const st = await cases.ticketAction({ companyId, conversationId: row.conversation_id, operationKey: "get_service_status", args: { ticketReference: row.reference } }).catch(() => null);
      const ticket = st?.ok ? st.facts?.ticket : null;
      const sch = ticket?.schedule || null;
      entry.company = [ticket?.customerName, ticket?.branchName].filter(Boolean).join(" — ");
      entry.schedule = sch;
      if (sch?.state === "done" || sch?.state === "cancelled") {
        await cases.setCase(row.id, { case_status: sch.state, closed_at: new Date() });
        await cases.addHistory(row.id, { type: sch.state, note: `${sch.state} in the system${sch.finishedAt ? ` ${sch.finishedAt}` : ""} (found by the daily report)` });
        if (sch.state === "done") {
          const rl = require("./resolve-loop");
          const ctx = await rl.loadContextForReport(row.id);
          if (ctx) await rl.finishResolvedPublic(ctx, { reference: row.reference, how: "done", name: "Daily report", email: "briefing", kind: "done" }).catch(() => {});
        }
        out.closed.push({ ...entry, closedHow: sch.state === "done" ? `Finished in your system${sch.finishedAt ? ` ${sch.finishedAt}` : ""} — customer told` : "Cancelled in your system" });
        continue;
      }
      const when = sch?.scheduledFor ? Date.parse(`${String(sch.scheduledFor).replace(" ", "T")}+08:00`) : null;
      if (when && when < nowMs) {
        entry.section = "overdue";
        entry.problem = `Scheduled ${sch.scheduledFor}${sch.assignedTo ? ` (${sch.assignedTo})` : ""}, not finished.`;
        entry.recommendation = `Call ${sch.assignedTo || "the assigned staff"} now. If it is done, press Done. If not, reschedule it and tell the customer the new date.`;
      } else if (sch?.scheduledFor && String(sch.scheduledFor).slice(0, 10) === tomorrow) {
        entry.section = "due_tomorrow";
        entry.problem = `${sch.purpose || "Scheduled"} tomorrow ${String(sch.scheduledFor).slice(11, 16)}${sch.assignedTo ? ` — ${sch.assignedTo}` : ""}.`;
        entry.recommendation = `Confirm with ${sch.assignedTo || "the assigned staff"} that it is on tomorrow's route${/ink|toner|cartridge/i.test(sch.purpose || "") ? " and the items are ready" : ""}.`;
      } else {
        entry.section = "open_tickets";
        entry.problem = sch ? `${sch.purpose || "Scheduled"} ${sch.scheduledFor || ""}${sch.assignedTo ? ` — ${sch.assignedTo}` : ""}` : "Ticket open (status could not be read).";
        entry.recommendation = sch ? "On schedule. Press Done when it is finished." : "Check it in your system.";
      }
    } else {
      entry.section = "waiting";
      const { resolutionSteps } = require("./notify");
      const steps = resolutionSteps({ reason: row.error_message || "", systemName: "" });
      entry.problem = String(row.error_message || "Not saved yet.").replace(/^.*?:\s*(?=No |The |This )/, "").slice(0, 300);
      entry.recommendation = `${steps?.headline ? `${steps.headline} ` : ""}${steps?.steps?.[0] || "Fix the problem, then press Fixed — try again."}`.replace(/\s+/g, " ").slice(0, 300);
    }
    if (entry.followups >= 2) entry.recommendation = `Customer followed up ${entry.followups}× — call them today. ${entry.recommendation}`;
    out[entry.section].push(entry);
    const recent = (Array.isArray(row.followups) ? row.followups : []).filter((f) => f.type === "followup" && Date.parse(f.at) > nowMs - 86400000);
    if (recent.length) out.followups.push({ ...entry, recentCount: recent.length });
  }
  // Requests the customer started but never finished (Closer asked; no reply). No buttons: follow up if worth it.
  const drafts = await prisma.businessOperationRequest.findMany({
    where: { company_id: companyId, status: { in: ["collecting", "pending_customer_confirmation"] }, updated_at: { lt: new Date(Date.now() - 3600000), gt: new Date(Date.now() - 3 * 86400000) } },
    orderBy: { updated_at: "desc" }, take: 30
  });
  const draftConvs = new Map((await prisma.conversation.findMany({ where: { id: { in: drafts.map((d) => d.conversation_id).filter(Boolean) } }, select: { id: true, customer_name: true, channel: true, external_id: true } })).map((c) => [c.id, c]));
  for (const d of drafts) {
    const conv = draftConvs.get(d.conversation_id);
    if (!conv) continue;
    const a = d.requested_arguments || {};
    const missing = Array.isArray(d.result?.stale_missing) ? d.result.stale_missing : (d.result?.last_missing || []);
    out.incomplete.push({ id: d.id, code: cases.shortCode(d.id), customer: conv.customer_name || a.callername || conv.external_id || "Customer", channel: conv.channel === "email" ? "Email" : "Messenger",
      need: cases.caseSummary(d), waited: `${Math.max(1, Math.round((Date.now() - new Date(d.updated_at).getTime()) / 3600000))} h since last reply`,
      problem: missing.length ? `Still missing: ${missing.join(", ")}` : "All details given; the customer did not confirm.",
      recommendation: "Optional: message the customer to finish the request." });
  }

  const closedRows = await prisma.businessOperationRequest.findMany({
    where: { company_id: companyId, case_status: { in: ["done", "cancelled", "closed"] }, closed_at: { gte: new Date(sinceIso) } }, orderBy: { closed_at: "asc" }
  });
  // After-service answers (src/feedback.js): "not done" and low ratings first.
  const answers = await prisma.customerFeedback.findMany({ where: { company_id: companyId, answered_at: { gte: new Date(sinceIso) } }, orderBy: { answered_at: "asc" } }).catch(() => []);
  for (const f of answers.sort((a, b) => (a.done === "no" ? -1 : 0) - (b.done === "no" ? -1 : 0))) {
    const ratings = Object.entries(f.answers?.ratings || {}).map(([k, n]) => `${k.replace("_", " ")} ${n}/5`).join(", ");
    out.feedback.push({ id: f.request_id, code: cases.shortCode(f.request_id), reference: f.reference, customer: f.customer_name || f.customer_email || "Customer",
      need: `${f.job_label || "job"}${f.staff_name ? ` by ${f.staff_name}` : ""}`,
      problem: f.done === "no" ? `Customer says NOT done${f.answers?.problem ? `: "${f.answers.problem}"` : ""}` : (ratings ? `Done · ${ratings}` : "Done"),
      recommendation: f.done === "no" ? "Call the customer today and send someone back if needed." : "",
      lastWords: f.answers?.comment || "" });
  }
  for (const row of closedRows) {
    if (out.closed.some((e) => e.id === row.id)) continue;
    out.closed.push({ id: row.id, code: cases.shortCode(row.id), reference: row.reference, customer: (row.requested_arguments || {}).callername || "Customer", need: cases.caseSummary(row), closedHow: `${row.case_status} ${row.closed_at ? fmt(row.closed_at) : ""}` });
  }
  return out;
}

function buttonsFor(entry, email) {
  const { resolveLinks } = require("./resolve-loop");
  const l = resolveLinks(entry.id, email);
  const b = (href, label, bg) => `<a href="${href}" style="display:inline-block;margin:0 6px 6px 0;padding:7px 11px;border-radius:7px;background:${bg};color:#fff;text-decoration:none;font-weight:700;font-size:12px">${label}</a>`;
  if (entry.section === "waiting") return b(l.retry, "I fixed it — try again", "#15803d") + b(`${l.page}?do=cancel`, "Not needed — close", "#9a3412");
  return b(`${l.page}?do=done`, "Done — close", "#15803d") + b(`${l.page}?do=still_open`, "Still open", "#6b7280") + b(`${l.page}?do=cancel`, "Cancel", "#9a3412");
}

function render({ companyName, data, sections, email }) {
  const order = ["overdue", "waiting", "due_tomorrow", "open_tickets", "followups", "feedback", "incomplete", "closed"].filter((k) => sections[k]);
  const counts = Object.fromEntries(Object.keys(SECTIONS).map((k) => [k, data[k].length]));
  const unresolved = data.waiting.length + data.overdue.length + data.due_tomorrow.length + data.open_tickets.length;
  const subject = `Daily briefing — ${companyName}: ${unresolved} unresolved (${data.overdue.length} overdue, ${data.waiting.length} waiting, ${data.due_tomorrow.length} due tomorrow)`;
  const card = (e, withButtons = true) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #eceaf2;vertical-align:top">
      <div style="font-weight:700">${esc(e.customer)} ${e.company ? `<span style="font-weight:400;color:#4b5563">· ${esc(e.company)}</span>` : ""}</div>
      <div style="font-size:13px;color:#4b5563">${esc(e.reference || e.code)} · ${esc(e.channel || "")} · waiting ${esc(e.waited || "")}${e.followups ? ` · ${e.followups} follow-up${e.followups === 1 ? "" : "s"}` : ""}${e.contact ? ` · ${esc(e.contact)}` : ""}</div>
      <div style="margin:4px 0"><b>Need:</b> ${esc(e.need)}</div>
      ${e.problem ? `<div style="font-size:13px"><b>Problem:</b> ${esc(e.problem)}</div>` : ""}
      ${e.recommendation ? `<div style="font-size:13px;color:#166534"><b>Recommendation:</b> ${esc(e.recommendation)}</div>` : ""}
      ${e.lastWords ? `<div style="font-size:12px;color:#6a7382">Customer last said: “${esc(String(e.lastWords).slice(0, 160))}”</div>` : ""}
      ${e.closedHow ? `<div style="font-size:13px;color:#166534">${esc(e.closedHow)}</div>` : ""}
      ${withButtons && e.section ? `<div style="margin-top:6px">${buttonsFor(e, email)}</div>` : ""}
    </td></tr>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:680px;margin:0 auto;color:#1a2233">
    <h2 style="margin:0 0 4px">Daily briefing — ${esc(companyName)}</h2>
    <p style="margin:0 0 14px;color:#4b5563">${esc(manilaNow().date)} · ${unresolved} unresolved: <b>${data.overdue.length}</b> overdue · <b>${data.waiting.length}</b> waiting for staff · <b>${data.due_tomorrow.length}</b> due tomorrow · <b>${data.open_tickets.length}</b> open · ${data.closed.length} closed since last report</p>
    ${order.map((k) => `<h3 style="margin:18px 0 4px;font-size:16px">${esc(SECTIONS[k])} (${data[k].length})</h3>
      ${data[k].length ? `<table style="width:100%;border-collapse:collapse">${data[k].map((e) => card(e, !["followups", "feedback", "closed", "incomplete"].includes(k))).join("")}</table>` : `<p style="color:#6a7382;font-size:13px;margin:0">None.</p>`}`).join("")}
    <p style="font-size:12px;color:#6a7382;margin-top:18px">Buttons open a confirm page first. Done closes the schedule in your system and tells the customer. One case per customer need — no duplicate tickets.</p>
  </div>`;
  const text = [subject, "", ...order.flatMap((k) => [`== ${SECTIONS[k]} (${data[k].length})`, ...data[k].map((e) => `- ${e.customer} | ${e.reference || e.code} | ${e.need} | waiting ${e.waited || ""}${e.problem ? ` | ${e.problem}` : ""}${e.recommendation ? ` | -> ${e.recommendation}` : ""}`), ""])].join("\n");
  return { subject, html, text, counts };
}

async function sendReport(companyId, { onlyTo = null } = {}) {
  const [settings, company] = await Promise.all([
    prisma.companySetting.findUnique({ where: { company_id: companyId } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })
  ]);
  const cfg = normalize(settings?.briefing_settings || {});
  const since = cfg.last_sent_at || new Date(Date.now() - 86400000).toISOString();
  const data = await collect(companyId, since);
  const { sendNotification } = require("./notify");
  const platform = String(process.env.ADMIN_ALERT_EMAIL || "").split(/[,;\s]+/).filter((e) => e.includes("@")).map((e) => e.toLowerCase());
  const tenant = onlyTo ? [{ email: String(onlyTo).toLowerCase(), name: "" }] : recipientsFor(settings);
  const results = [];
  for (const r of tenant) {
    const rep = render({ companyName: company?.name || "", data, sections: cfg.sections, email: r.email });
    results.push({ to: r.email, ...(await sendNotification({ to: r.email, subject: rep.subject, text: rep.text, html: rep.html, audience: "tenant", tenantName: company?.name || "" })) });
  }
  if (!onlyTo) {
    for (const email of platform.filter((e) => !tenant.some((t) => t.email === e))) {
      const rep = render({ companyName: company?.name || "", data, sections: cfg.sections, email });
      results.push({ to: email, ...(await sendNotification({ to: email, subject: rep.subject, text: rep.text, html: rep.html, audience: "platform", tenantName: company?.name || "", tenantRecipients: tenant.map((t) => t.email) })) });
    }
  }
  const counts = Object.fromEntries(Object.keys(SECTIONS).map((k) => [k, data[k].length]));
  console.log("[briefing] company=%s sent to %s counts=%j", companyId, results.map((r) => `${r.to}:${r.ok ? "ok" : "fail"}`).join(","), counts);
  return { ok: results.some((r) => r.ok), results, counts };
}

/** Called every minute: send each business's report once on its day, at/after its time (within 3 h). */
let running = false;
async function runDue() {
  if (running) return;
  running = true;
  try {
    const now = manilaNow();
    const rows = await prisma.companySetting.findMany({ where: { briefing_settings: { path: ["enabled"], equals: true } }, select: { company_id: true, briefing_settings: true } });
    for (const row of rows) {
      const cfg = normalize(row.briefing_settings);
      if (!cfg.days.includes(now.dow) || cfg.last_sent_date === now.date) continue;
      const [h, m] = cfg.time.split(":").map(Number);
      const [nh, nm] = now.time.split(":").map(Number);
      const minutesLate = (nh * 60 + nm) - (h * 60 + m);
      if (minutesLate < 0 || minutesLate > 180) continue;
      await prisma.companySetting.update({ where: { company_id: row.company_id }, data: { briefing_settings: { ...row.briefing_settings, last_sent_date: now.date, last_sent_at: new Date().toISOString() } } });
      await sendReport(row.company_id).catch((error) => console.error("[briefing] failed company=%s: %s", row.company_id, error.stack || error.message));
    }
  } finally { running = false; }
}

module.exports = { SECTIONS, DEFAULTS, normalize, collect, render, sendReport, runDue, recipientsFor };
