const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
require("dotenv").config();

const TIME_ZONE = "Asia/Manila";
const REPORT_DIR = path.join(process.cwd(), "reports", "philgeps-opportunities");

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

function linesForOpportunity(item) {
  return [
    `Match rating: ${item.match_rating}`,
    `Score: ${item.score}/10`,
    `Project: ${item.project}`,
    `Procuring entity: ${item.procuring_entity}`,
    `Reference number: ${item.reference_number}`,
    `ABC: ${item.abc}`,
    `Deadline: ${item.deadline}`,
    `Procurement method: ${item.procurement_method}`,
    `Why it fits AIStaff: ${item.why_fit}`,
    `Important requirements: ${item.important_requirements.join("; ")}`,
    `Risks or blockers: ${item.risks_or_blockers.join("; ")}`,
    `Recommended next action: ${item.recommended_next_action}`,
    `Official PhilGEPS link: ${item.official_link}`
  ].join("\n");
}

function renderMarkdown(report, meta) {
  const best = report.best_opportunities.length
    ? report.best_opportunities.map((item) => linesForOpportunity(item)).join("\n\n")
    : "No suitable new opportunity found today.";
  const urgent = report.urgent_deadlines.length
    ? report.urgent_deadlines.map((item) => [
        `Project: ${item.project}`,
        `Procuring entity: ${item.procuring_entity}`,
        `Reference number: ${item.reference_number}`,
        `Deadline: ${item.deadline}`,
        `Why urgent: ${item.note}`,
        item.official_link ? `Official PhilGEPS link: ${item.official_link}` : null,
        ""
      ].filter(Boolean).join("\n")).join("\n")
    : "None.";
  const rejected = report.not_recommended.length
    ? report.not_recommended.map((item) => `- ${item.project} (${item.procuring_entity}; Ref ${item.reference_number}) - ${item.reason}\n  Official PhilGEPS link: ${item.official_link}`).join("\n")
    : "None.";
  const recommendation = [
    `Best opportunity to pursue: ${report.todays_recommendation.best_opportunity}`,
    `Documents AIStaff should prepare: ${report.todays_recommendation.documents_to_prepare.join("; ") || "None."}`,
    `Clarifications to request from the BAC: ${report.todays_recommendation.clarifications_to_request.join("; ") || "None."}`
  ].join("\n");
  const notes = Array.isArray(report.notes) && report.notes.length
    ? ["", "## NOTES", ...report.notes.map((note) => `- ${note}`)]
    : [];

  return [
    "PHILGEPS OPPORTUNITY BRIEFING",
    `Date: ${report.date_long}`,
    "",
    "BEST OPPORTUNITIES",
    best,
    "",
    "URGENT DEADLINES",
    urgent,
    "",
    "NOT RECOMMENDED",
    rejected,
    "",
    "TODAY'S RECOMMENDATION",
    recommendation,
    ...notes,
    "",
    "SCAN METADATA",
    `- Opportunities reviewed: ${report.opportunities_reviewed}`,
    report.opportunities_screened ? `- Opportunities screened from official listings: ${report.opportunities_screened}` : null,
    `- Repo path confirmed: ${meta.preflight.repoPath}`,
    `- Email recipient used: ${meta.email.recipient || "none"}`,
    `- Email send status: ${meta.email.ok ? "sent" : `not sent (${meta.email.reason})`}`,
    `- Source URLs checked: ${report.source_urls_checked.join(" | ")}`
  ].filter(Boolean).join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(report, meta) {
  const sectionCard = (title, body) => `<section style="margin:0 0 24px"><h2 style="font-size:18px;margin:0 0 12px">${title}</h2>${body}</section>`;
  const best = report.best_opportunities.length
    ? report.best_opportunities.map((item) => `
      <div style="padding:14px 16px;border:1px solid #d9e1ea;border-radius:10px;margin:0 0 14px">
        <p style="margin:0 0 8px"><strong>${escapeHtml(item.match_rating)}</strong> · Score ${item.score}/10</p>
        <p style="margin:0 0 8px"><strong>Project:</strong> ${escapeHtml(item.project)}</p>
        <p style="margin:0 0 8px"><strong>Procuring entity:</strong> ${escapeHtml(item.procuring_entity)}</p>
        <p style="margin:0 0 8px"><strong>Reference number:</strong> ${escapeHtml(item.reference_number)}</p>
        <p style="margin:0 0 8px"><strong>ABC:</strong> ${escapeHtml(item.abc)}</p>
        <p style="margin:0 0 8px"><strong>Deadline:</strong> ${escapeHtml(item.deadline)}</p>
        <p style="margin:0 0 8px"><strong>Procurement method:</strong> ${escapeHtml(item.procurement_method)}</p>
        <p style="margin:0 0 8px"><strong>Why it fits AIStaff:</strong> ${escapeHtml(item.why_fit)}</p>
        <p style="margin:0 0 8px"><strong>Important requirements:</strong> ${escapeHtml(item.important_requirements.join("; "))}</p>
        <p style="margin:0 0 8px"><strong>Risks or blockers:</strong> ${escapeHtml(item.risks_or_blockers.join("; "))}</p>
        <p style="margin:0 0 8px"><strong>Recommended next action:</strong> ${escapeHtml(item.recommended_next_action)}</p>
        <p style="margin:0"><a href="${escapeHtml(item.official_link)}">Official PhilGEPS link</a></p>
      </div>
    `).join("")
    : "<p>No suitable new opportunity found today.</p>";
  const urgent = report.urgent_deadlines.length
    ? `<ul>${report.urgent_deadlines.map((item) => `<li><strong>${escapeHtml(item.project)}</strong> (${escapeHtml(item.reference_number)}) - ${escapeHtml(item.deadline)}. ${escapeHtml(item.note)}${item.official_link ? ` <a href="${escapeHtml(item.official_link)}">Official link</a>` : ""}</li>`).join("")}</ul>`
    : "<p>None.</p>";
  const rejected = report.not_recommended.length
    ? `<ul>${report.not_recommended.map((item) => `<li><strong>${escapeHtml(item.project)}</strong> (${escapeHtml(item.procuring_entity)}; Ref ${escapeHtml(item.reference_number)}) - ${escapeHtml(item.reason)} <a href="${escapeHtml(item.official_link)}">Official link</a></li>`).join("")}</ul>`
    : "<p>None.</p>";
  const recommendation = `
    <p><strong>Best opportunity to pursue:</strong> ${escapeHtml(report.todays_recommendation.best_opportunity)}</p>
    <p><strong>Documents AIStaff should prepare:</strong> ${escapeHtml(report.todays_recommendation.documents_to_prepare.join("; ") || "None.")}</p>
    <p><strong>Clarifications to request from the BAC:</strong> ${escapeHtml(report.todays_recommendation.clarifications_to_request.join("; ") || "None.")}</p>
  `;
  const notes = Array.isArray(report.notes) && report.notes.length
    ? `<ul>${report.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
    : "<p>None.</p>";
  const metadata = `
    <ul>
      <li>Opportunities reviewed: ${report.opportunities_reviewed}</li>
      ${report.opportunities_screened ? `<li>Opportunities screened from official listings: ${report.opportunities_screened}</li>` : ""}
      <li>Repo path confirmed: ${escapeHtml(meta.preflight.repoPath)}</li>
      <li>Email recipient used: ${escapeHtml(meta.email.recipient || "none")}</li>
      <li>Email send status: ${meta.email.ok ? "sent" : escapeHtml(`not sent (${meta.email.reason})`)}</li>
    </ul>
  `;

  return `<div style="font-family:Arial,sans-serif;max-width:860px;margin:0 auto;color:#18212b;line-height:1.5">
    <h1 style="font-size:24px;margin:0 0 8px">PHILGEPS OPPORTUNITY BRIEFING</h1>
    <p style="margin:0 0 24px">Date: ${escapeHtml(report.date_long)}</p>
    ${sectionCard("BEST OPPORTUNITIES", best)}
    ${sectionCard("URGENT DEADLINES", urgent)}
    ${sectionCard("NOT RECOMMENDED", rejected)}
    ${sectionCard("TODAY'S RECOMMENDATION", recommendation)}
    ${sectionCard("NOTES", notes)}
    ${sectionCard("SCAN METADATA", metadata)}
  </div>`;
}

async function sendEmail({ subject, text, html, preflightState }) {
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
    from: "AIStaff PhilGEPS Scan <support@aistaff.click>",
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
    }
  };
}

function normalizeReport(reportInput, dateIso) {
  return {
    title: "PHILGEPS OPPORTUNITY BRIEFING",
    date_iso: reportInput.date_iso || dateIso,
    date_long: reportInput.date_long || longPhilippineDate(reportInput.date_iso || dateIso),
    opportunities_reviewed: reportInput.opportunities_reviewed || 0,
    opportunities_screened: reportInput.opportunities_screened || null,
    best_opportunities: reportInput.best_opportunities || [],
    urgent_deadlines: reportInput.urgent_deadlines || [],
    not_recommended: reportInput.not_recommended || [],
    todays_recommendation: reportInput.todays_recommendation || {
      best_opportunity: "No suitable new opportunity found today",
      documents_to_prepare: [],
      clarifications_to_request: []
    },
    source_urls_checked: reportInput.source_urls_checked || [],
    notes: reportInput.notes || []
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { iso } = philippineDateParts();
  const { absolute: inputPath, report: reportInput } = loadReportInput(args.input);
  const preflightState = preflight();
  const report = normalizeReport(reportInput, iso);
  const subject = `PHILGEPS OPPORTUNITY BRIEFING - ${report.date_iso}`;

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
    meta.email = await sendEmail({ subject, text, html, preflightState });
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

  ensureDir(REPORT_DIR);
  fs.writeFileSync(path.join(REPORT_DIR, `${report.date_iso}.md`), finalText);
  fs.writeFileSync(path.join(REPORT_DIR, `${report.date_iso}.json`), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(REPORT_DIR, "latest.md"), finalText);
  fs.writeFileSync(path.join(REPORT_DIR, "latest.json"), JSON.stringify(payload, null, 2));

  console.log(JSON.stringify({
    opportunitiesReviewed: report.opportunities_reviewed,
    bestOpportunity: report.todays_recommendation.best_opportunity,
    email: meta.email,
    reportDir: REPORT_DIR
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
