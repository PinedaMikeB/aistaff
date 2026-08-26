require("dotenv").config({ override: true });

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const { z } = require("zod");

const { prisma } = require("./db");
const { encryptSecret, decryptSecret } = require("./crypto");
const {
  verifyPassword,
  signSession,
  requireAuth,
  attachUserIfPresent,
  setSessionCookie,
  clearSessionCookie
} = require("./auth");
const { generateSalesReply, quotationReady } = require("./ai");
const { verifyMessengerSignature, handleMessengerWebhook, sendMessengerText } = require("./messenger-webhook");
const { generateAistaffDemoReply, getAistaffSession } = require("./aistaff-demo");
const {
  loadAistaffAiConfig,
  clearAistaffAiConfigCache,
  getMessengerMemoryForPsid,
  buildAdminPromptPreview,
  DEFAULT_AI_GOAL
} = require("./aistaff-ai-config");

/**
 * The AIStaff tenant — the workspace that owns the Facebook Page, the
 * knowledge base and the conversations.
 *
 * Was AIS-2026-0002 "AIStaff Internal", which meant the SITE CHAT WIDGET and
 * the FACEBOOK PAGE answered from two different knowledge bases. The comment
 * that used to sit here claimed they shared rows; that was false. Repointed to
 * AIS-2026-0001 on 2026-08-19 and 0002 retired.
 */
const AISTAFF_INTERNAL_COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const { buildPresenceSnapshot, formatSnapshotForMessenger } = require("./page-intelligence");
const { provisionPaidOrder, issueSetupLink } = require("./provisioning");
const { extractPriceList, MAX_BYTES } = require("./price-list-extract");
const { detectCurrency } = require("./rendered-scrape");
const {
  getMarketingOverview,
  listCreatives,
  updateChecklistItem,
  updateAdReview,
  updateMarketingNotes,
  renderCreative,
  renderPreviewStill,
  generateVoiceover,
  getRenderJobs,
  getRenderStatus,
  getLatestJobForComposition
} = require("./marketing");
const {
  PAYMENT_MODE,
  BUSINESS_IDENTITY,
  PRODUCT,
  PRICING_PLANS,
  AVAILABLE_PLANS,
  ADD_ONS,
  AVAILABLE_ADD_ONS,
  calculateCart,
  getPaymentProvider,
  nextBillingDate,
  paymentProviderForCountry,
  providerReady,
  verifyWebhookSignature
} = require("./payments");
const { createCheckoutLink } = require("./checkout-link");
const { stepsForPack, suggestPack, INDUSTRY_PACKS, VALIDITY_OPTIONS } = require("./intake-steps");
/** Words per knowledge base entry. Sent to the client so the counter and the
 *  server enforce exactly the same number — two copies drift. */
const INTAKE_WORD_LIMIT = 3000;
/** Words allowed in an entry's title. Generous on purpose — people describe
 *  rather than label, and rejecting a whole save over a long label is the
 *  wrong trade. Enforced in words to match the answer field. */
const INTAKE_TITLE_WORD_LIMIT = 100;
const { checkRelevance, structureRows } = require("./intake-relevance");
const { normaliseLinks } = require("./knowledge-base");
const { saveMedia, deleteMedia } = require("./media-store");
const { getCloserHealth } = require("./closer-health");
const { normaliseRole, can, requirePermission, ROLES, PERMISSIONS } = require("./platform-roles");
const { listCustomers } = require("./platform");
const { getActiveInstructions, saveRevision, activateRevision, listRevisions, CLOSER_SYSTEM_KEY, DEMO_PAGE_SYSTEM_KEY } = require("./prompt-store");
const { listSettings, setModelFor, CATALOGUE: MODEL_CATALOGUE } = require("./model-registry");
const { generateFaqCheck, generateQualificationQuestions, LEAD_FIELDS } = require("./faq-generator");
const { notifyHandoff, notifySetupMilestone, notifyGapDigest, notifyConfigured, notifyBookingCreated, sendNotification, FROM_ADDRESS } = require("./notify");
const { AnalyzeRequestSchema, WebsiteBusinessAnalysisSchema } = require("./brandee/schemas");
const { WebsiteAnalysisError, normalizeUrlInput } = require("./brandee/websiteAnalyzer");
const { buildBusinessProfile } = require("./brandee/businessProfileBuilder");
const { generateCreativePlan } = require("./brandee/planner");
const { enrichBusinessAnalysisWithAi } = require("./brandee/extraction");
const { getExtractionConfig, getPlannerConfig } = require("./brandee/modelConfig");
const { BrandeeError, toBrandeeError } = require("./brandee/errors");
const { savePlan, getPlan } = require("./brandee/store");
const { recordRun: recordBrandeeRun, listRuns: listBrandeeRuns, getRunStats: getBrandeeRunStats } = require("./admin/brandeeRunLog");
const { ImageAdRequestSchema, VideoAdRequestSchema, ProductUrlExtractRequestSchema, AnalyzeProductRequestSchema, FieldAssistRequestSchema, hasRealTestimonial, describeZodError } = require("./brandee/productAdSchemas");
const { listAvailableTemplates, getImageAdTemplate, isTemplateAvailable } = require("./brandee/imageAdTemplates");
const { listVideoAdStyles, getVideoAdStyle, HOOK_PREFERENCES, TONES, CREATOR_TYPES, SETTINGS } = require("./brandee/videoAdStyles");
const { listPlans: listBrandeePlans, getPlan: getBrandeePlan, ANONYMOUS_LIMITS: BRANDEE_ANON_LIMITS, PRICING_QUANTITIES_ARE_PLACEHOLDERS } = require("./brandee/pricingConfig");
const { validateImageDataUrl } = require("./brandee/mediaValidation");
const { extractProductFromUrl } = require("./brandee/productUrlExtractor");
const { analyzeProduct, generateFieldAssist } = require("./brandee/productAnalysisService");
const { renderImageAdSvg, renderGeneratedAdSvg, readPngDimensions, buildAdContent } = require("./brandee/imageAdRenderer");
const { getAspectRatio, AD_ASPECT_RATIOS, DEFAULT_ASPECT_RATIO } = require("./brandee/adAspectRatios");
const { probeVideoProviderAvailability, generateVideoTeaser, generateFinalVideo } = require("./brandee/videoTeaserRenderer");
const productAdProjectStore = require("./brandee/productAdProjectStore");
const { registerAccount, RegistrationError } = require("./brandee/accountRegistration");
const { ensureBrandeeProductAdsCatalog, subscribeUserToPlan, getActiveBrandeeSubscriptionForUser, requireBrandeeSubscription } = require("./brandee/productAdBilling");
const { track: trackBrandeeEvent } = require("./brandee/analyticsEvents");
const templateCatalog = require("./brandee/templateCatalog");
const pricingOverride = require("./brandee/pricingOverride");
const entitlements = require("./brandee/entitlements");
const { ENTITLEMENT_UNITS, computeComboSavings, PRICING_NOTE } = require("./brandee/pricingConfig");
const { buildCreativePlan, interpretRevision, sanitizeCustomerFacingPlan, composeImagePrompt } = require("./brandee/creativePlanner");
const { recommendTemplates } = require("./brandee/templateRecommender");
const { probeImageProviderAvailability, generatePreviewImage, editPreviewImage } = require("./brandee/imageGenProvider");
const { getCreativeBrainStatus, validateAllResources, RESOURCE_VALIDATORS } = require("./admin/creativeBrain");
const systemStatus = require("./admin/systemStatus");
const { recordAuditEvent, listAuditLogs, AUDIT_ACTIONS } = require("./admin/auditLog");
const { createRateLimiter } = require("./admin/rateLimit");
const {
  PLATFORM_ROLES,
  ALL_ADMIN_ROLES,
  ADMIN_ERROR_CODES,
  requireSuperAdminApi,
  requireSuperAdminPage,
  isLastActiveSuperadmin,
  countActiveSuperadmins
} = require("./adminAuth");
const { mountSuperAdminPages } = require("./admin/pages");

const app = express();
const port = Number(process.env.APP_PORT || 3000);
const metaVerifyToken = process.env.META_VERIFY_TOKEN || "aistaff_verify_2026";
const metaOauthStates = new Map();
const metaAuthorizedPagesByUser = new Map();

function looksTaglish(text) {
  return /\b(po|ba|naman|kayo|ninyo|ko|kami|magpa|pwede|gusto|kailangan|salamat|sige)\b/i.test(String(text || ""));
}

async function notifyMessengerPaymentConfirmed(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      source_conversation: {
        include: {
          facebook_page: true,
          messages: { orderBy: { created_at: "desc" }, take: 8 }
        }
      }
    }
  });

  const conversation = order?.source_conversation;
  const page = conversation?.facebook_page;
  if (!order || !conversation?.psid || !page) return { ok: false, reason: "no_source_conversation" };

  const customerText = [...(conversation.messages || [])]
    .filter((m) => m.sender_type === "customer")
    .map((m) => m.message_text)
    .join("\n");
  const taglish = looksTaglish(customerText);
  const firstName = String(order.customer?.full_name || "").trim().split(/\s+/)[0] || "";
  const namePart = firstName ? `${firstName}, ` : "";

  const text = taglish
    ? [
      `Payment confirmed na, ${namePart}thank you! Ginagawa na namin ang AIStaff workspace mo at nag-email na kami ng login/setup instructions.`,
      "",
      "Pwede kang mag-reply dito o sa email kung anong araw at oras mo gustong magpa-assist sa setup.",
      "",
      "Kung gusto mong kami na ang tumulong mag-set up para makatipid ka sa oras, send mo lang: products/services, prices/packages, promos, FAQs, files/photos, payment or booking rules, policies, qualification questions, at kailan kailangan mag-confirm ang staff."
    ].join("\n")
    : [
      `Payment confirmed, ${namePart}thank you! We are preparing your AIStaff workspace and emailed your login/setup instructions.`,
      "",
      "You can reply here or by email with your preferred setup day and time if you want onboarding assistance.",
      "",
      "If you want us to save you time and help set up Closer for you, send your products/services, prices/packages, promos, FAQs, files/photos, payment or booking rules, policies, qualification questions, and when staff should confirm details."
    ].join("\n");

  await sendMessengerText(page, conversation.psid, text);
  await prisma.message.create({
    data: {
      company_id: conversation.company_id,
      conversation_id: conversation.id,
      sender_type: "ai",
      sender_id: "ai_sales_assistant",
      message_text: text,
      ai_generated: true
    }
  });
  return { ok: true };
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));

function messengerWebhookVerify(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === metaVerifyToken) {
    return res.status(200).type("text/plain").send(String(challenge || ""));
  }
  return res.sendStatus(403);
}

function messengerWebhookReceive(req, res) {
  if (!verifyMessengerSignature(req.rawBody, req.get("X-Hub-Signature-256"))) {
    console.warn("Rejected Messenger webhook with invalid signature");
    return res.sendStatus(403);
  }

  let payload;
  try {
    payload = JSON.parse(req.rawBody.toString("utf8"));
  } catch {
    return res.sendStatus(400);
  }

  console.log("Incoming Messenger webhook payload:", JSON.stringify(payload, null, 2));
  res.sendStatus(200);

  handleMessengerWebhook(payload, { maybeCreateQuotationDraft }).catch((error) => {
    console.error("Messenger webhook processing failed:", error);
  });
}

app.get("/api/webhooks/messenger", messengerWebhookVerify);
app.post("/api/webhooks/messenger", express.raw({ type: "application/json", limit: "1mb" }), (req, res, next) => {
  req.rawBody = req.body;
  next();
}, messengerWebhookReceive);

app.get("/webhooks/meta/messenger", messengerWebhookVerify);
app.post("/webhooks/meta/messenger", express.raw({ type: "application/json", limit: "1mb" }), (req, res, next) => {
  req.rawBody = req.body;
  next();
}, messengerWebhookReceive);

/**
 * PayMongo webhook. Raw body required — the signature is computed over the
 * exact bytes, so any JSON re-serialisation breaks verification.
 *
 * This is the step that turns money into an account: it marks the order paid,
 * which fires provisionPaidOrder() and the set-your-password email that
 * already work.
 */
app.post("/api/webhooks/paymongo", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => {
  processPaymentWebhook("paymongo", req, res).catch((error) => {
    console.error("PayMongo webhook failed:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  });
});

app.post("/api/webhooks/xendit", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => {
  processPaymentWebhook("xendit", req, res).catch((error) => {
    console.error("Xendit webhook failed:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  });
});

app.post("/api/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => {
  processPaymentWebhook("stripe", req, res).catch((error) => {
    console.error("Stripe webhook failed:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  });
});

// Brandee product-ad routes accept base64 product images in the JSON body,
// larger than the app-wide 1MB limit below — this path-scoped parser must
// be registered BEFORE the general one so it runs first for these two path
// prefixes; body-parser skips re-parsing a request whose body it already
// parsed, so the general 1MB limit never truncates/rejects these requests.
app.use(["/api/public/brandee/product-ads", "/api/brandee/product-ads"], express.json({ limit: "24mb" }));

// Price lists arrive base64-encoded, so they need headroom above the 1mb
// default. Scoped to this one route, same pattern as the Brandee line above.
app.use("/api/public/demo/price-list", express.json({ limit: "12mb" }));
// The wizard's upload route needs the same headroom as the demo's price-list
// route. Without this it fell through to the 1mb global limit below and every
// real phone photo failed with "request entity too large" — Express rejecting
// the body before the handler ever ran, so MAX_BYTES never got a say.
// 12mb of JSON covers an 8mb file, since base64 inflates by about a third.
app.use("/api/intake/extract", express.json({ limit: "12mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// Public Brandee routes must RECOGNIZE a logged-in customer (to skip the
// anonymous free-preview limit and attribute projects to their account)
// without REQUIRING login. Must come after cookieParser.
app.use("/api/public/brandee", attachUserIfPresent);
app.use(morgan("dev"));
app.use(express.static(path.join(__dirname, "..", "public"), {
  setHeaders(res, filePath) {
    // intake-wizard.js added 2026-08-17. Without it the file was served with
    // max-age=14400, so wizard fixes did not reach the browser for four hours
    // and looked like they had not been applied.
    if (filePath.endsWith("app.js") || filePath.endsWith("index.html") || filePath.endsWith("style.css") || filePath.endsWith("pricing-checkout.js") || filePath.endsWith("checkout-status.js") || filePath.endsWith("meta-pixel.js") || filePath.endsWith("workforce-motion.js") || filePath.endsWith("site-chat.js") || filePath.endsWith("intake-wizard.js") || filePath.endsWith("closer-status.js") || filePath.endsWith("platform.js")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));
app.use("/marketing-assets", express.static(path.join(__dirname, "..", "remotion", "out")));
app.use("/marketing-assets", express.static(path.join(__dirname, "..", "remotion", "public")));

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function getAppUrl(req) {
  return (process.env.APP_PUBLIC_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

function slugForPublicRoom(value) {
  return String(value || "meeting")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[-\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .toLowerCase() || "meeting";
}

function buildJitsiMeetingLink(companyName, startAt) {
  const stamp = new Date(startAt).toISOString().replace(/[-:]/g, "").slice(0, 13);
  const suffix = crypto.randomBytes(3).toString("hex");
  return `https://meet.jit.si/aistaff-closer-${slugForPublicRoom(companyName)}-${stamp}-${suffix}`;
}

function formatManilaSchedule(value) {
  return new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila"
  });
}

function parseManilaDateTime(dateValue, timeValue) {
  const date = String(dateValue || "").trim();
  const time = String(timeValue || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const parsed = new Date(`${date}T${time}:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getMetaRedirectUri(req) {
  return `${getAppUrl(req)}/api/meta/facebook/callback`;
}

function pruneExpiredMetaAuth() {
  const now = Date.now();
  for (const [state, auth] of metaOauthStates.entries()) {
    if (auth.expiresAt <= now) metaOauthStates.delete(state);
  }
  for (const [userId, auth] of metaAuthorizedPagesByUser.entries()) {
    if (auth.expiresAt <= now) metaAuthorizedPagesByUser.delete(userId);
  }
}

function setMetaAuthForUser(userId, value) {
  pruneExpiredMetaAuth();
  metaAuthorizedPagesByUser.set(userId, {
    ...value,
    expiresAt: Date.now() + (15 * 60 * 1000)
  });
}

function getMetaAuthForUser(userId) {
  pruneExpiredMetaAuth();
  return metaAuthorizedPagesByUser.get(userId) || null;
}

function facebookConnectionPath(params = {}) {
  const query = new URLSearchParams(params);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return `/admin/settings/facebook-page-connection${suffix}`;
}

function sanitizeManagedPage(page) {
  return {
    id: page.id,
    name: page.name,
    category: page.category || "",
    tasks: Array.isArray(page.tasks) ? page.tasks : []
  };
}

function publicCompanySelect() {
  return {
    id: true,
    name: true,
    contact_person: true,
    industry: true,
    website: true,
    contact_email: true,
    contact_number: true,
    status: true,
    created_at: true,
    updated_at: true
  };
}

async function getDefaultCompanyId() {
  const company = await prisma.company.findFirst({ where: { status: "active" }, orderBy: { created_at: "asc" } });
  if (!company) throw new Error("No active company found. Run npm run seed first.");
  return company.id;
}

function requireFinance(req, res, next) {
  if (!["admin", "finance", "owner"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Finance permission required" });
  }
  next();
}

function decimalNumber(value) {
  return Number(value || 0);
}

function serializeCart(cart) {
  return {
    ...cart,
    subtotal: decimalNumber(cart.subtotal),
    tax: decimalNumber(cart.tax),
    total: decimalNumber(cart.total),
    items: (cart.items || []).map((item) => ({
      ...item,
      unit_price: decimalNumber(item.unit_price),
      line_total: decimalNumber(item.line_total)
    }))
  };
}

function serializeOrder(order) {
  return {
    ...order,
    subtotal: decimalNumber(order.subtotal),
    tax: decimalNumber(order.tax),
    total: decimalNumber(order.total),
    items: (order.items || []).map((item) => ({
      ...item,
      unit_price: decimalNumber(item.unit_price),
      line_total: decimalNumber(item.line_total)
    })),
    payments: (order.payments || []).map((payment) => ({
      ...payment,
      amount: decimalNumber(payment.amount)
    })),
    subscriptions: (order.subscriptions || []).map((subscription) => ({
      ...subscription,
      amount: decimalNumber(subscription.amount)
    })),
    invoices: (order.invoices || []).map((invoice) => ({
      ...invoice,
      amount: decimalNumber(invoice.amount)
    }))
  };
}

async function ensurePricingCatalog() {
  const product = await prisma.product.upsert({
    where: { slug: PRODUCT.slug },
    update: {
      name: PRODUCT.name,
      description: PRODUCT.description,
      status: "active"
    },
    create: {
      name: PRODUCT.name,
      slug: PRODUCT.slug,
      description: PRODUCT.description,
      status: "active"
    }
  });

  await Promise.all(PRICING_PLANS.map((plan) => prisma.pricingPlan.upsert({
    where: { slug: plan.slug },
    update: {
      product_id: product.id,
      name: plan.name,
      monthly_price: plan.monthlyPrice,
      annual_price: plan.annualPrice,
      currency: "PHP",
      conversation_limit: plan.conversationLimit,
      facebook_page_limit: plan.facebookPageLimit,
      features: plan.features,
      active: true
    },
    create: {
      product_id: product.id,
      name: plan.name,
      slug: plan.slug,
      monthly_price: plan.monthlyPrice,
      annual_price: plan.annualPrice,
      currency: "PHP",
      conversation_limit: plan.conversationLimit,
      facebook_page_limit: plan.facebookPageLimit,
      features: plan.features,
      active: true
    }
  })));

  await Promise.all(ADD_ONS.map((addon) => prisma.addOn.upsert({
    where: { slug: addon.slug },
    update: {
      name: addon.name,
      description: addon.description,
      price: addon.price,
      currency: "PHP",
      billing_type: addon.billingType,
      active: true
    },
    create: {
      name: addon.name,
      slug: addon.slug,
      description: addon.description,
      price: addon.price,
      currency: "PHP",
      billing_type: addon.billingType,
      active: true
    }
  })));
}

function publicPricingPayload() {
  return {
    product: PRODUCT,
    businessIdentity: BUSINESS_IDENTITY,
    paymentMode: PAYMENT_MODE,
    providerStatus: {
      xendit: providerReady("xendit") ? "configured" : "test_mode",
      stripe: providerReady("stripe") ? "configured" : "test_mode",
      manual_bank_transfer: "prepared"
    },
    // AVAILABLE_PLANS, not PRICING_PLANS: hidden tiers must not render on
    // /pricing/ either. calculateCart already refuses them, but a visible card
    // with a dead button is worse than no card.
    plans: AVAILABLE_PLANS,
    addOns: AVAILABLE_ADD_ONS,
    enterprise: {
      name: "Enterprise",
      priceLabel: "Custom pricing",
      rangeLabel: "Starting at ₱100,000 per month",
      cta: "Request an Enterprise Proposal",
      bestFor: [
        "Large companies",
        "Hotels",
        "Clinics",
        "Property developers",
        "Multi-branch businesses",
        "High-volume customer support",
        "Custom AI integrations",
        "Private deployment",
        "Custom workflows",
        "Dedicated infrastructure"
      ]
    },
    policies: {
      tax: "Taxes are shown as ₱0 in demo checkout until tax configuration is finalized.",
      refund: "Setup fees may become non-refundable once onboarding work begins. Subscription charges are reviewed under the Refund Policy.",
      cancellation: "Customers may cancel future renewals before the next billing date. Cancellation does not automatically refund the current billing period."
    }
  };
}

function orderNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `AS-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function invoiceNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `INV-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function normaliseTestDiscountCode(value) {
  return String(value || "").trim().toUpperCase();
}

function testDiscountTargetTotal() {
  const amount = Number(process.env.PAYMONGO_LIVE_TEST_TOTAL || 10);
  return Number.isFinite(amount) && amount > 0 ? amount : 10;
}

function applyTestDiscount(calculated, couponCode) {
  const configuredCode = normaliseTestDiscountCode(process.env.PAYMONGO_LIVE_TEST_CODE);
  const submittedCode = normaliseTestDiscountCode(couponCode);
  if (!configuredCode || !submittedCode) return { ...calculated, discountApplied: false };
  if (submittedCode !== configuredCode) {
    const error = new Error("Invalid discount code");
    error.statusCode = 400;
    throw error;
  }

  const targetTotal = Math.min(testDiscountTargetTotal(), calculated.total);
  const discountAmount = calculated.total - targetTotal;
  if (discountAmount <= 0) return { ...calculated, discountApplied: false };

  return {
    ...calculated,
    subtotal: targetTotal,
    tax: 0,
    total: targetTotal,
    discountApplied: true,
    items: [
      ...calculated.items,
      {
        itemType: "discount",
        itemId: "paymongo-live-test",
        itemName: "Payment gateway live test discount",
        billingFrequency: "one_time",
        unitPrice: -discountAmount,
        quantity: 1,
        lineTotal: -discountAmount
      }
    ]
  };
}

async function processPaymentWebhook(provider, req, res) {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  const signature = provider === "paymongo" ? req.get("paymongo-signature")
    : provider === "xendit" ? req.get("x-callback-token")
    : req.get("stripe-signature");
  const signatureVerified = verifyWebhookSignature(provider, rawBody, signature);
  if (!signatureVerified) return res.status(400).json({ error: "Invalid webhook signature" });

  let payload = {};
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  /**
   * PayMongo nests everything two levels deep and names things differently:
   *   payload.data.id                                  -> event id
   *   payload.data.attributes.type                     -> "checkout_session.payment.paid"
   *   payload.data.attributes.data.attributes.…        -> the resource itself
   *
   * The reference_number we set when creating the session is OUR order number,
   * and it is the only reliable link between a PayMongo payment and an AIStaff
   * order. Read it before the generic handling below, which is Xendit-shaped.
   */
  let paymongo = null;
  if (provider === "paymongo") {
    const attributes = payload?.data?.attributes || {};
    const resource = attributes?.data?.attributes || {};
    paymongo = {
      eventId: payload?.data?.id || null,
      eventType: attributes.type || "",
      // On checkout_session events the reference sits on the session; on
      // payment events it may sit on the payment instead.
      reference: resource.reference_number
        || resource?.payment_intent?.attributes?.metadata?.reference_number
        || null,
      resourceId: attributes?.data?.id || null,
      amountCentavos: resource.amount ?? null,
      email: resource?.billing?.email || resource?.payer_email || null
    };
    console.log("[paymongo] event=%s ref=%s resource=%s",
      paymongo.eventType, paymongo.reference, paymongo.resourceId);
  }

  const externalEventId = String(payload.id || payload.event_id || payload.data?.id || crypto.createHash("sha256").update(rawBody).digest("hex"));
  const eventType = String(payload.event || payload.type || payload.status || "payment_event");
  const existing = await prisma.webhookEvent.findUnique({ where: { provider_external_event_id: { provider, external_event_id: externalEventId } } });
  if (existing?.processing_status === "processed") return res.json({ ok: true, duplicate: true });

  await prisma.webhookEvent.upsert({
    where: { provider_external_event_id: { provider, external_event_id: externalEventId } },
    update: { payload, signature_verified: true, processing_status: "processing" },
    create: { provider, external_event_id: externalEventId, event_type: eventType, payload, signature_verified: true, processing_status: "processing" }
  });

  // Xendit sends BOTH: `id` is their invoice id (what we stored in
  // order.external_payment_id) and `external_id` is OUR order number. Looking
  // up external_id against external_payment_id never matches, so a real
  // payment would leave the order unpaid. Keep both and try each.
  const externalPaymentId = String(paymongo?.resourceId || payload.id || payload.data?.object?.id || payload.data?.id || "");
  const externalOrderNumber = String(paymongo?.reference || payload.external_id || "");
  const paid = paymongo
    ? /\.payment\.paid$|^payment\.paid$/.test(paymongo.eventType)
    : ["PAID", "SUCCEEDED", "paid", "succeeded", "checkout.session.completed", "invoice.paid"].includes(payload.status || payload.type);
  const failed = paymongo
    ? /payment\.failed$/.test(paymongo.eventType)
    : ["FAILED", "EXPIRED", "failed", "expired", "payment_intent.payment_failed"].includes(payload.status || payload.type);

  if ((externalPaymentId || externalOrderNumber) && (paid || failed)) {
    const order = await prisma.order.findFirst({
      where: {
        OR: [
          externalPaymentId ? { external_payment_id: externalPaymentId } : undefined,
          externalOrderNumber ? { order_number: externalOrderNumber } : undefined
        ].filter(Boolean)
      }
    });
    if (order) {
      if (paid) {
        const periodEnd = nextBillingDate(order.billing_frequency);
        await prisma.$transaction([
          prisma.payment.updateMany({ where: { order_id: order.id, provider }, data: { status: "paid", paid_at: new Date(), provider_response: payload } }),
          prisma.order.update({ where: { id: order.id }, data: { payment_status: "paid", order_status: "onboarding_required", paid_at: new Date() } }),
          prisma.subscription.updateMany({ where: { order_id: order.id }, data: { status: "active", current_period_start: new Date(), current_period_end: periodEnd } }),
          prisma.invoice.updateMany({ where: { order_id: order.id }, data: { status: "paid", paid_at: new Date() } })
        ]);

        // Payment alone left the customer with nothing to log into: checkout
        // creates Customer/Order/Subscription but no Company or User. Create
        // the workspace now and email a set-password link. Idempotent, and it
        // never throws — a provisioning problem must not make Xendit retry a
        // payment we have already recorded.
        const provisioned = await provisionPaidOrder(order.id);
        if (!provisioned.ok) {
          console.error(`[webhook] order ${order.order_number} paid but NOT provisioned:`, provisioned.reason);
        } else if (!provisioned.alreadyProvisioned) {
          console.log(`[webhook] order ${order.order_number} provisioned -> ${provisioned.accountNumber}`);
          try {
            const messengerNotice = await notifyMessengerPaymentConfirmed(order.id);
            if (messengerNotice.ok) console.log(`[webhook] order ${order.order_number} onboarding message sent in Messenger`);
          } catch (error) {
            console.warn(`[webhook] order ${order.order_number} Messenger onboarding notice failed:`, error.message);
          }
        }
      } else {
        await prisma.$transaction([
          prisma.payment.updateMany({ where: { order_id: order.id, provider }, data: { status: "failed", failed_at: new Date(), provider_response: payload } }),
          prisma.order.update({ where: { id: order.id }, data: { payment_status: "failed", order_status: "awaiting_payment" } })
        ]);
      }
    }
  }

  await prisma.webhookEvent.update({
    where: { provider_external_event_id: { provider, external_event_id: externalEventId } },
    data: { processing_status: "processed", processed_at: new Date() }
  });
  res.json({ ok: true });
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  return Number(value);
}

/**
 * Next quotation number.
 *
 * FIXED 2026-08-18. Was `count(where: company) + 1`, which had two bugs:
 *
 *  1. Count-based numbering breaks the moment numbers are not contiguous. A
 *     gap (deleted row, or an insert that failed) makes it regenerate a number
 *     that already exists — forever. Company AIS-2026-0001 held Q-2026-00001
 *     and Q-2026-00003, so count=2 produced Q-2026-00003 on every attempt and
 *     the unique constraint rejected it every time.
 *  2. `quotation_number` is GLOBALLY unique but the count was per company, so
 *     the second tenant to raise a quotation collided with the first.
 *
 * Now derived from the highest existing number across all companies, so it is
 * unique by construction. Sequence gaps per company are harmless — a quotation
 * number is an identifier, not a count.
 */
async function nextQuotationNumber() {
  const year = new Date().getFullYear();
  const prefix = `Q-${year}-`;
  const latest = await prisma.quotation.findFirst({
    where: { quotation_number: { startsWith: prefix } },
    orderBy: { quotation_number: "desc" },
    select: { quotation_number: true }
  });
  const current = latest ? Number(latest.quotation_number.slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(current) ? current : 0) + 1).padStart(5, "0")}`;
}

async function maybeCreateQuotationDraft({ companyId, lead, conversationId, preparedBy = null }) {
  if (!lead.quotation_ready) return null;
  const existing = await prisma.quotation.findFirst({
    where: { company_id: companyId, lead_id: lead.id, status: { in: ["draft", "pending_approval"] } }
  });
  if (existing) return existing;

  const settings = await prisma.companySetting.findUnique({ where: { company_id: companyId } });
  if (!settings?.allow_ai_quotation_drafts) return null;

  return prisma.quotation.create({
    data: {
      company_id: companyId,
      lead_id: lead.id,
      conversation_id: conversationId,
      quotation_number: await nextQuotationNumber(companyId),
      customer_name: lead.customer_name,
      customer_company: lead.company_name,
      service_needed: lead.service_needed,
      quotation_details: `Draft quotation request for ${lead.service_needed || "requested service"}.\nLocation: ${lead.location || "TBD"}\nUrgency: ${lead.urgency || "TBD"}\nNotes: ${lead.notes || "Created by AI after Messenger qualification."}`,
      terms: "Subject to admin review and official approval.",
      status: settings.quotation_requires_admin_approval ? "pending_approval" : "draft",
      mode: settings.quotation_mode || "approval_required",
      prepared_by: preparedBy
    }
  });
}

app.get("/api/health", asyncHandler(async (req, res) => {
  let database = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "error";
  }
  res.json({
    ok: database === "ok",
    database,
    messengerWebhook: "/api/webhooks/messenger",
    publicUrl: process.env.APP_PUBLIC_URL || null,
    signatureVerification: Boolean(process.env.META_APP_SECRET)
  });
}));

app.get("/api/public-config", (req, res) => {
  const pageId = process.env.META_PAGE_ID || "";
  res.json({
    messengerUrl: pageId ? `https://m.me/${pageId}` : null,
    pageId: pageId || null
  });
});

app.get("/api/pricing", asyncHandler(async (req, res) => {
  await ensurePricingCatalog();
  res.json(publicPricingPayload());
}));

app.post("/api/cart", asyncHandler(async (req, res) => {
  await ensurePricingCatalog();
  const body = z.object({
    planSlug: z.string().min(1),
    billingFrequency: z.enum(["monthly", "annual"]).default("monthly"),
    addOnSlugs: z.array(z.string()).default([]),
    couponCode: z.string().max(120).optional().nullable(),
    guestToken: z.string().optional().nullable()
  }).parse(req.body);
  const guestToken = body.guestToken || crypto.randomUUID();
  const calculated = applyTestDiscount(calculateCart(body), body.couponCode);
  const cart = await prisma.cart.create({
    data: {
      guest_token: guestToken,
      status: "active",
      currency: calculated.currency,
      subtotal: calculated.subtotal,
      tax: calculated.tax,
      total: calculated.total,
      items: {
        create: calculated.items.map((item) => ({
          item_type: item.itemType,
          item_id: item.itemId,
          item_name: item.itemName,
          billing_frequency: item.billingFrequency,
          unit_price: item.unitPrice,
          quantity: item.quantity,
          line_total: item.lineTotal
        }))
      }
    },
    include: { items: true }
  });
  res.json({ guestToken, cart: serializeCart(cart) });
}));

app.get("/api/cart/:id", asyncHandler(async (req, res) => {
  const cart = await prisma.cart.findUnique({ where: { id: req.params.id }, include: { items: { orderBy: { created_at: "asc" } } } });
  if (!cart) return res.status(404).json({ error: "Cart not found" });
  res.json(serializeCart(cart));
}));

app.patch("/api/cart/:id", asyncHandler(async (req, res) => {
  await ensurePricingCatalog();
  const body = z.object({
    planSlug: z.string().min(1).optional(),
    billingFrequency: z.enum(["monthly", "annual"]).optional(),
    addOnSlugs: z.array(z.string()).optional(),
    couponCode: z.string().max(120).optional().nullable()
  }).parse(req.body);
  const existing = await prisma.cart.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!existing) return res.status(404).json({ error: "Cart not found" });
  const currentPlan = existing.items.find((item) => item.item_type === "pricing_plan");
  const currentAddOns = existing.items.filter((item) => item.item_type === "add_on").map((item) => item.item_id);
  const calculated = applyTestDiscount(calculateCart({
    planSlug: body.planSlug || currentPlan?.item_id,
    billingFrequency: body.billingFrequency || currentPlan?.billing_frequency || "monthly",
    addOnSlugs: body.addOnSlugs || currentAddOns
  }), body.couponCode);
  const cart = await prisma.$transaction(async (tx) => {
    await tx.cartItem.deleteMany({ where: { cart_id: existing.id } });
    return tx.cart.update({
      where: { id: existing.id },
      data: {
        currency: calculated.currency,
        subtotal: calculated.subtotal,
        tax: calculated.tax,
        total: calculated.total,
        items: {
          create: calculated.items.map((item) => ({
            item_type: item.itemType,
            item_id: item.itemId,
            item_name: item.itemName,
            billing_frequency: item.billingFrequency,
            unit_price: item.unitPrice,
            quantity: item.quantity,
            line_total: item.lineTotal
          }))
        }
      },
      include: { items: { orderBy: { created_at: "asc" } } }
    });
  });
  res.json(serializeCart(cart));
}));

app.delete("/api/cart/:id/items/:itemId", asyncHandler(async (req, res) => {
  const cart = await prisma.cart.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!cart) return res.status(404).json({ error: "Cart not found" });
  const remainingAddOns = cart.items
    .filter((item) => item.item_type === "add_on" && item.id !== req.params.itemId)
    .map((item) => item.item_id);
  const plan = cart.items.find((item) => item.item_type === "pricing_plan");
  if (plan?.id === req.params.itemId) {
    await prisma.cart.update({ where: { id: cart.id }, data: { status: "empty", subtotal: 0, tax: 0, total: 0 } });
    await prisma.cartItem.deleteMany({ where: { cart_id: cart.id } });
    return res.json({ ok: true, empty: true });
  }
  const calculated = calculateCart({ planSlug: plan.item_id, billingFrequency: plan.billing_frequency, addOnSlugs: remainingAddOns });
  const updated = await prisma.$transaction(async (tx) => {
    await tx.cartItem.deleteMany({ where: { cart_id: cart.id } });
    return tx.cart.update({
      where: { id: cart.id },
      data: {
        subtotal: calculated.subtotal,
        tax: calculated.tax,
        total: calculated.total,
        items: {
          create: calculated.items.map((item) => ({
            item_type: item.itemType,
            item_id: item.itemId,
            item_name: item.itemName,
            billing_frequency: item.billingFrequency,
            unit_price: item.unitPrice,
            quantity: item.quantity,
            line_total: item.lineTotal
          }))
        }
      },
      include: { items: true }
    });
  });
  res.json(serializeCart(updated));
}));

const checkoutCustomerSchema = z.object({
  full_name: z.string().min(2),
  company_name: z.string().optional().nullable(),
  business_name: z.string().optional().nullable(),
  email: z.string().email(),
  mobile_number: z.string().min(5),
  billing_address: z.string().min(3),
  city: z.string().min(1),
  province: z.string().min(1),
  postal_code: z.string().min(1),
  country: z.string().min(1),
  tax_id: z.string().optional().nullable(),
  company_registration_number: z.string().optional().nullable(),
  business_website: z.string().optional().nullable(),
  facebook_page_url: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  estimated_monthly_inquiries: z.string().optional().nullable(),
  main_products_or_services: z.string().optional().nullable(),
  preferred_onboarding_date: z.string().optional().nullable()
});

app.post("/api/checkout", asyncHandler(async (req, res) => {
  await ensurePricingCatalog();
  const body = z.object({
    cartId: z.string().min(1),
    customer: checkoutCustomerSchema,
    agreements: z.object({
      terms: z.boolean(),
      privacy: z.boolean()
    }).passthrough(),
    requestedProvider: z.string().optional().nullable(),
    paymentMethod: z.string().optional().nullable(),
    couponCode: z.string().max(120).optional().nullable()
  }).parse(req.body);

  if (!body.agreements.terms || !body.agreements.privacy) {
    return res.status(400).json({ error: "Required checkout agreements must be accepted" });
  }

  const cart = await prisma.cart.findUnique({ where: { id: body.cartId }, include: { items: true } });
  if (!cart || !cart.items.length) return res.status(400).json({ error: "Cart is empty or unavailable" });
  const planItem = cart.items.find((item) => item.item_type === "pricing_plan");
  if (!planItem) return res.status(400).json({ error: "A subscription package is required" });
  const discountItem = cart.items.find((item) => item.item_type === "discount" && item.item_id === "paymongo-live-test");
  const official = applyTestDiscount(calculateCart({
    planSlug: planItem.item_id,
    billingFrequency: planItem.billing_frequency,
    addOnSlugs: cart.items.filter((item) => item.item_type === "add_on").map((item) => item.item_id)
  }), body.couponCode || (discountItem ? process.env.PAYMONGO_LIVE_TEST_CODE : ""));
  const provider = paymentProviderForCountry(body.customer.country, body.requestedProvider || "");
  const customerData = {
    ...body.customer,
    preferred_onboarding_date: body.customer.preferred_onboarding_date ? new Date(body.customer.preferred_onboarding_date) : null
  };

  const result = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({ data: customerData });
    const order = await tx.order.create({
      data: {
        order_number: orderNumber(),
        customer_id: customer.id,
        cart_id: cart.id,
        subtotal: official.subtotal,
        tax: official.tax,
        total: official.total,
        currency: official.currency,
        billing_frequency: official.billingFrequency,
        payment_provider: provider,
        payment_status: "pending",
        order_status: provider === "manual_bank_transfer" ? "awaiting_payment" : "awaiting_payment",
        items: {
          create: official.items.map((item) => ({
            item_type: item.itemType,
            item_id: item.itemId,
            item_name: item.itemName,
            billing_frequency: item.billingFrequency,
            unit_price: item.unitPrice,
            quantity: item.quantity,
            line_total: item.lineTotal
          }))
        }
      },
      include: { items: true }
    });
    await tx.cart.update({ where: { id: cart.id }, data: { status: "checked_out", subtotal: official.subtotal, tax: official.tax, total: official.total } });
    const paymentReference = `${provider}_${order.order_number}`;
    await tx.payment.create({
      data: {
        order_id: order.id,
        provider,
        provider_payment_id: paymentReference,
        payment_method: body.paymentMethod || provider,
        amount: official.total,
        currency: official.currency,
        status: "pending",
        provider_response: { mode: PAYMENT_MODE }
      }
    });
    const pricingPlan = await tx.pricingPlan.findUnique({ where: { slug: planItem.item_id } });
    await tx.subscription.create({
      data: {
        customer_id: customer.id,
        order_id: order.id,
        pricing_plan_id: pricingPlan.id,
        provider,
        provider_subscription_id: null,
        billing_frequency: official.billingFrequency,
        amount: Number(planItem.unit_price),
        currency: official.currency,
        status: "pending"
      }
    });
    await tx.invoice.create({
      data: {
        order_id: order.id,
        invoice_number: invoiceNumber(),
        customer_id: customer.id,
        amount: official.total,
        currency: official.currency,
        status: "pending",
        due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        invoice_url: `/api/orders/${order.order_number}/invoice`
      }
    });
    return tx.order.findUnique({
      where: { id: order.id },
      include: { customer: true, items: true, payments: true, subscriptions: true, invoices: true }
    });
  });

  const providerClient = getPaymentProvider(provider);
  const paymentSession = await providerClient.createCheckoutSession(result);
  const updated = await prisma.order.update({
    where: { id: result.id },
    data: {
      external_payment_id: paymentSession.providerPaymentId,
      external_checkout_url: paymentSession.checkoutUrl
    },
    include: { customer: true, items: true, payments: true, subscriptions: true, invoices: true }
  });
  await prisma.payment.updateMany({
    where: { order_id: result.id, provider },
    data: { provider_payment_id: paymentSession.providerPaymentId, provider_response: paymentSession }
  });

  res.json({
    order: serializeOrder(updated),
    checkout: {
      provider,
      providerConfigured: providerReady(provider),
      mode: PAYMENT_MODE,
      status: paymentSession.status,
      checkoutUrl: paymentSession.checkoutUrl,
      message: paymentSession.message || "Payment session prepared.",
      instructions: paymentSession.instructions || null
    }
  });
}));

app.post("/api/checkout/xendit", (req, res, next) => {
  req.body.requestedProvider = "xendit";
  req.url = "/api/checkout";
  app.handle(req, res, next);
});

app.post("/api/checkout/stripe", (req, res, next) => {
  req.body.requestedProvider = "stripe";
  req.url = "/api/checkout";
  app.handle(req, res, next);
});

app.post("/api/checkout/manual-bank-transfer", asyncHandler(async (req, res) => {
  req.body.requestedProvider = "manual_bank_transfer";
  const body = req.body;
  req.url = "/api/checkout";
  req.method = "POST";
  req.body = body;
  app.handle(req, res);
}));

app.get("/api/orders/:orderNumber", asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { order_number: req.params.orderNumber },
    include: { customer: true, items: true, payments: true, subscriptions: true, invoices: true }
  });
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json({ order: serializeOrder(order), businessIdentity: BUSINESS_IDENTITY });
}));

app.get("/api/orders/:orderNumber/status", asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { order_number: req.params.orderNumber },
    include: { payments: true, subscriptions: true }
  });
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json({
    orderNumber: order.order_number,
    paymentStatus: order.payment_status,
    orderStatus: order.order_status,
    subscriptionStatus: order.subscriptions[0]?.status || "pending",
    provider: order.payment_provider,
    paidAt: order.paid_at,
    nextBillingDate: order.payment_status === "paid" ? nextBillingDate(order.billing_frequency, order.paid_at || order.created_at) : null
  });
}));

app.post("/api/orders/:orderNumber/manual-payment-proof", asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({ where: { order_number: req.params.orderNumber } });
  if (!order) return res.status(404).json({ error: "Order not found" });
  const body = z.object({
    transaction_reference: z.string().min(1),
    payment_date: z.string().min(1),
    sender_name: z.string().min(1),
    amount_sent: z.number().positive(),
    proof_file_url: z.string().optional().nullable()
  }).parse(req.body);
  const proof = await prisma.manualPaymentProof.create({
    data: {
      order_id: order.id,
      transaction_reference: body.transaction_reference,
      payment_date: new Date(body.payment_date),
      sender_name: body.sender_name,
      amount_sent: body.amount_sent,
      proof_file_url: body.proof_file_url || null,
      status: "awaiting_verification"
    }
  });
  await prisma.order.update({ where: { id: order.id }, data: { order_status: "awaiting_payment", payment_status: "processing" } });
  res.json({ proof, message: "Payment proof received and awaiting verification." });
}));

app.post("/api/subscriptions/:id/cancel", requireAuth, requireFinance, asyncHandler(async (req, res) => {
  const subscription = await prisma.subscription.update({
    where: { id: req.params.id },
    data: { cancel_at_period_end: true, status: "cancelled", cancelled_at: new Date() }
  });
  res.json(subscription);
}));

app.post("/api/subscriptions/:id/reactivate", requireAuth, requireFinance, asyncHandler(async (req, res) => {
  const subscription = await prisma.subscription.update({
    where: { id: req.params.id },
    data: { cancel_at_period_end: false, status: "active", cancelled_at: null }
  });
  res.json(subscription);
}));

app.get("/api/admin/payments/dashboard", requireAuth, requireFinance, asyncHandler(async (req, res) => {
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const startMonth = new Date(startToday.getFullYear(), startToday.getMonth(), 1);
  const [paidToday, paidMonth, pendingPayments, failedPayments, activeSubscriptions, pastDueSubscriptions, cancelledSubscriptions, upcomingRenewals, orders] = await Promise.all([
    prisma.payment.aggregate({ where: { status: "paid", paid_at: { gte: startToday } }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: "paid", paid_at: { gte: startMonth } }, _sum: { amount: true } }),
    prisma.payment.count({ where: { status: { in: ["pending", "processing"] } } }),
    prisma.payment.count({ where: { status: "failed" } }),
    prisma.subscription.count({ where: { status: "active" } }),
    prisma.subscription.count({ where: { status: "past_due" } }),
    prisma.subscription.count({ where: { status: "cancelled" } }),
    prisma.subscription.count({ where: { current_period_end: { lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) }, status: "active" } }),
    prisma.order.findMany({
      orderBy: { created_at: "desc" },
      take: 50,
      include: { customer: true, items: true, payments: true, subscriptions: true }
    })
  ]);
  res.json({
    cards: {
      revenueToday: decimalNumber(paidToday._sum.amount),
      revenueThisMonth: decimalNumber(paidMonth._sum.amount),
      pendingPayments,
      failedPayments,
      activeSubscriptions,
      pastDueSubscriptions,
      cancelledSubscriptions,
      upcomingRenewals
    },
    orders: orders.map(serializeOrder)
  });
}));

app.post("/api/public/audit-request", asyncHandler(async (req, res) => {
  const body = z.object({
    company: z.string().min(1),
    person: z.string().min(1),
    mobile: z.string().min(1),
    email: z.string().email(),
    page: z.string().min(1),
    business: z.string().optional().nullable(),
    inquiries: z.string().optional().nullable(),
    quotations: z.string().optional().nullable(),
    message: z.string().optional().nullable()
  }).parse(req.body);

  const companyId = await getDefaultCompanyId();
  const psid = `audit_${Date.now()}`;

  const conversation = await prisma.conversation.create({
    data: {
      company_id: companyId,
      psid,
      customer_name: body.person,
      channel: "website_audit",
      status: "open",
      intent: "website_audit_request",
      lead_score: "warm",
      last_message_at: new Date()
    }
  });

  await prisma.message.create({
    data: {
      company_id: companyId,
      conversation_id: conversation.id,
      sender_type: "customer",
      sender_id: psid,
      message_text: [
        `Audit request from ${body.person} (${body.company})`,
        `Mobile: ${body.mobile}`,
        `Email: ${body.email}`,
        `Page: ${body.page}`,
        body.business ? `Business: ${body.business}` : "",
        body.inquiries ? `Inquiries/week: ${body.inquiries}` : "",
        body.quotations ? `Sends quotations: ${body.quotations}` : "",
        body.message ? `Notes: ${body.message}` : ""
      ].filter(Boolean).join("\n")
    }
  });

  await prisma.lead.create({
    data: {
      company_id: companyId,
      conversation_id: conversation.id,
      customer_name: body.person,
      mobile_number: body.mobile,
      email: body.email,
      company_name: body.company,
      location: body.page,
      service_needed: body.business || "AI Facebook inbox sales assistant",
      budget: body.inquiries,
      urgency: body.quotations,
      notes: body.message,
      lead_status: "new",
      lead_score: "warm"
    }
  });

  buildPresenceSnapshot({ facebookInput: body.page, requestedPageName: body.company })
    .then(async (snapshot) => {
      if (!snapshot.ok) return;
      await prisma.lead.updateMany({
        where: { company_id: companyId, conversation_id: conversation.id },
        data: {
          notes: [
            body.message || "",
            "Public presence preview:",
            JSON.stringify(snapshot, null, 2)
          ].filter(Boolean).join("\n\n")
        }
      });
    })
    .catch((error) => {
      console.warn("Audit presence preview failed:", error.message);
    });

  res.json({ ok: true, message: "Audit request received" });
}));

const siteChatRateLimitStore = new Map();
function checkSiteChatRateLimit(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const maxRequests = 20;
  const entry = siteChatRateLimitStore.get(ip) || [];
  const recent = entry.filter((t) => now - t < windowMs);
  if (recent.length >= maxRequests) return false;
  recent.push(now);
  siteChatRateLimitStore.set(ip, recent);
  return true;
}

app.post("/api/public/site-chat", asyncHandler(async (req, res) => {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  if (!checkSiteChatRateLimit(ip)) {
    return res.status(429).json({ ok: false, error: "Too many messages. Please wait a bit and try again." });
  }

  const body = z.object({
    visitorId: z.string().trim().min(8).max(80).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    messages: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1).max(2000)
    })).min(1).max(20)
  }).parse(req.body);

  const latest = body.messages[body.messages.length - 1];
  if (latest.role !== "user") {
    return res.status(400).json({ ok: false, error: "Please send a customer message." });
  }

  const companyId = AISTAFF_INTERNAL_COMPANY_ID;
  const channel = "website_chat";
  const visitorId = body.visitorId || `web_${crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const visitorLabel = `Website visitor ${visitorId.slice(-6).toUpperCase()}`;
  const now = new Date();

  const conversation = await prisma.conversation.upsert({
    where: {
      company_id_channel_external_id: {
        company_id: companyId,
        channel,
        external_id: visitorId
      }
    },
    create: {
      company_id: companyId,
      channel,
      external_id: visitorId,
      customer_name: visitorLabel,
      intent: "aistaff_website_chat",
      last_message_at: now
    },
    update: { last_message_at: now }
  });

  const existingMessageCount = await prisma.message.count({
    where: { company_id: companyId, conversation_id: conversation.id }
  });
  const initialAssistantMessage = body.messages.find((item) => item.role === "assistant" && item.content.trim());
  if (!existingMessageCount && initialAssistantMessage) {
    await prisma.message.create({
      data: {
        company_id: companyId,
        conversation_id: conversation.id,
        sender_type: "ai",
        sender_id: "ai_sales_assistant",
        message_text: initialAssistantMessage.content,
        ai_generated: true
      }
    });
  }

  await prisma.message.create({
    data: {
      company_id: companyId,
      conversation_id: conversation.id,
      sender_type: "customer",
      sender_id: visitorId,
      message_text: latest.content
    }
  });

  let lead = await prisma.lead.findFirst({ where: { company_id: companyId, conversation_id: conversation.id } });
  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        company_id: companyId,
        conversation_id: conversation.id,
        customer_name: visitorLabel,
        service_needed: "AIStaff website chat inquiry",
        notes: [
          "Source: AIStaff website chat widget",
          `Website visitor ID: ${visitorId}`,
          `Conversation ID: ${conversation.id}`,
          "Identity: anonymous until they share contact details or continue in Messenger"
        ].join("\n")
      }
    });
  }

  let ai;
  try {
    ai = await generateSalesReply({ companyId, conversationId: conversation.id, message: latest.content });
  } catch (error) {
    console.error("[site-chat] REPLY GENERATION FAILED company=%s conversation=%s: %s",
      companyId, conversation.id, error.message);
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { needs_human: true, status: "handoff" }
    }).catch(() => {});
    await prisma.humanHandoff.create({
      data: {
        company_id: companyId,
        conversation_id: conversation.id,
        reason: `Website chat reply failed: ${error.message}`
      }
    }).catch(() => {});
    return res.status(502).json({ ok: false, error: "Closer could not reply right now. Please try again in a moment." });
  }

  const updatedLead = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      ...ai.leadPatch,
      lead_score: ai.leadScore,
      quotation_ready: ai.quotationReady,
      lead_status: ai.quotationReady ? "quotation_ready" : "contacted"
    }
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      intent: ai.intent,
      lead_score: ai.leadScore,
      needs_human: ai.needsHuman,
      status: ai.needsHuman ? "handoff" : "open",
      last_message_at: new Date()
    }
  });

  const settings = ai.settings;
  if (ai.needsHuman && settings?.human_handoff_enabled) {
    await prisma.humanHandoff.create({
      data: {
        company_id: companyId,
        conversation_id: conversation.id,
        reason: ai.handoffReason || "Website chat requested human handoff"
      }
    }).catch(() => {});

    if (settings?.notify_email) {
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true }
      });
      await notifyHandoff({
        to: settings.notify_email,
        companyName: company?.name || "AIStaff",
        lead: updatedLead,
        reason: ai.handoffReason,
        lastMessage: latest.content,
        conversationId: conversation.id
      }).catch((error) => console.warn("[site-chat] handoff email failed:", error.message));
    }
  }

  await maybeCreateQuotationDraft({ companyId, lead: updatedLead, conversationId: conversation.id }).catch((error) => {
    console.warn("[site-chat] quotation draft failed:", error.message);
  });

  if (ai.unanswered && ai.unanswered.topic) {
    const existing = await prisma.knowledgeGap.findFirst({
      where: { company_id: companyId, topic: ai.unanswered.topic, status: "open" }
    });
    if (existing) {
      await prisma.knowledgeGap.update({
        where: { id: existing.id },
        data: { times_asked: { increment: 1 }, last_asked_at: new Date() }
      });
    } else {
      await prisma.knowledgeGap.create({
        data: {
          company_id: companyId,
          question: ai.unanswered.question || ai.unanswered.topic,
          topic: ai.unanswered.topic,
          conversation_id: conversation.id
        }
      });
    }
  }

  const media = Array.isArray(ai.sendMedia) ? ai.sendMedia : [];
  await prisma.message.create({
    data: {
      company_id: companyId,
      conversation_id: conversation.id,
      sender_type: "ai",
      sender_id: "ai_sales_assistant",
      message_text: ai.reply,
      attachments: media.length ? media : undefined,
      ai_generated: true
    }
  });

  const followUpMessages = [];
  if (ai.paymentRequest) {
    const result = await createCheckoutLink({
      companyId,
      conversationId: conversation.id,
      email: ai.paymentRequest.email,
      name: ai.paymentRequest.name || updatedLead.customer_name,
      mobile: ai.paymentRequest.mobile || updatedLead.mobile_number,
      planSlug: ai.paymentRequest.plan,
      billingFrequency: ai.paymentRequest.billing
    }).catch((error) => {
      console.warn("[site-chat] checkout link failed:", error.message);
      return null;
    });

    if (result?.ok) {
      const peso = (n) => `₱${Number(n).toLocaleString("en-PH")}`;
      const lines = result.billingFrequency === "annual"
        ? [`${peso(result.amount)} for 12 months — that is ${peso(result.monthlyEquivalent)}/month, saving ${peso(result.saving)}.`]
        : [`${peso(result.amount)} per month.`];
      lines.push(result.url);
      lines.push(`Reference: ${result.orderNumber}`);
      const paymentMessage = lines.join("\n");
      followUpMessages.push(paymentMessage);
      await prisma.message.create({
        data: {
          company_id: companyId,
          conversation_id: conversation.id,
          sender_type: "ai",
          sender_id: "ai_sales_assistant",
          message_text: paymentMessage,
          ai_generated: true
        }
      });
    }
  }

  res.json({
    ok: true,
    visitorId,
    conversationId: conversation.id,
    reply: ai.reply,
    followUpMessages,
    media
  });
}));

// ---------------------------------------------------------------------------
// Brandee — business-outcome-first Creative Plan generation.
// See src/brandee/* for the SSRF-safe website analyzer, the approved
// static-ad-framework + 100-hook playbook data, and the deterministic +
// optional-AI planner. Public, unauthenticated, rate-limited like site-chat.
// ---------------------------------------------------------------------------

const BRANDEE_SESSION_COOKIE = "brandee_sid";

function getOrSetBrandeeSessionId(req, res) {
  let sid = req.cookies?.[BRANDEE_SESSION_COOKIE];
  if (!sid) {
    sid = crypto.randomUUID();
    res.cookie(BRANDEE_SESSION_COOKIE, sid, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 30
    });
  }
  return sid;
}

const brandeeRateLimitStore = new Map();
function checkBrandeeRateLimit(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const maxRequests = 8; // website fetch + AI call is heavier than a chat message
  const entry = brandeeRateLimitStore.get(ip) || [];
  const recent = entry.filter((t) => now - t < windowMs);
  if (recent.length >= maxRequests) return false;
  recent.push(now);
  brandeeRateLimitStore.set(ip, recent);
  return true;
}

// Idempotency: a duplicate double-click on Submit within a short window
// should not trigger a second full scrape+AI run. Keyed by session + a hash
// of the submitted form (not by planId, since the client doesn't have one
// yet). Entries expire quickly — this only guards against accidental
// double-submits, not a general dedupe of legitimate re-analysis requests.
const brandeeInFlightBySessionForm = new Map();
function inFlightKey(sessionId, form) {
  return `${sessionId}:${form.url}:${form.selectedGoal}:${form.regenerate ? "regen" : "initial"}`;
}

function buildManualOnlyAnalysis(form) {
  // Graceful manual fallback (PART 5) — never block plan generation on a
  // website-fetch/extraction failure. Every fact here comes straight from
  // the submitted form (source: "user"), never invented. Matches the
  // upgraded BusinessProfile shape (crawlSummary/blogState/confirmation
  // fields) so downstream code never has to special-case "the crawl never
  // ran at all" vs. "the crawl ran but found little."
  const evidence = [];
  if (form.whatYouSell) evidence.push({ statement: `What you sell: ${form.whatYouSell}`, sourceType: "user", confidence: 0.9, entityType: "product_or_service" });
  if (form.idealCustomer) evidence.push({ statement: `Ideal customer: ${form.idealCustomer}`, sourceType: "user", confidence: 0.9, entityType: "audience" });
  if (form.offer) evidence.push({ statement: `Offer: ${form.offer}`, sourceType: "user", confidence: 0.9, entityType: "offer" });
  if (form.differentiator) evidence.push({ statement: `Differentiator: ${form.differentiator}`, sourceType: "user", confidence: 0.9, entityType: "differentiator" });

  return {
    sourceUrl: form.url,
    crawlSummary: { pagesDiscovered: 0, pagesCrawled: 0, pagesRejected: 0, subdomainsCrawled: [], pageTypes: {}, warnings: ["Website could not be read automatically."] },
    sourceMode: "manual_only",
    businessName: null,
    businessNameConfidence: 0,
    businessType: "unknown",
    industry: null,
    summary: "Brandee could not read this website automatically. This plan is based on what you entered manually.",
    productsOrServices: [],
    targetAudienceSignals: [],
    primaryProblemsSolved: [],
    customerDesires: [],
    features: [],
    functionalBenefits: [],
    businessOutcomes: [],
    primaryBenefits: [],
    differentiators: form.differentiator ? [form.differentiator] : [],
    offers: form.offer ? [form.offer] : [],
    callsToAction: [],
    contactMethods: [],
    locations: [],
    blogState: "unknown",
    proof: { testimonials: [], reviewCount: null, rating: null, customerCount: null, yearsInBusiness: null, awards: [], certifications: [], guarantees: [] },
    brandTone: [],
    claimsFound: evidence.map((e) => e.statement),
    evidence,
    inferences: [],
    missingInformation: ["Everything from the website — Brandee could not read it automatically"],
    contradictions: [],
    confirmationRequired: true,
    confirmationReasons: ["Brandee could not read this website automatically — please confirm the details below are accurate."],
    confidence: 0.15,
    fetchStatus: "manual_only"
  };
}

function plannerModelLabel() {
  const config = getPlannerConfig();
  return `${config.provider}:${config.model || "unset"}`;
}

/** Maps a WebsiteAnalysisError (websiteAnalyzer.js) code to a BrandeeError code. */
function scraperErrorCodeFor(error) {
  if (!(error instanceof WebsiteAnalysisError)) return "BRANDEE_SCRAPER_FAILED";
  if (error.code === "timeout") return "BRANDEE_SCRAPER_TIMEOUT";
  if (error.code === "invalid_url") return "BRANDEE_INVALID_URL";
  if (error.code === "blocked_host" || error.code === "unsupported_protocol") return "BRANDEE_URL_BLOCKED";
  return "BRANDEE_SCRAPER_FAILED";
}

app.post("/api/public/brandee/analyze", asyncHandler(async (req, res) => {
  const runStartedAt = Date.now();
  const requestId = crypto.randomUUID();
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";

  if (!checkBrandeeRateLimit(ip)) {
    const err = new BrandeeError("BRANDEE_RATE_LIMITED", { requestId });
    console.warn("[brandee]", err.toLogEntry());
    return res.status(429).json(err.toSafeJson());
  }

  // Stage: input -------------------------------------------------------
  let form;
  try {
    form = AnalyzeRequestSchema.parse(req.body);
  } catch (error) {
    const err = toBrandeeError(error, {
      code: "BRANDEE_INVALID_INPUT",
      stage: "input",
      requestId,
      metadata: { issues: error?.issues?.slice(0, 5) }
    });
    console.warn("[brandee]", err.toLogEntry());
    return res.status(400).json(err.toSafeJson());
  }

  const sessionId = getOrSetBrandeeSessionId(req, res);

  // Duplicate-click guard — same session+form combination already running.
  const dedupeKey = inFlightKey(sessionId, form);
  if (brandeeInFlightBySessionForm.has(dedupeKey)) {
    const err = new BrandeeError("BRANDEE_RATE_LIMITED", {
      requestId,
      publicMessage: "Brandee is already building this plan. Please wait a moment.",
      internalMessage: "Duplicate in-flight request for same session+form"
    });
    return res.status(429).json(err.toSafeJson());
  }
  brandeeInFlightBySessionForm.set(dedupeKey, true);

  try {
    // Stage: multi-page crawl + extraction ---------------------------------
    // See businessProfileBuilder.js — discovers and reads pages beyond the
    // homepage (nav/footer/sitemap), resolves the business name from a
    // weighted evidence hierarchy, and extracts contacts/offers/products/
    // proof/blog-state across every crawled page, not just one.
    let websiteAnalysis;
    let usedManualFallback = false;
    let extractionModel = "deterministic";
    try {
      const normalizedUrl = normalizeUrlInput(form.url);
      const heuristicAnalysis = await buildBusinessProfile({ rootUrl: normalizedUrl, form });

      // Optional best-effort AI enrichment on top of the always-available
      // deterministic extraction (see extraction.js) — never blocks, never
      // invents proof, silently falls back on any failure. Uses the
      // homepage's visible text as the enrichment sample (kept small and
      // untrusted per extraction.js's prompt-injection defenses).
      const homepageText = heuristicAnalysis.summary || "";
      const enrichment = await enrichBusinessAnalysisWithAi(heuristicAnalysis, { visibleText: homepageText, form });
      websiteAnalysis = enrichment.analysis;
      if (enrichment.aiUsed) {
        const extractionConfig = getExtractionConfig();
        extractionModel = `${extractionConfig.provider}:${extractionConfig.model}`;
      }

      const validated = WebsiteBusinessAnalysisSchema.safeParse(websiteAnalysis);
      if (!validated.success) {
        throw new BrandeeError("BRANDEE_EXTRACTION_SCHEMA_FAILED", {
          internalMessage: `Website analysis failed schema validation: ${validated.error.message}`,
          metadata: { issues: validated.error.issues?.slice(0, 5) },
          requestId
        });
      }
      websiteAnalysis = validated.data;
      if (websiteAnalysis.fetchStatus === "unreachable" || websiteAnalysis.crawlSummary.pagesCrawled === 0) {
        usedManualFallback = true;
      }
    } catch (error) {
      const brandeeError = error instanceof BrandeeError
        ? error
        : toBrandeeError(error, { code: scraperErrorCodeFor(error), stage: "scraping", requestId });
      console.warn("[brandee] scraping/extraction failed, falling back to manual input:", brandeeError.toLogEntry());
      websiteAnalysis = buildManualOnlyAnalysis(form);
      usedManualFallback = true;
    }

    // Stage: rules ---------------------------------------------------------
    const creativeBrainStatus = getCreativeBrainStatus();
    if (!creativeBrainStatus.active) {
      throw new BrandeeError("BRANDEE_RULES_NOT_LOADED", {
        internalMessage: "Creative Brain resources failed validation — refusing to plan with an incomplete/invalid playbook.",
        requestId,
        metadata: { version: creativeBrainStatus.version }
      });
    }

    // Stage: planning + validation ------------------------------------------
    let generated;
    try {
      generated = await generateCreativePlan({ businessAnalysis: websiteAnalysis, form, requestId });
    } catch (error) {
      const brandeeError = error instanceof BrandeeError
        ? error
        : toBrandeeError(error, { code: "BRANDEE_PLANNER_MODEL_FAILED", stage: "planning", requestId });
      console.error("[brandee] plan generation failed:", brandeeError.toLogEntry());
      recordBrandeeRun({
        status: "failed",
        submittedUrl: form.url,
        sessionId,
        userId: req.user?.id || null,
        selectedGoal: form.selectedGoal,
        failedStage: brandeeError.stage,
        safeErrorCode: brandeeError.code,
        durationMs: Date.now() - runStartedAt,
        extractionModel,
        plannerModel: plannerModelLabel(),
        creativeBrainVersion: creativeBrainStatus.version,
        requestId
      });
      return res.status(brandeeError.retryable ? 503 : 500).json(brandeeError.toSafeJson());
    }

    // Stage: persistence -----------------------------------------------------
    let record;
    try {
      record = savePlan({
        plan: generated.plan,
        websiteAnalysis,
        decisionConstraints: generated.decisionConstraints || null,
        form,
        sessionId,
        userId: req.session?.userId || null,
        aiUsed: generated.aiUsed,
        extractionModel,
        plannerModel: generated.aiUsed ? plannerModelLabel() : "deterministic",
        creativeBrainVersion: creativeBrainStatus.version,
        requestId,
        durationMs: Date.now() - runStartedAt
      });
    } catch (error) {
      const brandeeError = toBrandeeError(error, { code: "BRANDEE_DATABASE_FAILED", stage: "persistence", requestId });
      console.error("[brandee] plan persistence failed:", brandeeError.toLogEntry());
      recordBrandeeRun({
        status: "failed",
        submittedUrl: form.url,
        sessionId,
        userId: req.user?.id || null,
        selectedGoal: generated.plan.selectedGoal,
        recommendedGoal: generated.plan.recommendedGoal,
        failedStage: brandeeError.stage,
        safeErrorCode: brandeeError.code,
        durationMs: Date.now() - runStartedAt,
        extractionModel,
        plannerModel: generated.aiUsed ? plannerModelLabel() : "deterministic",
        creativeBrainVersion: creativeBrainStatus.version,
        requestId
      });
      return res.status(500).json(brandeeError.toSafeJson());
    }

    recordBrandeeRun({
      status: "success",
      submittedUrl: form.url,
      sessionId,
      userId: req.user?.id || null,
      selectedGoal: generated.plan.selectedGoal,
      recommendedGoal: generated.plan.recommendedGoal,
      durationMs: Date.now() - runStartedAt,
      extractionModel,
      plannerModel: generated.aiUsed ? plannerModelLabel() : "deterministic",
      creativeBrainVersion: creativeBrainStatus.version,
      requestId,
      crawlDiagnostics: {
        pagesDiscovered: websiteAnalysis.crawlSummary?.pagesDiscovered ?? null,
        pagesCrawled: websiteAnalysis.crawlSummary?.pagesCrawled ?? null,
        pagesRejected: websiteAnalysis.crawlSummary?.pagesRejected ?? null,
        pageTypes: websiteAnalysis.crawlSummary?.pageTypes ?? null,
        subdomainsCrawled: websiteAnalysis.crawlSummary?.subdomainsCrawled ?? [],
        businessNameConfidence: websiteAnalysis.businessNameConfidence ?? null,
        productsOrServicesCount: (websiteAnalysis.productsOrServices || []).length,
        contactMethodsFound: (websiteAnalysis.contactMethods || []).length,
        blogState: websiteAnalysis.blogState ?? null,
        confirmationRequired: Boolean(websiteAnalysis.confirmationRequired)
      }
    });

    res.json({
      ok: true,
      requestId,
      planId: record.planId,
      websiteAnalysis,
      plan: generated.plan,
      aiUsed: generated.aiUsed,
      aiNote: generated.aiUsed
        ? null
        : (generated.aiError ? "Brandee generated this plan using her core strategy engine (AI polish was unavailable)." : "Brandee generated this plan using her core strategy engine."),
      notice: usedManualFallback
        ? "Brandee could not read the website, so this plan was built from the details you entered."
        : null,
      // PART 15 — the plan itself is still fully generated even when
      // confirmation is recommended (never blocks the customer from seeing
      // a result), but the client can use this to show an inline "confirm
      // these details" banner/step before treating the plan as final.
      profileConfirmation: {
        required: Boolean(websiteAnalysis.confirmationRequired),
        reasons: websiteAnalysis.confirmationReasons || []
      }
    });
  } catch (error) {
    // Catch-all for anything thrown outside the per-stage try/catches above
    // (e.g. BRANDEE_RULES_NOT_LOADED thrown between stages) — still typed,
    // still stage-aware, never a bare stack trace to the client.
    const brandeeError = toBrandeeError(error, { code: "BRANDEE_UNKNOWN_ERROR", stage: "planning", requestId });
    console.error("[brandee] analyze request failed:", brandeeError.toLogEntry());
    recordBrandeeRun({
      status: "failed",
      submittedUrl: form?.url,
      sessionId,
      userId: req.user?.id || null,
      selectedGoal: form?.selectedGoal,
      failedStage: brandeeError.stage,
      safeErrorCode: brandeeError.code,
      durationMs: Date.now() - runStartedAt,
      requestId
    });
    return res.status(brandeeError.retryable ? 503 : 500).json(brandeeError.toSafeJson());
  } finally {
    brandeeInFlightBySessionForm.delete(dedupeKey);
  }
}));

app.get("/api/public/brandee/plan/:planId", asyncHandler(async (req, res) => {
  const record = getPlan(req.params.planId);
  if (!record) return res.status(404).json({ ok: false, error: "Plan not found." });
  res.json({ ok: true, ...record });
}));

app.get("/agents/brandee/plan/:planId", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "agents", "brandee", "plan", "index.html"));
});

// ===========================================================================
// Brandee product-ad MVP (image + video ad creation from an uploaded
// product) — "Upload your product. Brandee turns it into an ad."
//
// Reuses: the SSRF-safe fetch layer (websiteAnalyzer.js), the dependency-
// free HTML parser (crawler.js parseHtmlDocument), the Brandee session
// cookie helper (getOrSetBrandeeSessionId), the existing auth primitives
// (hashPassword/signSession/setSessionCookie/requireAuth), and the existing
// Product/PricingPlan/Customer/Order/Subscription billing tables. See
// src/brandee/productAd*.js for the implementation modules.
// ===========================================================================

// Product images arrive as base64 data URLs in the JSON body — the larger
// (24mb) body-size limit for these routes is registered globally, path-
// scoped, near the top of the file (see the express.json call right before
// the app-wide 1MB default), so it runs before the general limit would
// reject the request.

const {
  createDemoSession, runScrape, replyToDemoMessage, extractFacts,
  MAX_MESSAGES_PER_SESSION
} = require("./demo-agent");
const demoStartRateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: Number(process.env.DEMO_START_RATE_LIMIT_MAX || 120) });
const demoChatRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: Number(process.env.DEMO_CHAT_RATE_LIMIT_MAX || 120) });

const { requestReset, resetPassword } = require("./password-reset");

// Auth limiters. Login had NONE before 2026-08-12 — unlimited password guesses
// against a known address. Two axes on the reset route: per-IP alone lets one
// attacker spam many victims; per-email alone lets them spray from one address.
const loginRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
const forgotByIpRateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
const forgotByEmailRateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
const resetRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

function clientIp(req) {
  return req.ip || req.headers["x-forwarded-for"] || "unknown";
}

const productAdPreviewRateLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });

function requireProductAdRateLimit(req, res, next) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const result = productAdPreviewRateLimiter.check(ip);
  if (!result.allowed) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
  }
  next();
}

// Dedicated, far more generous limiter for the lightweight analytics ping
// (/product-ads/track). This endpoint is cheap (no AI calls) and fires
// often and legitimately — every carousel auto-advance across every
// approach section on /agents/brandee/image/approaches/ (up to ~10
// carousels on that page alone) calls track(), plus page-view/nav-click/
// section-viewed events. It was previously sharing
// productAdPreviewRateLimiter (20 req/10min) with the expensive
// AI-generation endpoints below, so normal carousel browsing burned out
// that whole budget within the first minute on the page — after which the
// *real* endpoints (image preview/revise/etc.) started silently 429'ing
// too for the rest of that visitor's 10-minute window. That shared budget
// was the cause of "sometimes fast, sometimes slow" behavior: it depended
// entirely on how long someone had been on the page before trying an
// action, not on anything about the action itself.
const productAdTrackRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 120 });

function requireProductAdTrackRateLimit(req, res, next) {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const result = productAdTrackRateLimiter.check(ip);
  if (!result.allowed) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
  }
  next();
}

// Lightweight session check for public pages: returns the signed-in user
// if there is one, or { user: null } — never 401. The workspace calls this
// on load so it knows you're already logged in from a previous visit,
// instead of only recognising a login performed in that same tab.
app.get("/api/public/brandee/whoami", (req, res) => {
  if (!req.user) return res.json({ ok: true, user: null });
  res.json({ ok: true, user: { id: req.user.id, name: req.user.name, email: req.user.email } });
});

app.get("/api/public/brandee/product-ads/config", asyncHandler(async (req, res) => {
  const [templates, videoStyles, pricing] = await Promise.all([
    templateCatalog.listActiveStaticTemplates({ hasTestimonial: false }),
    templateCatalog.listActiveUgcTemplates(),
    pricingOverride.getEffectivePricing()
  ]);
  res.json({
    templates,
    videoStyles,
    aspectRatios: Object.values(AD_ASPECT_RATIOS).map((r) => ({ id: r.id, label: r.label, placement: r.placement, recommended: r.recommended })),
    defaultAspectRatio: DEFAULT_ASPECT_RATIO,
    plans: pricing.plans,
    pricingSource: pricing.source,
    taxMode: pricing.taxMode,
    pricesAreTaxInclusive: pricing.pricesAreTaxInclusive,
    vatRatePercent: pricing.vatRatePercent,
    pricingNote: PRICING_NOTE,
    comboSavings: computeComboSavings(),
    pricingQuantitiesArePlaceholders: false,
    hookPreferences: HOOK_PREFERENCES,
    tones: TONES,
    creatorTypes: CREATOR_TYPES,
    settings: SETTINGS,
    desiredActions: ["buy_now", "send_message", "visit_product_page", "learn_more"],
    videoProvider: probeVideoProviderAvailability()
  });
}));

// PART 21 — a handful of funnel events (landing viewed, image/video
// selected, template/style selected, pricing viewed) happen client-side
// before any form submission reaches a server route that could log them
// itself, so the client posts them here. Only names in ALLOWED_EVENTS are
// ever accepted; anything else is silently dropped by track() itself.
app.post("/api/public/brandee/product-ads/track", requireProductAdTrackRateLimit, (req, res) => {
  const body = req.body || {};
  const anonymousSessionId = getOrSetBrandeeSessionId(req, res);
  trackBrandeeEvent(String(body.event || ""), body.properties || {}, { anonymousSessionId, userId: req.user?.id || null });
  res.status(204).end();
});

app.post("/api/public/brandee/product-ads/url-extract", requireProductAdRateLimit, asyncHandler(async (req, res) => {
  let body;
  try {
    body = ProductUrlExtractRequestSchema.parse(req.body);
  } catch (error) {
    return res.status(400).json({ ok: false, error: describeZodError(error, "Please enter a valid product page link.") });
  }
  const result = await extractProductFromUrl(body.url);
  if (!result.ok) {
    return res.json({ ok: false, reason: result.reason, message: result.message });
  }
  res.json({ ok: true, extracted: result.extracted });
}));

// "Analyze Product" (Phase 1 of the AI-assisted Image Ad Workspace). Runs
// product/business research + generates field suggestions the owner must
// explicitly review and apply — never auto-fills the form. Synchronous
// (like /image/preview and /image/revise above it), not a job queue —
// this app has no queue infrastructure and the spec explicitly says not to
// add one for this feature alone. Creates a draft project up front if the
// client doesn't have one yet, so a suggestion the owner accepts here can
// be persisted immediately and the same projectId flows into the existing
// /image/preview call later, exactly like an already-generated preview's
// projectId does today.
app.post("/api/public/brandee/product-ads/image/analyze", requireProductAdRateLimit, asyncHandler(async (req, res) => {
  const anonymousSessionId = getOrSetBrandeeSessionId(req, res);
  let body;
  try {
    body = AnalyzeProductRequestSchema.parse(req.body);
  } catch (error) {
    return res.status(400).json({ ok: false, error: describeZodError(error, "Please provide a template and at least a product link, business website, name, or description."), issues: error?.issues?.slice(0, 8) });
  }

  const template = await templateCatalog.getStaticTemplateBySlug(body.templateId);
  if (!template) return res.status(400).json({ ok: false, error: "Unknown template." });

  const userId = req.user?.id || null;
  let project = body.projectId ? await productAdProjectStore.getProject(body.projectId) : null;
  if (!project) project = await productAdProjectStore.createProject({ kind: "image", anonymousSessionId: userId ? null : anonymousSessionId, userId, product: {} });

  trackBrandeeEvent("image_analysis_requested", { templateId: body.templateId }, { anonymousSessionId, userId });

  const analysis = await analyzeProduct({
    productUrl: body.productUrl || null,
    businessWebsite: body.businessWebsite || null,
    productName: body.productName || null,
    productDescription: body.productDescription || null,
    template,
    existingFields: body.existingFields || {}
  });

  await productAdProjectStore.saveAnalysis(project.id, analysis);
  trackBrandeeEvent("image_analysis_completed", { templateId: body.templateId, suggestedFieldCount: analysis.suggestedFieldCount, aiUsed: analysis.aiUsed }, { anonymousSessionId, userId });

  res.json({ ok: true, projectId: project.id, analysis });
}));

// Owner's decision (accept/reject/edit) on one suggestion from the most
// recent analysis — persisted so reopening the workspace doesn't lose it.
// Does not itself change any form field; the client applies the value.
app.post("/api/public/brandee/product-ads/image/project/:id/suggestion-decision", requireProductAdTrackRateLimit, asyncHandler(async (req, res) => {
  const { suggestionId, decision } = req.body || {};
  if (!suggestionId || !["accepted", "rejected", "edited"].includes(decision)) {
    return res.status(400).json({ ok: false, error: "Invalid suggestion decision." });
  }
  const project = await productAdProjectStore.recordSuggestionDecision(req.params.id, suggestionId, decision);
  if (!project) return res.status(404).json({ ok: false, error: "Project not found." });
  res.json({ ok: true });
}));

// Per-field AI assist (the sparkle-icon popover). "suggest_from_research"
// reuses the project's existing analysis for this field when available —
// no extra AI call. Every other action makes one fresh, narrow AI call
// through the same model/timeout/fallback machinery as /image/analyze.
app.post("/api/public/brandee/product-ads/image/field-assist", requireProductAdRateLimit, asyncHandler(async (req, res) => {
  const anonymousSessionId = getOrSetBrandeeSessionId(req, res);
  let body;
  try {
    body = FieldAssistRequestSchema.parse(req.body);
  } catch (error) {
    return res.status(400).json({ ok: false, error: describeZodError(error, "Please provide a valid field and action."), issues: error?.issues?.slice(0, 8) });
  }
  const template = await templateCatalog.getStaticTemplateBySlug(body.templateId);
  if (!template) return res.status(400).json({ ok: false, error: "Unknown template." });

  const userId = req.user?.id || null;
  const project = body.projectId ? await productAdProjectStore.getProject(body.projectId) : null;
  const existingAnalysisSuggestions = project?.analysis?.fieldSuggestions?.[body.fieldKey] || [];

  const result = await generateFieldAssist({
    fieldKey: body.fieldKey,
    fieldLabel: body.fieldLabel,
    action: body.action,
    mode: body.mode,
    currentValue: body.currentValue || null,
    template,
    context: body.context || {},
    existingAnalysisSuggestions
  });

  trackBrandeeEvent("field_assist_requested", { templateId: body.templateId, fieldKey: body.fieldKey, action: body.action, aiUsed: result.aiUsed }, { anonymousSessionId, userId });
  res.json({ ok: true, ...result });
}));

// Pulls the embedded base64 image back out of an AI_GENERATED_LAYOUT SVG so
// it can be handed to GPT Image 2 as the reference for the next revision.
function extractEmbeddedImageDataUrl(svg) {
  const match = String(svg || "").match(/href="(data:image\/[a-z]+;base64,[^"]+)"/i);
  return match ? match[1] : null;
}

function requireValidImages(form) {
  const productImageCheck = validateImageDataUrl(form.productImage);
  if (!productImageCheck.ok) return { field: "productImage", ...productImageCheck };
  if (form.logo) {
    const logoCheck = validateImageDataUrl(form.logo);
    if (!logoCheck.ok) return { field: "logo", ...logoCheck };
  }
  for (const [i, img] of (form.additionalProductImages || []).entries()) {
    const check = validateImageDataUrl(img);
    if (!check.ok) return { field: `additionalProductImages[${i}]`, ...check };
  }
  return null;
}

app.post("/api/public/brandee/product-ads/image/preview", requireProductAdRateLimit, asyncHandler(async (req, res) => {
  const anonymousSessionId = getOrSetBrandeeSessionId(req, res);
  let form;
  try {
    form = ImageAdRequestSchema.parse(req.body);
  } catch (error) {
    return res.status(400).json({ ok: false, error: describeZodError(error, "Please complete the required product details."), issues: error?.issues?.slice(0, 8) });
  }

  const imageError = requireValidImages(form);
  if (imageError) return res.status(400).json({ ok: false, error: "One of the uploaded images could not be used.", detail: imageError });

  const hasTestimonial = hasRealTestimonial(form);
  const template = await templateCatalog.getStaticTemplateBySlug(form.templateId);
  if (!template) return res.status(400).json({ ok: false, error: "Unknown template." });
  if (template.proofRequirement === "testimonial" && !hasTestimonial) {
    return res.status(400).json({ ok: false, error: "That template isn't available yet — it requires a real testimonial." });
  }
  for (const field of template.fields) {
    if (field.required && !form.templateFields?.[field.key]) {
      return res.status(400).json({ ok: false, error: `"${field.label}" is required for the ${template.name} template.` });
    }
  }

  const userId = req.user?.id || null;
  let project = form.projectId ? await productAdProjectStore.getProject(form.projectId) : null;
  if (!project) project = await productAdProjectStore.createProject({ kind: "image", anonymousSessionId: userId ? null : anonymousSessionId, userId, product: form });

  if (!userId) {
    if (!productAdProjectStore.canGenerateAnonymousPreview(anonymousSessionId, "image")) {
      return res.status(403).json({ ok: false, code: "ANONYMOUS_PREVIEW_LIMIT_REACHED", error: "You've used your free image preview. Create a free account to keep going." });
    }
  }

  trackBrandeeEvent("image_preview_requested", { templateId: form.templateId }, { anonymousSessionId, userId });

  // Two render modes, decided per template by the Super Admin catalog:
  //
  // AI_GENERATED_LAYOUT — the template carries its own art direction
  // (imageGenPrompt). GPT-5.6 Sol merges that art direction with the
  // customer's field answers into one final prompt (composeImagePrompt),
  // and GPT Image 2 generates the ENTIRE ad from it using the customer's
  // real photo as the reference subject. Sol may only shorten the
  // customer's own words, never invent copy.
  //
  // COMPOSITE_TEMPLATE — the original path: Sol plans the copy, GPT Image 2
  // only cleans up the product photo's background, and the deterministic
  // SVG compositor lays out the text.
  //
  // Both degrade honestly: if Sol or GPT Image 2 is unavailable or fails,
  // this falls all the way back to the composite path (and then to the raw
  // uploaded photo), and NEVER shows a fabricated "generated" image or an
  // ad containing placeholder text.
  const wantsGeneratedLayout = template.renderMode === "AI_GENERATED_LAYOUT" && Boolean(template.imageGenPrompt) && Boolean(form.productImage);
  const ratio = getAspectRatio(form.aspectRatio);

  let rendered = null;
  let plan = null;
  let planningAiUsed = false;
  let imageAiUsed = false;
  let generatedLayout = false;

  if (wantsGeneratedLayout) {
    const composed = await composeImagePrompt({ form, template, templateFields: form.templateFields, aspectRatio: ratio.id });
    if (composed.prompt) {
      const genResult = await generatePreviewImage({
        prompt: composed.prompt,
        productImageDataUrl: form.productImage,
        width: ratio.width,
        height: ratio.height
      });
      if (genResult.ok) {
        rendered = renderGeneratedAdSvg({ imageDataUrl: `data:image/png;base64,${genResult.base64}`, watermark: true });
        plan = { generatedPrompt: composed.prompt, visibleText: composed.visibleText || null, mode: "AI_GENERATED_LAYOUT", aspectRatio: ratio.id };
        planningAiUsed = true;
        imageAiUsed = true;
        generatedLayout = true;
      } else {
        trackBrandeeEvent("image_generation_fallback", { templateId: form.templateId, reason: genResult.reason }, { anonymousSessionId, userId });
      }
    } else {
      trackBrandeeEvent("image_generation_fallback", { templateId: form.templateId, reason: composed.reason || "prompt_composition_failed" }, { anonymousSessionId, userId });
    }
  }

  if (!rendered) {
    const [planResult, imageGenResult] = await Promise.all([
      buildCreativePlan({ form, template }),
      form.productImage
        ? generatePreviewImage({
            prompt: `Professional product advertisement photography. Remove the plain background from this photo of "${form.productName || "the product"}" and place it on a clean, modern background with soft, warm studio lighting and a subtle shadow beneath it. Keep the product itself completely unchanged — same shape, same color, same details, same angle, same proportions. Do not add any text, logos, watermarks, or graphic overlays of any kind. Just a clean, premium product photo suitable as an ad background.`,
            productImageDataUrl: form.productImage,
            width: 1024,
            height: 1280
          })
        : Promise.resolve({ ok: false, reason: "no_product_image" })
    ]);
    plan = planResult.plan;
    planningAiUsed = planResult.aiUsed;
    imageAiUsed = imageGenResult.ok;
    const renderForm = imageAiUsed ? { ...form, productImage: `data:image/png;base64,${imageGenResult.base64}` } : form;
    if (!imageAiUsed && form.productImage && !wantsGeneratedLayout) {
      trackBrandeeEvent("image_generation_fallback", { templateId: form.templateId, reason: imageGenResult.reason }, { anonymousSessionId, userId });
    }
    rendered = renderImageAdSvg({ templateId: form.templateId, templateFields: form.templateFields, form: renderForm, watermark: true, override: plan });
  }

  if (!userId) productAdProjectStore.recordAnonymousPreview(anonymousSessionId, "image");
  await productAdProjectStore.updateProject(project.id, {
    templateId: form.templateId,
    templateFields: form.templateFields,
    product: form,
    status: "previewed"
  });
  await productAdProjectStore.addRevision(project.id, { instruction: null, plan, svg: rendered.svg, width: rendered.width, height: rendered.height, watermarked: true, aiUsed: planningAiUsed || imageAiUsed });

  trackBrandeeEvent("image_preview_completed", { templateId: form.templateId }, { anonymousSessionId, userId });

  res.json({ ok: true, projectId: project.id, svg: rendered.svg, width: rendered.width, height: rendered.height, plan, revisionNumber: 1, requiresRegistration: !userId });
}));

// PART 9 — up to 3 recommended templates for the customer's product, always
// drawn from the eligible (proof-safe) ACTIVE catalog. Deterministic by
// default; optionally polished by GPT-5.6 Sol if a planning provider is
// configured (see templateRecommender.js).
app.post("/api/public/brandee/product-ads/image/recommend", requireProductAdRateLimit, asyncHandler(async (req, res) => {
  let form;
  try {
    form = ImageAdRequestSchema.omit({ templateId: true }).extend({ templateId: z.string().optional() }).parse(req.body);
  } catch (error) {
    return res.status(400).json({ ok: false, error: "Please complete the required product details first." });
  }
  const hasTestimonial = hasRealTestimonial(form);
  const templates = await templateCatalog.listActiveStaticTemplates({ hasTestimonial });
  const { recommendations, aiUsed } = await recommendTemplates({ templates, form });
  res.json({ ok: true, recommendations, aiUsed });
}));

// PART 16/17 — apply a natural-language revision to the CURRENT preview
// (not a new concept from scratch). Every call appends a new, distinct
// revision entry; nothing is ever overwritten (PART 19).
app.post("/api/public/brandee/product-ads/image/revise", requireProductAdRateLimit, asyncHandler(async (req, res) => {
  const anonymousSessionId = getOrSetBrandeeSessionId(req, res);
  const body = z.object({
    projectId: z.string().min(1),
    instruction: z.string().min(2).max(300),
    // Optional image the customer attached with the revision ("match this
    // colour scheme", "use this logo"). Validated like every other upload.
    referenceImage: z.string().optional().nullable()
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ ok: false, error: "Please describe the revision you'd like." });

  const project = await productAdProjectStore.getProject(body.data.projectId);
  if (!project) return res.status(404).json({ ok: false, error: "Project not found." });
  const userId = req.user?.id || null;
  const owns = (userId && project.userId === userId) || (!project.userId && project.anonymousSessionId === anonymousSessionId);
  if (!owns) return res.status(403).json({ ok: false, error: "You don't have access to this project." });
  if (!project.templateId || !project.revisions?.length) return res.status(400).json({ ok: false, error: "Generate a preview first." });

  if (!userId) {
    if (!productAdProjectStore.canGenerateAnonymousRevision(anonymousSessionId, "image", { maxRevisions: BRANDEE_ANON_LIMITS.imageRevisionsPerSession })) {
      return res.status(403).json({ ok: false, code: "ANONYMOUS_REVISION_LIMIT_REACHED", error: "You've used your free revision. Create a free account to keep refining this ad." });
    }
  }

  const template = await templateCatalog.getStaticTemplateBySlug(project.templateId);
  if (!template) return res.status(400).json({ ok: false, error: "This project's template is no longer available." });

  const latest = project.revisions[project.revisions.length - 1];
  const currentContent = buildAdContent(project.templateId, project.templateFields, project.product, latest.plan);

  trackBrandeeEvent("revision_started", { templateId: project.templateId }, { anonymousSessionId, userId });

  // AI_GENERATED_LAYOUT revisions edit the CURRENT GENERATED IMAGE itself
  // (PART 17's "edit the current preview, preserve everything not asked to
  // change" — the image-edit call naturally preserves unrelated
  // composition). The previous version is never overwritten: this appends
  // a new revision row exactly like the composite path does. If the edit
  // fails, fall through to the deterministic copy-revision path below
  // rather than showing the customer nothing.
  if (latest.plan?.mode === "AI_GENERATED_LAYOUT") {
    const currentImage = extractEmbeddedImageDataUrl(latest.svg);
    if (currentImage) {
      // An attached reference must pass the same upload validation as the
      // product photo — never hand an unvalidated data URL to the provider.
      let referenceImage = null;
      if (body.data.referenceImage) {
        const check = validateImageDataUrl(body.data.referenceImage);
        if (!check.ok) return res.status(400).json({ ok: false, error: `Attached image: ${check.error}` });
        referenceImage = body.data.referenceImage;
      }
      const revisionRatio = getAspectRatio(latest.plan.aspectRatio || project.product?.aspectRatio);
      const edited = await editPreviewImage({
        prompt: [
          "Edit this existing advertisement image according to the instruction below.",
          "Preserve everything the instruction does not ask to change — same layout, same product, same colors, same text, same spelling.",
          "Do not add any text that is not already present or explicitly requested.",
          referenceImage ? "A second image is attached purely as a style/content reference for the instruction. The FIRST image is the advertisement being edited — keep its layout and composition. Do not replace the advertisement with the reference image." : null,
          `Instruction: ${body.data.instruction}`
        ].filter(Boolean).join(" "),
        currentPreviewDataUrl: currentImage,
        referenceImageDataUrl: referenceImage,
        width: revisionRatio.width,
        height: revisionRatio.height
      });
      if (edited.ok) {
        const rendered = renderGeneratedAdSvg({ imageDataUrl: `data:image/png;base64,${edited.base64}`, watermark: true });
        const revisedPlan = { ...latest.plan, lastInstruction: body.data.instruction };
        if (!userId) productAdProjectStore.recordAnonymousRevision(anonymousSessionId, "image");
        const updatedProject = await productAdProjectStore.addRevision(project.id, {
          instruction: body.data.instruction,
          plan: revisedPlan,
          svg: rendered.svg,
          width: rendered.width,
          height: rendered.height,
          watermarked: true,
          aiUsed: true
        });
        trackBrandeeEvent("revision_completed", { templateId: project.templateId }, { anonymousSessionId, userId });
        return res.json({
          ok: true,
          projectId: project.id,
          svg: rendered.svg,
          width: rendered.width,
          height: rendered.height,
          plan: revisedPlan,
          revisionNumber: updatedProject.revisions.length,
          revisionSummary: "Brandee applied your change to the image."
        });
      }
      trackBrandeeEvent("image_generation_fallback", { templateId: project.templateId, reason: edited.reason }, { anonymousSessionId, userId });
    }
  }

  const { revision, aiUsed } = await interpretRevision({ form: project.product, template, currentContent, instruction: body.data.instruction });
  if (revision.understood === false) {
    trackBrandeeEvent("revision_failed", { templateId: project.templateId, reason: "not_understood" }, { anonymousSessionId, userId });
    return res.status(422).json({
      ok: false,
      code: "REVISION_NOT_UNDERSTOOD",
      error: "Brandee couldn't quite understand that revision. Try being more specific — for example \"remove the price\" or \"make the headline shorter\"."
    });
  }

  // PART 17: merge only the keys the revision actually asked to change on
  // top of the CURRENT plan — everything else is preserved unchanged.
  const updatedPlan = {
    ...latest.plan,
    ...(revision.updatedCopy?.headline ? { headline: revision.updatedCopy.headline } : {}),
    ...(revision.updatedCopy?.subheadline !== undefined ? { subheadline: revision.updatedCopy.subheadline } : {}),
    ...(revision.updatedCopy?.cta ? { cta: revision.updatedCopy.cta } : {})
  };
  const safeUpdatedPlan = sanitizeCustomerFacingPlan(updatedPlan, project.product);

  const rendered = renderImageAdSvg({ templateId: project.templateId, templateFields: project.templateFields, form: project.product, watermark: true, override: safeUpdatedPlan });

  if (!userId) productAdProjectStore.recordAnonymousRevision(anonymousSessionId, "image");
  const updated = await productAdProjectStore.addRevision(project.id, {
    instruction: body.data.instruction,
    plan: safeUpdatedPlan,
    svg: rendered.svg,
    width: rendered.width,
    height: rendered.height,
    watermarked: true,
    aiUsed
  });

  trackBrandeeEvent("revision_completed", { templateId: project.templateId }, { anonymousSessionId, userId });

  res.json({
    ok: true,
    projectId: project.id,
    svg: rendered.svg,
    width: rendered.width,
    height: rendered.height,
    plan: safeUpdatedPlan,
    revisionNumber: updated.revisions.length,
    revisionSummary: revision.revisionSummary
  });
}));

// PART 19 — list/restore revision history. Restoring never deletes newer
// revisions; it appends a new entry that is a copy of the chosen one.
app.get("/api/public/brandee/product-ads/image/project/:id/revisions", asyncHandler(async (req, res) => {
  const anonymousSessionId = req.cookies?.[BRANDEE_SESSION_COOKIE] || null;
  const project = await productAdProjectStore.getProject(req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "Project not found." });
  const owns = (req.user && project.userId === req.user.id) || (!project.userId && project.anonymousSessionId === anonymousSessionId);
  if (!owns) return res.status(403).json({ ok: false, error: "You don't have access to this project." });
  const revisions = await productAdProjectStore.listRevisions(project.id);
  res.json({ ok: true, revisions: revisions.map((r) => ({ revisionNumber: r.revisionNumber, instruction: r.instruction, svg: r.svg, width: r.width, height: r.height, createdAt: r.createdAt })) });
}));

app.post("/api/public/brandee/product-ads/image/project/:id/restore", requireProductAdRateLimit, asyncHandler(async (req, res) => {
  const anonymousSessionId = req.cookies?.[BRANDEE_SESSION_COOKIE] || null;
  const body = z.object({ revisionNumber: z.number().int().positive() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ ok: false, error: "Invalid revision." });
  const project = await productAdProjectStore.getProject(req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "Project not found." });
  const owns = (req.user && project.userId === req.user.id) || (!project.userId && project.anonymousSessionId === anonymousSessionId);
  if (!owns) return res.status(403).json({ ok: false, error: "You don't have access to this project." });
  const updated = await productAdProjectStore.restoreRevision(project.id, body.data.revisionNumber);
  if (!updated) return res.status(404).json({ ok: false, error: "That revision could not be found." });
  const latest = updated.revisions[updated.revisions.length - 1];
  res.json({ ok: true, svg: latest.svg, width: latest.width, height: latest.height, revisionNumber: latest.revisionNumber });
}));

app.post("/api/public/brandee/product-ads/video/preview", requireProductAdRateLimit, asyncHandler(async (req, res) => {
  const anonymousSessionId = getOrSetBrandeeSessionId(req, res);
  let form;
  try {
    form = VideoAdRequestSchema.parse(req.body);
  } catch (error) {
    return res.status(400).json({ ok: false, error: describeZodError(error, "Please complete the required product details."), issues: error?.issues?.slice(0, 8) });
  }

  const imageError = requireValidImages(form);
  if (imageError) return res.status(400).json({ ok: false, error: "One of the uploaded images could not be used.", detail: imageError });

  const style = await templateCatalog.getUgcTemplateBySlug(form.styleId);
  if (!style) return res.status(400).json({ ok: false, error: "Unknown video style." });

  const userId = req.user?.id || null;
  let project = form.projectId ? await productAdProjectStore.getProject(form.projectId) : null;
  if (!project) project = await productAdProjectStore.createProject({ kind: "video", anonymousSessionId: userId ? null : anonymousSessionId, userId, product: form });

  if (!userId) {
    if (!productAdProjectStore.canGenerateAnonymousPreview(anonymousSessionId, "video")) {
      return res.status(403).json({ ok: false, code: "ANONYMOUS_PREVIEW_LIMIT_REACHED", error: "You've used your free video preview. Create a free account to keep going." });
    }
  }

  trackBrandeeEvent("video_preview_requested", { styleId: form.styleId }, { anonymousSessionId, userId });

  const hookText = form.hookPreference ? `${form.mainBenefit || form.productName} — ${form.hookPreference}` : (form.mainBenefit || form.productName);
  const result = await generateVideoTeaser({
    projectId: project.id,
    styleId: form.styleId,
    hookText,
    headline: form.productName,
    ctaText: form.ctaText || "Learn more",
    productImageDataUrl: form.productImage,
    brandColor: (form.brandColors && form.brandColors[0]) || "#0f172a"
  });

  if (!result.ok) {
    trackBrandeeEvent("preview_failed", { styleId: form.styleId, reason: result.reason }, { anonymousSessionId, userId });
    await productAdProjectStore.updateProject(project.id, { styleId: form.styleId, videoFields: form, product: form, status: "draft" });
    return res.status(503).json({ ok: false, projectId: project.id, reason: result.reason, error: result.message });
  }

  if (!userId) productAdProjectStore.recordAnonymousPreview(anonymousSessionId, "video");
  await productAdProjectStore.updateProject(project.id, {
    styleId: form.styleId,
    videoFields: form,
    product: form,
    preview: { generatedAt: new Date().toISOString(), watermarked: true, url: result.relativeUrl, durationSeconds: result.durationSeconds },
    status: "previewed"
  });

  trackBrandeeEvent("video_preview_completed", { styleId: form.styleId }, { anonymousSessionId, userId });

  res.json({
    ok: true,
    projectId: project.id,
    url: result.relativeUrl,
    durationSeconds: result.durationSeconds,
    hookText,
    concept: style.description,
    requiresRegistration: !userId
  });
}));

app.get("/api/public/brandee/product-ads/project/:id", asyncHandler(async (req, res) => {
  const anonymousSessionId = req.cookies?.[BRANDEE_SESSION_COOKIE] || null;
  const project = await productAdProjectStore.getProject(req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "Project not found." });
  const owns = (req.user && project.userId === req.user.id) || (!project.userId && project.anonymousSessionId === anonymousSessionId);
  if (!owns) return res.status(403).json({ ok: false, error: "You don't have access to this project." });
  res.json({ ok: true, project });
}));

app.post("/api/auth/register", asyncHandler(async (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    companyName: z.string().optional().nullable(),
    projectId: z.string().optional().nullable()
  }).parse(req.body);

  trackBrandeeEvent("registration_started", {}, {});

  let user;
  try {
    user = await registerAccount(body);
  } catch (error) {
    if (error instanceof RegistrationError) {
      return res.status(400).json({ ok: false, code: error.code, error: error.message });
    }
    throw error;
  }

  const token = signSession(user);
  setSessionCookie(res, token);

  if (body.projectId) {
    const project = await productAdProjectStore.getProject(body.projectId);
    const anonymousSessionId = req.cookies?.[BRANDEE_SESSION_COOKIE] || null;
    if (project && !project.userId && project.anonymousSessionId === anonymousSessionId) {
      await productAdProjectStore.claimProjectForUser(body.projectId, user.id);
    }
  }

  trackBrandeeEvent("registration_completed", {}, { userId: user.id });

  res.json({ ok: true, user: { id: user.id, company_id: user.company_id, name: user.name, email: user.email, role: user.role } });
}));

// Save & Finish: claims the project for the signed-in customer and marks
// it saved, so it can be reopened later from "My ads". Also fixes the
// orphan case where someone STARTED anonymously and then logged in rather
// than registering — claimProjectForUser previously only ran during
// registration, leaving those projects unreachable ("You don't have
// access to this project").
app.post("/api/brandee/product-ads/image/save", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ projectId: z.string().min(1) }).parse(req.body);
  const anonymousSessionId = req.cookies?.[BRANDEE_SESSION_COOKIE] || null;
  const project = await productAdProjectStore.getProject(body.projectId);
  if (!project) return res.status(404).json({ ok: false, error: "Project not found." });

  const ownedByUser = project.userId === req.user.id;
  const claimable = !project.userId && project.anonymousSessionId === anonymousSessionId;
  if (!ownedByUser && !claimable) return res.status(403).json({ ok: false, error: "You don't have access to this project." });
  if (claimable) await productAdProjectStore.claimProjectForUser(project.id, req.user.id);

  await productAdProjectStore.updateProject(project.id, { status: "saved" });
  trackBrandeeEvent("image_save_finish_clicked", {}, { userId: req.user.id });
  res.json({ ok: true, projectId: project.id });
}));

// "My ads" — the customer's saved projects. listProjectsForUser already
// existed in the store but had no endpoint in front of it, so there was
// no way back into a past design once the tab was closed.
app.get("/api/brandee/product-ads/projects", requireAuth, asyncHandler(async (req, res) => {
  const projects = await productAdProjectStore.listProjectsForUser(req.user.id);
  res.json({
    ok: true,
    projects: projects.map((p) => ({
      id: p.id,
      kind: p.kind,
      templateId: p.templateId,
      productName: p.product?.productName || null,
      aspectRatio: p.product?.aspectRatio || null,
      status: p.status,
      revisionCount: p.revisions?.length || 0,
      updatedAt: p.updatedAt || p.createdAt
    }))
  });
}));

app.get("/api/brandee/product-ads/subscription-status", requireAuth, asyncHandler(async (req, res) => {
  const subscription = await getActiveBrandeeSubscriptionForUser(req.user.id);
  res.json({ ok: true, active: Boolean(subscription), subscription });
}));

app.post("/api/brandee/product-ads/subscribe", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ planSlug: z.string().min(1), billingFrequency: z.enum(["monthly", "annual"]).default("monthly") }).parse(req.body);
  const plan = getBrandeePlan(body.planSlug);
  if (!plan) return res.status(400).json({ ok: false, error: "Selected plan is not available." });

  trackBrandeeEvent("subscription_started", { planSlug: body.planSlug }, { userId: req.user.id });
  const { subscription, testMode } = await subscribeUserToPlan({ user: req.user, planSlug: body.planSlug, billingFrequency: body.billingFrequency });
  trackBrandeeEvent("subscription_completed", { planSlug: body.planSlug }, { userId: req.user.id });

  res.json({ ok: true, subscription, testMode, message: testMode ? "Test-mode subscription activated (no real payment was collected — PAYMENT_MODE is not \"live\")." : "Your order was created and is awaiting payment confirmation." });
}));

app.post("/api/brandee/product-ads/image/final", requireAuth, requireBrandeeSubscription(), asyncHandler(async (req, res) => {
  const body = z.object({ projectId: z.string().min(1) }).parse(req.body);
  const project = await productAdProjectStore.getProject(body.projectId);
  if (!project || project.userId !== req.user.id) return res.status(404).json({ ok: false, error: "Project not found." });
  if (!project.templateId) return res.status(400).json({ ok: false, error: "Choose a template and generate a preview first." });

  const subscription = req.brandeeSubscription;
  const idempotencyKey = `image-final:${project.id}`;

  trackBrandeeEvent("final_generation_started", { kind: "image" }, { userId: req.user.id });

  let outcome;
  try {
    outcome = await entitlements.withReservedEntitlement(
      { customerId: subscription.customer_id, subscriptionId: subscription.id, subscription, unit: ENTITLEMENT_UNITS.IMAGE_FINAL, amount: 1, projectId: project.id, idempotencyKey },
      async () => {
        // PART 22/28: use the customer's latest APPROVED revision — never a
        // fresh, different concept — only the watermark is removed and the
        // resolution changes. For AI_GENERATED_LAYOUT projects the approved
        // artwork IS the generated image, so unwrap and re-wrap it clean
        // rather than re-compositing it through the SVG text layer (which
        // would double up the copy already baked into the image).
        const latest = project.revisions?.[project.revisions.length - 1];
        if (latest?.plan?.mode === "AI_GENERATED_LAYOUT") {
          const approvedImage = extractEmbeddedImageDataUrl(latest.svg);
          if (approvedImage) {
            return { ok: true, rendered: renderGeneratedAdSvg({ imageDataUrl: approvedImage, watermark: false }) };
          }
        }
        const rendered = renderImageAdSvg({ templateId: project.templateId, templateFields: project.templateFields, form: project.product, watermark: false, override: latest?.plan || null });
        return { ok: true, rendered };
      }
    );
  } catch (error) {
    if (error.code === "INSUFFICIENT_ENTITLEMENT") {
      return res.status(402).json({ ok: false, code: "ENTITLEMENT_EXHAUSTED", error: "You've used all of your image ads for this billing period.", remaining: error.remaining });
    }
    throw error;
  }

  const { rendered } = outcome;
  await productAdProjectStore.updateProject(project.id, {
    finalAsset: { generatedAt: new Date().toISOString(), svg: rendered.svg, width: rendered.width, height: rendered.height },
    status: "finalized"
  });
  trackBrandeeEvent("final_generation_completed", { kind: "image" }, { userId: req.user.id });

  // AI_GENERATED_LAYOUT finals are a real PNG underneath the SVG wrapper.
  // Hand that PNG back directly so the browser can save a file the
  // customer can actually upload to Meta — an SVG is not a valid Facebook
  // ad asset (Meta accepts JPG/PNG only).
  const finalPng = extractEmbeddedImageDataUrl(rendered.svg);
  res.json({ ok: true, svg: rendered.svg, width: rendered.width, height: rendered.height, pngDataUrl: finalPng || null });
}));

app.post("/api/brandee/product-ads/video/final", requireAuth, requireBrandeeSubscription(), asyncHandler(async (req, res) => {
  const body = z.object({ projectId: z.string().min(1) }).parse(req.body);
  const project = await productAdProjectStore.getProject(body.projectId);
  if (!project || project.userId !== req.user.id) return res.status(404).json({ ok: false, error: "Project not found." });
  if (!project.styleId) return res.status(400).json({ ok: false, error: "Choose a video style and generate a preview first." });

  const subscription = req.brandeeSubscription;
  const form = project.videoFields || project.product;
  const requestedSeconds = Math.max(1, Math.min(60, form.preferredFinalLength || 30));
  const idempotencyKey = `video-final:${project.id}`;

  trackBrandeeEvent("final_generation_started", { kind: "video" }, { userId: req.user.id });

  const hookText = form.hookPreference ? `${form.mainBenefit || form.productName} — ${form.hookPreference}` : (form.mainBenefit || form.productName);

  let outcome;
  try {
    outcome = await entitlements.withReservedEntitlement(
      { customerId: subscription.customer_id, subscriptionId: subscription.id, subscription, unit: ENTITLEMENT_UNITS.VIDEO_SECONDS, amount: requestedSeconds, projectId: project.id, idempotencyKey },
      () => generateFinalVideo({
        projectId: project.id,
        styleId: project.styleId,
        hookText,
        headline: form.productName,
        ctaText: form.ctaText || "Learn more",
        productImageDataUrl: form.productImage,
        brandColor: (form.brandColors && form.brandColors[0]) || "#0f172a",
        durationSeconds: requestedSeconds
      })
    );
  } catch (error) {
    if (error.code === "INSUFFICIENT_ENTITLEMENT") {
      return res.status(402).json({ ok: false, code: "ENTITLEMENT_EXHAUSTED", error: "You don't have enough video seconds remaining this billing period.", remaining: error.remaining });
    }
    throw error;
  }

  if (!outcome.ok) {
    return res.status(503).json({ ok: false, reason: outcome.reason, error: outcome.message });
  }

  await productAdProjectStore.updateProject(project.id, {
    finalAsset: { generatedAt: new Date().toISOString(), url: outcome.relativeUrl, durationSeconds: outcome.durationSeconds },
    status: "finalized"
  });
  trackBrandeeEvent("final_generation_completed", { kind: "video" }, { userId: req.user.id });

  res.json({ ok: true, url: outcome.relativeUrl, durationSeconds: outcome.durationSeconds });
}));

app.get("/api/brandee/product-ads/entitlements", requireAuth, requireBrandeeSubscription(), asyncHandler(async (req, res) => {
  const subscription = req.brandeeSubscription;
  const [imageBalance, videoBalance] = await Promise.all([
    entitlements.getBalance({ customerId: subscription.customer_id, subscription, unit: ENTITLEMENT_UNITS.IMAGE_FINAL }),
    entitlements.getBalance({ customerId: subscription.customer_id, subscription, unit: ENTITLEMENT_UNITS.VIDEO_SECONDS })
  ]);
  res.json({
    ok: true,
    imageFinalRemaining: imageBalance.remaining,
    imageFinalAllowance: imageBalance.monthlyAllowance,
    videoSecondsRemaining: videoBalance.remaining,
    videoSecondsAllowance: videoBalance.monthlyAllowance,
    approxThirtySecondVideosRemaining: Math.floor(videoBalance.remaining / 30)
  });
}));

// Deprecated old entry points (PART 24). The actual redirect customers hit
// is served by express.static from the replaced HTML content at
// public/agents/brandee/create/index.html and .../analyze/index.html
// (client-side meta-refresh + JS redirect, since express.static is
// registered earlier and serves those files before these routes could ever
// be reached for an exact path match). These two routes are a defensive
// fallback for any request path variant that isn't resolved by the static
// file itself (e.g. no trailing slash on hosts where static redirect
// behavior differs). The underlying business-analysis engine (crawler/
// planner/etc.) and its API routes are NOT deleted. Existing saved plans at
// /agents/brandee/plan/:planId are untouched and still work.
app.get(["/agents/brandee/create", "/agents/brandee/create/"], (req, res) => {
  res.redirect(302, "/agents/brandee/");
});
app.get(["/agents/brandee/analyze", "/agents/brandee/analyze/"], (req, res) => {
  res.redirect(302, "/agents/brandee/");
});

app.post("/api/page-intelligence/preview", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    facebookPage: z.string().optional().nullable(),
    website: z.string().optional().nullable(),
    pageName: z.string().optional().nullable()
  }).parse(req.body);

  const snapshot = await buildPresenceSnapshot({
    facebookInput: body.facebookPage || body.pageName,
    websiteInput: body.website,
    requestedPageName: body.pageName || ""
  });

  res.json({
    ok: snapshot.ok,
    snapshot,
    messengerPreview: formatSnapshotForMessenger(snapshot)
  });
}));

app.get("/api/onboarding-status", requireAuth, asyncHandler(async (req, res) => {
  const [company, settings, kbCount, questionCount, pages, leadCount] = await Promise.all([
    prisma.company.findUnique({ where: { id: req.companyId } }),
    prisma.companySetting.findUnique({ where: { company_id: req.companyId } }),
    prisma.knowledgeBase.count({ where: { company_id: req.companyId, active: true } }),
    prisma.qualificationQuestion.count({ where: { company_id: req.companyId, active: true } }),
    prisma.facebookPage.count({ where: { company_id: req.companyId, status: "active" } }),
    prisma.lead.count({ where: { company_id: req.companyId } })
  ]);

  res.json({
    companyProfile: Boolean(company?.name && company?.industry),
    settingsConfigured: Boolean(settings?.ai_enabled && settings?.auto_reply_enabled),
    knowledgeBase: kbCount >= 3,
    knowledgeBaseCount: kbCount,
    qualificationQuestions: questionCount >= 3,
    qualificationQuestionCount: questionCount,
    facebookPageConnected: pages > 0,
    facebookPageCount: pages,
    hasLeads: leadCount > 0,
    leadCount,
    notifyEmail: settings?.notify_email || null
  });
}));

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);

  // Keyed on IP + address so one attacker cannot spray many accounts, and one
  // account cannot be hammered from a single machine. Message stays generic:
  // a distinct "rate limited" reply on a real address would leak that it
  // exists, which is exactly what the generic 401 below avoids.
  const limitKey = `${clientIp(req)}:${body.email.toLowerCase()}`;
  const limited = loginRateLimiter.check(limitKey);
  if (!limited.allowed) {
    return res.status(429).json({
      error: "Too many sign-in attempts. Please wait a few minutes and try again.",
      retryAfterMs: limited.retryAfterMs
    });
  }

  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || user.status !== "active") return res.status(401).json({ error: "Invalid email or password" });
  const ok = await verifyPassword(user.password_hash, body.password);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });
  loginRateLimiter.reset(limitKey);
  const token = signSession(user);
  setSessionCookie(res, token);
  res.json({ user: { id: user.id, company_id: user.company_id, name: user.name, email: user.email, role: user.role } });
}));

// ---------------------------------------------------------------------
// Password reset. NEW routes — /api/auth/login is untouched, and no
// Meta-reviewed URL moves. See HANDOFF-CLOSER.md §12.
// ---------------------------------------------------------------------

// Admin view of demo sessions — this answers "where can I see the knowledge
// base that was scraped?". Before demo_sessions existed the scrape was
// formatted into a message and discarded, so there was nothing to look at.
app.get("/api/demo-sessions", requireAuth, asyncHandler(async (req, res) => {
  const sessions = await prisma.demoSession.findMany({
    orderBy: { created_at: "desc" },
    take: 50
  });
  res.json({
    sessions: sessions.map((session) => {
      const facts = extractFacts(session.snapshot);
      return {
        id: session.id,
        name: session.name,
        email: session.email,
        mobile_number: session.mobile_number,
        business_name: session.business_name,
        website_url: session.website_url,
        facebook_url: session.facebook_url,
        scrape_status: session.scrape_status,
        scrape_error: session.scrape_error,
        fact_count: facts.factCount,
        service_hints: facts.serviceHints,
        message_count: session.message_count,
        sms_sent: session.sms_sent,
        created_at: session.created_at,
        expires_at: session.expires_at
      };
    })
  });
}));

// Full scraped knowledge base for one session — what the agent actually knew.
app.get("/api/demo-sessions/:id", requireAuth, asyncHandler(async (req, res) => {
  const session = await prisma.demoSession.findUnique({ where: { id: req.params.id } });
  if (!session) return res.status(404).json({ error: "Not found" });
  const { buildDemoPrompt } = require("./demo-agent");
  res.json({
    session,
    facts: extractFacts(session.snapshot),
    // The exact prompt the agent ran with — so a weak demo can be diagnosed
    // rather than guessed at.
    prompt: await buildDemoPrompt(session)
  });
}));

// ---------------------------------------------------------------------
// Public demo. New routes; nothing Meta-reviewed is touched (§12).
// ---------------------------------------------------------------------

app.post("/api/public/demo/start", asyncHandler(async (req, res) => {
  const body = z.object({
    website_url: z.string().trim().max(1000).optional().nullable(),
    facebook_url: z.string().optional().nullable(),
    product_description: z.string().trim().max(5000).optional().nullable(),
    has_price_file: z.boolean().optional().default(false)
  }).parse(req.body);

  const websiteInput = String(body.website_url || "").trim();
  const websiteUrl = websiteInput && /^https?:\/\//i.test(websiteInput) ? websiteInput : (websiteInput ? `https://${websiteInput}` : "");
  const productDescription = String(body.product_description || "").trim();
  const hasPriceFile = Boolean(body.has_price_file);

  if (!websiteUrl && !productDescription && !hasPriceFile) {
    // Facebook was dropped as an input: logged out it serves a block page
    // (measured at ~1.5KB, <title>Error</title>), and automating a logged-in
    // session would risk the published Meta app (§12).
    return res.status(400).json({ ok: false, error: "Add a website, product description, or upload a photo or price list so the agent has something to learn from." });
  }
  if (!demoStartRateLimiter.check(clientIp(req)).allowed) {
    return res.status(429).json({ ok: false, error: "Too many demo starts from this connection. Please try again shortly." });
  }
  let demoName = "Demo business";
  if (websiteUrl) {
    try {
      demoName = new URL(websiteUrl).hostname.replace(/^www\./, "");
    } catch (error) {
      demoName = "Demo business";
    }
  } else if (productDescription) {
    demoName = productDescription.split(/\s+/).slice(0, 5).join(" ");
  }

  const session = await createDemoSession({
    name: demoName,
    email: `demo-${crypto.randomUUID()}@aistaff.local`,
    websiteUrl,
    facebookUrl: null,
    mobile: null,
    productDescription,
    ip: clientIp(req)
  });

  // Scrape inline: the prospect is waiting and the value IS the scrape.
  const scraped = await runScrape(session.id);
  const facts = extractFacts(scraped && scraped.snapshot);

  res.json({
    ok: true,
    sessionId: session.id,
    status: scraped ? scraped.scrape_status : "failed",
    businessName: facts.businessName || null,
    factCount: facts.factCount
  });
}));

app.post("/api/public/demo/price-list", asyncHandler(async (req, res) => {
  // base64 JSON rather than multipart: no new upload middleware, and the files
  // are price lists (a few hundred KB), not media.
  const body = z.object({
    sessionId: z.string().uuid(),
    filename: z.string().min(1).max(200),
    mimeType: z.string().min(3).max(120),
    data: z.string().min(10)
  }).parse(req.body);

  if (!demoChatRateLimiter.check(clientIp(req)).allowed) {
    return res.json({ ok: false, error: "Please wait a moment before uploading again." });
  }

  const session = await prisma.demoSession.findUnique({ where: { id: body.sessionId } });
  if (!session) return res.json({ ok: false, error: "Demo session not found." });
  if (session.expires_at < new Date()) return res.json({ ok: false, error: "This demo has expired." });

  const base64 = body.data.indexOf(",") !== -1 ? body.data.split(",").pop() : body.data;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > MAX_BYTES) {
    return res.json({ ok: false, error: "That file is too large. Please keep it under 8MB." });
  }

  const result = await extractPriceList({
    buffer,
    mimeType: body.mimeType,
    filename: body.filename
  });

  if (!result.ok) {
    const messages = {
      unsupported_type: "Please upload an image, PDF, Excel file or Word document.",
      nothing_readable: "We could not read any text from that file. Try a clearer image?",
      file_too_large: "That file is too large. Please keep it under 8MB.",
      empty_file: "That file appears to be empty."
    };
    return res.json({ ok: false, error: messages[result.reason] || "We could not read that file." });
  }

  const previousText = String(session.price_list_text || "").trim();
  const nextBlock = [`Source file: ${body.filename}`, result.text].join("\n").trim();
  const combinedText = [previousText, nextBlock].filter(Boolean).join("\n\n---\n\n");
  const previousName = String(session.price_list_name || "").trim();
  const combinedName = [previousName, body.filename].filter(Boolean).join(", ");

  await prisma.demoSession.update({
    where: { id: session.id },
    data: {
      price_list_text: combinedText,
      price_list_kind: result.kind,
      price_list_name: combinedName,
      price_currency: detectCurrency(combinedText, session.website_url)
    }
  });

  const lineCount = result.text.split("\n").filter((l) => l.trim()).length;
  res.json({ ok: true, kind: result.kind, lines: lineCount, preview: result.text.slice(0, 400) });
}));

app.post("/api/public/demo/chat", asyncHandler(async (req, res) => {
  const body = z.object({
    sessionId: z.string().uuid(),
    messages: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1).max(2000)
    })).min(1).max(40)
  }).parse(req.body);

  if (!demoChatRateLimiter.check(clientIp(req)).allowed) {
    return res.status(429).json({ ok: false, error: "Slow down a moment, then try again." });
  }

  const session = await prisma.demoSession.findUnique({ where: { id: body.sessionId } });
  if (!session) return res.status(404).json({ ok: false, error: "Demo session not found." });
  if (session.expires_at < new Date()) {
    return res.status(410).json({ ok: false, error: "This demo has expired. Start a new one." });
  }
  if (session.message_count >= MAX_MESSAGES_PER_SESSION) {
    return res.status(429).json({ ok: false, error: "This demo session reached the testing limit. Start a new demo to continue." });
  }
  const result = await replyToDemoMessage({ session, messages: body.messages });
  await prisma.demoSession.update({
    where: { id: session.id },
    data: { message_count: { increment: 1 } }
  });

  if (!result.ok) {
    // 200, deliberately. Cloudflare replaces a 5xx body with its own HTML
    // error page, so the browser's res.json() throws "Unexpected token '<'"
    // and the real reason never reaches the client.
    return res.json({ ok: false, error: result.error, retryable: true });
  }
  res.json({ ok: true, reply: result.reply, actions: result.actions });
}));

app.post("/api/public/demo/decision", asyncHandler(async (req, res) => {
  const optionalText = (max) => z.preprocess(
    (value) => String(value || "").trim() || null,
    z.string().max(max).nullable()
  );
  const optionalEmail = z.preprocess(
    (value) => String(value || "").trim() || null,
    z.string().email().max(160).nullable()
  );
  const body = z.object({
    sessionId: z.string().uuid(),
    action: z.enum(["book_consultation", "purchase_now", "not_yet"]),
    name: optionalText(120),
    email: optionalEmail,
    mobile: optionalText(40),
    preferredDate: optionalText(40),
    preferredTime: optionalText(40),
    preferredSchedule: optionalText(200),
    reasons: z.array(z.string().trim().min(1).max(160)).max(12).optional().default([]),
    notes: optionalText(3000)
  }).parse(req.body);

  const session = await prisma.demoSession.findUnique({ where: { id: body.sessionId } });
  if (!session) return res.status(404).json({ ok: false, error: "Demo session not found." });
  if (session.expires_at < new Date()) {
    return res.status(410).json({ ok: false, error: "This demo has expired. Start a new one." });
  }

  const actionMeta = {
    purchase_now: {
      label: "I Want This",
      score: "hot",
      service: "AIStaff subscription purchase interest",
      status: "new",
      message: "Got it. We received your details and will help you start with the right package."
    },
    book_consultation: {
      label: "Book a Consultation",
      score: "hot",
      service: "AIStaff consultation booking",
      status: "new",
      message: "Done. Your consultation is booked. We saved it to our calendar and sent the meeting details."
    },
    not_yet: {
      label: "Not Yet",
      score: "cold",
      service: "AIStaff demo feedback",
      status: "new",
      message: "Feedback saved. Thank you."
    }
  }[body.action];

  if (body.action !== "not_yet" && (!body.name || !body.email || !body.mobile)) {
    return res.status(400).json({ ok: false, error: "Full name, email, and mobile number are required for this next step." });
  }
  const consultationStart = body.action === "book_consultation"
    ? parseManilaDateTime(body.preferredDate, body.preferredTime)
    : null;
  if (body.action === "book_consultation" && !consultationStart) {
    return res.status(400).json({ ok: false, error: "Choose a valid consultation date and time." });
  }

  const companyId = AISTAFF_INTERNAL_COMPANY_ID;
  const visitorName = body.name || `Demo visitor ${session.id.slice(0, 6).toUpperCase()}`;
  const psid = `demo_decision_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const sessionFacts = extractFacts(session.snapshot);
  const businessName = sessionFacts.businessName || session.business_name || session.name || "Demo business";
  const notes = [
    `Demo decision: ${actionMeta.label}`,
    `Lead temperature: ${actionMeta.score}`,
    `Demo business: ${businessName}`,
    session.website_url ? `Website: ${session.website_url}` : "",
    session.price_list_name ? `Uploaded files: ${session.price_list_name}` : "",
    body.preferredDate ? `Preferred date: ${body.preferredDate}` : "",
    body.preferredTime ? `Preferred time: ${body.preferredTime}` : "",
    body.preferredSchedule ? `Preferred schedule: ${body.preferredSchedule}` : "",
    body.reasons.length ? `Reasons: ${body.reasons.join("; ")}` : "",
    body.notes ? `Notes: ${body.notes}` : "",
    `Demo session: ${session.id}`
  ].filter(Boolean).join("\n");

  let consultationContext = null;
  if (body.action === "book_consultation") {
    const [company, companySetting, bookingSetting] = await Promise.all([
      prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } }),
      prisma.companySetting.findUnique({ where: { company_id: companyId }, select: { notify_email: true } }),
      ensureBookingSetting(companyId)
    ]);
    const serviceName = "AIStaff consultation";
    const service = await prisma.bookingService.findFirst({
      where: { company_id: companyId, name: serviceName, active: true },
      orderBy: { created_at: "asc" }
    }) || await prisma.bookingService.create({
      data: {
        company_id: companyId,
        name: serviceName,
        description: "Consultation call from the public Closer demo.",
        duration_minutes: 60,
        location: "Jitsi video call",
        active: true,
        display_order: 0
      }
    });
    const end = new Date(consultationStart.getTime() + service.duration_minutes * 60 * 1000);
    if (bookingNeedsExclusiveTime(bookingSetting, serviceName, { preferred_meeting_channel: "Jitsi video call", purpose: "AIStaff consultation" })) {
      const conflict = await prisma.booking.findFirst({
        where: {
          company_id: companyId,
          status: { in: ["requested", "pending_confirmation", "confirmed", "paid"] },
          start_at: { lt: end },
          end_at: { gt: consultationStart }
        },
        orderBy: { start_at: "asc" }
      });
      if (conflict) {
        return res.status(409).json({
          ok: false,
          error: "That consultation time is already taken. Please choose another date or time."
        });
      }
    }
    consultationContext = {
      company,
      companySetting,
      service,
      serviceName,
      end,
      meetingLink: buildJitsiMeetingLink(company?.name || "AIStaff", consultationStart)
    };
  }

  const conversation = await prisma.conversation.create({
    data: {
      company_id: companyId,
      psid,
      customer_name: visitorName,
      channel: "public_demo",
      status: "open",
      intent: `demo_${body.action}`,
      lead_score: actionMeta.score,
      last_message_at: new Date()
    }
  });

  await prisma.message.create({
    data: {
      company_id: companyId,
      conversation_id: conversation.id,
      sender_type: "customer",
      sender_id: psid,
      message_text: notes
    }
  });

  const lead = await prisma.lead.create({
    data: {
      company_id: companyId,
      conversation_id: conversation.id,
      customer_name: visitorName,
      mobile_number: body.mobile,
      email: body.email,
      company_name: businessName,
      location: session.website_url,
      service_needed: actionMeta.service,
      urgency: body.preferredSchedule,
      notes,
      lead_status: actionMeta.status,
      lead_score: actionMeta.score,
      quotation_ready: body.action === "purchase_now"
    }
  });

  let booking = null;
  if (body.action === "book_consultation") {
    const bookingNotes = [
      `Public demo consultation for ${businessName}.`,
      session.website_url ? `Website tested: ${session.website_url}` : "",
      session.price_list_name ? `Uploaded files: ${session.price_list_name}` : "",
      body.notes ? `Customer notes: ${body.notes}` : ""
    ].filter(Boolean).join("\n");
    booking = await prisma.booking.create({
      data: {
        company_id: companyId,
        service_id: consultationContext.service.id,
        lead_id: lead.id,
        conversation_id: conversation.id,
        customer_name: visitorName,
        mobile_number: body.mobile,
        email: body.email,
        service_name: consultationContext.serviceName,
        start_at: consultationStart,
        end_at: consultationContext.end,
        status: "confirmed",
        source: "public_demo",
        field_values: {
          business_name: businessName,
          preferred_date: body.preferredDate,
          preferred_time: body.preferredTime,
          preferred_meeting_channel: "Jitsi video call",
          purpose: "consultation",
          meeting_link: consultationContext.meetingLink,
          reminder_plan: "Email reminders are planned 1 day and 6 hours before the meeting."
        },
        notes: bookingNotes
      },
      include: { service: true }
    });

    const reminderRows = [
      { label: "1 day before", due: new Date(consultationStart.getTime() - 24 * 60 * 60 * 1000) },
      { label: "6 hours before", due: new Date(consultationStart.getTime() - 6 * 60 * 60 * 1000) }
    ].filter((item) => item.due > new Date()).map((item) => ({
      company_id: companyId,
      lead_id: lead.id,
      conversation_id: conversation.id,
      due_date: item.due,
      status: "pending",
      note: `${item.label} consultation reminder: ${visitorName} for ${formatManilaSchedule(consultationStart)}. Meeting link: ${consultationContext.meetingLink}`
    }));
    if (reminderRows.length) {
      await prisma.followUp.createMany({ data: reminderRows });
      await prisma.lead.update({
        where: { id: lead.id },
        data: { follow_up_date: reminderRows[0].due }
      });
    }

    const recipients = [consultationContext.companySetting?.notify_email, process.env.ADMIN_ALERT_EMAIL || process.env.SEED_ADMIN_EMAIL]
      .filter(Boolean);
    await Promise.all([
      ...recipients.map((to) => notifyBookingCreated({ to, companyName: consultationContext.company?.name || "AIStaff", booking, audience: "staff" })),
      body.email ? notifyBookingCreated({ to: body.email, companyName: consultationContext.company?.name || "AIStaff", booking, audience: "customer" }) : null
    ].filter(Boolean)).catch((err) => console.warn("[public demo] booking notification failed", err));
  }

  if (body.action !== "not_yet" && !session.converted_at) {
    await prisma.demoSession.update({
      where: { id: session.id },
      data: { converted_at: new Date() }
    }).catch(() => {});
  }

  res.json({
    ok: true,
    message: booking
      ? `Done. Your consultation is booked for ${formatManilaSchedule(booking.start_at)}. We saved it to our calendar and sent the meeting details.`
      : actionMeta.message,
    leadScore: actionMeta.score,
    booking: booking ? serializeBooking(booking) : null
  });
}));

app.post("/api/auth/forgot-password", asyncHandler(async (req, res) => {
  const body = z.object({ email: z.string().email() }).parse(req.body);
  const email = body.email.toLowerCase();

  // Identical response on every path below, including when rate limited or
  // when SMTP is down. Any difference — status code, wording, timing — turns
  // this into a way to test whether an address is a customer.
  const generic = {
    ok: true,
    message: "If an account exists for that address, we've sent a reset link."
  };

  if (!forgotByIpRateLimiter.check(clientIp(req)).allowed) return res.json(generic);
  if (!forgotByEmailRateLimiter.check(email).allowed) return res.json(generic);

  await requestReset({ email, ip: clientIp(req) });
  return res.json(generic);
}));

app.post("/api/auth/reset-password", asyncHandler(async (req, res) => {
  const body = z.object({
    token: z.string().min(1),
    password: z.string().min(8)
  }).parse(req.body);

  if (!resetRateLimiter.check(clientIp(req)).allowed) {
    return res.status(429).json({ ok: false, error: "Too many attempts. Please wait and try again." });
  }

  const result = await resetPassword({ token: body.token, newPassword: body.password });
  if (!result.ok) {
    const messages = {
      invalid_token: "This reset link is not valid. Please request a new one.",
      token_expired: "This reset link has expired. Please request a new one.",
      token_already_used: "This reset link has already been used. Please request a new one.",
      weak_password: "Password must be at least 8 characters."
    };
    return res.status(400).json({ ok: false, code: result.code, error: messages[result.code] || messages.invalid_token });
  }

  // Deliberately NOT signing them in here. Resetting proves control of the
  // inbox, not of the password they just chose — make them type it once.
  // It also means a stolen reset link cannot become a live session silently.
  return res.json({ ok: true, message: "Password updated. Please sign in." });
}));

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, asyncHandler(async (req, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.companyId }, select: publicCompanySelect() });
  res.json({ user: req.user, company });
}));

app.get("/api/dashboard", requireAuth, asyncHandler(async (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [
    leadsToday,
    hotLeads,
    quotationReady,
    pendingApprovals,
    needsHuman,
    pendingFollowUps,
    recentConversations
  ] = await Promise.all([
    prisma.lead.count({ where: { company_id: req.companyId, created_at: { gte: start } } }),
    prisma.lead.count({ where: { company_id: req.companyId, lead_score: "hot" } }),
    prisma.lead.count({ where: { company_id: req.companyId, quotation_ready: true } }),
    prisma.quotation.count({ where: { company_id: req.companyId, status: "pending_approval" } }),
    prisma.conversation.count({ where: { company_id: req.companyId, needs_human: true } }),
    prisma.followUp.count({ where: { company_id: req.companyId, status: "pending" } }),
    prisma.conversation.findMany({
      where: { company_id: req.companyId },
      orderBy: { last_message_at: "desc" },
      take: 8,
      include: { messages: { orderBy: { created_at: "desc" }, take: 1 } }
    })
  ]);
  res.json({ leadsToday, hotLeads, quotationReady, pendingApprovals, needsHuman, pendingFollowUps, recentConversations });
}));

app.get("/api/company", requireAuth, asyncHandler(async (req, res) => {
  const company = await prisma.company.findUnique({ where: { id: req.companyId }, select: publicCompanySelect() });
  res.json(company);
}));

app.put("/api/company", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    contact_person: z.string().optional().nullable(),
    industry: z.string().optional().nullable(),
    website: z.string().optional().nullable(),
    contact_email: z.string().optional().nullable(),
    contact_number: z.string().optional().nullable(),
    status: z.string().optional()
  }).parse(req.body);
  const company = await prisma.company.update({ where: { id: req.companyId }, data: body, select: publicCompanySelect() });
  res.json(company);
}));

app.get("/api/settings", requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.companySetting.findUnique({ where: { company_id: req.companyId } }));
}));

app.put("/api/settings", requireAuth, asyncHandler(async (req, res) => {
  const allowed = [
    "ai_enabled", "auto_reply_enabled", "business_hours_only", "human_handoff_enabled",
    "default_language", "tone", "quotation_mode", "allow_ai_quotation_drafts",
    "allow_auto_send_quotation", "quotation_requires_admin_approval", "notify_email",
    "ai_custom_instructions"
  ];
  const data = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (data.quotation_mode !== "auto_send") data.allow_auto_send_quotation = false;
  const settings = await prisma.companySetting.update({ where: { company_id: req.companyId }, data });
  clearAistaffAiConfigCache();
  res.json(settings);
}));

app.get("/api/facebook-pages", requireAuth, asyncHandler(async (req, res) => {
  const pages = await prisma.facebookPage.findMany({
    where: { company_id: req.companyId },
    orderBy: { created_at: "desc" },
    select: { id: true, company_id: true, page_id: true, page_name: true, status: true, created_at: true, updated_at: true }
  });
  res.json(pages);
}));

app.get("/api/facebook-page-connection", requireAuth, asyncHandler(async (req, res) => {
  const [connectedPage, pages] = await Promise.all([
    prisma.facebookPage.findFirst({
      where: { company_id: req.companyId, status: "active" },
      orderBy: { updated_at: "desc" },
      select: { id: true, page_id: true, page_name: true, status: true, updated_at: true }
    }),
    prisma.facebookPage.findMany({
      where: { company_id: req.companyId },
      orderBy: [{ status: "asc" }, { updated_at: "desc" }],
      select: { id: true, page_id: true, page_name: true, status: true, updated_at: true }
    })
  ]);

  const metaAuth = getMetaAuthForUser(req.user.id);
  res.json({
    connectedPage: connectedPage ? {
      id: connectedPage.id,
      pageId: connectedPage.page_id,
      name: connectedPage.page_name,
      status: connectedPage.status,
      messengerReplies: connectedPage.status === "active" ? "Enabled" : "Disabled",
      updatedAt: connectedPage.updated_at
    } : null,
    connectionStatus: connectedPage?.status === "active" ? "Connected" : "Not connected",
    savedPages: pages.map((page) => ({
      id: page.id,
      pageId: page.page_id,
      name: page.page_name,
      status: page.status,
      updatedAt: page.updated_at
    })),
    managedPages: metaAuth?.companyId === req.companyId
      ? metaAuth.pages.map(sanitizeManagedPage)
      : [],
    authFreshUntil: metaAuth?.companyId === req.companyId ? metaAuth.expiresAt : null
  });
}));

app.get("/api/meta/facebook/connect", requireAuth, asyncHandler(async (req, res) => {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return res.redirect(302, facebookConnectionPath({ meta_error: "Meta app is not configured yet." }));
  }

  const state = crypto.randomUUID();
  metaOauthStates.set(state, {
    userId: req.user.id,
    companyId: req.companyId,
    expiresAt: Date.now() + (10 * 60 * 1000)
  });

  const authUrl = new URL("https://www.facebook.com/v20.0/dialog/oauth");
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("redirect_uri", getMetaRedirectUri(req));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("response_type", "code");
  // Facebook Login for Business: the permission set comes from the dashboard
  // configuration, not a raw scope string. A raw scope only works for people
  // holding a role on the app, which is why non-role users were refused.
  const loginConfigId = process.env.META_LOGIN_CONFIG_ID || "1615847410149532";
  authUrl.searchParams.set("config_id", loginConfigId);
  authUrl.searchParams.set("override_default_response_type", "true");
  console.log("[fb-connect] redirecting to Facebook with config_id=%s", loginConfigId);
  res.redirect(302, authUrl.toString());
}));

app.get("/api/meta/facebook/callback", asyncHandler(async (req, res) => {
  pruneExpiredMetaAuth();
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const errorReason = String(req.query.error_message || req.query.error_description || req.query.error || "");
  const authRequest = metaOauthStates.get(state);

  if (!authRequest) {
    return res.redirect(302, facebookConnectionPath({ meta_error: "Facebook authorization expired. Please try again." }));
  }
  metaOauthStates.delete(state);

  if (!code) {
    return res.redirect(302, facebookConnectionPath({ meta_error: errorReason || "Facebook authorization was not completed." }));
  }

  const redirectUri = getMetaRedirectUri(req);
  const tokenUrl = new URL("https://graph.facebook.com/v20.0/oauth/access_token");
  tokenUrl.searchParams.set("client_id", process.env.META_APP_ID || "");
  tokenUrl.searchParams.set("client_secret", process.env.META_APP_SECRET || "");
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);

  const tokenResponse = await fetch(tokenUrl);
  const tokenJson = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenJson.access_token) {
    const message = tokenJson?.error?.message || "Could not complete Facebook authorization.";
    return res.redirect(302, facebookConnectionPath({ meta_error: message.slice(0, 180) }));
  }

  const pagesUrl = new URL("https://graph.facebook.com/v20.0/me/accounts");
  pagesUrl.searchParams.set("access_token", tokenJson.access_token);
  pagesUrl.searchParams.set("fields", "id,name,category,tasks,access_token");
  const pagesResponse = await fetch(pagesUrl);
  const pagesJson = await pagesResponse.json();
  console.log("[fb-connect] /me/accounts status=%s raw_count=%s error=%s",
    pagesResponse.status,
    Array.isArray(pagesJson?.data) ? pagesJson.data.length : "NO_DATA_ARRAY",
    pagesJson?.error ? JSON.stringify(pagesJson.error) : "none");
  if (Array.isArray(pagesJson?.data)) {
    pagesJson.data.forEach((pg) => {
      console.log("[fb-connect]   page id=%s name=%s has_access_token=%s tasks=%s",
        pg?.id || "?", pg?.name || "?", Boolean(pg?.access_token),
        Array.isArray(pg?.tasks) ? pg.tasks.join("|") : "none");
    });
  }
  if (!pagesResponse.ok) {
    const message = pagesJson?.error?.message || "Could not load Facebook Pages.";
    return res.redirect(302, facebookConnectionPath({ meta_error: message.slice(0, 180) }));
  }

  const pages = Array.isArray(pagesJson.data)
    ? pagesJson.data
      .filter((page) => page?.id && page?.name && page?.access_token)
      .map((page) => ({
        id: String(page.id),
        name: String(page.name),
        category: String(page.category || ""),
        tasks: Array.isArray(page.tasks) ? page.tasks.map((task) => String(task)) : [],
        accessToken: String(page.access_token)
      }))
    : [];

  console.log("[fb-connect] kept_after_filter=%s dropped_by_filter=%s",
    pages.length,
    (Array.isArray(pagesJson?.data) ? pagesJson.data.length : 0) - pages.length);

  setMetaAuthForUser(authRequest.userId, {
    companyId: authRequest.companyId,
    pages
  });

  res.redirect(302, facebookConnectionPath({
    meta_auth: pages.length ? "success" : "empty"
  }));
}));

app.post("/api/facebook-page-connection/select", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    pageId: z.string().min(1)
  }).parse(req.body);

  const metaAuth = getMetaAuthForUser(req.user.id);
  if (!metaAuth || metaAuth.companyId !== req.companyId) {
    return res.status(400).json({ error: "Please connect Facebook first to load your managed Pages." });
  }

  const selected = metaAuth.pages.find((page) => page.id === body.pageId);
  if (!selected) {
    return res.status(404).json({ error: "Selected Facebook Page was not found in the authorized list." });
  }

  await prisma.facebookPage.updateMany({
    where: { company_id: req.companyId, page_id: { not: selected.id } },
    data: { status: "inactive" }
  });

  const page = await prisma.facebookPage.upsert({
    where: { page_id: selected.id },
    create: {
      company_id: req.companyId,
      page_id: selected.id,
      page_name: selected.name,
      page_access_token_encrypted: encryptSecret(selected.accessToken),
      status: "active"
    },
    update: {
      company_id: req.companyId,
      page_name: selected.name,
      page_access_token_encrypted: encryptSecret(selected.accessToken),
      status: "active"
    },
    select: { id: true, page_id: true, page_name: true, status: true, updated_at: true }
  });

  // Subscribe THIS Page to our webhook using THIS Page's own access token.
  // Without this call Meta never delivers Messenger events for the Page, so the
  // dashboard would report "Enabled" while nothing ever arrived. Each Page is
  // subscribed independently and routes to its own company via page_id.
  let messengerReplies = "Disabled";
  let subscribeError = null;
  try {
    const subUrl = `https://graph.facebook.com/v20.0/${encodeURIComponent(selected.id)}/subscribed_apps`;
    const subResponse = await fetch(subUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        subscribed_fields: "messages,messaging_postbacks",
        access_token: selected.accessToken
      })
    });
    const subJson = await subResponse.json().catch(() => ({}));
    if (subResponse.ok && subJson && subJson.success) {
      messengerReplies = "Enabled";
      console.log("[fb-subscribe] page_id=%s OK", selected.id);
    } else {
      subscribeError = (subJson && subJson.error && subJson.error.message)
        || `Webhook subscription failed (HTTP ${subResponse.status})`;
      console.log("[fb-subscribe] page_id=%s FAILED error=%s", selected.id, subscribeError);
    }
  } catch (err) {
    subscribeError = err.message;
    console.log("[fb-subscribe] page_id=%s THREW error=%s", selected.id, err.message);
  }

  res.json({
    ok: true,
    connectedPage: {
      id: page.id,
      pageId: page.page_id,
      name: page.page_name,
      status: page.status,
      messengerReplies,
      updatedAt: page.updated_at
    },
    subscribeError
  });
}));

/**
 * Disconnect a Page. Added 2026-08-17.
 *
 * ADDITION alongside the §12-reviewed connection screen — the "Connect
 * Facebook Page" button and the connection-status panel are untouched, since
 * they are the evidence for two permissions.
 *
 * Marks the Page INACTIVE rather than deleting it: Conversation rows reference
 * facebook_page_id, and deleting would orphan every past customer thread. Also
 * calls Meta's DELETE /{page-id}/subscribed_apps, because leaving the app
 * subscribed means Meta keeps delivering events for a Page we no longer answer
 * — which is exactly the unknown-Page case the webhook now rejects.
 */
app.post("/api/facebook-page-connection/disconnect", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ pageId: z.string().min(1) }).parse(req.body);

  const page = await prisma.facebookPage.findFirst({
    where: { page_id: body.pageId, company_id: req.companyId }
  });
  // Scoped to req.companyId so one tenant can never disconnect another's Page.
  if (!page) return res.status(404).json({ ok: false, error: "That Page is not connected to this account." });

  let unsubscribed = false;
  let unsubscribeError = null;
  try {
    const token = decryptSecret(page.page_access_token_encrypted) || process.env.META_PAGE_ACCESS_TOKEN || "";
    if (!token) throw new Error("No stored Page access token");
    const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(page.page_id)}/subscribed_apps?access_token=${encodeURIComponent(token)}`;
    const response = await fetch(url, { method: "DELETE" });
    const json = await response.json().catch(() => ({}));
    if (response.ok && json && json.success) {
      unsubscribed = true;
      console.log("[fb-unsubscribe] page_id=%s OK", page.page_id);
    } else {
      unsubscribeError = (json && json.error && json.error.message) || `HTTP ${response.status}`;
      console.log("[fb-unsubscribe] page_id=%s FAILED error=%s", page.page_id, unsubscribeError);
    }
  } catch (err) {
    unsubscribeError = err.message;
    console.log("[fb-unsubscribe] page_id=%s THREW error=%s", page.page_id, err.message);
  }

  // Mark inactive regardless. If Meta's call failed the customer still expects
  // us to stop replying, and the webhook checks status before answering.
  const updated = await prisma.facebookPage.update({
    where: { id: page.id },
    data: { status: "disconnected" },
    select: { page_id: true, page_name: true, status: true, updated_at: true }
  });

  res.json({
    ok: true,
    page: updated,
    unsubscribed,
    unsubscribeError
  });
}));

app.post("/api/facebook-pages", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    page_id: z.string().min(1),
    page_name: z.string().min(1),
    page_access_token: z.string().min(1),
    status: z.string().default("active")
  }).parse(req.body);
  const page = await prisma.facebookPage.upsert({
    where: { page_id: body.page_id },
    create: {
      company_id: req.companyId,
      page_id: body.page_id,
      page_name: body.page_name,
      page_access_token_encrypted: encryptSecret(body.page_access_token),
      status: body.status
    },
    update: {
      page_name: body.page_name,
      page_access_token_encrypted: encryptSecret(body.page_access_token),
      status: body.status
    },
    select: { id: true, page_id: true, page_name: true, status: true, created_at: true, updated_at: true }
  });
  res.json(page);
}));

app.get("/api/knowledge-base", requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.knowledgeBase.findMany({ where: { company_id: req.companyId }, orderBy: { updated_at: "desc" } }));
}));

app.post("/api/knowledge-base", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    category: z.string().min(1),
    question: z.string().min(1),
    answer: z.string().min(1),
    tags: z.array(z.string()).optional().default([]),
    active: z.boolean().optional().default(true)
  }).parse(req.body);
  clearAistaffAiConfigCache();
  res.json(await prisma.knowledgeBase.create({ data: { ...body, company_id: req.companyId } }));
}));

app.put("/api/knowledge-base/:id", requireAuth, asyncHandler(async (req, res) => {
  clearAistaffAiConfigCache();
  res.json(await prisma.knowledgeBase.update({ where: { id: req.params.id, company_id: req.companyId }, data: req.body }));
}));

app.delete("/api/knowledge-base/:id", requireAuth, asyncHandler(async (req, res) => {
  await prisma.knowledgeBase.delete({ where: { id: req.params.id, company_id: req.companyId } });
  clearAistaffAiConfigCache();
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------------------
 * Knowledge base intake wizard (added 2026-08-17, HANDOFF-CLOSER.md §18).
 * ADDITIONS ONLY — no reviewed route renamed, moved or redirected (§12).
 * The "Knowledge Base" nav item already exists; the wizard lives under it.
 * ------------------------------------------------------------------------- */

/** Steps, packs and current progress. Drives the wizard, the % and the modal. */
/** Header status pill. Polled by the admin shell; derived, never a stored flag. */
app.get("/api/closer/health", requireAuth, asyncHandler(async (req, res) => {
  res.json(await getCloserHealth(req.companyId));
}));

app.get("/api/intake/state", requireAuth, asyncHandler(async (req, res) => {
  const [company, settings, rows, questionCount, page] = await Promise.all([
    prisma.company.findUnique({ where: { id: req.companyId } }),
    prisma.companySetting.findUnique({ where: { company_id: req.companyId } }),
    prisma.knowledgeBase.findMany({
      where: { company_id: req.companyId, active: true },
      orderBy: [{ display_order: "asc" }, { created_at: "asc" }]
    }),
    prisma.qualificationQuestion.count({ where: { company_id: req.companyId, active: true } }),
    prisma.facebookPage.findFirst({ where: { company_id: req.companyId, status: "active" } })
  ]);

  const progress = settings?.intake_progress || {};
  const pack = progress.industryPack || suggestPack(company || {}, page?.page_name || "");
  const steps = stepsForPack(pack);

  // A step counts as done when it actually produced something, not when the
  // user clicked past it. Skipped steps count as addressed for the bar but are
  // listed separately so they can be returned to.
  const byCategory = new Map();
  const latestByCategory = new Map();
  for (const row of rows) {
    byCategory.set(row.category, (byCategory.get(row.category) || 0) + 1);
    latestByCategory.set(row.category, row);
  }
  const skipped = new Set(progress.skipped || []);

  const stepState = steps.map((step) => {
    let done = false;
    if (step.qualification) done = questionCount > 0;
    else if (step.liveData) done = Boolean(settings?.live_data_source);
    else done = (byCategory.get(step.category) || 0) > 0;
    const canHydrateLatestEntry = Boolean(step.paymentSetup || step.painSetup);
    const latestEntry = canHydrateLatestEntry ? latestByCategory.get(step.category) : null;
    return {
      id: step.id,
      title: step.title,
      why: step.why,
      note: step.note || null,
      kind: step.kind,
      category: step.category,
      required: Boolean(step.required),
      allowUpload: Boolean(step.allowUpload),
      uploadHint: step.uploadHint || null,
      docUploadTitle: step.docUploadTitle || null,
      docUploadHint: step.docUploadHint || null,
      photoUploadTitle: step.photoUploadTitle || null,
      photoUploadHint: step.photoUploadHint || null,
      structured: Boolean(step.structured),
      rowLabels: step.rowLabels || null,
      qualification: Boolean(step.qualification),
      faqCheck: Boolean(step.faqCheck),
      liveData: Boolean(step.liveData),
      paymentSetup: Boolean(step.paymentSetup),
      painSetup: Boolean(step.painSetup),
      painTemplates: step.painTemplates || null,
      validityDefault: step.validityDefault || "",
      fields: step.fields || [],
      latestEntry: latestEntry
        ? {
            id: latestEntry.id,
            title: latestEntry.title,
            answer: latestEntry.answer,
            data: latestEntry.data || [],
            currency: latestEntry.currency,
            validUntil: latestEntry.valid_until,
            sourceKind: latestEntry.source_kind,
            sourceName: latestEntry.source_name
          }
        : null,
      entryCount: step.qualification ? questionCount : (byCategory.get(step.category) || 0),
      done,
      skipped: skipped.has(step.id)
    };
  });

  const addressed = stepState.filter((s) => s.done || s.skipped).length;
  const percent = steps.length ? Math.round((addressed / steps.length) * 100) : 0;
  const firstUnfinished = stepState.find((s) => !s.done && !s.skipped);

  res.json({
    industryPack: pack,
    wordLimit: INTAKE_WORD_LIMIT,
    titleWordLimit: INTAKE_TITLE_WORD_LIMIT,
    packs: Object.entries(INDUSTRY_PACKS).map(([key, value]) => ({ key, label: value.label })),
    validityOptions: VALIDITY_OPTIONS,
    steps: stepState,
    percent,
    addressed,
    totalSteps: steps.length,
    complete: percent === 100,
    completedAt: settings?.intake_completed_at || null,
    currentStepId: firstUnfinished ? firstUnfinished.id : (stepState[0] ? stepState[0].id : null),
    pageConnected: Boolean(page),
    pageName: page?.page_name || null,
    liveDataSource: settings?.live_data_source || null,
    liveDataInterest: Boolean(settings?.live_data_interest)
  });
}));

/** Save one step's entry. Writes a typed KnowledgeBase row. */
app.post("/api/intake/step/:stepId", requireAuth, asyncHandler(async (req, res) => {
  // 3,000 words per entry. Checked BEFORE zod so an over-long entry returns a
  // sentence the person can act on — a raw ZodError shows up in the browser
  // console as "Validation failed" and the person sees nothing at all, which
  // is exactly what happened on the first real run.
  //
  // Counted in WORDS, not characters, because that is what the person writing
  // it can estimate. The client shows a live counter so this is never a
  // surprise. Anything longer belongs in several entries, which also reads
  // better to the agent than one enormous block.
  const wordCount = String(req.body?.answer || "").trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > INTAKE_WORD_LIMIT) {
    return res.status(400).json({
      ok: false,
      error: `That entry is ${wordCount.toLocaleString()} words and the limit is ${INTAKE_WORD_LIMIT.toLocaleString()} per entry. Save what fits, then add the rest as a second entry on this same step.`
    });
  }

  const titleWords = String(req.body?.title || "").trim().split(/\s+/).filter(Boolean).length;
  if (titleWords > INTAKE_TITLE_WORD_LIMIT) {
    return res.status(400).json({
      ok: false,
      error: `That title is ${titleWords} words and the limit is ${INTAKE_TITLE_WORD_LIMIT}. Keep the title short and put the detail in the box below it.`
    });
  }
  const body = z.object({
    // 500, not 300. A title is meant to be a short label, but people
    // reasonably paste a full sentence into "What does this show?" and losing
    // the entire save over it is the wrong trade. The input also carries a
    // maxlength so the browser stops it before the request is made.
    title: z.string().max(1200).optional().nullable(),
    question: z.string().max(500).optional().nullable(),
    answer: z.string().min(1),
    currency: z.string().max(8).optional().nullable(),
    validUntil: z.string().optional().nullable(),
    sourceName: z.string().max(300).optional().nullable(),
    sourceKind: z.string().max(40).optional().nullable(),
    data: z.array(z.object({
      label: z.string().max(200).optional().default(""),
      value: z.string().max(200).optional().default(""),
      note: z.string().max(200).optional().default("")
    })).optional().nullable()
  }).parse(req.body);

  const settings = await prisma.companySetting.findUnique({ where: { company_id: req.companyId } });
  const progress = settings?.intake_progress || {};
  const pack = progress.industryPack || "general";
  const step = stepsForPack(pack).find((s) => s.id === req.params.stepId);
  if (!step) return res.status(404).json({ ok: false, error: "Unknown step" });

  const count = await prisma.knowledgeBase.count({ where: { company_id: req.companyId } });
  const setupSingleRecord = Boolean(step.paymentSetup || step.painSetup);
  const existingSetupRow = setupSingleRecord
    ? await prisma.knowledgeBase.findFirst({
        where: {
          company_id: req.companyId,
          category: step.category,
          kind: step.kind || "prose",
          active: true
        },
        orderBy: [{ display_order: "desc" }, { created_at: "desc" }]
      })
    : null;

  const rowData = {
    category: step.category,
    kind: step.kind || "prose",
    title: body.title || step.title,
    question: body.question || null,
    // Links normalised at save so every channel gets a tappable URL —
    // Messenger only auto-links a URL that carries a scheme, and it does not
    // render markdown at all.
    answer: normaliseLinks(body.answer),
    data: body.data && body.data.length ? body.data : undefined,
    currency: body.currency || null,
    valid_until: body.validUntil ? new Date(body.validUntil) : null,
    source_name: body.sourceName || null,
    source_kind: body.sourceKind || "typed",
    // Typed or reviewed by a human in the wizard, so confirmed. Only the
    // AI-suggestion path may write false.
    confirmed: true
  };

  const row = existingSetupRow
    ? await prisma.knowledgeBase.update({
        where: { id: existingSetupRow.id },
        data: rowData
      })
    : await prisma.knowledgeBase.create({
        data: {
          ...rowData,
          company_id: req.companyId,
          display_order: count + 1
        }
      });

  clearAistaffAiConfigCache();

  // Setup milestone. Fires once at 50% and once at 100% — a message on every
  // step is nagging, and people ignore what arrives too often. The thresholds
  // already reached are recorded so a re-save never sends a duplicate.
  await maybeNotifyMilestone(req.companyId).catch((error) =>
    console.error("[notify] milestone check failed company=%s: %s", req.companyId, error.message));

  res.json({ ok: true, entry: row });
}));

/**
 * Send a setup milestone if a new threshold has just been crossed.
 * Thresholds already sent live on intake_progress, so this is idempotent.
 */
async function maybeNotifyMilestone(companyId) {
  const [company, settings, rows, questionCount] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
    prisma.companySetting.findUnique({ where: { company_id: companyId } }),
    prisma.knowledgeBase.findMany({
      where: { company_id: companyId, active: true, confirmed: true },
      select: { category: true }
    }),
    prisma.qualificationQuestion.count({ where: { company_id: companyId, active: true } })
  ]);
  if (!settings?.notify_email) return;

  const progress = settings.intake_progress || {};
  const steps = stepsForPack(progress.industryPack || "general");
  const skipped = new Set(progress.skipped || []);
  const byCategory = new Map();
  for (const row of rows) byCategory.set(row.category, (byCategory.get(row.category) || 0) + 1);

  const isDone = (s) => s.qualification ? questionCount > 0 : Boolean(byCategory.get(s.category));
  const addressed = steps.filter((s) => isDone(s) || skipped.has(s.id)).length;
  const percent = steps.length ? Math.round((addressed / steps.length) * 100) : 0;

  const sent = new Set(progress.milestonesSent || []);
  const threshold = percent >= 100 ? 100 : (percent >= 50 ? 50 : null);
  if (!threshold || sent.has(threshold)) return;

  await notifySetupMilestone({
    to: settings.notify_email,
    companyName: company?.name || "Your business",
    percent,
    done: addressed,
    total: steps.length,
    missing: steps.filter((s) => !isDone(s) && !skipped.has(s.id)).map((s) => s.title)
  });

  sent.add(threshold);
  await prisma.companySetting.update({
    where: { company_id: companyId },
    data: { intake_progress: { ...progress, milestonesSent: [...sent] } }
  });
}

/** Skip a step, or come back to it. Skipping is a first-class state. */
app.post("/api/intake/skip/:stepId", requireAuth, asyncHandler(async (req, res) => {
  const undo = req.body && req.body.undo === true;
  const settings = await prisma.companySetting.findUnique({ where: { company_id: req.companyId } });
  const progress = settings?.intake_progress || {};
  const skipped = new Set(progress.skipped || []);
  if (undo) skipped.delete(req.params.stepId);
  else skipped.add(req.params.stepId);

  await prisma.companySetting.update({
    where: { company_id: req.companyId },
    data: { intake_progress: { ...progress, skipped: [...skipped] } }
  });
  res.json({ ok: true, skipped: [...skipped] });
}));

/** Choose the industry pack. Reorders and relabels steps; storage is unchanged. */
app.post("/api/intake/pack", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ pack: z.string().min(1).max(40) }).parse(req.body);
  if (!INDUSTRY_PACKS[body.pack]) return res.status(400).json({ ok: false, error: "Unknown industry" });
  const settings = await prisma.companySetting.findUnique({ where: { company_id: req.companyId } });
  const progress = settings?.intake_progress || {};
  await prisma.companySetting.update({
    where: { company_id: req.companyId },
    data: { intake_progress: { ...progress, industryPack: body.pack } }
  });
  res.json({ ok: true, pack: body.pack });
}));

/**
 * The live-data step. Records what they use today and whether they want help.
 * Deliberately activates NOTHING — see §15's Stripe dead end: a customer must
 * never reach something that looks connected and is not.
 */
app.post("/api/intake/live-data", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    source: z.string().max(500),
    availabilityItems: z.array(z.string().max(120)).max(30).optional().default([]),
    sources: z.array(z.string().max(120)).max(30).optional().default([]),
    access: z.array(z.string().max(120)).max(30).optional().default([]),
    behavior: z.array(z.string().max(160)).max(30).optional().default([]),
    requestCall: z.boolean().optional().default(false),
    contactName: z.string().max(120).optional().nullable(),
    contactMobile: z.string().max(40).optional().nullable(),
    contactEmail: z.string().max(160).optional().nullable(),
    preferredDay: z.string().max(40).optional().nullable(),
    preferredTime: z.string().max(60).optional().nullable()
  }).parse(req.body);

  // A call request needs a way to reach them, or it is not a request.
  if (body.requestCall && !(body.contactName && body.contactMobile)) {
    return res.status(400).json({ ok: false, error: "Please give a name and mobile number so we can call you." });
  }

  const settings = await prisma.companySetting.findUnique({ where: { company_id: req.companyId } });
  const progress = settings?.intake_progress || {};
  const setup = {
    updatedAt: new Date().toISOString(),
    source: body.source,
    availabilityItems: body.availabilityItems,
    sources: body.sources,
    access: body.access,
    behavior: body.behavior
  };

  // Stored on intake_progress rather than a new column: this is a sales lead,
  // and it belongs in a proper admin view (see §19.6) rather than a settings
  // field. Keeping it here avoids a second migration for a shape that will
  // move anyway.
  const request = body.requestCall
    ? {
      requestedAt: new Date().toISOString(),
      source: body.source,
      availabilityItems: body.availabilityItems,
      sources: body.sources,
      access: body.access,
      behavior: body.behavior,
      name: body.contactName,
      mobile: body.contactMobile,
      email: body.contactEmail || null,
        preferredDay: body.preferredDay || null,
        preferredTime: body.preferredTime || null,
        status: "new"
      }
    : null;

  await prisma.companySetting.update({
    where: { company_id: req.companyId },
    data: {
      live_data_source: body.source,
      live_data_interest: body.requestCall,
      intake_progress: { ...progress, liveDataSetup: setup, ...(request ? { liveDataRequest: request } : {}) }
    }
  });

  console.log(
    "[intake] live-data company=%s source=%s items=%s call=%s contact=%s/%s when=%s %s",
    req.companyId, body.source, body.availabilityItems.join("|") || "-",
    body.requestCall,
    body.contactName || "-", body.contactMobile || "-",
    body.preferredDay || "-", body.preferredTime || "-"
  );

  res.json({ ok: true, requested: body.requestCall });
}));

/** Qualification step: what they need to know, and what makes a lead hot. */
app.post("/api/intake/qualification", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    questions: z.array(z.union([
      z.string().min(1).max(300),
      z.object({ question: z.string().min(1).max(300), field_key: z.string().max(40).optional() })
    ])).max(20).optional().default([]),
    hotSignal: z.string().max(2000).optional().nullable(),
    // From the wizard: these questions REPLACE what is there. Without it the
    // seeded copier-rental defaults ("Where is your office or project
    // location?") sit alongside the new ones forever and Closer asks both.
    replace: z.boolean().optional().default(false)
  }).parse(req.body);

  if (body.replace) {
    // Deactivated, not deleted — Lead rows and past conversations reference
    // these field keys, and history should stay readable.
    await prisma.qualificationQuestion.updateMany({
      where: { company_id: req.companyId },
      data: { active: false }
    });
  }

  const existing = body.replace ? 0 : await prisma.qualificationQuestion.count({ where: { company_id: req.companyId } });
  let order = existing;
  for (const item of body.questions) {
    order += 1;
    const question = typeof item === "string" ? item : item.question;
    const fieldKey = typeof item === "string"
      ? (question.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || `field_${order}`)
      : (item.field_key || "notes");
    await prisma.qualificationQuestion.create({
      data: { company_id: req.companyId, question, field_key: fieldKey, display_order: order }
    });
  }

  if (body.hotSignal) {
    const count = await prisma.knowledgeBase.count({ where: { company_id: req.companyId } });
    await prisma.knowledgeBase.create({
      data: {
        company_id: req.companyId,
        category: "Qualification",
        kind: "instruction",
        title: "What a ready buyer sounds like",
        answer: body.hotSignal,
        confirmed: true,
        source_kind: "typed",
        display_order: count + 1
      }
    });
  }

  clearAistaffAiConfigCache();
  res.json({ ok: true });
}));

/**
 * Detect a vision model narrating that it found nothing, instead of extracting.
 *
 * The extraction prompt says "do not comment on the image" and the model does
 * it anyway when the photo has no text — returning e.g. "There are no visible
 * services, products, prices, package names, inclusions, promo dates, branch
 * details, or contact details in this image."
 *
 * Without this check that sentence is stored as a PRICE LIST and Closer quotes
 * it to a customer. That is §9's phantom pricing arriving through a new door,
 * so the check belongs here rather than in a prompt instruction that has
 * already proven it can be ignored.
 */
function looksLikeNoContentFound(text) {
  const raw = String(text || "").trim();
  if (!raw) return true;
  const t = raw.toLowerCase();

  const NARRATION = /(there (are|is) no|no visible|does not contain|doesn't contain|cannot (see|read|find)|can't (see|read|find)|unable to (see|read|find)|no (text|price|product|service)s? (are |is )?(visible|present|shown|found)|appears to (be|contain) no)/;
  if (!NARRATION.test(t)) return false;

  // The phrase alone is not enough. A real salon price list containing
  // "No visible damage guarantee" was rejected by an earlier version of this
  // check — silently discarding the client's actual prices, which is far worse
  // than letting one narration line through.
  //
  // Narration is a SINGLE short sentence with no prices. Real extracted content
  // has multiple lines, or amounts, or both. Require all three signals.
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) return false;
  if (raw.length > 400) return false;
  const hasAmount = /(₱|php|usd|\$|\d[\d,]{2,})/i.test(raw);
  if (hasAmount) return false;

  return true;
}

/**
 * Turn "Black tshirt P200.jpg" into "Black tshirt P200".
 *
 * Deterministic on purpose — no model involved. A filename is a fact the seller
 * typed; running it through a model to "interpret" it would invent detail. We
 * hand it back verbatim (minus extension and separators) and the owner confirms
 * it in the wizard, so it follows the sourced-suggestion rule (§19.5).
 *
 * Rejects anything that is not a human-authored name: camera defaults
 * (IMG_2043, DSC00012), and machine IDs like Facebook's CDN names
 * ("766861373_2140477466824416_6245324033165997458_n.jpg"), which otherwise
 * become a "product" called 766861373 2140477466824416.
 */
function filenameAsFact(filename) {
  const base = String(filename || "").replace(/\.[a-z0-9]{1,5}$/i, "").trim();
  if (!base) return "";
  const cleaned = base.replace(/[_-]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (cleaned.length < 3) return "";

  const cameraDefault = /^(img|dsc|dscn|pxl|photo|image|screenshot|whatsapp image|viber image|fb img|received|untitled|download|unnamed)[\s\d._-]*$/i;
  if (cameraDefault.test(cleaned)) return "";
  if (/^\d+$/.test(cleaned)) return "";

  // Machine IDs: mostly digits once spaces are removed. A real product name
  // ("Black tshirt P200") is well under half digits; a CDN name is over 90%.
  const compact = cleaned.replace(/\s/g, "");
  const digits = (compact.match(/\d/g) || []).length;
  if (compact.length && digits / compact.length > 0.6) return "";

  // Require at least one real word — three or more letters in a row. Rejects
  // "766861373 ... n" (the trailing "n" is not a word).
  if (!/[a-z]{3,}/i.test(cleaned)) return "";

  return cleaned;
}

/**
 * Read an uploaded price list / document into plain text for the wizard.
 * Reuses src/price-list-extract.js — already handles image (Gemini vision reads
 * prices off promo graphics), PDF, xlsx/csv and docx, already in production on
 * the demo. The text is PRE-FILLED for the owner to check; nothing is stored
 * here, so an unread extraction can never become a fact the agent quotes.
 */
app.post("/api/intake/extract", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    filename: z.string().min(1).max(200),
    mimeType: z.string().min(3).max(120),
    data: z.string().min(10),
    stepId: z.string().max(40).optional().nullable()
  }).parse(req.body);

  const base64 = body.data.indexOf(",") !== -1 ? body.data.split(",").pop() : body.data;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > MAX_BYTES) {
    return res.json({ ok: false, error: "That file is too large. Please keep it under 8MB." });
  }

  const result = await extractPriceList({ buffer, mimeType: body.mimeType, filename: body.filename });
  if (!result.ok) {
    const messages = {
      unsupported_type: "Please upload an image, PDF, Excel file or Word document.",
      nothing_readable: "We could not read any text from that file. Try a clearer photo?",
      file_too_large: "That file is too large. Please keep it under 8MB.",
      empty_file: "That file appears to be empty."
    };
    // A photo of a product often carries no readable text at all — the seller
    // put the detail in the FILENAME ("Black tshirt P200.jpg"), which is how
    // people actually organise photos. That is still a real, sourced fact, so
    // return it rather than calling the upload a failure.
    //
    // Covers BOTH failure reasons on purpose: a plain product photo comes back
    // as `extraction_failed`, not `nothing_readable`. Measured — a solid-colour
    // PNG returns extraction_failed, so matching only nothing_readable made
    // this fallback dead code for the exact case it exists to serve.
    const recoverable = new Set(["nothing_readable", "extraction_failed", "empty_response"]);
    const fromName = filenameAsFact(body.filename);
    if (recoverable.has(result.reason) && fromName) {
      return res.json({
        ok: true,
        kind: "filename",
        text: fromName,
        lines: 1,
        note: "We could not read any text inside that photo, so we used the file name."
      });
    }
    return res.json({ ok: false, error: messages[result.reason] || "We could not read that file." });
  }

  // Prepend the filename even on success: a price list photo named
  // "August rates.jpg" tells the owner which upload a line came from, and a
  // product photo may carry the name and price only in the filename.
  const fromName = filenameAsFact(body.filename);

  // The model "succeeded" but only narrated that it found nothing. Treat that
  // exactly like a failed read — never as content.
  if (looksLikeNoContentFound(result.text)) {
    if (fromName) {
      return res.json({
        ok: true,
        kind: "filename",
        text: fromName,
        lines: 1,
        note: "No readable text in this photo — we used the file name instead."
      });
    }
    return res.json({
      ok: false,
      kind: "empty",
      error: "No readable text found. Rename the file to describe it (for example \"Black tshirt P200.jpg\") and add it again, or type the details below."
    });
  }

  const text = fromName && !result.text.includes(fromName) ? `${fromName}\n${result.text}` : result.text;

  // Does this file belong in this step? Warn, never block — see
  // src/intake-relevance.js. A wrong-document upload otherwise becomes a
  // knowledge base entry the agent quotes.
  const relevance = await checkRelevance({ stepId: body.stepId, filename: body.filename, text });

  // Structured steps (shipping) get the text flattened into editable rows so a
  // courier matrix does not become 30 lines of manual typing.
  const rows = await structureRows({ stepId: body.stepId, text });

  res.json({
    ok: true,
    kind: result.kind,
    text,
    rows: rows && rows.length ? rows : null,
    lines: text.split("\n").filter((l) => l.trim()).length,
    mismatch: relevance.checked && relevance.matches === false,
    looksLike: relevance.looksLike || null
  });
}));

/* ---------------------------------------------------------------------------
 * Closer instructions: view, edit, history, rollback. Added 2026-08-18.
 * Staff only — these govern every tenant, so a customer must never edit them.
 * ------------------------------------------------------------------------- */

/**
 * Legacy guard, kept for any route not yet mapped to a specific permission.
 * Prefer requirePermission("...") — see src/platform-roles.js.
 */
function requirePlatformRole(req, res, next) {
  if (!normaliseRole(req.user?.platform_role)) {
    return res.status(403).json({ error: "This area is for AIStaff staff only." });
  }
  next();
}

/** Which model runs which function, plus the catalogue for the dropdown. */
app.get("/api/models", requireAuth, requirePermission("platform.behaviour"), asyncHandler(async (req, res) => {
  res.json({ settings: await listSettings(), catalogue: MODEL_CATALOGUE });
}));

app.post("/api/models", requireAuth, requirePermission("platform.behaviour"), asyncHandler(async (req, res) => {
  const body = z.object({
    fn: z.string().min(1).max(60),
    provider: z.string().min(1).max(40),
    model: z.string().min(1).max(80)
  }).parse(req.body);
  const saved = await setModelFor({ ...body, updatedBy: req.user.email });
  if (!saved) return res.status(400).json({ ok: false, error: "Unknown function" });
  if (saved.error) return res.status(400).json({ ok: false, error: saved.error });
  res.json({ ok: true });
}));

/** Current instructions plus the full revision history. */
app.get("/api/prompts/closer", requireAuth, requirePermission("platform.behaviour"), asyncHandler(async (req, res) => {
  const revisions = await listRevisions(CLOSER_SYSTEM_KEY);
  const active = revisions.find((r) => r.is_active) || revisions[0] || null;
  res.json({
    active,
    revisions: revisions.map((r) => ({
      id: r.id, version: r.version, note: r.note, created_by: r.created_by,
      is_active: r.is_active, created_at: r.created_at, chars: r.content.length,
      content: r.content
    }))
  });
}));

/** Save a new revision and make it live. Never overwrites history. */
app.post("/api/prompts/closer", requireAuth, requirePermission("platform.behaviour"), asyncHandler(async (req, res) => {
  const body = z.object({
    content: z.string().min(20),
    note: z.string().max(300).optional().nullable()
  }).parse(req.body);
  const created = await saveRevision({ key: CLOSER_SYSTEM_KEY, content: body.content, note: body.note, createdBy: req.user.email });
  res.json({ ok: true, version: created.version });
}));

/** Roll back to an earlier revision. */
app.post("/api/prompts/closer/activate", requireAuth, requirePermission("platform.behaviour"), asyncHandler(async (req, res) => {
  const body = z.object({ version: z.number().int().positive() }).parse(req.body);
  const target = await activateRevision({ key: CLOSER_SYSTEM_KEY, version: body.version, createdBy: req.user.email });
  if (!target) return res.status(404).json({ ok: false, error: "That version does not exist." });
  res.json({ ok: true, version: target.version });
}));

/** Current public demo instructions plus their revision history. */
app.get("/api/prompts/demo-page", requireAuth, requirePermission("platform.behaviour"), asyncHandler(async (req, res) => {
  const revisions = await listRevisions(DEMO_PAGE_SYSTEM_KEY);
  const active = revisions.find((r) => r.is_active) || revisions[0] || null;
  res.json({
    active,
    revisions: revisions.map((r) => ({
      id: r.id, version: r.version, note: r.note, created_by: r.created_by,
      is_active: r.is_active, created_at: r.created_at, chars: r.content.length,
      content: r.content
    }))
  });
}));

/** Save a new public demo prompt revision and make it live. */
app.post("/api/prompts/demo-page", requireAuth, requirePermission("platform.behaviour"), asyncHandler(async (req, res) => {
  const body = z.object({
    content: z.string().min(20),
    note: z.string().max(300).optional().nullable()
  }).parse(req.body);
  const created = await saveRevision({ key: DEMO_PAGE_SYSTEM_KEY, content: body.content, note: body.note, createdBy: req.user.email });
  res.json({ ok: true, version: created.version });
}));

/** Roll the public demo prompt back to an earlier revision. */
app.post("/api/prompts/demo-page/activate", requireAuth, requirePermission("platform.behaviour"), asyncHandler(async (req, res) => {
  const body = z.object({ version: z.number().int().positive() }).parse(req.body);
  const target = await activateRevision({ key: DEMO_PAGE_SYSTEM_KEY, version: body.version, createdBy: req.user.email });
  if (!target) return res.status(404).json({ ok: false, error: "That version does not exist." });
  res.json({ ok: true, version: target.version });
}));

/**
 * Exactly what this company's Closer is running right now — platform
 * instructions plus their own additions, assembled the same way the reply path
 * assembles it. Available to the CUSTOMER too (no platform role required), so
 * they can verify their extra instructions were understood.
 */
app.get("/api/prompts/closer/preview", requireAuth, asyncHandler(async (req, res) => {
  const [company, settings, active, rows, questionCount, gapCount] = await Promise.all([
    prisma.company.findUnique({ where: { id: req.companyId } }),
    prisma.companySetting.findUnique({ where: { company_id: req.companyId } }),
    getActiveInstructions(),
    prisma.knowledgeBase.findMany({
      where: { company_id: req.companyId, active: true, confirmed: true },
      select: { category: true }
    }),
    prisma.qualificationQuestion.count({ where: { company_id: req.companyId, active: true } }),
    prisma.knowledgeGap.count({ where: { company_id: req.companyId, status: "open" } })
  ]);

  // DERIVED, never a stored description. The raw platform rules used to be
  // shown here, which was wrong twice over: they are written for the model
  // rather than the owner, and the CONFIDENTIALITY block tells a tenant about
  // "other customers, other businesses using this service" — platform-internal
  // language on a customer's screen.
  //
  // Computing this from the real state means it cannot drift. Add a wizard
  // step or fill in a gap and this panel accounts for it with no edit.
  const byCategory = new Map();
  for (const row of rows) byCategory.set(row.category, (byCategory.get(row.category) || 0) + 1);

  const progress = settings?.intake_progress || {};
  const steps = stepsForPack(progress.industryPack || "general");
  const skipped = new Set(progress.skipped || []);
  const missing = steps
    .filter((s) => !s.liveData && !s.faqCheck)
    .filter((s) => s.qualification ? questionCount === 0 : !byCategory.get(s.category))
    .map((s) => ({ id: s.id, label: s.title, skipped: skipped.has(s.id) }));

  // Behaviours reflect this company's actual settings, so the list is true for
  // them rather than a generic feature description.
  const behaviours = [
    settings?.auto_reply_enabled
      ? "Replies to your customers automatically, day and night"
      : "Drafts replies for you to send — auto-reply is switched off",
    "Answers only from what you have entered — it will not invent a price, a policy or a delivery date",
    "Replies in whatever language your customer writes in, including Taglish",
    questionCount
      ? `Asks your ${questionCount} qualification question${questionCount === 1 ? "" : "s"}, one at a time, to turn a chat into a lead`
      : "Has no qualification questions yet, so it will not collect lead details",
    settings?.human_handoff_enabled
      ? "Passes the conversation to you when someone asks for a person or raises a complaint"
      : "Will not hand over to a person — handoff is switched off",
    settings?.quotation_requires_admin_approval
      ? "Never sends a quotation without your approval"
      : "May send quotations without approval"
  ];

  res.json({
    version: active.version,
    companyName: company?.name || "",
    knowledgeCount: rows.length,
    covers: [...byCategory.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    missing,
    behaviours,
    openGaps: gapCount,
    customInstructions: settings?.ai_custom_instructions || ""
  });
}));

/* ---------------------------------------------------------------------------
 * Suggested questions (2026-08-18). The customer should never face an empty
 * box: editing beats authoring, and rejecting beats inventing.
 * ------------------------------------------------------------------------- */

async function intakeContext(companyId) {
  const [company, settings, knowledge] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId } }),
    prisma.companySetting.findUnique({ where: { company_id: companyId } }),
    prisma.knowledgeBase.findMany({
      where: { company_id: companyId, active: true, confirmed: true },
      orderBy: [{ display_order: "asc" }]
    })
  ]);
  return { company, knowledge, industryPack: (settings?.intake_progress || {}).industryPack || "general" };
}

/** What will my customers ask, and can Closer already answer it? */
app.post("/api/intake/suggest-faq", requireAuth, asyncHandler(async (req, res) => {
  const { company, knowledge, industryPack } = await intakeContext(req.companyId);
  if (!knowledge.length) {
    return res.json({ ok: false, error: "Add your business details and prices first — suggestions from an empty knowledge base would just be generic." });
  }
  try {
    const questions = await generateFaqCheck({ company, knowledge, industryPack, count: 30 });
    res.json({ ok: true, questions });
  } catch (error) {
    console.error("[faq] generation failed company=%s: %s", req.companyId, error.message);
    res.json({ ok: false, error: "Could not generate suggestions right now. Please try again." });
  }
}));

/** Save only the questions the owner actually answered. */
app.post("/api/intake/faq", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    items: z.array(z.object({
      question: z.string().min(1).max(300),
      answer: z.string().min(1).max(4000),
      category: z.string().max(40).optional().default("Business")
    })).max(60)
  }).parse(req.body);

  // Anything marked not applicable, or already covered by an existing entry,
  // never reaches this endpoint — the client sends only newly-answered rows.
  // That is what keeps "NA" out of the knowledge base and stops a price being
  // stored twice.
  let order = await prisma.knowledgeBase.count({ where: { company_id: req.companyId } });
  const created = [];
  for (const item of body.items) {
    order += 1;
    created.push(await prisma.knowledgeBase.create({
      data: {
        company_id: req.companyId,
        category: item.category || "Business",
        kind: "qa",
        question: item.question,
        answer: normaliseLinks(item.answer),
        confirmed: true,
        source_kind: "faq_review",
        display_order: order
      }
    }));
  }
  clearAistaffAiConfigCache();
  res.json({ ok: true, added: created.length });
}));

/** Draft the qualification questions for this business. */
app.post("/api/intake/suggest-qualification", requireAuth, asyncHandler(async (req, res) => {
  const { company, knowledge, industryPack } = await intakeContext(req.companyId);
  if (!knowledge.length) {
    return res.json({ ok: false, error: "Add your business details and prices first, then we can suggest what to ask a buyer." });
  }
  try {
    const questions = await generateQualificationQuestions({ company, knowledge, industryPack, count: 8 });
    res.json({ ok: true, questions, fields: LEAD_FIELDS });
  } catch (error) {
    console.error("[qualification] generation failed company=%s: %s", req.companyId, error.message);
    res.json({ ok: false, error: "Could not generate suggestions right now. Please try again." });
  }
}));

/* ---------------------------------------------------------------------------
 * Knowledge gaps — real questions Closer could not answer.
 *
 * This is what makes ongoing improvement support operational rather than a
 * promise someone has to remember. Predicted questions (the FAQ step) are a
 * good start; these are better evidence, because a real customer actually asked
 * and actually did not get an answer.
 * ------------------------------------------------------------------------- */

app.get("/api/knowledge-gaps", requireAuth, asyncHandler(async (req, res) => {
  const gaps = await prisma.knowledgeGap.findMany({
    where: { company_id: req.companyId, status: "open" },
    orderBy: [{ times_asked: "desc" }, { last_asked_at: "desc" }],
    take: 50
  });
  res.json({ gaps });
}));

/** Answer a gap: writes the knowledge entry and closes the gap together. */
app.post("/api/knowledge-gaps/:id/answer", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    answer: z.string().min(1).max(20000),
    category: z.string().max(40).optional().default("Business")
  }).parse(req.body);

  const gap = await prisma.knowledgeGap.findFirst({
    where: { id: req.params.id, company_id: req.companyId }
  });
  if (!gap) return res.status(404).json({ ok: false, error: "Not found" });

  const count = await prisma.knowledgeBase.count({ where: { company_id: req.companyId } });
  await prisma.$transaction([
    prisma.knowledgeBase.create({
      data: {
        company_id: req.companyId,
        category: body.category || "Business",
        kind: "qa",
        question: gap.question,
        answer: normaliseLinks(body.answer),
        confirmed: true,
        source_kind: "customer_question",
        display_order: count + 1
      }
    }),
    prisma.knowledgeGap.update({ where: { id: gap.id }, data: { status: "answered" } })
  ]);

  clearAistaffAiConfigCache();
  res.json({ ok: true });
}));

/** Dismiss a gap without answering — not every question deserves an entry. */
app.post("/api/knowledge-gaps/:id/dismiss", requireAuth, asyncHandler(async (req, res) => {
  await prisma.knowledgeGap.updateMany({
    where: { id: req.params.id, company_id: req.companyId },
    data: { status: "dismissed" }
  });
  res.json({ ok: true });
}));

/**
 * Notification status and a live test. Staff only.
 *
 * The test exists because email fails silently by nature — a wrong password or
 * a rejected sender looks identical to "no notifications were due". One button
 * that actually sends is the difference between believing it works and knowing.
 */
app.get("/api/notify/status", requireAuth, requirePermission("platform.behaviour"), asyncHandler(async (req, res) => {
  res.json({
    configured: notifyConfigured(),
    from: FROM_ADDRESS,
    host: process.env.SMTP_HOST || null,
    hint: notifyConfigured()
      ? null
      : "Set NOTIFY_SMTP_USER=support@aistaff.click and NOTIFY_SMTP_PASS in .env. Hostinger rejects sending as an address the authenticated mailbox does not own, so support@ needs its own password."
  });
}));

app.post("/api/notify/test", requireAuth, requirePermission("platform.behaviour"), asyncHandler(async (req, res) => {
  const settings = await prisma.companySetting.findUnique({ where: { company_id: req.companyId } });
  const to = settings?.notify_email || req.user.email;
  const result = await sendNotification({
    to,
    subject: "AIStaff notifications are working",
    text: `This is a test from your AIStaff dashboard.\n\nHandoffs, setup milestones and unanswered-question digests will arrive at ${to}.`
  });
  res.json({ ...result, to });
}));

/** Unanswered-question digest. Triggered by evidence, never by the clock. */
app.post("/api/notify/gap-digest", requireAuth, requirePermission("platform.behaviour"), asyncHandler(async (req, res) => {
  const [company, settings, gaps] = await Promise.all([
    prisma.company.findUnique({ where: { id: req.companyId }, select: { name: true } }),
    prisma.companySetting.findUnique({ where: { company_id: req.companyId } }),
    prisma.knowledgeGap.findMany({
      where: { company_id: req.companyId, status: "open" },
      orderBy: [{ times_asked: "desc" }, { last_asked_at: "desc" }],
      take: 15
    })
  ]);
  const result = await notifyGapDigest({
    to: settings?.notify_email,
    companyName: company?.name || "Your business",
    gaps
  });
  res.json({ ...result, gapCount: gaps.length });
}));

/* ---------------------------------------------------------------------------
 * Media attached to a knowledge base entry.
 *
 * These files must be publicly fetchable: Messenger attachments are sent BY
 * URL and Facebook's own servers retrieve them, so anything behind requireAuth
 * fails silently from Meta's side. Served from public/media with random UUID
 * filenames rather than access control.
 *
 * RAW BINARY, NOT BASE64, AND NEVER THE COMPRESSED COPY.
 * The wizard downsizes images to 1600px JPEG before OCR — right for reading a
 * price list, wrong for storage. This is the file a CUSTOMER will see, so it
 * is stored exactly as uploaded. Raw upload also avoids base64's 33% inflation.
 * ------------------------------------------------------------------------- */
app.use("/api/knowledge-base/:id/media", express.raw({ type: "*/*", limit: "30mb" }));

app.post("/api/knowledge-base/:id/media", requireAuth, asyncHandler(async (req, res) => {
  const mimeType = String(req.get("content-type") || "").split(";")[0].trim();
  const filename = decodeURIComponent(String(req.get("x-filename") || "upload"));
  const caption = decodeURIComponent(String(req.get("x-caption") || ""));

  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ ok: false, error: "No file received." });
  }

  const entry = await prisma.knowledgeBase.findFirst({
    where: { id: req.params.id, company_id: req.companyId }
  });
  if (!entry) return res.status(404).json({ ok: false, error: "Entry not found" });

  const saved = saveMedia({ buffer: req.body, mimeType, filename, companyId: req.companyId });
  if (!saved.ok) return res.status(400).json({ ok: false, error: saved.error });

  // Append rather than replace — an entry may hold several photos of the same
  // product.
  const existing = Array.isArray(entry.media) ? entry.media : [];
  const media = [...existing, { ...saved.entry, caption: caption || entry.title || "" }];

  await prisma.knowledgeBase.update({ where: { id: entry.id }, data: { media } });
  clearAistaffAiConfigCache();
  console.log("[media] saved company=%s entry=%s %s (%d KB)",
    req.companyId, entry.id, filename, Math.round(req.body.length / 1024));
  res.json({ ok: true, media });
}));

app.delete("/api/knowledge-base/:id/media", requireAuth, express.json(), asyncHandler(async (req, res) => {
  const body = z.object({ url: z.string().min(5) }).parse(req.body);
  const entry = await prisma.knowledgeBase.findFirst({
    where: { id: req.params.id, company_id: req.companyId }
  });
  if (!entry) return res.status(404).json({ ok: false, error: "Entry not found" });

  const media = (Array.isArray(entry.media) ? entry.media : []).filter((m) => m.url !== body.url);
  deleteMedia(body.url);
  await prisma.knowledgeBase.update({ where: { id: entry.id }, data: { media } });
  clearAistaffAiConfigCache();
  res.json({ ok: true, media });
}));

/* ---------------------------------------------------------------------------
 * PLATFORM (2026-08-19) — AIStaff staff managing all customers.
 *
 * Separate from /admin because /admin is ONE workspace, and AIStaff staff are
 * themselves tenants. Pure addition: nothing under /admin/* changes (§12).
 *
 * Every route is behind requirePermission, which reads platform_role fresh from
 * the database on each request. Someone with no session gets 401; a customer
 * who types /platform gets 403 and reaches no data.
 * ------------------------------------------------------------------------- */

/** Who am I, and what may I do? Drives which platform screens render. */
app.get("/api/platform/me", requireAuth, asyncHandler(async (req, res) => {
  const role = normaliseRole(req.user.platform_role);
  if (!role) return res.status(403).json({ error: "Not a platform user" });
  res.json({
    email: req.user.email,
    name: req.user.name,
    role,
    can: {
      users: can(req.user, "platform.users"),
      pricing: can(req.user, "platform.pricing"),
      behaviour: can(req.user, "platform.behaviour"),
      customersView: can(req.user, "customers.view"),
      customersStatus: can(req.user, "customers.status"),
      customersAssist: can(req.user, "customers.assist")
    }
  });
}));

/** Every customer, with the numbers that decide who needs attention. */
app.get("/api/platform/customers", requireAuth, requirePermission("customers.view"), asyncHandler(async (req, res) => {
  res.json({ customers: await listCustomers() });
}));

app.put("/api/platform/customers/:id/status", requireAuth, requirePermission("customers.status"), asyncHandler(async (req, res) => {
  const body = z.object({ status: z.enum(["active", "inactive"]) }).parse(req.body || {});
  const existing = await prisma.company.findUnique({
    where: { id: req.params.id },
    select: { id: true, name: true, status: true }
  });
  if (!existing) return res.status(404).json({ error: "Customer not found" });
  if (existing.status === body.status) return res.json({ ok: true, company: existing });

  const company = await prisma.company.update({
    where: { id: req.params.id },
    data: { status: body.status },
    select: { id: true, name: true, status: true }
  });
  console.log("[platform] %s set customer %s (%s) status=%s", req.user.email, company.name, company.id, company.status);
  res.json({ ok: true, company });
}));

/**
 * Enter a customer's workspace.
 *
 * Recorded on ENTRY rather than exit, so an abandoned session is still logged.
 * The session cookie is re-issued against their company id — the same
 * mechanism as signing in, so every existing tenant-scoped route works without
 * modification and cannot leak across tenants.
 */
app.post("/api/platform/assist/:companyId", requireAuth, requirePermission("customers.assist"), asyncHandler(async (req, res) => {
  const body = z.object({ reason: z.string().max(300).optional().nullable() }).parse(req.body || {});
  const company = await prisma.company.findUnique({
    where: { id: req.params.companyId },
    select: { id: true, name: true, account_number: true }
  });
  if (!company) return res.status(404).json({ error: "Customer not found" });

  const session = await prisma.assistSession.create({
    data: {
      staff_user_id: req.user.id,
      staff_email: req.user.email,
      company_id: company.id,
      company_name: company.name,
      reason: body.reason || null
    }
  });

  console.log("[assist] %s entered %s (%s) session=%s",
    req.user.email, company.account_number, company.name, session.id);

  setSessionCookie(res, signSession({
    sub: req.user.id,
    companyId: company.id,
    assistSessionId: session.id
  }));

  res.json({ ok: true, company, sessionId: session.id });
}));

/** Leave assist mode and return to your own workspace. */
app.post("/api/platform/assist/exit", requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { company_id: true, company: { select: { name: true } } }
  });

  await prisma.assistSession.updateMany({
    where: { staff_user_id: req.user.id, ended_at: null },
    data: { ended_at: new Date() }
  });

  setSessionCookie(res, signSession({ sub: req.user.id, companyId: user.company_id }));
  console.log("[assist] %s exited assist mode", req.user.email);
  res.json({ ok: true, company: user.company });
}));

/** Who has been in whose workspace. Visible to anyone who can view customers. */
app.get("/api/platform/assist-log", requireAuth, requirePermission("customers.view"), asyncHandler(async (req, res) => {
  const sessions = await prisma.assistSession.findMany({
    orderBy: { started_at: "desc" },
    take: 100
  });
  res.json({ sessions });
}));

/* ---- Platform staff: create, change role, deactivate. Admin only. ---- */

app.get("/api/platform/users", requireAuth, requirePermission("platform.users"), asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({
    where: { platform_role: { not: null } },
    orderBy: { created_at: "asc" },
    select: {
      id: true, email: true, name: true, platform_role: true, role: true,
      status: true, last_login_at: true,
      company: { select: { account_number: true, name: true } }
    }
  });
  res.json({ users, roles: ROLES, permissions: PERMISSIONS });
}));

/**
 * Create a staff member.
 *
 * They get no password here — the same set-password email a paying customer
 * receives is sent instead, so a password is never typed by one person on
 * behalf of another or sent over chat.
 *
 * Staff still need a tenant company (the schema requires one), so they join
 * the AIStaff workspace as an account_user unless told otherwise.
 */
app.post("/api/platform/users", requireAuth, requirePermission("platform.users"), asyncHandler(async (req, res) => {
  const body = z.object({
    email: z.string().email(),
    name: z.string().min(1).max(120),
    platformRole: z.enum(["admin", "manager", "support"]),
    tenantRole: z.enum(["account_admin", "account_user"]).optional().default("account_user")
  }).parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) {
    // Already a user — promote rather than refuse. A customer who joins the
    // team should keep their history, not get a duplicate account.
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: { platform_role: body.platformRole }
    });
    console.log("[platform] %s granted %s by %s", body.email, body.platformRole, req.user.email);
    return res.json({ ok: true, promoted: true, user: { email: updated.email, platform_role: updated.platform_role } });
  }

  const company = await prisma.company.findUnique({ where: { id: AISTAFF_INTERNAL_COMPANY_ID } });
  const user = await prisma.user.create({
    data: {
      company_id: company.id,
      email: body.email,
      name: body.name,
      role: body.tenantRole,
      platform_role: body.platformRole,
      status: "active",
      password_hash: crypto.randomBytes(32).toString("hex")
    }
  });

  const sent = await issueSetupLink(user.id, "new").catch((error) => {
    console.error("[platform] setup email failed for %s: %s", body.email, error.message);
    return false;
  });

  console.log("[platform] created %s (%s) by %s", body.email, body.platformRole, req.user.email);
  res.json({ ok: true, created: true, emailSent: Boolean(sent), user: { email: user.email, platform_role: user.platform_role } });
}));

app.put("/api/platform/users/:id", requireAuth, requirePermission("platform.users"), asyncHandler(async (req, res) => {
  const body = z.object({
    platformRole: z.enum(["admin", "manager", "support"]).nullable().optional(),
    status: z.enum(["active", "inactive"]).optional()
  }).parse(req.body);

  // Nobody removes their own admin rights — that is how a platform ends up
  // with no administrator and no way back in.
  if (req.params.id === req.user.id && body.platformRole !== "admin") {
    return res.status(400).json({ error: "You cannot remove your own admin role. Ask another admin." });
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(body.platformRole !== undefined ? { platform_role: body.platformRole } : {}),
      ...(body.status ? { status: body.status } : {})
    },
    select: { email: true, platform_role: true, status: true }
  });
  console.log("[platform] %s updated %s -> role=%s status=%s", req.user.email, user.email, user.platform_role, user.status);
  res.json({ ok: true, user });
}));

// Pitch voice-agent admin (pipeline switch, Piper voices, previews).
// Own module so voice settings evolve without touching this file.
app.use("/api/pitch-admin", require("./routes/pitch-admin").buildRouter({ requireAuth }));

app.get("/api/ai-studio", requireAuth, asyncHandler(async (req, res) => {
  const config = await loadAistaffAiConfig(req.companyId);
  res.json({
    defaultGoal: DEFAULT_AI_GOAL,
    customInstructions: config.customInstructions,
    tone: config.tone,
    defaultLanguage: config.defaultLanguage,
    knowledgeBaseCount: config.knowledgeBase.length,
    knowledgeBase: config.knowledgeBase
  });
}));

/* Customer's own instructions — versioned per company, same mechanism as the
 * platform prompt. `prompt_revisions.key` is namespaced by company id, so one
 * tenant can never see or roll back another's. Live value stays on
 * CompanySetting.ai_custom_instructions, which is what the reply path reads;
 * the revisions are the history around it. */
const customKey = (companyId) => `closer_custom:${companyId}`;

app.get("/api/prompts/custom", requireAuth, asyncHandler(async (req, res) => {
  const revisions = await prisma.promptRevision.findMany({
    where: { key: customKey(req.companyId) },
    orderBy: { version: "desc" },
    select: { id: true, version: true, note: true, created_by: true, is_active: true, created_at: true, content: true }
  });
  res.json({ revisions });
}));

app.post("/api/prompts/custom", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ content: z.string().max(12000) }).parse(req.body);
  const key = customKey(req.companyId);
  const text = body.content.trim();

  const latest = await prisma.promptRevision.findFirst({ where: { key }, orderBy: { version: "desc" } });
  // Do not record a version when nothing changed — the history should be a
  // list of decisions, not of save-button presses.
  if (latest && latest.content === text) {
    return res.json({ ok: true, unchanged: true });
  }

  await prisma.$transaction([
    prisma.promptRevision.updateMany({ where: { key, is_active: true }, data: { is_active: false } }),
    prisma.promptRevision.create({
      data: {
        key,
        version: (latest?.version || 0) + 1,
        content: text,
        created_by: req.user.email,
        is_active: true
      }
    }),
    prisma.companySetting.update({
      where: { company_id: req.companyId },
      data: { ai_custom_instructions: text || null }
    })
  ]);

  clearAistaffAiConfigCache();
  res.json({ ok: true, version: (latest?.version || 0) + 1 });
}));

app.post("/api/prompts/custom/activate", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ version: z.number().int().positive() }).parse(req.body);
  const key = customKey(req.companyId);
  const target = await prisma.promptRevision.findFirst({ where: { key, version: body.version } });
  if (!target) return res.status(404).json({ ok: false, error: "That version does not exist." });

  await prisma.$transaction([
    prisma.promptRevision.updateMany({ where: { key, is_active: true }, data: { is_active: false } }),
    prisma.promptRevision.update({ where: { id: target.id }, data: { is_active: true } }),
    prisma.companySetting.update({
      where: { company_id: req.companyId },
      data: { ai_custom_instructions: target.content || null }
    })
  ]);

  clearAistaffAiConfigCache();
  res.json({ ok: true, version: target.version });
}));

app.put("/api/ai-studio/instructions", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    ai_custom_instructions: z.string().max(12000).optional().nullable()
  }).parse(req.body);
  const settings = await prisma.companySetting.update({
    where: { company_id: req.companyId },
    data: { ai_custom_instructions: body.ai_custom_instructions || null }
  });
  clearAistaffAiConfigCache();
  res.json({ ok: true, ai_custom_instructions: settings.ai_custom_instructions || "" });
}));

app.get("/api/ai-studio/memory", requireAuth, asyncHandler(async (req, res) => {
  const psid = String(req.query.psid || "").trim();
  if (!psid) return res.status(400).json({ error: "psid query parameter is required" });
  const memory = await getMessengerMemoryForPsid(psid, req.companyId);
  if (!memory) return res.status(404).json({ error: "No Messenger memory found for this PSID" });
  res.json(memory);
}));

app.get("/api/ai-studio/prompt-preview", requireAuth, asyncHandler(async (req, res) => {
  const psid = String(req.query.psid || "prompt_preview").trim();
  const messageText = String(req.query.message || "Hi").trim();
  const config = await loadAistaffAiConfig(req.companyId);
  const session = getAistaffSession(psid);
  const memory = await getMessengerMemoryForPsid(psid, req.companyId);
  if (memory?.memory) Object.assign(session, memory.memory);
  res.json({
    prompt: buildAdminPromptPreview(session, {}, messageText, config),
    psid,
    messageText
  });
}));

app.get("/api/qualification-questions", requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.qualificationQuestion.findMany({ where: { company_id: req.companyId }, orderBy: { display_order: "asc" } }));
}));

app.post("/api/qualification-questions", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    question: z.string().min(1),
    field_key: z.string().min(1),
    required: z.boolean().optional().default(true),
    display_order: z.number().optional().default(0),
    active: z.boolean().optional().default(true)
  }).parse(req.body);
  res.json(await prisma.qualificationQuestion.create({ data: { ...body, company_id: req.companyId } }));
}));

app.put("/api/qualification-questions/:id", requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.qualificationQuestion.update({ where: { id: req.params.id, company_id: req.companyId }, data: req.body }));
}));

app.get("/api/conversations", requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.conversation.findMany({
    where: { company_id: req.companyId },
    orderBy: { last_message_at: "desc" },
    include: {
      _count: { select: { messages: true } },
      messages: { orderBy: { created_at: "desc" }, take: 1 },
      leads: { orderBy: { created_at: "desc" }, take: 1 }
    }
  }));
}));

app.get("/api/conversations/:id", requireAuth, asyncHandler(async (req, res) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id, company_id: req.companyId },
    include: {
      messages: { orderBy: { created_at: "asc" } },
      leads: { orderBy: { created_at: "desc" }, take: 1 },
      human_handoffs: { orderBy: { created_at: "desc" }, take: 3 }
    }
  });
  if (!conversation) return res.status(404).json({ error: "Conversation not found" });
  res.json(conversation);
}));

app.post("/api/conversations/:id/handoff", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ reason: z.string().default("Admin requested human handoff") }).parse(req.body);
  const conversation = await prisma.conversation.update({
    where: { id: req.params.id, company_id: req.companyId },
    data: { needs_human: true, status: "handoff" }
  });
  const handoff = await prisma.humanHandoff.create({
    data: { company_id: req.companyId, conversation_id: conversation.id, reason: body.reason, assigned_to: req.user.id }
  });
  res.json(handoff);
}));

app.get("/api/leads", requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.lead.findMany({
    where: { company_id: req.companyId },
    orderBy: { updated_at: "desc" },
    include: { assigned_user: { select: { name: true, email: true } } }
  }));
}));

app.get("/api/leads/:id", requireAuth, asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findFirst({
    where: { id: req.params.id, company_id: req.companyId },
    include: {
      conversation: { include: { messages: { orderBy: { created_at: "asc" } }, human_handoffs: true } },
      quotations: { orderBy: { created_at: "desc" }, include: { items: true } },
      follow_ups: { orderBy: { due_date: "asc" } }
    }
  });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  res.json(lead);
}));

app.put("/api/leads/:id", requireAuth, asyncHandler(async (req, res) => {
  const data = { ...req.body };
  if (data.follow_up_date) data.follow_up_date = new Date(data.follow_up_date);
  // scoreLead() removed 2026-08-18 — it was English keyword matching. When a
  // human edits a lead by hand, their edit stands; the score is only
  // recalculated by the model on the next customer message. quotation_ready is
  // derived from this tenant's own required fields.
  const questions = await prisma.qualificationQuestion.findMany({
    where: { company_id: req.companyId, active: true }
  });
  data.quotation_ready = quotationReady(data, questions);
  const lead = await prisma.lead.update({ where: { id: req.params.id, company_id: req.companyId }, data });
  await maybeCreateQuotationDraft({ companyId: req.companyId, lead, conversationId: lead.conversation_id, preparedBy: req.user.id });
  res.json(lead);
}));

app.get("/api/quotations", requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.quotation.findMany({
    where: { company_id: req.companyId },
    orderBy: { created_at: "desc" },
    include: { lead: { select: { customer_name: true, company_name: true, service_needed: true } } }
  }));
}));

app.post("/api/quotations", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    lead_id: z.string(),
    quotation_details: z.string().min(1),
    amount: z.any().optional(),
    terms: z.string().optional().nullable()
  }).parse(req.body);
  const lead = await prisma.lead.findFirstOrThrow({ where: { id: body.lead_id, company_id: req.companyId } });
  const quotation = await prisma.quotation.create({
    data: {
      company_id: req.companyId,
      lead_id: lead.id,
      conversation_id: lead.conversation_id,
      quotation_number: await nextQuotationNumber(req.companyId),
      customer_name: lead.customer_name,
      customer_company: lead.company_name,
      service_needed: lead.service_needed,
      quotation_details: body.quotation_details,
      amount: numberOrNull(body.amount),
      terms: body.terms,
      status: "pending_approval",
      mode: "approval_required",
      prepared_by: req.user.id
    }
  });
  res.json(quotation);
}));

app.get("/api/quotations/:id", requireAuth, asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findFirst({
    where: { id: req.params.id, company_id: req.companyId },
    include: { items: true, lead: true, conversation: { include: { messages: { orderBy: { created_at: "asc" } } } } }
  });
  if (!quotation) return res.status(404).json({ error: "Quotation not found" });
  res.json(quotation);
}));

app.put("/api/quotations/:id", requireAuth, asyncHandler(async (req, res) => {
  const data = { ...req.body };
  if ("amount" in data) data.amount = numberOrNull(data.amount);
  res.json(await prisma.quotation.update({ where: { id: req.params.id, company_id: req.companyId }, data }));
}));

app.post("/api/quotations/:id/approve", requireAuth, asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.update({
    where: { id: req.params.id, company_id: req.companyId },
    data: { status: "approved", approved_by: req.user.id }
  });
  res.json(quotation);
}));

app.post("/api/quotations/:id/reject", requireAuth, asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.update({
    where: { id: req.params.id, company_id: req.companyId },
    data: { status: "rejected" }
  });
  res.json(quotation);
}));

app.post("/api/quotations/:id/send", requireAuth, asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findFirstOrThrow({
    where: { id: req.params.id, company_id: req.companyId },
    include: { conversation: { include: { facebook_page: true } } }
  });
  if (!["approved", "sent"].includes(quotation.status)) {
    return res.status(409).json({ error: "Quotation must be approved before sending." });
  }
  const text = [
    `Official quotation ${quotation.quotation_number}`,
    quotation.service_needed ? `Service: ${quotation.service_needed}` : "",
    quotation.amount ? `Amount: PHP ${quotation.amount}` : "Amount: Please see quotation details.",
    quotation.quotation_details,
    quotation.terms ? `Terms: ${quotation.terms}` : ""
  ].filter(Boolean).join("\n\n");

  if (quotation.conversation.facebook_page) {
    await sendMessengerText(quotation.conversation.facebook_page, quotation.conversation.psid, text);
  }
  const sent = await prisma.quotation.update({
    where: { id: quotation.id },
    data: { status: "sent", sent_at: new Date() }
  });
  await prisma.message.create({
    data: {
      company_id: req.companyId,
      conversation_id: quotation.conversation_id,
      sender_type: "admin",
      sender_id: req.user.id,
      message_text: text,
      ai_generated: false
    }
  });
  res.json(sent);
}));

const BOOKING_STATUSES = new Set(["requested", "pending_confirmation", "confirmed", "paid", "cancelled", "completed", "no_show"]);
const BOOKING_CALENDAR_VISIBLE_STATUSES = new Set(["requested", "pending_confirmation", "confirmed", "paid", "completed"]);

async function ensureBookingSetting(companyId) {
  return prisma.bookingSetting.upsert({
    where: { company_id: companyId },
    update: {},
    create: { company_id: companyId }
  });
}

function serializeBookingService(service) {
  if (!service) return null;
  return {
    ...service,
    price: service.price == null ? null : Number(service.price),
    deposit_amount: service.deposit_amount == null ? null : Number(service.deposit_amount)
  };
}

function serializeBooking(booking) {
  if (!booking) return null;
  return {
    ...booking,
    service: serializeBookingService(booking.service)
  };
}

function calendarSecret() {
  return process.env.BOOKING_CALENDAR_SECRET || process.env.JWT_SECRET || "local-dev-secret-change-me";
}

function signBookingCalendarToken(companyId) {
  const signature = crypto
    .createHmac("sha256", calendarSecret())
    .update(String(companyId))
    .digest("base64url");
  return `${companyId}.${signature}`;
}

function verifyBookingCalendarToken(token) {
  const raw = String(token || "");
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const companyId = raw.slice(0, dot);
  const expected = signBookingCalendarToken(companyId);
  const a = Buffer.from(raw);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return companyId;
}

function bookingCalendarFeedUrl(req, companyId) {
  return `${getAppUrl(req)}/api/bookings/calendar.ics?token=${encodeURIComponent(signBookingCalendarToken(companyId))}`;
}

function icsDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsEscape(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function icsLine(name, value) {
  const raw = `${name}:${icsEscape(value)}`;
  const chunks = [];
  let current = raw;
  while (current.length > 74) {
    chunks.push(current.slice(0, 74));
    current = ` ${current.slice(74)}`;
  }
  chunks.push(current);
  return chunks.join("\r\n");
}

function renderBookingCalendarIcs({ company, setting, bookings }) {
  const calendarName = `AIStaff Bookings - ${company.name}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AIStaff//Tenant Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    icsLine("X-WR-CALNAME", calendarName),
    icsLine("X-WR-TIMEZONE", setting?.timezone || "Asia/Manila")
  ];

  for (const booking of bookings) {
    const ref = `BK-${String(booking.id).slice(0, 8).toUpperCase()}`;
    const contact = [booking.mobile_number, booking.email].filter(Boolean).join(" · ");
    const detailValues = booking.field_values && typeof booking.field_values === "object"
      ? Object.entries(booking.field_values).map(([key, value]) => `${key}: ${value}`)
      : [];
    const description = [
      `Reference: ${ref}`,
      `Status: ${String(booking.status || "").replace(/_/g, " ")}`,
      contact ? `Contact: ${contact}` : "",
      booking.notes || "",
      ...detailValues
    ].filter(Boolean).join("\n");
    const location = booking.field_values?.meeting_link
      || booking.service?.location
      || booking.field_values?.branch_location
      || booking.field_values?.address
      || "";

    lines.push(
      "BEGIN:VEVENT",
      icsLine("UID", `${booking.id}@aistaff.click`),
      icsLine("DTSTAMP", icsDate(booking.updated_at || booking.created_at || new Date())),
      icsLine("DTSTART", icsDate(booking.start_at)),
      icsLine("DTEND", icsDate(booking.end_at)),
      icsLine("SUMMARY", `${booking.service_name} - ${booking.customer_name}`),
      icsLine("DESCRIPTION", description),
      booking.field_values?.meeting_link ? icsLine("URL", booking.field_values.meeting_link) : "",
      location ? icsLine("LOCATION", location) : "",
      icsLine("STATUS", booking.status === "confirmed" || booking.status === "paid" || booking.status === "completed" ? "CONFIRMED" : "TENTATIVE"),
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.filter(Boolean).join("\r\n")}\r\n`;
}

function bookingNeedsExclusiveTime(setting, serviceName, fieldValues = {}) {
  const haystack = [
    setting?.booking_type,
    serviceName,
    fieldValues.preferred_meeting_channel,
    fieldValues.purpose,
    fieldValues.onboarding_topic
  ].filter(Boolean).join(" ").toLowerCase();
  return setting?.booking_type === "ai_service_onboarding"
    || /online|video|jitsi|zoom|meet|meeting|consult|consultation|onboarding|demo|call/.test(haystack);
}

app.get("/api/bookings", requireAuth, asyncHandler(async (req, res) => {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 7);
  const to = new Date(today);
  to.setDate(to.getDate() + 45);

  const [setting, services, bookings] = await Promise.all([
    ensureBookingSetting(req.companyId),
    prisma.bookingService.findMany({
      where: { company_id: req.companyId },
      orderBy: [{ active: "desc" }, { display_order: "asc" }, { created_at: "asc" }]
    }),
    prisma.booking.findMany({
      where: { company_id: req.companyId, start_at: { gte: from, lte: to } },
      orderBy: { start_at: "asc" },
      include: { service: true, lead: { select: { customer_name: true, service_needed: true } }, conversation: { select: { channel: true, psid: true, external_id: true } } }
    })
  ]);

  res.json({
    setting,
    calendar_feed_url: bookingCalendarFeedUrl(req, req.companyId),
    services: services.map(serializeBookingService),
    bookings: bookings.map(serializeBooking)
  });
}));

app.get("/api/bookings/calendar.ics", asyncHandler(async (req, res) => {
  const companyId = verifyBookingCalendarToken(req.query.token);
  if (!companyId) return res.status(403).type("text/plain").send("Invalid calendar token");

  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 30);
  const to = new Date(now);
  to.setDate(to.getDate() + 365);

  const [company, setting, bookings] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } }),
    ensureBookingSetting(companyId),
    prisma.booking.findMany({
      where: {
        company_id: companyId,
        status: { in: Array.from(BOOKING_CALENDAR_VISIBLE_STATUSES) },
        start_at: { gte: from, lte: to }
      },
      orderBy: { start_at: "asc" },
      include: { service: true }
    })
  ]);
  if (!company) return res.status(404).type("text/plain").send("Calendar not found");

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Disposition", `inline; filename="aistaff-${company.id}-bookings.ics"`);
  res.send(renderBookingCalendarIcs({ company, setting, bookings }));
}));

app.put("/api/bookings/settings", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    enabled: z.boolean().optional(),
    timezone: z.string().min(1).max(80).optional(),
    slot_interval_minutes: z.number().int().min(5).max(240).optional(),
    min_notice_minutes: z.number().int().min(0).max(10080).optional(),
    max_days_ahead: z.number().int().min(1).max(365).optional(),
    business_hours: z.any().optional(),
    booking_type: z.string().min(1).max(80).optional(),
    field_mode: z.enum(["preset", "custom"]).optional(),
    required_fields: z.array(z.string().min(1).max(80)).max(80).optional(),
    instructions: z.string().max(4000).optional().nullable()
  }).parse(req.body);

  await ensureBookingSetting(req.companyId);
  const setting = await prisma.bookingSetting.update({
    where: { company_id: req.companyId },
    data: body
  });
  res.json(setting);
}));

app.post("/api/bookings/services", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(1).max(140),
    description: z.string().max(2000).optional().nullable(),
    duration_minutes: z.number().int().min(5).max(1440).optional().default(60),
    price: z.any().optional().nullable(),
    deposit_amount: z.any().optional().nullable(),
    location: z.string().max(160).optional().nullable(),
    active: z.boolean().optional().default(true),
    display_order: z.number().int().optional().default(0)
  }).parse(req.body);
  const service = await prisma.bookingService.create({
    data: {
      ...body,
      price: numberOrNull(body.price),
      deposit_amount: numberOrNull(body.deposit_amount),
      company_id: req.companyId
    }
  });
  res.json(serializeBookingService(service));
}));

app.put("/api/bookings/services/:id", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(1).max(140).optional(),
    description: z.string().max(2000).optional().nullable(),
    duration_minutes: z.number().int().min(5).max(1440).optional(),
    price: z.any().optional().nullable(),
    deposit_amount: z.any().optional().nullable(),
    location: z.string().max(160).optional().nullable(),
    active: z.boolean().optional(),
    display_order: z.number().int().optional()
  }).parse(req.body);
  const data = { ...body };
  if ("price" in data) data.price = numberOrNull(data.price);
  if ("deposit_amount" in data) data.deposit_amount = numberOrNull(data.deposit_amount);
  const service = await prisma.bookingService.update({
    where: { id: req.params.id, company_id: req.companyId },
    data
  });
  res.json(serializeBookingService(service));
}));

app.post("/api/bookings", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    service_id: z.string().optional().nullable(),
    customer_name: z.string().trim().min(1).max(160),
    mobile_number: z.string().max(60).optional().nullable(),
    email: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
    service_name: z.string().trim().max(160).optional().nullable(),
    start_at: z.string().min(1),
    status: z.string().optional().default("requested"),
    field_values: z.record(z.any()).optional().default({}),
    notes: z.string().max(3000).optional().nullable(),
    lead_id: z.string().optional().nullable(),
    conversation_id: z.string().optional().nullable()
  }).parse(req.body);
  if (!BOOKING_STATUSES.has(body.status)) return res.status(400).json({ error: "Invalid booking status" });

  const service = body.service_id
    ? await prisma.bookingService.findFirst({ where: { id: body.service_id, company_id: req.companyId } })
    : null;
  if (body.service_id && !service) return res.status(404).json({ error: "Booking service not found" });

  const start = new Date(body.start_at);
  if (Number.isNaN(start.getTime())) return res.status(400).json({ error: "Choose a valid booking date and time." });
  const duration = service?.duration_minutes || 60;
  const end = new Date(start.getTime() + duration * 60 * 1000);
  const serviceName = body.service_name || service?.name || "Booking";

  const setting = await ensureBookingSetting(req.companyId);
  if (bookingNeedsExclusiveTime(setting, serviceName, body.field_values)) {
    const conflict = await prisma.booking.findFirst({
      where: {
        company_id: req.companyId,
        status: { in: ["requested", "pending_confirmation", "confirmed", "paid"] },
        start_at: { lt: end },
        end_at: { gt: start }
      },
      orderBy: { start_at: "asc" }
    });
    if (conflict) {
      return res.status(409).json({
        error: "That time already has a meeting-style booking. Choose another time or update the existing booking."
      });
    }
  }

  if (body.lead_id) {
    await prisma.lead.findFirstOrThrow({ where: { id: body.lead_id, company_id: req.companyId } });
  }
  if (body.conversation_id) {
    await prisma.conversation.findFirstOrThrow({ where: { id: body.conversation_id, company_id: req.companyId } });
  }

  const booking = await prisma.booking.create({
    data: {
      company_id: req.companyId,
      service_id: service?.id || null,
      lead_id: body.lead_id || null,
      conversation_id: body.conversation_id || null,
      customer_name: body.customer_name,
      mobile_number: body.mobile_number || null,
      email: body.email || null,
      service_name: serviceName,
      start_at: start,
      end_at: end,
      status: body.status,
      source: "admin",
      field_values: body.field_values,
      notes: body.notes || null
    },
    include: { service: true }
  });
  res.json(serializeBooking(booking));
}));

app.put("/api/bookings/:id/status", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ status: z.string() }).parse(req.body);
  if (!BOOKING_STATUSES.has(body.status)) return res.status(400).json({ error: "Invalid booking status" });
  const booking = await prisma.booking.update({
    where: { id: req.params.id, company_id: req.companyId },
    data: { status: body.status },
    include: { service: true }
  });
  res.json(serializeBooking(booking));
}));

app.get("/api/follow-ups", requireAuth, asyncHandler(async (req, res) => {
  res.json(await prisma.followUp.findMany({
    where: { company_id: req.companyId },
    orderBy: { due_date: "asc" },
    include: { lead: true, assigned_user: { select: { name: true } } }
  }));
}));

app.post("/api/follow-ups", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    lead_id: z.string(),
    due_date: z.string(),
    note: z.string().optional(),
    assigned_to: z.string().optional().nullable()
  }).parse(req.body);
  const lead = await prisma.lead.findFirstOrThrow({ where: { id: body.lead_id, company_id: req.companyId } });
  res.json(await prisma.followUp.create({
    data: {
      company_id: req.companyId,
      lead_id: lead.id,
      conversation_id: lead.conversation_id,
      due_date: new Date(body.due_date),
      note: body.note,
      assigned_to: body.assigned_to || req.user.id
    }
  }));
}));

app.get("/api/marketing", requireAuth, asyncHandler(async (req, res) => {
  res.json(getMarketingOverview());
}));

app.patch("/api/marketing/checklist", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ id: z.string().min(1), done: z.boolean() }).parse(req.body);
  res.json({ checklist: updateChecklistItem(body.id, body.done) });
}));

app.patch("/api/marketing/ad-review", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    id: z.string().min(1),
    status: z.enum(["draft", "approved", "needs_changes"]).optional(),
    note: z.string().optional()
  }).parse(req.body);
  res.json({ review: updateAdReview(body.id, body) });
}));

app.put("/api/marketing/notes", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ notes: z.string() }).parse(req.body);
  res.json({ notes: updateMarketingNotes(body.notes) });
}));

app.post("/api/marketing/generate-voiceover", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ compositionId: z.string().min(1) }).parse(req.body);
  await generateVoiceover(body.compositionId);
  res.json({ ok: true, message: "Voiceover audio generated. You can export MP4 now." });
}));

app.get("/api/marketing/render-status", requireAuth, asyncHandler(async (req, res) => {
  res.json({ items: getRenderStatus() });
}));

app.post("/api/marketing/render", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({ compositionId: z.string().min(1), kind: z.enum(["video", "still"]).default("video") }).parse(req.body);
  const existing = getRenderStatus().find((item) => item.compositionId === body.compositionId);
  if (existing?.exportJob?.status === "running") {
    return res.json({ ok: true, alreadyRunning: true, exportJob: existing.exportJob });
  }

  const fn = body.kind === "still" ? renderPreviewStill : renderCreative;
  fn(body.compositionId).catch((error) => {
    console.error("Marketing render failed:", error.message);
  });
  res.json({
    ok: true,
    started: true,
    compositionId: body.compositionId,
    kind: body.kind,
    exportJob: getLatestJobForComposition(body.compositionId)
  });
}));

app.post("/api/marketing/test-bot", requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    message: z.string().min(1),
    psid: z.string().default("admin_bot_test")
  }).parse(req.body);
  const reply = await generateAistaffDemoReply(body.message, body.psid);
  res.json({ reply });
}));

app.get("/api/marketing/review-summary", requireAuth, asyncHandler(async (req, res) => {
  const [auditLeads, demoInquiries, websiteAudits, recentDemoMessages] = await Promise.all([
    prisma.lead.count({ where: { company_id: req.companyId, lead_status: "new" } }),
    prisma.conversation.count({ where: { company_id: req.companyId, intent: "aistaff_demo_inquiry" } }),
    prisma.conversation.count({ where: { company_id: req.companyId, channel: "website_audit" } }),
    prisma.conversation.findMany({
      where: { company_id: req.companyId, intent: "aistaff_demo_inquiry" },
      orderBy: { last_message_at: "desc" },
      take: 5,
      include: { messages: { orderBy: { created_at: "desc" }, take: 4 } }
    })
  ]);
  res.json({ auditLeads, demoInquiries, websiteAudits, recentDemoMessages });
}));

app.post("/api/demo/inbound-message", requireAuth, asyncHandler(async (req, res) => {
  const page = await prisma.facebookPage.findFirst({ where: { company_id: req.companyId } });
  const conversation = await prisma.conversation.upsert({
    where: { company_id_psid: { company_id: req.companyId, psid: body.psid } },
    create: { company_id: req.companyId, facebook_page_id: page?.id, psid: body.psid, channel: "facebook_messenger", last_message_at: new Date() },
    update: { last_message_at: new Date() }
  });
  await prisma.message.create({ data: { company_id: req.companyId, conversation_id: conversation.id, sender_type: "customer", sender_id: body.psid, message_text: body.message } });
  let lead = await prisma.lead.findFirst({ where: { company_id: req.companyId, conversation_id: conversation.id } });
  if (!lead) lead = await prisma.lead.create({ data: { company_id: req.companyId, conversation_id: conversation.id } });
  const ai = await generateSalesReply({ companyId: req.companyId, conversationId: conversation.id, message: body.message });
  const updatedLead = await prisma.lead.update({
    where: { id: lead.id },
    data: { ...ai.leadPatch, lead_score: ai.leadScore, quotation_ready: ai.quotationReady, lead_status: ai.quotationReady ? "quotation_ready" : "contacted" }
  });
  await prisma.message.create({ data: { company_id: req.companyId, conversation_id: conversation.id, sender_type: "ai", sender_id: "ai_sales_assistant", message_text: ai.reply, ai_generated: true } });
  await maybeCreateQuotationDraft({ companyId: req.companyId, lead: updatedLead, conversationId: conversation.id, preparedBy: req.user.id });
  res.json({ conversation_id: conversation.id, reply: ai.reply, lead: updatedLead });
}));

app.get("/admin", (req, res) => {
  res.redirect(302, "/admin/dashboard");
});

// ---------------------------------------------------------------------
// AIStaff Super Admin (global platform console — NOT the customer/tenant
// dashboard above). See src/admin/routes.js's header comment for why this
// lives at /superadmin instead of /admin.
// ---------------------------------------------------------------------
app.use("/api/superadmin", require("./admin/routes"));
mountSuperAdminPages(app);

app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "privacy", "index.html"));
});

app.get("/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "terms", "index.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use((error, req, res, next) => {
  // console.error(error) on some Prisma/Zod errors throws inside Node's
  // inspect(), which crashes the error handler and hides the real cause —
  // the client just gets a bare HTML 500. Log the useful fields directly.
  console.error("[error]", req.method, req.originalUrl, "->", error && error.name, error && error.message);
  if (error && error.stack) console.error(String(error.stack).split("\n").slice(0, 6).join("\n"));
  if (error.name === "ZodError") return res.status(400).json({ error: "Validation failed", details: error.errors });
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return res.status(error.statusCode).json({ error: error.message || "Request failed" });
  }
  res.status(500).json({ error: error.message || "Server error" });
});

app.listen(port, () => {
  console.log(`AI Inbox Sales Assistant running at http://localhost:${port}`);
});

// ---------------------------------------------------------------------
// Process-level resilience.
//
// ROOT CAUSE FIX (see Brandee reliability task deliverables report): this
// process previously had NO global unhandledRejection/uncaughtException
// handler. `src/db.js` constructs `new PrismaClient()` at module load time;
// whenever that client's compiled query-engine binary doesn't match the
// runtime OS/architecture (for example: right after a `prisma/schema.prisma`
// change, before `prisma generate` has been re-run for the deploy target —
// exactly the situation this repo was left in after the previous session's
// admin-system migration), Prisma's engine resolution fails asynchronously,
// AFTER `app.listen` has already logged success, with no request involved
// at all. Node's default behavior for an unhandled rejection is to crash
// the entire process — which took the fully independent, JSON-file-backed
// Brandee pipeline down as collateral damage, even though Brandee itself
// never touches Prisma. That is what customers were experiencing as
// "Brandee could not build a plan" — not a bug in the scraping, extraction,
// or planning logic (verified: the deterministic planner was reproduced
// successfully across every goal/platform/language combination and both
// scraped and manual-fallback paths).
//
// This does not hide real bugs — it only prevents ONE unrelated subsystem's
// async failure from being fatal to the whole application. Full technical
// detail is still logged server-side (never surfaced to the browser).
process.on("unhandledRejection", (reason) => {
  console.error("[process] Unhandled promise rejection (process kept alive):", reason?.stack || reason);
});
process.on("uncaughtException", (error) => {
  console.error("[process] Uncaught exception (process kept alive):", error?.stack || error);
});
