const fs = require("fs");
const nodemailer = require("nodemailer");

function isEmailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendQuotationEmail({ to, subject, text, pdfPath, quotationNumber }) {
  if (!to) {
    return { ok: false, error: "missing_recipient", message: "No email address on file." };
  }
  if (!isEmailConfigured()) {
    return {
      ok: false,
      error: "email_not_configured",
      message: "Email delivery is not configured on this server. Share the quotation PDF in Messenger instead."
    };
  }

  try {
    const transport = createTransport();
    const attachments = pdfPath && fs.existsSync(pdfPath)
      ? [{ filename: `${quotationNumber || "quotation"}.pdf`, path: pdfPath, contentType: "application/pdf" }]
      : [];

    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: subject || `AIStaff.click Quotation ${quotationNumber || ""}`.trim(),
      text,
      attachments
    });

    return { ok: true, messageId: info.messageId, emailed: true };
  } catch (error) {
    console.error("Quotation email failed:", error.message);
    return {
      ok: false,
      error: "email_send_failed",
      message: error.message || "Email could not be delivered."
    };
  }
}

module.exports = {
  isEmailConfigured,
  sendQuotationEmail
};
