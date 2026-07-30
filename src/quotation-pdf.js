const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const QUOTATIONS_DIR = path.join(__dirname, "..", "public", "quotations");

function ensureQuotationsDir() {
  fs.mkdirSync(QUOTATIONS_DIR, { recursive: true });
}

function sanitizeFilename(value) {
  return String(value || "quotation").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 80);
}

function formatMoney(amount) {
  return `PHP ${Number(amount || 0).toLocaleString("en-PH")}`;
}

function buildProspectBlock(session) {
  return [
    ["Full name", session.customerName || "—"],
    ["Email", session.email || "—"],
    ["Mobile", session.phone || "—"],
    ["Company", session.companyName || session.businessType || "—"],
    ["Address", session.address || "—"],
    ["Facebook Page", session.pageName || session.pageUrl || "—"],
    ["Website", session.websiteUrl || (session.websiteStatus === "none" ? "None" : "—")]
  ];
}

async function generateQuotationPdf({ session, quotationNumber, offer }) {
  ensureQuotationsDir();
  const filename = `${sanitizeFilename(quotationNumber || `Q-${Date.now()}`)}.pdf`;
  const filePath = path.join(QUOTATIONS_DIR, filename);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const brand = "AIStaff.click";
    const issuedAt = new Date().toLocaleDateString("en-PH", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });

    doc.fontSize(22).fillColor("#1e3a5f").text(brand, { align: "left" });
    doc.moveDown(0.2);
    doc.fontSize(11).fillColor("#555555").text("AI Inbox Sales Assistant — Official Quotation");
    doc.moveDown(1);

    doc.fontSize(10).fillColor("#111111");
    doc.text(`Quotation No.: ${quotationNumber || "DRAFT"}`);
    doc.text(`Date: ${issuedAt}`);
    doc.text(`Prepared for: ${session.customerName || "Prospect"}`);
    doc.moveDown(0.8);

    doc.fontSize(12).fillColor("#1e3a5f").text("Prospect Details", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#111111");
    for (const [label, value] of buildProspectBlock(session)) {
      doc.text(`${label}: ${value}`);
    }
    doc.moveDown(0.8);

    doc.fontSize(12).fillColor("#1e3a5f").text("Package Quoted", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor("#111111").text(offer.name);
    doc.fontSize(10).fillColor("#333333").text(offer.channel);
    doc.moveDown(0.6);

    doc.fontSize(12).fillColor("#1e3a5f").text("Investment", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#111111");
    doc.text(`One-time setup fee: ${formatMoney(offer.setup)}`);
    doc.text(`Monthly managed fee: ${formatMoney(offer.monthly)} / month`);
    doc.moveDown(0.8);

    doc.fontSize(12).fillColor("#1e3a5f").text("Scope of Work", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#111111");
    const scope = [
      "Chat-only AI replies on Facebook Messenger (no voice calls)",
      "Public Facebook Page and website review for products and services",
      "Real-time inquiry qualification and lead capture in admin dashboard",
      "Quotation drafts with admin approval before customer send",
      "Structured capture of customer or prospect details for follow-up"
    ];
    scope.forEach((line) => doc.text(`• ${line}`));
    doc.moveDown(0.8);

    if (session.inquiryTopics) {
      doc.fontSize(12).fillColor("#1e3a5f").text("Customer Context", { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor("#111111").text(session.inquiryTopics, { width: 500 });
      doc.moveDown(0.8);
    }

    doc.fontSize(12).fillColor("#1e3a5f").text("Terms", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(9).fillColor("#333333").text(
      "This quotation is based on the public information you shared in Messenger. "
      + "Setup covers configuration and onboarding. Monthly fee covers managed AI inbox assistance. "
      + "Final scope may be refined after admin review. Valid for 30 days from issue date.",
      { width: 500 }
    );
    doc.moveDown(1.2);

    doc.fontSize(9).fillColor("#666666").text(
      "Thank you for considering AIStaff.click. Reply in Messenger if you would like to proceed or need changes.",
      { width: 500 }
    );

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return { filePath, filename };
}

function getPublicQuotationUrl(filename) {
  const base = (process.env.APP_PUBLIC_URL || process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/quotations/${filename}`;
}

module.exports = {
  generateQuotationPdf,
  getPublicQuotationUrl,
  QUOTATIONS_DIR
};
