const test = require("node:test");
const assert = require("node:assert/strict");

const { correctGoal, getGoalMapping, BUSINESS_GOALS } = require("../../src/brandee/goalMappings");
const { classifyAwareness, AWARENESS_LEVELS, AUDIENCE_SOURCES } = require("../../src/brandee/awareness");

test("goal-selector slugs match the 7 approved business goals", () => {
  assert.deepEqual(BUSINESS_GOALS, ["purchase", "messages", "booking", "signup", "visit", "discover", "recover"]);
  for (const goal of BUSINESS_GOALS) assert.ok(getGoalMapping(goal), `missing mapping for ${goal}`);
});

test("correctGoal recommends 'messages' for a considered B2B service purchase (e.g. equipment rental)", () => {
  const result = correctGoal({
    selectedGoal: "purchase",
    businessAnalysis: { businessType: "service", summary: "copier and printer rental for offices", productsOrServices: [{ name: "Copier Rental" }] }
  });
  assert.equal(result.recommendedGoal, "messages");
  assert.equal(result.goalChanged, true);
  assert.ok(result.explanation.length > 0);
});

test("correctGoal keeps the selected goal when it already fits", () => {
  const result = correctGoal({
    selectedGoal: "messages",
    businessAnalysis: { businessType: "service", summary: "copier rental", productsOrServices: [{ name: "Copier Rental" }] }
  });
  assert.equal(result.goalChanged, false);
  assert.equal(result.recommendedGoal, "messages");
});

test("correctGoal does not override a purchase goal for a clear e-commerce product business", () => {
  const result = correctGoal({
    selectedGoal: "purchase",
    businessAnalysis: { businessType: "product", summary: "shop now, add to cart, free shipping on all orders", productsOrServices: [{ name: "Vitamin C Serum" }] }
  });
  assert.equal(result.goalChanged, false);
});

test("classifyAwareness returns one of the 5 approved levels with an explanation", () => {
  const result = classifyAwareness({ businessAnalysis: { primaryProblemsSolved: [], productsOrServices: [], differentiators: [], offers: [], proof: { testimonials: [] } }, goal: "messages" });
  assert.ok(AWARENESS_LEVELS.includes(result.level));
  assert.ok(result.confidence > 0 && result.confidence <= 1);
  assert.ok(result.explanation.length > 0);
});

test("classifyAwareness escalates toward product/most-aware as proof and offers accumulate", () => {
  const bare = classifyAwareness({ businessAnalysis: { primaryProblemsSolved: [], productsOrServices: [], differentiators: [], offers: [], proof: { testimonials: [] } }, goal: "purchase" });
  const rich = classifyAwareness({
    businessAnalysis: {
      primaryProblemsSolved: ["slow replies"],
      productsOrServices: [{ name: "Plan A" }],
      differentiators: ["24/7 support"],
      offers: ["10% off"],
      proof: { testimonials: [{ quote: "Great!", attribution: "A customer" }] }
    },
    goal: "recover"
  });
  const rank = (level) => AWARENESS_LEVELS.indexOf(level);
  assert.ok(rank(rich.level) > rank(bare.level), `expected ${rich.level} to rank above ${bare.level}`);
});

// PART 16 — campaign context (audienceSource) must be considered alongside
// website content, not just website content alone.

test("AUDIENCE_SOURCES includes the full approved list of campaign-context values", () => {
  for (const source of [
    "cold_audience", "broad_targeting", "interest_targeting", "lookalike",
    "engaged_audience", "website_visitors", "previous_leads", "abandoned_inquiry",
    "existing_customers", "unknown"
  ]) {
    assert.ok(AUDIENCE_SOURCES.includes(source), `missing audience source: ${source}`);
  }
});

test("a cold_audience is never classified most_aware even when the website has rich proof and offers", () => {
  const richBusinessAnalysis = {
    primaryProblemsSolved: ["slow replies"],
    productsOrServices: [{ name: "Plan A" }],
    differentiators: ["24/7 support"],
    offers: ["10% off"],
    proof: { testimonials: [{ quote: "Great!", attribution: "A customer" }] }
  };
  const result = classifyAwareness({ businessAnalysis: richBusinessAnalysis, goal: "recover", audienceSource: "cold_audience" });
  assert.notEqual(result.level, "most_aware");
  assert.ok(["unaware", "problem_aware", "solution_aware"].includes(result.level));
  assert.equal(result.audienceSource, "cold_audience");
});

test("existing_customers are never classified below most_aware, even with a bare/empty website", () => {
  const bareBusinessAnalysis = { primaryProblemsSolved: [], productsOrServices: [], differentiators: [], offers: [], proof: { testimonials: [] } };
  const result = classifyAwareness({ businessAnalysis: bareBusinessAnalysis, goal: "purchase", audienceSource: "existing_customers" });
  assert.equal(result.level, "most_aware");
});

test("an audience source whose typical range already matches the content-based read is not clamped, and confidence rises slightly", () => {
  const businessAnalysis = { primaryProblemsSolved: ["slow replies"], productsOrServices: [], differentiators: [], offers: [], proof: { testimonials: [] } };
  const contentOnly = classifyAwareness({ businessAnalysis, goal: "signup", audienceSource: "unknown" });
  const withContext = classifyAwareness({ businessAnalysis, goal: "signup", audienceSource: "interest_targeting" });
  assert.equal(withContext.level, "problem_aware");
  assert.ok(withContext.confidence >= contentOnly.confidence, "a matching, known audience source should not reduce confidence versus the unknown case");
});

test("audienceSource 'unknown' falls back to content-only classification with capped confidence and an explicit uncertainty note", () => {
  const businessAnalysis = { primaryProblemsSolved: [], productsOrServices: [], differentiators: [], offers: [], proof: { testimonials: [] } };
  const result = classifyAwareness({ businessAnalysis, goal: "messages", audienceSource: "unknown" });
  assert.ok(result.confidence <= 0.55);
  assert.match(result.explanation, /audience source wasn't specified/i);
});
