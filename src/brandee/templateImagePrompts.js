// Per-framework ART DIRECTION for the AI_GENERATED_LAYOUT render mode.
//
// These describe LAYOUT and VISUAL STYLE only — never the customer's actual
// words. The customer's field answers are merged in at generation time by
// creativePlanner.composeImagePrompt(), which asks GPT-5.6 Sol to produce
// one final prompt for GPT Image 2.
//
// Deliberate constraints baked into every prompt below:
//   * Image models render long text badly, so each layout asks for SHORT
//     text only and names exactly which text areas exist. Sol enforces the
//     word budgets separately.
//   * The customer's real product photo is always the reference image and
//     must never be redrawn, restyled, or replaced.
//   * No invented logos, brand marks, badges, ratings, prices, or awards —
//     the same honesty posture the rest of Brandee already enforces.

const SHARED_RULES = [
  "Vertical 4:5 advertisement, print-quality, professionally art-directed.",
  "Use the supplied reference photo as the actual product/subject — keep its shape, color, materials, labels and proportions exactly as they are. Never redraw or substitute it.",
  "Render every piece of text crisply and spelled exactly as given. Do not add any text that was not provided.",
  "Do not invent logos, brand names, ratings, star reviews, award badges, prices, or guarantees.",
  "Leave clean margins; nothing important within 4% of any edge."
].join(" ");

const FRAMEWORK_IMAGE_PROMPTS = {
  features_and_benefits: [
    "Layout: a clean editorial ad on a warm off-white or soft cream background.",
    "Top third: a large lifestyle or studio photograph of the subject, softly lit, with a gentle natural shadow.",
    "Directly beneath it: a short bold headline in a modern serif, left-aligned, no more than two lines.",
    "Middle: a two-column comparison panel with rounded corners and a subtle border. The LEFT column is headed with the feature label and lists short feature lines each preceded by a small simple line icon. The RIGHT column is headed with the benefit label and lists the matching benefit lines, each with its own small icon. A small arrow points from each feature row to its benefit row.",
    "Bottom: a single wide call-to-action button with rounded ends in the brand accent color, containing short CTA text.",
    "Palette: muted sage green and warm gold accents on cream, dark charcoal text. Calm, trustworthy, professional — like a well-designed small-business brochure.",
    SHARED_RULES
  ].join(" "),

  us_vs_them: [
    "Layout: a vertical split-screen comparison advertisement with a crisp dividing line down the middle.",
    "The LEFT half is visually muted — desaturated grays, flat lighting — representing the ordinary alternative. The RIGHT half is bright, warm and premium, representing the advertiser's offering, and contains the supplied reference photo well lit with a soft shadow.",
    "Each half carries a short column heading at the top and beneath it two or three very short comparison lines, each with a simple icon: subtle gray marks on the left, confident accent-colored check marks on the right.",
    "Top of the image: one short headline spanning the full width, centered.",
    "Bottom: a single wide rounded call-to-action button in the accent color with short CTA text.",
    "Palette: neutral gray on the left, deep blue or emerald with warm highlights on the right. Confident and fair — never mocking, never naming a competitor.",
    SHARED_RULES
  ].join(" "),

  reasons_why: [
    "Layout: a vertical list advertisement on a clean solid or very subtly textured background.",
    "Top: the supplied reference photo, centered, well lit on a clean surface with a soft shadow, occupying roughly the upper 40 percent.",
    "Beneath it: one short bold headline, centered, maximum two lines.",
    "Middle and lower area: a vertical numbered list of short reason lines. Each row has a filled circular badge containing its number in the accent color, followed by a short bold reason label, with generous even spacing between rows and a hairline separator.",
    "Bottom: a single wide rounded call-to-action button in the accent color with short CTA text.",
    "Palette: clean white or soft neutral background, one strong accent color used consistently for the number badges and the button, near-black text. Modern, scannable, uncluttered.",
    SHARED_RULES
  ].join(" ")
};

/**
 * Art direction for a template, resolved by its framework. Returns null when
 * the framework has no prompt written yet — callers must treat null as
 * "stay on the deterministic SVG compositor", never as "generate anyway."
 */
function imagePromptForFramework(frameworkKey) {
  if (!frameworkKey) return null;
  return FRAMEWORK_IMAGE_PROMPTS[frameworkKey] || null;
}

module.exports = { FRAMEWORK_IMAGE_PROMPTS, SHARED_RULES, imagePromptForFramework };
