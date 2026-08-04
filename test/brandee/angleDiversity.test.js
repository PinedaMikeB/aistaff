// Angle-diversity tests (PART 17). Generic fixtures only.

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDistinctAngles, angleSimilarity } = require("../../src/brandee/angleDiversity");

function hookScore(category, hookText) {
  return { hook: hookText, category, templateId: `h-${category}`, total: 40 };
}

test("buildDistinctAngles produces one angle per input hook, each with a stated problem and outcome", () => {
  const hookCandidates = [
    hookScore("curiosity", "The simplest thing that helped me grow in office supplies"),
    hookScore("problem", "Tired of unreliable equipment not working? Try this instead"),
    hookScore("direct", "The fastest way to get reliable equipment without the hassle")
  ];
  const businessAnalysis = { primaryProblemsSolved: ["Unreliable office equipment"], functionalBenefits: ["Faster turnaround"], differentiators: ["Free maintenance included"] };
  const form = { whatYouSell: "office equipment rental", differentiator: "Free maintenance included" };

  const { angles } = buildDistinctAngles({ hookCandidates, businessAnalysis, form, goal: "purchase", awarenessLevel: "problem_aware" });

  assert.equal(angles.length, 3);
  for (const angle of angles) {
    assert.ok(angle.customerProblem);
    assert.ok(angle.desiredOutcome);
    assert.ok(angle.coreMessage);
    assert.ok(Array.isArray(angle.reasonToBelieve));
  }
});

test("angles rotate through distinct problem candidates instead of repeating the same one three times", () => {
  const hookCandidates = [
    hookScore("curiosity", "Hook A"),
    hookScore("problem", "Hook B"),
    hookScore("direct", "Hook C")
  ];
  const businessAnalysis = { primaryProblemsSolved: ["Problem one", "Problem two", "Problem three"], functionalBenefits: ["Outcome one", "Outcome two", "Outcome three"] };
  const form = { whatYouSell: "generic service" };

  const { angles } = buildDistinctAngles({ hookCandidates, businessAnalysis, form, goal: "purchase", awarenessLevel: "problem_aware" });
  const problems = new Set(angles.map((a) => a.customerProblem));
  assert.ok(problems.size > 1, "expected angles to draw from more than one distinct problem when multiple are available");
});

test("angleSimilarity is high for two angles sharing the same problem/outcome/message, low for genuinely different ones", () => {
  const a = { customerProblem: "Unreliable equipment breaks down often", desiredOutcome: "Less downtime", coreMessage: "Stop dealing with unreliable equipment" };
  const b = { customerProblem: "Unreliable equipment breaks down often", desiredOutcome: "Less downtime", coreMessage: "Stop dealing with unreliable equipment today" };
  const c = { customerProblem: "Slow customer support response times", desiredOutcome: "Faster answers", coreMessage: "Get help the moment you need it" };

  assert.ok(angleSimilarity(a, b) > 0.6, "near-duplicate angles should score highly similar");
  assert.ok(angleSimilarity(a, c) < 0.3, "genuinely different angles should score as dissimilar");
});

test("buildDistinctAngles falls back to a neutral (non-fabricated) problem/outcome when the business has no extracted problems", () => {
  const hookCandidates = [hookScore("curiosity", "Hook A")];
  const businessAnalysis = { primaryProblemsSolved: [], functionalBenefits: [] };
  const form = { whatYouSell: "generic consulting services" };
  const { angles } = buildDistinctAngles({ hookCandidates, businessAnalysis, form, goal: "purchase", awarenessLevel: "unaware" });
  assert.equal(angles.length, 1);
  assert.match(angles[0].customerProblem, /generic consulting services/i);
});
