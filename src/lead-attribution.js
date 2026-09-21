const crypto = require("crypto");

const EVENT_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{1,80}$/;
const ATTRIBUTION_KEYS = [
  "source_page",
  "page_url",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "gclid"
];

const FUNNEL_STAGES = [
  {
    key: "traffic",
    label: "Traffic",
    definition: "Visitor reached an AIStaff page and the Pixel fired.",
    eventNames: ["PageView"]
  },
  {
    key: "demo",
    label: "Demo engaged",
    definition: "Visitor opened or completed the Closer public demo.",
    eventNames: ["AIStaffDemoBuildClick", "AIStaffDemoBuilt", "WebsiteChatOpened", "WebsiteChatMessageSent"]
  },
  {
    key: "offer",
    label: "Offer viewed",
    definition: "Visitor showed buying intent by viewing pricing or package details.",
    eventNames: ["ViewContent", "AIStaffDemoPricingIntent"]
  },
  {
    key: "package",
    label: "Package selected",
    definition: "Visitor clicked a package or selected a cart plan.",
    eventNames: ["AIStaffPricingPlanClick", "AIStaffPricingAddToCartIntent", "AddToCart"]
  },
  {
    key: "checkout",
    label: "Checkout started",
    definition: "Visitor clicked through to QRPh checkout.",
    eventNames: ["AIStaffQRPhCheckoutClick", "InitiateCheckout"]
  },
  {
    key: "payment_ready",
    label: "Payment prepared",
    definition: "Checkout created payment details or the visitor resumed payment.",
    eventNames: ["AddPaymentInfo", "AIStaffQRPhCheckoutPrepared", "AIStaffQRPhCheckoutResume"]
  },
  {
    key: "lead",
    label: "Lead",
    definition: "AIStaff saved a customer opportunity, or Meta received the Lead event.",
    eventNames: ["Lead"]
  },
  {
    key: "purchase",
    label: "Purchase",
    definition: "Payment was confirmed and the Purchase event fired.",
    eventNames: ["Purchase"]
  }
];

const FUNNEL_EVENT_TO_STAGE = FUNNEL_STAGES.reduce((map, stage) => {
  stage.eventNames.forEach((eventName) => {
    map.set(eventName, stage.key);
  });
  return map;
}, new Map());
const METADATA_KEYS = new Set([
  ...ATTRIBUTION_KEYS,
  "content_name",
  "content_category",
  "content_type",
  "selected_plan",
  "billing_frequency",
  "payment_method",
  "order_id",
  "lead_type",
  "business_name",
  "checkout_status",
  "currency",
  "value",
  "test_event_code",
  "testEventCode",
  "agent"
]);

function trimText(value, max = 500) {
  const text = String(value || "").trim();
  return text ? text.slice(0, max) : null;
}

function metadataFrom(properties = {}) {
  const clean = {};
  for (const [key, raw] of Object.entries(properties || {})) {
    if (!METADATA_KEYS.has(key)) continue;
    if (raw === null || raw === undefined || raw === "") continue;
    if (Array.isArray(raw)) {
      clean[key] = raw.map((item) => trimText(item, 120)).filter(Boolean).slice(0, 12);
    } else if (typeof raw !== "object") {
      clean[key] = trimText(raw, 500);
    }
  }
  return clean;
}

function attributionFromBody(body = {}) {
  const properties = metadataFrom(body.properties || {});
  const direct = metadataFrom(body);
  return { ...properties, ...direct };
}

function sourceLabelFor(attribution = {}) {
  const source = String(attribution.utm_source || "").toLowerCase();
  const medium = String(attribution.utm_medium || "").toLowerCase();
  const referrer = String(attribution.referrer || "").toLowerCase();
  if (attribution.fbclid || /facebook|meta|instagram|ig\b/.test(source) || /facebook|instagram/.test(referrer)) return "Facebook / Instagram ad";
  if (attribution.gclid || /google/.test(source) || /google/.test(referrer)) return "Google search/ad";
  if (/tiktok/.test(source) || /tiktok/.test(referrer)) return "TikTok";
  if (/paid|cpc|ppc|ad/.test(medium)) return "Paid ad";
  if (referrer) return "Referral";
  return "Direct / organic";
}

function classifyFunnelStage(eventName) {
  return FUNNEL_EVENT_TO_STAGE.get(String(eventName || "")) || "other";
}

function buildFunnelSummary(events = [], leadCount = 0) {
  const summaries = FUNNEL_STAGES.map((stage) => ({
    ...stage,
    eventCount: 0,
    visitorCount: 0,
    latestAt: null
  }));
  const byKey = new Map(summaries.map((stage) => [stage.key, stage]));
  const visitorsByStage = new Map(summaries.map((stage) => [stage.key, new Set()]));

  for (const event of events || []) {
    const stageKey = classifyFunnelStage(event.event_name);
    const stage = byKey.get(stageKey);
    if (!stage) continue;
    stage.eventCount += 1;
    if (event.visitor_id) visitorsByStage.get(stageKey).add(event.visitor_id);
    const createdAt = event.created_at ? new Date(event.created_at) : null;
    if (createdAt && (!stage.latestAt || createdAt > new Date(stage.latestAt))) {
      stage.latestAt = createdAt.toISOString();
    }
  }

  return summaries.map((stage) => ({
    ...stage,
    visitorCount: visitorsByStage.get(stage.key).size,
    savedLeadCount: stage.key === "lead" ? leadCount : undefined
  }));
}

function hashIp(req) {
  const raw = String(req.ip || req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (!raw) return null;
  return crypto.createHash("sha256").update(`aistaff:${raw}`).digest("hex").slice(0, 32);
}

function normalizeTrackingBody(body = {}) {
  const eventName = trimText(body.event || body.eventName, 80);
  if (!eventName || !EVENT_NAME_RE.test(eventName)) return null;
  const visitorId = trimText(body.visitorId || body.visitor_id, 100);
  if (!visitorId || !/^[a-zA-Z0-9_-]{8,100}$/.test(visitorId)) return null;
  const attribution = attributionFromBody(body);
  return {
    eventName,
    visitorId,
    sessionId: trimText(body.sessionId || body.session_id, 100),
    sourcePage: trimText(attribution.source_page, 300),
    pageUrl: trimText(attribution.page_url, 700),
    path: (() => {
      try {
        return trimText(new URL(attribution.page_url || "", "https://aistaff.click").pathname, 300);
      } catch {
        return trimText(attribution.source_page, 300);
      }
    })(),
    referrer: trimText(attribution.referrer, 700),
    utmSource: trimText(attribution.utm_source, 120),
    utmMedium: trimText(attribution.utm_medium, 120),
    utmCampaign: trimText(attribution.utm_campaign, 180),
    utmContent: trimText(attribution.utm_content, 180),
    utmTerm: trimText(attribution.utm_term, 180),
    fbclid: trimText(attribution.fbclid, 260),
    gclid: trimText(attribution.gclid, 260),
    testEventCode: trimText(attribution.test_event_code || attribution.testEventCode, 120),
    metadata: metadataFrom(attribution),
    attribution
  };
}

async function recordWebsiteEvent(prisma, { companyId, req, body, leadId = null, conversationId = null }) {
  const clean = normalizeTrackingBody(body);
  if (!clean) return null;
  if (clean.path && clean.path.startsWith("/admin")) return null;
  return prisma.websiteEvent.create({
    data: {
      company_id: companyId,
      lead_id: leadId,
      conversation_id: conversationId,
      visitor_id: clean.visitorId,
      session_id: clean.sessionId,
      event_name: clean.eventName,
      source_page: clean.sourcePage,
      page_url: clean.pageUrl,
      path: clean.path,
      referrer: clean.referrer,
      utm_source: clean.utmSource,
      utm_medium: clean.utmMedium,
      utm_campaign: clean.utmCampaign,
      utm_content: clean.utmContent,
      utm_term: clean.utmTerm,
      fbclid: clean.fbclid,
      gclid: clean.gclid,
      test_event_code: clean.testEventCode,
      ip_hash: hashIp(req),
      user_agent: trimText(req.get?.("user-agent"), 400),
      metadata: clean.metadata
    }
  });
}

async function attachRecentEventsToLead(prisma, { companyId, leadId, conversationId, visitorId, fallback = {} }) {
  if (!visitorId) return null;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const events = await prisma.websiteEvent.findMany({
    where: { company_id: companyId, visitor_id: visitorId, created_at: { gte: since } },
    orderBy: { created_at: "asc" },
    take: 80
  });
  if (!events.length) return null;

  await prisma.websiteEvent.updateMany({
    where: { company_id: companyId, visitor_id: visitorId, lead_id: null },
    data: { lead_id: leadId, conversation_id: conversationId || null }
  });

  const first = events[0];
  const last = events[events.length - 1];
  const attribution = {
    source_page: first.source_page || fallback.source_page,
    page_url: first.page_url || fallback.page_url,
    referrer: first.referrer || fallback.referrer,
    utm_source: first.utm_source || fallback.utm_source,
    utm_medium: first.utm_medium || fallback.utm_medium,
    utm_campaign: first.utm_campaign || fallback.utm_campaign,
    utm_content: first.utm_content || fallback.utm_content,
    utm_term: first.utm_term || fallback.utm_term,
    fbclid: first.fbclid || fallback.fbclid,
    gclid: first.gclid || fallback.gclid
  };

  return prisma.lead.update({
    where: { id: leadId },
    data: {
      visitor_id: visitorId,
      source_channel: fallback.source_channel || "website",
      source_label: sourceLabelFor(attribution),
      source_url: attribution.page_url,
      landing_page: attribution.source_page || first.path,
      referrer: attribution.referrer,
      utm_source: attribution.utm_source,
      utm_medium: attribution.utm_medium,
      utm_campaign: attribution.utm_campaign,
      utm_content: attribution.utm_content,
      utm_term: attribution.utm_term,
      fbclid: attribution.fbclid,
      gclid: attribution.gclid,
      first_seen_at: first.created_at,
      last_touch_at: last.created_at,
      touch_count: events.length
    }
  });
}

module.exports = {
  attachRecentEventsToLead,
  buildFunnelSummary,
  classifyFunnelStage,
  FUNNEL_STAGES,
  normalizeTrackingBody,
  recordWebsiteEvent,
  sourceLabelFor
};
