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

const PRICING_PLANS = [
  {
    name: "Starter",
    slug: "starter",
    monthlyPrice: 4999,
    annualPrice: 53989,
    bestFor: "Small businesses that want automated replies and lead collection.",
    conversationLimit: 1500,
    facebookPageLimit: 1,
    onboarding: "Standard onboarding",
    cta: "Start with Starter",
    features: [
      "1 Facebook Page integration",
      "Website chat widget",
      "24/7 automated customer replies",
      "Lead name, contact number, and email collection",
      "Basic lead qualification",
      "Frequently asked questions setup",
      "Product or service knowledge setup",
      "Basic conversation history",
      "Lead dashboard",
      "Hot, warm, and cold lead classification",
      "Basic monthly report",
      "Up to 1,500 AI-assisted conversations per month",
      "Email support",
      "Standard onboarding"
    ]
  },
  {
    name: "Growth",
    slug: "growth",
    monthlyPrice: 24999,
    annualPrice: 269989,
    badge: "Most Popular",
    bestFor: "Growing businesses that need qualification, follow-up, and sales support.",
    conversationLimit: 8000,
    facebookPageLimit: 3,
    onboarding: "Guided onboarding and setup",
    cta: "Choose Growth",
    features: [
      "Everything in Starter",
      "Up to 3 Facebook Pages",
      "Multiple website chat widgets",
      "Advanced lead qualification",
      "Automated follow-up sequences",
      "Quotation request handling",
      "Owner approval before sending quotations",
      "Appointment and booking assistance",
      "CRM-style lead pipeline",
      "Lead assignment to staff",
      "Lead notes and tags",
      "Custom sales scripts",
      "Customer conversation summaries",
      "Weekly performance report",
      "Up to 8,000 AI-assisted conversations per month",
      "Priority support",
      "Guided onboarding and setup"
    ]
  },
  {
    name: "Scale",
    slug: "scale",
    monthlyPrice: 59999,
    annualPrice: 647989,
    bestFor: "Companies managing larger inquiry volumes, several teams, or multiple branches.",
    conversationLimit: 25000,
    facebookPageLimit: 10,
    onboarding: "Dedicated onboarding specialist",
    cta: "Choose Scale",
    features: [
      "Everything in Growth",
      "Up to 10 Facebook Pages",
      "Multi-branch support",
      "Multiple departments or sales teams",
      "Advanced sales automation",
      "Custom lead routing",
      "Staff roles and permissions",
      "API and webhook access",
      "Custom CRM integration",
      "Advanced reports and analytics",
      "Sales team performance dashboard",
      "Automated customer re-engagement",
      "Custom approval workflows",
      "Up to 25,000 AI-assisted conversations per month",
      "Priority technical support",
      "Dedicated onboarding specialist",
      "Quarterly automation review"
    ]
  }
];

const ADD_ONS = [
  { name: "Additional Facebook Page", slug: "additional-facebook-page", description: "Connect one additional Facebook Page.", price: 2500, billingType: "monthly_recurring" },
  { name: "Additional 1,000 Conversations", slug: "additional-1000-conversations", description: "Adds 1,000 AI-assisted conversations to the selected plan.", price: 1500, billingType: "monthly_recurring" },
  { name: "Custom Landing Page", slug: "custom-landing-page", description: "One-time landing page design and build for campaigns.", price: 15000, billingType: "one_time" },
  { name: "AI Knowledge Base Setup", slug: "ai-knowledge-base-setup", description: "One-time setup for FAQs, product/service knowledge, and qualification content.", price: 10000, billingType: "one_time" },
  { name: "Custom CRM Integration", slug: "custom-crm-integration", description: "Custom integration quoted after technical review.", price: 25000, billingType: "custom_quotation", startsAt: true },
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

class XenditProvider extends MockPaymentProvider {
  constructor() {
    super("xendit");
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
    return Boolean(token && signature && crypto.timingSafeEqual(Buffer.from(String(signature)), Buffer.from(token)));
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
