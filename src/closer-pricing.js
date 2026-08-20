/**
 * Closer pricing — DERIVED, never authored here.
 *
 * Single source of truth is `PRICING_PLANS` / `ADD_ONS` in src/payments.js,
 * which is what actually bills the customer. Before 2026-08-12 this file did
 * not exist and both src/aistaff-demo.js and src/aistaff-tools.js each held
 * their OWN hardcoded copy of a pricing ladder (₱15,000 setup + ₱3,000/month,
 * ₱25,000 + ₱6,000, ₱50,000 + ₱12,000) that matched nothing in payments.js.
 * Closer quoted those numbers to real prospects and wrote ₱15,000 onto a real
 * Quotation row. See HANDOFF-CLOSER.md §9.
 *
 * RULE: add no prices here. If a number is wrong, fix payments.js.
 * RULE: this module returns FACTS only — amounts, limits, feature lists.
 *       It must never contain a customer-facing sentence. The model writes
 *       the words (HANDOFF-CLOSER.md §0 rule 2).
 */

// AVAILABLE_PLANS, not PRICING_PLANS: this module feeds customer-facing
// surfaces (site chat widget, Closer's quotation draft). A plan hidden from
// the pricing page must not be quoted by the agent, or we recreate §9 — the
// agent naming a package the customer cannot actually buy.
const { AVAILABLE_PLANS: PRICING_PLANS, AVAILABLE_ADD_ONS: ADD_ONS, PRODUCT, PITCH_BUNDLE } = require("./payments");

/** "₱4,999" — no decimals; these are whole-peso plan prices. */
function peso(amount) {
  return `₱${Number(amount || 0).toLocaleString("en-PH")}`;
}

function monthlyPriceLabel(plan) {
  return `${peso(plan.monthlyPrice)}/month`;
}

/** The cheapest real plan. What Closer should name when asked "magkano?". */
const ENTRY_PLAN = PRICING_PLANS.reduce(
  (lowest, plan) => (plan.monthlyPrice < lowest.monthlyPrice ? plan : lowest),
  PRICING_PLANS[0]
);

/**
 * One-time onboarding add-ons. These are the ONLY legitimate "setup" charges —
 * no plan carries a mandatory setup fee, which is what the phantom ladder
 * invented. Optional and quoted separately.
 */
const SETUP_ADD_ONS = ADD_ONS.filter((addon) => addon.billingType === "one_time");

/**
 * Shape kept identical to the constant it replaced, so consuming call sites in
 * aistaff-demo.js / aistaff-tools.js did not have to be rewritten.
 * `setup` is 0 by design: plans are pure monthly recurring.
 */
const MINIMUM_OFFER = {
  name: `${PRODUCT.name} — ${ENTRY_PLAN.name}`,
  planSlug: ENTRY_PLAN.slug,
  setup: 0,
  monthly: ENTRY_PLAN.monthlyPrice,
  price: monthlyPriceLabel(ENTRY_PLAN),
  channel: "Facebook Messenger chat only — no voice calls",
  conversationLimit: ENTRY_PLAN.conversationLimit,
  includes: ENTRY_PLAN.features,
  optionalSetup: SETUP_ADD_ONS.map((addon) => ({
    name: addon.name,
    price: addon.price,
    priceLabel: peso(addon.price)
  }))
};

/** Keyed by slug (starter/growth/scale) to match the previous object shape. */
const OFFICIAL_PACKAGES = Object.fromEntries(
  PRICING_PLANS.map((plan) => [
    plan.slug,
    {
      price: monthlyPriceLabel(plan),
      monthly: plan.monthlyPrice,
      annual: plan.annualPrice,
      bestFor: plan.bestFor,
      conversationLimit: plan.conversationLimit,
      includes: plan.features
    }
  ])
);

/**
 * Matches any real plan price in generated text, in the formats a model
 * plausibly writes it: "₱4,999", "PHP 4,999", "4999". Derived, so it keeps
 * working when payments.js changes. Used to gate price-mentions on having an
 * email captured — previously that gate was hardcoded to the phantom
 * ₱15,000/₱25,000/₱50,000 and would have silently stopped firing.
 */
const PLAN_PRICE_PATTERN = new RegExp(
  PRICING_PLANS.map((plan) => {
    const grouped = Number(plan.monthlyPrice).toLocaleString("en-PH");
    const plain = String(plan.monthlyPrice);
    return `₱\\s?${grouped}|PHP\\s?${grouped}|\\b${plain}\\b`;
  }).join("|"),
  "i"
);


/**
 * Pricing facts for a system prompt. FACTS ONLY — amounts, limits, what is
 * included. No sentences for the model to recite; it writes its own words in
 * whatever register the customer used (HANDOFF-CLOSER.md rules 1 and 2).
 *
 * Derived, so the site chat widget can never again drift from what we bill.
 * It previously hardcoded a retired ladder in src/server.js.
 */
function closerPricingFacts() {
  const plans = PRICING_PLANS.map((plan) => {
    const bits = [
      `${peso(plan.monthlyPrice)}/month`,
      `${plan.conversationLimit.toLocaleString()} conversations/mo`,
      `up to ${plan.facebookPageLimit} Facebook Page${plan.facebookPageLimit > 1 ? "s" : ""}`,
      `${plan.staffLoginLimit} staff login${plan.staffLoginLimit > 1 ? "s" : ""}`
    ];
    return `${plan.name}: ${bits.join(", ")}`;
  }).join(". ");

  const entry = PRICING_PLANS[0];
  const annualSaving = entry.monthlyPrice * 12 - entry.annualPrice;

  return [
    `Pricing. Every plan includes every feature; plans differ on capacity, not capability. ${plans}.`,
    "There is no setup fee and no activation fee. The plan price is the whole price.",
    "Onboarding is self-serve: a guided setup wizard in the dashboard collects products, prices, promos, photos, shipping, policies and qualification rules, and the agent starts answering from it.",
    `Annual billing is ten months at the monthly rate, so two months are free: ${peso(entry.annualPrice)} for twelve months on ${entry.name}, a saving of ${peso(annualSaving)}.`,
    "Past the conversation limit Closer keeps replying — the limit is a soft cap, never a cut-off.",
    // Derived from the add-on, never retyped — a hardcoded number here is how
    // §9's phantom pricing happened. One connection covers every agent on the
    // account, so this must not read as a per-agent charge.
    (() => {
      const integration = ADD_ONS.find((a) => a.slug === "custom-integration");
      if (!integration) return "Custom integrations are quoted after technical review.";
      const range = integration.priceMax
        ? `${peso(integration.price)} to ${peso(integration.priceMax)}`
        : `${peso(integration.price)}`;
      return `Custom integrations (their API, webhook or n8n, CRM, POS, booking system) run ${range}, quoted after technical review. One integration covers every AIStaff agent on the account — Closer and Pitch share the same connection, so it is never charged twice.`;
    })(),
    `SMS follow-up is NOT part of any Closer plan. It requires ${PITCH_BUNDLE.requires}, because the message is sent from the gateway's own SIM. Bundling Pitch with Closer unlocks: ${PITCH_BUNDLE.features.join("; ")}.`,
    // REMOVED 2026-08-19: "Enterprise is a custom quotation, not a listed
    // price." Enterprise is now a listed ₱6,999 tier, and that line would have
    // had Closer refuse to quote a price it can see in the same prompt — the
    // §9 phantom-pricing shape again, from the opposite direction.
    "Channels differ by plan: Starter answers on Facebook Messenger. Essential answers on Messenger OR the website chat widget — the customer chooses one. Professional and Enterprise answer on both, sharing one conversation allowance rather than two separate pools.",
    "Full details and checkout: /pricing/"
  ].join(" ");
}

module.exports = {
  closerPricingFacts,
  peso,
  monthlyPriceLabel,
  ENTRY_PLAN,
  MINIMUM_OFFER,
  OFFICIAL_PACKAGES,
  SETUP_ADD_ONS,
  PLAN_PRICE_PATTERN
};
