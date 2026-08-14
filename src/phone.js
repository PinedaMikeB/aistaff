/**
 * Phone normalisation to E.164.
 *
 * WHY THIS EXISTS: the mobile number is the person; the channel address (PSID,
 * SIP caller ID) is only how you reach them on one channel. Conversation now
 * carries `contact_number` so a Messenger thread and a Pitch call can be
 * recognised as the same human — but that only works if both sides store the
 * number in ONE canonical form. "0917 576 9817", "+639175769817" and
 * "639175769817" are the same person and must produce the same key.
 *
 * NOT a replacement for normalizeCallerId() in src/pitch/prompt.js. That
 * answers a different question ("did a number arrive with this call at all?")
 * and is deliberately permissive about format. Pitch is live; leave it alone.
 *
 * Deliberately permissive: this rejects obvious junk, not unusual-but-real
 * numbers. A false reject at checkout costs a sale.
 */

const PH_COUNTRY_CODE = "63";

/** Digits only, preserving a leading + so we can tell E.164 input apart. */
function stripFormatting(input) {
  const raw = String(input == null ? "" : input).trim();
  if (!raw) return { plus: false, digits: "" };
  return { plus: raw.startsWith("+"), digits: raw.replace(/\D/g, "") };
}

/**
 * Returns an E.164 string (e.g. "+639175769817") or null if the input cannot
 * be read as a phone number. Never throws.
 */
function normalizePhone(input, defaultCountry) {
  const country = defaultCountry || "PH";
  const parsed = stripFormatting(input);
  const digits = parsed.digits;
  if (!digits) return null;

  // Repdigits: 0000000000, 1111111111 — never a real number.
  if (/^(\d)\1+$/.test(digits)) return null;

  // Already international, or written with a country code but no plus.
  if (parsed.plus) {
    return digits.length >= 8 && digits.length <= 15 ? "+" + digits : null;
  }

  if (country === "PH") {
    // 63 + 10 digits -> country code supplied without the plus.
    if (digits.length === 12 && digits.indexOf(PH_COUNTRY_CODE) === 0) {
      return "+" + digits;
    }
    // Trunk prefix 0 -> drop it, prepend 63. Mobile (09xx) and landline (02x).
    if (digits.length >= 10 && digits.length <= 11 && digits.charAt(0) === "0") {
      return "+" + PH_COUNTRY_CODE + digits.slice(1);
    }
    // Bare 10-digit mobile, trunk 0 omitted (9xx xxx xxxx).
    if (digits.length === 10 && digits.charAt(0) === "9") {
      return "+" + PH_COUNTRY_CODE + digits;
    }
  }

  // Anything else: accept if plausibly a full international number.
  if (digits.length >= 10 && digits.length <= 15) return "+" + digits;
  return null;
}

/** True when the input can be read as a phone number. */
function isValidPhone(input, defaultCountry) {
  return normalizePhone(input, defaultCountry) !== null;
}

module.exports = { normalizePhone, isValidPhone };
