const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
require("dotenv").config();

const TIME_ZONE = "Asia/Manila";
const REPORT_DIR = path.join(process.cwd(), "reports", "philgeps-opportunities");
const LATEST_JSON = path.join(REPORT_DIR, "latest.json");

function currentPhilippineDateIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function pickRecipient() {
  if (process.env.PHILGEPS_OPPORTUNITY_EMAIL_TO) {
    return { env: "PHILGEPS_OPPORTUNITY_EMAIL_TO", value: process.env.PHILGEPS_OPPORTUNITY_EMAIL_TO };
  }
  if (process.env.ADMIN_ALERT_EMAIL) {
    return { env: "ADMIN_ALERT_EMAIL", value: process.env.ADMIN_ALERT_EMAIL };
  }
  if (process.env.SEED_ADMIN_EMAIL) {
    return { env: "SEED_ADMIN_EMAIL", value: process.env.SEED_ADMIN_EMAIL };
  }
  return { env: null, value: null };
}

function pickAuth() {
  const notifyUser = String(process.env.NOTIFY_SMTP_USER || "").trim().toLowerCase();
  const smtpUser = String(process.env.SMTP_USER || "").trim().toLowerCase();

  if (notifyUser === "support@aistaff.click" && process.env.NOTIFY_SMTP_PASS) {
    return { userEnv: "NOTIFY_SMTP_USER", passEnv: "NOTIFY_SMTP_PASS", user: process.env.NOTIFY_SMTP_USER, pass: process.env.NOTIFY_SMTP_PASS };
  }

  if (smtpUser === "support@aistaff.click" && process.env.SMTP_PASS) {
    return { userEnv: "SMTP_USER", passEnv: "SMTP_PASS", user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  }

  return null;
}

function maskEmail(value) {
  if (!value) return null;
  return value.replace(/^(.).*(@.*)$/, "$1***$2");
}

function readLatestReport() {
  if (!fs.existsSync(LATEST_JSON)) {
    return {
      exists: false,
      path: LATEST_JSON,
      dateIso: null,
      generatedAt: null,
      emailStatus: null
    };
  }

  const raw = JSON.parse(fs.readFileSync(LATEST_JSON, "utf8"));
  return {
    exists: true,
    path: LATEST_JSON,
    dateIso: raw.date_iso || null,
    generatedAt: raw.scan_metadata?.generated_at || null,
    emailStatus: raw.scan_metadata?.email || null
  };
}

async function verifySmtp(auth) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !auth) {
    return { ok: false, reason: "missing_preflight" };
  }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: auth.user,
      pass: auth.pass
    }
  });

  await transport.verify();
  return { ok: true };
}

async function main() {
  const verify = process.argv.includes("--verify-smtp");
  const todayIso = currentPhilippineDateIso();
  const latest = readLatestReport();
  const recipient = pickRecipient();
  const auth = pickAuth();

  const result = {
    repoPath: process.cwd(),
    envFileLoaded: fs.existsSync(path.join(process.cwd(), ".env")),
    todayIso,
    reportDir: REPORT_DIR,
    latestReport: {
      exists: latest.exists,
      dateIso: latest.dateIso,
      generatedAt: latest.generatedAt,
      isFreshForToday: latest.dateIso === todayIso,
      emailStatus: latest.emailStatus
        ? {
            ok: Boolean(latest.emailStatus.ok),
            reason: latest.emailStatus.reason || null,
            recipientMasked: maskEmail(latest.emailStatus.recipient || null),
            messageId: latest.emailStatus.messageId || null
          }
        : null
    },
    preflight: {
      smtpHostPresent: Boolean(process.env.SMTP_HOST),
      smtpPortPresent: Boolean(process.env.SMTP_PORT),
      authSource: auth ? `${auth.userEnv}/${auth.passEnv}` : null,
      recipientEnv: recipient.env,
      recipientMasked: maskEmail(recipient.value)
    },
    status: latest.dateIso === todayIso ? "fresh" : "stale_or_missing"
  };

  if (verify) {
    try {
      result.smtpVerify = await verifySmtp(auth);
    } catch (error) {
      result.smtpVerify = { ok: false, reason: error.message };
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
