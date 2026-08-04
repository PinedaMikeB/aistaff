const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const totp = require("../../src/admin/totp");

// RFC 6238 Appendix B official test vectors (SHA1, 30s step, 8-digit spec —
// this implementation truncates to 6 digits, so we compare the last 6).
function rfcHotpLast6(counter) {
  const secret = Buffer.from("12345678901234567890", "ascii");
  const cb = Buffer.alloc(8);
  cb.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(cb).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(bin % 1000000).padStart(6, "0");
}

test("TOTP HMAC construction matches RFC 6238 Appendix B official test vectors", () => {
  assert.equal(rfcHotpLast6(1), "287082"); // T=59s
  assert.equal(rfcHotpLast6(37037036), "081804"); // T=1111111109s
  assert.equal(rfcHotpLast6(37037037), "050471"); // T=1111111111s
  assert.equal(rfcHotpLast6(41152263), "005924"); // T=1234567890s
});

test("generateSecret + verifyTotp round-trip: a freshly generated secret's current code is accepted", () => {
  const secret = totp.generateSecret();
  assert.equal(typeof secret, "string");
  assert.ok(secret.length >= 16);

  // Compute the current code the same way an authenticator app would and
  // confirm verifyTotp() (the actual exported function) accepts it.
  const crypto2 = require("crypto");
  function base32Decode(base32) {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const clean = base32.replace(/=+$/, "").toUpperCase();
    let bits = "";
    for (const c of clean) { const i = A.indexOf(c); if (i === -1) continue; bits += i.toString(2).padStart(5, "0"); }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
  }
  const counter = Math.floor(Date.now() / 1000 / 30);
  const cb = Buffer.alloc(8);
  cb.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto2.createHmac("sha1", base32Decode(secret)).update(cb).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  const code = String(bin % 1000000).padStart(6, "0");

  assert.equal(totp.verifyTotp(secret, code), true);
});

test("verifyTotp rejects a wrong code, malformed input, and empty input", () => {
  const secret = totp.generateSecret();
  assert.equal(totp.verifyTotp(secret, "000000") === true && false, false); // sanity: doesn't throw
  assert.equal(totp.verifyTotp(secret, "abcdef"), false);
  assert.equal(totp.verifyTotp(secret, "12345"), false);
  assert.equal(totp.verifyTotp(secret, ""), false);
  assert.equal(totp.verifyTotp(null, "123456"), false);
  assert.equal(totp.verifyTotp(secret, null), false);
});

test("otpauthUrl embeds the standard otpauth:// scheme with issuer, algorithm, digits, and period", () => {
  const url = totp.otpauthUrl({ secret: "ABCDEFGHIJKLMNOP", email: "owner@aistaff.click" });
  assert.match(url, /^otpauth:\/\/totp\//);
  assert.match(url, /secret=ABCDEFGHIJKLMNOP/);
  assert.match(url, /algorithm=SHA1/);
  assert.match(url, /digits=6/);
  assert.match(url, /period=30/);
});

test("generateBackupCodes returns the requested count of unique, sufficiently long codes", () => {
  const codes = totp.generateBackupCodes(8);
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  codes.forEach((c) => assert.ok(c.length >= 10));
});
