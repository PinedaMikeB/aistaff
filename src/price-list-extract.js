/**
 * Price-list extraction for the demo.
 *
 * WHY THIS EXISTS: a Facebook Page can be full of pricing and still scrape to
 * almost nothing. Perfectlook Aesthetic Center publishes every price — ₱2,999
 * hair colour, ₱799 hair mask — inside promo IMAGES. Open Graph tags gave us
 * two facts: the page name and a one-line description. The agent then had no
 * prices, and the demo is far less convincing without them.
 *
 * So the prospect can hand us the price list directly:
 *   image/*          -> Gemini vision reads the text off the graphic
 *   application/pdf  -> Gemini reads it natively
 *   .xlsx/.xls/.csv  -> SheetJS, sheet by sheet
 *   .docx            -> mammoth
 *
 * Everything returns PLAIN TEXT. The model reads it as facts and writes its own
 * words — no template, no canned pricing line (docs/handoff-masterplan.md).
 */

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 12000;

const KINDS = {
  IMAGE: "image",
  PDF: "pdf",
  SHEET: "sheet",
  DOC: "doc"
};

function kindFor(mimeType, filename) {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(filename || "").toLowerCase();
  if (mime.startsWith("image/")) return KINDS.IMAGE;
  if (mime === "application/pdf" || name.endsWith(".pdf")) return KINDS.PDF;
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv") ||
      mime.indexOf("spreadsheet") !== -1 || mime === "text/csv") return KINDS.SHEET;
  if (name.endsWith(".docx") || mime.indexOf("wordprocessing") !== -1) return KINDS.DOC;
  return null;
}

function clamp(text) {
  const clean = String(text || "").replace(/\n{3,}/g, "\n\n").trim();
  return clean.length > MAX_TEXT ? clean.slice(0, MAX_TEXT) + "\n[truncated]" : clean;
}

/** Spreadsheets: every sheet, as tab-separated rows. */
function extractSheet(buffer) {
  const XLSX = require("xlsx");
  const book = XLSX.read(buffer, { type: "buffer" });
  const chunks = [];
  for (const sheetName of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_csv(book.Sheets[sheetName], { FS: "\t" });
    if (rows && rows.trim()) chunks.push(`--- ${sheetName} ---\n${rows.trim()}`);
  }
  return clamp(chunks.join("\n\n"));
}

async function extractDoc(buffer) {
  const mammoth = require("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return clamp(result && result.value);
}

/**
 * Images and PDFs go to Gemini as inline data. Asked for a transcription, not
 * a summary — a summary would drop the exact peso amounts, which are the whole
 * point.
 */
async function extractWithVision(buffer, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("vision_not_configured");

  const model = process.env.DEMO_VISION_MODEL || process.env.DEMO_GEMINI_MODEL || "gemini-3.5-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const fetchImpl = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

  const instruction =
    "Transcribe every service, product and price you can read in this file. " +
    "Keep the exact amounts and currency as written. Include package names, " +
    "inclusions, promo dates and any branch or contact details. " +
    "Output plain text, one item per line. Do not summarise, do not add " +
    "anything that is not visible, and do not comment on the image.";

  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } },
          { text: instruction }
        ]
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 2000 }
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`vision_failed_${response.status}: ${detail.slice(0, 200)}`);
  }

  const json = await response.json();
  const parts = (json.candidates && json.candidates[0] && json.candidates[0].content.parts) || [];
  return clamp(parts.map((p) => p.text).filter(Boolean).join("\n"));
}

/**
 * @returns {Promise<{ok:boolean, kind?:string, text?:string, reason?:string}>}
 * Never throws — a failed upload must not take down the demo the prospect is
 * in the middle of.
 */
async function extractPriceList({ buffer, mimeType, filename }) {
  try {
    if (!buffer || !buffer.length) return { ok: false, reason: "empty_file" };
    if (buffer.length > MAX_BYTES) {
      return { ok: false, reason: "file_too_large", max_bytes: MAX_BYTES };
    }

    const kind = kindFor(mimeType, filename);
    if (!kind) return { ok: false, reason: "unsupported_type" };

    let text = "";
    if (kind === KINDS.SHEET) text = extractSheet(buffer);
    else if (kind === KINDS.DOC) text = await extractDoc(buffer);
    else text = await extractWithVision(buffer, kind === KINDS.PDF ? "application/pdf" : mimeType);

    if (!text) return { ok: false, kind, reason: "nothing_readable" };
    return { ok: true, kind, text };
  } catch (error) {
    return { ok: false, reason: "extraction_failed", detail: String(error.message).slice(0, 300) };
  }
}

module.exports = { extractPriceList, kindFor, KINDS, MAX_BYTES, MAX_TEXT };
