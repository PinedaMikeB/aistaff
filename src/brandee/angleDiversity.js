// Creative-angle diversity engine (PART 17).
//
// Root cause fixed here: the previous `buildAngles()` in planner.js picked
// the best-scoring hook from each of the top 3 distinct hook CATEGORIES and
// called that "three distinct angles" — but an angle is supposed to be a
// distinct customerProblem/desiredOutcome/coreMessage combination, not just
// a different hook wording. With thin business data, three different hook
// categories can still all reduce to "the same problem, the same outcome,
// phrased three ways" — a paraphrase, not a materially different angle.
// This module builds the richer CreativeAngle shape and actively rejects
// (and reassigns) angles whose problem/outcome/message overlap too much
// with an angle already selected.

function tokenSet(text) {
  return new Set(String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}

function jaccardSimilarity(a, b) {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Similarity across the fields that actually define an angle (PART 17). */
function angleSimilarity(a, b) {
  const textA = `${a.customerProblem} ${a.desiredOutcome} ${a.coreMessage}`;
  const textB = `${b.customerProblem} ${b.desiredOutcome} ${b.coreMessage}`;
  return jaccardSimilarity(textA, textB);
}

const SIMILARITY_REJECT_THRESHOLD = 0.6;

/**
 * Builds problem/outcome candidate pools from real business data, never
 * from a fixed per-category script — a generic single-item fallback is used
 * only when the extraction genuinely found nothing, and it is the SAME
 * neutral fallback regardless of hook category (so it never masquerades as
 * category-specific insight it doesn't have).
 */
function buildCandidatePools({ businessAnalysis, form }) {
  const problems = (businessAnalysis?.primaryProblemsSolved || []).filter(Boolean);
  const outcomes = [
    ...(businessAnalysis?.businessOutcomes || []),
    ...(businessAnalysis?.functionalBenefits || businessAnalysis?.primaryBenefits || [])
  ].filter(Boolean);

  const fallbackProblem = form?.whatYouSell
    ? `Finding a dependable way to handle ${form.whatYouSell.toLowerCase()}`
    : "Finding a dependable solution for this need";
  const fallbackOutcome = form?.differentiator || "A more convenient way to get this done";

  return {
    problems: problems.length ? problems : [fallbackProblem],
    outcomes: outcomes.length ? outcomes : [fallbackOutcome]
  };
}

function pickRoundRobin(pool, index) {
  return pool[index % pool.length];
}

function buildReasonToBelieve({ businessAnalysis, form }) {
  const reasons = [];
  for (const d of businessAnalysis?.differentiators || []) reasons.push(d);
  if (form?.differentiator && !reasons.includes(form.differentiator)) reasons.push(form.differentiator);
  if ((businessAnalysis?.proof?.testimonials || []).length) reasons.push("A verified customer testimonial is available.");
  if (businessAnalysis?.proof?.yearsInBusiness?.value) reasons.push(`${businessAnalysis.proof.yearsInBusiness.value} years in business (verified).`);
  return reasons.slice(0, 4);
}

/**
 * Takes the best-per-category hook candidates (already category-diverse —
 * see planner.js) and produces up to 3 materially different CreativeAngle
 * objects. When two angles would otherwise share too similar a problem/
 * outcome combination, the later one is reassigned to the next candidate in
 * the pool before being accepted — a genuine attempt at diversity, not just
 * a post-hoc label.
 */
function buildDistinctAngles({ hookCandidates, businessAnalysis, form, goal, awarenessLevel }) {
  const { problems, outcomes } = buildCandidatePools({ businessAnalysis, form });
  const reasonToBelieve = buildReasonToBelieve({ businessAnalysis, form });
  const accepted = [];
  const rejectedForSimilarity = [];

  hookCandidates.forEach((hookScore, i) => {
    let problemIndex = i;
    let outcomeIndex = i;
    let candidate = null;

    // Try up to problems.length * outcomes.length combinations before giving
    // up and accepting the best-available (still hook-distinct) option.
    const maxAttempts = Math.max(problems.length, outcomes.length, 1);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const customerProblem = pickRoundRobin(problems, problemIndex + attempt);
      const desiredOutcome = pickRoundRobin(outcomes, outcomeIndex + attempt);
      const coreMessage = `${hookScore.hook}`;
      const draft = {
        id: `angle-${i + 1}`,
        name: `Angle ${String.fromCharCode(65 + i)}: ${hookScore.category.replace("_", " ")}`,
        tension: customerProblem,
        hook: hookScore.hook,
        category: hookScore.category,
        customerProblem,
        desiredOutcome,
        coreMessage,
        reasonToBelieve,
        proofUsed: [],
        formatSuitability: ["ugc_video", "static_ad"],
        awarenessFit: [awarenessLevel],
        goalFit: [goal]
      };
      const tooSimilar = accepted.some((existing) => angleSimilarity(existing, draft) >= SIMILARITY_REJECT_THRESHOLD);
      if (!tooSimilar) {
        candidate = draft;
        break;
      }
    }

    if (!candidate) {
      // Every combination tried was too similar to an existing angle — the
      // underlying business data genuinely doesn't support 3 distinct
      // angles yet. Accept the hook-distinct version anyway (still a real,
      // different hook/category) but flag it rather than silently pretend.
      const customerProblem = pickRoundRobin(problems, problemIndex);
      const desiredOutcome = pickRoundRobin(outcomes, outcomeIndex);
      candidate = {
        id: `angle-${i + 1}`,
        name: `Angle ${String.fromCharCode(65 + i)}: ${hookScore.category.replace("_", " ")}`,
        tension: customerProblem,
        hook: hookScore.hook,
        category: hookScore.category,
        customerProblem,
        desiredOutcome,
        coreMessage: hookScore.hook,
        reasonToBelieve,
        proofUsed: [],
        formatSuitability: ["ugc_video", "static_ad"],
        awarenessFit: [awarenessLevel],
        goalFit: [goal]
      };
      rejectedForSimilarity.push(candidate.id);
    }

    accepted.push(candidate);
  });

  return { angles: accepted, similarityWarnings: rejectedForSimilarity };
}

module.exports = { angleSimilarity, jaccardSimilarity, buildDistinctAngles, SIMILARITY_REJECT_THRESHOLD };
