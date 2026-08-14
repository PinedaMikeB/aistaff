const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const { prisma } = require("./db");
const { encryptSecret } = require("./crypto");
const {
  buildPresenceSnapshot,
  formatSnapshotForMessenger,
  formatStructuredAssessment,
  splitAssessmentMessengerParts,
  assessAiSalesFit,
  formatFacebookLookupMessage,
  isFacebookUrl,
  isLikelyWebsiteUrl,
  normalizeUrl
} = require("./page-intelligence");
const {
  buildMessengerAssessmentFormattingGuide,
  buildAssessmentToolInstruction,
  buildAssessmentFactsPayload
} = require("./aistaff-assessment-principles");
const {
  buildMessengerImageMessages,
  searchFacebookPagesByName,
  pickBestPageCandidates
} = require("./facebook-page-search");
const {
  checkFacebookPageTool,
  checkWebsiteTool,
  assessAiFitTool,
  makeQuotationDraftTool,
  buildQuotationDetails
} = require("./aistaff-tools");
const {
  emptyOrganizationProfile,
  hasOrganizationProfile,
  applyOrganizationProfile,
  syncLegacyBusinessFieldsFromProfile,
  personalizeAssessment,
  organizationProfileForContext
} = require("./organization-profile");
const { generateQuotationPdf, getPublicQuotationUrl } = require("./quotation-pdf");
const { sendQuotationEmail, isEmailConfigured } = require("./quotation-email");

const aistaffSessions = new Map();

/** Stored in session + Postgres; full conversation continuity for returning customers. */
const AISTAFF_CHAT_MEMORY_LIMIT = 40;
/** Messages sent to OpenAI per turn (older turns rely on Known facts + Progress below). */
const AISTAFF_OPENAI_CHAT_LIMIT = 32;

const OFF_TOPIC_PATTERNS = [
  /\b(weather|nba|basketball|football|volleyball|movie|netflix|tiktok trend)\b/i,
  /\btell me (a |about )?(joke|story|poem)\b/i,
  /\bwhat do you think about (politics|election|president|celebrity)\b/i,
  /\b(who won|score|game last night)\b/i
];

// Pricing is DERIVED from payments.js (the thing that actually bills).
// Do not reintroduce literal prices here — see src/closer-pricing.js.
const { MINIMUM_OFFER, OFFICIAL_PACKAGES, PLAN_PRICE_PATTERN } = require("./closer-pricing");

function chatOnlyNotice(isTagalog = false) {
  return isTagalog
    ? "Chat assistant lang ito sa Messenger — walang voice call."
    : "This is a chat-only assistant on Messenger — no voice calls.";
}

function lookupPurposeNotice(isTagalog = false) {
  return isTagalog
    ? "Hinihingi namin ang Facebook Page URL, website URL, o screenshot para matingnan ang public page at site ninyo at ma-understand ang products at services habang nagcha-chat tayo."
    : "We ask for your Facebook Page URL, website URL, or a screenshot so we can review your public page and site and understand your products and services while we chat.";
}

function buildFacebookUrlRequestReply(isTagalog = false) {
  return isTagalog
    ? "Ano po ang Facebook Page URL ninyo? Kung hindi ninyo alam ang URL, puwede ninyong i-send ang Page name o screenshot ng Page dito sa Messenger."
    : "May I get your Facebook Page URL? If you don't know the URL, you can send your Page name or a screenshot of your Page here in Messenger.";
}

function buildWebsiteUrlRequestReply(isTagalog = false) {
  return isTagalog
    ? "Ano po ang website URL ninyo? Kung wala pa, sabihin lang po na wala. Kung hindi ninyo alam ang URL, puwede kayong mag-send ng screenshot ng website dito sa Messenger."
    : "May I get your website URL? If you don't have one yet, just say none. If you don't know the URL, you can send a screenshot of your website here in Messenger.";
}

const OFFICIAL_SERVICE_PROMISE = [
  "Instant AI replies on Facebook Messenger",
  "Qualify inquiries with your business questions",
  "Capture lead details in your admin dashboard",
  "Prepare quotation drafts for admin approval before sending"
].join("; ");

// OFFICIAL_PACKAGES now comes from closer-pricing.js (derived from payments.js).
// Note the plan slugs are starter / growth / SCALE — the old third key was
// "pro", which was never a real plan name.

const FORBIDDEN_PLAN_CLAIMS = [
  /multi-?agent/i,
  /detailed sales reports?/i,
  /faster response times?/i,
  /advanced ai workflows?/i,
  /full customization(?! and tuning)/i
];

const GREETING_INTROS_EN = [
  "Hi! AIStaff is a chat-only AI assistant for Facebook Messenger — no voice calls. It helps you reply faster and turn inquiries into quotation-ready leads.",
  "Hello! AIStaff is a Messenger chat assistant for Facebook Pages — it replies in chat, qualifies leads, and prepares quotation drafts for your approval.",
  "Hi there! We help B2B Pages stop losing sales from late Messenger chat replies by qualifying inquiries in chat and organizing leads in one dashboard.",
  "Hello! AIStaff automates Facebook Messenger chat inquiries — instant chat replies, lead capture, and quotation-ready drafts your team can approve.",
  "Hi! We set up chat-only AI staff for Facebook Page inboxes so you reply faster in Messenger without voice calls."
];

const GREETING_INTROS_TL = [
  "Hi po! Ang AIStaff ay chat-only AI assistant sa Facebook Messenger — walang voice call. Mas mabilis sumagot at gawing quotation-ready ang inquiries.",
  "Hello po! AIStaff ay Messenger chat assistant para sa Facebook Page — chat reply lang, mag-qualify ng leads, at maghanda ng quotation draft.",
  "Hi po! Tumutulong kami sa B2B Pages na hindi mawala ang sales dahil sa late Messenger replies — chat lang, qualify inquiries, at i-organize ang leads.",
  "Hello po! Ina-automate ng AIStaff ang Messenger chat inquiries — instant chat reply, lead capture, at quotation-ready drafts.",
  "Hi po! Nagse-set up kami ng chat-only AI staff para sa Facebook Page inbox — walang voice call."
];

function hashSeed(value) {
  return String(value || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function pickVariant(items, seed) {
  return items[Math.abs(seed) % items.length];
}

function isTagalogText(text) {
  return /kailangan|kakausap|nagiinquire|magkano|presyo|po|kayo|ninyo|kami|ko|ba|sa mga|ilan|gusto/i.test(String(text || "").toLowerCase());
}

function customerWantsPricing(text) {
  return /\b(price|pricing|quotation|quote|magkano|presyo|how much|cost|package cost|send (?:me )?(?:the )?quote|rate card)\b/i.test(String(text || ""));
}

function canMentionPricing(session, messageText = "") {
  return Boolean(session.quotationOffered || session.explicitQuoteInterest || customerWantsPricing(messageText));
}

function canOfferQuotation(session, messageText = "") {
  const wantsQuote = session.explicitQuoteInterest || customerWantsPricing(messageText) || session.quotationOffered;
  if (!wantsQuote || !hasVerifiedPage(session)) return false;
  if (session.assessmentDelivered && session.pageSnapshotShown) return true;
  // Allow explicit quotation requests when lead profile is complete, even if a stale session lost assessment flags.
  return Boolean(customerWantsPricing(messageText) && hasLeadProfile(session));
}

function hasPageDetails(session) {
  return hasExplicitPageTarget(session);
}

function hasExplicitPageTarget(session) {
  if (session.pageUrl) return true;
  return Boolean(session.pageName && session.pageNameSource === "customer");
}

function getExplicitPageLookupTarget(session) {
  if (session.pageUrl) return session.pageUrl;
  if (session.pageName && session.pageNameSource === "customer") return session.pageName;
  return "";
}

function isPersonalFacebookProfileUrl(urlOrSlug) {
  const raw = String(urlOrSlug || "").trim();
  const slug = raw.includes("facebook.com")
    ? raw.match(/facebook\.com\/([^/?&#]+)/i)?.[1]
    : raw;
  return Boolean(slug && /^\d{8,}$/.test(slug));
}

function resetPageFlowState(session, { keepPageName = true } = {}) {
  const savedName = keepPageName && session.pageNameSource === "customer" ? session.pageName : "";
  session.pageConfirmed = false;
  session.awaitingPageConfirm = false;
  session.awaitingPagePick = false;
  session.pagePickerShown = false;
  session.pageImageUrl = "";
  session.pageUrl = "";
  session.pageJustPicked = false;
  session.pageLookupConfidence = "";
  session.pageSnapshot = null;
  session.pageSnapshotKey = "";
  session.pageSnapshotShown = false;
  session.assessmentDelivered = false;
  session.pageCandidates = [];
  session.lastShownCandidates = [];
  session.pendingMessengerCarousel = null;
  session.pendingMessengerImages = null;
  session.lastSentPageSlug = null;
  session.pageCheckInProgress = false;
  if (!keepPageName) {
    session.pageName = "";
    session.pageNameSource = "";
  } else if (savedName) {
    session.pageName = savedName;
    session.pageNameSource = "customer";
  }
}

function buildOrchestratorSessionState(session, messageText = "") {
  return {
    lead: {
      customerName: session.customerName || null,
      companyName: session.companyName || null,
      phone: session.phone || null,
      email: getSessionEmail(session) || null,
      address: session.address || null,
      leadComplete: hasLeadProfile(session)
    },
    review: {
      channel: session.reviewChannel || null,
      permissionGranted: Boolean(session.reviewPermissionGranted)
    },
    facebookPage: {
      targetName: session.pageNameSource === "customer" ? (session.pageName || null) : null,
      targetUrl: session.pageUrl || null,
      confirmed: Boolean(session.pageConfirmed),
      lastSentSlug: session.lastSentPageSlug || null,
      rejectedSlugs: session.rejectedPageSlugs || [],
      candidatesAvailable: activePageCandidates(session).length
    },
    website: {
      url: session.websiteUrl || null,
      status: session.websiteStatus
    },
    progress: {
      assessmentDelivered: Boolean(session.assessmentDelivered),
      quotationOffered: Boolean(session.quotationOffered),
      quotationEmailConfirmed: Boolean(session.quotationEmailConfirmed),
      mayMentionPricing: canMentionPricing(session, messageText)
    },
    organizationProfile: organizationProfileForContext(session),
    workflowHint: getQualificationNextStep(session, messageText).phase
  };
}

function hasVerifiedPage(session) {
  return Boolean(session.pageConfirmed);
}

function facebookLookupFailed(session) {
  return Boolean(
    session.pageName
    && !session.pageUrl
    && !session.pageConfirmed
    && !hasPageCandidates(session)
    && session.pageSnapshot
    && !session.pageSnapshot.facebook
    && session.pageSnapshot.facebookError
  );
}

function hasPageCandidates(session) {
  return Array.isArray(session.pageCandidates) && session.pageCandidates.length > 1;
}

function normalizePickText(text) {
  return String(text || "").toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
}

function isPageCorrectionOrHint(text) {
  const lower = String(text || "").toLowerCase();
  return /\b(no|not|hindi|mali|wrong|instead|try this|meaning|i mean|its|it's|it is|the one|yon|yan)\b/i.test(lower)
    || /\bwotg\b/i.test(lower);
}

function isPageRejection(text) {
  const lower = String(text || "").toLowerCase();
  return /\b(that'?s wrong|thats wrong|wrong page|not my page|not the page|that is not|this is not|not that page|incorrect page|mali|hindi yan|hindi po yan)\b/i.test(lower)
    || (isNegative(text) && /\b(page|facebook|fb)\b/i.test(lower));
}

function rememberRejectedPage(session, slug) {
  if (!slug) return;
  session.rejectedPageSlugs = [...new Set([...(session.rejectedPageSlugs || []), slug])];
}

function wantsPageScreenshot(text) {
  const lower = String(text || "").toLowerCase();
  return (
    /\b(screenshot|screen\s?shot|picture|image|photo)\b/.test(lower)
    && /\b(page|facebook|fb)\b/.test(lower)
  )
    || /\b(send|show|give)\b.*\b(screenshot|picture|image)\b/.test(lower)
    || /\b(screenshot|picture|image)\b.*\b(for|of)\b.*\b(page|facebook|wotg|word on the go)\b/i.test(lower)
    || /\bconfirm\b.*\b(page|screenshot)\b/.test(lower);
}

function isFetchScreenshotCommand(text, session = {}) {
  const trimmed = String(text || "").trim().toLowerCase();
  if (/^(get it|fetch it|send it|go get it|go ahead|please send|send now|send please|do it|kuha|kunin mo|sige na)\.?$/i.test(trimmed)) {
    return true;
  }
  if (/^(get|fetch|send)\s+(the\s+)?(screenshot|image|picture)\.?$/i.test(trimmed)) {
    return true;
  }
  if (session.awaitingPageScreenshot && trimmed.length <= 40) {
    return /^(get it|fetch|send|please|pls|ok|yes|sige|oo|opo)\.?$/i.test(trimmed);
  }
  return false;
}

function extractPageHintFromMessage(text) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  if (/\bwotg\b/i.test(lower) || /word\s+on\s+the\s+go/i.test(lower)) return "Word On The Go";
  const forPage = raw.match(/\b(?:for|ng|na)\s+(?:my\s+)?(?:facebook\s+)?(?:page\s+)?(.{3,80})/i);
  if (forPage) {
    const hint = cleanAistaffPageName(forPage[1].replace(/\b(or|wotg|screenshot|image|photo|picture|send|show)\b.*$/i, "").trim());
    if (hint && !isFetchScreenshotCommand(hint) && !wantsPageScreenshot(hint)) return hint;
  }
  return "";
}

function findPageHintFromMessages(messages, session = null) {
  if (session) {
    const explicit = getExplicitPageLookupTarget(session);
    if (explicit) return explicit;
  }
  for (const message of [...(messages || [])].reverse()) {
    if (message.role !== "customer") continue;
    const hint = extractPageHintFromMessage(message.text);
    if (hint) return hint;
  }
  return "";
}

function warmReply(core, isTagalog = false, { sorry = false } = {}) {
  if (sorry) {
    return isTagalog ? `Pasensya na po sa kalituhan. ${core}` : `Sorry for the mix-up — ${core}`;
  }
  return isTagalog ? `Sige po, ${core.charAt(0).toLowerCase()}${core.slice(1)}` : `Sure — ${core.charAt(0).toLowerCase()}${core.slice(1)}`;
}

function activePageCandidates(session) {
  if (session.pageCandidates?.length) return session.pageCandidates;
  if (session.lastShownCandidates?.length) return session.lastShownCandidates;
  return [];
}

function getNextPageCandidate(session, { slug, index, skipSlug } = {}) {
  const pool = activePageCandidates(session);
  if (index && Number(index) > 0) {
    const picked = pool[Number(index) - 1];
    if (picked && !isRejectedPageSlug(session, picked.slug)) return picked;
  }
  if (slug) {
    const picked = pool.find((candidate) => candidate.slug === slug);
    if (picked && !isRejectedPageSlug(session, picked.slug)) return picked;
  }
  const skip = skipSlug ?? null;
  return pool.find((candidate) => {
    if (!candidate.slug || isRejectedPageSlug(session, candidate.slug)) return false;
    if (skip && String(candidate.slug).toLowerCase() === String(skip).toLowerCase()) return false;
    return true;
  }) || null;
}

function inferPickIndexFromMessage(text) {
  const trimmed = String(text || "").trim();
  let match = trimmed.match(/^(\d{1,2})$/);
  if (match) return Number(match[1]);

  match = trimmed.match(/\b(?:try|pick|option|number|no\.?|#)\s*(\d{1,2})\b/i);
  if (match) return Number(match[1]);

  match = trimmed.match(/\b(\d{1,2})\s*(?:please|po|pls)?\s*$/i);
  if (match) return Number(match[1]);

  return null;
}

function resolvePageCandidatePick(session, text) {
  const candidates = activePageCandidates(session);
  if (!candidates.length) return null;

  const trimmed = String(text || "").trim();
  const pickIndex = inferPickIndexFromMessage(trimmed);
  if (pickIndex) {
    return candidates[pickIndex - 1] || null;
  }

  const tryMatch = trimmed.match(/\btry\s+(?:this\s+)?(.+)/i);
  const normalized = normalizePickText(tryMatch?.[1] || trimmed);

  if (/\bwotg\b/i.test(normalized) || /word\s+on\s+the\s+go/i.test(normalized)) {
    const wotgMatches = candidates.filter((candidate) => /wotg/i.test(candidate.slug || "") || /wotg/i.test(candidate.name || ""));
    if (wotgMatches.length === 1) return wotgMatches[0];
    if (/\bwotgcm\b/i.test(normalized)) {
      return wotgMatches.find((candidate) => candidate.slug === "WOTGCM") || wotgMatches[0];
    }
    return wotgMatches.find((candidate) => candidate.slug === "wotg.wordonthego")
      || wotgMatches.find((candidate) => candidate.slug !== "WOTGCM")
      || wotgMatches[0];
  }

  return candidates.find((candidate) => {
    const slug = normalizePickText(candidate.slug);
    const name = normalizePickText(candidate.name);
    return (slug && (normalized === slug || normalized.includes(slug) || slug.includes(normalized)))
      || (name && (normalized === name || normalized.includes(name) || name.includes(normalized)));
  }) || null;
}

function applyPageCandidatePick(session, candidate) {
  if (!candidate) return false;
  session.pageName = candidate.name || candidate.slug;
  session.pageUrl = candidate.url;
  session.pageConfirmed = true;
  session.pageLookupConfidence = candidate.match?.confidence || "medium";
  session.pageCandidates = [];
  session.awaitingPagePick = false;
  session.pendingMessengerCarousel = null;
  session.pendingMessengerImages = null;
  session.pageImageUrl = candidate.imageUrl || "";
  session.lastShownCandidates = [];
  session.pageSnapshot = null;
  session.pageSnapshotKey = "";
  session.pageSnapshotShown = false;
  session.pageJustPicked = true;
  return true;
}

function applyPageCandidateBySlug(session, slug) {
  const candidate = session.pageCandidates?.find((item) => item.slug === slug);
  return applyPageCandidatePick(session, candidate);
}

function isPageConfirmationPending(session) {
  return Boolean(
    !session.pageConfirmed
    && (session.awaitingPageConfirm
      || session.pageSnapshot?.facebook?.name
      || (session.pageName && session.pageImageUrl))
  );
}

function applyPageConfirmationFromMessage(session, text) {
  if (session.pageConfirmed || !isPageConfirmationAnswer(text, session)) return;
  session.pageConfirmed = true;
  session.awaitingPageConfirm = false;
  session.awaitingPagePick = false;
  session.pageCandidates = [];
  session.lastShownCandidates = [];
  if (session.pageSnapshot?.facebook?.url && !session.pageUrl) {
    session.pageUrl = session.pageSnapshot.facebook.url;
  }
  if (session.pageSnapshot?.facebook?.name && !session.pageName) {
    session.pageName = session.pageSnapshot.facebook.name;
  }
}

function applyScreenshotPageSelection(session, candidate) {
  if (!candidate) return;
  session.pageName = candidate.name || candidate.slug || session.pageName;
  session.pageImageUrl = candidate.imageUrl || session.pageImageUrl;
  session.pageLookupConfidence = candidate.match?.confidence || session.pageLookupConfidence || "medium";
  session.lastSentPageSlug = candidate.slug || session.lastSentPageSlug;
  session.pageConfirmed = false;
  session.awaitingPagePick = false;
  session.pendingMessengerCarousel = null;
  session.awaitingPageConfirm = true;
}

function buildConversationSignals(session, messageText) {
  const lower = String(messageText || "").toLowerCase();
  const recentCustomer = session.messages
    .filter((message) => message.role === "customer")
    .slice(-4)
    .map((message) => message.text);
  const recentAssistant = session.messages
    .filter((message) => message.role === "assistant")
    .slice(-3)
    .map((message) => message.text);
  return {
    customerAffirmed: isAffirmative(messageText),
    customerDenied: isNegative(messageText),
    pageConfirmationPending: isPageConfirmationPending(session),
    pageJustConfirmed: session.pageConfirmed && isAffirmative(messageText),
    askedAboutServiceFit: /\b(need|want|should|do i need|would i need|kailangan|kailangan ba)\b/i.test(lower)
      && /\b(ai|chat assistant|your service|assistant|inbox|aistaff)\b/i.test(lower),
    askedAboutMinistry: /\bministry\b/i.test(lower),
    askedToCheckPage: wantsPublicPreview(messageText),
    recentCustomerMessages: recentCustomer,
    recentAssistantMessages: recentAssistant,
    assistantRecentlyAskedPageConfirm: recentAssistant.some((text) => /is this your page|ito po ba ang page/i.test(text))
  };
}

function hasLeadProfile(session) {
  return Boolean(
    session.customerName
    && session.companyName
    && session.phone
    && hasEmail(session)
  );
}

function getNextMissingLeadField(session) {
  for (const field of INITIAL_LEAD_FIELDS) {
    if (field.key === "email") {
      if (!hasEmail(session)) return field.key;
      continue;
    }
    if (!String(session[field.key] || "").trim()) return field.key;
  }
  return null;
}

function getMissingQuotationFields(session) {
  return QUOTATION_LEAD_FIELDS.map((field) => field.key).filter((key) => {
    if (key === "email") return !hasEmail(session);
    return !String(session[key] || "").trim();
  });
}

function getReplyLengthPolicy(session, messageText, options = {}) {
  if (
    options.preserveFullReply
    || options.allowMultipleSections
    || options.contentType === "assessment"
    || options.contentType === "quotation"
    || options.skipSteer
  ) {
    return { maxLen: options.maxReplyLen || 3200, singleQuestion: false };
  }
  if (shouldBootstrapAssessment(session, messageText)) {
    return { maxLen: 2400, singleQuestion: false };
  }
  const phase = getQualificationNextStep(session, messageText).phase;
  if (["public_preview", "value_review", "quotation_offer"].includes(phase)) {
    return { maxLen: 2000, singleQuestion: false };
  }
  return { maxLen: options.maxReplyLen || 520, singleQuestion: true };
}

function buildLeadFieldQuestion(fieldKey, isTagalog = false) {
  const meta = LEAD_FIELD_META[fieldKey];
  if (!meta) return "";
  return isTagalog ? meta.askTl : meta.askEn;
}

function buildPrivacyNote(isTagalog = false) {
  return isTagalog ? AISTAFF_PRIVACY_NOTE_TL : AISTAFF_PRIVACY_NOTE_EN;
}

function buildLeadFieldAskWithContext(fieldKey, isTagalog = false, options = {}) {
  const meta = LEAD_FIELD_META[fieldKey];
  if (!meta) return buildLeadFieldQuestion(fieldKey, isTagalog);
  const reason = isTagalog ? meta.reasonTl : meta.reasonEn;
  const ask = isTagalog ? meta.askTl : meta.askEn;
  const privacy = buildPrivacyNote(isTagalog);
  if (options.quotation) {
    return `${reason} ${ask} ${privacy}`.replace(/\s{2,}/g, " ").trim();
  }
  return `${reason} ${ask} ${privacy}`.replace(/\s{2,}/g, " ").trim();
}

function isAffirmative(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  if (/^(yes|yeah|yep|sure|ok|okay|correct|opo|oo|tama|yan|yun|that's right|that is correct|right)\b/i.test(trimmed)) {
    return true;
  }
  if (/\b(yes|yeah|yep|sure|opo|oo)\b/i.test(trimmed) && /\b(that'?s? it|that'?s? right|that is correct|correct|tamang)\b/i.test(trimmed)) {
    return true;
  }
  if (/\b(that'?s? it|that'?s? the one|that'?s? right|correct page)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

function isContinuationIntent(text) {
  return /\b(let'?s?\s+)?(continue|pick up|resume|proceed|move on|go on|where were we|let'?s go|carry on|ituloy|magpatuloy|tuloy|tuloy tayo)\b/i.test(String(text || ""));
}

function isGreetingResume(text) {
  const trimmed = String(text || "").trim();
  return /^(hi|hello|hey|good\s+(morning|afternoon|evening)|kumusta)\b/i.test(trimmed)
    && (isContinuationIntent(trimmed) || /\b(again|back|still here)\b/i.test(trimmed));
}

function isPageConfirmationAnswer(text, session) {
  const trimmed = String(text || "").trim();
  if (!trimmed || !isPageConfirmationPending(session)) return false;
  if (isContinuationIntent(trimmed) || isGreetingResume(trimmed)) return false;
  if (isNegative(trimmed) || isCustomerQuestion(trimmed)) return false;
  if (/\b(address|email|quotation|quote|privacy|skip|proceed without|sound okay)\b/i.test(trimmed.toLowerCase())) return false;
  if (/\b(that'?s? (?:it|right|the one)|correct page|yes that'?s my page|ito (?:po )?ang page|yan ang page|tamang page)\b/i.test(trimmed)) {
    return true;
  }
  if (!isAffirmative(trimmed)) return false;
  const signals = buildConversationSignals(session, trimmed);
  return Boolean(signals.assistantRecentlyAskedPageConfirm || session.awaitingPageConfirm);
}

function isNegative(text) {
  return /^(no|nope|hindi|wrong|mali|hindi po|not|iba|hindi yan)\b/i.test(String(text || "").trim());
}

function buildFindPageUrlHelpReply(isTagalog = false) {
  return isTagalog
    ? "Walang problema po. Sa Facebook app: buksan ang Page ninyo → About → hanapin ang Page link o Page ID. Pwede rin i-send ang screenshot ng Page dito sa Messenger kung mas madali."
    : "No problem. On the Facebook app: open your Page → About → look for the Page link or Page ID. You can also send a screenshot of your Page here in Messenger if that's easier.";
}

function isGreetingOrNoise(text) {
  return /^(hi|hello|hey|good\s+(morning|afternoon|evening)|kumusta|musta|thanks|thank you|salamat|ok|okay|yes|no|opo|oo)\b/i.test(String(text || "").trim());
}

function looksLikePersonName(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.length < 3 || trimmed.length > 80) return false;
  if (isGreetingOrNoise(trimmed)) return false;
  if (/@|https?:\/\/|\d{7,}/.test(trimmed)) return false;
  const normalized = trimmed.replace(/^(i am|i'm|ako si|pangalan ko ay|name is|my name is)\s+/i, "").trim();
  if (/\s/.test(normalized) || /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(normalized)) return true;
  return /^(ako si|pangalan|name is|my name)/i.test(trimmed);
}

function looksLikeCompanyName(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.length < 2 || trimmed.length > 100) return false;
  if (isGreetingOrNoise(trimmed)) return false;
  if (/@|https?:\/\/|(?:\+?63|0)?9\d{9}/.test(trimmed)) return false;
  if (looksLikePersonName(trimmed)) return false;
  return true;
}

function cleanOrganizationNameForLookup(text) {
  let cleaned = String(text || "").trim()
    .replace(/^(our organization is|the organization is|organization is|company is|company name is|business is|business name is|ang company namin ay)\s+/i, "")
    .replace(/[.]+$/g, "")
    .trim();
  const orMatch = cleaned.match(/^(.+?)\s+or\s+(.+)$/i);
  if (orMatch) {
    const left = orMatch[1].trim();
    const right = orMatch[2].trim();
    if (/^wotg$/i.test(right)) return left;
    if (left.length >= right.length) return left;
    return right;
  }
  return cleaned;
}

function pageNameMatchesCustomer(session, pageName) {
  if (!session?.customerName || !pageName) return false;
  return normalizePageNameForLookup(pageName).toLowerCase()
    === normalizePageNameForLookup(session.customerName).toLowerCase();
}

function getPreferredBusinessPageName(session) {
  const fromCompany = cleanOrganizationNameForLookup(session.companyName);
  if (fromCompany && !looksLikePersonName(fromCompany)) return fromCompany;
  if (session.businessType) {
    const fromBusiness = cleanOrganizationNameForLookup(session.businessType);
    if (fromBusiness && !looksLikePersonName(fromBusiness)) return fromBusiness;
  }
  if (session.pageName && !pageNameMatchesCustomer(session, session.pageName)) {
    return session.pageName;
  }
  return "";
}

function syncBusinessPageNameFromLead(_session) {
  // Company/org name is for lead records — never auto-map to Facebook Page lookup.
}

function hasReviewChannel(session) {
  return Boolean(session.reviewChannel);
}

function reviewIncludesFacebook(session) {
  return session.reviewChannel === "facebook" || session.reviewChannel === "both";
}

function reviewIncludesWebsite(session) {
  return session.reviewChannel === "website" || session.reviewChannel === "both";
}

function assistantAskedReviewPermission(session) {
  return session.messages
    .slice(-4)
    .some((message) => message.role === "assistant"
      && /\b(may i|can i|pwede ko ba|okay ba sa inyo).{0,80}\b(review|check|look up|preview|tingnan)\b/i.test(message.text));
}

function isReviewPermissionGrant(text, session) {
  const trimmed = String(text || "").trim();
  if (!trimmed || isNegative(trimmed)) return false;
  if (!isAffirmative(trimmed) && !/\b(go ahead|please do|sure|okay|sige po|oo|yes please|proceed)\b/i.test(trimmed.toLowerCase())) {
    return false;
  }
  if (isContinuationIntent(trimmed) && !assistantAskedReviewPermission(session)) return false;
  return assistantAskedReviewPermission(session) || Boolean(session.awaitingReviewPermission);
}

function captureReviewChannelFromMessage(session, text) {
  if (session.reviewChannel) return;
  const lower = String(text || "").toLowerCase().trim();
  if (!lower) return;
  if (/\b(both|pareho|facebook.*(and|&|then).*(website|site)|website.*(and|&|then).*(facebook|page))\b/i.test(lower)) {
    session.reviewChannel = "both";
    return;
  }
  if (/\b(website|site|web)\b/i.test(lower) && /\b(first|prefer|rather|instead|na una|muna)\b/i.test(lower)) {
    session.reviewChannel = "website";
    return;
  }
  if (/\b(facebook|fb|messenger|page)\b/i.test(lower) && /\b(first|prefer|rather|instead|na una|muna)\b/i.test(lower)) {
    session.reviewChannel = "facebook";
    return;
  }
  if (/^(website|site|web)$/i.test(lower)) session.reviewChannel = "website";
  else if (/^(facebook|fb|page)$/i.test(lower)) session.reviewChannel = "facebook";
}

function isReadyForReviewPermissionAsk(session) {
  if (!session.reviewChannel) return false;
  if (reviewIncludesFacebook(session) && !hasExplicitPageTarget(session)) return false;
  if (reviewIncludesWebsite(session) && !session.websiteUrl && session.websiteStatus !== "none") return false;
  return true;
}

function captureReviewFlowFromMessage(session, text) {
  if (!hasLeadProfile(session)) return;
  captureReviewChannelFromMessage(session, text);
  const extractedPage = extractPageNameFromMessage(text);
  if (extractedPage) setSessionPageName(session, extractedPage, { source: "customer" });
  if (isLikelyWebsiteUrl(text) && !isFacebookUrl(text)) {
    session.websiteUrl = normalizeUrl(text);
    session.websiteStatus = "provided";
  }
  if (/\b(no website|wala(?:ng)?\s+website|none)\b/i.test(String(text || "").toLowerCase())) {
    session.websiteStatus = "none";
    session.websiteUrl = "";
  }
  if (isReadyForReviewPermissionAsk(session) && isReviewPermissionGrant(text, session)) {
    session.reviewPermissionGranted = true;
    session.awaitingReviewPermission = false;
  }
}

function captureLeadAnswer(session, text) {
  if (isCustomerQuestion(text)) return;

  const trimmed = String(text || "").trim();
  const next = getNextMissingLeadField(session);
  if (!next) return;

  if (session.customerName && isGreetingOrNoise(session.customerName)) session.customerName = "";

  if (/@|https?:\/\/|facebook\.com|fb\.com/i.test(trimmed)) return;
  if (/^(yes|no|ok|okay|opo|oo|sure|none|wala|salamat|thanks)$/i.test(trimmed)) return;
  if (isGreetingOrNoise(trimmed) && next === "customerName") return;

  if (next === "customerName" && looksLikePersonName(trimmed)) {
    session.customerName = trimmed
      .replace(/^(i am|i'm|ako si|pangalan ko ay|name is|my name is)\s+/i, "")
      .trim();
    return;
  }

  if (next === "companyName" && looksLikeCompanyName(trimmed)) {
    session.companyName = cleanOrganizationNameForLookup(trimmed
      .replace(/^(company is|company name is|business is|business name is|ang company namin ay|our organization is|organization is)\s+/i, "")
      .trim());
    if (session.companyName) session.businessType = session.companyName;
    return;
  }

  if (next === "phone" && /(?:\+?63|0)?9\d{9}/.test(trimmed)) {
    const phoneMatch = trimmed.match(/(?:\+?63|0)?9\d{9}/);
    if (phoneMatch) session.phone = phoneMatch[0];
    return;
  }

  if (next === "address" && trimmed.length >= 5 && !isGreetingOrNoise(trimmed) && !/@/.test(trimmed)) {
    session.address = trimmed
      .replace(/^(address is|my address is|located in|we are in|nasa|located at)\s+/i, "")
      .trim();
    return;
  }

  if (next === "email" && /@/.test(trimmed)) {
    const emailMatch = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (emailMatch) session.email = emailMatch[0];
    return;
  }

  if (
    !session.address
    && trimmed.length >= 5
    && !isGreetingOrNoise(trimmed)
    && !/@|https?:\/\/|facebook\.com|fb\.com/i.test(trimmed)
    && (session.explicitQuoteInterest || session.quotationOffered)
  ) {
    session.address = trimmed
      .replace(/^(address is|my address is|located in|we are in|nasa|located at)\s+/i, "")
      .trim();
  }
}

function formatOfficialPackagesBlock() {
  return Object.entries(OFFICIAL_PACKAGES).map(([name, pkg]) => (
    `${name.charAt(0).toUpperCase() + name.slice(1)}: ${pkg.price}. Best for ${pkg.bestFor}. Includes: ${pkg.includes.join("; ")}.`
  )).join("\n");
}

function getDefaultCompanyId() {
  return prisma.company.findFirst({ where: { status: "active" }, orderBy: { created_at: "asc" } }).then((company) => {
    if (!company) throw new Error("No active company found. Run npm run seed first.");
    return company.id;
  });
}

const AISTAFF_PRIVACY_URL = (process.env.AISTAFF_PRIVACY_URL || "https://aistaff.click/privacy").replace(/\/$/, "");
const AISTAFF_PRIVACY_NOTE_EN = `We only use your details to respond, prepare quotations, and follow up about AIStaff — we never sell personal data. Privacy policy: ${AISTAFF_PRIVACY_URL}`;
const AISTAFF_PRIVACY_NOTE_TL = `Ginagamit lang namin ang details ninyo para sumagot, maghanda ng quotation, at mag-follow up tungkol sa AIStaff — hindi namin ibinebenta ang personal data. Privacy policy: ${AISTAFF_PRIVACY_URL}`;

const LEAD_FIELD_META = {
  customerName: {
    askEn: "May I get your full name?",
    askTl: "Ano po ang buong pangalan ninyo?",
    reasonEn: "Knowing your name helps us personalize your Page review and follow-ups.",
    reasonTl: "Kailangan namin ang pangalan ninyo para ma-personalize ang Page review at follow-up."
  },
  companyName: {
    askEn: "May I get your company or business name?",
    askTl: "Ano po ang company o business name ninyo?",
    reasonEn: "Your company name helps us tailor recommendations to your business.",
    reasonTl: "Kailangan namin ang company name para ma-tailor ang recommendations sa inyong business."
  },
  phone: {
    askEn: "May I get your mobile number?",
    askTl: "Ano po ang mobile number ninyo?",
    reasonEn: "A mobile number lets us reach you if Messenger drops or we need a quick follow-up on your quotation.",
    reasonTl: "Ang mobile number ay para ma-contact kayo kung mahirap sa Messenger o may follow-up sa quotation."
  },
  email: {
    askEn: "May I get your email address?",
    askTl: "Ano po ang email address ninyo?",
    reasonEn: "An email address lets us send your formal quotation PDF and important updates about AIStaff.",
    reasonTl: "Ang email ay para ma-send ang formal quotation PDF at important updates tungkol sa AIStaff."
  },
  address: {
    askEn: "May I get your business address (city or full address)?",
    askTl: "Ano po ang business address ninyo (city o buong address)?",
    reasonEn: "We need your business address for the formal quotation PDF — it appears on the document addressed to your company.",
    reasonTl: "Kailangan ang business address para sa formal quotation PDF — lalabas ito sa document na addressed sa inyong company.",
    quotationOnly: true
  }
};

const INITIAL_LEAD_FIELDS = [
  { key: "customerName", labelEn: "full name", labelTl: "buong pangalan" },
  { key: "companyName", labelEn: "company or business name", labelTl: "company o business name" },
  { key: "phone", labelEn: "mobile number", labelTl: "mobile number" },
  { key: "email", labelEn: "email address", labelTl: "email address" }
];

const QUOTATION_LEAD_FIELDS = [
  ...INITIAL_LEAD_FIELDS,
  { key: "address", labelEn: "business address (city or full address)", labelTl: "business address (city o buong address)" }
];

const LEAD_FIELDS = QUOTATION_LEAD_FIELDS;

function isStartFreshCommand(messageText) {
  return /^(start\s+fresh|fresh\s+start|reset(?:\s+chat)?|restart|bagong\s+simula|ulitin(?:\s+po)?|simula\s+ulit)\b/i.test(String(messageText || "").trim());
}

function resetAistaffSession(psid) {
  aistaffSessions.delete(psid);
  return getAistaffSession(psid);
}

async function resetAistaffSessionInPostgres(psid) {
  const companyId = await getDefaultCompanyId();
  const conversation = await prisma.conversation.findUnique({
    where: { company_id_psid: { company_id: companyId, psid: String(psid) } }
  });
  if (conversation) {
    await prisma.conversation.delete({ where: { id: conversation.id } });
  }
}

async function handleStartFresh(psid, messageText) {
  await resetAistaffSessionInPostgres(psid);
  const session = resetAistaffSession(psid);
  const isTagalog = isTagalogText(messageText);
  const reply = isTagalog
    ? `Sige po — fresh start na tayo. Hihingin ko lang ang ilang details para ma-review ang Page ninyo at makapag-follow up — simula sa buong pangalan. ${buildPrivacyNote(true)}`
    : `Sure — let's start fresh. I'll ask for a few details so we can review your Page and follow up — starting with your full name. ${buildPrivacyNote(false)}`;
  updateAistaffSession(session, "assistant", reply);
  return reply;
}

function getAistaffSession(psid) {
  const session = aistaffSessions.get(psid) || {
    // Real messages to the AIStaff Page default to Closer answering AS
    // AIStaff (its own knowledge base). This flag opts a conversation INTO
    // the "preview Closer for MY OWN business" roleplay demo instead — set
    // only by an explicit ref=demo entry link or a demo postback, never by
    // default. See messenger-webhook.js wantsDemoFlow().
    explicitDemoMode: false,
    seenIntro: false,
    customerName: "",
    companyName: "",
    address: "",
    businessType: "",
    reviewChannel: "",
    reviewPermissionGranted: false,
    awaitingReviewPermission: false,
    pageNameSource: "",
    pageName: "",
    pageUrl: "",
    websiteUrl: "",
    websiteStatus: "unknown",
    email: "",
    phone: "",
    leadGenContact: false,
    quotationOffered: false,
    quotationEmailConfirmed: false,
    assessmentDelivered: false,
    explicitQuoteInterest: false,
    rejectedPageSlugs: [],
    lastSentPageSlug: "",
    pageCheckInProgress: false,
    pageConfirmed: false,
    pageLookupConfidence: "",
    pageCandidates: [],
    awaitingPagePick: false,
    pendingMessengerCarousel: null,
    pendingMessengerImages: null,
    pagePickerShown: false,
    lastShownCandidates: [],
    pageImageUrl: "",
    awaitingPageScreenshot: false,
    awaitingPageConfirm: false,
    pageSnapshot: null,
    pageSnapshotKey: "",
    pageSnapshotShown: false,
    weeklyInquiries: "",
    sendsQuotations: "",
    inquiryTopics: "",
    organizationProfile: null,
    contact: "",
    messages: [],
    persistedLoaded: false
  };
  aistaffSessions.set(psid, session);
  return session;
}

function cleanAistaffPageName(value) {
  return String(value || "")
    .replace(/^my\s+/i, "")
    .replace(/\s+(?:or you can add|send the link|send link|to my inbox|instead|not the).*/i, "")
    .replace(/[.?!]+$/, "")
    .trim();
}

function normalizePageNameForLookup(value) {
  return cleanAistaffPageName(String(value || "").trim());
}

function extractPageNameFromMessage(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  const patterns = [
    /(?:my\s+)?facebook(?:\s+page)?\s+is\s+(.{3,100})/i,
    /(?:my\s+)?fb(?:\s+page)?\s+is\s+(.{3,100})/i,
    /(?:ang\s+)?facebook(?:\s+page)?\s+ko\s+ay\s+(.{3,100})/i,
    /(?:facebook page ko ay|page ko ay|page is|page name is|my page is|other page named|page named|the name is|name is)\s+(.{3,100})/i,
    /(?:don't know|do not know|hindi ko alam).{0,50}(?:url|link).{0,50}(?:but|pero|name is|page is|page name)\s+(.{3,100})/i,
    /(?:wrong page|mali|hindi yan|not that|instead|correct page is|i mean|it'?s actually|actually it'?s)\s+(.{3,100})/i,
    /(?:no\s+)?(?:check|audit|find)\s+(.{3,80}?)\s+(?:not|instead of)\s+(.{3,80})/i,
    /(?:just search)\s+(.{3,100})/i,
    /(?:check|review|find|look up|audit)\s+(?:my\s+)?(.{3,80}?)\s+facebook(?:\s+page)?/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const captured = cleanAistaffPageName(match[match.length - 1] || match[1]);
    if (captured && !wantsPublicPreview(captured) && !isGreetingOrNoise(captured)) {
      return captured;
    }
  }
  return "";
}

function setSessionPageName(session, pageName, { keepUrl = false, source = "customer" } = {}) {
  const cleaned = cleanAistaffPageName(pageName);
  if (!cleaned) return false;

  const changed = session.pageName !== cleaned;
  session.pageName = cleaned;
  session.pageNameSource = source || "customer";
  if (!keepUrl) {
    session.pageUrl = "";
    session.pageConfirmed = false;
    session.pageLookupConfidence = "";
  }
  if (changed) {
    session.pageSnapshot = null;
    session.pageSnapshotKey = "";
    session.pageSnapshotShown = false;
    if (!keepUrl) {
      session.pageConfirmed = false;
      session.pageLookupConfidence = "";
    }
  }
  return true;
}

function updateAistaffSession(session, role, messageText, options = {}) {
  const text = String(messageText || "");
  const lower = text.toLowerCase();
  const deferIntentToAi = Boolean(options.deferIntentToAi);
  if (text) {
    session.messages.push({ role, text, at: new Date().toISOString() });
    session.messages = session.messages.slice(-AISTAFF_CHAT_MEMORY_LIMIT);
  }

  if (role !== "customer") return;

  if (deferIntentToAi) {
    const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const phoneMatch = text.match(/(?:\+?63|0)?9\d{9}/);
    if (emailMatch) session.email = emailMatch[0];
    if (phoneMatch) session.phone = phoneMatch[0];
    if (emailMatch || phoneMatch) {
      session.contact = [session.phone, session.email].filter(Boolean).join(" / ");
    }
    if (customerWantsPricing(text)) session.explicitQuoteInterest = true;
    return;
  }

  captureLeadAnswer(session, text);
  captureReviewFlowFromMessage(session, text);

  const pickPool = activePageCandidates(session);

  const urlMatch = text.match(/https?:\/\/\S+|facebook\.com\/\S+/i);
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = text.match(/(?:\+?63|0)?9\d{9}/);
  const nameMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/);
  const inquiryVolumeMatch = text.match(/\b(?:around\s*)?(\d{1,4})\s*(?:inquir(?:y|ies)|message|lead|chat)s?\s*(?:a|per|kada)?\s*(day|week|araw|linggo)?\b/i)
    || text.match(/\b(\d{1,4})\s*(?:a|per|kada)\s*(day|week|araw|linggo)\b/i);

  if (urlMatch) {
    if (isFacebookUrl(urlMatch[0])) {
      session.pageUrl = normalizeUrl(urlMatch[0]);
      session.pageNameSource = "customer";
      const slug = urlMatch[0].match(/facebook\.com\/([^/?&#]+)/i)?.[1];
      if (slug && !session.pageName) {
        setSessionPageName(session, decodeURIComponent(slug), { keepUrl: true, source: "customer" });
      }
      if (!deferIntentToAi) session.pageConfirmed = true;
    } else if (isLikelyWebsiteUrl(urlMatch[0])) {
      session.websiteUrl = normalizeUrl(urlMatch[0]);
      session.websiteStatus = "provided";
    }
  } else if (isLikelyWebsiteUrl(text) && !isFacebookUrl(text)) {
    session.websiteUrl = normalizeUrl(text);
    session.websiteStatus = "provided";
  }

  if (/\b(no website|wala(?:ng)?\s+website|wala\s+pa(?:ng)?\s+website|walang site|none|wala\s+po|hindi\s+po\s+meron)\b/i.test(lower)) {
    session.websiteStatus = "none";
    session.websiteUrl = "";
  }

  if (customerWantsPricing(text)) session.explicitQuoteInterest = true;
  if (
    isAffirmative(text)
    && session.assessmentDelivered
    && !session.quotationOffered
    && /\b(explore|set up|setup|proceed|interested|sounds good|let'?s do|gusto|sige)\b/i.test(lower)
  ) {
    session.explicitQuoteInterest = true;
  }
  if (emailMatch) session.email = emailMatch[0];
  if (phoneMatch) session.phone = phoneMatch[0];
  if (emailMatch || phoneMatch) {
    session.contact = [session.phone, session.email].filter(Boolean).join(" / ");
    if (emailMatch) session.leadGenContact = session.leadGenContact || false;
  }

  if (deferIntentToAi) {
    if (isFreshPageCheckInquiry(text, session)) {
      resetPageFlowForFreshInquiry(session, text);
    } else if (session.awaitingPageConfirm && isPageConfirmationAnswer(text, session)) {
      session.pageConfirmed = true;
      session.awaitingPageConfirm = false;
      session.pageCheckInProgress = false;
      const candidate = getNextPageCandidate(session, { slug: session.lastSentPageSlug })
        || activePageCandidates(session).find((item) => item.slug === session.lastSentPageSlug);
      if (candidate?.url) session.pageUrl = candidate.url;
      else if (session.lastSentPageSlug) {
        session.pageUrl = `https://www.facebook.com/${session.lastSentPageSlug}`;
      }
    } else {
      const extractedPageName = extractPageNameFromMessage(text);
      if (extractedPageName) setSessionPageName(session, extractedPageName, { source: "customer" });
    }
    session.contact = [session.phone, session.email].filter(Boolean).join(" / ");
    return;
  }

  const extractedPageName = extractPageNameFromMessage(text);
  const skipPageNameCapture = pickPool.length > 0
    || isPageCorrectionOrHint(text)
    || wantsPageScreenshot(text)
    || isFetchScreenshotCommand(text, session);
  if (extractedPageName && !skipPageNameCapture) {
    setSessionPageName(session, extractedPageName, {
      keepUrl: Boolean(urlMatch && isFacebookUrl(urlMatch[0])),
      source: "customer"
    });
  }

  if (!deferIntentToAi) {
    applyPageConfirmationFromMessage(session, text);
    if (!session.pageConfirmed && isNegative(text) && (session.awaitingPageConfirm || session.pageName)) {
      session.pageName = "";
      session.pageUrl = "";
      session.pageConfirmed = false;
      session.pageLookupConfidence = "";
      session.pageSnapshot = null;
      session.pageSnapshotKey = "";
      session.pageSnapshotShown = false;
      session.awaitingPageConfirm = false;
      session.pageImageUrl = "";
      session.pageCandidates = [];
      session.pagePickerShown = false;
    }

    if (isAffirmative(text) && session.pageSnapshotShown && !session.quotationOffered && !isPageConfirmationPending(session)) {
      session.quotationOffered = true;
    }
    if (session.quotationOffered && hasEmail(session) && isAffirmative(text)) {
      session.quotationEmailConfirmed = true;
    }
  }
  if (/word on th(?:e\s+)?go|word on the god/i.test(lower)) {
    setSessionPageName(session, "Word On The Go", { source: "customer" });
  }
  if (nameMatch && (emailMatch || phoneMatch) && !session.customerName) session.customerName = nameMatch[1];
  if (inquiryVolumeMatch) {
    const count = inquiryVolumeMatch[1];
    const period = inquiryVolumeMatch[2] || (/daily|araw/i.test(text) ? "day" : /weekly|linggo/i.test(text) ? "week" : "");
    session.weeklyInquiries = period ? `${count} per ${period}` : count;
  }
  if (/\b(no|none|hindi|wala)\b.{0,30}\b(quote|quotation|proposal|estimate)\b/i.test(lower) || /\b(quote|quotation|proposal|estimate)\b.{0,30}\b(no|none|hindi|wala)\b/i.test(lower)) {
    session.sendsQuotations = "no";
  } else if (/quote|quotation|proposal|estimate|qoutation/i.test(lower)) {
    session.sendsQuotations = "yes";
  }
  const businessHints = [
    "used car", "used cars", "car dealer", "car dealership", "auto dealer",
    "copier", "printer", "cctv", "aircon", "solar", "construction", "supplier",
    "furniture", "it equipment", "cleaning", "pest", "logistics", "trucking",
    "printing", "food", "packaging", "event", "real estate", "insurance"
  ];
  const hint = businessHints.find((word) => lower.includes(word));
  if (hint) session.businessType = hint;
  if (
    hasLeadProfile(session)
    && !session.businessType
    && !isCustomerQuestion(text)
    && text.length >= 3
    && text.length <= 100
  ) {
    session.businessType = text.trim().slice(0, 80);
  }

  captureLeadAnswer(session, text);
  session.contact = [session.phone, session.email].filter(Boolean).join(" / ");
}

function mergeAistaffMemory(target, source = {}) {
  for (const key of [
    "customerName", "companyName", "address", "businessType", "pageName", "pageUrl", "pageNameSource", "websiteUrl", "websiteStatus",
    "email", "phone", "weeklyInquiries", "sendsQuotations", "inquiryTopics", "contact", "reviewChannel",
    "organizationProfile",
    "pageSnapshot", "pageSnapshotKey", "pageLookupConfidence", "pageImageUrl"
  ]) {
    if (!target[key] && source[key]) target[key] = source[key];
  }
  if (Array.isArray(source.pageCandidates) && source.pageCandidates.length) {
    target.pageCandidates = source.pageCandidates;
  }
  if (Array.isArray(source.lastShownCandidates) && source.lastShownCandidates.length) {
    target.lastShownCandidates = source.lastShownCandidates;
  }
  for (const key of [
    "pageConfirmed", "awaitingPagePick", "pagePickerShown", "awaitingPageScreenshot", "awaitingPageConfirm",
    "pageSnapshotShown", "assessmentDelivered", "explicitQuoteInterest", "quotationOffered",
    "quotationEmailConfirmed", "leadGenContact", "reviewPermissionGranted", "awaitingReviewPermission"
  ]) {
    if (source[key]) target[key] = source[key];
  }
  if (source.organizationProfile && typeof source.organizationProfile === "object") {
    target.organizationProfile = { ...(target.organizationProfile || emptyOrganizationProfile()), ...source.organizationProfile };
  }
  if (source.quotationDraftId) target.quotationDraftId = source.quotationDraftId;
  if (source.quotationNumber) target.quotationNumber = source.quotationNumber;
  if (source.assessmentDelivered) target.assessmentDelivered = source.assessmentDelivered;
  if (source.explicitQuoteInterest) target.explicitQuoteInterest = source.explicitQuoteInterest;
  if (Array.isArray(source.rejectedPageSlugs) && source.rejectedPageSlugs.length) {
    target.rejectedPageSlugs = [...new Set([...(target.rejectedPageSlugs || []), ...source.rejectedPageSlugs])];
  }
}

function aistaffMemoryPayload(session) {
  return {
    customerName: session.customerName,
    companyName: session.companyName,
    address: session.address,
    businessType: session.businessType,
    reviewChannel: session.reviewChannel || "",
    reviewPermissionGranted: session.reviewPermissionGranted || false,
    awaitingReviewPermission: session.awaitingReviewPermission || false,
    pageName: session.pageName,
    pageUrl: session.pageUrl,
    pageNameSource: session.pageNameSource || "",
    websiteUrl: session.websiteUrl,
    websiteStatus: session.websiteStatus,
    email: session.email,
    phone: session.phone,
    leadGenContact: session.leadGenContact,
    quotationOffered: session.quotationOffered,
    quotationEmailConfirmed: session.quotationEmailConfirmed,
    pageConfirmed: session.pageConfirmed,
    pageLookupConfidence: session.pageLookupConfidence,
    pageCandidates: session.pageCandidates,
    lastShownCandidates: session.lastShownCandidates,
    awaitingPagePick: session.awaitingPagePick,
    pageImageUrl: session.pageImageUrl,
    pagePickerShown: session.pagePickerShown,
    awaitingPageScreenshot: session.awaitingPageScreenshot,
    awaitingPageConfirm: session.awaitingPageConfirm,
    pageSnapshot: session.pageSnapshot,
    weeklyInquiries: session.weeklyInquiries,
    sendsQuotations: session.sendsQuotations,
    inquiryTopics: session.inquiryTopics,
    organizationProfile: organizationProfileForContext(session),
    contact: session.contact,
    lastMessages: session.messages.slice(-AISTAFF_CHAT_MEMORY_LIMIT),
    quotationDraftId: session.quotationDraftId || null,
    quotationNumber: session.quotationNumber || null,
    pageSnapshotShown: session.pageSnapshotShown,
    assessmentDelivered: session.assessmentDelivered,
    explicitQuoteInterest: session.explicitQuoteInterest,
    rejectedPageSlugs: session.rejectedPageSlugs || [],
    lastSentPageSlug: session.lastSentPageSlug || null,
    updatedAt: new Date().toISOString()
  };
}

function encodeAistaffLeadNotes(session) {
  return [
    "AIStaff Messenger memory:",
    JSON.stringify(aistaffMemoryPayload(session), null, 2)
  ].join("\n");
}

function extractJsonObject(text) {
  const start = String(text || "").indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function looksLikeContactBlob(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /(?:\+?63|0)?9\d{9}/.test(text) && /@/.test(text);
}

function decodeAistaffLeadNotes(notes) {
  if (!notes) return null;
  const raw = String(notes);
  const marker = raw.indexOf("AIStaff Messenger memory:");
  const payload = marker >= 0 ? raw.slice(marker + "AIStaff Messenger memory:".length).trim() : raw.trim();
  const jsonText = extractJsonObject(payload);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function formatAistaffKnownFacts(session) {
  const facts = [
    ["Full name", session.customerName],
    ["Company name", session.companyName],
    ["Mobile", session.phone],
    ["Email", getSessionEmail(session)],
    ["Address", session.address],
    ["Business type", session.businessType],
    ["Review channel", session.reviewChannel || ""],
    ["Review permission granted", session.reviewPermissionGranted ? "yes" : ""],
    ["Audit target Facebook Page name", session.pageNameSource === "customer" || session.pageUrl ? session.pageName : ""],
    ["Facebook Page URL", session.pageUrl],
    ["Page lookup confidence", session.pageLookupConfidence],
    ["Page confirmed", session.pageCheckInProgress ? "pending (checking now)" : (session.pageConfirmed ? "yes" : "")],
    ["Website", session.websiteUrl || (session.websiteStatus === "none" ? "none" : "")],
    ["Inquiry volume", session.weeklyInquiries],
    ["Quotation process", session.sendsQuotations ? session.sendsQuotations : ""],
    ["Common inquiry topics", session.inquiryTopics],
    ["Quotation email confirmed", session.quotationEmailConfirmed ? "yes" : ""]
  ].filter(([, value]) => value);

  if (!facts.length) return "- No details captured yet.";
  return facts.map(([label, value]) => `- ${label}: ${value}`).join("\n");
}

function formatAistaffRecentMessages(session) {
  if (!session.messages.length) return "- No recent messages yet.";
  return session.messages
    .slice(-6)
    .map((message) => `- ${message.role}: ${message.text}`)
    .join("\n");
}

function hasEmail(session) {
  return Boolean(session.email || (session.contact && /@/.test(session.contact)));
}

function getSessionEmail(session) {
  if (session.email) return session.email;
  const match = String(session.contact || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] || "";
}

function hasWebsiteAnswered(session) {
  return session.websiteStatus === "provided" || session.websiteStatus === "none" || Boolean(session.websiteUrl);
}

function hasContactDetails(session) {
  return Boolean(session.phone || (session.contact && /(?:\+?63|0)?9\d{9}/.test(session.contact)));
}

function needsPageConfirmation(session) {
  return Boolean(
    session.pageSnapshot?.facebook?.name
    && session.pageName
    && !session.pageUrl
    && !session.pageConfirmed
    && session.pageLookupConfidence
    && session.pageLookupConfidence !== "high"
  );
}

function minimumQualificationComplete(session) {
  return hasLeadProfile(session)
    && hasPageDetails(session)
    && (session.pageConfirmed || session.pageUrl || session.pageLookupConfidence === "high")
    && hasWebsiteAnswered(session)
    && session.pageSnapshotShown
    && session.quotationOffered
    && (hasEmail(session) ? session.quotationEmailConfirmed : false);
}

function buildGreetingReply(session, psid, isTagalog = false) {
  if (hasLeadProfile(session) || hasPageDetails(session) || hasWebsiteAnswered(session)) {
    const ack = isTagalog ? "Hi po! Nandito pa rin ako." : "Hi! I'm still here.";
    return `${ack} ${nextQualificationQuestionOnly(session, isTagalog)}`;
  }

  const intro = pickVariant(isTagalog ? GREETING_INTROS_TL : GREETING_INTROS_EN, hashSeed(psid) + session.messages.length);
  const question = isTagalog
    ? `${LEAD_FIELD_META.customerName.reasonTl} ${LEAD_FIELD_META.customerName.askTl} ${buildPrivacyNote(true)}`
    : `${LEAD_FIELD_META.customerName.reasonEn} ${LEAD_FIELD_META.customerName.askEn} ${buildPrivacyNote(false)}`;
  return `${intro} ${question}`;
}

function buildPageReceivedAck(isTagalog = false) {
  return isTagalog
    ? "Salamat po. Titingnan ko ngayon ang public Facebook Page ninyo para maintindihan ang products at services ninyo."
    : "Thanks. I'll take a look at your public Facebook Page now to understand your products and services.";
}

function buildWebsiteRequestReply(isTagalog = false) {
  return buildWebsiteUrlRequestReply(isTagalog);
}

function buildMinimumQuotationReply(session, isTagalog = false) {
  session.quotationOffered = true;
  const offer = isTagalog
    ? `${MINIMUM_OFFER.name} (chat lang sa Messenger, walang voice call): sumagot sa Messenger, mag-qualify ng inquiries, at maghanda ng quotation drafts. ${MINIMUM_OFFER.price}.`
    : `${MINIMUM_OFFER.name} (${MINIMUM_OFFER.channel}): replies in Messenger chat, qualifies inquiries, and prepares quotation drafts for your approval. ${MINIMUM_OFFER.price}.`;

  if (!hasEmail(session)) {
    return `${offer} ${isTagalog
      ? "Gusto niyo po bang i-email ang quotation? Ano po ang email address ninyo?"
      : "Would you like us to email your quotation? What email address should we use?"}`;
  }

  return `${offer} ${isTagalog
    ? `Gusto niyo po bang i-email ang quotation sa ${getSessionEmail(session)}?`
    : `Would you like us to email the quotation to ${getSessionEmail(session)}?`}`;
}

function buildServiceOverviewReply(session, isTagalog = false) {
  const solution = isTagalog
    ? `Ang AIStaff ay chat-only AI assistant sa Messenger — walang voice call. Sumasagot sa inquiries, nagtatanong ng qualification questions, sine-save ang lead details, at naghahanda ng quotation draft. ${lookupPurposeNotice(true)}`
    : `AIStaff is a chat-only AI assistant on Messenger — no voice calls. ${OFFICIAL_SERVICE_PROMISE.toLowerCase()} ${lookupPurposeNotice(false)}`;
  const missingLead = getNextMissingLeadField(session);
  const question = missingLead
    ? buildLeadFieldQuestion(missingLead, isTagalog)
    : buildFacebookUrlRequestReply(isTagalog);
  return `${solution} ${question}`;
}

function buildOfficialPricingReply(session, isTagalog = false) {
  const missingLead = getNextMissingLeadField(session);
  if (missingLead) return buildLeadFieldQuestion(missingLead, isTagalog);
  if (!hasPageDetails(session)) {
    return isTagalog
      ? `Para matingnan ang public Facebook Page ninyo, ${buildFacebookUrlRequestReply(true)}`
      : `To review your public Facebook Page, ${buildFacebookUrlRequestReply(false)}`;
  }
  if (!hasWebsiteAnswered(session)) {
    return buildWebsiteRequestReply(isTagalog);
  }
  return buildMinimumQuotationReply(session, isTagalog);
}

function buildPlanCompareReply(session, planA, planB, isTagalog = false) {
  const a = OFFICIAL_PACKAGES[planA];
  const b = OFFICIAL_PACKAGES[planB];
  if (!a || !b) return buildOfficialPricingReply(session, isTagalog);

  const text = isTagalog
    ? `${planA.charAt(0).toUpperCase() + planA.slice(1)} (${a.price}) ay para sa ${a.bestFor}. ${planB.charAt(0).toUpperCase() + planB.slice(1)} (${b.price}) ay para sa ${b.bestFor}. Kasama sa ${planB}: ${b.includes.slice(1).join("; ")}.`
    : `${planA.charAt(0).toUpperCase() + planA.slice(1)} (${a.price}) is for ${a.bestFor}. ${planB.charAt(0).toUpperCase() + planB.slice(1)} (${b.price}) is for ${b.bestFor}. ${planB.charAt(0).toUpperCase() + planB.slice(1)} adds: ${b.includes.slice(1).join("; ")}.`;

  const question = isTagalog
    ? "Gusto niyo po bang i-schedule ang free inbox audit today?"
    : "Would you like us to schedule your free inbox audit today?";
  return `${text} ${question}`;
}

function buildAuditReply(session, isTagalog = false) {
  const solution = isTagalog
    ? "Sa free inbox audit, makikita ninyo kung saan na-delay ang Messenger leads, anong details ang kulang, at paano kayo mas mabilis makapag-qualify at maghanda ng quotation-ready leads. Hindi kami pumapasok sa inbox ninyo — titingnan ng team namin ang Page setup at inquiry flow base sa info na ibibigay ninyo."
    : "Our free inbox audit shows where Messenger leads may be delayed, where customer details are missing, and how AI can qualify inquiries faster and prepare quotation-ready leads. We do not log into your inbox — our team reviews your Page setup and inquiry flow from the details you provide.";

  const missingLead = getNextMissingLeadField(session);
  if (missingLead) {
    return `${solution} ${buildLeadFieldQuestion(missingLead, isTagalog)}`;
  }

  if (hasPageDetails(session) && hasContactDetails(session)) {
    const pageLabel = session.pageName || session.pageUrl;
    const question = isTagalog
      ? "Gusto niyo po bang i-schedule ang free inbox audit today?"
      : "Would you like us to schedule your free inbox audit today?";
    return `${solution} We already have "${pageLabel}" and your contact details on file, so our team can schedule the audit today. ${question}`;
  }

  if (hasPageDetails(session)) {
    const question = isTagalog
      ? "Ano po ang contact person, mobile number, at email para ma-schedule ang audit today?"
      : "May I get contact person, mobile number, and email to schedule the audit today?";
    return `${solution} ${question}`;
  }

  const question = isTagalog
    ? "Ano po ang Facebook Page name o URL ninyo?"
    : "May I get your Facebook Page name or URL?";
  return `${solution} ${question}`;
}

function wantsFacebookPreview(messageText) {
  const lower = String(messageText || "").toLowerCase();
  return /\b(?:check|review|look at|preview|tingnan|validate)\b.*\b(?:my\s+)?(?:facebook\s+)?page\b/i.test(lower)
    || /\b(?:check|review|look at|preview)\b.*\bfacebook\b/i.test(lower)
    || /\bfacebook\s+page\b.*\b(?:now|please|po)\b/i.test(lower);
}

function wantsWebsitePreview(messageText) {
  const lower = String(messageText || "").toLowerCase();
  return /\b(?:check|review|look at|preview|tingnan)\b.*\b(?:my\s+)?website\b/i.test(lower)
    || /\bwebsite\b.*\b(?:now|please|review|check)\b/i.test(lower);
}

function wantsPublicPreview(messageText) {
  return wantsFacebookPreview(messageText) || wantsWebsitePreview(messageText);
}

function wantsAiFitAssessment(messageText) {
  const lower = String(messageText || "").toLowerCase();
  return /\b(do i need|should i|need ai|need your service|need aistaff|assess|assessment|fit|suitable|good fit|review my (?:page|business)|check my (?:page|business)|audit|kailangan ba)\b/i.test(lower)
    || /\b(advantages?|benefits?|opportunities?|missed opportunity|how can (?:you|ai|aistaff|it) help|how would.*help|worth it|tell me if i need)\b/i.test(lower)
    || (wantsFacebookPreview(messageText) && /\b(ai|chat assistant|aistaff|your service)\b/i.test(lower));
}

function wantsStructuredAssessmentReply(messageText) {
  const text = String(messageText || "").toLowerCase();
  return /\b(what did you see|what do you see|how can it benefit|how can you help|how will it|life easier|make(?:s)? (?:our |your |my )?life easier|benefit|missed|inquir|assess|analyze|analyse|visit|check (?:my |our |the )?(?:page|website|fb|facebook)|do i need|tell me how you can help|catch those|message us|messenger)\b/i.test(text);
}

function buildMessengerFormattingGuide() {
  return buildMessengerAssessmentFormattingGuide();
}

function isFreshPageCheckInquiry(messageText, session = {}) {
  const text = String(messageText || "").trim();
  if (!text || !wantsFacebookPreview(text)) return false;
  if (!session.reviewPermissionGranted) return false;
  if (!hasExplicitPageTarget(session) && !extractPageNameFromMessage(text)) return false;
  if (customerWantsPricing(text) && (session.assessmentDelivered || session.quotationOffered)) return false;
  if (session.quotationOffered || session.pendingMessengerPdf?.url) return false;
  if (session.assessmentDelivered) {
    const extracted = extractPageNameFromMessage(text);
    if (!extracted || !session.pageName) return false;
    if (normalizePageNameForLookup(extracted).toLowerCase() === normalizePageNameForLookup(session.pageName).toLowerCase()) {
      return false;
    }
  }
  if (session.pageConfirmed && (wantsAiFitAssessment(text) || hasWebsiteAnswered(session))) return false;
  return Boolean(extractPageNameFromMessage(text) || /\b(?:word on the go|facebook page|my page|page name)\b/i.test(text));
}

function shouldBootstrapAssessment(session, messageText) {
  if (!session.reviewPermissionGranted) return false;
  if (session.reviewChannel === "website") {
    if (!hasWebsiteAnswered(session)) return false;
  } else if (!session.pageConfirmed || !hasWebsiteAnswered(session)) {
    return false;
  }
  if (session.assessmentDelivered && !wantsAiFitAssessment(messageText)) return false;
  const saidNoWebsite = /\b(no website|don't have a website|do not have a website|wala(?:ng)?\s+website|none)\b/i.test(String(messageText || "").toLowerCase());
  if (!session.assessmentDelivered && saidNoWebsite && session.websiteStatus === "none") return false;
  return wantsAiFitAssessment(messageText)
    || (!session.assessmentDelivered && saidNoWebsite);
}

function resetPageFlowForFreshInquiry(session, messageText) {
  const extracted = extractPageNameFromMessage(messageText);
  session.pageConfirmed = false;
  session.awaitingPageConfirm = false;
  session.awaitingPagePick = false;
  session.pagePickerShown = false;
  session.pageImageUrl = "";
  session.pageUrl = "";
  session.pageJustPicked = false;
  session.pageLookupConfidence = "";
  session.pageSnapshot = null;
  session.pageSnapshotKey = "";
  session.pageSnapshotShown = false;
  session.assessmentDelivered = false;
  session.pageCandidates = [];
  session.lastShownCandidates = [];
  session.pendingMessengerCarousel = null;
  session.pendingMessengerImages = null;
  session.lastSentPageSlug = null;
  session.pageCheckInProgress = Boolean(session.reviewPermissionGranted);
  if (extracted) setSessionPageName(session, extracted, { source: "customer" });
  else if (/word on th(?:e\s+)?go/i.test(messageText)) setSessionPageName(session, "Word On The Go", { source: "customer" });
}

function buildPreviewMissingDetailReply(session, messageText, isTagalog = false) {
  if (wantsFacebookPreview(messageText) && !hasPageDetails(session)) {
    return isTagalog
      ? `Oo po — puwede kong tingnan ang public Facebook Page ninyo habang nagcha-chat tayo. ${buildFacebookUrlRequestReply(true)}`
      : `Yes — I can review your public Facebook Page while we chat. ${buildFacebookUrlRequestReply(false)}`;
  }
  if (wantsWebsitePreview(messageText) && !session.websiteUrl && session.websiteStatus !== "none") {
    return isTagalog
      ? `Oo po — puwede kong tingnan ang public website ninyo habang nagcha-chat tayo. ${buildWebsiteUrlRequestReply(true)}`
      : `Yes — I can review your public website while we chat. ${buildWebsiteUrlRequestReply(false)}`;
  }
  return "";
}

function isCustomerQuestion(message) {
  const text = String(message || "").trim();
  if (!text) return false;
  if (wantsPublicPreview(text)) return false;
  return /^(what|how|why|when|where|who|can|could|do|does|did|is|are|will|would|should|magkano|paano|ano|saan|ilan|may|mayroon)\b/i.test(text)
    || /\?\s*$/.test(text)
    || /how will you|how do you|what is|what does|tell me about/i.test(text);
}

function qualificationComplete(session) {
  return minimumQualificationComplete(session);
}

function stripTrailingQuestions(text) {
  const cleaned = String(text || "").trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]?/g) || [cleaned];
  const kept = [];
  for (const sentence of sentences) {
    if (/\?/.test(sentence) && kept.length > 0) break;
    kept.push(sentence.trim());
  }
  return kept.join(" ").trim() || cleaned.split("?")[0].trim();
}

function replyAlreadyAsksNextStep(text, session) {
  const lower = String(text || "").toLowerCase();
  if (!/\?/.test(lower)) return false;
  const missingLead = getNextMissingLeadField(session);
  if (missingLead) {
    if (missingLead === "customerName") return /full name|pangalan|name/i.test(lower);
    if (missingLead === "companyName") return /company|business name/i.test(lower);
    if (missingLead === "phone") return /mobile|phone|number/i.test(lower);
    if (missingLead === "email") return /email/i.test(lower);
    if (missingLead === "address") return /address|business address|located/i.test(lower);
  }
  const missingQuote = getMissingQuotationFields(session);
  if (missingQuote.includes("address") && /address|business address|located/i.test(lower)) return true;
  if (!hasPageDetails(session)) return /facebook page|page url|page name/i.test(lower);
  if (needsPageConfirmation(session)) return /is this your|ito po ba|tamang facebook page|correct facebook page/i.test(lower);
  if (!hasWebsiteAnswered(session)) return /website|site|wala|none/i.test(lower);
  if (getQualificationNextStep(session).phase === "value_review") {
    return /explore|set up|help your|benefit|missed|opportunit|fit|ministry|inquir/i.test(lower);
  }
  if (!session.quotationOffered) return /quotation|package|pricing|magkano|presyo|explore how we|set this up/i.test(lower);
  if (!hasEmail(session)) return /email/i.test(lower);
  if (!session.quotationEmailConfirmed) return /email the quotation|send the quotation|i-email/i.test(lower);
  return /send|proceed|ituloy|confirm/i.test(lower);
}

function isPagePickFlowActive(session) {
  return Boolean(
    session.awaitingPageConfirm
    || session.pageJustPicked
    || (!session.pageConfirmed && session.pendingMessengerImages?.length)
  );
}

function enforceShortReply(text, max = 340) {
  const cleaned = String(text || "").trim();
  if (cleaned.length <= max) return cleaned;
  const slice = cleaned.slice(0, max);
  const stop = Math.max(slice.lastIndexOf("."), slice.lastIndexOf("?"), slice.lastIndexOf("!"));
  return (stop > 80 ? slice.slice(0, stop + 1) : `${slice.trim()}…`).trim();
}

function combineAnswerWithNextQuestion(answerText, session, isTagalog = false, options = {}) {
  if (
    options.skipQualificationAppend
    || isPagePickFlowActive(session)
    || wantsPageScreenshot(options.customerMessage || "")
    || isFetchScreenshotCommand(options.customerMessage || "", session)
  ) {
    return enforceShortReply(enforceSingleQuestion(answerText));
  }
  if (qualificationComplete(session)) return enforceShortReply(enforceSingleQuestion(answerText));
  if (replyAlreadyAsksNextStep(answerText, session)) return enforceShortReply(enforceSingleQuestion(answerText));

  const next = nextQualificationQuestionOnly(session, isTagalog);
  const brief = stripTrailingQuestions(answerText)
    .replace(/\banything else you want to know\??/gi, "")
    .replace(/\bmay iba pa po ba kayong tanong\b[^?]*\?/gi, "")
    .trim();

  return enforceSingleQuestion(`${brief} ${next}`.trim());
}

function enforceSingleQuestion(text) {
  let cleaned = String(text || "").trim();
  const firstQuestion = cleaned.indexOf("?");
  if (firstQuestion === -1) return cleaned;
  const tail = cleaned.slice(firstQuestion + 1).trim();
  if (!tail || !/\?/.test(tail)) return cleaned;
  return cleaned.slice(0, firstQuestion + 1).trim();
}

function stripForbiddenPlanClaims(text) {
  if (FORBIDDEN_PLAN_CLAIMS.some((pattern) => pattern.test(text))) {
    return null;
  }
  return text;
}

function pricingGateReply(session, isTagalog = false) {
  const solution = isTagalog
    ? "Ang packages namin ay managed setup para sa AI Messenger sales assistant — instant reply, lead capture, qualification, at quotation drafts na ia-approve ng admin."
    : "Our packages are managed setup for an AI Messenger sales assistant — instant replies, lead capture, qualification, and admin-approved quotation drafts.";
  const range = isTagalog
    ? `Nagsisimula ang packages sa ${MINIMUM_OFFER.price} depende sa inquiry volume.`
    : `Packages start at ${MINIMUM_OFFER.price} depending on inquiry volume.`;
  const question = isTagalog
    ? "Pahingi muna ng contact person, mobile number, at email para ma-send ko ang exact package fit?"
    : "May I get contact person, mobile number, and email so I can send the exact package fit?";
  return `${solution} ${range} ${question}`;
}

function sanitizeAistaffReply(reply, session, context = {}) {
  let text = String(reply || "").trim();
  const isTagalog = context.isTagalog || false;
  const forbiddenPatterns = [
    /i['']?ll check (your )?(inbox|messenger inbox)/i,
    /i will check (your )?(inbox|messenger inbox)/i,
    /let me check (your )?(inbox|messenger inbox)/i,
    /i['']?ll send (the )?link to your inbox/i,
    /checking (your )?(inbox|messenger inbox) now/i
  ];

  if (forbiddenPatterns.some((pattern) => pattern.test(text))) {
    text = buildAuditReply(session, isTagalog);
  }

  const previewDenialPatterns = [
    /sorry,? i can'?t (?:check|review)/i,
    /i can'?t (?:check|review) your (?:facebook|website|page)/i,
    /can'?t (?:check|review).{0,60}directly/i,
    /our team (?:will review|focuses on your facebook)/i
  ];
  if (previewDenialPatterns.some((pattern) => pattern.test(text)) && wantsPublicPreview(context.customerMessage || "")) {
    if (session.pageSnapshot?.facebook || session.pageSnapshot?.website) {
      text = formatSnapshotForMessenger(session.pageSnapshot, { isTagalog });
    } else {
      text = buildPreviewMissingDetailReply(session, context.customerMessage || "", isTagalog)
        || (isTagalog
          ? `Oo po — puwede kong tingnan ang public Facebook Page at website ninyo. ${buildFacebookUrlRequestReply(true)}`
          : `Yes — I can review your public Facebook Page and website. ${buildFacebookUrlRequestReply(false)}`);
    }
  }

  if (stripForbiddenPlanClaims(text) === null) {
    if (/starter|growth|scale|pro|difference|compare|plan/i.test(context.customerMessage || "")) {
      text = buildPlanCompareReply(session, "starter", "growth", isTagalog);
    } else {
      text = buildOfficialPricingReply(session, isTagalog);
    }
  }

  if (!hasEmail(session) && PLAN_PRICE_PATTERN.test(text)) {
    text = isTagalog
      ? `${MINIMUM_OFFER.name} ay nagsisimula sa ${MINIMUM_OFFER.price}. Ano po ang email ninyo para ma-send ang quotation?`
      : `${MINIMUM_OFFER.name} starts at ${MINIMUM_OFFER.price}. What email should we use to send your quotation?`;
  }

  if (isPagePickFlowActive(session) || wantsPageScreenshot(context.customerMessage || "")) {
    text = text
      .replace(/\b(?:may i get|can you share|please share).{0,120}(?:website|site url)[^?]*\?/gi, "")
      .replace(/\bhere(?:'|')?s a screenshot[^.!?]*[.!?]/gi, "")
      .trim();
  }

  if (hasPageDetails(session) && hasContactDetails(session)) {
    text = text
      .replace(/\b(?:may i get|can you share|please share|confirm your).{0,120}(?:page name|facebook page|contact person|mobile number|email)[^?]*\?/gi, "")
      .replace(/\b(?:just confirm|confirm your) page name and contact details[^?]*\?/gi, "")
      .trim();
    if (
      !wantsPublicPreview(context.customerMessage || "")
      && /\bfree inbox audit\b/i.test(context.customerMessage || "")
      && text.length < 80
    ) {
      text = buildAuditReply(session, isTagalog);
    }
  }

  if (
    session.pageName
    && /\b(?:may i get|can you share|please share).{0,40}(?:exact )?facebook page url\b/i.test(text)
    && hasPageDetails(session)
    && !wantsPublicPreview(context.customerMessage || "")
    && !facebookLookupFailed(session)
  ) {
    text = hasContactDetails(session)
      ? buildAuditReply(session, isTagalog)
      : `${isTagalog ? "Noted po" : "Noted"} — "${session.pageName}". ${isTagalog ? "Ano po ang contact person, mobile number, at email para ma-schedule ang audit today?" : "May I get contact person, mobile number, and email to schedule the audit today?"}`;
  }

  if (
    hasPageDetails(session)
    && hasContactDetails(session)
    && session.weeklyInquiries
    && /may i get|can you share|please share|confirm your contact/i.test(text)
    && !customerWantsPricing(context.customerMessage || "")
    && !session.quotationOffered
    && !session.assessmentDelivered
  ) {
    text = isTagalog
      ? "Salamat po. Nandito na ang Page at contact details ninyo. Puwede na nating i-schedule ang free inbox audit today — gusto niyo po bang ituloy?"
      : "Thank you. I already have your Page and contact details. We can schedule your free inbox audit today — would you like us to proceed?";
  }

  text = enforceSingleQuestion(text);
  return text.slice(0, 1200);
}

function nextQualificationQuestionOnly(session, isTagalog = false) {
  const missingLead = getNextMissingLeadField(session);
  if (missingLead) return buildLeadFieldAskWithContext(missingLead, isTagalog);

  if (!hasPageDetails(session)) {
    return buildFacebookUrlRequestReply(isTagalog);
  }
  if (facebookLookupFailed(session)) {
    return isTagalog
      ? `Hindi ko mahanap ang public Facebook Page para sa "${session.pageName}". ${buildFindPageUrlHelpReply(true)} ${buildFacebookUrlRequestReply(true)}`
      : `I could not find the public Facebook Page for "${session.pageName}". ${buildFindPageUrlHelpReply(false)} ${buildFacebookUrlRequestReply(false)}`;
  }
  if (!hasVerifiedPage(session) && needsPageConfirmation(session)) {
    return formatFacebookLookupMessage(
      { ok: true, facebook: session.pageSnapshot.facebook, match: { confidence: session.pageLookupConfidence } },
      { isTagalog, requestedName: session.pageName }
    );
  }
  if (!hasVerifiedPage(session)) {
    return isTagalog
      ? "Pakiconfirm muna po ang tamang Facebook Page, o i-send ang direct Page URL o screenshot ng Page."
      : "Please confirm the correct Facebook Page, or send the direct Page URL or a screenshot of your Page.";
  }
  if (!hasWebsiteAnswered(session)) {
    return buildWebsiteRequestReply(isTagalog);
  }
  if (!session.pageSnapshotShown || !session.assessmentDelivered) {
    return isTagalog
      ? "Puwede ko na bang i-review ang public Facebook Page ninyo para makita kung paano kayo matutulungan ng AIStaff?"
      : "May I review your public Facebook Page now and share what I find about your organization?";
  }
  if (!canOfferQuotation(session)) {
    return isTagalog
      ? "Gusto niyo po bang pag-usapan kung paano makakatulong ang AIStaff sa mga Messenger inquiries ninyo?"
      : "Would you like to explore how AIStaff could help with your Messenger inquiries?";
  }
  const missingQuote = getMissingQuotationFields(session);
  if (missingQuote.length) {
    return buildLeadFieldAskWithContext(missingQuote[0], isTagalog, { quotation: true });
  }
  if (!session.quotationOffered) {
    return isTagalog
      ? "Gusto niyo po bang ihanda ko ang quotation draft pagkatapos ng review?"
      : "Would you like me to prepare a quotation draft now?";
  }
  if (!hasEmail(session)) {
    return isTagalog
      ? "Gusto niyo po bang i-email ang quotation? Ano po ang email address ninyo?"
      : "Would you like us to email your quotation? What email address should we use?";
  }
  if (!session.quotationEmailConfirmed) {
    return isTagalog
      ? `Gusto niyo po bang i-email ang quotation sa ${getSessionEmail(session)}?`
      : `Would you like us to email the quotation to ${getSessionEmail(session)}?`;
  }
  return isTagalog
    ? "Salamat po. May iba pa po ba kayong tanong tungkol sa AI Inbox Sales Assistant?"
    : "Thank you. Do you have any other questions about the AI Inbox Sales Assistant?";
}

function nextQualificationPrompt(session, isTagalog = false) {
  const missingLead = getNextMissingLeadField(session);
  if (missingLead) {
    const prefix = isTagalog
      ? "Salamat po. Kailangan ko lang ng ilang detalye para ma-review ang Page ninyo at makapag-follow up."
      : "Thank you. I just need a few details so we can review your Page and follow up.";
    return `${prefix} ${nextQualificationQuestionOnly(session, isTagalog)}`;
  }
  if (!hasPageDetails(session)) {
    const prefix = isTagalog
      ? `Ang ${MINIMUM_OFFER.name} ay sumasagot sa Messenger, nagq-qualify ng leads, at naghahanda ng quotation drafts.`
      : `The ${MINIMUM_OFFER.name} replies on Messenger, qualifies leads, and prepares quotation drafts.`;
    return `${prefix} ${nextQualificationQuestionOnly(session, isTagalog)}`;
  }
  if (!hasWebsiteAnswered(session)) {
    return buildWebsiteRequestReply(isTagalog);
  }
  if (!session.quotationOffered && session.pageSnapshotShown) {
    return buildMinimumQuotationReply(session, isTagalog);
  }
  return nextQualificationQuestionOnly(session, isTagalog);
}

async function hydrateAistaffSessionFromPostgres(psid, session) {
  if (session.persistedLoaded) return;
  session.persistedLoaded = true;

  try {
    const companyId = await getDefaultCompanyId();
    const conversation = await prisma.conversation.findUnique({
      where: { company_id_psid: { company_id: companyId, psid } },
      include: {
        messages: { orderBy: { created_at: "desc" }, take: AISTAFF_CHAT_MEMORY_LIMIT },
        leads: { orderBy: { updated_at: "desc" }, take: 1 }
      }
    });
    if (!conversation) return;

    const lead = conversation.leads?.[0];
    const memory = decodeAistaffLeadNotes(lead?.notes);
    if (memory) mergeAistaffMemory(session, memory);

    if (lead) {
      const leadPatch = {
        pageUrl: lead.location || "",
        weeklyInquiries: lead.budget,
        sendsQuotations: lead.urgency,
        inquiryTopics: lead.service_needed,
        contact: [lead.mobile_number, lead.email].filter(Boolean).join(" / "),
        email: lead.email || "",
        phone: lead.mobile_number || ""
      };
      if (lead.customer_name && !looksLikeContactBlob(lead.customer_name) && !session.customerName) {
        leadPatch.customerName = lead.customer_name;
      }
      if (lead.company_name && !session.companyName) leadPatch.companyName = lead.company_name;
      mergeAistaffMemory(session, leadPatch);
      if (lead.company_name && !session.businessType) session.businessType = lead.company_name;
    }

    const restoredMessages = conversation.messages
      .slice()
      .reverse()
      .map((message) => ({
        role: message.sender_type === "customer" ? "customer" : "assistant",
        text: message.message_text,
        at: message.created_at.toISOString()
      }));
    if (restoredMessages.length) session.messages = restoredMessages.slice(-AISTAFF_CHAT_MEMORY_LIMIT);
  } catch (error) {
    console.warn("Could not hydrate AIStaff memory from Postgres:", error.message);
  }
}

function snapshotCacheKey(session) {
  return [session.pageUrl, session.pageName, session.websiteUrl, session.websiteStatus].filter(Boolean).join("|").toLowerCase();
}

function shouldPresentPageSnapshot(session, messageText, snapshot) {
  if (!snapshot) return false;

  if (wantsFacebookPreview(messageText) && snapshot.facebook && hasPageDetails(session)) {
    if (needsPageConfirmation(session) && !isAffirmative(messageText)) return false;
    return true;
  }
  if (wantsWebsitePreview(messageText) && snapshot.website && session.websiteUrl) {
    return true;
  }

  if (!snapshot.ok || !hasVerifiedPage(session) || !hasWebsiteAnswered(session)) return false;
  if (needsPageConfirmation(session) && !isAffirmative(messageText)) return false;
  const lower = String(messageText || "").toLowerCase();
  const pageInfoProvided = /facebook|profile\.php|page name|page ko|page is|my page/i.test(lower);
  const websiteInfoProvided = !/@/.test(lower)
    && (/website|wala|none|no website|\.click|\.ph\b/i.test(lower)
      || (isLikelyWebsiteUrl(messageText) && !isFacebookUrl(messageText)));
  const wantsPreview = wantsPublicPreview(messageText)
    || /verify|confirm|is this|look up|find my page|tingnan|validate/i.test(lower);
  const cacheChanged = session.pageSnapshotKey === snapshotCacheKey(session) && !session.pageSnapshotShown;
  return pageInfoProvided || websiteInfoProvided || wantsPreview || cacheChanged;
}

async function maybeRefreshPageSnapshot(session) {
  const key = snapshotCacheKey(session);
  if (!hasPageDetails(session)) return null;
  if (session.pageSnapshotKey === key && session.pageSnapshot) return session.pageSnapshot;

  const snapshot = await buildPresenceSnapshot({
    facebookInput: session.pageUrl || session.pageName,
    websiteInput: session.websiteStatus === "provided" ? session.websiteUrl : "",
    requestedPageName: session.pageName,
    websiteStatus: session.websiteStatus
  });

  session.pageSnapshotKey = key;
  session.pageSnapshot = snapshot;
  const shouldInjectCandidates = !session.pageConfirmed
    && snapshot.facebookCandidates?.length > 1
    && !session.awaitingPageConfirm
    && !session.pageImageUrl
    && !session.pagePickerShown;
  if (shouldInjectCandidates) {
    const ranked = pickBestPageCandidates(
      snapshot.facebookCandidates,
      session.pageName,
      session.rejectedPageSlugs,
      { customerName: session.customerName }
    );
    session.pageCandidates = ranked;
    session.lastShownCandidates = [...ranked];
    session.awaitingPagePick = false;
  }
  if (snapshot.facebookMatch?.confidence) {
    session.pageLookupConfidence = snapshot.facebookMatch.confidence;
  }
  if (snapshot.facebook?.name && !session.pageName) session.pageName = snapshot.facebook.name;
  if (snapshot.facebook?.url && !session.pageUrl && session.pageConfirmed) {
    session.pageUrl = snapshot.facebook.url;
  }
  if (snapshot.website?.url && !session.websiteUrl) {
    session.websiteUrl = snapshot.website.url;
    session.websiteStatus = "provided";
  }
  return snapshot;
}

function buildSnapshotReply(session, messageText, snapshot) {
  return formatSnapshotForMessenger(snapshot, { isTagalog: isTagalogText(messageText) });
}

function queuePageImages(session, candidates, isTagalog = false) {
  const items = (candidates || []).filter((candidate) => candidate.imageUrl);
  if (!items.length) return;
  session.pendingMessengerImages = buildMessengerImageMessages(items, { isTagalog });
}

async function ensurePageCandidatesForScreenshot(session, messageText) {
  const existing = activePageCandidates(session);
  if (existing.length) return existing;

  if (session.pageImageUrl && session.pageName) {
    return [{
      name: session.pageName,
      slug: session.pageUrl?.split("facebook.com/")[1] || "",
      imageUrl: session.pageImageUrl,
      url: session.pageUrl
    }];
  }

  const hint = getExplicitPageLookupTarget(session)
    || extractPageHintFromMessage(messageText)
    || findPageHintFromMessages(session.messages, session);
  if (!hint || isFetchScreenshotCommand(hint, session)) return [];

  const search = await searchFacebookPagesByName(hint);
  const ranked = pickBestPageCandidates(search.candidates, hint, session.rejectedPageSlugs, { customerName: session.customerName });
  if (!ranked.length) return [];

  setSessionPageName(session, hint, { source: "customer" });
  session.pageCandidates = ranked;
  session.lastShownCandidates = [...ranked];
  session.awaitingPagePick = false;
  return ranked;
}

async function buildPageScreenshotReply(session, messageText, isTagalog = false, { apologetic = false } = {}) {
  session.awaitingPageScreenshot = true;
  const candidates = await ensurePageCandidatesForScreenshot(session, messageText);
  const pick = resolvePageCandidatePick(session, messageText);
  let toShow = pick ? [pick] : candidates;

  if (!pick && (/\bwotg\b/i.test(String(messageText || "")) || /word\s+on\s+the\s+go/i.test(String(messageText || "")))) {
    const wotgPage = candidates.find((candidate) => candidate.slug === "wotg.wordonthego")
      || candidates.find((candidate) => /wotg/i.test(candidate.slug) && candidate.slug !== "WOTGCM");
    if (wotgPage) toShow = [wotgPage];
  }
  if (isFetchScreenshotCommand(messageText, session) && !pick) {
    const hint = findPageHintFromMessages(session.messages, session);
    if (/wotg|word on the go/i.test(hint)) {
      const wotgPage = candidates.find((candidate) => candidate.slug === "wotg.wordonthego")
        || candidates.find((candidate) => candidate.slug !== "WOTGCM");
      if (wotgPage) toShow = [wotgPage];
    }
  }

  toShow = (toShow || []).filter((item) => item?.imageUrl);
  if (!toShow.length) {
    return warmReply(
      isTagalog
        ? "hindi ko pa ma-load ang Page image. Paki-send ang Facebook Page URL o exact Page name ulit."
        : "I couldn't load the Page image yet. Please send your Facebook Page URL or exact Page name again.",
      isTagalog,
      { sorry: true }
    );
  }

  queuePageImages(session, toShow, isTagalog);
  session.awaitingPageScreenshot = false;
  if (toShow.length === 1) applyScreenshotPageSelection(session, toShow[0]);
  const label = toShow[0].name || toShow[0].slug || session.pageName;
  const core = isTagalog
    ? `narito ang Page image para sa ${label}. Ito po ba ang Page ninyo?`
    : `here's the Page image for ${label}. Is this your Page?`;
  return warmReply(core, isTagalog, { sorry: apologetic });
}

function buildPageCheckAckReply(session, messageText) {
  const isTagalog = isTagalogText(messageText);
  const label = session.pageName || "your Page";
  const match = activePageCandidates(session).find((c) => c.slug === session.lastSentPageSlug);
  const sentLabel = match?.name || match?.slug || session.pageName || label;
  const thanks = isTagalog
    ? `salamat po sa pag-share — sandali lang habang tinitingnan ko ang public Facebook Page ninyong "${label}".`
    : `thanks for reaching out — one moment while I look up your public Facebook Page "${label}".`;
  const confirm = session.pendingMessengerImages?.length || session.pageImageUrl
    ? (isTagalog
      ? ` Narito ang preview ng "${sentLabel}". Ito po ba ang Facebook Page ninyo?`
      : ` I've sent a preview of "${sentLabel}". Is this your Facebook Page?`)
    : (isTagalog
      ? " Sandali lang po habang hinahanap ko ang Page ninyo."
      : " Please give me a moment while I find your Page.");
  return warmReply(`${thanks}${confirm}`, isTagalog);
}

function replyLooksLikeStalePageConfirm(text, session) {
  if (session.pageConfirmed) return false;
  return /\b(?:i see you|thanks for confirming|you(?:'ve| have) confirmed|thank you for confirming)\b/i.test(text)
    || (/\b(?:website|site url)\b/i.test(text) && !hasWebsiteAnswered(session));
}

function buildPagePickReminder(session, isTagalog = false) {
  const label = session.pageName || "your Page";
  if (session.awaitingPageConfirm) {
    return isTagalog
      ? `Ito po ba ang Facebook Page ninyo (${label})?`
      : `Is this your Facebook Page (${label})?`;
  }
  return isTagalog
    ? "Ano po ang Facebook Page URL o exact name ninyo?"
    : "May I get your Facebook Page URL or exact Page name?";
}

function getQualificationNextStep(session, messageText = "") {
  if (shouldBootstrapAssessment(session, messageText)) {
    return { phase: "public_preview", pageName: session.pageName, note: "Run assess_ai_fit and share real findings" };
  }

  const missingLead = getNextMissingLeadField(session);
  if (missingLead) return { phase: "lead_capture", field: missingLead };

  if (!hasReviewChannel(session)) {
    return { phase: "review_channel_choice", note: "Ask whether to review Facebook Page, website, or both first" };
  }

  if (reviewIncludesFacebook(session) && !hasExplicitPageTarget(session)) {
    return { phase: "page_target_collect", note: "Ask for Facebook Page name or URL — NOT company name" };
  }

  if (reviewIncludesWebsite(session) && !session.websiteUrl && session.websiteStatus !== "none") {
    return { phase: "website_target_collect", note: "Ask for website URL or if they have none" };
  }

  if (!session.reviewPermissionGranted) {
    session.awaitingReviewPermission = true;
    return {
      phase: "review_permission",
      channel: session.reviewChannel,
      note: "Ask permission to review public Facebook Page and/or website preview only"
    };
  }
  session.awaitingReviewPermission = false;

  if (isFreshPageCheckInquiry(messageText, session) || session.pageCheckInProgress) {
    return {
      phase: "page_lookup",
      pageName: session.pageName,
      note: "Permission granted — look up the Page they named, not company name"
    };
  }

  if (reviewIncludesFacebook(session)) {
    if (facebookLookupFailed(session)) {
      return { phase: "page_lookup_failed", pageName: session.pageName };
    }
    if (session.awaitingPageConfirm && !session.pageConfirmed) {
      return {
        phase: "page_confirm",
        pageName: session.pageName,
        awaitingUserYes: true,
        note: "Page image shown — waiting for clear yes/no about THIS business Page"
      };
    }
    if (hasPageCandidates(session) && !session.pageConfirmed && !session.awaitingPageConfirm) {
      const next = getNextPageCandidate(session);
      return {
        phase: "page_lookup",
        suggestedPage: next ? { name: next.name || next.slug, slug: next.slug } : null,
        note: "Send one Page image at a time via send_page_images, then ask if it is their business Page"
      };
    }
    if (!hasVerifiedPage(session) && needsPageConfirmation(session)) {
      return {
        phase: "page_confirm",
        pageName: session.pageSnapshot?.facebook?.name || session.pageName,
        confidence: session.pageLookupConfidence
      };
    }
    if (!hasVerifiedPage(session) && hasExplicitPageTarget(session) && !session.pageCheckInProgress) {
      return { phase: "page_lookup", pageName: session.pageName, need: "run check after permission" };
    }
  }

  if (reviewIncludesWebsite(session) && !hasWebsiteAnswered(session)) {
    return { phase: "website", note: "Collect website URL or confirm none before assessment" };
  }

  if (session.reviewChannel === "website" && session.websiteStatus === "provided" && !session.pageConfirmed) {
    // Website-only path can assess without Facebook Page confirm.
    if (!session.pageSnapshotShown || !session.assessmentDelivered) {
      return { phase: "public_preview", note: "Review public website and explain fit" };
    }
  }

  if (reviewIncludesFacebook(session) && !hasVerifiedPage(session)) {
    return { phase: "page_confirm", pageName: session.pageName };
  }

  if (!session.pageSnapshotShown || !session.assessmentDelivered) {
    return { phase: "public_preview" };
  }

  if (!canOfferQuotation(session, messageText) && !session.quotationOffered) {
    return { phase: "value_review", pageName: session.pageName };
  }
  const missingQuoteFields = getMissingQuotationFields(session);
  if (missingQuoteFields.length) {
    return { phase: "quotation_details", field: missingQuoteFields[0] };
  }
  if (!session.quotationOffered) return { phase: "quotation_offer" };
  if (!hasEmail(session)) return { phase: "email_collect" };
  if (!session.quotationEmailConfirmed) {
    return { phase: "quotation_email_confirm", email: getSessionEmail(session) };
  }
  return { phase: "complete" };
}

function formatSnapshotSummaryForContext(snapshot) {
  if (!snapshot) return null;
  const parts = [];
  if (snapshot.facebook?.name) {
    parts.push(`Facebook Page: ${snapshot.facebook.name}${snapshot.facebook.url ? ` (${snapshot.facebook.url})` : ""}`);
  }
  if (snapshot.website?.url) {
    parts.push(`Website: ${snapshot.website.url}${snapshot.website.title ? ` — ${snapshot.website.title}` : ""}`);
  }
  if (snapshot.facebookError) parts.push(`Facebook lookup note: ${snapshot.facebookError}`);
  if (snapshot.websiteError) parts.push(`Website lookup note: ${snapshot.websiteError}`);
  return parts.length ? parts.join("\n") : null;
}

const AISTAFF_ACTION_TYPES = [
  "confirm_page",
  "reject_page",
  "set_page_name",
  "send_page_images",
  "set_website",
  "set_review_channel",
  "grant_review_permission",
  "reset_page_flow",
  "capture_lead",
  "check_facebook_page",
  "check_website",
  "assess_ai_fit",
  "run_public_preview",
  "make_quotation_draft",
  "offer_quotation",
  "confirm_quotation_email",
  "set_business_context",
  "set_organization_profile"
];

function buildAistaffSessionContext(session, messageText, backend = {}) {
  const signals = buildConversationSignals(session, messageText);
  const inConfirmFlow = (session.awaitingPageConfirm || signals.assistantRecentlyAskedPageConfirm) && !session.pageConfirmed;
  const candidates = inConfirmFlow ? [] : activePageCandidates(session);
  return {
    lead: {
      customerName: session.customerName || null,
      companyName: session.companyName || null,
      phone: session.phone || null,
      email: getSessionEmail(session) || null
    },
    page: {
      name: session.pageName || null,
      url: session.pageUrl || null,
      confirmed: session.pageConfirmed,
      lookupConfidence: session.pageLookupConfidence || null,
      awaitingConfirm: session.awaitingPageConfirm,
      suggestedNext: (() => {
        const next = getNextPageCandidate(session);
        return next ? { name: next.name || next.slug, slug: next.slug, url: next.url || null } : null;
      })(),
      researcherPoolSize: candidates.length
    },
    website: {
      url: session.websiteUrl || null,
      status: session.websiteStatus
    },
    review: {
      channel: session.reviewChannel || null,
      permissionGranted: session.reviewPermissionGranted,
      awaitingPermission: session.awaitingReviewPermission,
      pageTargetExplicit: hasExplicitPageTarget(session)
    },
    flow: {
      nextStep: getQualificationNextStep(session),
      quotationOffered: session.quotationOffered,
      quotationEmailConfirmed: session.quotationEmailConfirmed,
      pageSnapshotShown: session.pageSnapshotShown,
      awaitingPagePick: false,
      awaitingPageConfirm: Boolean(session.awaitingPageConfirm && !session.pageConfirmed)
    },
    infrastructure: {
      lookupFailed: Boolean(backend.lookupFailed),
      previewReady: Boolean(backend.previewReady),
      publicPreviewSummary: backend.publicPreviewSummary || null
    },
    businessContext: {
      businessType: session.businessType || null,
      inquiryTopics: session.inquiryTopics || null,
      weeklyInquiries: session.weeklyInquiries || null
    },
    conversation: buildConversationSignals(session, messageText),
    customerMessage: messageText,
    languageHint: isTagalogText(messageText) ? "tagalog" : "english"
  };
}

function buildAistaffActionsGuide() {
  return [
    "YOU call tools; backend executes and returns JSON. Call every tool needed this turn before writing your reply.",
    "- capture_lead: save name, company, phone, email, or address from conversation",
    "- set_review_channel: channel = facebook | website | both",
    "- set_page_name: save Page name and/or url the customer gave (never company or contact name)",
    "- set_website: url or status=none",
    "- grant_review_permission: customer agreed to public Page/website preview",
    "- reset_page_flow: clear wrong Page lookup after customer correction",
    "- check_facebook_page: lookup public Page (requires permission + explicit target)",
    "- send_page_images: send ONE Page screenshot in Messenger",
    "- confirm_page: customer said yes to YOUR Page image question only",
    "- reject_page: wrong Page — queues next match or ask for URL",
    "- set_organization_profile / set_business_context / check_website / assess_ai_fit / make_quotation_draft / confirm_quotation_email"
  ].join("\n");
}

function isOffTopicSmallTalk(messageText, session) {
  const text = String(messageText || "").trim();
  if (!text || text.length < 4) return false;
  if (isGreetingOrNoise(text) || isAffirmative(text) || isNegative(text)) return false;
  if (wantsPublicPreview(text)) return false;
  if (/@|https?:\/\/|facebook\.com/i.test(text)) return false;
  if (OFF_TOPIC_PATTERNS.some((pattern) => pattern.test(text))) return true;

  const onTopic = /\b(ai|aistaff|messenger|facebook|fb|page|website|quotation|quote|price|package|inquiry|lead|chat assistant|ministry|business|company|email|mobile|phone)\b/i.test(text);
  if (isCustomerQuestion(text) && onTopic) return false;
  if (onTopic) return false;

  return text.length >= 30 && !onTopic;
}

function buildQualificationProgress(session) {
  const steps = [
    { done: hasLeadProfile(session), label: "Lead details (name, company, mobile, email)" },
    { done: hasReviewChannel(session), label: "Review channel chosen (Facebook Page / website / both)" },
    { done: session.reviewPermissionGranted, label: "Permission to review public Page/site" },
    { done: hasVerifiedPage(session) || (session.reviewChannel === "website" && hasWebsiteAnswered(session)), label: "Business presence confirmed or website captured" },
    { done: hasWebsiteAnswered(session), label: "Website URL recorded or none" },
    { done: session.assessmentDelivered, label: "Public Page review + fit assessment shared" },
    { done: session.explicitQuoteInterest || session.quotationOffered, label: "Customer ready for quotation discussion" },
    { done: session.quotationOffered, label: "Quotation draft created" },
    { done: session.quotationEmailConfirmed, label: "Email quotation send confirmed" }
  ];
  return steps.map((step) => `${step.done ? "[x]" : "[ ]"} ${step.label}`).join("\n");
}

function buildValueConsultantBlock(session) {
  const snap = session.pageSnapshot;
  const profile = session.organizationProfile;
  if (!snap && !hasOrganizationProfile(profile)) return "";
  const pageName = snap?.facebook?.name || session.pageName || "your Page";
  const desc = snap?.facebook?.description || "";
  const lines = [
    "Value-review talking points (personalize for THIS customer only — warm consultant tone, no pricing yet):",
    `- Show you studied ${pageName}${desc ? `: ${desc.slice(0, 160)}` : ""}.`
  ];
  if (hasOrganizationProfile(profile)) {
    if (profile.industryOrFocus) lines.push(`- Their focus: ${profile.industryOrFocus}.`);
    if (profile.typicalInquiries?.length) {
      lines.push(`- Their typical Messenger inquiries: ${profile.typicalInquiries.join("; ")}.`);
    }
    if (profile.painPoints?.length) {
      lines.push(`- Their pain points: ${profile.painPoints.join("; ")}.`);
    }
    if (profile.personalizedBenefits?.length) {
      lines.push(`- How AIStaff helps them specifically: ${profile.personalizedBenefits.join("; ")}.`);
    }
  } else {
    lines.push("- Call set_organization_profile after Page/website review with THIS org's operations, inquiries, pain points, and benefits — then assess_ai_fit.");
  }
  lines.push("- YOU write the assessment from pageFacts + organizationProfile — conversational, fresh wording each time; see assessment principles in system prompt.");
  lines.push("- Never reuse language from another company's conversation.");
  lines.push("- End with one question about fit or exploring setup — not price.");
  return lines.join("\n");
}

function buildLeadCaptureGoalInstruction(fieldKey, options = {}) {
  const meta = LEAD_FIELD_META[fieldKey] || {};
  const lines = [
    `Warmly ask for "${fieldKey}" only.`,
    `Explain WHY: ${meta.reasonEn || "we need this to communicate clearly"}.`,
    `Include a brief privacy reassurance: ${AISTAFF_PRIVACY_NOTE_EN}`,
    "Do NOT robotically list phone, email, and address in one message — one field, one reason, one question.",
    `If they just provided "${fieldKey}", call capture_lead and thank them naturally before moving on.`
  ];
  if (fieldKey === "address" || options.quotation) {
    lines.push("This detail is needed for the formal quotation PDF addressed to their company.");
  } else {
    lines.push("Do NOT ask for business address yet — only when preparing a formal quotation.");
  }
  return lines.join(" ");
}

function buildAistaffGoalInstruction(session, messageText = "") {
  const step = getQualificationNextStep(session, messageText);
  const byPhase = {
    lead_capture: buildLeadCaptureGoalInstruction(step.field),
    review_channel_choice: "Lead basics are done. Explain that to show how AIStaff fits, you will review their PUBLIC Facebook Page and/or website. Ask which they prefer first: Facebook Page, website, or both. Do NOT lookup anything yet.",
    page_target_collect: "Ask for their business Facebook Page name or URL explicitly. Company name alone is NOT enough. Do NOT call check_facebook_page until they give the Page target AND grant permission.",
    website_target_collect: "Ask for their website URL, or if they have no website say none. Do NOT call check_website until permission is granted.",
    review_permission: `Ask permission to review their public ${step.channel === "both" ? "Facebook Page and website" : step.channel === "website" ? "website" : "Facebook Page"} preview. Explain: public info only, no inbox access. Wait for clear yes before any check_* tool.`,
    page_lookup: `Permission granted. Look up the Facebook Page they named ("${session.pageName || session.pageUrl || "ask again"}") — NOT company name, NOT contact person name. Call check_facebook_page + send_page_images, then ask Is this your business Facebook Page?`,
    page_lookup_failed: `Apologize gently — Page "${step.pageName}" not found. Ask for direct URL or screenshot.`,
    page_confirm: `Page "${step.pageName || "shown"}" image should be sent — warmly ask "Is this your business Facebook Page?" On clear yes to THAT question: confirm_page. On no: reject_page. If customer says "let's continue" / "hi" / "where were we", do NOT confirm — briefly recap where you left off and repeat the Page question or continue the current step.`,
    website: "After permission, call set_website then check_website if URL provided, or set status none. Then explain what you learned.",
    public_preview: "Call set_organization_profile with THIS org's specifics, then assess_ai_fit. YOU write a conversational review (what the Page is about, how they operate, fit, benefit bridge) from tool facts — never paste templates. NO prices.",
    value_review: "Write conversationally from pageFacts and organizationProfile: explain their operations and how AIStaff helps in their context. Spaced numbered benefits when discussing life easier. NO prices.",
    quotation_offer: "Customer asked about pricing or agreed to explore — collect any missing quotation details (including business address for the formal PDF) with a clear reason, then share Basic package pricing and call make_quotation_draft.",
    quotation_details: buildLeadCaptureGoalInstruction(step.field, { quotation: true }),
    email_collect: "Warmly ask email for quotation delivery.",
    quotation_email_confirm: `Confirm emailing quotation to ${step.email || "their email"}.`,
    complete: "Answer brief AIStaff questions warmly; do not restart qualification unless they change Page."
  };
  return byPhase[step.phase] || byPhase.lead_capture;
}

function buildWarmGoalPivot(session, messageText, isTagalog = false) {
  const step = getQualificationNextStep(session, messageText);
  if (step.phase === "page_confirm" || step.phase === "page_lookup") {
    return isTagalog
      ? "Sige po — tutulungan ko kayong ma-confirm muna ang tamang Facebook Page."
      : "Of course — let me help you confirm the right Facebook Page first.";
  }
  if (step.phase === "public_preview" || step.phase === "value_review") {
    return isTagalog
      ? "Salamat po sa pag-share — pag-usapan muna natin ang public Page ninyo at kung paano makakatulong ang AIStaff."
      : "Thanks for sharing — let me focus on your Page review and how AIStaff can help first.";
  }
  return isTagalog
    ? "Salamat po — unahin natin ang tamang susunod na hakbang para sa inyo."
    : "Thanks — let me guide you through the right next step first.";
}

function isStructuredAssessmentReply(text) {
  return /\bbased on my review of your Facebook Page\b/i.test(text)
    || /\bhere'?s how AIStaff can make your life easier\b/i.test(text)
    || /\bAIStaff is a (?:strong|good|promising) fit\b/i.test(text)
    || /\bWHAT WE FOUND\b/i.test(text)
    || /\bHOW AISTAFF MAKES YOUR LIFE EASIER\b/i.test(text);
}

function steerReplyTowardGoal(reply, session, messageText, options = {}) {
  let text = stripEarlySalesPush(String(reply || "").trim(), session, messageText, options);
  text = text.replace(/\b(?:could you|may i get)\s+(?:if you|may i)[^.?!]*/gi, "").replace(/\s{2,}/g, " ").trim();
  text = stripFalseEmailClaims(text, session);
  const policy = getReplyLengthPolicy(session, messageText, options);
  const questionized = policy.singleQuestion ? enforceSingleQuestion(text) : text;
  return enforceShortReply(questionized, policy.maxLen);
}

function stripFalseEmailClaims(text, session) {
  if (session.lastEmailSendOk) return String(text || "").trim();
  return String(text || "")
    .replace(/\b(?:i(?:'ve| have)?|we(?:'ve| have)?)\s+(?:just\s+)?(?:emailed|sent(?: the)?\s+(?:quotation|quote)[^,.?!]*(?:email)?)[^.?!]*/gi, "")
    .replace(/\b(?:resent|re-sent)\s+the\s+quotation\s+email[^.?!]*/gi, "")
    .trim();
}

function stripEarlySalesPush(reply, session, messageText = "", options = {}) {
  const text = String(reply || "").trim();
  if (
    options.allowMultipleSections
    || options.contentType === "assessment"
    || isStructuredAssessmentReply(text)
  ) {
    return text;
  }
  if (canMentionPricing(session, messageText)) return stripNumberedPageOptions(text);
  let cleaned = text;
  cleaned = cleaned
    .replace(/i can'?t send screenshots?[^.?!]*/gi, "I'm sending your Page preview image here in Messenger now")
    .replace(/i can'?t (?:send|share|provide) (?:screenshots?|images?)[^.?!]*/gi, "I'm sending your Page preview image here in Messenger now")
    .replace(/₱[\d,]+(?:\s*setup)?[^.?!]*/gi, "")
    .replace(/PHP\s*[\d,]+[^.?!]*/gi, "")
    .replace(/\b\d{1,3},?\d{3}\s*(?:\/month|per month)[^.?!]*/gi, "")
    .replace(/\b(prepare|offer|send)(?: me)?(?: the)? quotation(?: draft)?[^.?!]*/gi, "")
    .replace(/\bBasic AI Inbox Sales Assistant package[^.?!]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return stripNumberedPageOptions(cleaned);
}

function stripNumberedPageOptions(text) {
  return String(text || "")
    .replace(/(?:pick|reply|choose|select|type)\s+(?:option\s+)?(?:1|one)(?:\s*,\s*(?:2|two))?(?:\s*(?:or|o)\s*(?:3|three))?[^.?!]*/gi, "")
    .replace(/option\s+[123][^.?!]*/gi, "")
    .replace(/^\s*\d+\.\s+.+(?:\n\s*\d+\.\s+.+)+/gm, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildAistaffToolContextBlock(session, backend = {}, messageText = "") {
  const signals = buildConversationSignals(session, "");
  const inConfirmFlow = (session.awaitingPageConfirm || signals.assistantRecentlyAskedPageConfirm) && !session.pageConfirmed;
  const candidates = inConfirmFlow ? [] : activePageCandidates(session);
  return JSON.stringify({
    lead: {
      customerName: session.customerName || null,
      companyName: session.companyName || null,
      phone: session.phone || null,
      email: getSessionEmail(session) || null
    },
    page: {
      name: session.pageName || null,
      url: session.pageUrl || null,
      confirmed: session.pageConfirmed,
      awaitingConfirm: session.awaitingPageConfirm,
      suggestedNext: (() => {
        const next = getNextPageCandidate(session);
        return next ? { name: next.name || next.slug, slug: next.slug } : null;
      })(),
      researcherPoolSize: candidates.length
    },
    website: { url: session.websiteUrl || null, status: session.websiteStatus },
    review: {
      channel: session.reviewChannel || null,
      permissionGranted: session.reviewPermissionGranted,
      pageTargetExplicit: hasExplicitPageTarget(session)
    },
    preview: backend.publicPreviewSummary || null,
    nextStep: getQualificationNextStep(session, messageText).phase,
    assessmentDelivered: session.assessmentDelivered,
    mayMentionPricing: canMentionPricing(session, messageText),
    rejectedPageSlugs: session.rejectedPageSlugs || [],
    lastSentPageSlug: session.lastSentPageSlug || null,
    pageCheckInProgress: Boolean(session.pageCheckInProgress),
    imagesQueued: Boolean(session.pendingMessengerImages?.length)
  });
}

function buildAistaffSystemPrompt(session, backend = {}, messageText = "", aiConfig = {}) {
  const { formatKnowledgeBaseForPrompt, DEFAULT_AI_GOAL } = require("./aistaff-ai-config");
  const droppedMessages = Math.max(0, session.messages.length - AISTAFF_OPENAI_CHAT_LIMIT);
  const showPricing = canMentionPricing(session, messageText);
  const state = buildOrchestratorSessionState(session, messageText);
  return [
    "You are AIStaff.click on Facebook Messenger. YOU run this conversation end-to-end.",
    "Each turn: read the full chat → call tools to capture facts and execute actions → write your natural reply.",
    "Session state only changes when you call a tool. The SESSION STATE JSON is authoritative.",
    "Tone: warm consultant — patient, never pushy. PUBLIC Page/website only; no inbox access.",
    "",
    aiConfig.aiGoal || DEFAULT_AI_GOAL,
    "",
    buildAistaffActionsGuide(),
    "",
    buildMessengerFormattingGuide(),
    "",
    "ORGANIZATION PROFILE (this conversation only — never bleed to other customers):",
    "- After check_facebook_page / check_website, analyze how THIS organization operates and what Messenger inquiries they likely get.",
    "- Call set_organization_profile with industryOrFocus, operationsSummary, typicalInquiries[], painPoints[], personalizedBenefits[], messengerUseCase.",
    "- Example: a ministry may store seekers/joiners; a supplier stores quotation requests — only if their public presence supports it.",
    "- Then call assess_ai_fit — use returned pageFacts to write a personalized conversational reply.",
    "- If organizationProfile is empty, use generic assessment bullets until you analyze and save their profile.",
    "",
    "Workflow (you decide timing and wording):",
    "1) capture_lead — name, company, mobile, email (explain why + privacy; skip address until quotation)",
    "2) set_review_channel when they want Facebook Page / website / both",
    "3) set_page_name / set_website for explicit targets — NEVER use company or contact name as Page lookup",
    "4) Ask permission once, then grant_review_permission when they agree",
    "5) check_facebook_page → send_page_images → ask Is this your business Page? → confirm_page or reject_page",
    "6) assess_ai_fit when ready — use returned pageFacts; YOU write the Messenger reply (review paragraph + spaced benefits when appropriate). Never copy canned examples.",
    "",
    state.review.permissionGranted
      ? "IMPORTANT: Permission already granted — do NOT ask for permission again. Proceed with lookup/review tools."
      : "Permission not granted yet — ask once naturally, then call grant_review_permission when they agree.",
    state.facebookPage.confirmed
      ? `Facebook Page confirmed: ${state.facebookPage.targetName || state.facebookPage.targetUrl}.`
      : "",
    (session.rejectedPageSlugs || []).length
      ? `Rejected Page slugs (never re-send): ${session.rejectedPageSlugs.join(", ")}`
      : "",
    backend.publicPreviewSummary ? `Latest preview:\n${backend.publicPreviewSummary}` : "",
    state.progress.assessmentDelivered && session.pageSnapshot ? buildValueConsultantBlock(session) : "",
    "",
    "Hard rules:",
    "- NEVER confirm_page on 'continue', 'hi', or generic yes unrelated to the Page image question",
    "- NEVER use contact person name as Facebook Page search target",
    "- NEVER claim email was sent unless confirm_quotation_email returns emailed:true",
    "- NEVER say you cannot send screenshots — call send_page_images",
    `- Privacy note to weave in: ${AISTAFF_PRIVACY_NOTE_EN}`,
    aiConfig.customInstructions ? `\nAdmin instructions:\n${aiConfig.customInstructions}` : "",
    formatKnowledgeBaseForPrompt(aiConfig.knowledgeBase || []) || "",
    droppedMessages > 0 ? `${droppedMessages} older messages omitted — use SESSION STATE.` : "",
    "",
    `Official service: ${OFFICIAL_SERVICE_PROMISE}`,
    showPricing
      ? `Pricing (share only now): ${MINIMUM_OFFER.name} — ${MINIMUM_OFFER.price}. Packages:\n${formatOfficialPackagesBlock()}`
      : "Pricing: withhold until after assess_ai_fit unless customer explicitly asks.",
    "",
    "SESSION STATE (update via tools):",
    JSON.stringify(state, null, 2),
    "",
    "Infrastructure:",
    JSON.stringify({
      lookupFailed: Boolean(backend.lookupFailed),
      previewReady: Boolean(backend.previewReady),
      imagesQueued: Boolean(session.pendingMessengerImages?.length),
      pdfQueued: Boolean(session.pendingMessengerPdf?.url)
    })
  ].filter(Boolean).join("\n");
}

function buildAistaffChatMessages(session, messageText = "") {
  const messages = session.messages.slice(-AISTAFF_OPENAI_CHAT_LIMIT).map((message) => ({
    role: message.role === "customer" ? "user" : "assistant",
    content: message.text
  }));
  const last = session.messages[session.messages.length - 1];
  if (isSyntheticAistaffMessage(messageText)) {
    messages.push({ role: "user", content: "I selected my Page from the options you showed." });
  } else if (messageText && (!last || last.text !== messageText || last.role !== "customer")) {
    messages.push({ role: "user", content: messageText });
  }
  return messages;
}

function buildAistaffTools() {
  const optionalString = { type: "string" };
  const tool = (name, description, properties = {}) => ({
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        additionalProperties: false
      }
    }
  });

  return [
    tool("set_review_channel", "Record whether customer wants Facebook Page, website, or both reviewed", {
      channel: { type: "string", enum: ["facebook", "website", "both"] }
    }),
    tool("grant_review_permission", "Customer gave clear consent to review their public Facebook Page and/or website", {}),
    tool("reset_page_flow", "Clear wrong Page lookup, confirmations, and candidate pool after customer correction", {}),
    tool("confirm_page", "Customer confirmed this is their Facebook Page (yes, that's it, correct, etc.)", { slug: optionalString }),
    tool("reject_page", "Customer said this is NOT their Page — blacklists slug and queues the next researcher match", { slug: optionalString }),
    tool("send_page_images", "Send ONE Page screenshot in Messenger; omit slug for best next researcher match (skips rejected)", { slug: optionalString, name: optionalString }),
    tool("set_page_name", "Set Facebook Page name and/or URL from the customer (never company or contact name)", {
      name: optionalString,
      url: optionalString
    }),
    tool("set_website", "Save website URL or record no website", { url: optionalString, status: optionalString }),
    tool("capture_lead", "Save a lead field from the conversation", {
      field: { type: "string", enum: ["customerName", "companyName", "phone", "email", "address"] },
      value: { type: "string" }
    }),
    tool("check_facebook_page", "Check/review the customer's public Facebook Page (name, description, audience)", {
      name: optionalString,
      url: optionalString
    }),
    tool("check_website", "Crawl and summarize the customer's public website (services, contact signals)", { url: optionalString }),
    tool("assess_ai_fit", "Run public Page + website assessment; returns pageFacts and fit data for YOU to write a conversational Messenger reply (do not paste templates)", {}),
    tool("run_public_preview", "Alias for assess_ai_fit — full public presence check", {}),
    tool("make_quotation_draft", "ONLY after public review AND customer asked for price/quote — create quotation draft in admin", {}),
    tool("set_organization_profile", "Save THIS customer's organization analysis (isolated to this chat). personalizedBenefits must be 'Short title: full explanation sentence' per item.", {
      industryOrFocus: optionalString,
      operationsSummary: optionalString,
      messengerUseCase: optionalString,
      typicalInquiries: { type: "array", items: { type: "string" } },
      painPoints: { type: "array", items: { type: "string" } },
      personalizedBenefits: { type: "array", items: { type: "string" } }
    }),
    tool("set_business_context", "Legacy shorthand — prefer set_organization_profile. Maps businessType and inquiryTopics.", {
      businessType: optionalString,
      inquiryTopics: optionalString,
      sendsQuotations: optionalString
    }),
    tool("offer_quotation", `Present the ${MINIMUM_OFFER.name} quotation`, {}),
    tool("confirm_quotation_email", "Customer agreed to email the quotation", {})
  ];
}

function toolCallToAction(toolCall) {
  const args = JSON.parse(toolCall.function?.arguments || "{}");
  return { type: toolCall.function.name, ...args };
}

async function summarizeAistaffToolResult(session, action, actionResults, toolResult) {
  if (toolResult) return toolResult;
  if (action.type === "grant_review_permission") {
    return { ok: true, reviewPermissionGranted: true };
  }
  if (action.type === "set_review_channel") {
    return { ok: true, reviewChannel: session.reviewChannel };
  }
  if (action.type === "reset_page_flow") {
    return { ok: true, pageName: session.pageName, pageUrl: session.pageUrl };
  }
  if (action.type === "set_organization_profile") {
    return { ok: true, organizationProfile: organizationProfileForContext(session) };
  }
  if (action.type === "capture_lead") {
    return {
      ok: true,
      lead: {
        customerName: session.customerName || null,
        companyName: session.companyName || null,
        phone: session.phone || null,
        email: getSessionEmail(session) || null,
        address: session.address || null
      }
    };
  }
  if (action.type === "set_page_name") {
    return {
      ok: true,
      pageName: session.pageName,
      pageUrl: session.pageUrl || null,
      pageNameSource: session.pageNameSource
    };
  }
  if (action.type === "set_website") {
    return { ok: true, websiteUrl: session.websiteUrl || null, websiteStatus: session.websiteStatus };
  }
  if (action.type === "check_facebook_page") {
    const ranked = activePageCandidates(session);
    return {
      ok: true,
      pageName: session.pageName,
      candidates: ranked.slice(0, 3).map((c) => ({ name: c.name, slug: c.slug })),
      ...(formatPageResearchForToolResult(session, ranked) || {})
    };
  }
  if (action.type === "run_public_preview" || action.type === "assess_ai_fit") {
    const pageFacts = session.pageSnapshot
      ? buildAssessmentFactsPayload(session.pageSnapshot, session)
      : null;
    return {
      ok: true,
      preview: formatSnapshotSummaryForContext(session.pageSnapshot) || "Preview updated",
      pageFacts,
      assessment: session.pageSnapshot?.assessment || null,
      organizationProfile: organizationProfileForContext(session),
      instruction: buildAssessmentToolInstruction({
        hasProfile: hasOrganizationProfile(session.organizationProfile)
      })
    };
  }
  if (action.type === "send_page_images") {
    return {
      ok: !actionResults.imageLoadFailed,
      imagesQueued: Boolean(actionResults.showPageImages),
      label: actionResults.imageLabel || session.pageName
    };
  }
  if (action.type === "confirm_page") {
    return { ok: true, pageConfirmed: session.pageConfirmed, pageName: session.pageName };
  }
  return { ok: true, executed: action.type };
}

function normalizeAistaffActions(session, actions) {
  return Array.isArray(actions) ? actions : [];
}

function findPageCandidate(session, { slug, index } = {}) {
  const candidates = activePageCandidates(session);
  if (slug) {
    return candidates.find((candidate) => candidate.slug === slug)
      || session.pageCandidates?.find((candidate) => candidate.slug === slug)
      || null;
  }
  if (index && Number(index) > 0) {
    return candidates[Number(index) - 1] || null;
  }
  return null;
}

function isRejectedPageSlug(session, slug) {
  const key = String(slug || "").toLowerCase();
  return (session.rejectedPageSlugs || []).some((item) => String(item || "").toLowerCase() === key);
}

async function enrichPageCandidates(session, requestedName) {
  const name = normalizePageNameForLookup(requestedName || session.pageName);
  if (!name) return [];
  const search = await searchFacebookPagesByName(name);
  const ranked = pickBestPageCandidates(search.candidates, name, session.rejectedPageSlugs, { customerName: session.customerName });
  if (ranked.length) {
    session.pageCandidates = ranked;
    session.lastShownCandidates = [...ranked];
    session.awaitingPagePick = false;
    if (!session.pageName) session.pageName = name;
  }
  return ranked;
}

function formatPageResearchForToolResult(session, ranked = []) {
  const next = getNextPageCandidate(session);
  const remaining = (ranked || activePageCandidates(session)).filter(
    (candidate) => candidate.slug && !isRejectedPageSlug(session, candidate.slug)
  ).length;
  return {
    suggestedNext: next
      ? { name: next.name || next.slug, slug: next.slug, url: next.url || null }
      : null,
    remainingCount: remaining,
    rejectedSlugs: session.rejectedPageSlugs || []
  };
}

async function queueSinglePageImage(session, candidate, isTagalog, results) {
  if (!candidate?.imageUrl) return null;
  queuePageImages(session, [candidate], isTagalog);
  applyScreenshotPageSelection(session, candidate);
  session.lastSentPageSlug = candidate.slug;
  results.showPageImages = true;
  results.imageLabel = candidate.name || candidate.slug;
  return {
    ok: true,
    imagesQueued: true,
    pageName: candidate.name || candidate.slug,
    slug: candidate.slug,
    awaitingConfirm: true
  };
}

function validateAistaffToolAction(session, action, messageText = "") {
  const type = action.type;
  const slug = action.slug || findPageCandidate(session, action)?.slug || "";

  if (type === "send_page_images" && slug && isRejectedPageSlug(session, slug)) {
    return {
      ok: false,
      blocked: true,
      error: `Slug "${slug}" was rejected by the customer. Use reject_page, then pick a different candidate.`,
      rejectedSlugs: session.rejectedPageSlugs || []
    };
  }

  if (type === "check_facebook_page" || type === "send_page_images") {
    if (!session.reviewPermissionGranted) {
      return {
        ok: false,
        blocked: true,
        error: "Call grant_review_permission after the customer agrees before check_facebook_page or send_page_images."
      };
    }
    if (!reviewIncludesFacebook(session)) {
      return {
        ok: false,
        blocked: true,
        error: "Customer chose website-only review — do not check Facebook Page."
      };
    }
    if (!hasExplicitPageTarget(session)) {
      return {
        ok: false,
        blocked: true,
        error: "Call set_page_name with the customer's Page name or URL before check_facebook_page."
      };
    }
    const targetUrl = session.pageUrl || action.url || "";
    if (isPersonalFacebookProfileUrl(targetUrl)) {
      return {
        ok: false,
        blocked: true,
        error: "Page URL looks like a personal profile. Ask for the business Page URL or name."
      };
    }
  }

  if (type === "check_website") {
    if (!session.reviewPermissionGranted) {
      return {
        ok: false,
        blocked: true,
        error: "Ask permission to review their public website and wait for clear yes before check_website."
      };
    }
    if (!reviewIncludesWebsite(session)) {
      return {
        ok: false,
        blocked: true,
        error: "Customer did not choose website review."
      };
    }
  }

  if (type === "confirm_page") {
    if (!isPageConfirmationPending(session)) {
      return {
        ok: false,
        blocked: true,
        error: "No Page confirmation is pending. Do not call confirm_page."
      };
    }
    if (!isPageConfirmationAnswer(messageText, session)) {
      return {
        ok: false,
        blocked: true,
        error: `"${String(messageText || "").trim()}" is not a Page confirmation. Only call confirm_page when the customer clearly says yes/that's it/correct Page to your "Is this your business Facebook Page?" question — not for "continue", greetings, or unrelated yes.`
      };
    }
  }

  if (type === "assess_ai_fit" || type === "run_public_preview") {
    if (!session.reviewPermissionGranted) {
      return {
        ok: false,
        blocked: true,
        error: "Ask permission before running public preview assessment."
      };
    }
    if (session.reviewChannel === "website") {
      if (!hasWebsiteAnswered(session)) {
        return { ok: false, blocked: true, error: "Call set_website (url or status none) before assess_ai_fit." };
      }
    } else if (reviewIncludesFacebook(session)) {
      if (!session.pageConfirmed && !session.pageUrl) {
        return { ok: false, blocked: true, error: "Call confirm_page after the customer confirms their Page before assess_ai_fit." };
      }
      if (reviewIncludesWebsite(session) && !hasWebsiteAnswered(session)) {
        return { ok: false, blocked: true, error: "Call set_website (url or status none) before assess_ai_fit." };
      }
    }
  }

  if ((type === "make_quotation_draft" || type === "offer_quotation") && !canOfferQuotation(session, messageText)) {
    return {
      ok: false,
      blocked: true,
      error: "Complete Page confirm + assess_ai_fit first; share pricing only when customer asks for quote."
    };
  }

  return null;
}

async function resolvePageImagesForAction(session, messageText, action = {}) {
  const fromAction = getNextPageCandidate(session, {
    slug: action.slug,
    index: action.index
  });
  if (fromAction?.imageUrl) return [fromAction];

  const resendSame = !action.slug
    && session.lastSentPageSlug
    && (wantsPageScreenshot(messageText) || isFetchScreenshotCommand(messageText, session));
  if (resendSame) {
    const same = activePageCandidates(session).find((candidate) => candidate.slug === session.lastSentPageSlug)
      || {
        slug: session.lastSentPageSlug,
        name: session.pageName,
        imageUrl: session.pageImageUrl,
        url: session.pageUrl
      };
    if (same?.imageUrl) return [same];
  }

  const hint = action.name
    || getExplicitPageLookupTarget(session)
    || extractPageHintFromMessage(messageText);
  if (!hint) return [];

  const ranked = await enrichPageCandidates(session, hint);
  const match = getNextPageCandidate(session, { slug: action.slug });
  return match?.imageUrl ? [match] : [];
}

async function executeAistaffActions(session, actions, messageText = "", runtime = {}) {
  const results = {
    showPageImages: false,
    showPagePicker: false,
    imageLoadFailed: false,
    imageLabel: null,
    pageLookupRefreshed: false,
    executed: []
  };
  const isTagalog = isTagalogText(messageText);
  const list = Array.isArray(actions) ? actions : [];
  let companyId = runtime.companyId || null;
  if (!companyId && runtime.psid) {
    try {
      companyId = await getDefaultCompanyId();
    } catch {
      companyId = null;
    }
  }

  for (const action of list) {
    const type = action.type;
    let toolResult = validateAistaffToolAction(session, action, messageText);
    if (toolResult?.blocked) {
      results.executed.push(type);
      results.lastToolResult = toolResult;
      continue;
    }

    toolResult = null;
    switch (type) {
      case "confirm_page": {
        const candidate = findPageCandidate(session, action)
          || activePageCandidates(session).find((item) => item.slug === session.lastSentPageSlug);
        if (candidate) {
          applyPageCandidatePick(session, candidate);
        } else {
          session.pageConfirmed = true;
          session.awaitingPageConfirm = false;
          session.awaitingPagePick = false;
          session.pageCandidates = [];
          session.lastShownCandidates = [];
          if (session.lastSentPageSlug && !session.pageUrl) {
            session.pageUrl = `https://www.facebook.com/${session.lastSentPageSlug}`;
          }
        }
        session.pageCheckInProgress = false;
        session.awaitingPageConfirm = false;
        toolResult = { ok: true, pageConfirmed: session.pageConfirmed, pageName: session.pageName };
        results.executed.push(type);
        break;
      }
      case "reject_page": {
        rememberRejectedPage(session, session.lastSentPageSlug);
        if (action.slug) rememberRejectedPage(session, action.slug);
        if (session.pageUrl) {
          rememberRejectedPage(session, session.pageUrl.match(/facebook\.com\/([^/?]+)/i)?.[1]);
        }
        session.pageConfirmed = false;
        session.awaitingPageConfirm = false;
        session.pagePickerShown = false;
        session.pageImageUrl = "";
        session.pageUrl = "";
        session.pageSnapshot = null;
        session.pageSnapshotKey = "";
        session.pageSnapshotShown = false;
        session.assessmentDelivered = false;
        if (session.pageName && session.pageNameSource === "customer") {
          await enrichPageCandidates(session, session.pageName);
        }
        const next = getNextPageCandidate(session);
        if (next) {
          toolResult = await queueSinglePageImage(session, next, isTagalog, results)
            || { ok: false, error: "Next candidate has no image." };
          toolResult = {
            ...toolResult,
            rejectedSlugs: session.rejectedPageSlugs || [],
            message: "Queued next researcher match. Ask if this is their Facebook Page."
          };
        } else {
          toolResult = {
            ok: true,
            rejectedSlugs: session.rejectedPageSlugs || [],
            message: "No more researcher matches. Ask for the direct Facebook Page URL or exact Page name."
          };
        }
        results.executed.push(type);
        break;
      }
      case "set_review_channel": {
        const channel = String(action.channel || "").toLowerCase();
        if (!["facebook", "website", "both"].includes(channel)) {
          toolResult = { ok: false, error: "channel must be facebook, website, or both" };
        } else {
          session.reviewChannel = channel;
          toolResult = { ok: true, reviewChannel: channel };
        }
        results.executed.push(type);
        break;
      }
      case "grant_review_permission": {
        session.reviewPermissionGranted = true;
        session.awaitingReviewPermission = false;
        toolResult = {
          ok: true,
          reviewPermissionGranted: true,
          message: "Permission saved. You may call check_facebook_page and/or check_website."
        };
        results.executed.push(type);
        break;
      }
      case "reset_page_flow": {
        resetPageFlowState(session, { keepPageName: action.keepPageName !== false });
        toolResult = {
          ok: true,
          message: "Page flow reset.",
          pageName: session.pageName || null,
          pageUrl: session.pageUrl || null
        };
        results.executed.push(type);
        break;
      }
      case "set_page_name": {
        if (action.url) {
          if (isPersonalFacebookProfileUrl(action.url)) {
            toolResult = {
              ok: false,
              error: "That URL looks like a personal profile, not a business Page."
            };
            results.executed.push(type);
            break;
          }
          session.pageUrl = normalizeUrl(action.url);
          session.pageNameSource = "customer";
          const slug = action.url.match(/facebook\.com\/([^/?&#]+)/i)?.[1];
          if (slug && !action.name) {
            setSessionPageName(session, decodeURIComponent(slug), { keepUrl: true, source: "customer" });
          }
        }
        if (action.name) {
          setSessionPageName(session, normalizePageNameForLookup(action.name), {
            keepUrl: Boolean(action.url),
            source: "customer"
          });
          results.pageLookupRefreshed = true;
        }
        toolResult = {
          ok: true,
          pageName: session.pageName || null,
          pageUrl: session.pageUrl || null,
          pageNameSource: session.pageNameSource
        };
        results.executed.push(type);
        break;
      }
      case "send_page_images": {
        const toShow = await resolvePageImagesForAction(session, messageText, action);
        if (toShow.length) {
          toolResult = await queueSinglePageImage(session, toShow[0], isTagalog, results)
            || { ok: false, error: "Could not queue Page image." };
        } else {
          results.imageLoadFailed = true;
          toolResult = { ok: false, error: "Could not load Page image. Call check_facebook_page or ask for Page URL." };
        }
        results.executed.push(type);
        break;
      }
      case "set_website": {
        if (action.status === "none") {
          session.websiteStatus = "none";
          session.websiteUrl = "";
        } else if (action.url) {
          session.websiteUrl = normalizeUrl(action.url);
          session.websiteStatus = "provided";
        }
        toolResult = {
          ok: true,
          websiteUrl: session.websiteUrl || null,
          websiteStatus: session.websiteStatus
        };
        results.executed.push(type);
        break;
      }
      case "capture_lead": {
        const field = action.field;
        const value = String(action.value || "").trim();
        if (field === "customerName" && value) session.customerName = value;
        if (field === "companyName" && value) {
          session.companyName = value;
          if (!session.businessType) session.businessType = value;
        }
        if (field === "phone" && value) session.phone = value;
        if (field === "email" && value) session.email = value;
        if (field === "address" && value) session.address = value;
        session.contact = [session.phone, session.email].filter(Boolean).join(" / ");
        toolResult = {
          ok: true,
          field,
          leadComplete: hasLeadProfile(session)
        };
        results.executed.push(type);
        break;
      }
      case "check_facebook_page": {
        if (action.url) {
          if (isPersonalFacebookProfileUrl(action.url)) {
            toolResult = { ok: false, blocked: true, error: "Personal profile URL — ask for business Page URL." };
            results.executed.push(type);
            break;
          }
          session.pageUrl = normalizeUrl(action.url);
          session.pageNameSource = "customer";
        }
        const lookupName = normalizePageNameForLookup(
          action.name || getExplicitPageLookupTarget(session)
        );
        if (lookupName && !pageNameMatchesCustomer(session, lookupName)) {
          setSessionPageName(session, lookupName, {
            keepUrl: Boolean(session.pageUrl),
            source: "customer"
          });
        }
        const effectiveName = getExplicitPageLookupTarget(session) || lookupName;
        if (!effectiveName) {
          toolResult = { ok: false, blocked: true, error: "Call set_page_name with Page name or URL first." };
          results.executed.push(type);
          break;
        }
        if (pageNameMatchesCustomer(session, effectiveName)) {
          toolResult = {
            ok: false,
            blocked: true,
            error: "Lookup target matches contact name, not business Page. Call set_page_name with the business Page."
          };
          results.executed.push(type);
          break;
        }
        toolResult = await checkFacebookPageTool(session, { ...action, name: effectiveName });
        const ranked = await enrichPageCandidates(session, effectiveName);
        if (toolResult) {
          Object.assign(toolResult, formatPageResearchForToolResult(session, ranked));
        }
        if (toolResult?.ok) results.pageLookupRefreshed = true;
        results.executed.push(type);
        break;
      }
      case "check_website": {
        toolResult = await checkWebsiteTool(session, action);
        results.executed.push(type);
        break;
      }
      case "assess_ai_fit":
      case "run_public_preview": {
        toolResult = await assessAiFitTool(session);
        session.assessmentDelivered = true;
        results.executed.push(type);
        break;
      }
      case "make_quotation_draft": {
        const missing = getMissingQuotationFields(session);
        if (missing.length) {
          toolResult = {
            ok: false,
            blocked: true,
            error: `Missing prospect fields before quotation: ${missing.join(", ")}`,
            missingFields: missing
          };
          results.executed.push(type);
          break;
        }
        toolResult = await makeQuotationDraftTool(session, {
          companyId,
          psid: runtime.psid,
          pageId: runtime.pageId
        });
        if (toolResult.ok) {
          session.quotationOffered = true;
          const pdf = await ensureQuotationPdfForSession(session);
          results.showQuotationPdf = true;
          toolResult.pdfUrl = pdf.url;
          toolResult.pdfQueued = true;
        }
        results.executed.push(type);
        break;
      }
      case "offer_quotation": {
        session.quotationOffered = true;
        const pdf = await ensureQuotationPdfForSession(session);
        results.showQuotationPdf = Boolean(pdf?.url);
        toolResult = { ok: true, pdfQueued: Boolean(pdf?.url), pdfUrl: pdf?.url || null };
        results.executed.push(type);
        break;
      }
      case "confirm_quotation_email": {
        await ensureQuotationPdfForSession(session);
        const emailResult = await sendQuotationEmail({
          to: getSessionEmail(session),
          subject: `AIStaff.click Quotation ${session.quotationNumber || ""}`.trim(),
          text: buildQuotationDetails(session),
          pdfPath: session.pendingQuotationPdfPath,
          quotationNumber: session.quotationNumber
        });
        if (emailResult.ok) {
          session.quotationEmailConfirmed = true;
          session.lastEmailSendOk = true;
          toolResult = { ok: true, emailed: true, messageId: emailResult.messageId };
        } else {
          session.lastEmailSendOk = false;
          results.showQuotationPdf = true;
          toolResult = {
            ok: true,
            emailed: false,
            error: emailResult.error,
            message: emailResult.message,
            pdfQueued: true,
            emailConfigured: isEmailConfigured(),
            instruction: "Tell customer email could not be delivered and the quotation PDF is attached here in Messenger instead."
          };
        }
        results.executed.push(type);
        break;
      }
      case "set_organization_profile": {
        applyOrganizationProfile(session, action);
        syncLegacyBusinessFieldsFromProfile(session);
        toolResult = {
          ok: true,
          organizationProfile: organizationProfileForContext(session),
          message: "Organization profile saved for this customer only. Call assess_ai_fit, then write their conversational assessment from pageFacts."
        };
        results.executed.push(type);
        break;
      }
      case "set_business_context": {
        if (action.businessType) session.businessType = action.businessType;
        if (action.inquiryTopics) session.inquiryTopics = action.inquiryTopics;
        if (action.sendsQuotations) session.sendsQuotations = action.sendsQuotations;
        applyOrganizationProfile(session, {
          industryOrFocus: action.businessType,
          typicalInquiries: action.inquiryTopics ? [action.inquiryTopics] : undefined
        });
        toolResult = { ok: true, organizationProfile: organizationProfileForContext(session) };
        results.executed.push(type);
        break;
      }
      default:
        break;
    }
    results.lastToolResult = toolResult || results.lastToolResult
      || await summarizeAistaffToolResult(session, action, results, toolResult);
  }

  return results;
}

async function prepareAistaffInfrastructure(session, messageText) {
  const snapshot = await maybeRefreshPageSnapshot(session);
  return {
    lookupFailed: facebookLookupFailed(session),
    publicPreviewSummary: formatSnapshotSummaryForContext(snapshot),
    previewReady: Boolean(snapshot?.ok || snapshot?.facebook || snapshot?.website)
  };
}

function sanitizeAistaffReplyLight(reply, session, context = {}) {
  let text = String(reply || "").trim();
  if (!text) return text;

  const forbiddenInbox = [
    /i['']?ll check (your )?(inbox|messenger inbox)/gi,
    /i will check (your )?(inbox|messenger inbox)/gi,
    /let me check (your )?(inbox|messenger inbox)/gi,
    /checking (your )?(inbox|messenger inbox) now/gi
  ];
  for (const pattern of forbiddenInbox) {
    text = text.replace(pattern, "I can review your public Facebook Page and website while we chat");
  }

  const previewDenial = [
    /sorry,? i can'?t (?:check|review)[^.?!]*/gi,
    /i can'?t (?:check|review) your (?:facebook|website|page)[^.?!]*/gi
  ];
  for (const pattern of previewDenial) {
    text = text.replace(pattern, "I can check your public Facebook Page and website");
  }

  for (const pattern of FORBIDDEN_PLAN_CLAIMS) {
    text = text.replace(pattern, "");
  }

  text = stripEarlySalesPush(text, session, context.customerMessage || "", context);

  if (!session.pageConfirmed) {
    text = text
      .replace(/\bi see you (?:have )?confirmed[^.?!]*/gi, "")
      .replace(/\byou(?:'ve| have) confirmed (?:your )?(?:facebook )?page[^.?!]*/gi, "")
      .replace(/\b(?:to proceed|moving on)[^.?!]*(?:website|site url)[^?]*\?/gi, "")
      .trim();
  }

  if (
    isPagePickFlowActive(session)
    || wantsPageScreenshot(context.customerMessage || "")
    || isFreshPageCheckInquiry(context.customerMessage || "", session)
    || session.pageCheckInProgress
  ) {
    text = text
      .replace(/\b(?:may i get|can you share|please share|could you please share).{0,160}(?:website|site url)[^?]*\?/gi, "")
      .replace(/\bif you have one[^?]*\?/gi, "")
      .trim();
  }

  text = stripFalseEmailClaims(text, session);
  const policy = getReplyLengthPolicy(session, context.customerMessage || "", context);
  if (policy.singleQuestion) {
    text = enforceSingleQuestion(text);
  }
  return enforceShortReply(text, policy.maxLen);
}

async function callAistaffOpenAI(messages, tools) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.45,
      max_tokens: 1200
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI error ${response.status} ${body}`);
  }

  return response.json();
}

async function generateAistaffOpenAIReply(session, messageText, backend = {}, runtime = {}) {
  const { loadAistaffAiConfig } = require("./aistaff-ai-config");
  const aiConfig = await loadAistaffAiConfig(runtime.companyId || null);
  const tools = buildAistaffTools();
  const collectedActions = [];
  let reply = "";
  let messages = [
    { role: "system", content: buildAistaffSystemPrompt(session, backend, messageText, aiConfig) },
    ...buildAistaffChatMessages(session, messageText)
  ];

  for (let round = 0; round < 8; round += 1) {
    const freshBackend = await prepareAistaffInfrastructure(session, messageText);
    messages[0] = { role: "system", content: buildAistaffSystemPrompt(session, freshBackend, messageText, aiConfig) };
    const json = await callAistaffOpenAI(messages, tools);
    const choice = json.choices?.[0]?.message;
    if (!choice) throw new Error("OpenAI returned no message");

    if (choice.content?.trim()) reply = choice.content.trim();

    if (!choice.tool_calls?.length) break;

    messages.push({
      role: "assistant",
      content: choice.content || "",
      tool_calls: choice.tool_calls
    });

    for (const toolCall of choice.tool_calls) {
      const action = toolCallToAction(toolCall);
      if (!AISTAFF_ACTION_TYPES.includes(action.type)) continue;
      collectedActions.push(action);
      const normalized = normalizeAistaffActions(session, [action]);
      const actionResults = await executeAistaffActions(session, normalized, messageText, runtime);
      if (actionResults.pageLookupRefreshed) {
        await maybeRefreshPageSnapshot(session);
      }
      const summary = actionResults.lastToolResult
        || await summarizeAistaffToolResult(session, action, actionResults);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(summary)
      });
    }
  }

  if (!reply) {
    const nudge = "Based on tool results and SESSION STATE, write your Messenger reply to the customer now (plain text).";
    const final = await callAistaffOpenAI([
      ...messages,
      { role: "user", content: nudge }
    ], []);
    reply = final.choices?.[0]?.message?.content?.trim() || "";
  }

  if (!reply) throw new Error("OpenAI returned empty reply");
  return { reply, actions: collectedActions, toolsExecuted: true };
}

function finalizeAistaffReply(reply, session, messageText, options = {}) {
  const isTagalog = isTagalogText(messageText);
  const sanitizeContext = {
    isTagalog,
    customerMessage: messageText,
    maxReplyLen: options.maxReplyLen,
    allowMultipleSections: options.allowMultipleSections
  };
  let cleaned = options.llmFirst
    ? sanitizeAistaffReplyLight(reply, session, sanitizeContext)
    : sanitizeAistaffReply(reply, session, sanitizeContext);
  if (options.llmFirst && !options.skipSteer) {
    cleaned = steerReplyTowardGoal(cleaned, session, messageText, {
      maxReplyLen: options.maxReplyLen,
      allowMultipleSections: options.allowMultipleSections
    });
  }
  const policy = getReplyLengthPolicy(session, messageText, options);
  const shouldSingleQuestion = policy.singleQuestion && !options.allowMultipleSections;
  let qualified = (options.llmFirst || options.skipQualificationAppend)
    ? enforceShortReply(
      shouldSingleQuestion ? enforceSingleQuestion(cleaned) : cleaned,
      policy.maxLen
    )
    : combineAnswerWithNextQuestion(cleaned, session, isTagalog, { customerMessage: messageText, skipQualificationAppend: options.skipQualificationAppend });

  const isAssessmentReply = options.contentType === "assessment" || isStructuredAssessmentReply(qualified);
  let messengerReply = qualified;
  if (isAssessmentReply) {
    if (session.pendingMessengerFollowUpTexts?.length) {
      messengerReply = qualified;
    } else {
      const parts = splitAssessmentMessengerParts(qualified);
      if (parts.length > 1) {
        session.pendingMessengerFollowUpTexts = parts.slice(1);
        messengerReply = parts[0];
      }
    }
  }

  updateAistaffSession(session, "assistant", qualified);
  return messengerReply;
}

async function generateAistaffOrchestratorReply(messageText, psid, session, runtime) {
  try {
    const infrastructure = await prepareAistaffInfrastructure(session, messageText);
    const { reply, actions } = await generateAistaffOpenAIReply(session, messageText, infrastructure, runtime);
    if (actions?.length) {
      console.log(`AIStaff tools for ${psid}:`, actions.map((action) => action.type).join(", "));
    }

    await maybeRefreshPageSnapshot(session);

    const ranAssessment = actions?.some((action) => action.type === "assess_ai_fit" || action.type === "run_public_preview");
    const ranPreviewCheck = actions?.some((action) => action.type === "check_facebook_page" || action.type === "check_website");
    const customerWantsAssessment = wantsStructuredAssessmentReply(messageText) || wantsAiFitAssessment(messageText);
    const isAssessment = ranAssessment
      || (customerWantsAssessment && session.pageSnapshot)
      || (wantsPublicPreview(messageText) && session.pageSnapshot && (ranPreviewCheck || session.assessmentDelivered));

    if (session.pageSnapshot && isAssessment && !session.pageSnapshot.assessment) {
      session.pageSnapshot.assessment = assessAiSalesFit(session.pageSnapshot);
      if (hasOrganizationProfile(session)) {
        session.pageSnapshot.assessment = personalizeAssessment(session.pageSnapshot.assessment, session);
      }
    }

    return finalizeAistaffReply(reply, session, messageText, {
      llmFirst: true,
      skipSteer: true,
      skipQualificationAppend: true,
      allowMultipleSections: true,
      contentType: isAssessment ? "assessment" : undefined,
      maxReplyLen: isAssessment ? 3200 : 2800
    });
  } catch (error) {
    console.error("AIStaff OpenAI reply failed:", error.message);
    return generateAistaffRuleBasedReply(messageText, psid, session);
  }
}

async function generateAistaffRuleBasedReply(messageText, psid, session) {
  let missingLead = getNextMissingLeadField(session);
  const inMidFlow = Boolean(
    session.awaitingPageConfirm
    || session.pageCheckInProgress
    || session.awaitingReviewPermission
    || (hasLeadProfile(session) && (
      !hasReviewChannel(session)
      || (reviewIncludesFacebook(session) && !hasExplicitPageTarget(session))
      || (reviewIncludesWebsite(session) && !hasWebsiteAnswered(session))
      || !session.reviewPermissionGranted
    ))
    || shouldBootstrapAssessment(session, messageText)
    || session.assessmentDelivered
  );
  if (missingLead && !isSyntheticAistaffMessage(messageText) && !inMidFlow) {
    captureLeadAnswer(session, messageText);
    missingLead = getNextMissingLeadField(session);
    if (missingLead) {
      return finalizeAistaffReply(
        buildLeadGateReply(session, messageText, missingLead),
        session,
        messageText,
        { skipQualificationAppend: true }
      );
    }
  }

  const lower = String(messageText || "").toLowerCase().trim();
  const isTagalog = isTagalogText(lower);
  let reply;

  if (shouldBootstrapAssessment(session, messageText)) {
    const runtime = { psid, pageId: process.env.META_PAGE_ID || "" };
    await bootstrapAssessmentTools(session, messageText, runtime);
    return finalizeAistaffReply(buildAssessmentReply(session, messageText), session, messageText, {
      skipQualificationAppend: true,
      skipSteer: true,
      maxReplyLen: 3200,
      allowMultipleSections: true,
      contentType: "assessment"
    });
  }

  if (isFreshPageCheckInquiry(messageText, session) && session.pageName) {
    return finalizeAistaffReply(buildPageCheckAckReply(session, messageText), session, messageText, { skipQualificationAppend: true });
  }

  if (session.awaitingPageConfirm && (session.pageImageUrl || session.pendingMessengerImages)) {
    const label = session.pageName || "your Page";
    reply = warmReply(
      isTagalog
        ? `narito ang Page image para sa ${label}. Ito po ba ang Facebook Page ninyo?`
        : `here's the Page image for ${label}. Is this your Facebook Page?`,
      isTagalog
    );
    return finalizeAistaffReply(reply, session, messageText, { skipQualificationAppend: true });
  }

  if (activePageCandidates(session).length) {
    const picked = resolvePageCandidatePick(session, messageText);
    if (picked) {
      applyScreenshotPageSelection(session, picked);
      queuePageImages(session, [picked], isTagalog);
    }
  }
  if (isPageRejection(messageText)) {
    await enrichPageCandidates(session, session.pageName);
    const next = getNextPageCandidate(session);
    if (next?.imageUrl) {
      queuePageImages(session, [next], isTagalog);
      applyScreenshotPageSelection(session, next);
      session.lastSentPageSlug = next.slug;
    }
    const label = next?.name || next?.slug || session.pageName || "your Page";
    reply = warmReply(
      isTagalog
        ? `pasensya na po — subukan natin ang isa pang match para sa ${label}. Ito po ba ang Facebook Page ninyo?`
        : `sorry for the wrong Page — let me try another match for ${label}. Is this your Facebook Page?`,
      isTagalog,
      { sorry: true }
    );
    return finalizeAistaffReply(reply, session, messageText, { skipQualificationAppend: true });
  }
  applyPageConfirmationFromMessage(session, messageText);

  if (/^(hi|hello|hey|good (morning|afternoon|evening)|kumusta|musta)\b/.test(lower)) {
    reply = buildGreetingReply(session, psid, isTagalog);
    return finalizeAistaffReply(reply, session, messageText);
  }

  if (/human|tao|agent|staff|admin/i.test(lower)) {
    reply = hasContactDetails(session)
      ? (isTagalog
        ? "Sige po, ipapa-review ko ito sa team ninyo. May iba pa po ba kayong tanong habang naghihintay?"
        : "Sure, I will ask our team to review this. Is there anything else I can help with while you wait?")
      : (isTagalog
        ? "Sige po, ipapa-review ko ito sa team. Ano po ang contact person, mobile number, at email ninyo?"
        : "Sure, I will ask our team to review this. May I get contact person, mobile number, and email?");
    return finalizeAistaffReply(reply, session, messageText);
  }

  if (wantsPageScreenshot(messageText) || isFetchScreenshotCommand(messageText, session)) {
    reply = await buildPageScreenshotReply(session, messageText, isTagalog, { apologetic: isFetchScreenshotCommand(messageText, session) });
    return finalizeAistaffReply(reply, session, messageText, { skipQualificationAppend: true });
  }

  if (wantsPublicPreview(messageText)) {
    const missingReply = buildPreviewMissingDetailReply(session, messageText, isTagalog);
    if (missingReply) {
      reply = missingReply;
      return finalizeAistaffReply(reply, session, messageText, { skipQualificationAppend: true });
    }
    if (session.pageSnapshot?.facebook || session.pageSnapshot?.website) {
      reply = formatSnapshotForMessenger(session.pageSnapshot, { isTagalog });
      session.pageSnapshotShown = true;
      return finalizeAistaffReply(reply, session, messageText, { skipQualificationAppend: true });
    }
    if (facebookLookupFailed(session)) {
      reply = isTagalog
        ? `Hindi ko mahanap ang public Facebook Page para sa "${session.pageName}". ${buildFindPageUrlHelpReply(true)} ${buildFacebookUrlRequestReply(true)}`
        : `I could not find the public Facebook Page for "${session.pageName}". ${buildFindPageUrlHelpReply(false)} ${buildFacebookUrlRequestReply(false)}`;
      return finalizeAistaffReply(reply, session, messageText, { skipQualificationAppend: true });
    }
    reply = isTagalog
      ? "Sige po, titingnan ko ang public preview ngayon habang nagcha-chat tayo."
      : "Sure — I'll check the public preview now while we chat.";
    return finalizeAistaffReply(reply, session, messageText, { skipQualificationAppend: true });
  }

  if (/how (?:will|do|does)|what (?:is|does)/i.test(lower)) {
    reply = buildServiceOverviewReply(session, isTagalog);
    return finalizeAistaffReply(reply, session, messageText);
  }

  if (/\bfree inbox audit\b|schedule.{0,20}audit/i.test(lower)) {
    reply = buildAuditReply(session, isTagalog);
    return finalizeAistaffReply(reply, session, messageText);
  }

  if (/starter|growth|scale|pro|difference|compare|plan/i.test(lower)) {
    if (/starter.*growth|growth.*starter|difference|compare/i.test(lower)) {
      reply = buildPlanCompareReply(session, "starter", "growth", isTagalog);
    } else if (/growth.*(pro|scale)|(pro|scale).*growth/i.test(lower)) {
      // "pro" kept as an input synonym only — the real third plan is Scale.
      reply = buildPlanCompareReply(session, "growth", "scale", isTagalog);
    } else {
      reply = buildOfficialPricingReply(session, isTagalog);
    }
    return finalizeAistaffReply(reply, session, messageText);
  }

  if (isNegative(messageText) && session.pageName && !session.pageConfirmed && !session.pageUrl) {
    reply = isTagalog
      ? `Sige po, salamat sa pag-correct. ${buildFindPageUrlHelpReply(true)} ${buildFacebookUrlRequestReply(true)}`
      : `Thanks for clarifying. ${buildFindPageUrlHelpReply(false)} ${buildFacebookUrlRequestReply(false)}`;
    return finalizeAistaffReply(reply, session, messageText);
  }

  if (hasEmail(session) && session.quotationOffered && session.quotationEmailConfirmed) {
    reply = isTagalog
      ? `Salamat po. Ie-email namin ang quotation sa ${getSessionEmail(session)}.`
      : `Thank you. We will email the quotation to ${getSessionEmail(session)}.`;
    return finalizeAistaffReply(reply, session, messageText);
  }

  if (hasVerifiedPage(session) && !hasWebsiteAnswered(session) && /facebook|profile\.php|page name|page ko|page is|my page/i.test(lower)) {
    reply = `${buildPageReceivedAck(isTagalog)} ${buildWebsiteRequestReply(isTagalog)}`;
    return finalizeAistaffReply(reply, session, messageText);
  }

  if (hasWebsiteAnswered(session) && /website|\.click|\.ph\b|wala|none|no website/i.test(lower) && !hasEmail(session)) {
    reply = isTagalog
      ? "Salamat po. Titingnan ko ang public Facebook Page at website ninyo para sa products at services."
      : "Thanks. I'll review your public Facebook Page and website for your products and services.";
    return finalizeAistaffReply(reply, session, messageText);
  }

  if (/price|pricing|magkano|presyo|cost|setup|monthly|features|package|how much|quotation|quote/i.test(lower)) {
    reply = buildOfficialPricingReply(session, isTagalog);
    return finalizeAistaffReply(reply, session, messageText);
  }

  if (/^(yes|yeah|yep|sure|ok|okay|please|opo|oo|gusto|offer)/i.test(lower) && session.pageSnapshotShown && !session.quotationOffered) {
    reply = buildMinimumQuotationReply(session, isTagalog);
    return finalizeAistaffReply(reply, session, messageText);
  }

  reply = nextQualificationPrompt(session, isTagalog);
  return finalizeAistaffReply(reply, session, messageText);
}

function isSyntheticAistaffMessage(messageText) {
  return /^\[(?:Selected Page from carousel|Page selected)\]$/i.test(String(messageText || "").trim());
}

async function ensureQuotationPdfForSession(session) {
  if (session.pendingQuotationPdfUrl && session.pendingMessengerPdf?.url) {
    return {
      url: session.pendingQuotationPdfUrl,
      filePath: session.pendingQuotationPdfPath,
      quotationNumber: session.quotationNumber
    };
  }
  const { filePath, filename } = await generateQuotationPdf({
    session,
    quotationNumber: session.quotationNumber || `Q-${Date.now()}`,
    offer: MINIMUM_OFFER
  });
  const url = getPublicQuotationUrl(filename);
  session.pendingQuotationPdfUrl = url;
  session.pendingQuotationPdfPath = filePath;
  session.pendingMessengerPdf = {
    url,
    filename,
    quotationNumber: session.quotationNumber || filename
  };
  return { url, filePath, filename, quotationNumber: session.quotationNumber };
}

function buildLeadGateReply(session, messageText, missingField) {
  const isTagalog = isTagalogText(messageText);
  const preface = (wantsAiFitAssessment(messageText) || isFreshPageCheckInquiry(messageText, session))
    ? (isTagalog ? "Sige po — tutulungan ko kayo." : "Happy to help.")
    : "";
  return `${preface} ${buildLeadFieldAskWithContext(missingField, isTagalog)}`.trim();
}

function buildQuotationPdfReply(session, messageText) {
  const isTagalog = isTagalogText(messageText);
  const number = session.quotationNumber || "draft";
  return isTagalog
    ? `Narito ang formal quotation PDF (${number}) para sa ${MINIMUM_OFFER.name}. Kasama dito ang full name, email, mobile, company, address, at package details.`
    : `Here is your formal quotation PDF (${number}) for the ${MINIMUM_OFFER.name}. It includes your full name, email, mobile, company, address, and full package details.`;
}

async function bootstrapQuotationPdf(session, messageText, runtime) {
  const missing = getMissingQuotationFields(session);
  if (missing.length) return { missingFields: missing };
  const draft = await executeAistaffActions(session, [{ type: "make_quotation_draft" }], messageText, runtime);
  if (!draft?.executed?.includes("make_quotation_draft")) return draft;
  await ensureQuotationPdfForSession(session);
  return draft;
}

async function bootstrapPageCheckTools(session, messageText, runtime) {
  if (!isFreshPageCheckInquiry(messageText, session)) return null;
  const target = getExplicitPageLookupTarget(session);
  if (!target) return null;
  return executeAistaffActions(session, [
    { type: "check_facebook_page", name: target },
    { type: "send_page_images" }
  ], messageText, runtime);
}

async function bootstrapAssessmentTools(session, messageText, runtime) {
  if (!shouldBootstrapAssessment(session, messageText)) return null;
  return executeAistaffActions(session, [{ type: "assess_ai_fit" }], messageText, runtime);
}

function buildAssessmentReply(session, messageText) {
  // Rule-based fallback only when OpenAI is off — not used on the orchestrator path.
  const snapshot = session.pageSnapshot;
  if (!snapshot?.ok) {
    const isTagalog = isTagalogText(messageText);
    return isTagalog
      ? "Pasensya po — hindi ko makuha ang public preview ng Page ninyo ngayon. Puwede po bang i-send ang direct Facebook Page URL?"
      : "Sorry — I couldn't load your public Page preview right now. May I get your direct Facebook Page URL?";
  }
  return formatStructuredAssessment(snapshot, {
    isTagalog: isTagalogText(messageText),
    customerName: session.customerName || "",
    inquiryTopics: session.inquiryTopics || "",
    businessType: session.businessType || session.companyName || "",
    includeCta: true
  });
}

async function generateAistaffDemoReply(messageText, psid = "default") {
  if (isStartFreshCommand(messageText) && !isSyntheticAistaffMessage(messageText)) {
    return handleStartFresh(psid, messageText);
  }

  const session = getAistaffSession(psid);
  await hydrateAistaffSessionFromPostgres(psid, session);
  const useOpenAi = Boolean(process.env.OPENAI_API_KEY && process.env.AI_PROVIDER === "openai");
  if (!isSyntheticAistaffMessage(messageText)) {
    updateAistaffSession(session, "customer", messageText, { deferIntentToAi: useOpenAi });
  }

  const runtime = { psid, pageId: process.env.META_PAGE_ID || "" };

  if (useOpenAi) {
    return generateAistaffOrchestratorReply(messageText, psid, session, runtime);
  }

  return generateAistaffRuleBasedReply(messageText, psid, session);
}

async function persistAistaffTurnToPostgres({ pageId, psid, customerText, reply, session }) {
  try {
    const companyId = await getDefaultCompanyId();
    let facebookPage = pageId
      ? await prisma.facebookPage.findUnique({ where: { page_id: pageId } })
      : null;

    if (!facebookPage && pageId) {
      facebookPage = await prisma.facebookPage.create({
        data: {
          company_id: companyId,
          page_id: pageId,
          page_name: "AIStaff Facebook Page",
          page_access_token_encrypted: encryptSecret(process.env.META_PAGE_ACCESS_TOKEN || ""),
          status: "active"
        }
      });
    }

    const conversation = await prisma.conversation.upsert({
      where: { company_id_psid: { company_id: companyId, psid } },
      create: {
        company_id: companyId,
        facebook_page_id: facebookPage?.id,
        psid,
        customer_name: session.contact || null,
        channel: "facebook_messenger",
        status: "open",
        intent: "aistaff_demo_inquiry",
        lead_score: session.weeklyInquiries ? "hot" : "warm",
        last_message_at: new Date()
      },
      update: {
        facebook_page_id: facebookPage?.id,
        intent: "aistaff_demo_inquiry",
        lead_score: session.weeklyInquiries ? "hot" : "warm",
        last_message_at: new Date()
      }
    });

    await prisma.message.createMany({
      data: [
        {
          company_id: companyId,
          conversation_id: conversation.id,
          sender_type: "customer",
          sender_id: psid,
          message_text: customerText,
          ai_generated: false
        },
        {
          company_id: companyId,
          conversation_id: conversation.id,
          sender_type: "ai",
          sender_id: "aistaff_sales_assistant",
          message_text: reply,
          ai_generated: true
        }
      ]
    });

    const email = getSessionEmail(session) || null;
    const mobile = session.phone || null;
    const leadData = {
      customer_name: session.customerName || null,
      mobile_number: mobile,
      email,
      company_name: session.companyName || session.businessType || null,
      location: session.pageUrl || null,
      service_needed: [
        session.inquiryTopics || "AI Facebook inbox sales assistant",
        session.pageName ? `Facebook Page: ${session.pageName}` : "",
        session.websiteUrl ? `Website: ${session.websiteUrl}` : (session.websiteStatus === "none" ? "Website: none" : "")
      ].filter(Boolean).join(" | "),
      budget: session.weeklyInquiries || null,
      urgency: session.sendsQuotations || null,
      notes: encodeAistaffLeadNotes(session),
      lead_status: hasLeadProfile(session) ? "qualified" : (session.contact ? "contacted" : "new"),
      lead_score: session.weeklyInquiries ? "hot" : (hasLeadProfile(session) ? "warm" : "cold"),
      quotation_ready: Boolean(hasLeadProfile(session) && session.quotationOffered)
    };

    const existingLead = await prisma.lead.findFirst({
      where: { company_id: companyId, conversation_id: conversation.id },
      orderBy: { updated_at: "desc" }
    });

    if (existingLead) {
      await prisma.lead.update({ where: { id: existingLead.id }, data: leadData });
    } else {
      await prisma.lead.create({
        data: {
          company_id: companyId,
          conversation_id: conversation.id,
          ...leadData
        }
      });
    }
  } catch (error) {
    console.warn("Could not persist AIStaff memory to Postgres:", error.message);
  }
}

function isAistaffMarketingPage(pageId) {
  const configured = process.env.META_PAGE_ID || "1164341106754995";
  return String(pageId) === String(configured);
}

function consumeAistaffPendingCarousel(psid) {
  const session = getAistaffSession(psid);
  const carousel = session.pendingMessengerCarousel || null;
  session.pendingMessengerCarousel = null;
  return carousel;
}

function consumeAistaffPendingImages(psid) {
  const session = getAistaffSession(psid);
  const images = session.pendingMessengerImages || null;
  session.pendingMessengerImages = null;
  return images;
}

function consumeAistaffPendingPdf(psid) {
  const session = getAistaffSession(psid);
  const pdf = session.pendingMessengerPdf || null;
  session.pendingMessengerPdf = null;
  return pdf;
}

function consumeAistaffPendingFollowUpTexts(psid) {
  const session = getAistaffSession(psid);
  const texts = session.pendingMessengerFollowUpTexts || null;
  session.pendingMessengerFollowUpTexts = null;
  return texts;
}

async function handleAistaffPagePickPostback(psid, slug) {
  const session = getAistaffSession(psid);
  if (!applyPageCandidateBySlug(session, slug)) return false;
  await executeAistaffActions(session, [{ type: "send_page_images", slug }], "");
  return true;
}

function recordLeadGenContact(psid, { email, phone, name, companyName } = {}) {
  const session = getAistaffSession(psid);
  if (email) {
    session.email = email;
    session.leadGenContact = true;
  }
  if (phone) session.phone = phone;
  if (name) session.customerName = name;
  if (companyName) {
    session.companyName = companyName;
    session.businessType = companyName;
  }
  session.contact = [session.phone, session.email].filter(Boolean).join(" / ");
  return session;
}

module.exports = {
  getAistaffSession,
  generateAistaffDemoReply,
  persistAistaffTurnToPostgres,
  resetAistaffSessionInPostgres,
  isAistaffMarketingPage,
  recordLeadGenContact,
  consumeAistaffPendingCarousel,
  consumeAistaffPendingImages,
  consumeAistaffPendingPdf,
  consumeAistaffPendingFollowUpTexts,
  handleAistaffPagePickPostback,
  MINIMUM_OFFER
};
