const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
require("dotenv").config();

const TIME_ZONE = "Asia/Manila";
const DEFAULT_REPORT_DIR = path.join(process.cwd(), "reports", "philgeps-opportunities");
const DEFAULT_TITLE = "AIStaff Daily Procurement Intelligence";

function philippineDateParts() {
  const forced = process.env.PHILGEPS_BRIEFING_DATE_ISO;
  if (forced) return { iso: forced };

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { iso: `${map.year}-${map.month}-${map.day}` };
}

function longPhilippineDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function stringOrFallback(value, fallback = "Not stated publicly.") {
  return String(value || "").trim() || fallback;
}

function listOrFallback(values, fallback = "None stated publicly.") {
  const list = Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return list.length ? list : [fallback];
}

function pickRecipient() {
  return process.env.PHILGEPS_OPPORTUNITY_EMAIL_TO || process.env.ADMIN_ALERT_EMAIL || process.env.SEED_ADMIN_EMAIL || null;
}

function pickRecipientEnvName() {
  if (process.env.PHILGEPS_OPPORTUNITY_EMAIL_TO) return "PHILGEPS_OPPORTUNITY_EMAIL_TO";
  if (process.env.ADMIN_ALERT_EMAIL) return "ADMIN_ALERT_EMAIL";
  if (process.env.SEED_ADMIN_EMAIL) return "SEED_ADMIN_EMAIL";
  return null;
}

function pickAuth() {
  const notifyUser = (process.env.NOTIFY_SMTP_USER || "").trim().toLowerCase();
  const smtpUser = (process.env.SMTP_USER || "").trim().toLowerCase();

  if (notifyUser === "support@aistaff.click" && process.env.NOTIFY_SMTP_PASS) {
    return {
      userEnv: "NOTIFY_SMTP_USER",
      passEnv: "NOTIFY_SMTP_PASS",
      user: process.env.NOTIFY_SMTP_USER,
      pass: process.env.NOTIFY_SMTP_PASS
    };
  }

  if (smtpUser === "support@aistaff.click" && process.env.SMTP_PASS) {
    return {
      userEnv: "SMTP_USER",
      passEnv: "SMTP_PASS",
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    };
  }

  return null;
}

function preflight() {
  const missing = [];
  if (!process.env.SMTP_HOST) missing.push("SMTP_HOST");
  if (!process.env.SMTP_PORT) missing.push("SMTP_PORT");

  const auth = pickAuth();
  if (!auth) {
    if ((process.env.NOTIFY_SMTP_USER || "").trim().toLowerCase() !== "support@aistaff.click" || !process.env.NOTIFY_SMTP_PASS) {
      missing.push("NOTIFY_SMTP_USER", "NOTIFY_SMTP_PASS");
    }
    if ((process.env.SMTP_USER || "").trim().toLowerCase() !== "support@aistaff.click" || !process.env.SMTP_PASS) {
      missing.push("SMTP_USER", "SMTP_PASS");
    }
  }

  const recipient = pickRecipient();
  if (!recipient) {
    missing.push("PHILGEPS_OPPORTUNITY_EMAIL_TO", "ADMIN_ALERT_EMAIL", "SEED_ADMIN_EMAIL");
  }

  return {
    repoPath: process.cwd(),
    envFileLoaded: fs.existsSync(path.join(process.cwd(), ".env")),
    smtpHostPresent: Boolean(process.env.SMTP_HOST),
    smtpPortPresent: Boolean(process.env.SMTP_PORT),
    auth,
    recipient,
    recipientEnvUsed: pickRecipientEnvName(),
    missing: [...new Set(missing)]
  };
}

function parseArgs(argv) {
  const args = { input: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input") {
      args.input = argv[i + 1] || null;
      i += 1;
    }
  }
  return args;
}

function loadReportInput(inputPath) {
  if (!inputPath) {
    throw new Error("Missing required --input <path> argument.");
  }

  const absolute = path.resolve(process.cwd(), inputPath);
  const raw = fs.readFileSync(absolute, "utf8");
  return { absolute, report: JSON.parse(raw) };
}

function recommendationFromLegacy(item) {
  const raw = String(item.recommendation || item.match_rating || "").trim().toUpperCase();
  if (raw === "BID" || raw === "HIGH PRIORITY REVIEW" || raw === "REVIEW" || raw === "SKIP") return raw;
  if (raw === "STRONG MATCH") return "HIGH PRIORITY REVIEW";
  if (raw === "POSSIBLE MATCH") return "REVIEW";
  if (raw === "NOT RECOMMENDED") return "SKIP";
  return "REVIEW";
}

function normalizeScore(item) {
  const value = Number(item.score);
  if (!Number.isFinite(value)) return null;
  if (value <= 10) return Math.round(value * 10) / 10;
  return Math.round(value);
}

function formatScore(score) {
  if (score == null) return "Not scored";
  return score <= 10 ? `${score}/10` : `${score}/100`;
}

function normalizeTopOpportunity(item) {
  return {
    score: normalizeScore(item),
    recommendation: recommendationFromLegacy(item),
    source: stringOrFallback(item.source, "PhilGEPS"),
    title: stringOrFallback(item.title || item.project),
    buyer_organization: stringOrFallback(item.buyer_organization || item.procuring_entity),
    country: stringOrFallback(item.country, "Philippines"),
    reference_number: stringOrFallback(item.reference_number),
    procurement_type: stringOrFallback(item.procurement_type || item.procurement_method),
    published: stringOrFallback(item.published, "Not stated publicly."),
    deadline: stringOrFallback(item.deadline),
    days_remaining: item.days_remaining == null ? "Not stated." : String(item.days_remaining),
    budget_contract_value: stringOrFallback(item.budget_contract_value || item.abc, "Not stated publicly."),
    url: stringOrFallback(item.url || item.official_link),
    why_it_fits_aistaff: stringOrFallback(item.why_it_fits_aistaff || item.why_fit),
    what_they_need: stringOrFallback(item.what_they_need || item.project_summary || item.description_summary),
    eligibility: listOrFallback(item.eligibility || item.important_requirements),
    blockers_risks: listOrFallback(item.blockers_risks || item.risks_or_blockers),
    how_we_could_qualify: listOrFallback(item.how_we_could_qualify, "AIStaff direct fit not yet confirmed from the public notice."),
    next_action: stringOrFallback(item.next_action || item.recommended_next_action)
  };
}

function normalizeSkippedOpportunity(item) {
  return {
    source: stringOrFallback(item.source, "PhilGEPS"),
    title: stringOrFallback(item.title || item.project),
    buyer_organization: stringOrFallback(item.buyer_organization || item.procuring_entity),
    reference_number: stringOrFallback(item.reference_number),
    reason: stringOrFallback(item.reason),
    url: stringOrFallback(item.url || item.official_link)
  };
}

function normalizeUrgentDeadline(item) {
  return {
    source: stringOrFallback(item.source, "PhilGEPS"),
    title: stringOrFallback(item.title || item.project),
    buyer_organization: stringOrFallback(item.buyer_organization || item.procuring_entity),
    reference_number: stringOrFallback(item.reference_number),
    deadline: stringOrFallback(item.deadline),
    days_remaining: item.days_remaining == null ? null : String(item.days_remaining),
    note: stringOrFallback(item.note, "Deadline is approaching."),
    url: stringOrFallback(item.url || item.official_link)
  };
}

function summarizeRecommendations(items) {
  const counts = { BID: 0, "HIGH PRIORITY REVIEW": 0, REVIEW: 0, SKIP: 0 };
  for (const item of items) {
    counts[item.recommendation] = (counts[item.recommendation] || 0) + 1;
  }
  return counts;
}

function normalizeReport(reportInput, dateIso) {
  const topOpportunities = (reportInput.top_opportunities || reportInput.best_opportunities || []).map(normalizeTopOpportunity);
  const skippedOpportunities = (reportInput.skipped_opportunities || reportInput.not_recommended || []).map(normalizeSkippedOpportunity);
  const urgentDeadlines = (reportInput.urgent_deadlines || []).map(normalizeUrgentDeadline);
  const recommendationCounts = summarizeRecommendations(topOpportunities);
  const summary = reportInput.executive_summary || {};
  const datedIso = reportInput.date_iso || dateIso;

  return {
    title: reportInput.title || DEFAULT_TITLE,
    date_iso: datedIso,
    date_long: reportInput.date_long || longPhilippineDate(datedIso),
    report_dir: path.resolve(process.cwd(), reportInput.report_dir || DEFAULT_REPORT_DIR),
    executive_summary: {
      philgeps_opportunities_scanned: Number(summary.philgeps_opportunities_scanned ?? reportInput.philgeps_opportunities_scanned ?? reportInput.opportunities_screened ?? reportInput.opportunities_reviewed ?? 0),
      ungm_opportunities_scanned: Number(summary.ungm_opportunities_scanned ?? reportInput.ungm_opportunities_scanned ?? 0),
      new_relevant_opportunities: Number(summary.new_relevant_opportunities ?? topOpportunities.length),
      source_access_notes: stringOrFallback(summary.source_access_notes ?? reportInput.source_access_notes, "No source access issues recorded."),
      bid_count: Number(summary.bid_count ?? recommendationCounts.BID),
      high_priority_review_count: Number(summary.high_priority_review_count ?? recommendationCounts["HIGH PRIORITY REVIEW"]),
      review_count: Number(summary.review_count ?? recommendationCounts.REVIEW),
      skip_count: Number(summary.skip_count ?? (recommendationCounts.SKIP + skippedOpportunities.length))
    },
    top_opportunities: topOpportunities,
    urgent_deadlines: urgentDeadlines,
    skipped_opportunities: skippedOpportunities,
    todays_recommendation: {
      best_opportunity: stringOrFallback(reportInput.todays_recommendation?.best_opportunity, "No suitable new opportunity found today"),
      documents_to_prepare: listOrFallback(reportInput.todays_recommendation?.documents_to_prepare, "None."),
      clarifications_to_request: listOrFallback(reportInput.todays_recommendation?.clarifications_to_request, "None.")
    },
    source_urls_checked: listOrFallback(reportInput.source_urls_checked, "None recorded."),
    notes: listOrFallback(reportInput.notes, "None.")
  };
}

function renderTopOpportunityText(item) {
  return [
    `Score: ${formatScore(item.score)}`,
    `Recommendation: ${item.recommendation}`,
    `Source: ${item.source}`,
    "",
    `Title: ${item.title}`,
    `Buyer / Organization: ${item.buyer_organization}`,
    `Country: ${item.country}`,
    `Reference Number: ${item.reference_number}`,
    `Procurement Type: ${item.procurement_type}`,
    `Published: ${item.published}`,
    `Deadline: ${item.deadline}`,
    `Days Remaining: ${item.days_remaining}`,
    `Budget / Contract Value: ${item.budget_contract_value}`,
    `URL: ${item.url}`,
    "",
    "WHY IT FITS AISTAFF:",
    item.why_it_fits_aistaff,
    "",
    "WHAT THEY NEED:",
    item.what_they_need,
    "",
    "ELIGIBILITY:",
    ...item.eligibility.map((entry) => `- ${entry}`),
    "",
    "BLOCKERS / RISKS:",
    ...item.blockers_risks.map((entry) => `- ${entry}`),
    "",
    "HOW WE COULD QUALIFY:",
    ...item.how_we_could_qualify.map((entry) => `- ${entry}`),
    "",
    "NEXT ACTION:",
    item.next_action
  ].join("\n");
}

function renderMarkdown(report, meta) {
  const executive = [
    "EXECUTIVE SUMMARY",
    "",
    `PhilGEPS opportunities scanned: ${report.executive_summary.philgeps_opportunities_scanned}`,
    `UNGM opportunities scanned: ${report.executive_summary.ungm_opportunities_scanned}`,
    `New relevant opportunities: ${report.executive_summary.new_relevant_opportunities}`,
    `Source access notes: ${report.executive_summary.source_access_notes}`,
    "",
    `BID: ${report.executive_summary.bid_count}`,
    `HIGH PRIORITY REVIEW: ${report.executive_summary.high_priority_review_count}`,
    `REVIEW: ${report.executive_summary.review_count}`,
    `SKIP: ${report.executive_summary.skip_count}`
  ];
  const top = report.top_opportunities.length
    ? report.top_opportunities.map(renderTopOpportunityText).join("\n\n")
    : "No suitable new opportunity found today.";
  const urgent = report.urgent_deadlines.length
    ? report.urgent_deadlines.map((item) => [
        `Source: ${item.source}`,
        `Title: ${item.title}`,
        `Buyer / Organization: ${item.buyer_organization}`,
        `Reference Number: ${item.reference_number}`,
        `Deadline: ${item.deadline}`,
        item.days_remaining ? `Days Remaining: ${item.days_remaining}` : null,
        `Why urgent: ${item.note}`,
        `URL: ${item.url}`,
        ""
      ].filter(Boolean).join("\n")).join("\n")
    : "None.";
  const skipped = report.skipped_opportunities.length
    ? report.skipped_opportunities.map((item) => `- [${item.source}] ${item.title} (${item.buyer_organization}; Ref ${item.reference_number}) - ${item.reason}\n  URL: ${item.url}`).join("\n")
    : "None.";
  const recommendation = [
    `Best opportunity to pursue: ${report.todays_recommendation.best_opportunity}`,
    `Documents AIStaff should prepare: ${report.todays_recommendation.documents_to_prepare.join("; ") || "None."}`,
    `Clarifications to request: ${report.todays_recommendation.clarifications_to_request.join("; ") || "None."}`
  ].join("\n");

  return [
    report.title,
    `Date: ${report.date_long}`,
    "",
    ...executive,
    "",
    "BEST OPPORTUNITIES",
    top,
    "",
    "URGENT DEADLINES",
    urgent,
    "",
    "NOT RECOMMENDED",
    skipped,
    "",
    "TODAY'S RECOMMENDATION",
    recommendation,
    "",
    "NOTES",
    ...report.notes.map((note) => `- ${note}`),
    "",
    "SCAN METADATA",
    `- Repo path confirmed: ${meta.preflight.repoPath}`,
    `- Email recipient used: ${meta.email.recipient || "none"}`,
    `- Email send status: ${meta.email.ok ? "sent" : `not sent (${meta.email.reason})`}`,
    `- Source URLs checked: ${report.source_urls_checked.join(" | ")}`
  ].join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtmlList(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderHtml(report, meta) {
  const sectionCard = (title, body) => `<section style="margin:0 0 24px"><h2 style="font-size:18px;margin:0 0 12px">${title}</h2>${body}</section>`;

  const executive = `
    <ul>
      <li>PhilGEPS opportunities scanned: ${report.executive_summary.philgeps_opportunities_scanned}</li>
      <li>UNGM opportunities scanned: ${report.executive_summary.ungm_opportunities_scanned}</li>
      <li>New relevant opportunities: ${report.executive_summary.new_relevant_opportunities}</li>
      <li>Source access notes: ${escapeHtml(report.executive_summary.source_access_notes)}</li>
      <li>BID: ${report.executive_summary.bid_count}</li>
      <li>HIGH PRIORITY REVIEW: ${report.executive_summary.high_priority_review_count}</li>
      <li>REVIEW: ${report.executive_summary.review_count}</li>
      <li>SKIP: ${report.executive_summary.skip_count}</li>
    </ul>
  `;

  const top = report.top_opportunities.length
    ? report.top_opportunities.map((item) => `
      <div style="padding:14px 16px;border:1px solid #d9e1ea;border-radius:10px;margin:0 0 14px">
        <p style="margin:0 0 8px"><strong>Score:</strong> ${formatScore(item.score)}</p>
        <p style="margin:0 0 8px"><strong>Recommendation:</strong> ${escapeHtml(item.recommendation)}</p>
        <p style="margin:0 0 8px"><strong>Source:</strong> ${escapeHtml(item.source)}</p>
        <p style="margin:0 0 8px"><strong>Title:</strong> ${escapeHtml(item.title)}</p>
        <p style="margin:0 0 8px"><strong>Buyer / Organization:</strong> ${escapeHtml(item.buyer_organization)}</p>
        <p style="margin:0 0 8px"><strong>Country:</strong> ${escapeHtml(item.country)}</p>
        <p style="margin:0 0 8px"><strong>Reference Number:</strong> ${escapeHtml(item.reference_number)}</p>
        <p style="margin:0 0 8px"><strong>Procurement Type:</strong> ${escapeHtml(item.procurement_type)}</p>
        <p style="margin:0 0 8px"><strong>Published:</strong> ${escapeHtml(item.published)}</p>
        <p style="margin:0 0 8px"><strong>Deadline:</strong> ${escapeHtml(item.deadline)}</p>
        <p style="margin:0 0 8px"><strong>Days Remaining:</strong> ${escapeHtml(item.days_remaining)}</p>
        <p style="margin:0 0 8px"><strong>Budget / Contract Value:</strong> ${escapeHtml(item.budget_contract_value)}</p>
        <p style="margin:0 0 8px"><strong>WHY IT FITS AISTAFF:</strong> ${escapeHtml(item.why_it_fits_aistaff)}</p>
        <p style="margin:0 0 8px"><strong>WHAT THEY NEED:</strong> ${escapeHtml(item.what_they_need)}</p>
        <p style="margin:0 0 8px"><strong>ELIGIBILITY:</strong></p>
        ${renderHtmlList(item.eligibility)}
        <p style="margin:12px 0 8px"><strong>BLOCKERS / RISKS:</strong></p>
        ${renderHtmlList(item.blockers_risks)}
        <p style="margin:12px 0 8px"><strong>HOW WE COULD QUALIFY:</strong></p>
        ${renderHtmlList(item.how_we_could_qualify)}
        <p style="margin:12px 0 8px"><strong>NEXT ACTION:</strong> ${escapeHtml(item.next_action)}</p>
        <p style="margin:0"><a href="${escapeHtml(item.url)}">Opportunity URL</a></p>
      </div>
    `).join("")
    : "<p>No suitable new opportunity found today.</p>";

  const urgent = report.urgent_deadlines.length
    ? `<ul>${report.urgent_deadlines.map((item) => `<li><strong>[${escapeHtml(item.source)}]</strong> ${escapeHtml(item.title)} (${escapeHtml(item.reference_number)}) - ${escapeHtml(item.deadline)}${item.days_remaining ? `; days remaining: ${escapeHtml(item.days_remaining)}` : ""}. ${escapeHtml(item.note)} <a href="${escapeHtml(item.url)}">Opportunity URL</a></li>`).join("")}</ul>`
    : "<p>None.</p>";

  const skipped = report.skipped_opportunities.length
    ? `<ul>${report.skipped_opportunities.map((item) => `<li><strong>[${escapeHtml(item.source)}]</strong> ${escapeHtml(item.title)} (${escapeHtml(item.buyer_organization)}; Ref ${escapeHtml(item.reference_number)}) - ${escapeHtml(item.reason)} <a href="${escapeHtml(item.url)}">Opportunity URL</a></li>`).join("")}</ul>`
    : "<p>None.</p>";

  const recommendation = `
    <p><strong>Best opportunity to pursue:</strong> ${escapeHtml(report.todays_recommendation.best_opportunity)}</p>
    <p><strong>Documents AIStaff should prepare:</strong> ${escapeHtml(report.todays_recommendation.documents_to_prepare.join("; ") || "None.")}</p>
    <p><strong>Clarifications to request:</strong> ${escapeHtml(report.todays_recommendation.clarifications_to_request.join("; ") || "None.")}</p>
  `;

  const notes = renderHtmlList(report.notes);
  const metadata = `
    <ul>
      <li>Repo path confirmed: ${escapeHtml(meta.preflight.repoPath)}</li>
      <li>Email recipient used: ${escapeHtml(meta.email.recipient || "none")}</li>
      <li>Email send status: ${meta.email.ok ? "sent" : escapeHtml(`not sent (${meta.email.reason})`)}</li>
      <li>Source URLs checked: ${escapeHtml(report.source_urls_checked.join(" | "))}</li>
    </ul>
  `;

  return `<div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;color:#18212b;line-height:1.5">
    <h1 style="font-size:24px;margin:0 0 8px">${escapeHtml(report.title)}</h1>
    <p style="margin:0 0 24px">Date: ${escapeHtml(report.date_long)}</p>
    ${sectionCard("EXECUTIVE SUMMARY", executive)}
    ${sectionCard("BEST OPPORTUNITIES", top)}
    ${sectionCard("URGENT DEADLINES", urgent)}
    ${sectionCard("NOT RECOMMENDED", skipped)}
    ${sectionCard("TODAY'S RECOMMENDATION", recommendation)}
    ${sectionCard("NOTES", notes)}
    ${sectionCard("SCAN METADATA", metadata)}
  </div>`;
}

async function sendEmail({ subject, text, html, preflightState, title }) {
  if (!preflightState.recipient) {
    return { ok: false, reason: "missing_recipient_env", recipient: null };
  }
  if (!preflightState.auth) {
    return { ok: false, reason: "missing_support_smtp_credentials", recipient: preflightState.recipient };
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT) {
    return { ok: false, reason: "missing_smtp_host_or_port", recipient: preflightState.recipient };
  }

  const port = Number(process.env.SMTP_PORT);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: preflightState.auth.user,
      pass: preflightState.auth.pass
    }
  });

  const info = await transport.sendMail({
    from: `AIStaff Procurement Scan <support@aistaff.click>`,
    to: preflightState.recipient,
    subject,
    text,
    html
  });

  return {
    ok: true,
    reason: "sent",
    recipient: preflightState.recipient,
    messageId: info.messageId,
    auth_env: {
      user: preflightState.auth.userEnv,
      pass: preflightState.auth.passEnv
    },
    title
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { iso } = philippineDateParts();
  const { absolute: inputPath, report: reportInput } = loadReportInput(args.input);
  const preflightState = preflight();
  const report = normalizeReport(reportInput, iso);
  const subject = `${report.title.toUpperCase()} - ${report.date_iso}`;

  const meta = {
    generated_at: new Date().toISOString(),
    input_path: inputPath,
    preflight: {
      repoPath: preflightState.repoPath,
      envFileLoaded: preflightState.envFileLoaded,
      smtpHostPresent: preflightState.smtpHostPresent,
      smtpPortPresent: preflightState.smtpPortPresent,
      selectedAuthEnv: preflightState.auth ? {
        user: preflightState.auth.userEnv,
        pass: preflightState.auth.passEnv
      } : null,
      recipientEnvUsed: preflightState.recipientEnvUsed,
      missingEnvNames: preflightState.missing
    },
    email: {
      ok: false,
      reason: "not_attempted",
      recipient: preflightState.recipient
    }
  };

  const text = renderMarkdown(report, meta);
  const html = renderHtml(report, meta);

  try {
    meta.email = await sendEmail({ subject, text, html, preflightState, title: report.title });
  } catch (error) {
    meta.email = {
      ok: false,
      reason: error.message,
      recipient: preflightState.recipient || null
    };
  }

  const finalText = renderMarkdown(report, meta);
  const finalHtml = renderHtml(report, meta);
  const payload = {
    ...report,
    scan_metadata: meta,
    email_subject: subject,
    plain_text_briefing: finalText,
    html_briefing: finalHtml
  };

  ensureDir(report.report_dir);
  fs.writeFileSync(path.join(report.report_dir, `${report.date_iso}.md`), finalText);
  fs.writeFileSync(path.join(report.report_dir, `${report.date_iso}.json`), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(report.report_dir, "latest.md"), finalText);
  fs.writeFileSync(path.join(report.report_dir, "latest.json"), JSON.stringify(payload, null, 2));

  console.log(JSON.stringify({
    title: report.title,
    opportunitiesReviewed: report.top_opportunities.length + report.skipped_opportunities.length,
    bestOpportunity: report.todays_recommendation.best_opportunity,
    email: meta.email,
    reportDir: report.report_dir
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
