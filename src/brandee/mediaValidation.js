// Upload validation for product images/logos submitted as base64 data URLs
// (PART 7 / PART 20). Pure-JS, dependency-free — validates the real file
// bytes (magic-byte signature + declared dimensions read straight from the
// image header), not just the claimed MIME type, and enforces hard size and
// dimension limits before anything is ever passed to the image renderer.

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB per image
const MAX_IMAGE_DIMENSION = 6000; // px, either axis
const MIN_IMAGE_DIMENSION = 32; // px, either axis

const SIGNATURES = [
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/webp", bytes: null } // checked separately (RIFF....WEBP)
];

function sniffType(buffer) {
  for (const sig of SIGNATURES) {
    if (!sig.bytes) continue;
    if (sig.bytes.every((byte, i) => buffer[i] === byte)) return sig.type;
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function readPngDimensions(buffer) {
  // PNG: IHDR chunk starts at byte 16, width/height are 4-byte big-endian ints.
  if (buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegDimensions(buffer) {
  // Scan JPEG markers for the first SOFn segment, which encodes height/width.
  let offset = 2;
  while (offset < buffer.length - 8) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebpDimensions(buffer) {
  // Only the common VP8/VP8L/VP8X chunk layouts are supported here — good
  // enough for a dimension sanity check, not a full WebP parser.
  try {
    const chunkType = buffer.toString("ascii", 12, 16);
    if (chunkType === "VP8X") {
      const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
      const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
      return { width, height };
    }
    if (chunkType === "VP8 ") {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
  } catch {
    return null;
  }
  return null;
}

function readDimensions(type, buffer) {
  if (type === "image/png") return readPngDimensions(buffer);
  if (type === "image/jpeg") return readJpegDimensions(buffer);
  if (type === "image/webp") return readWebpDimensions(buffer);
  return null;
}

/**
 * Validates a `data:image/...;base64,...` string end to end: well-formed
 * data URL, real magic-byte type match (not just the claimed MIME type),
 * size limit, and dimension limits. Returns { ok, error, type, bytes,
 * width, height } — never throws.
 */
function validateImageDataUrl(dataUrl, { maxBytes = MAX_IMAGE_BYTES } = {}) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-z0-9.+-]+);base64,([a-zA-Z0-9+/=]+)$/i);
  if (!match) return { ok: false, error: "not_a_valid_image_data_url" };

  const claimedType = match[1].toLowerCase();
  let buffer;
  try {
    buffer = Buffer.from(match[2], "base64");
  } catch {
    return { ok: false, error: "invalid_base64" };
  }

  if (!buffer.length) return { ok: false, error: "empty_file" };
  if (buffer.length > maxBytes) return { ok: false, error: "file_too_large", maxBytes };

  const sniffedType = sniffType(buffer);
  if (!sniffedType) return { ok: false, error: "unsupported_or_unrecognized_image_type" };
  if (!/^image\/(png|jpe?g|webp)$/i.test(claimedType)) return { ok: false, error: "unsupported_declared_type" };

  const dimensions = readDimensions(sniffedType, buffer);
  if (dimensions) {
    if (dimensions.width < MIN_IMAGE_DIMENSION || dimensions.height < MIN_IMAGE_DIMENSION) {
      return { ok: false, error: "image_too_small", ...dimensions };
    }
    if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
      return { ok: false, error: "image_too_large_dimensions", ...dimensions };
    }
  }

  return { ok: true, type: sniffedType, bytes: buffer.length, width: dimensions?.width || null, height: dimensions?.height || null };
}

module.exports = { validateImageDataUrl, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION, MIN_IMAGE_DIMENSION };
