// Brandee 100-hook framework — approved hook library.
//
// This is structured runtime data, not a prompt string. The planner
// (src/brandee/planner.js) filters/scores this list; it never lets the AI
// invent hooks outside this approved set for the primary recommendation.
//
// Categories (8): curiosity, story, authority, direct, problem, social_proof,
// question, urgency — matching the approved 100-hook framework brief.
//
// IMPORTANT — proof requirements (see brief "IMPORTANT" section):
// Many hooks reference facts (years in business, customer counts, review
// counts, deadlines) that must be verifiable, not assumed. `requiredProof`
// lists the ProofType(s) that must exist in the website analysis or user
// input before this hook may be shown as a recommendation. `canUseWithoutProof`
// is a fast filter for the common case. Hooks that make an absolute,
// unfalsifiable claim ("the only one that works") are flagged with
// `riskNotes` and treated as reject-unless-extraordinarily-supported.

const HOOK_CATEGORIES = [
  "curiosity",
  "story",
  "authority",
  "direct",
  "problem",
  "social_proof",
  "question",
  "urgency"
];

// Category-level defaults. Individual hooks below can override any of these.
const CATEGORY_DEFAULTS = {
  curiosity: {
    requiredProof: [],
    canUseWithoutProof: true,
    bestForGoals: ["discover", "signup", "purchase"],
    bestForAwareness: ["unaware", "problem_aware"],
    riskNotes: []
  },
  story: {
    requiredProof: [],
    canUseWithoutProof: true,
    bestForGoals: ["discover", "signup", "recover"],
    bestForAwareness: ["unaware", "problem_aware"],
    riskNotes: []
  },
  authority: {
    requiredProof: ["years_in_business_or_expertise"],
    canUseWithoutProof: false,
    bestForGoals: ["booking", "signup", "messages"],
    bestForAwareness: ["solution_aware", "product_aware"],
    riskNotes: ["Authority/credibility claims must be backed by a real, verifiable fact — do not use as a generic opener."]
  },
  direct: {
    requiredProof: [],
    canUseWithoutProof: true,
    bestForGoals: ["purchase", "visit", "recover", "signup"],
    bestForAwareness: ["product_aware", "most_aware"],
    riskNotes: []
  },
  problem: {
    requiredProof: [],
    canUseWithoutProof: true,
    bestForGoals: ["messages", "booking", "purchase"],
    bestForAwareness: ["problem_aware"],
    riskNotes: []
  },
  social_proof: {
    requiredProof: ["customer_count_or_review_count_or_rating"],
    canUseWithoutProof: false,
    bestForGoals: ["purchase", "recover"],
    bestForAwareness: ["product_aware", "most_aware"],
    riskNotes: ["Social-proof claims must cite a real, verifiable count/rating — never invent a number."]
  },
  question: {
    requiredProof: [],
    canUseWithoutProof: true,
    bestForGoals: ["messages", "booking", "discover"],
    bestForAwareness: ["unaware", "problem_aware"],
    riskNotes: []
  },
  urgency: {
    requiredProof: ["real_deadline_or_scarcity"],
    canUseWithoutProof: false,
    bestForGoals: ["recover", "visit", "signup"],
    bestForAwareness: ["most_aware"],
    riskNotes: ["Urgency/FOMO hooks require a genuine deadline or real scarcity — never invent one."]
  }
};

// [category, template] in the exact approved order (1-100).
const RAW_HOOKS = [
  ["curiosity", "The simplest thing that helped me grow in {{topic}}"],
  ["curiosity", "The worst advice I ever got about {{topic}}"],
  ["curiosity", "One mindset change that flipped everything in {{topic}}"],
  ["curiosity", "You don't need to be perfect to start {{activity}}"],
  ["curiosity", "A lazy but effective way to improve at {{topic}}"],
  ["curiosity", "I tested {{solution}} so you don't have to"],
  ["curiosity", "What nobody warns you about with {{topic}}"],
  ["curiosity", "The fastest way I improved at {{topic}}"],
  ["curiosity", "I didn't expect this to work but it did: {{solution}}"],
  ["curiosity", "This one thing changed everything for me in {{topic}}"],
  ["curiosity", "Why {{solution}} works when nothing else does"],
  ["curiosity", "Watch this before you try {{solution}}"],
  ["curiosity", "Why does no one mention this about {{topic}}?"],
  ["curiosity", "Don't make this mistake with {{topic}}"],
  ["curiosity", "You've probably never seen {{topic}} done like this"],
  ["curiosity", "Stop wasting time doing {{activity}} this way"],
  ["curiosity", "What happened after I tried {{solution}} for 30 days"],
  ["curiosity", "Want to save money on {{expense}}? Try this"],
  ["curiosity", "I wish someone told me this before I started {{activity}}"],
  ["curiosity", "Three mistakes keeping you stuck in {{problem}}"],

  ["story", "How I turned a failure in {{topic}} into progress"],
  ["story", "The difference between beginners and experts in {{topic}}"],
  ["story", "I spent money on {{solution}} so you don't have to"],
  ["story", "What my first year of {{activity}} taught me"],
  ["story", "Nobody prepares you for this part of {{topic}}"],
  ["story", "The truth behind overnight success in {{topic}}"],
  ["story", "What I'd tell myself before starting {{activity}}"],
  ["story", "How I stopped being scared to fail at {{activity}}"],
  ["story", "The unexpected upside of doing {{activity}}"],
  ["story", "What happens when you stop overthinking {{activity}}"],
  ["story", "How I got my first real win in {{topic}}"],
  ["story", "One small habit that made a big difference in {{topic}}"],
  ["story", "Why people quit {{activity}} too early"],
  ["story", "How to stay motivated when {{activity}} feels hard"],
  ["story", "The moment I knew {{solution}} was worth it"],
  ["story", "From zero to {{result}} — here's what actually worked"],
  ["story", "I almost gave up on {{activity}} until this happened"],
  ["story", "What changed when I stopped forcing {{activity}}"],
  ["story", "The real reason most people fail at {{activity}}"],
  ["story", "Here's what 90 days of {{activity}} actually looks like"],

  ["authority", "After {{years}} years of doing {{activity}}, here's what I know"],
  ["authority", "I've helped {{customer_count}} people with {{problem}}, and this is what works"],
  ["authority", "The {{topic}} mistake I see everyone making"],
  ["authority", "What the best {{customer_type}} have in common"],
  ["authority", "Most people do {{activity}} wrong — here's why"],
  ["authority", "I've tried every {{solution_type}} method — this is the only one that works"],
  ["authority", "What I learned from failing at {{activity}} 10 times"],
  ["authority", "The {{topic}} strategy nobody talks about"],
  ["authority", "Why experts in {{topic}} do this differently"],
  ["authority", "This is what {{topic}} looks like when done right"],

  ["direct", "The fastest way to get {{result}} without {{undesired_effort}}"],
  ["direct", "You can get {{result}} in less than {{time_period}}"],
  ["direct", "Stop paying for {{expense}} when you can {{alternative}}"],
  ["direct", "This is the only {{product_type}} you'll ever need"],
  ["direct", "Get {{result}} without {{undesired_effort}}"],
  ["direct", "How to get {{result}} even if you're a beginner"],
  ["direct", "The {{product_type}} that actually delivers on its promise"],
  ["direct", "Why {{solution}} is cheaper than you think"],
  ["direct", "Get more {{result}} with less {{resource}}"],
  ["direct", "The shortcut to {{result}} that nobody shows you"],

  ["problem", "Tired of {{problem}} not working? Try this instead"],
  ["problem", "If {{solution}} isn't working for you, watch this"],
  ["problem", "The reason your {{activity}} isn't getting results"],
  ["problem", "Why you keep failing at {{activity}} and how to fix it"],
  ["problem", "Still struggling with {{problem}}? Here's why"],
  ["problem", "The {{topic}} problem nobody wants to admit"],
  ["problem", "Are you making this {{topic}} mistake?"],
  ["problem", "This is why {{activity}} feels so hard for most people"],
  ["problem", "What to do when {{solution}} stops working"],
  ["problem", "If you've tried everything for {{problem}} and nothing works"],

  ["social_proof", "{{customer_count}} people can't be wrong about {{solution}}"],
  ["social_proof", "This is why everyone is talking about {{solution}}"],
  ["social_proof", "I tried {{solution}} after seeing everyone recommend it"],
  ["social_proof", "The {{product_type}} that went viral for a reason"],
  ["social_proof", "Why {{customer_type}} customers keep coming back"],
  ["social_proof", "Real results from real people doing {{activity}}"],
  ["social_proof", "What {{customer_count}} people say after trying {{solution}}"],
  ["social_proof", "The {{product_type}} with thousands of 5-star reviews"],
  ["social_proof", "Why {{solution}} is the most recommended {{product_type}} right now"],
  ["social_proof", "Everyone I know who tried {{solution}} said the same thing"],

  ["question", "What if you could {{result}} without {{undesired_effort}}?"],
  ["question", "Have you ever wondered why {{solution}} never works?"],
  ["question", "Is {{solution}} actually worth it?"],
  ["question", "What would happen if you tried {{activity}} every day?"],
  ["question", "Do you know the real cost of {{expense}}?"],
  ["question", "Are you doing {{activity}} the hard way?"],
  ["question", "What's stopping you from {{result}}?"],
  ["question", "Did you know you can {{result}} in just {{time_period}}?"],
  ["question", "Why isn't anyone talking about {{solution}} for {{audience}}?"],
  ["question", "What would your life look like if {{solution}} actually worked?"],

  ["urgency", "This {{offer}} won't last long — here's why"],
  ["urgency", "I almost missed out on {{offer}} — don't make my mistake"],
  ["urgency", "The {{opportunity}} window is closing — act now"],
  ["urgency", "Why {{result}} is only getting harder to achieve"],
  ["urgency", "This is your last chance to {{action}}"],
  ["urgency", "People who did {{action}} early are winning — here's why"],
  ["urgency", "The {{opportunity}} most people are sleeping on"],
  ["urgency", "Why waiting on {{action}} is costing you money"],
  ["urgency", "Do this now before {{change}} changes everything"],
  ["urgency", "The best time to {{action}} was yesterday — the second best is now"]
];

// Per-template-index overrides for the specific proof callouts named in the
// brief's "IMPORTANT" section. Index is 0-based position in RAW_HOOKS above.
const OVERRIDES = {
  40: { requiredProof: ["years_in_business"], riskNotes: ["Requires a verified number of years in business."] }, // #41
  41: { requiredProof: ["customer_count"], riskNotes: ["Requires a verified customer count."] }, // #42
  45: { // #46 "the only one that works"
    requiredProof: ["extraordinary_verified_support"],
    canUseWithoutProof: false,
    riskNotes: ["Absolute claim (\"the only one that works\"). Reject unless extraordinarily well-supported — do not use as a default recommendation."]
  },
  70: { requiredProof: ["customer_count"], riskNotes: ["Requires a verified customer count."] }, // #71
  76: { requiredProof: ["customer_count"], riskNotes: ["Requires a verified customer count."] }, // #77
  77: { requiredProof: ["review_count", "rating"], riskNotes: ["Requires verified review count and rating — \"thousands of 5-star reviews\" must be real."] }, // #78
  90: { requiredProof: ["real_deadline"], riskNotes: ["Requires a real, currently-active offer with a genuine end."] }, // #91
  91: { requiredProof: ["real_deadline"] }, // #92
  92: { requiredProof: ["real_deadline"] }, // #93
  94: { requiredProof: ["real_deadline"], riskNotes: ["\"Last chance\" requires a genuine closing period, not implied scarcity."] }, // #95
  98: { requiredProof: ["real_deadline"] }, // #99
  99: { requiredProof: ["real_deadline"] } // #100
};

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function extractVariables(template) {
  const found = new Set();
  let match;
  VARIABLE_PATTERN.lastIndex = 0;
  while ((match = VARIABLE_PATTERN.exec(template))) found.add(match[1]);
  return [...found];
}

const ALL_PLATFORMS = ["facebook", "instagram", "tiktok", "youtube", "website"];

const HOOK_TEMPLATES = RAW_HOOKS.map(([category, template], index) => {
  const defaults = CATEGORY_DEFAULTS[category];
  const override = OVERRIDES[index] || {};
  const id = `h${String(index + 1).padStart(3, "0")}`;
  return {
    id,
    category,
    template,
    requiredVariables: extractVariables(template),
    bestForGoals: override.bestForGoals || defaults.bestForGoals,
    bestForAwareness: override.bestForAwareness || defaults.bestForAwareness,
    requiredProof: override.requiredProof || defaults.requiredProof,
    canUseWithoutProof: override.canUseWithoutProof !== undefined ? override.canUseWithoutProof : defaults.canUseWithoutProof,
    supportedPlatforms: override.supportedPlatforms || ALL_PLATFORMS,
    riskNotes: [...(defaults.riskNotes || []), ...(override.riskNotes || [])]
  };
});

function getHooksByCategory(category) {
  return HOOK_TEMPLATES.filter((h) => h.category === category);
}

function getHookById(id) {
  return HOOK_TEMPLATES.find((h) => h.id === id) || null;
}

/**
 * Fill a hook template's {{variables}} from a plain key/value map.
 * Any variable without a supplied value is left as a bracketed placeholder
 * so the gap is visible rather than silently dropped or fabricated.
 */
function fillHookTemplate(template, values = {}) {
  return template.replace(VARIABLE_PATTERN, (_, key) => {
    const value = values[key];
    return value ? String(value) : `[${key}]`;
  });
}

/**
 * Filter the approved hook set down to ones that are safe to use given the
 * proof actually available — the only HARD gate, so we never fabricate a
 * claim. `goal`/`awareness` are accepted for signature symmetry with the
 * rest of the planner but are deliberately NOT used as hard filters here:
 * they are ranking signals (see planner.js scoreHook), not eligibility
 * gates. Using them as hard filters was tried and rejected — combining an
 * exact goal match AND an exact awareness match collapses the candidate
 * pool to a single category for many goal/awareness combinations, which
 * defeats the "three distinct marketing angles" requirement.
 */
function candidateHooks({ availableProofTypes = [] } = {}) {
  const proofSet = new Set(availableProofTypes);
  return HOOK_TEMPLATES.filter((hook) => hook.canUseWithoutProof || hook.requiredProof.every((p) => proofSet.has(p)));
}

module.exports = {
  HOOK_CATEGORIES,
  HOOK_TEMPLATES,
  getHooksByCategory,
  getHookById,
  extractVariables,
  fillHookTemplate,
  candidateHooks
};
