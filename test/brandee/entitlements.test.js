// Entitlement accounting tests (PART 27).
//
// computeRemaining() is a pure function and is fully tested here without any
// database. reserve()/consume()/release()/getBalance() genuinely touch
// Postgres (BrandeeEntitlementEvent) — those integration tests self-skip in
// this sandbox (no reachable database — see _prismaSandboxGuard.js's header
// comment) and are meant to be run for real once `npx prisma migrate
// deploy` has been applied against a live database.

require("../admin/_prismaSandboxGuard");
const test = require("node:test");
const assert = require("node:assert/strict");

const { computeRemaining, VALID_UNITS, reserve, consume, release, getBalance, withReservedEntitlement } = require("../../src/brandee/entitlements");
const { prisma } = require("../../src/db");

test("VALID_UNITS is exactly IMAGE_FINAL and VIDEO_SECONDS — never a generic 'credits' unit", () => {
  assert.deepEqual(VALID_UNITS.sort(), ["IMAGE_FINAL", "VIDEO_SECONDS"]);
});

test("computeRemaining returns the full monthly allowance when there are no events yet", () => {
  const remaining = computeRemaining({ monthlyAllowance: 10, events: [] });
  assert.equal(remaining, 10);
});

test("computeRemaining subtracts an outstanding RESERVE from the balance", () => {
  const remaining = computeRemaining({
    monthlyAllowance: 10,
    events: [{ idempotencyKey: "a", eventType: "RESERVE", amount: 1 }]
  });
  assert.equal(remaining, 9);
});

test("computeRemaining does NOT double-subtract when a RESERVE is followed by its matching CONSUME", () => {
  const remaining = computeRemaining({
    monthlyAllowance: 10,
    events: [
      { idempotencyKey: "a", eventType: "RESERVE", amount: 1 },
      { idempotencyKey: "a:consume", eventType: "CONSUME", amount: 1 }
    ]
  });
  // CONSUME uses a different idempotencyKey (":consume" suffix, per
  // entitlements.js's consume()) so it must not be treated as a second,
  // independent reservation.
  assert.equal(remaining, 9);
});

test("computeRemaining restores the balance when a RESERVE is RELEASEd", () => {
  const remaining = computeRemaining({
    monthlyAllowance: 10,
    events: [
      { idempotencyKey: "a", eventType: "RESERVE", amount: 1 },
      { idempotencyKey: "a", eventType: "RELEASE", amount: 1 }
    ]
  });
  assert.equal(remaining, 10, "a released reservation must not still count against the balance");
});

test("computeRemaining never goes negative even if allowance is somehow over-reserved", () => {
  const remaining = computeRemaining({
    monthlyAllowance: 2,
    events: [
      { idempotencyKey: "a", eventType: "RESERVE", amount: 2 },
      { idempotencyKey: "b", eventType: "RESERVE", amount: 5 }
    ]
  });
  assert.equal(remaining, 0);
});

test("computeRemaining treats multiple independent reservations correctly", () => {
  const remaining = computeRemaining({
    monthlyAllowance: 10,
    events: [
      { idempotencyKey: "a", eventType: "RESERVE", amount: 1 },
      { idempotencyKey: "b", eventType: "RESERVE", amount: 2 },
      { idempotencyKey: "b", eventType: "RELEASE", amount: 2 }
    ]
  });
  assert.equal(remaining, 9, "only the un-released reservation (a, amount 1) should count against the balance");
});

// --- Integration tests (real Postgres required) -----------------------

async function dbReachable() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function makeCustomerWithSubscription() {
  const company = await prisma.company.create({ data: { name: `Entitlement Test Co ${Date.now()}`, status: "active" } });
  const user = await prisma.user.create({ data: { company_id: company.id, name: "Test User", email: `ent-${Date.now()}@example.com`, password_hash: "x", role: "owner" } });
  const customer = await prisma.customer.create({ data: { user_id: user.id, full_name: "Test User", email: user.email, mobile_number: "N/A", billing_address: "N/A", city: "N/A", province: "N/A", postal_code: "0000", country: "Philippines" } });
  const product = await prisma.product.upsert({ where: { slug: "brandee-product-ads" }, update: {}, create: { name: "Brandee Product Ads", slug: "brandee-product-ads", description: "test", status: "active" } });
  const plan = await prisma.pricingPlan.upsert({
    where: { slug: "brandee-image_starter" },
    update: {},
    create: { product_id: product.id, name: "Image Starter", slug: "brandee-image_starter", monthly_price: 599, annual_price: 7188, currency: "PHP", conversation_limit: 0, facebook_page_limit: 0, features: {}, active: true }
  });
  const order = await prisma.order.create({ data: { order_number: `TEST-${Date.now()}`, customer_id: customer.id, subtotal: 599, total: 599, currency: "PHP", billing_frequency: "monthly", payment_provider: "mock", payment_status: "paid", order_status: "active", paid_at: new Date() } });
  const subscription = await prisma.subscription.create({
    data: { customer_id: customer.id, order_id: order.id, pricing_plan_id: plan.id, provider: "mock", billing_frequency: "monthly", amount: 599, currency: "PHP", status: "active", current_period_start: new Date(), current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
  });
  const fullSubscription = await prisma.subscription.findUnique({ where: { id: subscription.id }, include: { pricing_plan: true } });
  return { company, user, customer, fullSubscription };
}

async function cleanup({ company, user, customer, fullSubscription }) {
  await prisma.brandeeEntitlementEvent.deleteMany({ where: { customer_id: customer.id } });
  await prisma.subscription.delete({ where: { id: fullSubscription.id } }).catch(() => {});
  await prisma.order.deleteMany({ where: { customer_id: customer.id } });
  await prisma.customer.delete({ where: { id: customer.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.company.delete({ where: { id: company.id } });
}

test("reserve() blocks a request that would exceed the plan's remaining IMAGE_FINAL allowance", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment.");
  const ctx = await makeCustomerWithSubscription();
  try {
    // Image Starter = 10 IMAGE_FINAL/month. Reserve all 10, then try an 11th.
    for (let i = 0; i < 10; i++) {
      await reserve({ customerId: ctx.customer.id, subscriptionId: ctx.fullSubscription.id, subscription: ctx.fullSubscription, unit: "IMAGE_FINAL", amount: 1, idempotencyKey: `test-reserve-${ctx.customer.id}-${i}` });
    }
    await assert.rejects(
      () => reserve({ customerId: ctx.customer.id, subscriptionId: ctx.fullSubscription.id, subscription: ctx.fullSubscription, unit: "IMAGE_FINAL", amount: 1, idempotencyKey: `test-reserve-${ctx.customer.id}-overflow` }),
      (err) => err.code === "INSUFFICIENT_ENTITLEMENT"
    );
  } finally {
    await cleanup(ctx);
  }
});

test("release() after a failed generation frees the reservation back up", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment.");
  const ctx = await makeCustomerWithSubscription();
  try {
    const key = `test-release-${ctx.customer.id}`;
    await reserve({ customerId: ctx.customer.id, subscriptionId: ctx.fullSubscription.id, subscription: ctx.fullSubscription, unit: "IMAGE_FINAL", amount: 1, idempotencyKey: key });
    let balance = await getBalance({ customerId: ctx.customer.id, subscription: ctx.fullSubscription, unit: "IMAGE_FINAL" });
    assert.equal(balance.remaining, 9);

    await release({ idempotencyKey: key });
    balance = await getBalance({ customerId: ctx.customer.id, subscription: ctx.fullSubscription, unit: "IMAGE_FINAL" });
    assert.equal(balance.remaining, 10, "a released reservation must restore the full allowance");
  } finally {
    await cleanup(ctx);
  }
});

test("withReservedEntitlement releases on a failed generation and does not consume the allowance", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment.");
  const ctx = await makeCustomerWithSubscription();
  try {
    const result = await withReservedEntitlement(
      { customerId: ctx.customer.id, subscriptionId: ctx.fullSubscription.id, subscription: ctx.fullSubscription, unit: "IMAGE_FINAL", amount: 1, idempotencyKey: `test-withres-fail-${ctx.customer.id}` },
      async () => ({ ok: false, reason: "provider_unavailable", message: "test failure" })
    );
    assert.equal(result.ok, false);
    const balance = await getBalance({ customerId: ctx.customer.id, subscription: ctx.fullSubscription, unit: "IMAGE_FINAL" });
    assert.equal(balance.remaining, 10, "a failed generation must not consume the allowance");
  } finally {
    await cleanup(ctx);
  }
});

test("withReservedEntitlement consumes the allowance only after a successful generation", async (t) => {
  if (!(await dbReachable())) return t.skip("No reachable database in this environment.");
  const ctx = await makeCustomerWithSubscription();
  try {
    const result = await withReservedEntitlement(
      { customerId: ctx.customer.id, subscriptionId: ctx.fullSubscription.id, subscription: ctx.fullSubscription, unit: "IMAGE_FINAL", amount: 1, idempotencyKey: `test-withres-ok-${ctx.customer.id}` },
      async () => ({ ok: true, svg: "<svg></svg>" })
    );
    assert.equal(result.ok, true);
    const balance = await getBalance({ customerId: ctx.customer.id, subscription: ctx.fullSubscription, unit: "IMAGE_FINAL" });
    assert.equal(balance.remaining, 9, "a successful generation must consume exactly one unit");
  } finally {
    await cleanup(ctx);
  }
});
