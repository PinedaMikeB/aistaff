// Brandee subscription-gating tests (PART 13/14).
//
// Same constraint as accountRegistration.test.js: `../db` instantiates a
// live PrismaClient, which cannot load in this sandbox (Prisma engine built
// for darwin-arm64, sandbox is linux-arm64). This test stubs
// `require.cache` for `src/db.js` with an in-memory fake `prisma` before
// requiring productAdBilling.js, so the real gating/seeding logic runs for
// real against a fake but behaviorally faithful in-memory store.

const test = require("node:test");
const assert = require("node:assert/strict");

const dbPath = require.resolve("../../src/db");
const { PLANS, BRANDEE_PRODUCT_SLUG } = require("../../src/brandee/pricingConfig");

function installFakeDb({ existingSubscription = null } = {}) {
  const state = {
    products: new Map(),
    pricingPlans: new Map(),
    customers: new Map(),
    orders: [],
    subscriptions: existingSubscription ? [existingSubscription] : []
  };

  const fakePrisma = {
    product: {
      upsert: async ({ where, create }) => {
        const existing = state.products.get(where.slug);
        const row = existing ? { ...existing, ...create } : { id: `product-${where.slug}`, ...create };
        state.products.set(where.slug, row);
        return row;
      }
    },
    pricingPlan: {
      upsert: async ({ where, create }) => {
        const existing = state.pricingPlans.get(where.slug);
        const row = existing ? { ...existing, ...create } : { id: `plan-${where.slug}`, ...create };
        state.pricingPlans.set(where.slug, row);
        return row;
      },
      findUnique: async ({ where }) => state.pricingPlans.get(where.slug) || null
    },
    customer: {
      findFirst: async ({ where }) => [...state.customers.values()].find((c) => c.user_id === where.user_id) || null,
      create: async ({ data }) => {
        const row = { id: `customer-${data.user_id}`, ...data };
        state.customers.set(row.id, row);
        return row;
      }
    },
    order: {
      create: async ({ data }) => {
        const row = { id: `order-${state.orders.length + 1}`, ...data };
        state.orders.push(row);
        return row;
      }
    },
    subscription: {
      create: async ({ data }) => {
        const row = { id: `sub-${state.subscriptions.length + 1}`, ...data };
        state.subscriptions.push(row);
        return row;
      },
      findFirst: async ({ where }) => {
        return state.subscriptions.find((s) => s.customer_id === where.customer_id && s.status === where.status) || null;
      }
    }
  };

  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: fakePrisma } };
  return { fakePrisma, state };
}

function freshBilling() {
  const modPath = require.resolve("../../src/brandee/productAdBilling");
  delete require.cache[modPath];
  return require("../../src/brandee/productAdBilling");
}

test("ensureBrandeeProductAdsCatalog seeds one Product row and one PricingPlan row per configured plan", async () => {
  const { state } = installFakeDb();
  const { ensureBrandeeProductAdsCatalog } = freshBilling();

  const product = await ensureBrandeeProductAdsCatalog();

  assert.equal(product.slug, BRANDEE_PRODUCT_SLUG);
  assert.equal(state.pricingPlans.size, PLANS.length);
  for (const plan of PLANS) {
    assert.ok(state.pricingPlans.has(`brandee-${plan.slug}`), `missing seeded plan for ${plan.slug}`);
  }
});

test("subscribeUserToPlan in non-live (test) payment mode activates the order and subscription immediately", async () => {
  const previousMode = process.env.PAYMENT_MODE;
  delete process.env.PAYMENT_MODE; // ensure non-live default, matching MockPaymentProvider's existing test-mode behavior
  installFakeDb();
  const { subscribeUserToPlan } = freshBilling();

  const result = await subscribeUserToPlan({ user: { id: "user-1", name: "Jane", email: "jane@example.com" }, planSlug: "starter", billingFrequency: "monthly" });

  assert.equal(result.testMode, true);
  assert.equal(result.order.order_status, "active");
  assert.equal(result.order.payment_status, "paid");
  assert.equal(result.subscription.status, "active");
  assert.equal(result.plan.slug, "starter");

  if (previousMode !== undefined) process.env.PAYMENT_MODE = previousMode;
});

test("subscribeUserToPlan rejects an unknown plan slug", async () => {
  installFakeDb();
  const { subscribeUserToPlan } = freshBilling();
  await assert.rejects(() => subscribeUserToPlan({ user: { id: "user-1", name: "Jane", email: "jane@example.com" }, planSlug: "does-not-exist" }));
});

test("requireBrandeeSubscription blocks (402) a user with no active subscription", async () => {
  installFakeDb();
  const { requireBrandeeSubscription } = freshBilling();
  const middleware = requireBrandeeSubscription();

  const req = { user: { id: "user-without-sub" } };
  let statusCode = null;
  let body = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; }
  };
  let nextCalled = false;

  await middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 402);
  assert.equal(body.code, "BRANDEE_SUBSCRIPTION_REQUIRED");
});

test("requireBrandeeSubscription allows a user with an active subscription through to next()", async () => {
  const activeSubscription = { id: "sub-existing", customer_id: "customer-user-with-sub", status: "active", pricing_plan: { slug: "brandee-starter" } };
  installFakeDb({ existingSubscription: activeSubscription });
  const { requireBrandeeSubscription } = freshBilling();

  // Seed a customer row linked to this user so getActiveBrandeeSubscriptionForUser can find it.
  const dbModule = require("../../src/db");
  await dbModule.prisma.customer.create({ data: { user_id: "user-with-sub", full_name: "Jane" } });

  const middleware = requireBrandeeSubscription();
  const req = { user: { id: "user-with-sub" } };
  const res = { status() { return this; }, json() { return this; } };
  let nextCalled = false;

  await middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.brandeeSubscription.id, "sub-existing");
});
