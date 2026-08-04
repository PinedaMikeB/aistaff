// Brandee audience-awareness classification — structured rules + heuristic.
//
// PART 16 — awareness must not be inferred from the website alone; who is
// actually going to SEE the ad (audienceSource) is at least as important as
// what the website says, and the previous implementation had no such field
// at all. `AUDIENCE_SOURCES` + `AUDIENCE_SOURCE_AWARENESS_HINTS` below layer
// campaign context on top of the existing content-based heuristic rather
// than replacing it: an explicit audienceSource is the PRIMARY signal when
// provided; content-based signals still refine within that range and are
// the sole signal when audienceSource is "unknown" (matches this repo's
// existing behavior for any request that predates this field).

const AWARENESS_LEVELS = ["unaware", "problem_aware", "solution_aware", "product_aware", "most_aware"];

const AUDIENCE_SOURCES = [
  "cold_audience", "broad_targeting", "interest_targeting", "lookalike",
  "engaged_audience", "website_visitors", "previous_leads", "abandoned_inquiry",
  "existing_customers", "unknown"
];

// Each entry: the awareness levels this audience source is USUALLY at,
// ordered from most to least likely — the content-based heuristic below
// picks among these rather than escalating past them.
const AUDIENCE_SOURCE_AWARENESS_HINTS = {
  cold_audience: ["unaware", "problem_aware", "solution_aware"],
  broad_targeting: ["unaware", "problem_aware"],
  interest_targeting: ["problem_aware", "solution_aware"],
  lookalike: ["problem_aware", "solution_aware"],
  engaged_audience: ["solution_aware", "product_aware"],
  website_visitors: ["solution_aware", "product_aware"],
  previous_leads: ["product_aware", "most_aware"],
  abandoned_inquiry: ["product_aware", "most_aware"],
  existing_customers: ["most_aware"],
  unknown: null // no override — pure content-based heuristic, as before
};

const AWARENESS_GUIDANCE = {
  unaware: {
    label: "Unaware",
    use: ["curiosity", "story", "question"],
    avoid: ["Detailed feature lists as an opener", "Hard offers", "Direct comparisons without context"]
  },
  problem_aware: {
    label: "Problem aware",
    use: ["problem", "question", "before-and-after", "reasons-why", "supported bold claim"],
    avoid: ["Jumping straight to price"]
  },
  solution_aware: {
    label: "Solution aware",
    use: ["us-vs-them", "features-and-benefits", "comparison", "authority", "reasons-why"],
    avoid: ["Vague, unsupported comparisons"]
  },
  product_aware: {
    label: "Product aware",
    use: ["testimonial", "product demonstration", "objection handling", "offer", "social proof"],
    avoid: ["Reintroducing basic problem education"]
  },
  most_aware: {
    label: "Most aware",
    use: ["direct offer", "reminder", "real urgency", "bonus", "strong CTA"],
    avoid: ["Fabricated urgency"]
  }
};

/**
 * Content-based heuristic (unchanged core logic, kept as the fallback and
 * as the WITHIN-RANGE refiner when an audienceSource hint is present).
 */
function classifyFromContent({ businessAnalysis, goal }) {
  const proof = businessAnalysis?.proof || {};
  const hasTestimonials = (proof.testimonials || []).length > 0;
  const hasOffers = (businessAnalysis?.offers || []).length > 0;
  const hasDifferentiators = (businessAnalysis?.differentiators || []).length > 0;
  const hasProblems = (businessAnalysis?.primaryProblemsSolved || []).length > 0;
  const hasProducts = (businessAnalysis?.productsOrServices || []).length > 0;
  const isRecoverOrPurchase = goal === "recover" || goal === "purchase";

  if (hasTestimonials && hasOffers && isRecoverOrPurchase) {
    return {
      level: "most_aware",
      confidence: 0.6,
      explanation: "The website has both proof (testimonials) and a clear offer, and the goal is purchase-oriented — these visitors are likely ready to act with the right nudge."
    };
  }
  if ((hasTestimonials || hasOffers) && hasProducts) {
    return {
      level: "product_aware",
      confidence: 0.55,
      explanation: "The website names specific products/services and has some proof or an offer — visitors likely already know what's on offer, but haven't committed yet."
    };
  }
  if (hasDifferentiators && hasProducts) {
    return {
      level: "solution_aware",
      confidence: 0.5,
      explanation: "The website explains what makes the business different, suggesting visitors already understand the type of solution but are comparing options."
    };
  }
  if (hasProblems) {
    return {
      level: "problem_aware",
      confidence: 0.5,
      explanation: "The website content centers on problems it solves, suggesting most visitors know they have the problem but haven't picked a solution yet."
    };
  }
  return {
    level: "unaware",
    confidence: 0.35,
    explanation: "Limited signal was found to confirm audience familiarity, so Brandee defaults to treating visitors as unfamiliar with the problem or solution — safer to build curiosity first."
  };
}

/**
 * Awareness classification that considers CAMPAIGN CONTEXT (PART 16) —
 * who will actually see the ad — not just website content. When
 * `audienceSource` is known, it sets the plausible RANGE of awareness
 * levels; the content-based heuristic then picks/refines within that range
 * rather than being allowed to claim a level the audience source rules out
 * (e.g. a `cold_audience` is never classified `most_aware`, no matter how
 * much proof the website has — that proof describes the business, not
 * whether THIS particular audience has seen it before).
 */
function classifyAwareness({ businessAnalysis, goal, audienceSource = "unknown" }) {
  const contentBased = classifyFromContent({ businessAnalysis, goal });
  const allowedRange = AUDIENCE_SOURCE_AWARENESS_HINTS[audienceSource];

  if (!allowedRange) {
    // No audience-source context supplied — same behavior as before this
    // field existed, but explicit about the uncertainty this implies.
    return {
      ...contentBased,
      audienceSource: "unknown",
      confidence: Math.min(contentBased.confidence, 0.55),
      explanation: `${contentBased.explanation} (Audience source wasn't specified for this campaign, so this is based on website content alone — confirm who will actually see this ad for a more precise read.)`
    };
  }

  const rank = (level) => AWARENESS_LEVELS.indexOf(level);
  const rangeRanks = allowedRange.map(rank);
  const minRank = Math.min(...rangeRanks);
  const maxRank = Math.max(...rangeRanks);
  const contentRank = rank(contentBased.level);

  let level;
  if (contentRank < minRank) level = AWARENESS_LEVELS[minRank];
  else if (contentRank > maxRank) level = AWARENESS_LEVELS[maxRank];
  else level = contentBased.level;

  const wasClamped = level !== contentBased.level;
  return {
    level,
    confidence: wasClamped ? 0.5 : Math.min(0.75, contentBased.confidence + 0.15),
    audienceSource,
    explanation: wasClamped
      ? `Website content alone suggested "${contentBased.level.replace("_", " ")}", but this audience (${audienceSource.replace(/_/g, " ")}) is typically ${allowedRange.map((l) => l.replace("_", " ")).join(" to ")} — Brandee used the campaign-context range instead of the website-only read.`
      : `${contentBased.explanation} This also fits a ${audienceSource.replace(/_/g, " ")} audience, which is typically ${allowedRange.map((l) => l.replace("_", " ")).join(" to ")}.`
  };
}

module.exports = { AWARENESS_LEVELS, AWARENESS_GUIDANCE, AUDIENCE_SOURCES, AUDIENCE_SOURCE_AWARENESS_HINTS, classifyAwareness };
