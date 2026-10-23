/**
 * After-service follow-up (added 2026-10-20, Mike).
 *
 * 1) COMPLETION CHECK — always right after a job is closed / delivered in the business system:
 *    the customer gets an email "Was it done?" (Yes / No). No -> the team is alerted at once.
 *    (Messenger can only message within 24 h of the customer's last message, so this goes by email.)
 * 2) SURVEY — on the same page, only the topics that are due for this customer, by the frequency set
 *    in Business Engines > Customer Service > After-service follow-up:
 *      field_staff (technician / delivery staff), customer_service (staff), ai (online assistant),
 *      service (overall). Frequency per topic, counted in JOBS (not months, Mike 2026-10-20 — less
 *      annoying): off | every_job | every_2_jobs | every_3_jobs | every_5_jobs | every_10_jobs.
 *    Low ratings alert the team.
 *
 * Links in the email open a page; nothing is recorded until the customer presses Submit
 * (email link scanners open links too).
 */
const crypto = require("crypto");
const { prisma } = require("./db");

const START = new Date("2026-10-20T11:30:00Z"); // never email jobs closed before this feature existed
const TOPICS = {
  field_staff: { label: "Field staff (technician / delivery staff)" },
  customer_service: { label: "Customer service staff" },
  ai: { label: "AI assistant (chat / email replies)" },
  service: { label: "Overall service" }
};
// Value = ask once every N finished jobs of the same customer.
const FREQUENCIES = { off: null, every_job: 1, every_2_jobs: 2, every_3_jobs: 3, every_5_jobs: 5, every_10_jobs: 10 };
const FREQ_LABELS = { off: "Off", every_job: "Every job", every_2_jobs: "Every 2 jobs", every_3_jobs: "Every 3 jobs", every_5_jobs: "Every 5 jobs", every_10_jobs: "Every 10 jobs" };
const LEGACY = { monthly: "every_3_jobs", quarterly: "every_5_jobs", semiannual: "every_10_jobs" };
const DEFAULTS = {
  completion_check: true,
  topics: { field_staff: "every_2_jobs", customer_service: "every_3_jobs", ai: "every_3_jobs", service: "every_5_jobs" },
  low_rating: 2
};
const SUPPLY = ["ink", "toner", "cartridge"];

function normalize(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const topics = {};
  for (const key of Object.keys(TOPICS)) {
    const raw = String(r.topics?.[key] ?? DEFAULTS.topics[key]);
    const v = LEGACY[raw] || raw;
    topics[key] = Object.prototype.hasOwnProperty.call(FREQUENCIES, v) ? v : DEFAULTS.topics[key];
  }
  const low = Number(r.low_rating);
  return { completion_check: r.completion_check !== false, topics, low_rating: [1, 2, 3].includes(low) ? low : DEFAULTS.low_rating };
}

async function rulesFor(companyId) {
  const row = await require("./scheduling-rules").tenantEngineFor(companyId, "customer_service").catch(() => null);
  return { rules: normalize(row?.feedback_rules || {}), engine: row };
}

function baseUrl() { return String(process.env.PUBLIC_URL || "https://aistaff.click").replace(/\/$/, ""); }
function hash(token) { return crypto.createHash("sha256").update(String(token)).digest("hex"); }
function esc(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function shortName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}
function prettyDate(text) {
  const d = text ? new Date(`${String(text).replace(" ", "T")}+08:00`) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

/** What was done, in plain words: "delivery of 3 pc Yellow Ink" / "service visit for your machine". */
function jobFacts(args = {}) {
  const category = String(args.category?.value ?? args.category ?? "").toLowerCase();
  const supply = SUPPLY.includes(category);
  const items = Array.isArray(args.releaseitems) ? args.releaseitems.filter((i) => i && i.item).map((i) => `${i.quantity} ${i.unit || "pc"} ${i.item}`) : [];
  const label = supply ? `delivery of ${items.length ? items.join(", ") : category}` : "service visit for your machine";
  return { supply, label, role: supply ? "delivery staff" : "technician", question: supply ? "Did you receive the items, complete and correct?" : "Is your machine working properly now?" };
}

async function customerOf(row) {
  const a = row.requested_arguments || {};
  let email = String(a.calleremail || "").trim().toLowerCase();
  let name = String(a.callername || "").trim();
  if ((!email || !name) && row.conversation_id) {
    const c = await prisma.conversation.findUnique({ where: { id: row.conversation_id }, select: { customer_profile: true } }).catch(() => null);
    const known = c?.customer_profile?.known || {};
    email = email || String(known.calleremail || "").trim().toLowerCase();
    name = name || String(known.callername || "").trim();
  }
  return { email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : "", name };
}

async function sendCustomerEmail({ companyId, conversationId, to, subject, text, html }) {
  const viaTenant = await require("./email-channel").sendTenantEmail({ companyId, to, subject, text, html, conversationId }).catch((e) => ({ ok: false, reason: e.message }));
  if (viaTenant.ok) return viaTenant;
  return require("./notify").sendNotification({ to, subject, text, html });
}

/** Send the "was it done?" email for one finished case (once per case). */
async function sendCompletionCheck(row, status = null) {
  if (await prisma.customerFeedback.findUnique({ where: { request_id: row.id } })) return { ok: false, reason: "already" };
  const { rules } = await rulesFor(row.company_id);
  if (!rules.completion_check) return { ok: false, reason: "off" };
  const cases = require("./cases");
  if (!status) {
    const st = await cases.ticketAction({ companyId: row.company_id, conversationId: row.conversation_id, operationKey: "get_service_status", args: { ticketReference: row.reference } }).catch(() => null);
    status = st?.ok ? (st.facts?.ticket?.schedule || null) : null;
  }
  // Only fresh jobs: finished in the last 3 days and after this feature started (no surprise emails about old work).
  const finished = status?.finishedAt ? Date.parse(`${String(status.finishedAt).replace(" ", "T")}+08:00`) : NaN;
  const tooOld = Number.isFinite(finished) && finished < Math.max(START.getTime(), Date.now() - 3 * 86400000);
  const company = await prisma.company.findUnique({ where: { id: row.company_id }, select: { name: true } });
  const companyName = company?.name || "our team";
  const customer = await customerOf(row);
  const job = jobFacts(row.requested_arguments || {});
  const token = crypto.randomBytes(24).toString("base64url");
  const fb = await prisma.customerFeedback.create({ data: {
    company_id: row.company_id, request_id: row.id, conversation_id: row.conversation_id || null, token_hash: hash(token),
    reference: row.reference || null, customer_key: customer.email || null, customer_name: customer.name || null, customer_email: customer.email || null,
    job_label: job.label, staff_name: status?.assignedTo || null, staff_role: job.role, finished_at: status?.finishedAt || null
  } });
  if (!customer.email || tooOld) {
    await prisma.customerFeedback.update({ where: { id: fb.id }, data: { send_error: tooOld ? `not sent: finished ${status.finishedAt}, too long ago` : "no customer email" } });
    return { ok: false, reason: tooOld ? "too_old" : "no_email" };
  }
  const link = (answer) => `${baseUrl()}/feedback/${token}?done=${answer}`;
  const staff = shortName(status?.assignedTo);
  const when = prettyDate(status?.finishedAt);
  const intro = `Our records show the ${job.label}${row.reference ? ` (reference ${row.reference})` : ""} was completed${staff ? ` by ${staff}, our ${job.role},` : ""}${when ? ` on ${when}` : ""}.`;
  const subject = `${job.supply ? "Did you receive your order?" : "Is your machine OK now?"}${row.reference ? ` — ${row.reference}` : ""} — ${companyName}`;
  const text = [
    `Hi${customer.name ? ` ${customer.name}` : ""},`, "", intro, "", `${job.question} Please tell us with one click:`,
    `Yes, it is done: ${link("yes")}`, `No, there is still a problem: ${link("no")}`, "",
    "It takes a few seconds and helps us make sure nothing is missed.", "", `— ${companyName}`
  ].join("\n");
  const button = (href, label, bg) => `<a href="${esc(href)}" style="display:inline-block;margin:6px 8px 6px 0;padding:12px 18px;border-radius:8px;background:${bg};color:#fff;text-decoration:none;font-weight:700">${esc(label)}</a>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#1a2233;font-size:15px;line-height:1.5">
    <p>Hi${customer.name ? ` ${esc(customer.name)}` : ""},</p>
    <p>${esc(intro)}</p>
    <p><b>${esc(job.question)}</b> Please tell us with one click:</p>
    <p>${button(link("yes"), "Yes, it is done", "#15803d")}${button(link("no"), "No, there is still a problem", "#b91c1c")}</p>
    <p style="color:#6a7382;font-size:13px">It takes a few seconds and helps us make sure nothing is missed.</p>
    <p style="color:#6a7382;font-size:13px">— ${esc(companyName)}</p></div>`;
  const sent = await sendCustomerEmail({ companyId: row.company_id, conversationId: row.conversation_id, to: customer.email, subject, text, html });
  await prisma.customerFeedback.update({ where: { id: fb.id }, data: sent.ok ? { sent_at: new Date() } : { send_error: String(sent.reason || "send failed").slice(0, 300) } });
  await cases.addHistory(row.id, { type: "feedback", note: sent.ok ? `completion check emailed to ${customer.email}` : `completion check NOT sent (${sent.reason || "error"})` }).catch(() => {});
  console.log("[feedback] completion check %s for %s (%s)", sent.ok ? "sent" : "FAILED", row.reference || row.id, customer.email);
  return { ok: Boolean(sent.ok), feedback_id: fb.id };
}

/**
 * Survey topics due for this customer on this job. "Every N jobs": asked when N jobs (this one
 * included) have passed since the customer was last ASKED that topic. Never asked before = due.
 */
async function topicsDue(companyId, customerKey, rules, excludeId = null) {
  const keys = Object.keys(TOPICS).filter((k) => FREQUENCIES[rules.topics[k]]);
  if (!keys.length) return [];
  const past = customerKey ? await prisma.customerFeedback.findMany({
    where: { company_id: companyId, customer_key: customerKey, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { created_at: "desc" }, take: 100, select: { topics: true }
  }) : [];
  return keys.filter((k) => {
    const every = FREQUENCIES[rules.topics[k]];
    if (every <= 1) return true;
    const index = past.findIndex((p) => Array.isArray(p.topics) && p.topics.includes(k));
    if (index === -1) return true;            // never asked
    return index + 1 >= every;                // jobs since then, counting this one
  });
}

let running = false;
const checkedAt = new Map();
/** Every few minutes: open tickets that are now done -> case done -> completion check right away. */
async function sweep() {
  if (running) return;
  running = true;
  try {
    const cases = require("./cases");
    const open = await prisma.businessOperationRequest.findMany({ where: { case_status: "ticket_open", reference: { not: null } }, orderBy: { updated_at: "asc" }, take: 200 });
    const rulesCache = new Map();
    for (const row of open) {
      if (Date.now() - (checkedAt.get(row.id) || 0) < 5 * 60 * 1000) continue;
      checkedAt.set(row.id, Date.now());
      if (!rulesCache.has(row.company_id)) rulesCache.set(row.company_id, (await rulesFor(row.company_id)).rules);
      const st = await cases.ticketAction({ companyId: row.company_id, conversationId: row.conversation_id, operationKey: "get_service_status", args: { ticketReference: row.reference } }).catch(() => null);
      const t = st?.ok ? (st.facts?.ticket?.schedule || null) : null;
      if (t?.state === "done") {
        await cases.setCase(row.id, { case_status: "done", closed_at: new Date() });
        await cases.addHistory(row.id, { type: "done", note: `finished in the system ${t.finishedAt || ""}`.trim() });
        if (rulesCache.get(row.company_id).completion_check) await sendCompletionCheck({ ...row, case_status: "done" }, t).catch((e) => console.error("[feedback] %s", e.message));
      } else if (t?.state === "cancelled") {
        await cases.setCase(row.id, { case_status: "cancelled", closed_at: new Date() });
        await cases.addHistory(row.id, { type: "cancelled", note: "cancelled in the system" });
      }
    }
    // Cases closed as done elsewhere (Director, briefing): send their completion check too.
    const since = new Date(Math.max(START.getTime(), Date.now() - 7 * 86400000));
    const done = await prisma.businessOperationRequest.findMany({ where: { case_status: "done", reference: { not: null }, closed_at: { gte: since } }, take: 100 });
    if (done.length) {
      const have = new Set((await prisma.customerFeedback.findMany({ where: { request_id: { in: done.map((d) => d.id) } }, select: { request_id: true } })).map((f) => f.request_id));
      for (const row of done) if (!have.has(row.id)) await sendCompletionCheck(row).catch((e) => console.error("[feedback] %s", e.message));
    }
  } catch (error) {
    console.error("[feedback] sweep failed: %s", error.message);
  } finally {
    running = false;
  }
}

/** Save the customer's answers; alert the team on "not done" or low ratings. */
async function recordAnswer(fb, input) {
  const { rules } = await rulesFor(fb.company_id);
  const done = input.done === "no" ? "no" : input.done === "yes" ? "yes" : null;
  const ratings = {};
  for (const k of Object.keys(TOPICS)) {
    const n = Number(input[`r_${k}`]);
    if (Number.isInteger(n) && n >= 1 && n <= 5 && (fb.topics || []).includes(k)) ratings[k] = n;
  }
  const answers = { ...(fb.answers || {}), ratings: { ...(fb.answers?.ratings || {}), ...ratings } };
  const problem = String(input.problem || "").trim().slice(0, 1000);
  const comment = String(input.comment || "").trim().slice(0, 1000);
  if (problem) answers.problem = problem;
  if (comment) answers.comment = comment;
  const updated = await prisma.customerFeedback.update({ where: { id: fb.id }, data: { done: done || fb.done, answers, answered_at: new Date() } });

  const lowTopics = Object.entries(ratings).filter(([, n]) => n <= rules.low_rating).map(([k, n]) => `${TOPICS[k].label}: ${n}/5`);
  const parts = [done ? `done = ${done}` : "", ...Object.entries(ratings).map(([k, n]) => `${k.replace("_", " ")} ${n}/5`), problem ? `problem: "${problem.slice(0, 120)}"` : "", comment ? `comment: "${comment.slice(0, 120)}"` : ""].filter(Boolean);
  await require("./cases").addHistory(fb.request_id, { type: "feedback", note: parts.join(" · ") }).catch(() => {});
  const notDone = done === "no";
  if (notDone || lowTopics.length) {
    const settings = await prisma.companySetting.findUnique({ where: { company_id: fb.company_id } });
    const company = await prisma.company.findUnique({ where: { id: fb.company_id }, select: { name: true } });
    const subject = notDone
      ? `NOT DONE: ${fb.customer_name || "customer"} says the ${fb.job_label || "job"} is not OK — ${fb.reference || ""}`.trim()
      : `Low rating from ${fb.customer_name || "a customer"} — ${fb.reference || ""}`.trim();
    const todo = notDone
      ? "The job is closed in the system, but the customer says it is NOT done. Call the customer today and send someone back if needed (create a new service request)."
      : "Call the customer to understand what went wrong and fix it.";
    const rows = [
      ["Customer", fb.customer_name], ["Email", fb.customer_email], ["Reference", fb.reference], ["Job", fb.job_label],
      ["Done by", fb.staff_name ? `${fb.staff_name} (${fb.staff_role || "staff"})` : ""], ["Finished", fb.finished_at],
      ["Was it done?", done === "no" ? "NO" : done === "yes" ? "Yes" : ""], ["What is wrong", problem],
      ...Object.entries(updated.answers?.ratings || {}).map(([k, n]) => [TOPICS[k].label, `${n}/5`]), ["Comment", comment]
    ].filter(([, v]) => v);
    const notify = require("./notify");
    const text = [subject, "", todo, "", ...rows.map(([k, v]) => `${k}: ${v}`)].join("\n");
    const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a2233"><h2 style="font-size:18px">${esc(subject)}</h2><p style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:10px 12px"><b>${esc(todo)}</b></p><table style="border-collapse:collapse;width:100%;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eef1f5;color:#6a7382;width:40%">${esc(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #eef1f5">${esc(v)}</td></tr>`).join("")}</table></div>`;
    await notify.sendToTenantAndPlatform({ settings, tenantName: company?.name || "", build: () => ({ subject, text, html }) }).catch(() => null);
    await prisma.customerFeedback.update({ where: { id: fb.id }, data: { alerted_at: new Date() } });
    if (notDone) await require("./cases").addHistory(fb.request_id, { type: "complaint", note: "customer says the finished job is NOT done" }).catch(() => {});
  }
  return updated;
}

/** Numbers for the settings panel and the daily briefing. */
async function summary(companyId, days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await prisma.customerFeedback.findMany({ where: { company_id: companyId, created_at: { gte: since } }, orderBy: { created_at: "desc" }, take: 500 });
  const answered = rows.filter((r) => r.answered_at);
  const avg = {};
  for (const k of Object.keys(TOPICS)) {
    const vals = answered.map((r) => r.answers?.ratings?.[k]).filter((n) => Number.isFinite(n));
    avg[k] = vals.length ? { average: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10, count: vals.length } : null;
  }
  return {
    days, sent: rows.filter((r) => r.sent_at).length, answered: answered.length,
    not_done: answered.filter((r) => r.done === "no").length, average: avg,
    latest: answered.slice(0, 10).map((r) => ({ at: r.answered_at, customer: r.customer_name || r.customer_email || "Customer", reference: r.reference, job: r.job_label, staff: r.staff_name, done: r.done, ratings: r.answers?.ratings || {}, problem: r.answers?.problem || "", comment: r.answers?.comment || "" }))
  };
}

module.exports = { TOPICS, FREQUENCIES, FREQ_LABELS, DEFAULTS, normalize, rulesFor, jobFacts, sendCompletionCheck, topicsDue, sweep, recordAnswer, summary, hash, shortName, prettyDate, esc };
