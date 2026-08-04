// Independent, application-side hook scoring + hard safety gates (PARTS 18-19).
//
// Root causes fixed here, verified against the previous planner.js
// `scoreHook()`:
// 1. `curiosity` was a flat per-CATEGORY constant (`curiosityBase[category]`)
//    — every hook in the same category always got the exact same curiosity
//    score, and most of the other 7 dimensions were driven off only 1-2
//    booleans each (unresolved-placeholder check, category-membership
//    check). That collapses many hooks in a category to identical or
//    near-identical totals — verified, not assumed: with `authority`
//    hooks in particular, `credibility` only had two possible values (5 or
//    2) shared across all 10 templates in the category.
// 2. `requiredProof` eligibility was checked only at the CATEGORY/TEMPLATE
//    level via hooks.js's static data (e.g. every `authority` hook only
//    requires the broad "years_in_business_or_expertise" bucket, which is
//    satisfied by ANY differentiator string at all) — so a hook whose exact
//    wording is "What I learned from failing at {{activity}} 10 times" (a
//    specific personal-failure-count narrative) becomes fully approved the
//    moment the business has ANY differentiator, even one totally unrelated
//    to founder experience or tenure. This module adds a second, more
//    specific hard gate that inspects the RAW TEMPLATE TEXT itself for
//    personal-experience/absolute-claim/hard-number patterns and requires
//    the SPECIFIC fact they claim (a real verified years-in-business
//    number) — not just the broad category-level proof bucket.

const { normalizeRawPhrase, detectGrammarIssues } = require("./copyQuality");

// ---------------------------------------------------------------------------
// Pattern-based hard-safety detectors (PART 18 "Reject hooks that include
// unsupported..."). These run against the RAW TEMPLATE TEXT (before variable
// substitution) since the risky language is often baked into the template
// itself, not injected via a variable.
// ---------------------------------------------------------------------------

const PERSONAL_EXPERIENCE_PATTERN = /\b(I|I've|I'd|my|I learned|I failed|I tried|I spent|I almost)\b/i;
const HARD_NUMBER_IN_TEMPLATE_PATTERN = /\b\d+\s*(times|years|days|months)\b/i;
const ABSOLUTE_CLAIM_PATTERNS = [
  /\bonly\s+(one|{{[a-z_]+}})\s+.*\bever need\b/i,
  /\bthe only one that works\b/i,
  /\beveryone\b/i,
  /\bevery\s+{{[a-z_]+}}\s+method\b/i
];
const UNSUPPORTED_URGENCY_PATTERN = /\b(won'?t last long|closing|last chance|act now|running out)\b/i;

function detectPersonalExperienceClaim(rawTemplate) {
  return PERSONAL_EXPERIENCE_PATTERN.test(rawTemplate) && HARD_NUMBER_IN_TEMPLATE_PATTERN.test(rawTemplate);
}

function detectAbsoluteClaim(rawTemplate) {
  return ABSOLUTE_CLAIM_PATTERNS.some((re) => re.test(rawTemplate));
}

function detectUnsupportedUrgency(rawTemplate) {
  return UNSUPPORTED_URGENCY_PATTERN.test(rawTemplate);
}

// ---------------------------------------------------------------------------
// Per-dimension scoring — each one reads real, varied signal from the
// FILLED text + the specific template + the actual business context, so
// hooks within the same category can legitimately differ.
// ---------------------------------------------------------------------------

function clamp(n, min = 1, max = 5) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function countUnresolvedPlaceholders(filledText) {
  const matches = filledText.match(/\[[a-z_]+\]/gi);
  return matches ? matches.length : 0;
}

function countRealValuesFilled(hookTemplate, values) {
  return hookTemplate.requiredVariables.filter((v) => values[v] !== undefined && values[v] !== null && String(values[v]).trim()).length;
}

function scoreHookIndependently({ hookTemplate, filledText, goal, awareness, platform, hasRequiredProof, hasVerifiedYearsInBusiness, hasVerifiedDeadline, values, siblingTexts = [] }) {
  const penalties = [];
  const rejectionReasons = [];

  const unresolvedCount = countUnresolvedPlaceholders(filledText);
  const totalVars = hookTemplate.requiredVariables.length || 1;
  const realValuesFilled = countRealValuesFilled(hookTemplate, values);

  // --- relevance: goal + awareness fit, weighted by how much of the
  // template is actually backed by real business data rather than filler.
  let relevance = 2 + (hookTemplate.bestForGoals.includes(goal) ? 1.5 : 0) + (hookTemplate.bestForAwareness.includes(awareness) ? 1 : 0) + (realValuesFilled / totalVars) * 0.5;
  if (!hookTemplate.bestForGoals.includes(goal) && !hookTemplate.bestForAwareness.includes(awareness)) {
    penalties.push("Weak fit for the selected goal and awareness stage.");
  }

  // --- clarity: penalize every unresolved placeholder, not just "any".
  let clarity = 5 - unresolvedCount * 1.5;
  if (unresolvedCount > 0) penalties.push(`${unresolvedCount} unresolved placeholder(s) left in the hook.`);

  // --- specificity: proportion of variables filled with real (non-generic)
  // values. A hook that leans entirely on generic filler ("this", "your
  // business") scores low even with zero brackets showing.
  const genericFillerCount = hookTemplate.requiredVariables.filter((v) => {
    const val = String(values[v] || "");
    return /^(this|your business|customers like you|the usual way|a simpler option)$/i.test(val.trim());
  }).length;
  let specificity = 2 + (realValuesFilled / totalVars) * 3 - genericFillerCount * 0.5;
  if (genericFillerCount > 0) penalties.push(`${genericFillerCount} generic filler value(s) used instead of real business detail.`);

  // --- curiosity: derived from actual constructs present in the FILLED
  // text (question mark, contrast word, "nobody"/"secret"/"actually"), not
  // a flat per-category constant.
  const curiosityCueMatches = (filledText.match(/\?|nobody|secret|actually|didn't expect|surprising|worst|mistake/gi) || []).length;
  let curiosity = 2.5 + Math.min(2.5, curiosityCueMatches);

  // --- credibility: baseline from category-level proof, then HARD-checked
  // against the more specific personal-experience/absolute-claim patterns
  // described above — this is the actual fix for the "10 times" gap.
  let credibility = hookTemplate.requiredProof.length === 0 ? 4 : (hasRequiredProof ? 4.5 : 1.5);
  const claimsPersonalExperience = detectPersonalExperienceClaim(hookTemplate.template);
  if (claimsPersonalExperience && !hasVerifiedYearsInBusiness) {
    credibility = 1;
    penalties.push("Unsupported personal-experience/specific-count claim without a verified years-in-business fact.");
    rejectionReasons.push("This hook implies specific personal experience or a failure count that isn't verified for this business.");
  }
  const claimsAbsolute = detectAbsoluteClaim(hookTemplate.template);
  if (claimsAbsolute) {
    credibility = Math.min(credibility, 1.5);
    penalties.push("Absolute/unfalsifiable claim (\"only\", \"everyone\") without extraordinary support.");
    rejectionReasons.push("This hook makes an absolute claim (\"only\"/\"everyone\") Brandee cannot verify.");
  }
  const claimsUrgency = detectUnsupportedUrgency(hookTemplate.template);
  if (claimsUrgency && !hasVerifiedDeadline) {
    credibility = Math.min(credibility, 1.5);
    penalties.push("Urgency/deadline language without a confirmed offer end date.");
    rejectionReasons.push("This hook implies urgency/scarcity that isn't confirmed for this business.");
  }

  // --- audienceFit / platformFit / goalFit — direct template metadata fit.
  let audienceFit = hookTemplate.bestForAwareness.includes(awareness) ? 5 : 3;
  let platformFit = (hookTemplate.supportedPlatforms.includes(platform) || platform === "multiple") ? 5 : 4;
  let goalFit = hookTemplate.bestForGoals.includes(goal) ? 5 : 3;

  // --- proofSafety: separate from credibility — this dimension specifically
  // reflects whether the hook is SAFE to show (not whether it's compelling).
  let proofSafety = 5;
  if (claimsPersonalExperience && !hasVerifiedYearsInBusiness) proofSafety = 1;
  if (claimsAbsolute) proofSafety = Math.min(proofSafety, 1);
  if (claimsUrgency && !hasVerifiedDeadline) proofSafety = Math.min(proofSafety, 1);
  if (hookTemplate.requiredProof.length && !hasRequiredProof) proofSafety = Math.min(proofSafety, 2);

  // --- naturalness: grammar/duplicate-word/robotic-phrase checks (shared
  // with the final copy-editing pass in copyQuality.js so the SAME rules
  // gate both the hook score and the final rendered copy).
  const grammarIssues = detectGrammarIssues(filledText);
  let naturalness = 5 - grammarIssues.length * 1.5;
  if (grammarIssues.length) penalties.push(`Grammar/naturalness issue(s): ${grammarIssues.join("; ")}`);

  // --- distinctiveness: penalize heavy token overlap with sibling hooks
  // already scored in this same batch (prevents "same idea, reworded").
  const filledTokens = new Set(filledText.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  let maxOverlap = 0;
  for (const sibling of siblingTexts) {
    const siblingTokens = new Set(String(sibling).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
    if (!siblingTokens.size || !filledTokens.size) continue;
    let intersection = 0;
    for (const t of filledTokens) if (siblingTokens.has(t)) intersection += 1;
    const overlap = intersection / Math.min(filledTokens.size, siblingTokens.size);
    maxOverlap = Math.max(maxOverlap, overlap);
  }
  let distinctiveness = 5 - Math.round(maxOverlap * 4);
  if (maxOverlap > 0.6) penalties.push("Very similar wording to another hook already selected.");

  const scores = {
    relevance: clamp(relevance),
    clarity: clamp(clarity),
    specificity: clamp(specificity),
    curiosity: clamp(curiosity),
    credibility: clamp(credibility),
    audienceFit: clamp(audienceFit),
    platformFit: clamp(platformFit),
    // Kept as `goalAlignment` (not `goalFit`) to match HookScoreSchema and
    // every existing consumer (results page, prior tests) — see schemas.js.
    goalAlignment: clamp(goalFit),
    proofSafety: clamp(proofSafety),
    naturalness: clamp(naturalness),
    distinctiveness: clamp(distinctiveness)
  };

  // Totals are ALWAYS recomputed here in code, never trusted from an AI
  // response (PART 19 "Recalculate totals in code").
  const total = Object.values(scores).reduce((a, b) => a + b, 0);

  // Hard safety gates — fail regardless of numeric total (PART 19 "Reject
  // hooks that fail any hard safety gate even if the numeric score is high").
  const hardFail = rejectionReasons.length > 0 || unresolvedCount > 1;
  if (unresolvedCount > 1 && !rejectionReasons.length) rejectionReasons.push("Too many unresolved placeholders to show this hook as-is.");

  const status = hardFail ? "rejected" : total >= 44 ? "approved" : total >= 33 ? "rewrite" : "rejected";

  return {
    hook: filledText,
    category: hookTemplate.category,
    templateId: hookTemplate.id,
    scores,
    total,
    maximum: 55,
    status,
    explanation: `${hookTemplate.category} hook — ${hookTemplate.bestForGoals.includes(goal) ? "matches" : "adjacent to"} the "${goal}" goal, ${hookTemplate.bestForAwareness.includes(awareness) ? "fits" : "is a stretch for"} a ${awareness.replace("_", " ")} audience${penalties.length ? `. Notes: ${penalties.slice(0, 2).join(" ")}` : "."}`,
    penalties,
    rejectionReasons
  };
}

module.exports = {
  scoreHookIndependently,
  detectPersonalExperienceClaim,
  detectAbsoluteClaim,
  detectUnsupportedUrgency,
  normalizeRawPhrase
};
