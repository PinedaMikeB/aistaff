// UGC script/storyboard tests (PART 23). Generic fixtures only.

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildUgcScenes, validateScenes, validateCtaAlignment, estimateWordCount } = require("../../src/brandee/ugcScript");

function baseArgs(overrides = {}) {
  return {
    primaryHookText: "What if you could save time every week without the extra hassle?",
    goal: "messages",
    ctaText: "Send us a message to get started.",
    businessAnalysis: {
      businessName: "Sample Co",
      functionalBenefits: ["Faster turnaround on every order"],
      primaryProblemsSolved: ["Unreliable equipment breaks down often"]
    },
    form: { whatYouSell: "office equipment rental", differentiator: "Free maintenance included" },
    language: "english",
    angle: {
      customerProblem: "Unreliable equipment breaks down often",
      desiredOutcome: "Less downtime and fewer surprise repairs",
      reasonToBelieve: ["Free maintenance included"]
    },
    ...overrides
  };
}

test("buildUgcScenes returns exactly 5 scenes covering hook/problem/solution/benefit-proof/cta", () => {
  const scenes = buildUgcScenes(baseArgs());
  assert.equal(scenes.length, 5);
  assert.deepEqual(scenes.map((s) => s.purposeCategory), ["hook", "problem", "solution", "proof", "cta"]);
});

test("the hook is not repeated verbatim as the dialogue of any later scene", () => {
  const args = baseArgs();
  const scenes = buildUgcScenes(args);
  const laterScenes = scenes.slice(1);
  assert.ok(laterScenes.every((s) => s.dialogue !== args.primaryHookText));
});

test("buildUgcScenes never invents a personal story/customer experience beyond the supplied evidence", () => {
  const scenes = buildUgcScenes(baseArgs());
  const allDialogue = scenes.map((s) => s.dialogue).join(" ");
  assert.ok(!/i used to|when i was|my own experience|as a customer myself/i.test(allDialogue));
});

test("each scene carries an estimatedWordCount computed from its own dialogue", () => {
  const scenes = buildUgcScenes(baseArgs());
  for (const scene of scenes) {
    assert.equal(scene.estimatedWordCount, estimateWordCount(scene.dialogue));
  }
});

test("validateScenes finds no issues for a clean, well-sized scene set", () => {
  const scenes = buildUgcScenes(baseArgs());
  const problems = validateScenes(scenes, { language: "english" });
  assert.deepEqual(problems, []);
});

test("validateScenes flags a scene whose dialogue is far too long for its duration", () => {
  const scenes = buildUgcScenes(baseArgs());
  scenes[4].dialogue = "This is an extremely long closing line that goes on and on and on far beyond what three seconds of screen time could ever comfortably hold for a viewer to hear and absorb naturally";
  const problems = validateScenes(scenes, { language: "english" });
  assert.ok(problems.some((p) => p.sceneNumber === 5 && p.issues.some((i) => i.includes("too long"))));
});

test("validateScenes catches a placeholder/authoring-instruction leak in a scene (regression for the Taglish-instruction-leak bug)", () => {
  const scenes = buildUgcScenes(baseArgs());
  scenes[2].dialogue = "Meet Sample Co. (write final dialogue in natural Taglish, not stiff translated English)";
  const problems = validateScenes(scenes, { language: "taglish" });
  assert.ok(problems.some((p) => p.sceneNumber === 3 && p.issues.some((i) => i.toLowerCase().includes("placeholder"))));
});

test("validateScenes uses a slower words-per-second allowance for Filipino/Taglish than English", () => {
  const scenes = buildUgcScenes(baseArgs());
  // Exactly 13 words in a 4s scene: fits English's max (ceil(4*2.5*1.3)=13)
  // but exceeds Taglish's slower max (ceil(4*2.3*1.3)=12) — this is the
  // discriminating case that proves the per-language rate is actually used.
  scenes[0].dialogue = "What if you could finally save real time every single week without hassle";
  const englishProblems = validateScenes(scenes, { language: "english" });
  const taglishProblems = validateScenes(scenes, { language: "taglish" });
  const englishTooLong = englishProblems.some((p) => p.sceneNumber === 1 && p.issues.some((i) => i.includes("too long")));
  const taglishTooLong = taglishProblems.some((p) => p.sceneNumber === 1 && p.issues.some((i) => i.includes("too long")));
  assert.equal(englishTooLong, false);
  assert.equal(taglishTooLong, true);
});

test("validateCtaAlignment passes when the closing scene's CTA matches the goal's approved CTA language", () => {
  const scenes = buildUgcScenes(baseArgs());
  const result = validateCtaAlignment(scenes, { ctaExamples: ["Send us a message today"] });
  assert.equal(result.ok, true);
});

test("validateCtaAlignment flags a mismatched CTA against the goal's approved language", () => {
  const scenes = buildUgcScenes(baseArgs({ ctaText: "Subscribe to our newsletter." }));
  const result = validateCtaAlignment(scenes, { ctaExamples: ["Send us a message today", "Message us now"] });
  assert.equal(result.ok, false);
  assert.ok(result.issues.length > 0);
});

test("validateCtaAlignment is a no-op (ok:true) when no goalMapping is supplied", () => {
  const scenes = buildUgcScenes(baseArgs());
  const result = validateCtaAlignment(scenes, null);
  assert.equal(result.ok, true);
});
