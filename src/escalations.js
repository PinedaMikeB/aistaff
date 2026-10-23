/**
 * Urgent alerts that REPEAT until someone says they handled it (Mike 2026-10-23).
 * Used when the AI cannot finish something itself (e.g. a phone request that could not be saved).
 * Every round sends BOTH an email and a text (SMS through Pitch's SIM router) to the business's
 * urgent contacts, every ESCALATION_REPEAT_MIN minutes (default 15), until the "I handled it" page
 * is used: https://aistaff.click/e/<code>.
 * Urgent contacts = Settings > Alert contacts with "urgent" ticked; none ticked -> the first contact.
 * Stored in the staff_escalations table (created here if missing; additive, no Prisma model).
 */
const crypto = require("crypto");
const express = require("express");
const { prisma } = require("./db");

const REPEAT_MIN = () => Math.max(5, Number(process.env.ESCALATION_REPEAT_MIN || 15));
const BASE = () => String(process.env.PUBLIC_BASE_URL || "https://aistaff.click").replace(/\/$/, "");
let tableReady = null;

function ensureTable() {
  if (!tableReady) {
    tableReady = prisma.$executeRawUnsafe(`create table if not exists staff_escalations (
      id text primary key, code text unique not null, company_id text not null, conversation_id text, request_id text,
      title text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
      last_sent_at timestamptz, sent_count int not null default 0, last_result jsonb,
      acked_at timestamptz, acked_by text, ack_note text)`)
      .then(() => prisma.$executeRawUnsafe(`alter table staff_escalations add column if not exists kind text`))
      .catch((error) => { tableReady = null; throw error; });
  }
  return tableReady;
}

function esc(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function intlPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(d)) return `+63${d.slice(1)}`;
  if (/^639\d{9}$/.test(d)) return `+${d}`;
  return d.length >= 10 ? `+${d}` : "";
}

async function recipients(companyId) {
  const settings = await prisma.companySetting.findUnique({ where: { company_id: companyId }, select: { alert_contacts: true, notify_email: true } }).catch(() => null);
  const contacts = Array.isArray(settings?.alert_contacts) ? settings.alert_contacts.filter((c) => c && (c.email || c.phone)) : [];
  const urgent = contacts.filter((c) => c.urgent);
  const list = urgent.length ? urgent : contacts.slice(0, 1);
  if (!list.length) {
    const email = String(settings?.notify_email || "").split(/[,;\s]+/).find((e) => e.includes("@"));
    if (email) list.push({ name: "", email });
  }
  return list;
}

const { buildGuide } = require("./escalation-playbook");
const APP_BASE = () => String(process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || "https://aistaff.click").replace(/\/$/, "");

/** Where the fix happens: the business's connected system (e.g. app.marga.biz) and the call/chat transcript. */
async function guideFor(row) {
  let systemOrigin = "";
  try {
    const [conn] = await prisma.$queryRawUnsafe(
      `select base_url from integration_connections where company_id=$1 and coalesce(base_url,'')<>'' and disabled_at is null order by updated_at desc nulls last limit 1`, row.company_id);
    if (conn?.base_url) systemOrigin = new URL(conn.base_url).origin;
  } catch (error) { /* no connected system */ }
  const conversationUrl = row.conversation_id ? `${APP_BASE()}/admin/conversations/${row.conversation_id}` : "";
  return buildGuide(row, { systemOrigin, conversationUrl });
}

function detailsRows(details) {
  const { plainWhy } = require("./escalation-playbook");
  return Object.entries(details || {}).filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => (k === "Why" ? [k, plainWhy(v)] : [k, v]));
}

async function sendSms(to, text) {
  const url = process.env.PITCH_SMS_URL, token = process.env.PITCH_INTERNAL_TOKEN;
  if (!url || !token) return { ok: false, reason: "sms_not_configured" };
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-pitch-token": token }, body: JSON.stringify({ to, message: text }), signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({}));
    return res.ok && body.ok ? { ok: true } : { ok: false, reason: body.error || `http_${res.status}` };
  } catch (error) { return { ok: false, reason: error.message }; }
}

async function sendRound(row) {
  const company = await prisma.company.findUnique({ where: { id: row.company_id }, select: { name: true } }).catch(() => null);
  const name = company?.name || "";
  const link = `${BASE()}/e/${row.code}`;
  const round = Number(row.sent_count || 0) + 1;
  const details = row.details && typeof row.details === "object" ? row.details : {};
  const lines = Object.entries(details).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`);
  const g = await guideFor(row);
  const rows = detailsRows(details);
  const fixUrl = (g.actions.find((a) => a.primary && !a.url.startsWith("tel:")) || {}).url || "";
  const subject = `URGENT${round > 1 ? ` (reminder ${round})` : ""}: ${g.headline}`;
  const text = [
    `URGENT — needs a person now.${round > 1 ? ` Reminder ${round}: still not marked as handled.` : ""}`, "",
    g.headline, "", "WHAT HAPPENED", g.problem, "", "WHAT TO DO", ...g.steps.map((x, i) => `${i + 1}. ${x}`), "",
    ...g.actions.map((a) => `${a.label}: ${a.url}`), "",
    "DETAILS", ...rows.map(([k, v]) => `${k}: ${v}`), "",
    `Full guide and "I handled it": ${link}`, "",
    `This repeats every ${REPEAT_MIN()} minutes by email and text until it is marked as handled.`].join("\n");
  const btn = (a) => `<a href="${esc(a.url)}" style="background:${a.primary ? "#1d4ed8" : "#fff"};color:${a.primary ? "#fff" : "#111"};border:1px solid ${a.primary ? "#1d4ed8" : "#ccc"};text-decoration:none;padding:10px 14px;border-radius:8px;display:inline-block;margin:0 6px 8px 0;font-weight:600">${esc(a.label)}</a>`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">
    <p style="background:#fee2e2;color:#991b1b;border-radius:8px;padding:10px 14px;margin:0 0 14px"><b>URGENT — needs a person now.</b>${round > 1 ? ` Reminder ${round}: still not marked as handled.` : ""}</p>
    <p style="font-size:18px;margin:0 0 12px"><b>${esc(g.headline)}</b></p>
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;color:#666"><b>WHAT HAPPENED</b></p>
    <p style="margin:0 0 14px">${esc(g.problem)}</p>
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;color:#666"><b>WHAT TO DO</b></p>
    <ol style="margin:0 0 14px;padding-left:22px">${g.steps.map((x) => `<li style="margin-bottom:4px">${esc(x)}</li>`).join("")}</ol>
    <div style="margin:0 0 10px">${g.actions.map(btn).join("")}</div>
    <p style="margin:6px 0 18px"><a href="${esc(link)}" style="background:#111;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block;font-weight:600">Open the guide · I handled it</a></p>
    ${rows.length ? `<p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;color:#666"><b>DETAILS</b></p><table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:3px 12px 3px 0;color:#555;vertical-align:top">${esc(k)}</td><td style="padding:3px 0">${esc(v)}</td></tr>`).join("")}</table>` : ""}
    <p style="color:#666;font-size:13px;margin-top:18px">This repeats every ${REPEAT_MIN()} minutes by email and text until it is marked as handled.</p></div>`;
  const sms = `URGENT ${name ? `${name}: ` : ""}${g.headline}`.slice(0, 100) + `. What to do: ${link}`;
  const notify = require("./notify");
  const result = [];
  for (const c of await recipients(row.company_id)) {
    if (c.email) {
      const r = await notify.sendNotification({ to: c.email, subject, text, html, audience: "tenant", tenantName: name }).catch((e) => ({ ok: false, reason: e.message }));
      result.push({ to: c.email, via: "email", ok: Boolean(r?.ok), reason: r?.reason || null });
    }
    const phone = intlPhone(c.phone);
    if (phone) {
      const r = await sendSms(phone, sms);
      result.push({ to: phone, via: "sms", ok: r.ok, reason: r.reason || null });
    }
  }
  await prisma.$executeRawUnsafe(`update staff_escalations set last_sent_at=now(), sent_count=sent_count+1, last_result=$2::jsonb where id=$1`, row.id, JSON.stringify(result));
  console.log("[escalation] %s round %d: %s", row.code, round, result.map((r) => `${r.via}:${r.to}=${r.ok ? "sent" : r.reason}`).join(", ") || "no recipients");
  return result;
}

/** Raise an urgent alert (sent right away, then repeated until handled). */
async function raise({ companyId, conversationId = null, requestId = null, title, details = {}, kind = null }) {
  await ensureTable();
  const id = crypto.randomUUID();
  const code = crypto.randomBytes(6).toString("base64url");
  await prisma.$executeRawUnsafe(`insert into staff_escalations (id, code, company_id, conversation_id, request_id, title, details, kind) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    id, code, companyId, conversationId, requestId, String(title || "Needs attention").slice(0, 200), JSON.stringify(details || {}), kind ? String(kind).slice(0, 40) : null);
  const [row] = await prisma.$queryRawUnsafe(`select * from staff_escalations where id=$1`, id);
  sendRound(row).catch((error) => console.error("[escalation] first send failed %s: %s", code, error.message));
  return { id, code, link: `${BASE()}/e/${code}` };
}

let sweeping = false;
async function sweep() {
  if (sweeping) return; sweeping = true;
  try {
    await ensureTable();
    const due = await prisma.$queryRawUnsafe(`select * from staff_escalations where acked_at is null and (last_sent_at is null or last_sent_at < now() - ($1 || ' minutes')::interval) order by created_at limit 20`, String(REPEAT_MIN()));
    for (const row of due) await sendRound(row).catch((error) => console.error("[escalation] resend failed %s: %s", row.code, error.message));
  } catch (error) { console.error("[escalation] sweep failed: %s", error.message); }
  finally { sweeping = false; }
}

/** Open alerts of a business (tenant Inquiries / Settings, Platform). */
async function listOpen(companyId = null) {
  await ensureTable();
  return companyId
    ? prisma.$queryRawUnsafe(`select id, code, title, details, created_at, sent_count, last_sent_at from staff_escalations where acked_at is null and company_id=$1 order by created_at desc limit 50`, companyId)
    : prisma.$queryRawUnsafe(`select id, code, company_id, title, details, created_at, sent_count, last_sent_at from staff_escalations where acked_at is null order by created_at desc limit 100`);
}

async function ack(code, by, note) {
  await ensureTable();
  const n = await prisma.$executeRawUnsafe(`update staff_escalations set acked_at=now(), acked_by=$2, ack_note=$3 where code=$1 and acked_at is null`, String(code), String(by || "link").slice(0, 120), String(note || "").slice(0, 1000));
  return n > 0;
}

function page(title, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
  <style>body{font-family:system-ui,sans-serif;background:#f6f6f7;margin:0;padding:24px 16px;color:#111}.card{max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:22px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  h1{font-size:20px;margin:0 0 12px}td{padding:4px 10px 4px 0;vertical-align:top}td:first-child{color:#666}textarea{width:100%;box-sizing:border-box;min-height:80px;border:1px solid #ccc;border-radius:8px;padding:8px;font:inherit}
  button{background:#111;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-size:16px;margin-top:12px;cursor:pointer}.label{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#666;font-weight:700;margin:16px 0 4px}ol{padding-left:22px;margin:0}li{margin-bottom:6px}.acts{margin-top:14px;display:flex;flex-wrap:wrap;gap:8px}.act{display:inline-block;border:1px solid #ccc;border-radius:8px;padding:10px 14px;text-decoration:none;color:#111;font-weight:600}.act.primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff}summary{cursor:pointer;color:#444}.ok{background:#dcfce7;color:#166534;padding:10px 14px;border-radius:8px}.urgent{background:#fee2e2;color:#991b1b;padding:8px 12px;border-radius:8px;display:inline-block;margin-bottom:10px}</style></head><body><div class="card">${inner}</div></body></html>`;
}

function buildRouter() {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));
  router.get("/:code", async (req, res) => {
    await ensureTable();
    const [row] = await prisma.$queryRawUnsafe(`select * from staff_escalations where code=$1`, String(req.params.code));
    if (!row) return res.status(404).send(page("Not found", "<h1>This alert was not found.</h1>"));
    const g = await guideFor(row);
    const rows = detailsRows(row.details);
    const detailsHtml = rows.length ? `<details style="margin-top:14px"><summary>Details from the call / chat</summary><table style="margin-top:6px">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table></details>` : "";
    const actionsHtml = g.actions.map((a) => `<a class="act${a.primary ? " primary" : ""}" href="${esc(a.url)}"${a.url.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}>${esc(a.label)}</a>`).join("");
    if (row.acked_at) return res.send(page("Handled", `<h1>${esc(g.headline)}</h1><p class="ok">Marked as handled${row.acked_by ? ` by ${esc(row.acked_by)}` : ""} — reminders stopped.</p>${row.ack_note ? `<p><b>What was done:</b> ${esc(row.ack_note)}</p>` : ""}<p class="label">What happened</p><p>${esc(g.problem)}</p>${detailsHtml}`));
    res.send(page("Urgent alert", `<span class="urgent">Urgent · sent ${row.sent_count || 1}×</span><h1>${esc(g.headline)}</h1>
      <p class="label">What happened</p><p>${esc(g.problem)}</p>
      <p class="label">What to do</p><ol>${g.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
      ${actionsHtml ? `<div class="acts">${actionsHtml}</div>` : ""}
      ${detailsHtml}
      <form method="post" style="border-top:1px solid #eee;margin-top:18px;padding-top:6px"><p style="margin:12px 0 6px"><b>Done?</b> What did you do?</p><textarea name="note" placeholder="e.g. Called the customer and booked the technician for tomorrow 9 AM"></textarea>
      <p style="margin:12px 0 6px">Your name</p><input name="by" style="width:100%;box-sizing:border-box;border:1px solid #ccc;border-radius:8px;padding:8px;font:inherit">
      <button type="submit">I handled it — stop the reminders</button></form>`));
  });
  router.post("/:code", async (req, res) => {
    const done = await ack(req.params.code, req.body?.by || "link", req.body?.note || "");
    console.log("[escalation] %s marked handled by %s", req.params.code, req.body?.by || "link");
    res.redirect(303, `${req.baseUrl}/${encodeURIComponent(req.params.code)}${done ? "" : ""}`);
  });
  return router;
}

module.exports = { raise, sweep, ack, listOpen, buildRouter, sendSms, intlPhone, sendRound };
