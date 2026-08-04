// Image-ad template library for the Brandee product-ad MVP (PART 9).
//
// Each template declares its own field set so the UI can render the
// template-specific fields beside the template preview once selected, and
// so the server can validate that the required fields for the CHOSEN
// template were actually supplied before generating a preview.
//
// "Testimonial Style" stays excluded from the selectable list unless a real
// testimonial is supplied (see isTemplateAvailable) — it must never be
// offered as a generic option that then fabricates a quote.

const IMAGE_AD_TEMPLATES = [
  {
    id: "product_highlight",
    name: "Product Highlight",
    description: "Puts your product front and center with a clear headline and price.",
    bestUse: "A clean, direct ad for a single hero product.",
    thumbnail: "/agents/brandee/assets/templates/product-highlight.svg",
    proofRequirement: null,
    fields: [
      { key: "headline", label: "Headline", type: "text", required: true, maxLength: 80 },
      { key: "keyBenefit", label: "Key benefit", type: "text", required: true, maxLength: 120 },
      { key: "price", label: "Price", type: "text", required: false, maxLength: 40 },
      { key: "cta", label: "Call to action", type: "text", required: true, maxLength: 40 },
      { key: "backgroundPreference", label: "Background preference", type: "select", required: false, options: ["Clean studio", "Lifestyle setting", "Solid brand color", "Let Brandee choose"] }
    ]
  },
  {
    id: "feature_benefit",
    name: "Feature and Benefit",
    description: "Pairs one real feature with the customer benefit it delivers.",
    bestUse: "Products with one standout capability worth explaining.",
    thumbnail: "/agents/brandee/assets/templates/feature-benefit.svg",
    proofRequirement: null,
    fields: [
      { key: "feature", label: "Feature", type: "text", required: true, maxLength: 80 },
      { key: "customerBenefit", label: "Customer benefit", type: "text", required: true, maxLength: 120 },
      { key: "supportingDetail", label: "Supporting detail", type: "text", required: false, maxLength: 140 },
      { key: "cta", label: "Call to action", type: "text", required: true, maxLength: 40 }
    ]
  },
  {
    id: "offer_promo",
    name: "Offer or Promo",
    description: "Leads with a real discount or promotion.",
    bestUse: "Sales, discounts, or limited-time bundles.",
    thumbnail: "/agents/brandee/assets/templates/offer-promo.svg",
    proofRequirement: "offer",
    fields: [
      { key: "offer", label: "Offer", type: "text", required: true, maxLength: 100 },
      { key: "originalPrice", label: "Original price", type: "text", required: false, maxLength: 40 },
      { key: "promoPrice", label: "Promo price", type: "text", required: false, maxLength: 40 },
      { key: "expirationDate", label: "Real expiration date (optional)", type: "date", required: false },
      { key: "cta", label: "Call to action", type: "text", required: true, maxLength: 40 }
    ]
  },
  {
    id: "problem_solution",
    name: "Problem and Solution",
    description: "Names a real customer problem, then shows your product as the fix.",
    bestUse: "Products that solve a specific, relatable pain point.",
    thumbnail: "/agents/brandee/assets/templates/problem-solution.svg",
    proofRequirement: null,
    fields: [
      { key: "customerProblem", label: "Customer problem", type: "text", required: true, maxLength: 120 },
      { key: "productSolution", label: "Product solution", type: "text", required: true, maxLength: 120 },
      { key: "mainBenefit", label: "Main benefit", type: "text", required: false, maxLength: 120 },
      { key: "cta", label: "Call to action", type: "text", required: true, maxLength: 40 }
    ]
  },
  {
    id: "question_ad",
    name: "Question Ad",
    description: "Opens with a genuine question your customer is already asking.",
    bestUse: "Products where curiosity or a common doubt drives the decision.",
    thumbnail: "/agents/brandee/assets/templates/question-ad.svg",
    proofRequirement: null,
    fields: [
      { key: "customerQuestion", label: "Customer question", type: "text", required: true, maxLength: 140 },
      { key: "supportingAnswer", label: "Supporting answer", type: "text", required: true, maxLength: 140 },
      { key: "productBenefit", label: "Product benefit", type: "text", required: false, maxLength: 120 },
      { key: "cta", label: "Call to action", type: "text", required: true, maxLength: 40 }
    ]
  },
  {
    id: "comparison",
    name: "Comparison",
    description: "Compares your product against an alternative on defensible points only.",
    bestUse: "Products with a genuine, provable advantage.",
    thumbnail: "/agents/brandee/assets/templates/comparison.svg",
    proofRequirement: "comparison",
    fields: [
      { key: "comparisonSubject", label: "Comparison subject", type: "text", required: true, maxLength: 80 },
      { key: "comparisonPoints", label: "Defensible comparison points", type: "textarea", required: true, maxLength: 300 },
      { key: "cta", label: "Call to action", type: "text", required: true, maxLength: 40 }
    ]
  },
  {
    id: "minimal_ecommerce",
    name: "Minimal Ecommerce",
    description: "A clean, catalog-style layout — product, name, and price only.",
    bestUse: "Ecommerce and marketplace-style product listings.",
    thumbnail: "/agents/brandee/assets/templates/minimal-ecommerce.svg",
    proofRequirement: null,
    fields: [
      { key: "price", label: "Price", type: "text", required: false, maxLength: 40 },
      { key: "cta", label: "Call to action", type: "text", required: true, maxLength: 40 }
    ]
  },
  {
    id: "testimonial_style",
    name: "Testimonial Style",
    description: "Leads with a real customer quote about your product.",
    bestUse: "Products with at least one genuine, verifiable customer testimonial.",
    thumbnail: "/agents/brandee/assets/templates/testimonial-style.svg",
    proofRequirement: "testimonial",
    fields: [
      { key: "testimonialQuote", label: "Customer quote", type: "textarea", required: true, maxLength: 220 },
      { key: "testimonialAttribution", label: "Attribution (name or initials)", type: "text", required: true, maxLength: 60 },
      { key: "cta", label: "Call to action", type: "text", required: true, maxLength: 40 }
    ]
  },
  {
    id: "before_and_after",
    name: "Before and After",
    description: "Shows a verifiable before state next to the after result your product delivers.",
    bestUse: "Products with a genuine, demonstrable before/after difference.",
    thumbnail: "/agents/brandee/assets/templates/before-and-after.svg",
    proofRequirement: "before_after_proof",
    fields: [
      { key: "beforeState", label: "Verifiable before state", type: "text", required: true, maxLength: 140 },
      { key: "afterState", label: "Verifiable after state", type: "text", required: true, maxLength: 140 },
      { key: "proofSource", label: "Proof source", type: "text", required: true, maxLength: 140 },
      { key: "cta", label: "Call to action", type: "text", required: true, maxLength: 40 }
    ]
  },
  {
    id: "bold_claim",
    name: "Bold Claim",
    description: "Leads with a strong, attention-grabbing claim backed by real evidence.",
    bestUse: "Products with a genuinely strong, defensible selling point.",
    thumbnail: "/agents/brandee/assets/templates/bold-claim.svg",
    proofRequirement: "claim_evidence",
    fields: [
      { key: "claim", label: "Proposed claim", type: "text", required: true, maxLength: 100 },
      { key: "evidenceSource", label: "Evidence source", type: "text", required: true, maxLength: 140 },
      { key: "cta", label: "Call to action", type: "text", required: true, maxLength: 40 }
    ]
  },
  {
    id: "iphone_notes",
    name: "iPhone Notes",
    description: "A relatable 'note to self' headline next to a short list of real reasons why customers switched.",
    bestUse: "Products or services with 3-5 concrete, specific reasons to choose you.",
    thumbnail: "/agents/brandee/assets/templates/iphone-notes.svg",
    proofRequirement: null,
    fields: [
      { key: "noteHeadline", label: "Note headline (as a relatable question or statement)", type: "text", required: true, maxLength: 100 },
      { key: "reason1", label: "Reason 1", type: "text", required: true, maxLength: 80 },
      { key: "reason2", label: "Reason 2", type: "text", required: true, maxLength: 80 },
      { key: "reason3", label: "Reason 3", type: "text", required: true, maxLength: 80 },
      { key: "reason4", label: "Reason 4 (optional)", type: "text", required: false, maxLength: 80 },
      { key: "reason5", label: "Reason 5 (optional)", type: "text", required: false, maxLength: 80 },
      { key: "cta", label: "Call to action", type: "text", required: true, maxLength: 40 }
    ]
  },
  {
    id: "reasons_why",
    name: "Reasons Why",
    description: "A numbered list of real reasons to choose your product or service, in a bold, scannable layout.",
    bestUse: "Products or services with several distinct, supportable selling points.",
    thumbnail: "/agents/brandee/assets/templates/reasons-why.svg",
    proofRequirement: null,
    fields: [
      { key: "listHeadline", label: "List headline", type: "text", required: true, maxLength: 100 },
      { key: "reason1", label: "Reason 1", type: "text", required: true, maxLength: 80 },
      { key: "reason2", label: "Reason 2", type: "text", required: true, maxLength: 80 },
      { key: "reason3", label: "Reason 3", type: "text", required: true, maxLength: 80 },
      { key: "reason4", label: "Reason 4 (optional)", type: "text", required: false, maxLength: 80 },
      { key: "reason5", label: "Reason 5 (optional)", type: "text", required: false, maxLength: 80 },
      { key: "cta", label: "Call to action", type: "text", required: true, maxLength: 40 }
    ]
  },
  {
    id: "sticky_notes",
    name: "Sticky Notes",
    description: "Short, friendly sticky-note callouts scattered around a lifestyle shot of your product or service.",
    bestUse: "Everyday products or services with a handful of short, likeable selling points.",
    thumbnail: "/agents/brandee/assets/templates/sticky-notes.svg",
    proofRequirement: null,
    fields: [
      { key: "headline", label: "Headline", type: "text", required: true, maxLength: 100 },
      { key: "note1", label: "Sticky note 1", type: "text", required: true, maxLength: 40 },
      { key: "note2", label: "Sticky note 2", type: "text", required: true, maxLength: 40 },
      { key: "note3", label: "Sticky note 3", type: "text", required: true, maxLength: 40 },
      { key: "note4", label: "Sticky note 4 (optional)", type: "text", required: false, maxLength: 40 },
      { key: "note5", label: "Sticky note 5 (optional)", type: "text", required: false, maxLength: 40 },
      { key: "cta", label: "Call to action", type: "text", required: true, maxLength: 40 }
    ]
  }
];

function getImageAdTemplate(id) {
  return IMAGE_AD_TEMPLATES.find((t) => t.id === id) || null;
}

/**
 * Testimonial Style must stay unavailable unless a real testimonial was
 * actually supplied (PART 9). Every other template is always available.
 */
function isTemplateAvailable(templateId, { hasTestimonial = false } = {}) {
  const template = getImageAdTemplate(templateId);
  if (!template) return false;
  if (template.proofRequirement === "testimonial") return Boolean(hasTestimonial);
  return true;
}

function listAvailableTemplates({ hasTestimonial = false } = {}) {
  return IMAGE_AD_TEMPLATES.map((t) => ({ ...t, available: isTemplateAvailable(t.id, { hasTestimonial }) }));
}

module.exports = { IMAGE_AD_TEMPLATES, getImageAdTemplate, isTemplateAvailable, listAvailableTemplates };
