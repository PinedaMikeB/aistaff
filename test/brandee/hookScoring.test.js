// Independent hook scoring + hard safety gate tests (PARTS 18-19). Generic
// hook templates/fixtures only.

const test = require("node:test");
const assert = require("node:assert/strict");

const { scoreHookIndependently, detectPersonalExperienceClaim, detectAbsoluteClaim, detectUnsupportedUrgency } = require("../../src/brandee/hookScoring");
const { getHookById } = require("../../src/brandee/hooks");

function baseArgs(overrides = {}) {
  return {
    hookTemplate: getHookById("h081"), // "What if you could {{result}} without {{undesired_effort}}?"
    filledText: "What if you could save time every week without the extra hassle?",
    goal: "messages",
    awareness: "problem_aware",
    platform: "facebook",
    hasRequiredProof: true,
    hasVerifiedYearsInBusiness: false,
    hasVerifiedDeadline: false,
    values: { result: "save time every week", undesired_effort: "the extra hassle" },
    siblingTexts: [],
    ...overrides
  };
}

test("detectPersonalExperienceClaim flags a specific personal-failure-count template", () => {
  const h047 = getHookById("h047"); // "What I learned from failing at {{activity}} 10 times"
  assert.equal(detectPersonalExperienceClaim(h047.template), true);
});

test("detectAbsoluteClaim flags 'only ever need' and 'everyone' style templates", () => {
  assert.equal(detectAbsoluteClaim(getHookById("h054").template), true); // "This is the only {{product_type}} you'll ever need"
  assert.equal(detectAbsoluteClaim(getHookById("h043").template), true); // "The {{topic}} mistake I see everyone making"
});

test("detectUnsupportedUrgency flags 'won't last long' style templates", () => {
  assert.equal(detectUnsupportedUrgency(getHookById("h091").template), true); // "This {{offer}} won't last long — here's why"
});

test("a personal-experience-narrative hook is REJECTED without a verified years-in-business fact, even with a differentiator present", () => {
  const h047 = getHookById("h047");
  const result = scoreHookIndependently(baseArgs({
    hookTemplate: h047,
    filledText: "What I learned from failing at office equipment rental 10 times",
    hasRequiredProof: true, // the broad category-level proof bucket IS satisfied (e.g. by a differentiator)
    hasVerifiedYearsInBusiness: false // but the SPECIFIC fact this hook claims is not verified
  }));
  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons.length > 0);
});

test("the same personal-experience-narrative hook is approvable once years-in-business is actually verified", () => {
  const h047 = getHookById("h047");
  const result = scoreHookIndependently(baseArgs({
    hookTemplate: h047,
    filledText: "What I learned from failing at office equipment rental 10 times",
    hasRequiredProof: true,
    hasVerifiedYearsInBusiness: true
  }));
  assert.notEqual(result.status, "rejected");
});

test("an absolute-claim hook ('only ever need') is rejected regardless of proof", () => {
  const h054 = getHookById("h054");
  const result = scoreHookIndependently(baseArgs({
    hookTemplate: h054,
    filledText: "This is the only rental service you'll ever need",
    hasRequiredProof: true,
    hasVerifiedYearsInBusiness: true
  }));
  assert.equal(result.status, "rejected");
});

test("hooks in the same category with different filled text receive different scores (no flat per-category constant)", () => {
  const curiosityLow = scoreHookIndependently(baseArgs({
    hookTemplate: getHookById("h001"),
    filledText: "The simplest thing that helped me grow in this",
    values: {}
  }));
  const curiosityHigh = scoreHookIndependently(baseArgs({
    hookTemplate: getHookById("h007"),
    filledText: "What nobody warns you about with switching office vendors?",
    values: { topic: "switching office vendors" }
  }));
  assert.notEqual(curiosityLow.total, curiosityHigh.total, "identical per-category scoring was the root cause bug — scores must vary with actual content");
});

test("totals are always recalculated from the individual dimension scores (never trusted blindly)", () => {
  const result = scoreHookIndependently(baseArgs());
  const recomputed = Object.values(result.scores).reduce((a, b) => a + b, 0);
  assert.equal(result.total, recomputed);
});

test("distinctiveness score drops when the filled text closely overlaps a sibling hook already scored", () => {
  const withoutSiblings = scoreHookIndependently(baseArgs({ siblingTexts: [] }));
  const withSimilarSibling = scoreHookIndependently(baseArgs({ siblingTexts: ["What if you could save time every week without the extra work?"] }));
  assert.ok(withSimilarSibling.scores.distinctiveness <= withoutSiblings.scores.distinctiveness);
});

test("unresolved placeholders reduce clarity and can force rejection when there are multiple", () => {
  const result = scoreHookIndependently(baseArgs({
    filledText: "What if you could [result] without [undesired_effort]?",
    values: {}
  }));
  assert.equal(result.status, "rejected");
});
