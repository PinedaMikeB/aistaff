// Brandee website analysis — SSRF-safe server-side fetch + heuristic extraction.
//
// This is the only place in the Brandee subsystem allowed to make an
// outbound HTTP request to a customer-supplied URL. It never runs in the
// browser. Every fetch (including each redirect hop) is re-validated
// against the SSRF blocklist before any request is made.

const dns = require("node:dns").promises;
const net = require("node:net");
const fetchImpl = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const USER_AGENT = "AIStaffBrandeeBot/1.0 (+https://aistaff.click; analyzes public marketing pages)";
const TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000; // 1.5MB cap while streaming the response body
const MAX_REDIRECTS = 3;
const MAX_TEXT_CHARS = 6000; // char budget passed on to the planner/AI layer

class WebsiteAnalysisError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WebsiteAnalysisError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// URL validation + SSRF blocking
// ---------------------------------------------------------------------------

function normalizeUrlInput(input) {
  let value = String(input || "").trim();
  if (!value) throw new WebsiteAnalysisError("invalid_url", "No URL provided.");
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    value = `https://${value}`;
  }
  return value;
}

function parseUrlOrThrow(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new WebsiteAnalysisError("invalid_url", "That does not look like a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebsiteAnalysisError("unsupported_protocol", "Only http and https links are supported.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "0.0.0.0"
    || hostname === "metadata.google.internal"
    || hostname === "169.254.169.254"
  ) {
    throw new WebsiteAnalysisError("blocked_host", "That host is not allowed.");
  }
  return parsed;
}

// IPv4 CIDR check via 32-bit integer comparison.
function ipv4ToInt(ip) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inIpv4Cidr(ip, cidr) {
  const [range, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
}

const BLOCKED_IPV4_RANGES = [
  "127.0.0.0/8",    // loopback
  "10.0.0.0/8",     // private
  "172.16.0.0/12",  // private
  "192.168.0.0/16", // private
  "169.254.0.0/16", // link-local + cloud metadata (169.254.169.254)
  "100.64.0.0/10",  // carrier-grade NAT
  "0.0.0.0/8"       // "this network"
];

function isBlockedIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) {
    return BLOCKED_IPV4_RANGES.some((cidr) => inIpv4Cidr(ip, cidr));
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10 link-local
    // IPv4-mapped IPv6 (::ffff:127.0.0.1 etc.) — re-check the embedded IPv4 address.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // unrecognized format — fail closed
}

async function assertHostResolvesToPublicIp(hostname) {
  // Hostname may itself be a literal IP.
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new WebsiteAnalysisError("blocked_host", "That address is not allowed.");
    return;
  }
  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new WebsiteAnalysisError("dns_error", "Could not resolve that domain.");
  }
  if (!records.length) throw new WebsiteAnalysisError("dns_error", "Could not resolve that domain.");
  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new WebsiteAnalysisError("blocked_host", "That address is not allowed.");
    }
  }
}

// ---------------------------------------------------------------------------
// Safe fetch with manual, re-validated redirects
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" }
    });
  } catch (error) {
    if (error.name === "AbortError") throw new WebsiteAnalysisError("timeout", "The website took too long to respond.");
    throw new WebsiteAnalysisError("unreachable", "Could not reach that website.");
  } finally {
    clearTimeout(timer);
  }
}

async function readBodyWithLimit(response, maxBytes, { binary = false } = {}) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength && contentLength > maxBytes) {
    throw new WebsiteAnalysisError("too_large", "The website response was too large to analyze.");
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new WebsiteAnalysisError("too_large", "The website response was too large to analyze.");
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  // Every existing caller (HTML/sitemap/robots.txt) wants UTF-8 text and
  // has always gotten it — default unchanged. Binary resources (images)
  // must skip UTF-8 decoding entirely: reinterpreting arbitrary binary
  // bytes as UTF-8 is lossy/corrupting (confirmed directly — a real 219KB
  // JPEG became unrecoverable garbage after round-tripping through
  // .toString("utf8") here), which is exactly why every extracted product
  // photo was silently failing to download before this fix.
  return binary ? buffer : buffer.toString("utf8");
}

/**
 * Securely fetch any customer-reachable resource (HTML page, sitemap.xml,
 * robots.txt, etc). Validates + resolves + blocks SSRF targets before every
 * request, including after each redirect hop. `acceptContentType` is a
 * predicate over the response's content-type header; `maxBytes`/`timeoutMs`
 * are configurable per-caller (the multi-page crawler uses its own, larger,
 * env-configurable budget — see crawler.js getCrawlConfig()). `binary: true`
 * returns `body` as a raw Buffer instead of a UTF-8 string — required for
 * any non-text resource (e.g. an image); every existing text-oriented
 * caller is unaffected since binary defaults to false.
 */
async function safeFetchAny(rawUrl, { acceptContentType, maxBytes = MAX_BYTES, timeoutMs = TIMEOUT_MS, skipUrlNormalization = false, binary = false } = {}) {
  let currentUrl = skipUrlNormalization ? rawUrl : normalizeUrlInput(rawUrl);
  let hops = 0;

  while (true) {
    const parsed = parseUrlOrThrow(currentUrl);
    await assertHostResolvesToPublicIp(parsed.hostname);

    const response = await fetchWithTimeout(parsed.toString(), timeoutMs);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      hops += 1;
      if (hops > MAX_REDIRECTS) {
        throw new WebsiteAnalysisError("too_many_redirects", "That website redirected too many times.");
      }
      const location = response.headers.get("location");
      if (!location) throw new WebsiteAnalysisError("unreachable", "That website redirected without a destination.");
      currentUrl = new URL(location, parsed).toString();
      continue;
    }

    if (!response.ok) {
      throw new WebsiteAnalysisError("blocked_or_error", `The website returned an error (status ${response.status}).`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (acceptContentType && !acceptContentType(contentType)) {
      throw new WebsiteAnalysisError("unsupported_content", "That page did not return readable content.");
    }

    const body = await readBodyWithLimit(response, maxBytes, { binary });
    return { body, finalUrl: parsed.toString(), contentType };
  }
}

/**
 * Securely fetch a customer-supplied URL. Validates + resolves + blocks SSRF
 * targets before every request, including after each redirect hop.
 */
async function safeFetchHtml(rawUrl) {
  const { body, finalUrl } = await safeFetchAny(rawUrl, {
    acceptContentType: (ct) => ct.includes("text/html") || ct.includes("application/xhtml+xml")
  });
  return { html: body, finalUrl };
}

// ---------------------------------------------------------------------------
// Lightweight HTML text extraction (no HTML-parser dependency in this repo —
// regex-based, deliberately conservative: strips script/style/comments, then
// tags, then collapses whitespace).
// ---------------------------------------------------------------------------

function stripHtmlNoise(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|footer)[\s\S]*?<\/\1>/gi, " "); // trim nav/footer noise
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&mdash;/g, "—");
}

function extractTag(html, tag) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : null;
}

function extractMeta(html, name) {
  const match = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, "i"))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["']`, "i"));
  return match ? decodeEntities(match[1]).trim() : null;
}

function extractHeadings(html, level) {
  const re = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi");
  const found = [];
  let match;
  while ((match = re.exec(html))) {
    const text = decodeEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text) found.push(text);
  }
  return found;
}

function extractVisibleText(html) {
  const withoutTags = html.replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}

function extractByPattern(text, pattern, limit = 6) {
  const found = new Set();
  let match;
  const re = new RegExp(pattern, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  while ((match = re.exec(text)) && found.size < limit) {
    found.add(match[0].trim());
  }
  return [...found];
}

/**
 * Parses raw HTML into { title, metaDescription, h1s, h2s, h3s, visibleText }.
 * `visibleText` is truncated to MAX_TEXT_CHARS before being handed to any
 * downstream heuristic or AI step — we deliberately do not send full raw HTML
 * to the model.
 */
function extractStructuredContent(html) {
  const cleaned = stripHtmlNoise(html);
  const title = extractTag(cleaned, "title");
  const metaDescription = extractMeta(cleaned, "description") || extractMeta(cleaned, "og:description");
  const h1s = extractHeadings(cleaned, 1);
  const h2s = extractHeadings(cleaned, 2);
  const h3s = extractHeadings(cleaned, 3);
  const visibleText = extractVisibleText(cleaned).slice(0, MAX_TEXT_CHARS);
  return { title, metaDescription, h1s, h2s, h3s, visibleText };
}

// ---------------------------------------------------------------------------
// Heuristic business-analysis extraction (source: "website" — no AI needed).
// This is the layer that keeps the app honest: proof claims later in the
// pipeline must trace back to something found here, or to explicit user
// input, never to unaided model invention.
// ---------------------------------------------------------------------------

const PRICE_PATTERN = /(?:₱|php\s?)\s?\d[\d,]*(?:\.\d{2})?/gi;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PH_MOBILE_PATTERN = /(?:\+?63|0)9\d{9}/g;
const YEARS_PATTERN = /(?:since\s+((?:19|20)\d{2})|(\d{1,2})\+?\s+years?\s+(?:of\s+)?(?:experience|in business|serving))/gi;
const GENERIC_HEADING_STOPLIST = /^(why\b|about\b|contact\b|faq|testimonials?\b|reviews?\b|our\s+(services|products|story|team)\b|home\b|welcome\b)/i;
const RATING_PATTERN = /\b([0-4](?:\.\d)?|5(?:\.0)?)\s*(?:\/\s*5|out of 5|stars?)\b/gi;
const REVIEW_COUNT_PATTERN = /\b(\d{1,5})\+?\s+(?:reviews?|ratings?|customers?|clients?)\b/gi;
const CTA_PATTERNS = [
  /book\s+(?:a\s+)?(?:now|appointment|consultation)/gi,
  /contact\s+us/gi,
  /get\s+a\s+quote/gi,
  /message\s+us/gi,
  /shop\s+now/gi,
  /order\s+now/gi,
  /call\s+(?:us\s+)?now/gi,
  /inquire\s+now/gi,
  /send\s+us\s+a\s+message/gi
];
const SERVICE_HINTS = ["rental", "rent", "service", "repair", "maintenance", "installation", "consultation", "leasing", "booking", "appointment"];
const PRODUCT_HINTS = ["shop", "store", "buy", "order", "product", "shipping", "catalog", "add to cart"];

function extractAll(text, pattern) {
  const matches = text.match(pattern);
  return matches ? [...new Set(matches.map((m) => m.trim()))] : [];
}

function guessBusinessType(text) {
  const lower = text.toLowerCase();
  const serviceScore = SERVICE_HINTS.filter((kw) => lower.includes(kw)).length;
  const productScore = PRODUCT_HINTS.filter((kw) => lower.includes(kw)).length;
  if (serviceScore > 0 && productScore > 0) return "both";
  if (serviceScore > 0) return "service";
  if (productScore > 0) return "product";
  return "unknown";
}

function findCtas(text) {
  const found = new Set();
  for (const pattern of CTA_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) matches.forEach((m) => found.add(m.trim()));
  }
  return [...found];
}

/**
 * Builds a WebsiteBusinessAnalysis-shaped object purely from extracted
 * public page text — no AI call. This is later optionally *enriched* (never
 * overridden on proof-bearing fields) by the AI planning layer.
 */
function buildHeuristicAnalysis({ sourceUrl, structured }) {
  const { title, metaDescription, h1s, h2s, h3s, visibleText } = structured;
  const combinedHeadings = [...h1s, ...h2s, ...h3s];
  const summary = [metaDescription, h1s[0], visibleText.slice(0, 240)].filter(Boolean).join(" — ").slice(0, 400)
    || "Brandee could not find a clear summary on this page.";

  const prices = extractAll(visibleText, PRICE_PATTERN);
  const emails = extractAll(visibleText, EMAIL_PATTERN);
  const mobiles = extractAll(visibleText, PH_MOBILE_PATTERN);
  const ratingMatch = [...visibleText.matchAll(RATING_PATTERN)][0];
  const reviewCountMatch = [...visibleText.matchAll(REVIEW_COUNT_PATTERN)][0];
  const yearsMatch = [...visibleText.matchAll(YEARS_PATTERN)][0];
  const ctas = findCtas(visibleText);

  const specificHeadings = [...h2s, ...h3s].filter((h) => !GENERIC_HEADING_STOPLIST.test(h.trim()));
  const namedItems = specificHeadings.length ? specificHeadings : combinedHeadings.filter((h) => !GENERIC_HEADING_STOPLIST.test(h.trim()));

  // Deliberately do not pin a single detected price to an arbitrary heading —
  // regex extraction cannot reliably confirm which price belongs to which
  // item. Prices are surfaced as general evidence instead (claimsFound).
  const productsOrServices = namedItems.slice(0, 6).map((name, index) => ({
    id: `heuristic-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || index}`,
    name,
    type: "service",
    description: null,
    price: null,
    sourceUrls: sourceUrl ? [sourceUrl] : []
  }));

  const claimsFound = [];
  if (prices.length) claimsFound.push(`Price(s) mentioned on page: ${prices.slice(0, 5).join(", ")}`);

  const missingInformation = [];
  if (!prices.length) missingInformation.push("Exact pricing");
  if (!ratingMatch) missingInformation.push("Verified rating");
  if (!reviewCountMatch) missingInformation.push("Verified review count");
  if (!yearsMatch) missingInformation.push("Years in business");
  if (!emails.length && !mobiles.length) missingInformation.push("A direct contact method");

  const yearsInBusiness = yearsMatch ? Number(yearsMatch[2] || (new Date().getFullYear() - Number(yearsMatch[1]))) : null;
  const reviewCount = reviewCountMatch ? Number(reviewCountMatch[1]) : null;
  const rating = ratingMatch ? Number(ratingMatch[1]) : null;

  // Structured, source-attributed evidence — every entry here traces back to
  // something actually present on the page, with the excerpt kept short and
  // the confidence reflecting how directly the regex match ties to the claim
  // (never a fabricated inference).
  const evidence = [];
  if (title) evidence.push({ statement: `Page title: ${title}`, sourceType: "website", sourceUrl, excerpt: title.slice(0, 160), confidence: 0.6, entityType: "page_title" });
  if (metaDescription) evidence.push({ statement: `Meta description: ${metaDescription}`, sourceType: "website", sourceUrl, excerpt: metaDescription.slice(0, 200), confidence: 0.55, entityType: "meta_description" });
  namedItems.slice(0, 6).forEach((name) => {
    evidence.push({ statement: `Heading found: ${name}`, sourceType: "website", sourceUrl, excerpt: name.slice(0, 160), confidence: 0.5, entityType: "product_or_service" });
  });
  if (yearsInBusiness) evidence.push({ statement: `${yearsInBusiness} years in business mentioned`, sourceType: "website", sourceUrl, excerpt: yearsMatch[0].slice(0, 160), confidence: 0.6, entityType: "years_in_business" });
  if (reviewCount) evidence.push({ statement: `${reviewCount} reviews mentioned`, sourceType: "website", sourceUrl, excerpt: reviewCountMatch[0].slice(0, 160), confidence: 0.5, entityType: "review_count" });
  if (rating) evidence.push({ statement: `${rating}-star rating mentioned`, sourceType: "website", sourceUrl, excerpt: ratingMatch[0].slice(0, 160), confidence: 0.5, entityType: "rating" });
  (emails.length ? emails : []).forEach((e) => evidence.push({ statement: `Contact email found: ${e}`, sourceType: "website", sourceUrl, confidence: 0.7, entityType: "contact_method" }));

  // NOTE: this function is a simple, single-page, no-crawl heuristic
  // extractor — kept for backward compatibility and as a last-resort
  // fallback. The live analyze route now uses businessProfileBuilder.js's
  // multi-page crawl + entity extraction + business-name resolution
  // pipeline instead (see PARTS 2-14 of the deep-understanding reliability
  // upgrade). Its output shapes below are still kept schema-compliant with
  // the upgraded BusinessProfileSchema (structured contacts, {value,
  // sourceUrl, excerpt}-shaped verified numbers) so this remains a safe,
  // valid fallback rather than a shape that would fail validation.
  const contactMethods = [
    ...emails.map((e) => ({ type: "email", value: e, sourceUrl, verified: true })),
    ...mobiles.map((m) => ({ type: "phone", value: m, sourceUrl, verified: true }))
  ];

  return {
    sourceUrl,
    crawlSummary: { pagesDiscovered: 1, pagesCrawled: 1, pagesRejected: 0, subdomainsCrawled: [], pageTypes: { homepage: 1 }, warnings: [] },
    sourceMode: "website_and_manual",
    businessName: title ? title.split(/[-|–]/)[0].trim() : null,
    businessNameConfidence: 0.3, // weak evidence only (raw title) — this simple path doesn't run the full evidence hierarchy
    businessType: guessBusinessType(visibleText),
    industry: null,
    summary,
    productsOrServices,
    targetAudienceSignals: [],
    primaryProblemsSolved: [],
    customerDesires: [],
    features: [],
    functionalBenefits: [],
    businessOutcomes: [],
    primaryBenefits: namedItems.slice(0, 5),
    differentiators: [],
    offers: [],
    callsToAction: ctas,
    contactMethods,
    locations: [],
    blogState: "unknown",
    proof: {
      testimonials: [],
      reviewCount: reviewCount ? { value: reviewCount, sourceUrl, excerpt: reviewCountMatch?.[0] || null } : null,
      rating: rating ? { value: rating, sourceUrl, excerpt: ratingMatch?.[0] || null } : null,
      customerCount: null,
      yearsInBusiness: yearsInBusiness ? { value: yearsInBusiness, sourceUrl, excerpt: yearsMatch?.[0] || null } : null,
      awards: [],
      certifications: [],
      guarantees: []
    },
    brandTone: [],
    claimsFound,
    evidence,
    inferences: [],
    missingInformation,
    contradictions: [],
    confirmationRequired: true, // single-page heuristic path never has enough signal to skip confirmation
    confirmationReasons: ["Only the homepage was read (no multi-page crawl) — please confirm these details."],
    confidence: combinedHeadings.length && visibleText.length > 200 ? 0.55 : 0.3,
    fetchStatus: "ok"
  };
}

module.exports = {
  WebsiteAnalysisError,
  normalizeUrlInput,
  parseUrlOrThrow,
  isBlockedIp,
  assertHostResolvesToPublicIp,
  safeFetchHtml,
  safeFetchAny,
  extractStructuredContent,
  buildHeuristicAnalysis,
  MAX_TEXT_CHARS,
  MAX_BYTES,
  TIMEOUT_MS
};
