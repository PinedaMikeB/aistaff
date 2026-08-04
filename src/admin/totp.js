// Minimal, dependency-free TOTP (RFC 6238) implementation for Super Admin
// MFA. Uses only Node's built-in `crypto` — no new package dependency.
//
// This intentionally implements the standard algorithm exactly (HMAC-SHA1,
// 30s step, 6 digits, ±1 step window) rather than any custom scheme, per
// the instruction not to roll insecure custom cryptography — HMAC-SHA1 here
// is not "custom crypto", it's the RFC-standard TOTP construction that every
// authenticator app (Google Authenticator, Authy, 1Password, etc.) expects.

const crypto = require("crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

function randomBase32Secret(byteLength = 20) {
  const bytes = crypto.randomBytes(byteLength);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(base32) {
  const clean = base32.replace(/=+$/, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secretBuffer, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, "0");
}

function currentCounter(stepSeconds = STEP_SECONDS) {
  return Math.floor(Date.now() / 1000 / stepSeconds);
}

/**
 * Verifies a submitted 6-digit code against the shared secret, allowing a
 * ±1 step (30s) clock-drift window — the same tolerance virtually every
 * authenticator-app integration uses.
 */
function verifyTotp(base32Secret, token, { window = 1 } = {}) {
  if (!base32Secret || !token) return false;
  const cleanToken = String(token).replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleanToken)) return false;
  const secretBuffer = base32Decode(base32Secret);
  const counter = currentCounter();
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    if (hotp(secretBuffer, counter + errorWindow) === cleanToken) return true;
  }
  return false;
}

function generateSecret() {
  return randomBase32Secret(20);
}

function otpauthUrl({ secret, email, issuer = "AIStaff Super Admin" }) {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString("hex"));
}

module.exports = { generateSecret, otpauthUrl, verifyTotp, generateBackupCodes };
