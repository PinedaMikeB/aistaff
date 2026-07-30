const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const {
  buildFacebookLookupUrls,
  scoreNameMatch,
  formatFacebookLookupMessage
} = require("./facebook-lookup");
const { crawlWebsiteBounded } = require("./website-crawler");
const { searchFacebookPagesByName } = require("./facebook-page-search");

const FETCH_TIMEOUT_MS = 12000;
const USER_AGENT = "AIStaffPageIntel/1.0 (+https://aistaff.click)";

function parseMetaTag(html, prop) {
  const htmlText = String(html || "");
  const direct = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  const reverse = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i");
  return (htmlText.match(direct) || htmlText.match(reverse))?.[1]?.trim() || "";
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^facebook\.com\//i.test(raw) || /^www\.facebook\.com\//i.test(raw)) return `https://${raw.replace(/^www\./i, "")}`;
  return `https://${raw}`;
}

function isFacebookUrl(value) {
  try {
    const host = new URL(normalizeUrl(value)).hostname.toLowerCase();
    return host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com";
  } catch {
    return /facebook\.com|fb\.com/i.test(String(value || ""));
  }
}

function isLikelyWebsiteUrl(value) {
  const text = String(value || "").trim();
  if (!text || isFacebookUrl(text)) return false;
  return /^https?:\/\//i.test(text) || /^[\w-]+(\.[\w-]+)+([\/?#]|$)/.test(text);
}

function parseFacebookReference(input) {
  const text = String(input || "").trim();
  if (!text) return null;

  const directUrl = text.match(/https?:\/\/(?:www\.)?(?:facebook|fb)\.com\/[^\s]+/i)?.[0]
    || text.match(/(?:facebook|fb)\.com\/[^\s]+/i)?.[0];
  if (directUrl) {
    const url = normalizeUrl(directUrl.split(/[)\],]/)[0]);
    const parsed = new URL(url);
    const id = parsed.searchParams.get("id");
    return { type: id ? "id" : "url", value: id || url, url };
  }

  const bareId = text.match(/\b(\d{8,20})\b/);
  if (bareId && /page id|facebook page|profile\.php/i.test(text)) {
    const url = `https://www.facebook.com/profile.php?id=${bareId[1]}`;
    return { type: "id", value: bareId[1], url };
  }

  const cleanedName = text
    .replace(/(?:my\s+)?facebook(?:\s+page)?\s+is\s+/i, "")
    .replace(/(?:my\s+)?fb(?:\s+page)?\s+is\s+/i, "")
    .replace(/(?:ang\s+)?facebook(?:\s+page)?\s+ko\s+ay\s+/i, "")
    .replace(/(?:facebook page ko ay|page ko ay|page is|page name is|my page is|page named|the name is|name is)\s+/i, "")
    .replace(/[.?!]+$/, "")
    .trim();
  if (cleanedName.length >= 3 && cleanedName.length <= 100 && !isLikelyWebsiteUrl(cleanedName)) {
    return { type: "name", value: cleanedName, url: "" };
  }

  return null;
}

function buildFacebookLookupUrl(reference) {
  const urls = buildFacebookLookupUrls(reference);
  return urls[0] || "";
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    const html = await response.text();
    return { ok: response.ok, status: response.status, finalUrl: response.url, html };
  } finally {
    clearTimeout(timer);
  }
}

function parseFacebookOpenGraph(html, sourceUrl) {
  const title = parseMetaTag(html, "og:title") || parseMetaTag(html, "twitter:title");
  const description = parseMetaTag(html, "og:description") || parseMetaTag(html, "description");
  const canonicalUrl = parseMetaTag(html, "og:url") || sourceUrl;
  const likesMatch = description.match(/(\d[\d,.]*)\s+likes?\b/i);
  const followersMatch = description.match(/(\d[\d,.]*)\s+followers?\b/i);
  const talkingMatch = description.match(/(\d[\d,.]*)\s+talking about this\b/i);

  return {
    name: title.replace(/\s+\|\s+Facebook$/i, "").trim(),
    description: description.replace(/\s*\.\s*\d[\d,.]*\s+(likes|followers).*$/i, "").trim(),
    url: canonicalUrl,
    likes: likesMatch ? Number(likesMatch[1].replace(/,/g, "")) : null,
    followers: followersMatch ? Number(followersMatch[1].replace(/,/g, "")) : null,
    talkingAbout: talkingMatch ? Number(talkingMatch[1].replace(/,/g, "")) : null,
    source: "facebook_public_preview"
  };
}

function parseWebsiteSnapshot(html, sourceUrl) {
  const title = parseMetaTag(html, "og:title") || parseMetaTag(html, "twitter:title") || (html.match(/<title[^>]*>([^<]+)/i)?.[1] || "").trim();
  const description = parseMetaTag(html, "og:description") || parseMetaTag(html, "description");
  const lowerHtml = html.toLowerCase();

  return {
    title: title.replace(/\s+/g, " ").trim(),
    description: description.trim(),
    url: sourceUrl,
    hasContactSignals: /contact|inquiry|quote|quotation|get in touch|email us|call us/i.test(`${title} ${description} ${html.slice(0, 12000)}`),
    hasMessengerSignals: /m\.me\/|messenger|facebook\.com\/messages|chat with us/i.test(lowerHtml),
    hasMetaDescription: Boolean(description),
    source: "website_public_preview"
  };
}

function buildThoughts({ facebook, website, requestedName }) {
  const thoughts = [];

  if (facebook?.name) {
    if (requestedName && facebook.name.toLowerCase() !== String(requestedName).toLowerCase()) {
      thoughts.push(`The public Page preview shows "${facebook.name}" — please confirm this matches the Page you want audited.`);
    } else {
      thoughts.push(`Public Page preview found for "${facebook.name}".`);
    }
  }

  if (facebook?.description) {
    if (/b2b|supplier|rental|service|construction|copier|cctv|aircon|logistics|quotation|inquiry/i.test(facebook.description)) {
      thoughts.push("The Page description sounds like a B2B or inquiry-driven business — a strong fit for Messenger lead qualification.");
    }
    if (/message us|contact us|inquir|quotation|quote/i.test(facebook.description)) {
      thoughts.push("Your Page already invites inquiries — AIStaff can help you reply faster and capture complete lead details.");
    }
  }

  const audienceSize = facebook?.followers ?? facebook?.likes;
  if (typeof audienceSize === "number") {
    if (audienceSize < 100) {
      thoughts.push("The Page is still growing, so every Messenger inquiry matters — late replies can cost sales quickly.");
    } else if (audienceSize >= 1000) {
      thoughts.push("You already have meaningful Page visibility — structured Messenger qualification can reduce missed inquiries.");
    }
  }

  if (website?.title) {
    thoughts.push(`Website preview: "${website.title}".`);
    if (website.serviceHints?.length) {
      thoughts.push(`Public site hints: ${website.serviceHints.slice(0, 2).join("; ")}.`);
    }
    if (!website.hasMetaDescription) {
      thoughts.push("The website is missing a clear meta description — that can weaken trust before customers reach Messenger.");
    }
    if (website.hasContactSignals && !website.hasMessengerSignals) {
      thoughts.push("The website invites contact but does not highlight Messenger — we can align your website and Page inquiry flow.");
    }
    if (website.hasMessengerSignals) {
      thoughts.push("Good sign: the website already points customers toward messaging.");
    }
  }

  if (!facebook?.name && !website?.title) {
    thoughts.push("I could not confirm public Page or website details yet — a direct Facebook Page URL works best for a quick preview.");
  }

  thoughts.push("This is a public preview only — we still do not access your Messenger inbox until onboarding is completed.");

  return thoughts.slice(0, 4);
}

function assessAiSalesFit(snapshot) {
  const signals = [];
  let score = 0;
  const textBlob = [
    snapshot.requestedPageName,
    snapshot.facebook?.name,
    snapshot.facebook?.description,
    snapshot.website?.title,
    snapshot.website?.description
  ].filter(Boolean).join(" ");

  if (snapshot.facebook?.name) {
    score += 1;
    signals.push(`Facebook Page "${snapshot.facebook.name}" is publicly visible.`);
  }

  if (/community|membership|nonprofit|association|organization|program/i.test(textBlob)) {
    score += 1;
    signals.push("Community or membership-oriented Pages often get Messenger questions about programs, sign-ups, and next steps — fast replies and structured qualification help.");
  }

  if (/retail|shop|store|restaurant|salon|clinic|school|training|consulting|agency|b2b|supplier|rental|service|construction|copier|cctv|aircon|logistics|quotation|inquiry|install|supply|dealer/i.test(textBlob)) {
    score += 2;
    signals.push("Your public Page/website positioning looks inquiry-driven — a strong fit for an AI Inbox Sales Assistant.");
  }

  if (/message us|contact us|inquir|quotation|quote|messenger|book now|get a quote/i.test(textBlob)) {
    score += 1;
    signals.push("Visitors are already encouraged to inquire — AI can reply faster and capture complete lead details.");
  }

  if (snapshot.website?.title) {
    score += 1;
    signals.push(`Website "${snapshot.website.title}" gives extra context for product and service answers.`);
  } else if (snapshot.websiteStatus === "none") {
    signals.push("No website yet — Facebook Messenger becomes your main sales channel, so inbox automation matters more.");
  }

  if (!snapshot.website?.title && snapshot.websiteStatus !== "none" && snapshot.facebook?.name) {
    signals.push("We only validated the Facebook Page so far — a website URL would help confirm your full service list.");
  }

  const fit = score >= 4 ? "strong" : score >= 2 ? "good" : "needs_review";
  const summary = fit === "strong"
    ? "Good fit for this chat-only AI assistant — your public presence looks inquiry-driven on Messenger."
    : fit === "good"
      ? "Likely fit for this chat-only AI assistant — your public Page/site suggests Messenger inquiries we can qualify."
      : "Needs a quick review — please confirm your Page and main products/services so the chat assistant can be tuned correctly.";

  const missedOpportunities = [
    "Slow Messenger replies let warm inquiries cool off or move elsewhere.",
    "Incomplete lead details force staff to chase missing phone, email, or intent.",
    "After-hours messages may sit unanswered until someone is available."
  ];
  const benefits = [
    "Instant 24/7 Messenger replies: Engage visitors immediately, even outside office hours — no one waits for a manual reply.",
    "Structured qualification: Ask the right questions so your team understands each inquiry before handoff.",
    "Automated lead capture: Collect name, phone, email, and intent without chasing details later.",
    "Draft responses for your approval: Speed up follow-up while your team stays in control of what gets sent."
  ];
  const opportunities = [
    "More inquiries handled outside business hours without extra inbox staff."
  ];

  if (snapshot.websiteStatus === "none" && snapshot.facebook?.name) {
    opportunities.push("With no website, Messenger is your main public channel — automating replies has outsized impact.");
  }

  const audienceSize = snapshot.facebook?.followers ?? snapshot.facebook?.likes;
  if (typeof audienceSize === "number" && audienceSize >= 500) {
    opportunities.push(`Your Page already shows about ${audienceSize.toLocaleString()} followers/likes — more visibility means more Messenger volume to capture.`);
  }

  return {
    fit,
    score,
    signals: signals.slice(0, 4),
    summary,
    missedOpportunities: missedOpportunities.slice(0, 3),
    benefits: benefits.slice(0, 4),
    opportunities: opportunities.slice(0, 3)
  };
}

async function lookupFacebookPage(input, options = {}) {
  const reference = typeof input === "string" ? parseFacebookReference(input) : input;
  if (!reference) {
    return { ok: false, error: "Could not parse Facebook Page reference.", reference: null, facebook: null };
  }

  const candidates = buildFacebookLookupUrls(reference);
  const requestedName = options.requestedName || (reference.type === "name" ? reference.value : "");

  let lastError = "Facebook Page preview not available.";
  let bestResult = null;

  for (const candidate of [...new Set(candidates)]) {
    try {
      const fbAgentResponse = await fetchHtml(candidate.replace(/^https:\/\/www\.facebook\.com/, "https://www.facebook.com"));
      let result = await fetchHtml(candidate);
      if (!result.ok || !parseMetaTag(result.html, "og:title")) {
        result = fbAgentResponse.ok ? fbAgentResponse : result;
      }
      if (!result.ok) {
        lastError = `Facebook preview request failed (${result.status}).`;
        continue;
      }
      const facebook = parseFacebookOpenGraph(result.html, result.finalUrl || candidate);
      if (!facebook.name) {
        lastError = "Facebook Page preview did not return a readable public title.";
        continue;
      }
      if (/is on facebook\. join facebook to connect/i.test(facebook.description || "")) {
        lastError = "This looks like a personal Facebook profile, not a business Page.";
        continue;
      }

      const match = requestedName
        ? scoreNameMatch(requestedName, facebook.name)
        : { confidence: "high", score: 1 };

      const candidateResult = {
        ok: true,
        reference,
        facebook,
        checkedUrl: result.finalUrl || candidate,
        match,
        triedUrls: candidates
      };

      if (!bestResult || (match.score || 0) > (bestResult.match?.score || 0)) {
        bestResult = candidateResult;
      }
      if (match.confidence === "high") break;
    } catch (error) {
      lastError = error.name === "AbortError" ? "Facebook preview timed out." : error.message;
    }
  }

  if (bestResult) return bestResult;

  if (reference.type === "name" && requestedName) {
    const searchResult = await searchFacebookPagesByName(requestedName, { maxResults: 5 });
    if (searchResult.ok && searchResult.candidates.length) {
      const top = searchResult.candidates[0];
      const facebook = {
        name: top.name,
        description: "",
        url: top.url,
        imageUrl: top.imageUrl,
        likes: null,
        followers: null,
        talkingAbout: null,
        source: "facebook_public_search"
      };
      return {
        ok: true,
        reference,
        facebook: searchResult.candidates.length === 1 ? facebook : null,
        candidates: searchResult.candidates,
        checkedUrl: top.url,
        match: top.match,
        triedUrls: candidates,
        searchUsed: true
      };
    }
  }

  return { ok: false, error: lastError, reference, facebook: null, triedUrls: candidates };
}

async function lookupWebsite(input) {
  return crawlWebsiteBounded(input);
}

async function buildPresenceSnapshot({ facebookInput, websiteInput, requestedPageName = "", websiteStatus = "unknown" } = {}) {
  const [facebookResult, websiteResult] = await Promise.all([
    facebookInput
      ? lookupFacebookPage(facebookInput, { requestedName: requestedPageName || facebookInput })
      : Promise.resolve({ ok: false, facebook: null }),
    websiteInput ? lookupWebsite(websiteInput) : Promise.resolve({ ok: false, website: null })
  ]);

  const snapshot = {
    checkedAt: new Date().toISOString(),
    requestedPageName: requestedPageName || "",
    websiteStatus,
    facebook: facebookResult.ok ? facebookResult.facebook : null,
    facebookCheckedUrl: facebookResult.checkedUrl || buildFacebookLookupUrl(facebookResult.reference) || "",
    facebookError: facebookResult.ok ? "" : (facebookResult.error || ""),
    facebookMatch: facebookResult.match || null,
    facebookCandidates: facebookResult.candidates || [],
    facebookTriedUrls: facebookResult.triedUrls || [],
    facebookSearchUsed: Boolean(facebookResult.searchUsed),
    website: websiteResult.ok ? websiteResult.website : null,
    websiteCheckedUrl: websiteResult.checkedUrl || (websiteInput ? normalizeUrl(websiteInput) : ""),
    websiteError: websiteResult.ok ? "" : (websiteResult.error || ""),
    thoughts: buildThoughts({
      facebook: facebookResult.facebook,
      website: websiteResult.website,
      requestedName: requestedPageName
    })
  };

  snapshot.assessment = assessAiSalesFit(snapshot);
  snapshot.ok = Boolean(snapshot.facebook || snapshot.website || websiteStatus === "none");
  return snapshot;
}

function bulletLines(items) {
  return (items || []).filter(Boolean).map((item) => `• ${item}`);
}

function numberedLines(items, startAt = 1) {
  return (items || []).filter(Boolean).map((item, index) => `${startAt + index}. ${item}`);
}

function joinNaturalList(items) {
  const list = (items || []).map((item) => String(item || "").trim()).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

function formatWebsiteLabel(snapshot, websiteUrl = "") {
  const url = websiteUrl || snapshot?.website?.url || "";
  if (url) {
    try {
      return new URL(normalizeUrl(url)).hostname.replace(/^www\./i, "");
    } catch {
      return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
    }
  }
  return snapshot?.website?.title || "";
}

function collectInquiryTopics(snapshot, options = {}) {
  const profile = options.organizationProfile || {};
  if (profile.typicalInquiries?.length) {
    return profile.typicalInquiries.slice(0, 4);
  }
  if (options.inquiryTopics) {
    return String(options.inquiryTopics)
      .split(/[;,\n]/)
      .map((item) => item.replace(/^typical messenger inquiry:\s*/i, "").trim())
      .filter(Boolean)
      .slice(0, 4);
  }
  const fromSignals = (snapshot?.assessment?.signals || [])
    .map((signal) => signal.replace(/^typical messenger inquiry:\s*/i, "").trim())
    .filter((signal) => /typical messenger inquiry/i.test(signal) || /inquiry/i.test(signal))
    .map((signal) => signal.replace(/^typical messenger inquiry:\s*/i, "").trim())
    .filter(Boolean);
  return fromSignals.slice(0, 4);
}

function fitLabel(fit, isTagalog = false) {
  if (isTagalog) {
    if (fit === "strong") return "malakas na fit";
    if (fit === "good") return "magandang fit";
    return "promising fit";
  }
  if (fit === "strong") return "strong";
  if (fit === "good") return "good";
  return "promising";
}

function formatLifeEasierBenefits(benefits) {
  return (benefits || []).filter(Boolean).map((benefit, index) => {
    const text = String(benefit).trim();
    if (/^\d+\.\s/.test(text)) return text;
    if (text.includes(":")) return `${index + 1}. ${text}`;
    return `${index + 1}. ${text}`;
  });
}

/**
 * Conversational Page review — FALLBACK ONLY (rule-based path when OpenAI is off).
 * OpenAI path must NOT use this; the model writes from pageFacts + principles.
 */
function formatConversationalReview(snapshot, options = {}) {
  const {
    isTagalog = false,
    customerName = "",
    inquiryTopics = "",
    businessType = "",
    websiteUrl = "",
    organizationProfile = null,
    includeCta = true,
    closingQuestion = ""
  } = options;

  if (!snapshot?.ok) {
    return isTagalog
      ? "Hindi ko pa ma-confirm ang public preview. Paki-send ang direct Facebook Page URL?"
      : "I could not confirm a public preview yet. May I get your direct Facebook Page URL?";
  }

  const assessment = snapshot.assessment || assessAiSalesFit(snapshot);
  const pageName = snapshot.facebook?.name || snapshot.website?.title || businessType || "your business";
  const websiteLabel = formatWebsiteLabel(snapshot, websiteUrl);
  const namePrefix = customerName ? `${customerName}, ` : "";
  const topics = collectInquiryTopics(snapshot, { inquiryTopics, organizationProfile });
  const audience = snapshot.facebook?.followers ?? snapshot.facebook?.likes;
  const fit = fitLabel(assessment.fit, isTagalog);

  if (isTagalog) {
    const pagePart = `Facebook Page "${pageName}"`;
    const websitePart = websiteLabel ? ` at website ${websiteLabel}` : "";
    const visibility = topics.length
      ? `Ang public presence ninyo ay may magandang visibility at Messenger inquiries tungkol sa ${joinNaturalList(topics)}.`
      : typeof audience === "number"
        ? `Ang public presence ninyo ay may around ${audience.toLocaleString()} followers/likes at potential Messenger inquiries.`
        : assessment.summary || "Ang public presence ninyo ay mukhang may active Messenger inquiries.";
    const valueBridge = "Sa AIStaff, makakakuha kayo ng instant Messenger replies, structured qualification, at lead capture para maiwasan ang missed inquiries o delayed responses.";
    const outcome = organizationProfile?.messengerUseCase
      ? `Makakatulong ito para ${organizationProfile.messengerUseCase.toLowerCase()}.`
      : topics.length
        ? `Makakatulong ito para mas mabilis at consistent na ma-handle ang inquiries tungkol sa ${joinNaturalList(topics)}.`
        : "Makakatulong ito para mas mabilis at consistent na ma-handle ang Messenger inquiries ninyo.";
    const cta = closingQuestion || "Gusto niyo po bang ipaliwanag ko kung paano i-setup ang AIStaff sa Messenger ninyo para makapagsimula agad?";
    return `${namePrefix}base sa review ko ng ${pagePart}${websitePart}, ${fit} ang AIStaff para sa inyo. ${visibility} ${valueBridge} ${outcome} ${includeCta ? cta : ""}`.replace(/\s{2,}/g, " ").trim();
  }

  const pagePart = `your Facebook Page "${pageName}"`;
  const websitePart = websiteLabel ? ` and your website ${websiteLabel}` : "";
  const visibility = topics.length
    ? `Your public presence shows good visibility and potential Messenger inquiries about ${joinNaturalList(topics)}.`
    : typeof audience === "number"
      ? `Your public presence shows about ${audience.toLocaleString()} followers/likes and steady potential for Messenger inquiries.`
      : assessment.summary
        ? assessment.summary.charAt(0).toUpperCase() + assessment.summary.slice(1)
        : "Your public presence shows active potential for Messenger inquiries.";
  const valueBridge = "With AIStaff, you can get instant Messenger replies, structured qualification, and lead capture to avoid missed inquiries or delayed responses.";
  const outcome = organizationProfile?.messengerUseCase
    ? `This will help you ${organizationProfile.messengerUseCase.charAt(0).toLowerCase()}${organizationProfile.messengerUseCase.slice(1)}.`
    : topics.length
      ? `This will help you handle inquiries about ${joinNaturalList(topics)} faster and more consistently.`
      : "This will help you handle Messenger inquiries faster and more consistently.";
  const cta = closingQuestion || "Would you like me to explain how we can set up AIStaff for your Facebook Messenger to start helping you right away?";

  return `${namePrefix}based on my review of ${pagePart}${websitePart}, AIStaff is a ${fit} fit for your business. ${visibility} ${valueBridge} ${outcome}${includeCta ? ` ${cta}` : ""}`.replace(/\s{2,}/g, " ").trim();
}

/**
 * Conversational benefits — numbered points with blank lines between each (no bullet headers).
 */
function formatConversationalBenefits(snapshot, options = {}) {
  const {
    isTagalog = false,
    customerName = "",
    businessType = "",
    includeCta = true,
    closingQuestion = ""
  } = options;

  if (!snapshot?.ok) {
    return isTagalog
      ? "Pagkatapos ma-confirm ang Page ninyo, ipapaliwanag ko kung paano mapapadali ng AIStaff ang Messenger inquiries ninyo."
      : "Once I confirm your Page, I can walk you through how AIStaff makes Messenger inquiries easier.";
  }

  const assessment = snapshot.assessment || assessAiSalesFit(snapshot);
  const pageName = snapshot.facebook?.name || snapshot.website?.title || businessType || "your business";
  const namePrefix = customerName ? `${customerName}, ` : "";
  const benefitLines = formatLifeEasierBenefits(assessment.benefits);
  const spacedBenefits = benefitLines.join("\n\n");
  const wrapUp = isTagalog
    ? "Ibig sabihin: mas kaunting manual work, mas mabilis na engagement, at mas kaunting missed opportunities sa community ninyo."
    : "This means less manual work, faster engagement, and no missed opportunities with your community.";
  const cta = closingQuestion || (isTagalog
    ? "Gusto niyo po bang pag-usapan kung paano i-setup ito para sa Messenger ninyo?"
    : "Would you like to explore how we can set this up for your Facebook Messenger?");

  const intro = isTagalog
    ? `${namePrefix}narito kung paano mapapadali ng AIStaff ang buhay ninyo para sa ${pageName}:`
    : `${namePrefix}here's how AIStaff can make your life easier for ${pageName}:`;

  const parts = [intro, "", spacedBenefits, "", wrapUp];
  if (includeCta) parts.push("", cta);
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function appendSection(lines, heading, bodyLines) {
  const body = (bodyLines || []).filter(Boolean);
  if (!body.length) return;
  if (heading) lines.push(heading);
  lines.push(...body);
  lines.push("");
}

/**
 * Messenger-safe assessment: conversational review + spaced numbered benefits.
 */
function formatStructuredAssessment(snapshot, options = {}) {
  const review = formatConversationalReview(snapshot, options);
  const benefits = formatConversationalBenefits(snapshot, { ...options, includeCta: true });
  if (options.part === "review") return review;
  if (options.part === "benefits") return benefits;
  return `${review}\n\n${benefits}`;
}

function splitAssessmentMessengerParts(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return [];

  const markers = [
    /here'?s how AIStaff can make your life easier(?: for)?/i,
    /narito kung paano mapapadali ng AIStaff ang buhay ninyo/i
  ];
  for (const pattern of markers) {
    const match = cleaned.match(pattern);
    if (match && match.index > 40) {
      const findings = cleaned.slice(0, match.index).trim();
      const benefits = cleaned.slice(match.index).trim();
      if (findings && benefits) return [findings, benefits];
    }
  }

  return [cleaned];
}

function formatSnapshotForMessenger(snapshot, options = {}) {
  const {
    isTagalog = false,
    skipPageConfirmQuestion = false,
    assessmentReport = false,
    customerName = "",
    inquiryTopics = "",
    businessType = ""
  } = options;

  if (assessmentReport) {
    return formatStructuredAssessment(snapshot, {
      isTagalog,
      customerName,
      inquiryTopics,
      businessType,
      includeCta: true
    });
  }

  if (!snapshot?.ok) {
    return isTagalog
      ? "Hindi ko pa ma-confirm ang public preview ng Page o website ninyo. Pwede po bang i-send ang direct Facebook Page URL?"
      : "I could not confirm a public preview of your Page or website yet. May I get the direct Facebook Page URL?";
  }

  const lines = [];
  lines.push(assessmentReport
    ? (isTagalog
      ? `Salamat po — tiningnan ko na ang public Facebook Page ninyong "${snapshot.facebook?.name || "Page"}". Narito ang assessment:`
      : `Thanks for waiting — I've reviewed your public Facebook Page "${snapshot.facebook?.name || "Page"}". Here's my assessment:`)
    : (isTagalog
      ? "Tiningnan ko ang public Facebook Page at website ninyo para sa products at services. Narito ang nakita ko:"
      : "I reviewed your public Facebook Page and website to understand your products and services. Here's what I found:"));

  if (snapshot.facebook?.name) {
    if (!skipPageConfirmQuestion) {
      lines.push(isTagalog
        ? `Ito po ba ang Page ninyo: ${snapshot.facebook.name}?`
        : `Is this your Facebook Page: ${snapshot.facebook.name}?`);
    } else {
      lines.push(isTagalog
        ? `Page: ${snapshot.facebook.name}`
        : `Page: ${snapshot.facebook.name}`);
    }
    const audience = snapshot.facebook.followers ?? snapshot.facebook.likes;
    if (typeof audience === "number") {
      lines.push(isTagalog
        ? `Public preview: ${audience.toLocaleString()} followers/likes.`
        : `Public preview shows about ${audience.toLocaleString()} followers/likes.`);
    }
  }

  if (snapshot.website?.title) {
    lines.push(isTagalog
      ? `Website preview: ${snapshot.website.title}.`
      : `Website preview: ${snapshot.website.title}.`);
  } else if (snapshot.websiteStatus === "none") {
    lines.push(isTagalog
      ? "Wala pa kayong website — mas critical ang Messenger inbox automation."
      : "No website on file yet — Messenger inbox automation is especially important.");
  }

  if (snapshot.facebook?.description) {
    lines.push(isTagalog ? "Sa public Page:" : "From your public Page:");
    lines.push(snapshot.facebook.description.slice(0, 280));
  }

  if (snapshot.assessment?.summary) {
    lines.push(isTagalog ? "AI chat assistant fit:" : "AI chat assistant fit:");
    lines.push(snapshot.assessment.summary);
  }

  if (snapshot.assessment?.signals?.length) {
    lines.push(isTagalog ? "Mga nakita ko:" : "What I noticed:");
    lines.push(snapshot.assessment.signals.map((signal) => `- ${signal}`).join("\n"));
  }

  if (snapshot.assessment?.missedOpportunities?.length) {
    lines.push(isTagalog ? "Missed opportunities ngayon:" : "Missed opportunities today:");
    lines.push(snapshot.assessment.missedOpportunities.map((item) => `- ${item}`).join("\n"));
  }

  if (snapshot.assessment?.benefits?.length) {
    lines.push(isTagalog ? "Mga benepisyo sa inyo:" : "Benefits for you:");
    lines.push(snapshot.assessment.benefits.map((item) => `- ${item}`).join("\n"));
  }

  if (snapshot.assessment?.opportunities?.length) {
    lines.push(isTagalog ? "Opportunities with AIStaff:" : "Opportunities with AIStaff:");
    lines.push(snapshot.assessment.opportunities.map((item) => `- ${item}`).join("\n"));
  }

  if (!snapshot.assessment?.signals?.length && snapshot.thoughts?.length) {
    lines.push(isTagalog ? "Quick thoughts:" : "Quick thoughts:");
    lines.push(snapshot.thoughts.slice(0, 3).map((thought) => `- ${thought}`).join("\n"));
  }

  lines.push(isTagalog
    ? "Public page at website lang ang tiningnan — chat assistant ito, walang voice call, at hindi pa namin ina-access ang Messenger inbox ninyo."
    : "This reviewed your public page and website only — chat assistant, no voice calls, and we have not accessed your Messenger inbox.");

  if (assessmentReport) {
    lines.push(isTagalog
      ? "Gusto niyo po bang pag-usapan kung paano i-setup ang AIStaff para sa Messenger inquiries ninyo?"
      : "Would you like to explore how we could set this up for your Messenger inquiries?");
  }

  return lines.join("\n\n");
}

module.exports = {
  parseFacebookReference,
  lookupFacebookPage,
  lookupWebsite,
  buildPresenceSnapshot,
  formatSnapshotForMessenger,
  formatStructuredAssessment,
  formatConversationalReview,
  formatConversationalBenefits,
  splitAssessmentMessengerParts,
  formatFacebookLookupMessage,
  assessAiSalesFit,
  isFacebookUrl,
  isLikelyWebsiteUrl,
  normalizeUrl
};
