/**
 * Closer creating a payment link inside a Messenger conversation.
 *
 * WHY A LINK: the customer never leaves the app they are in. One tap, pay in
 * their wallet, done. A QR image cannot be scanned on the phone displaying it;
 * a bank transfer means switching apps, typing an amount, screenshotting, and
 * waiting for a human to confirm. Every alternative adds a step at the exact
 * moment someone has decided to buy.
 *
 * ATTRIBUTION IS AUTOMATIC: the PayMongo checkout session carries our order
 * number as reference_number, so the webhook says which order was paid without
 * anyone matching payments to people by hand.
 *
 * ONE OPEN ORDER PER CONVERSATION. Asking twice returns the SAME link. This is
 * the rule that prevents the duplicate-order failure (AS-20260813-955B98), and
 * it matters far more now that a model can trigger checkout.
 */

const { prisma } = require("./db");
const { calculateCart, getPaymentProvider, paymentProviderForCountry, AVAILABLE_PLANS } = require("./payments");

const REUSE_WINDOW_HOURS = 24;

/** Does this conversation already have an unpaid order we should reuse? */
async function findOpenOrder(companyId, email) {
  if (!email) return null;
  const since = new Date(Date.now() - REUSE_WINDOW_HOURS * 60 * 60 * 1000);
  return prisma.order.findFirst({
    where: {
      payment_status: "pending",
      created_at: { gte: since },
      customer: { email }
    },
    orderBy: { created_at: "desc" },
    include: { customer: true }
  });
}

function planFor(slug) {
  return AVAILABLE_PLANS.find((p) => p.slug === slug) || AVAILABLE_PLANS[0];
}

/**
 * Create (or reuse) a checkout link for someone in a conversation.
 *
 * Returns a plain object of FACTS — url, amount, plan, saving. The model
 * writes the sentence that carries it, so the closing line is never canned.
 */
async function createCheckoutLink({ companyId, email, name, mobile, planSlug, billingFrequency, conversationId }) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return { ok: false, reason: "invalid_email" };
  }

  const frequency = billingFrequency === "annual" ? "annual" : "monthly";
  const plan = planFor(planSlug);

  // Reuse before creating. Two links for one buyer means two orders, two
  // payments to reconcile, and a refund conversation.
  const existing = await findOpenOrder(companyId, cleanEmail);
  if (existing?.external_checkout_url && existing.billing_frequency === frequency) {
    if (conversationId && !existing.source_conversation_id) {
      await prisma.order.update({
        where: { id: existing.id },
        data: { source_conversation_id: conversationId }
      });
    }
    return {
      ok: true, reused: true,
      url: existing.external_checkout_url,
      orderNumber: existing.order_number,
      amount: Number(existing.total),
      currency: existing.currency,
      billingFrequency: existing.billing_frequency
    };
  }

  const cart = calculateCart({ planSlug: plan.slug, billingFrequency: frequency });
  const provider = paymentProviderForCountry("Philippines");
  const orderNumber = `AS-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  /**
   * Customer lookup happens OUTSIDE the transaction.
   *
   * It was inside, and on a cold connection the lookup plus insert exceeded
   * Prisma's 5s interactive-transaction limit — so the very first payment link
   * of the day would fail while later ones worked. Raising the timeout would
   * have hidden that; the real fix is to do less inside the transaction. Only
   * the order and its items need to be atomic — a customer row created without
   * an order is harmless and gets reused next time.
   */
  let customer = await prisma.customer.findFirst({
    where: { email: cleanEmail },
    orderBy: { created_at: "desc" }
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        full_name: name || cleanEmail.split("@")[0],
        email: cleanEmail,
        mobile_number: mobile || "not provided",
        billing_address: "To be provided",
        city: "-", province: "-", postal_code: "-", country: "Philippines"
      }
    });
  }

  const order = await prisma.order.create({
    data: {
      order_number: orderNumber,
      customer_id: customer.id,
      subtotal: cart.subtotal,
      tax: cart.tax,
      total: cart.total,
      currency: cart.currency,
      billing_frequency: frequency,
      payment_provider: provider,
      payment_status: "pending",
      order_status: "awaiting_payment",
      source_conversation_id: conversationId || null,
      items: {
        create: cart.items.map((item) => ({
          item_type: item.itemType, item_id: item.itemId, item_name: item.itemName,
          quantity: 1, unit_price: item.lineTotal, line_total: item.lineTotal,
          billing_frequency: frequency
        }))
      }
    },
    include: { items: true }
  });

  const invoice = await getPaymentProvider(provider).createInvoice({
    order_number: order.order_number,
    plan_name: plan.name,
    total_amount: Number(order.total),
    customer_email: customer.email,
    customer_name: customer.full_name,
    items: order.items.map((i) => ({ itemName: i.item_name, quantity: i.quantity, unitPrice: Number(i.unit_price) }))
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { external_payment_id: invoice.providerPaymentId, external_checkout_url: invoice.checkoutUrl }
  });

  console.log("[checkout] %s %s %s %s for %s (conversation=%s)",
    order.order_number, plan.slug, frequency, order.total, cleanEmail, conversationId);

  const monthlyEquivalent = frequency === "annual" ? Math.round(Number(order.total) / 12) : Number(order.total);
  const regularYear = plan.monthlyPrice * 12;

  return {
    ok: true, reused: false,
    url: invoice.checkoutUrl,
    orderNumber: order.order_number,
    amount: Number(order.total),
    currency: order.currency,
    billingFrequency: frequency,
    planName: plan.name,
    monthlyEquivalent,
    saving: frequency === "annual" ? regularYear - Number(order.total) : 0
  };
}

module.exports = { createCheckoutLink, findOpenOrder };
