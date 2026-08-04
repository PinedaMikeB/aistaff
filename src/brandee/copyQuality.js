// Copy-quality validation + normalization (PARTS 21-22).
//
// Root causes fixed here, verified against the previous implementation:
// 1. `buildScript()` in planner.js appended a literal AUTHORING INSTRUCTION
//    into the customer-facing scene caption: `" (write final dialogue in
//    natural Taglish, not stiff translated English)"`. That is exactly the
//    "placeholder instructions leak into final scripts" failure named in
//    the brief — verified by reading the code, not assumed.
// 2. Raw user form input (e.g. an `idealCustomer` value typed as
//    "business owner, companies") was substituted directly into hook
//    templates via `values.audience` with no normalization — producing
//    grammatically broken output ("...for business owner, companies").
//    `normalizeRawPhrase()` below is applied to every user-supplied string
//    before it is used as a template variable (see planner.js's rewritten
//    `buildHookValues`).

// ---------------------------------------------------------------------------
// PART 22 — normalize raw user input before it is ever substituted into a
// template or shown as copy. Deliberately conservative: fixes structural
// issues (stray commas, casing, whitespace) without inventing content.
// ---------------------------------------------------------------------------

function normalizeRawPhrase(raw) {
  let text = String(raw || "").trim();
  if (!text) return text;

  // Collapse a raw comma-separated fragment ("business owner, companies")
  // into a natural joined phrase ("business owners and companies") rather
  // than passing the stray comma straight into a sentence.
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    text = `${parts.slice(0, -1).join(", ")} and ${last}`;
  }

  // Collapse whitespace, strip trailing punctuation duplication.
  text = text.replace(/\s+/g, " ").replace(/[.,;]+$/g, "").trim();

  // Simple plural normalization for common singular nouns used as an
  // audience descriptor ("business owner" -> "business owners") so it reads
  // naturally inside a plural-audience sentence. Conservative allowlist only
  // — never guesses at words it doesn't recognize.
  text = text.replace(/\bbusiness owner\b(?!s)/i, "business owners")
    .replace(/\bcompany\b(?!\s+(and|,))/i, "company");

  return text;
}

// ---------------------------------------------------------------------------
// PART 21 — grammar / naturalness / placeholder-leak detection.
// ---------------------------------------------------------------------------

const PLACEHOLDER_LEAK_PATTERNS = [
  /\bwrite final dialogue\b/i,
  /\binsert proof here\b/i,
  /\badd (a |the )?cta\b/i,
  /\brewrite in natural (taglish|filipino|english)\b/i,
  /\bplaceholder\b/i,
  /\btodo\b/i,
  /\[write[^\]]*\]/i,
  /\(write final dialogue/i,
  /\bfill (this|in)\b.*\blater\b/i
];

const DUPLICATE_WORD_PATTERN = /\b(\w+)\s+\1\b/i;
const DOUBLE_PUNCTUATION_PATTERN = /([.,!?])\1+/;
const RAW_COMMA_FRAGMENT_PATTERN = /\b[a-z]+ owner,\s*[a-z]+\b/i; // e.g. "business owner, companies" reaching final copy unnormalized
const UNRESOLVED_BRACKET_PATTERN = /\[[a-z_]+\]/i;
const SENTENCE_FRAGMENT_PATTERN = /^[a-z]/; // sentence-starting field beginning with a lowercase letter — likely a fragment concatenation

function detectGrammarIssues(text) {
  const issues = [];
  const value = String(text || "");
  if (!value.trim()) return issues;

  if (DUPLICATE_WORD_PATTERN.test(value)) issues.push("duplicated word");
  if (DOUBLE_PUNCTUATION_PATTERN.test(value)) issues.push("repeated punctuation");
  if (UNRESOLVED_BRACKET_PATTERN.test(value)) issues.push("unresolved [placeholder]");
  if (RAW_COMMA_FRAGMENT_PATTERN.test(value)) issues.push("raw unnormalized audience phrase");
  if (PLACEHOLDER_LEAK_PATTERNS.some((re) => re.test(value))) issues.push("authoring-instruction text leaked into copy");
  if (value.length > 3 && SENTENCE_FRAGMENT_PATTERN.test(value.trim())) issues.push("sentence does not start with a capital letter");

  return issues;
}

function hasPlaceholderLeak(text) {
  return PLACEHOLDER_LEAK_PATTERNS.some((re) => re.test(String(text || "")));
}

/**
 * Runs the full copy-quality pass over a single string. Returns
 * { ok, issues, text } — never auto-rewrites content (that would risk
 * inventing wording); a failing field should be regenerated or fall back to
 * a safer default by the caller, not silently "fixed" here.
 */
function checkCopyQuality(text) {
  const issues = detectGrammarIssues(text);
  return { ok: issues.length === 0, issues, text };
}

/**
 * Validates every text field of a nearly-final plan in one pass (PART 21
 * "Add a final copy-editing pass"). Returns a flat list of
 * { field, issues } for anything that failed, so the caller can decide
 * whether to reject/regenerate/fall back.
 */
function validatePlanCopyQuality(plan) {
  const failures = [];
  const check = (field, text) => {
    const result = checkCopyQuality(text);
    if (!result.ok) failures.push({ field, issues: result.issues, text });
  };

  check("strategy.primaryHook", plan?.strategy?.primaryHook);
  (plan?.strategy?.alternativeHooks || []).forEach((h, i) => check(`strategy.alternativeHooks[${i}]`, h));
  (plan?.script?.scenes || []).forEach((scene) => {
    check(`script.scenes[${scene.sceneNumber}].dialogue`, scene.dialogue);
    check(`script.scenes[${scene.sceneNumber}].caption`, scene.caption);
  });
  check("staticAdConcept.headline", plan?.staticAdConcept?.headline);
  (plan?.staticAdConcept?.supportingCopy || []).forEach((c, i) => check(`staticAdConcept.supportingCopy[${i}]`, c));

  return failures;
}

module.exports = {
  normalizeRawPhrase,
  detectGrammarIssues,
  hasPlaceholderLeak,
  checkCopyQuality,
  validatePlanCopyQuality
};
