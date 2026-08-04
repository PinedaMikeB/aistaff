// Upload validation tests (PART 7 / PART 20).
// Builds real, minimal PNG byte buffers in-memory (no fixture files, no
// external images) to exercise the magic-byte sniffing, size limit, and
// dimension checks against genuine image bytes rather than fake strings.

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const { validateImageDataUrl, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION, MIN_IMAGE_DIMENSION } = require("../../src/brandee/mediaValidation");

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0;
    for (let x = 0; x < width; x++) {
      raw[y * rowSize + 1 + x * 3] = 80;
      raw[y * rowSize + 1 + x * 3 + 1] = 120;
      raw[y * rowSize + 1 + x * 3 + 2] = 200;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function pngDataUrl(width, height) {
  return `data:image/png;base64,${makePng(width, height).toString("base64")}`;
}

test("accepts a well-formed, correctly sized real PNG", () => {
  const result = validateImageDataUrl(pngDataUrl(64, 64));
  assert.equal(result.ok, true);
  assert.equal(result.type, "image/png");
  assert.equal(result.width, 64);
  assert.equal(result.height, 64);
});

test("rejects a string that is not a data URL at all", () => {
  const result = validateImageDataUrl("https://example.com/image.png");
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_a_valid_image_data_url");
});

test("rejects a data URL whose declared MIME type is not an image type", () => {
  const result = validateImageDataUrl("data:text/plain;base64,aGVsbG8=");
  assert.equal(result.ok, false);
});

test("returned `type` always reflects the real sniffed magic-byte type, never the client's claimed MIME type", () => {
  // The claimed type in the data URL is only used to confirm it's within
  // the allowed set (png/jpeg/webp) — real PNG bytes labeled as JPEG still
  // validate, but callers must always trust the RETURNED `type` (from the
  // actual bytes), never re-read the client's original claimed label, since
  // this function does not require the two to match.
  const realPngBytes = makePng(64, 64).toString("base64");
  const spoofed = `data:image/jpeg;base64,${realPngBytes}`;
  const result = validateImageDataUrl(spoofed);
  assert.equal(result.ok, true);
  assert.equal(result.type, "image/png", "the returned type must be the REAL sniffed type, not the claimed 'image/jpeg' label");
});

test("rejects a claimed type outside the allowed set even if the underlying bytes happen to sniff as a supported type", () => {
  const realPngBytes = makePng(64, 64).toString("base64");
  const result = validateImageDataUrl(`data:image/svg+xml;base64,${realPngBytes}`);
  assert.equal(result.ok, false);
  assert.equal(result.error, "unsupported_declared_type");
});

test("rejects an image smaller than MIN_IMAGE_DIMENSION on either axis", () => {
  const result = validateImageDataUrl(pngDataUrl(8, 8));
  assert.equal(result.ok, false);
  assert.equal(result.error, "image_too_small");
  assert.ok(MIN_IMAGE_DIMENSION > 8);
});

test("rejects a file larger than the configured maxBytes limit", () => {
  const dataUrl = pngDataUrl(64, 64);
  const result = validateImageDataUrl(dataUrl, { maxBytes: 10 }); // absurdly small ceiling
  assert.equal(result.ok, false);
  assert.equal(result.error, "file_too_large");
});

test("MAX_IMAGE_BYTES and MAX_IMAGE_DIMENSION are finite, sane, positive limits (not unlimited)", () => {
  assert.equal(typeof MAX_IMAGE_BYTES, "number");
  assert.ok(MAX_IMAGE_BYTES > 0 && MAX_IMAGE_BYTES <= 20 * 1024 * 1024);
  assert.equal(typeof MAX_IMAGE_DIMENSION, "number");
  assert.ok(MAX_IMAGE_DIMENSION > 0);
});

test("rejects empty/garbage base64 payloads without throwing", () => {
  assert.doesNotThrow(() => {
    const result = validateImageDataUrl("data:image/png;base64,");
    assert.equal(result.ok, false);
  });
});
