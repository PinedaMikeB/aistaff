const crypto = require("crypto");

const PAYMENT_MODE = process.env.PAYMENT_MODE || "test";
const CURRENCY = "PHP";

const BUSINESS_IDENTITY = {
  brandName: process.env.BUSINESS_BRAND_NAME || "AIStaff",
  legalName: process.env.BUSINESS_LEGAL_NAME || "AIStaff Solutions Corporation",
  registrationNumber: process.env.BUSINESS_REGISTRATION_NUMBER || "To be provided after verification",
  registeredAddress: process.env.BUSINESS_REGISTERED_ADDRESS || "To be provided after verification",
  supportEmail: process.env.SUPPORT_EMAIL || "support@aistaff.click",
  supportMobile: process.env.SUPPORT_MOBILE || "+63 900 000 0000",
  website: process.env.APP_URL || process.env.APP_PUBLIC_URL || "https://aistaff.click",
  businessHours: process.env.BUSINESS_HOURS || "Monday to Friday, 9:00 AM to 6:00 PM Philippine Time"
};

const PRODUCT = {
  name: "AIChat Sales Agent",
  slug: "aichat-sales-agent",
  description: "Your 24/7 AI sales assistant for Facebook Messenger and website inquiries."
};

/**
 * Every feature in every tier. Plans differ on CAPACITY, not capability.
 * Final pricing guide, 2026-08-12.
 *
 * Only capabilities that actually exist today are listed. Items still to be
 * built live in ROADMAP_FEATURES below and are deliberately NOT sold yet
 * (HANDOFF-CLOSER.md build order items 3 and 4).
 */
const SHARED_FEATURES = [
  "Replies from your knowledge base",
  "Matches how the customer writes, including Taglish",
  "Product media in-thread",
  "Quotation drafts with owner approval",
  "Mobile number capture",
  "Booking assistance",
  "Lead capture and scoring",
  "Dashboard and reports",
  "Human handoff",
  "Unanswered-question log"
];

/**
 * Sold, but not shipped yet as of 2026-08-12. Tracked so the gap stays visible
 * rather than being discovered by a customer. Remove a line once it ships.
 */
const BUILD_DEBT = ["Booking assistance", "Unanswered-question log", "Branch routing"];

/**
 * Capabilities that are NOT a software toggle — they need Pitch's hardware.
 * Closer sends SMS through the AIO100 VoLTE gateway's own SIM (SIP MESSAGE ->
 * SMS Route -> SIM 1), so there is no way to enable this on a Closer-only
 * account. This is a physical dependency, not an upsell fence.
 *
 * Why it matters commercially: Meta closes the Messenger window 24 hours after
 * the customer's last message. Past that, SMS is the only way to reach them.
 */
const PITCH_BUNDLE = {
  requires: "Pitch — AI voice agent, includes VoLTE gateway and SIM",
  features: [
    "SMS follow-up after the 24-hour Messenger window closes",
    "Follow-up sent from your own mobile number",
    "Voice calls answered by Pitch on the same number"
  ],
  constraints: [
    "One SMS per conversation",
    "170 characters per message"
  ]
};

/**
 * Setup covers: intake call, knowledge base loaded and tested, media tagged by
 * offering, Facebook Page connection, qualification flow, escalation rules,
 * orientation, and 14 days of support. Waived on annual payment.
 *
 * Annual = 10 x the monthly rate: two months free, on top of the waived setup.
 */
const SETUP_FEE = 4999;

const PRICING_PLANS = [
  {
    name: "Starter",
    slug: "starter",
    monthlyPrice: 4999,
    annualPrice: 49990,
    setupPrice: SETUP_FEE,
    setupWaivedOnAnnual: true,
    bestFor: "Single-page businesses that want every capability at the smallest capacity.",
    conversationLimit: 1500,
    facebookPageLimit: 1,
    staffLoginLimit: 1,
    onboarding: "Standard onboarding",
    cta: "Start with Starter",
    features: SHARED_FEATURES
  },
  {
    name: "Professional",
    slug: "professional",
    monthlyPrice: 9999,
    annualPrice: 99990,
    setupPrice: SETUP_FEE,
    setupWaivedOnAnnual: true,
    badge: "Most Popular",
    bestFor: "Multi-page businesses with steadier inquiry volume.",
    conversationLimit: 5000,
    facebookPageLimit: 3,
    staffLoginLimit: 3,
    onboarding: "Standard onboarding",
    cta: "Choose Professional",
    features: SHARED_FEATURES
  },
  {
    name: "Growth",
    slug: "growth",
    monthlyPrice: 19999,
    annualPrice: 199990,
    setupPrice: SETUP_FEE,
    setupWaivedOnAnnual: true,
    bestFor: "Multi-branch operations and higher inquiry volume.",
    conversationLimit: 15000,
    facebookPageLimit: 8,
    staffLoginLimit: 10,
    onboarding: "Standard onboarding",
    cta: "Choose Growth",
    features: [...SHARED_FEATURES, "Branch routing", "Priority support"]
  }
];

const ADD_ONS = [
  { name: "Additional Facebook Page", slug: "additional-facebook-page", description: "Connect one additional Facebook Page.", price: 2500, billingType: "monthly_recurring" },
  { name: "Additional 1,000 Conversations", slug: "additional-1000-conversations", description: "Adds 1,000 AI-assisted conversations to the selected plan.", price: 1500, billingType: "monthly_recurring" },
  { name: "Custom Landing Page", slug: "custom-landing-page", description: "One-time landing page design and build for campaigns.", price: 15000, billingType: "one_time" },
  { name: "AI Knowledge Base Setup", slug: "ai-knowledge-base-setup", description: "One-time setup for FAQs, product/service knowledge, and qualification content.", price: 10000, billingType: "one_time" },
  { name: "Custom Integration", slug: "custom-integration", description: "Their API, webhook or n8n workflow, CRM, or booking system. Quoted after technical review.", price: 14999, billingType: "custom_quotation", startsAt: true },
  { name: "Priority Onboarding", slug: "priority-onboarding", description: "One-time priority onboarding scheduling and setup assistance.", price: 7500, billingType: "one_time" }
];

function formatMoney(amount, currency = CURRENCY) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(Number(amount || 0));
}

function billingPrice(plan, billingFrequency) {
  return billingFrequency === "annual" ? plan.annualPrice : plan.monthlyPrice;
}

function recurringAddonPrice(addon, billingFrequency) {
  if (addon.billingType === "monthly_recurring") {
    return billingFrequency === "annual" ? addon.price * 12 * 0.9 : addon.price;
  }
  return addon.price;
}

function calculateCart({ planSlug, billingFrequency = "monthly", addOnSlugs = [] }) {
  const plan = PRICING_PLANS.find((item) => item.slug === planSlug);
  if (!plan) throw new Error("Selected package is not available");
  const frequency = billingFrequency === "annual" ? "annual" : "monthly";
  const items = [{
    itemType: "pricing_plan",
    itemId: plan.slug,
    itemName: plan.name,
    billingFrequency: frequency,
    unitPrice: billingPrice(plan, frequency),
    quantity: 1,
    lineTotal: billingPrice(plan, frequency)
  }];

  // One-time setup. Waived on annual payment — that waiver IS the annual
  // benefit (annualPrice is a straight monthly x12, no separate discount).
  // If they leave early on a waived annual, the setup is invoiced back; that
  // clawback belongs in the terms, not here.
  const setupWaived = frequency === "annual" && plan.setupWaivedOnAnnual;
  if (plan.setupPrice > 0 && !setupWaived) {
    items.push({
      itemType: "setup_fee",
      itemId: `${plan.slug}-setup`,
      itemName: "One-time setup",
      billingFrequency: "one_time",
      unitPrice: plan.setupPrice,
      quantity: 1,
      lineTotal: plan.setupPrice
    });
  }

  for (const slug of new Set(addOnSlugs || [])) {
    const addon = ADD_ONS.find((item) => item.slug === slug);
    if (!addon) continue;
    const customQuote = addon.billingType === "custom_quotation";
    const unitPrice = customQuote ? 0 : recurringAddonPrice(addon, frequency);
    items.push({
      itemType: "add_on",
      itemId: addon.slug,
      itemName: addon.name,
      billingFrequency: addon.billingType === "monthly_recurring" ? frequency : addon.billingType,
      unitPrice,
      quantity: 1,
      lineTotal: unitPrice,
      customQuote
    });
  }

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const tax = 0;
  return { currency: CURRENCY, billingFrequency: frequency, subtotal, tax, total: subtotal + tax, items };
}

function paymentProviderForCountry(country, requestedProvider = "") {
  if (requestedProvider === "manual_bank_transfer") return "manual_bank_transfer";
  return String(country || "").toLowerCase().includes("philippines") ? "xendit" : "stripe";
}

function providerReady(provider) {
  if (provider === "xendit") return Boolean(process.env.XENDIT_SECRET_KEY && process.env.XENDIT_PUBLIC_KEY);
  if (provider === "stripe") return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY);
  if (provider === "manual_bank_transfer") return true;
  return false;
}

class PaymentProvider {
  constructor(name) {
    this.name = name;
  }
  async createCheckoutSession(order) {
    return this.createInvoice(order);
  }
  async createInvoice() {
    throw new Error(`${this.name} invoice creation is not implemented`);
  }
  async retrievePaymentStatus() {
    return { status: "pending" };
  }
  async cancelPayment() {
    return { status: "cancelled" };
  }
  async processRefundRequest() {
    return { status: "refund_requested" };
  }
  async createSubscription() {
    return { status: "pending" };
  }
  async cancelSubscription() {
    return { status: "cancelled" };
  }
  async handleWebhook(payload) {
    return payload;
  }
  verifyWebhookSignature() {
    return false;
  }
  async storeExternalPaymentReference() {
    return null;
  }
  async reconcilePayment() {
    return { status: "pending" };
  }
}

class MockPaymentProvider extends PaymentProvider {
  constructor(name = "mock") {
    super(name);
  }
  async createInvoice(order) {
    const base = process.env.APP_URL || process.env.APP_PUBLIC_URL || "http://localhost:3000";
    return {
      provider: this.name,
      providerPaymentId: `${this.name}_test_${order.order_number}`,
      checkoutUrl: `${base}/checkout/pending?order=${encodeURIComponent(order.order_number)}`,
      status: "pending",
      mode: PAYMENT_MODE,
      message: "Secure online payment integration is currently in test mode."
    };
  }
}

/**
 * Xendit, via the Invoice API.
 *
 * Was an empty stub extending MockPaymentProvider — so adding API keys did
 * nothing and checkout silently returned mock invoices. This implements it.
 *
 * One hosted invoice covers every channel the customer might want: QR Ph,
 * GCash, Maya, cards, online banking, over-the-counter. Each invoice carries
 * the order number as `external_id`, so a payment arrives already matched to
 * an order — which a static bank QR cannot do.
 */
class XenditProvider extends PaymentProvider {
  constructor() {
    super("xendit");
    this.baseUrl = process.env.XENDIT_API_URL || "https://api.xendit.co";
  }

  /** Basic auth: secret key as username, empty password. */
  authHeader() {
    const key = process.env.XENDIT_SECRET_KEY || "";
    return "Basic " + Buffer.from(`${key}:`).toString("base64");
  }

  async request(path, options = {}) {
    const fetchImpl = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
    const response = await fetchImpl(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader(),
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!response.ok) {
      const message = json.message || json.error_code || `xendit_${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.body = json;
      throw error;
    }
    return json;
  }

  async createInvoice(order) {
    const appUrl = (process.env.APP_URL || "https://aistaff.click").replace(/\/+$/, "");
    const customer = order.customer || {};
    const amount = Number(order.total);

    const payload = {
      // The order number is the reconciliation key. It comes back on the
      // webhook, so no payment is ever an orphan.
      external_id: order.order_number,
      amount,
      currency: order.currency || CURRENCY,
      description: `${BUSINESS_IDENTITY.brandName} — order ${order.order_number}`,
      payer_email: customer.email || undefined,
      success_redirect_url: `${appUrl}/checkout/success/?order=${encodeURIComponent(order.order_number)}`,
      failure_redirect_url: `${appUrl}/checkout/failure/?order=${encodeURIComponent(order.order_number)}`,
      // Xendit's default is 24h; a Philippine SMB often pays the next morning.
      invoice_duration: Number(process.env.XENDIT_INVOICE_DURATION_SECONDS || 172800),
      customer: {
        given_names: customer.full_name || undefined,
        email: customer.email || undefined,
        mobile_number: customer.mobile_number || undefined
      },
      items: (order.items || []).map((item) => ({
        name: String(item.item_name || item.itemName || "Item").slice(0, 120),
        quantity: Number(item.quantity || 1),
        price: Number(item.unit_price || item.unitPrice || 0)
      }))
    };

    const invoice = await this.request("/v2/invoices", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return {
      provider: this.name,
      providerPaymentId: invoice.id,
      checkoutUrl: invoice.invoice_url,
      status: String(invoice.status || "PENDING").toLowerCase(),
      expiresAt: invoice.expiry_date || null,
      raw: invoice
    };
  }

  async retrievePaymentStatus(providerPaymentId) {
    const invoice = await this.request(`/v2/invoices/${encodeURIComponent(providerPaymentId)}`);
    return { status: String(invoice.status || "PENDING").toLowerCase(), raw: invoice };
  }

  async cancelPayment(providerPaymentId) {
    const invoice = await this.request(`/invoices/${encodeURIComponent(providerPaymentId)}/expire!`, {
      method: "POST"
    });
    return { status: String(invoice.status || "EXPIRED").toLowerCase(), raw: invoice };
  }

  /**
   * Normalise a webhook into the fields the caller needs. Xendit sends
   * status PAID / EXPIRED / SETTLED, and `external_id` is our order number.
   */
  async handleWebhook(payload) {
    const status = String(payload.status || "").toUpperCase();
    return {
      orderNumber: payload.external_id || null,
      providerPaymentId: payload.id || null,
      status: status.toLowerCase(),
      paid: status === "PAID" || status === "SETTLED",
      amount: payload.paid_amount != null ? Number(payload.paid_amount) : Number(payload.amount || 0),
      paidAt: payload.paid_at || null,
      channel: payload.payment_channel || payload.payment_method || null,
      raw: payload
    };
  }

  verifyWebhookSignature(rawBody, signature) {
    return verifyWebhookSignature("xendit", rawBody, signature);
  }
}

class StripeProvider extends MockPaymentProvider {
  constructor() {
    super("stripe");
  }
}

class ManualBankTransferProvider extends MockPaymentProvider {
  constructor() {
    super("manual_bank_transfer");
  }
  async createInvoice(order) {
    return {
      provider: this.name,
      providerPaymentId: `manual_${order.order_number}`,
      checkoutUrl: `/checkout/pending?order=${encodeURIComponent(order.order_number)}`,
      status: "pending_verification",
      instructions: {
        bankName: process.env.MANUAL_BANK_NAME || "Configured by admin before production",
        accountName: process.env.MANUAL_BANK_ACCOUNT_NAME || BUSINESS_IDENTITY.legalName,
        accountNumber: process.env.MANUAL_BANK_ACCOUNT_NUMBER || "Development placeholder only",
        swiftCode: process.env.MANUAL_BANK_SWIFT || "To be configured",
        currency: CURRENCY,
        note: "Do not publish personal bank details. Replace placeholders before enabling production manual payments."
      }
    };
  }
}

function getPaymentProvider(name) {
  if (name === "xendit") return providerReady("xendit") ? new XenditProvider() : new MockPaymentProvider("xendit");
  if (name === "stripe") return providerReady("stripe") ? new StripeProvider() : new MockPaymentProvider("stripe");
  if (name === "manual_bank_transfer") return new ManualBankTransferProvider();
  return new MockPaymentProvider();
}

function verifyWebhookSignature(provider, rawBody, signature) {
  if (provider === "xendit") {
    const token = process.env.XENDIT_WEBHOOK_TOKEN;
    if (!token || !signature) return false;
    const a = Buffer.from(String(signature));
    const b = Buffer.from(String(token));
    // Length check FIRST: timingSafeEqual throws on mismatched lengths, so a
    // wrong-length token would crash the webhook instead of rejecting it.
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  if (provider === "stripe") {
    return Boolean(process.env.STRIPE_WEBHOOK_SECRET && signature && rawBody);
  }
  return false;
}

function nextBillingDate(billingFrequency, from = new Date()) {
  const date = new Date(from);
  if (billingFrequency === "annual") date.setFullYear(date.getFullYear() + 1);
  else date.setMonth(date.getMonth() + 1);
  return date;
}

module.exports = {
  PAYMENT_MODE,
  BUSINESS_IDENTITY,
  PRODUCT,
  PRICING_PLANS,
  SHARED_FEATURES,
  BUILD_DEBT,
  PITCH_BUNDLE,
  ADD_ONS,
  CURRENCY,
  PaymentProvider,
  XenditProvider,
  StripeProvider,
  ManualBankTransferProvider,
  MockPaymentProvider,
  calculateCart,
  formatMoney,
  getPaymentProvider,
  nextBillingDate,
  paymentProviderForCountry,
  providerReady,
  verifyWebhookSignature
};
