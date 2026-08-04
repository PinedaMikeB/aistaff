// UGC script / storyboard generation + validation (PART 23).
//
// Root cause fixed here: the previous `buildScript()` in planner.js appended
// a literal authoring instruction into the customer-facing caption string —
// `" (write final dialogue in natural Taglish, not stiff translated
// English)"` — for ANY language other than English. That instruction was
// never actually executed by anything (the deterministic builder has no
// translation step), so a Taglish/Filipino request always shipped the
// English scaffold dialogue PLUS a visible parenthetical telling whoever
// reads it to go rewrite it. This module keeps the same field name
// (`caption`) clean of any such text, and moves the honest "this still
// needs localization" fact into a `warnings` entry that is separate from
// the copy itself — visible internally, never printed inline as if it were
// part of the ad.

const { hasPlaceholderLeak, detectGrammarIssues } = require("./copyQuality");

const WORDS_PER_SECOND_BY_LANGUAGE = {
  english: 2.5,
  filipino: 2.2, // Filipino/Taglish spoken delivery tends to run slightly slower per word
  taglish: 2.3
};

function estimateWordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Builds the UGC scene sequence. Never repeats the exact hook text as the
 * dialogue of a later scene (PART 23 "Do not repeat the hook in every
 * scene") and never invents a personal story/customer experience not
 * present in the evidence passed in.
 */
function buildUgcScenes({ primaryHookText, goal, ctaText, businessAnalysis, form, language, angle }) {
  const businessName = businessAnalysis?.businessName || form?.whatYouSell || "this business";
  const benefit = angle?.desiredOutcome || (businessAnalysis?.functionalBenefits || businessAnalysis?.primaryBenefits || [])[0] || "what makes this worth it";
  const differentiator = angle?.reasonToBelieve?.[0] || form?.differentiator || null;
  const problem = angle?.customerProblem || (businessAnalysis?.primaryProblemsSolved || [])[0] || null;

  const evidenceUsed = [];
  if (differentiator) evidenceUsed.push({ claim: `Differentiator: ${differentiator}`, source: form?.differentiator ? "user" : "website", confidence: 0.7 });

  const scenes = [
    {
      sceneNumber: 1,
      durationSeconds: 4,
      purpose: "Hook",
      purposeCategory: "hook",
      dialogue: primaryHookText,
      onScreenText: primaryHookText,
      visualDirection: "Close-up, direct to camera, natural setting.",
      productDirection: null,
      evidenceUsed: [],
      caption: primaryHookText
    },
    {
      sceneNumber: 2,
      durationSeconds: 5,
      purpose: "Problem / context",
      purposeCategory: "problem",
      dialogue: problem ? `A lot of people run into this: ${problem}.` : `You're not alone if this sounds familiar.`,
      onScreenText: null,
      visualDirection: "Relatable moment showing the everyday friction.",
      productDirection: null,
      evidenceUsed: [],
      caption: "The problem most people don't talk about."
    },
    {
      sceneNumber: 3,
      durationSeconds: 6,
      purpose: "Solution",
      purposeCategory: "solution",
      dialogue: `That's exactly what ${businessName} takes care of.`,
      onScreenText: `Meet ${businessName}`,
      visualDirection: "Show the product/service in use or explained simply.",
      productDirection: "Show the real product/service — not a generic stock substitute.",
      evidenceUsed: [],
      caption: `Meet ${businessName}.`
    },
    {
      sceneNumber: 4,
      durationSeconds: 4,
      purpose: "Benefit / proof",
      purposeCategory: differentiator ? "proof" : "benefit",
      dialogue: differentiator ? `${benefit} — ${differentiator}.` : benefit,
      onScreenText: differentiator || benefit,
      visualDirection: "Reinforce the benefit visually — before/after, demonstration, or confident delivery.",
      productDirection: null,
      evidenceUsed,
      caption: differentiator ? `${benefit} — ${differentiator}` : benefit
    },
    {
      sceneNumber: 5,
      durationSeconds: 3,
      purpose: "Call to action",
      purposeCategory: "cta",
      dialogue: ctaText,
      onScreenText: ctaText,
      visualDirection: "Direct to camera, confident close.",
      productDirection: null,
      evidenceUsed: [],
      caption: ctaText
    }
  ];

  return scenes.map((scene) => ({ ...scene, estimatedWordCount: estimateWordCount(scene.dialogue) }));
}

/**
 * Validates every scene's word count against its allotted duration for the
 * requested language, and rejects any scene whose dialogue/caption leaked a
 * placeholder/authoring instruction (PART 21/23). Returns a list of
 * { sceneNumber, issues } — empty when everything is clean.
 */
function validateScenes(scenes, { language = "english" } = {}) {
  const wordsPerSecond = WORDS_PER_SECOND_BY_LANGUAGE[language] || WORDS_PER_SECOND_BY_LANGUAGE.english;
  const problems = [];

  for (const scene of scenes) {
    const issues = [];
    const maxWords = Math.ceil(scene.durationSeconds * wordsPerSecond * 1.3); // allow some headroom
    const minWords = Math.max(1, Math.floor(scene.durationSeconds * wordsPerSecond * 0.4));
    const wordCount = estimateWordCount(scene.dialogue);

    if (wordCount > maxWords) issues.push(`Dialogue likely too long for ${scene.durationSeconds}s (${wordCount} words, expected ≤${maxWords}).`);
    if (wordCount < minWords && scene.durationSeconds >= 3) issues.push(`Dialogue may be too short for ${scene.durationSeconds}s (${wordCount} words, expected ≥${minWords}).`);
    if (hasPlaceholderLeak(scene.dialogue) || hasPlaceholderLeak(scene.caption)) issues.push("Placeholder/authoring-instruction text leaked into this scene.");
    const grammarIssues = [...detectGrammarIssues(scene.dialogue), ...detectGrammarIssues(scene.caption)];
    if (grammarIssues.length) issues.push(...grammarIssues);

    if (issues.length) problems.push({ sceneNumber: scene.sceneNumber, issues });
  }

  return problems;
}

/** Confirms the closing scene's CTA language is consistent with the goal's approved CTA examples (PART 23 "CTA must align with the selected or approved goal"). */
function validateCtaAlignment(scenes, goalMapping) {
  const ctaScene = scenes[scenes.length - 1];
  if (!ctaScene || !goalMapping) return { ok: true, issues: [] };
  const ctaLower = String(ctaScene.dialogue || "").toLowerCase();
  const matches = (goalMapping.ctaExamples || []).some((example) => {
    const key = example.toLowerCase().split(/\s+/)[0]; // first word (verb) is usually the strongest signal
    return ctaLower.includes(key);
  });
  return matches ? { ok: true, issues: [] } : { ok: false, issues: ["Closing scene's CTA does not clearly match the approved goal's call-to-action language."] };
}

module.exports = { buildUgcScenes, validateScenes, validateCtaAlignment, estimateWordCount };
