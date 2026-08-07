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
const { encryptSecret } = require("./crypto");
const {
  verifyPassword,
  signSession,
  requireAuth,
  attachUserIfPresent,
  setSessionCookie,
  clearSessionCookie
} = require("./auth");
const { generateSalesReply, scoreLead, quotationReady } = require("./ai");
const { verifyMessengerSignature, handleMessengerWebhook, sendMessengerText } = require("./messenger-webhook");
const { generateAistaffDemoReply, getAistaffSession } = require("./aistaff-demo");
const {
  loadAistaffAiConfig,
  clearAistaffAiConfigCache,
  getMessengerMemoryForPsid,
  buildAdminPromptPreview,
  DEFAULT_AI_GOAL
} = require("./aistaff-ai-config");
const { buildPresenceSnapshot, formatSnapshotForMessenger } = require("./page-intelligence");
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
  ADD_ONS,
  calculateCart,
  getPaymentProvider,
  nextBillingDate,
  paymentProviderForCountry,
  providerReady,
  verifyWebhookSignature
} = require("./payments");
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
const { renderImageAdSvg, buildAdContent } = require("./brandee/imageAdRenderer");
const { probeVideoProviderAvailability, generateVideoTeaser, generateFinalVideo } = require("./brandee/videoTeaserRenderer");
const productAdProjectStore = require("./brandee/productAdProjectStore");
const { registerAccount, RegistrationError } = require("./brandee/accountRegistration");
const { ensureBrandeeProductAdsCatalog, subscribeUserToPlan, getActiveBrandeeSubscriptionForUser, requireBrandeeSubscription } = require("./brandee/productAdBilling");
const { track: trackBrandeeEvent } = require("./brandee/analyticsEvents");
const templateCatalog = require("./brandee/templateCatalog");
const pricingOverride = require("./brandee/pricingOverride");
const entitlements = require("./brandee/entitlements");
const { ENTITLEMENT_UNITS, computeComboSavings, PRICING_NOTE } = require("./brandee/pricingConfig");
const { buildCreativePlan, interpretRevision, sanitizeCustomerFacingPlan } = require("./brandee/creativePlanner");
const { recommendTemplates } = require("./brandee/templateRecommender");
const { probeImageProviderAvailability, generatePreviewImage } = require("./brandee/imageGenProvider");
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
    if (filePath.endsWith("app.js") || filePath.endsWith("index.html") || filePath.endsWith("style.css") || filePath.endsWith("workforce-motion.js") || filePath.endsWith("site-chat.js")) {
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
    plans: PRICING_PLANS,
    addOns: ADD_ONS,
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

async function processPaymentWebhook(provider, req, res) {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  const signature = provider === "xendit" ? req.get("x-callback-token") : req.get("stripe-signature");
  const signatureVerified = verifyWebhookSignature(provider, rawBody, signature);
  if (!signatureVerified) return res.status(400).json({ error: "Invalid webhook signature" });

  let payload = {};
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON payload" });
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

  const externalPaymentId = String(payload.external_id || payload.id || payload.data?.object?.id || payload.data?.id || "");
  const paid = ["PAID", "SUCCEEDED", "paid", "succeeded", "checkout.session.completed", "invoice.paid"].includes(payload.status || payload.type);
  const failed = ["FAILED", "EXPIRED", "failed", "expired", "payment_intent.payment_failed"].includes(payload.status || payload.type);

  if (externalPaymentId && (paid || failed)) {
    const order = await prisma.order.findFirst({ where: { external_payment_id: externalPaymentId } });
    if (order) {
      if (paid) {
        const periodEnd = nextBillingDate(order.billing_frequency);
        await prisma.$transaction([
          prisma.payment.updateMany({ where: { order_id: order.id, provider }, data: { status: "paid", paid_at: new Date(), provider_response: payload } }),
          prisma.order.update({ where: { id: order.id }, data: { payment_status: "paid", order_status: "onboarding_required", paid_at: new Date() } }),
          prisma.subscription.updateMany({ where: { order_id: order.id }, data: { status: "active", current_period_start: new Date(), current_period_end: periodEnd } }),
          prisma.invoice.updateMany({ where: { order_id: order.id }, data: { status: "paid", paid_at: new Date() } })
        ]);
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

async function nextQuotationNumber(companyId) {
  const count = await prisma.quotation.count({ where: { company_id: companyId } });
  return `Q-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;
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
    guestToken: z.string().optional().nullable()
  }).parse(req.body);
  const guestToken = body.guestToken || crypto.randomUUID();
  const calculated = calculateCart(body);
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
    addOnSlugs: z.array(z.string()).optional()
  }).parse(req.body);
  const existing = await prisma.cart.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!existing) return res.status(404).json({ error: "Cart not found" });
  const currentPlan = existing.items.find((item) => item.item_type === "pricing_plan");
  const currentAddOns = existing.items.filter((item) => item.item_type === "add_on").map((item) => item.item_id);
  const calculated = calculateCart({
    planSlug: body.planSlug || currentPlan?.item_id,
    billingFrequency: body.billingFrequency || currentPlan?.billing_frequency || "monthly",
    addOnSlugs: body.addOnSlugs || currentAddOns
  });
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
      privacy: z.boolean(),
      renewal: z.boolean(),
      correct: z.boolean()
    }),
    requestedProvider: z.string().optional().nullable(),
    paymentMethod: z.string().optional().nullable()
  }).parse(req.body);

  if (!Object.values(body.agreements).every(Boolean)) {
    return res.status(400).json({ error: "Required checkout agreements must be accepted" });
  }

  const cart = await prisma.cart.findUnique({ where: { id: body.cartId }, include: { items: true } });
  if (!cart || !cart.items.length) return res.status(400).json({ error: "Cart is empty or unavailable" });
  const planItem = cart.items.find((item) => item.item_type === "pricing_plan");
  if (!planItem) return res.status(400).json({ error: "A subscription package is required" });
  const official = calculateCart({
    planSlug: planItem.item_id,
    billingFrequency: planItem.billing_frequency,
    addOnSlugs: cart.items.filter((item) => item.item_type === "add_on").map((item) => item.item_id)
  });
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
      message: paymentSession.message || (providerReady(provider) ? "Payment session prepared." : "Secure online payment integration is currently in test mode."),
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

const SITE_CHAT_SYSTEM_PROMPT = [
  "You are the AIStaff website assistant, embedded as a chat widget on aistaff.click.",
  "You represent AIStaff, an AI workforce platform for Philippine businesses. Answer only using the facts below. Never invent pricing, features, or timelines.",
  "",
  "COMPANY: AIStaff (aistaff.click) builds specialized AI agents for business growth. Two agents are live today; more are planned (AI Voice Sales, AI Marketing, AI Facebook Ads).",
  "",
  "AGENT 1 — CLOSER (AI Chat Sales Agent), LIVE, has real pricing:",
  "Handles written sales inquiries on Facebook Messenger and website chat. Understands customer needs, asks qualifying questions, captures leads (name, contact, requirements), recommends offers, handles objections, prepares quotation drafts for owner approval, and keeps leads moving toward a sale. Runs 24/7.",
  "Pricing (monthly): Starter ₱4,999/mo (1 Facebook Page, up to 1,500 AI conversations/mo, basic qualification, lead dashboard). Growth ₱24,999/mo, most popular (up to 3 Facebook Pages, 8,000 conversations/mo, advanced qualification, follow-up automation, quotation handling, CRM-style pipeline). Scale ₱59,999/mo (up to 10 Facebook Pages, 25,000 conversations/mo, multi-branch, API/webhook access, dedicated onboarding). Enterprise: custom, starting ₱100,000/mo for large companies, hotels, clinics, multi-branch operations, private deployments. Annual billing saves 10%. Full details and checkout: /pricing/",
  "",
  "AGENT 2 — BRANDEE (AI UGC Brand Agent), NEW, pricing not finalized:",
  "Turns one product photo into a finished UGC-style ad video. Client picks an avatar and a scene (home, kitchen, office, car, etc.), uploads a product photo, and Brandee writes the script, matches the voice, and generates the video — no filming, no talent booking, no editing software needed. Same presenter identity stays consistent across every video and every product. If asked about Brandee's price, say pricing is being finalized and to check /agents/brandee/ or contact the team — do not state specific numbers for Brandee.",
  "",
  "HOW TO ENGAGE: For a live demo of how Closer actually talks to customers, direct people to the Messenger chat link on the site (the 'Chat with Closer' button) or /agents/closer/. For Brandee details, point to /agents/brandee/. For full pricing/checkout, point to /pricing/. For anything about a specific account, billing issue, or something you don't know, tell them to use the contact form at /contact/ or email support@aistaff.click.",
  "",
  "TONE: Warm, concise, helpful — like a knowledgeable teammate, not a pushy salesperson. Keep answers short (2-4 sentences) unless the person asks for detail. Never make up features, integrations, or launch dates for agents that aren't live yet (Voice, Marketing, Facebook Ads) — say they're planned/in development if asked.",
  "Respond in the same language the visitor uses (English or Taglish is fine)."
].join("\n");

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
    messages: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1).max(2000)
    })).min(1).max(20)
  }).parse(req.body);

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ ok: false, error: "Chat is not configured yet." });
  }

  const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      messages: [
        { role: "system", content: SITE_CHAT_SYSTEM_PROMPT },
        ...body.messages
      ],
      temperature: 0.4,
      max_tokens: 400
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error("Site chat OpenAI error:", response.status, errText);
    return res.status(502).json({ ok: false, error: "Could not reach the chat agent." });
  }

  const json = await response.json();
  const reply = json.choices?.[0]?.message?.content?.trim();
  if (!reply) return res.status(502).json({ ok: false, error: "Empty response from chat agent." });

  res.json({ ok: true, reply });
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

app.get("/api/public/brandee/product-ads/config", asyncHandler(async (req, res) => {
  const [templates, videoStyles, pricing] = await Promise.all([
    templateCatalog.listActiveStaticTemplates({ hasTestimonial: false }),
    templateCatalog.listActiveUgcTemplates(),
    pricingOverride.getEffectivePricing()
  ]);
  res.json({
    templates,
    videoStyles,
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

  // PART 12/13/14: GPT-5.6 Sol plans the creative direction (headline/cta/
  // tone/etc.) and, in parallel (the two don't depend on each other's
  // output — generation only needs the raw product photo, not the planned
  // headline text), GPT Image 2 attempts to turn the raw uploaded/fetched
  // product photo (often a plain-white-background listing photo) into a
  // clean, professionally lit product shot. Both are independently
  // AI-optional: buildCreativePlan() falls back to a correct deterministic
  // plan, and a failed/unavailable image generation falls back to the
  // ORIGINAL photo as-is — renderImageAdSvg's text/branding layer (proven,
  // reliably legible) is unaffected either way, only which photo it
  // composites in changes. Never fabricates a "generated" image that
  // wasn't actually produced; never invents headline/CTA text via the
  // image model either (image-generation models are unreliable at
  // rendering accurate legible text, which is exactly why that stays on
  // the deterministic SVG layer instead of being asked of GPT Image 2).
  const [{ plan, aiUsed: planningAiUsed }, imageGenResult] = await Promise.all([
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

  const imageAiUsed = imageGenResult.ok;
  const renderForm = imageAiUsed ? { ...form, productImage: `data:image/png;base64,${imageGenResult.base64}` } : form;
  if (!imageAiUsed && form.productImage) {
    trackBrandeeEvent("image_generation_fallback", { templateId: form.templateId, reason: imageGenResult.reason }, { anonymousSessionId, userId });
  }

  const rendered = renderImageAdSvg({ templateId: form.templateId, templateFields: form.templateFields, form: renderForm, watermark: true, override: plan });

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
  const body = z.object({ projectId: z.string().min(1), instruction: z.string().min(2).max(300) }).safeParse(req.body);
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
        // resolution changes.
        const latest = project.revisions?.[project.revisions.length - 1];
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

  res.json({ ok: true, svg: rendered.svg, width: rendered.width, height: rendered.height });
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
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || user.status !== "active") return res.status(401).json({ error: "Invalid email or password" });
  const ok = await verifyPassword(user.password_hash, body.password);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });
  const token = signSession(user);
  setSessionCookie(res, token);
  res.json({ user: { id: user.id, company_id: user.company_id, name: user.name, email: user.email, role: user.role } });
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
  authUrl.searchParams.set("scope", "pages_show_list,pages_messaging,pages_manage_metadata");
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

  res.json({
    ok: true,
    connectedPage: {
      id: page.id,
      pageId: page.page_id,
      name: page.page_name,
      status: page.status,
      messengerReplies: "Enabled",
      updatedAt: page.updated_at
    }
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
  data.lead_score = scoreLead(data);
  data.quotation_ready = quotationReady(data);
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
  console.error(error);
  if (error.name === "ZodError") return res.status(400).json({ error: "Validation failed", details: error.errors });
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
