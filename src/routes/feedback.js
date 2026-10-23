/**
 * After-service follow-up routes (added 2026-10-20).
 *   Public:  GET/POST /feedback/:token   — the page opened from the "was it done?" email.
 *   Admin:   GET/PUT  /api/engine-feedback/:engineKey  — settings + results (Customer Service engine).
 */
const express = require("express");
const { prisma } = require("../db");
const fb = require("../feedback");
const { esc } = fb;

const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

function page(title, body, color = "#4b3ecf") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
  body{margin:0;background:#f5f6fa;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1a2233;line-height:1.5}
  main{max-width:560px;margin:0 auto;padding:24px 16px 48px}
  .card{background:#fff;border:1px solid #e3e8f0;border-radius:14px;padding:20px;margin:0 0 16px}
  h1{font-size:20px;margin:0 0 6px} h2{font-size:16px;margin:0 0 10px}
  .muted{color:#6a7382;font-size:14px}
  .choice{display:flex;gap:10px;flex-wrap:wrap}
  .choice label{flex:1;min-width:140px;border:2px solid #e3e8f0;border-radius:10px;padding:12px;cursor:pointer;font-weight:600;text-align:center}
  .choice input{position:absolute;opacity:0}
  .choice input:checked+span{color:${color}}
  .choice label:has(input:checked){border-color:${color};background:#f4f2ff}
  .stars{display:flex;flex-direction:row-reverse;justify-content:flex-end;gap:4px}
  .stars input{position:absolute;opacity:0}
  .stars label{font-size:34px;color:#cfd5df;cursor:pointer;line-height:1}
  .stars input:checked~label,.stars label:hover,.stars label:hover~label{color:#f5a524}
  .q{margin:16px 0}
  textarea{width:100%;box-sizing:border-box;border:1px solid #cfd5df;border-radius:10px;padding:10px;font:inherit;min-height:84px}
  button{width:100%;padding:14px;border:0;border-radius:10px;background:${color};color:#fff;font-size:16px;font-weight:700;cursor:pointer}
</style></head><body><main>${body}</main></body></html>`;
}

function stars(name, label) {
  const opts = [5, 4, 3, 2, 1].map((n) => `<input type="radio" id="${name}${n}" name="${name}" value="${n}"><label for="${name}${n}" title="${n} star${n > 1 ? "s" : ""}">★</label>`).join("");
  return `<div class="q"><div style="font-weight:600">${esc(label)}</div><div class="stars">${opts}</div></div>`;
}

async function load(token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ""))) return null;
  return prisma.customerFeedback.findUnique({ where: { token_hash: fb.hash(token) } });
}

function buildPublicRouter() {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: "8kb" }));

  router.get("/:token", async (req, res) => {
    try {
      if (limited(`ip:${req.ip}`, 60, 10 * 60 * 1000)) return res.status(429).send(page("Please wait", `<div class="card"><h1>Too many requests</h1><p class="muted">Please try again in a few minutes.</p></div>`));
      const row = await load(req.params.token);
      if (!row) return res.status(404).send(page("Link not valid", `<div class="card"><h1>This link is not valid anymore</h1><p class="muted">Please reply to our email or message us if you need help.</p></div>`));
      const company = await prisma.company.findUnique({ where: { id: row.company_id }, select: { name: true } });
      const { rules } = await fb.rulesFor(row.company_id);
      // Topics shown once are kept for this job (so the page stays the same if reopened).
      let topics = Array.isArray(row.topics) ? row.topics : [];
      if (!row.answered_at && !topics.length) {
        topics = await fb.topicsDue(row.company_id, row.customer_key, rules, row.id);
        if (topics.length) await prisma.customerFeedback.update({ where: { id: row.id }, data: { topics } });
      }
      const pre = req.query.done === "no" ? "no" : req.query.done === "yes" ? "yes" : (row.done || "");
      const job = fb.jobFacts({ category: row.staff_role === "delivery staff" ? "ink" : "service" });
      const staff = fb.shortName(row.staff_name);
      const questions = {
        field_staff: staff ? `How would you rate ${staff}, our ${row.staff_role || "staff"}?` : `How would you rate our ${row.staff_role || "field staff"}?`,
        customer_service: "How would you rate our customer service team (calls, chat and email)?",
        ai: "How helpful was our online assistant that answered your messages?",
        service: `Overall, how satisfied are you with ${company?.name || "our"} service?`
      };
      const survey = topics.length ? `<div class="card" id="survey"><h2>Help us improve <span class="muted" style="font-weight:400">(optional)</span></h2>
        ${topics.map((k) => stars(`r_${k}`, questions[k])).join("")}
        <div class="q"><div style="font-weight:600">Anything we can do better?</div><textarea name="comment" placeholder="Your comment (optional)"></textarea></div></div>` : "";
      const body = `<div class="card"><h1>${esc(company?.name || "Your request")}</h1>
          <p class="muted">${esc(row.reference ? `Reference ${row.reference} · ` : "")}${esc(row.job_label || "")}${staff ? ` · ${esc(staff)}` : ""}${row.finished_at ? ` · ${esc(fb.prettyDate(row.finished_at))}` : ""}</p>
          ${row.answered_at ? `<p class="muted"><b>Thank you, we already received your answer.</b> You can update it below.</p>` : ""}</div>
        <form method="post" action="/feedback/${esc(req.params.token)}">
          <div class="card"><h2>${esc(job.question.replace("Did you receive the items, complete and correct?", "Did you receive the items, complete and correct?"))}</h2>
            <div class="choice">
              <label><input type="radio" name="done" value="yes"${pre === "yes" ? " checked" : ""} required><span>Yes, it is done</span></label>
              <label><input type="radio" name="done" value="no"${pre === "no" ? " checked" : ""}><span>No, there is still a problem</span></label>
            </div>
            <div class="q" id="problemBox"${pre === "no" ? "" : " hidden"}><div style="font-weight:600">What is still wrong?</div><textarea name="problem" placeholder="Tell us what happened so we can fix it"></textarea></div>
          </div>
          <div id="surveyWrap"${pre === "no" ? " hidden" : ""}>${survey}</div>
          <button type="submit">Submit</button>
        </form>
        <script>
          document.querySelectorAll('input[name=done]').forEach(function(r){r.addEventListener('change',function(){var no=document.querySelector('input[name=done]:checked').value==='no';document.getElementById('problemBox').hidden=!no;document.getElementById('surveyWrap').hidden=no;});});
        </script>`;
      res.set("Cache-Control", "no-store").send(page(`${company?.name || "Feedback"} — your request`, body));
    } catch (error) {
      console.error("[feedback] page: %s", error.message);
      res.status(500).send(page("Error", `<div class="card"><h1>Something went wrong</h1><p class="muted">Please try again later.</p></div>`));
    }
  });

  router.post("/:token", async (req, res) => {
    try {
      if (limited(`ip:${req.ip}`, 30, 10 * 60 * 1000)) return res.status(429).send(page("Please wait", `<div class="card"><h1>Too many requests</h1></div>`));
      const row = await load(req.params.token);
      if (!row) return res.status(404).send(page("Link not valid", `<div class="card"><h1>This link is not valid anymore</h1></div>`));
      const saved = await fb.recordAnswer(row, req.body || {});
      const notDone = saved.done === "no";
      res.set("Cache-Control", "no-store").send(page("Thank you", `<div class="card"><h1>${notDone ? "Sorry about that — we're on it" : "Thank you!"}</h1><p>${notDone ? "We have alerted our team right away. Someone will contact you to fix it." : "Your answer helps us serve you better."}</p></div>`));
    } catch (error) {
      console.error("[feedback] submit: %s", error.message);
      res.status(500).send(page("Error", `<div class="card"><h1>Something went wrong</h1><p class="muted">Please try again later.</p></div>`));
    }
  });
  return router;
}

function buildAdminRouter({ requireAuth }) {
  const router = express.Router();
  router.use(requireAuth);
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  router.get("/:engineKey", wrap(async (req, res) => {
    const { rules, engine } = await fb.rulesFor(req.companyId);
    if (!engine) return res.status(404).json({ error: "Set up the Customer Service engine first." });
    res.json({ settings: rules, topics: fb.TOPICS, frequencies: fb.FREQ_LABELS, summary: await fb.summary(req.companyId, 30) });
  }));
  router.put("/:engineKey", wrap(async (req, res) => {
    const role = String(req.user?.role || "").toLowerCase();
    if (!["admin", "account_admin", "owner"].includes(role) && !(req.user?.platform_role && req.assistSessionId)) return res.status(403).json({ error: "Only a tenant administrator can change these settings." });
    const { rules, engine } = await fb.rulesFor(req.companyId);
    if (!engine) return res.status(404).json({ error: "Set up the Customer Service engine first." });
    const next = fb.normalize({ ...rules, ...(req.body || {}), topics: { ...rules.topics, ...((req.body || {}).topics || {}) } });
    await prisma.tenantEngine.update({ where: { id: engine.id }, data: { feedback_rules: next } });
    await prisma.tenantAuditLog.create({ data: { company_id: req.companyId, actor_id: req.user?.id || null, actor_email: req.user?.email || null, action: "feedback_rules.update", target_type: "tenant_engine", metadata: next } }).catch(() => {});
    res.json({ settings: next });
  }));
  router.use((error, req, res, next) => { console.error("[feedback-admin] %s", error.stack || error.message); res.status(500).json({ error: error.message }); });
  return router;
}

module.exports = { buildPublicRouter, buildAdminRouter };
