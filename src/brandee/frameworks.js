// Brandee approved static-ad frameworks — structured runtime data.
// The planner selects from exactly these 10; it must not invent a framework.

const STATIC_AD_FRAMEWORKS = [
  {
    id: "us-vs-them",
    name: "Us vs. Them",
    description: "Positions the business against a typical alternative or the old way of doing things, on verifiable attributes only.",
    bestForGoals: ["purchase", "discover"],
    bestForAwareness: ["solution_aware"],
    requiredInputs: ["differentiators"],
    requiredProof: ["verifiable_difference"],
    layoutRules: ["Two-column or side-by-side comparison", "Keep comparisons short and visible at a glance"],
    copyRules: [
      "Compare equivalent attributes only.",
      "Use only verifiable differences.",
      "Do not invent competitor weaknesses.",
      "Prefer \"typical alternative\" unless a named competitor comparison is legally and factually supported."
    ],
    risks: ["Legal/factual risk if a named competitor is compared without support"],
    exampleStructure: ["Header: old way vs. new way", "3-4 comparison rows", "CTA"]
  },
  {
    id: "bold-claim",
    name: "Bold Claim",
    description: "One dominant, defensible headline promise about the product or service.",
    bestForGoals: ["discover", "signup", "purchase"],
    bestForAwareness: ["problem_aware", "solution_aware"],
    requiredInputs: ["primaryBenefit"],
    requiredProof: [],
    layoutRules: ["One large headline dominates the frame", "Minimal supporting copy"],
    copyRules: [
      "One dominant headline.",
      "Product or service context must be clear.",
      "The claim must be supportable.",
      "Add qualification where needed.",
      "Reject absolute promises that cannot be verified."
    ],
    risks: ["Overclaiming if the benefit is not well supported"],
    exampleStructure: ["Bold headline claim", "One-line context", "CTA"]
  },
  {
    id: "iphone-notes",
    name: "iPhone Notes",
    description: "Native-feeling list, reasons, or checklist presented like a personal notes app screenshot.",
    bestForGoals: ["signup", "discover", "messages"],
    bestForAwareness: ["unaware", "problem_aware"],
    requiredInputs: ["primaryBenefits"],
    requiredProof: [],
    layoutRules: ["Looks like a real Notes app screenshot, not a formal brochure", "Short list, plenty of whitespace"],
    copyRules: ["Plain, concise language.", "Short list.", "Avoid overdesign.", "Make it look like a familiar note, not a formal brochure."],
    risks: ["Loses effect if overdesigned"],
    exampleStructure: ["Note title", "3-6 short list items", "Casual sign-off"]
  },
  {
    id: "features-and-benefits",
    name: "Features and Benefits",
    description: "Translates product/service features into concrete customer benefits.",
    bestForGoals: ["discover", "purchase", "messages"],
    bestForAwareness: ["solution_aware", "product_aware"],
    requiredInputs: ["productsOrServices", "primaryBenefits"],
    requiredProof: [],
    layoutRules: ["3-5 rows, one feature+benefit pair per row"],
    copyRules: ["Translate every feature into a customer benefit.", "Do not show features without explaining why they matter.", "Prioritize three to five benefits."],
    risks: ["Becomes a feature list if benefits are skipped"],
    exampleStructure: ["Headline", "3-5 feature -> benefit pairs", "CTA"]
  },
  {
    id: "before-and-after",
    name: "Before and After",
    description: "Shows a truthful transformation or operational improvement.",
    bestForGoals: ["booking", "purchase"],
    bestForAwareness: ["problem_aware"],
    requiredInputs: ["primaryProblemsSolved", "primaryBenefits"],
    requiredProof: ["truthful_transformation"],
    layoutRules: ["Clear before/after split"],
    copyRules: [
      "Use only truthful and supportable transformations.",
      "Operational before-and-after may be used for services.",
      "Do not fabricate medical, financial, or appearance outcomes.",
      "Avoid misleading visual manipulation."
    ],
    risks: ["High compliance risk for medical/financial/appearance categories"],
    exampleStructure: ["Before state", "After state", "What changed", "CTA"]
  },
  {
    id: "offer",
    name: "Offer",
    description: "Highlights a real discount, package, bonus, or guarantee that exists on the website or was provided by the user.",
    bestForGoals: ["purchase", "visit", "recover", "signup"],
    bestForAwareness: ["product_aware", "most_aware"],
    requiredInputs: ["offers"],
    requiredProof: ["real_offer"],
    layoutRules: ["Offer terms clearly visible, not buried"],
    copyRules: [
      "The offer must come from the website or user input.",
      "Do not invent discounts.",
      "Do not invent free shipping.",
      "Do not invent deadlines.",
      "Do not invent scarcity.",
      "Do not invent guarantees.",
      "Include relevant conditions where needed."
    ],
    risks: ["Invented offers are a compliance/trust risk — never fabricate"],
    exampleStructure: ["Offer headline", "Conditions", "CTA"]
  },
  {
    id: "testimonial",
    name: "Testimonial",
    description: "Uses a real, verified customer quote.",
    bestForGoals: ["purchase", "booking", "recover"],
    bestForAwareness: ["product_aware", "most_aware"],
    requiredInputs: ["proof.testimonials"],
    requiredProof: ["verified_testimonial"],
    layoutRules: ["Quote is the visual focus, attribution visible"],
    copyRules: [
      "Never invent a testimonial.",
      "Never invent a customer name.",
      "Never invent a rating.",
      "Never invent a review count.",
      "Preserve the meaning of the source testimonial.",
      "Clearly label placeholder content in development mode."
    ],
    risks: ["Never usable without a verified testimonial on file"],
    exampleStructure: ["Quote", "Attribution", "CTA"]
  },
  {
    id: "question",
    name: "Question",
    description: "Opens with one direct question relevant to the customer's actual problem, leading naturally to the solution.",
    bestForGoals: ["messages", "booking", "discover"],
    bestForAwareness: ["unaware", "problem_aware"],
    requiredInputs: ["primaryProblemsSolved"],
    requiredProof: [],
    layoutRules: ["Question is the headline"],
    copyRules: ["Ask one direct question.", "Make it relevant to the customer's actual problem.", "Lead naturally into the solution."],
    risks: ["Loses effect if the question is generic/unrelated"],
    exampleStructure: ["Question headline", "One-line answer/solution", "CTA"]
  },
  {
    id: "reasons-why",
    name: "Reasons Why",
    description: "A short list of concrete reasons, each supported by real content.",
    bestForGoals: ["discover", "signup", "booking", "recover"],
    bestForAwareness: ["problem_aware", "solution_aware"],
    requiredInputs: ["primaryBenefits", "differentiators"],
    requiredProof: [],
    layoutRules: ["Numbered list, 3, 5, or 7 reasons"],
    copyRules: ["Prefer 3, 5, or 7 reasons.", "Use concise reasons.", "Every reason must be supported by website content or user input."],
    risks: ["Reasons must trace back to real content, not filler"],
    exampleStructure: ["Headline", "3/5/7 numbered reasons", "CTA"]
  },
  {
    id: "sticky-notes",
    name: "Sticky Notes",
    description: "Short, casual, relatable micro-copy styled as sticky notes for pattern interruption.",
    bestForGoals: ["visit", "discover"],
    bestForAwareness: ["unaware"],
    requiredInputs: [],
    requiredProof: [],
    layoutRules: ["Multiple small notes, casual handwriting-style visual"],
    copyRules: ["Extremely short copy.", "One idea per note.", "Do not overload with sales copy.", "Keep the visual concept casual and believable."],
    risks: ["Overloading notes with sales copy defeats the format"],
    exampleStructure: ["2-4 short notes", "CTA note"]
  }
];

function getFrameworkById(id) {
  return STATIC_AD_FRAMEWORKS.find((f) => f.id === id) || null;
}

/**
 * Filter approved frameworks down to ones that are proof-safe. `goal`/
 * `awareness` are ranking signals applied by the caller (planner.js sorts
 * by GOAL_MAPPINGS[goal].preferredFrameworks), not hard filters here — see
 * the identical reasoning in hooks.js candidateHooks().
 */
function candidateFrameworks({ availableProofTypes = [] } = {}) {
  const proofSet = new Set(availableProofTypes);
  return STATIC_AD_FRAMEWORKS.filter((fw) => fw.requiredProof.every((p) => proofSet.has(p)));
}

module.exports = { STATIC_AD_FRAMEWORKS, getFrameworkById, candidateFrameworks };
