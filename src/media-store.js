/**
 * Media storage for things Closer can actually send.
 *
 * WHY: the wizard read uploaded posters with OCR and kept only the DESCRIPTION.
 * The `media` column was NULL on every row, so when a customer asked to see a
 * poster, Closer knew one existed and had nothing to attach — it invented
 * "[IMAGE: ...]" and the customer saw that literally.
 *
 * HOW MESSENGER WORKS: attachments are sent by URL. Facebook's servers fetch
 * the file themselves, so it must be reachable on the public internet with no
 * authentication. That is why these live under public/ and not behind
 * requireAuth — an authenticated URL simply fails, silently, from Meta's side.
 *
 * PRIVACY: filenames are random UUIDs, so a URL cannot be guessed from a
 * business name, product or document title. These are marketing files,
 * product photos and shareable templates meant to be shown or referenced;
 * nothing private should be uploaded here, and the wizard copy says so.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MEDIA_DIR = path.join(__dirname, "..", "public", "media");

/** Messenger's own limits. Rejecting early beats a silent failure at send. */
const LIMITS = {
  image: 25 * 1024 * 1024,
  video: 25 * 1024 * 1024,
  file: 25 * 1024 * 1024
};

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/csv": ".csv"
};

/** Keep an uploaded file and return what the knowledge base should store. */
function saveMedia({ buffer, mimeType, filename, companyId }) {
  const kind = mimeType.startsWith("video/") ? "video"
    : mimeType.startsWith("image/") ? "image"
    : "file";

  if (buffer.length > LIMITS[kind]) {
    return { ok: false, error: `That file is ${(buffer.length / 1048576).toFixed(1)}MB. Messenger cannot send attachments over 25MB.` };
  }
  if (!EXT_BY_MIME[mimeType]) {
    return { ok: false, error: "Messenger can send JPG, PNG, GIF, WebP, MP4, MOV, PDF, Word, Excel and CSV files." };
  }

  // Company-scoped folder keeps one tenant's files out of another's listing,
  // and a random name means a URL cannot be guessed from a business or product
  // name. These are public by necessity — see the note at the top.
  const dir = path.join(MEDIA_DIR, companyId);
  fs.mkdirSync(dir, { recursive: true });

  const id = crypto.randomUUID();
  const stored = `${id}${EXT_BY_MIME[mimeType]}`;
  fs.writeFileSync(path.join(dir, stored), buffer);

  return {
    ok: true,
    entry: {
      type: kind,
      url: `${publicBase()}/media/${companyId}/${stored}`,
      filename: filename.slice(0, 200),
      mimeType,
      bytes: buffer.length,
      uploadedAt: new Date().toISOString()
    }
  };
}

/**
 * Absolute URL, because Messenger needs one — Facebook fetches the file from
 * the public internet, so a relative path is useless here.
 */
function publicBase() {
  return (process.env.PUBLIC_BASE_URL || "https://aistaff.click").replace(/\/+$/, "");
}

function deleteMedia(url) {
  try {
    const rel = String(url || "").split("/media/")[1];
    if (!rel || rel.includes("..")) return false;
    const target = path.join(MEDIA_DIR, rel);
    if (fs.existsSync(target)) { fs.unlinkSync(target); return true; }
  } catch (error) {
    console.warn("[media] delete failed for %s: %s", url, error.message);
  }
  return false;
}

module.exports = { saveMedia, deleteMedia, MEDIA_DIR, LIMITS, EXT_BY_MIME };
