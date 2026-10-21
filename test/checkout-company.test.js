const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function loadCheckoutLink() {
  const state = {};
  const dbPath = require.resolve("../src/db");
  const paymentsPath = require.resolve("../src/payments");
  const checkoutPath = require.resolve("../src/checkout-link");
  const previousDb = require.cache[dbPath];
  const previousPayments = require.cache[paymentsPath];

  const tx = {
    pricingPlan: { findUnique: async () => ({ id: "plan-starter" }) },
    order: {
      create: async ({ data }) => {
        state.order = data;
        return {
          id: "order-1",
          ...data,
          items: data.items.create.map((item, index) => ({ id: `item-${index}`, ...item }))
        };
      }
    },
    payment: { create: async ({ data }) => { state.payment = data; return data; } },
    subscription: { create: async ({ data }) => { state.subscription = data; return data; } },
    invoice: { create: async ({ data }) => { state.invoice = data; return data; } }
  };
  const prisma = {
    customer: {
      findFirst: async () => null,
      create: async ({ data }) => { state.customer = data; return { id: "customer-1", ...data }; },
      update: async ({ data }) => data
    },
    order: {
      findFirst: async () => null,
      update: async ({ data }) => { state.orderUpdate = data; return data; }
    },
    payment: { updateMany: async ({ data }) => { state.paymentUpdate = data; return { count: 1 }; } },
    $transaction: async (callback) => callback(tx)
  };
  const paymentProvider = {
    createInvoice: async () => ({ providerPaymentId: "cs_paid_later", checkoutUrl: "https://pay.example/checkout" })
  };

  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma } };
  require.cache[paymentsPath] = {
    id: paymentsPath,
    filename: paymentsPath,
    loaded: true,
    exports: {
      PAYMENT_MODE: "test",
      AVAILABLE_PLANS: [{ slug: "starter", name: "Starter", monthlyPrice: 1499 }],
      calculateCart: () => ({
        subtotal: 1499,
        tax: 0,
        total: 1499,
        currency: "PHP",
        items: [{
          itemType: "pricing_plan", itemId: "starter", itemName: "Starter",
          billingFrequency: "monthly", unitPrice: 1499, quantity: 1, lineTotal: 1499
        }]
      }),
      paymentProviderForCountry: () => "paymongo",
      getPaymentProvider: () => paymentProvider
    }
  };
  delete require.cache[checkoutPath];
  const loaded = require(checkoutPath);

  return {
    ...loaded,
    state,
    restore() {
      delete require.cache[checkoutPath];
      if (previousDb) require.cache[dbPath] = previousDb;
      else delete require.cache[dbPath];
      if (previousPayments) require.cache[paymentsPath] = previousPayments;
      else delete require.cache[paymentsPath];
    }
  };
}

test("conversation checkout stores company separately from its representative and creates complete billing rows", async (t) => {
  const loaded = loadCheckoutLink();
  t.after(loaded.restore);

  const result = await loaded.createCheckoutLink({
    companyId: "aistaff",
    conversationId: "conversation-1",
    email: "joan@example.com",
    name: "Joan Ciar",
    companyName: "Word On The Go Online Fellowship Corp",
    mobile: "09761503035",
    planSlug: "starter",
    billingFrequency: "monthly"
  });

  assert.equal(result.ok, true);
  assert.equal(loaded.state.customer.full_name, "Joan Ciar");
  assert.equal(loaded.state.customer.company_name, "Word On The Go Online Fellowship Corp");
  assert.equal(loaded.state.customer.business_name, "Word On The Go Online Fellowship Corp");
  assert.equal(loaded.state.payment.status, "pending");
  assert.equal(loaded.state.subscription.pricing_plan_id, "plan-starter");
  assert.equal(loaded.state.subscription.status, "pending");
  assert.equal(loaded.state.invoice.status, "pending");
  assert.equal(loaded.state.paymentUpdate.provider_payment_id, "cs_paid_later");
});

test("conversation checkout refuses to create a representative-named tenant without a company", async (t) => {
  const loaded = loadCheckoutLink();
  t.after(loaded.restore);

  const result = await loaded.createCheckoutLink({
    companyId: "aistaff",
    email: "joan@example.com",
    name: "Joan Ciar",
    companyName: "",
    planSlug: "starter",
    billingFrequency: "monthly"
  });

  assert.deepEqual(result, { ok: false, reason: "missing_company_name" });
  assert.equal(loaded.state.customer, undefined);
});

test("both chat channels pass the captured company and provisioning stores the representative", () => {
  const src = (name) => fs.readFileSync(path.join(__dirname, "..", "src", name), "utf8");
  assert.match(src("server.js"), /companyName:\s*ai\.paymentRequest\.company\s*\|\|\s*updatedLead\.company_name/);
  assert.match(src("messenger-webhook.js"), /companyName:\s*ai\.paymentRequest\.company\s*\|\|\s*updatedLead\?\.company_name/);
  assert.match(src("provisioning.js"), /contact_person:\s*customer\.full_name\s*\|\|\s*null/);
});
