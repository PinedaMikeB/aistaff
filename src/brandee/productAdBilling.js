// Brandee product-ad subscription gating (PART 13/14). Reuses the EXISTING
// generic Product / PricingPlan / Customer / Order / Subscription tables
// (prisma/schema.prisma) already used for the Closer/AIChat product's
// checkout — no new tables, no duplicate billing system. This only adds a
// second `Product` row ("Brandee Product Ads") with its own PricingPlans,
// exactly the same way the existing `ensurePricingCatalog()` in server.js
// seeds the Closer product's catalog.
//
// `conversation_limit`/`facebook_page_limit` on PricingPlan are Closer-
// specific required columns with no default; Brandee plans set them to 0
// (not applicable) and keep the real image/video allowances in `features`
// (Json) plus pricingConfig.js, which is the actual source of truth read
// everywhere else in this feature.

const { prisma } = require("../db");
const { PLANS, BRANDEE_PRODUCT_SLUG, BRANDEE_PRODUCT_NAME, getPlan } = require("./pricingConfig");

// Brandee plans are monthly-only (PART 2: "exactly three monthly plans") —
// annual_price is a required column on the shared PricingPlan table (used by
// the Closer product, which does offer annual billing), so we set it equal
// to 12x the monthly price purely so the column is populated; Brandee never
// actually offers or charges annual billing, and subscribeUserToPlan below
// always uses billingFrequency "monthly".
async function ensureBrandeeProductAdsCatalog() {
  const product = await prisma.product.upsert({
    where: { slug: BRANDEE_PRODUCT_SLUG },
    update: { name: BRANDEE_PRODUCT_NAME, description: "Upload your product. Brandee turns it into an image or video ad.", status: "active" },
    create: { name: BRANDEE_PRODUCT_NAME, slug: BRANDEE_PRODUCT_SLUG, description: "Upload your product. Brandee turns it into an image or video ad.", status: "active" }
  });

  await Promise.all(PLANS.map((plan) => prisma.pricingPlan.upsert({
    where: { slug: `brandee-${plan.slug}` },
    update: {
      product_id: product.id,
      name: plan.name,
      monthly_price: plan.monthlyPrice,
      annual_price: plan.monthlyPrice * 12,
      currency: plan.currency,
      conversation_limit: 0,
      facebook_page_limit: 0,
      features: { entitlements: plan.entitlements, limits: plan.limits, list: plan.features, featured: plan.featured || false, sortOrder: plan.sortOrder },
      active: plan.visible !== false
    },
    create: {
      product_id: product.id,
      name: plan.name,
      slug: `brandee-${plan.slug}`,
      monthly_price: plan.monthlyPrice,
      annual_price: plan.monthlyPrice * 12,
      currency: plan.currency,
      conversation_limit: 0,
      facebook_page_limit: 0,
      features: { entitlements: plan.entitlements, limits: plan.limits, list: plan.features, featured: plan.featured || false, sortOrder: plan.sortOrder },
      active: plan.visible !== false
    }
  })));

  return product;
}

/**
 * Finds (or creates, on first subscribe) the Customer row linked to this
 * logged-in User — Customer is normally a guest-checkout identity in this
 * schema (Customer.user_id is optional), so a registered Brandee user needs
 * one created for them the first time they subscribe.
 */
async function ensureCustomerForUser(user) {
  const existing = await prisma.customer.findFirst({ where: { user_id: user.id } });
  if (existing) return existing;
  return prisma.customer.create({
    data: {
      user_id: user.id,
      full_name: user.name,
      email: user.email,
      mobile_number: "Not provided",
      billing_address: "Not provided",
      city: "Not provided",
      province: "Not provided",
      postal_code: "0000",
      country: "Philippines"
    }
  });
}

function orderNumber() {
  return `BRD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/**
 * Subscribes a logged-in user to a Brandee plan. In non-live payment mode
 * (PAYMENT_MODE !== "live", the same env flag payments.js already uses),
 * the order/subscription are activated immediately — this mirrors
 * MockPaymentProvider's existing, already-honest "test mode" behavior
 * elsewhere in this app rather than fabricating a new one, and is what lets
 * this MVP's registration -> subscribe -> final-generation gate be tested
 * end to end without a real payment collector wired in yet. In live mode
 * this creates a pending order exactly like the existing checkout flow and
 * relies on the real payment webhook to activate it (not implemented here
 * — Brandee reuses the SAME webhook/activation code path as the existing
 * Closer checkout once a real provider is configured).
 */
async function subscribeUserToPlan({ user, planSlug, billingFrequency = "monthly" }) {
  const plan = getPlan(planSlug);
  if (!plan) throw new Error("Selected plan is not available");
  if (billingFrequency !== "monthly") throw new Error("Brandee plans are monthly-only.");
  await ensureBrandeeProductAdsCatalog();
  const dbPlan = await prisma.pricingPlan.findUnique({ where: { slug: `brandee-${planSlug}` } });
  if (!dbPlan) throw new Error("Selected plan is not available");

  const customer = await ensureCustomerForUser(user);
  const amount = plan.monthlyPrice;
  const isLive = process.env.PAYMENT_MODE === "live";

  const order = await prisma.order.create({
    data: {
      order_number: orderNumber(),
      customer_id: customer.id,
      subtotal: amount,
      tax: 0,
      total: amount,
      currency: plan.currency,
      billing_frequency: billingFrequency,
      payment_provider: isLive ? "manual_bank_transfer" : "mock",
      payment_status: isLive ? "pending" : "paid",
      order_status: isLive ? "awaiting_payment" : "active",
      paid_at: isLive ? null : new Date()
    }
  });

  const subscription = await prisma.subscription.create({
    data: {
      customer_id: customer.id,
      order_id: order.id,
      pricing_plan_id: dbPlan.id,
      provider: isLive ? "manual_bank_transfer" : "mock",
      billing_frequency: billingFrequency,
      amount,
      currency: plan.currency,
      status: isLive ? "pending" : "active",
      current_period_start: isLive ? null : new Date(),
      current_period_end: isLive ? null : new Date(Date.now() + (billingFrequency === "annual" ? 365 : 30) * 24 * 60 * 60 * 1000)
    }
  });

  return { order, subscription, plan, testMode: !isLive };
}

async function getActiveBrandeeSubscriptionForUser(userId) {
  const customer = await prisma.customer.findFirst({ where: { user_id: userId } });
  if (!customer) return null;
  const subscription = await prisma.subscription.findFirst({
    where: { customer_id: customer.id, status: "active", pricing_plan: { product: { slug: BRANDEE_PRODUCT_SLUG } } },
    include: { pricing_plan: true },
    orderBy: { created_at: "desc" }
  });
  return subscription;
}

/**
 * Express middleware: blocks the wrapped route unless the authenticated
 * user has an active Brandee subscription (PART 13/16 "Subscription is
 * required for final generation and clean exports"). Must run after
 * requireAuth so req.user is populated.
 */
function requireBrandeeSubscription() {
  return async function requireBrandeeSubscriptionMiddleware(req, res, next) {
    try {
      const subscription = await getActiveBrandeeSubscriptionForUser(req.user.id);
      if (!subscription) {
        return res.status(402).json({ error: "An active subscription is required for this action.", code: "BRANDEE_SUBSCRIPTION_REQUIRED" });
      }
      req.brandeeSubscription = subscription;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  ensureBrandeeProductAdsCatalog,
  ensureCustomerForUser,
  subscribeUserToPlan,
  getActiveBrandeeSubscriptionForUser,
  requireBrandeeSubscription
};
