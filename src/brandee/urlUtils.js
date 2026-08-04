// URL normalization, deduplication, and source-type classification for the
// Brandee multi-page crawler (crawler.js). Pure functions, no network I/O —
// kept separate from websiteAnalyzer.js (which owns the actual SSRF-safe
// fetch) so link bookkeeping can be unit-tested without any fetch mocking.

const crypto = require("node:crypto");

// Query parameters that carry no content-identity signal — stripped before a
// URL is used as a crawl/dedup key. Deliberately conservative: we strip only
// well-known tracking/session parameters, never arbitrary filter/sort params
// that might actually change page content.
const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^msclkid$/i,
  /^mc_(cid|eid)$/i,
  /^ref$/i,
  /^referrer$/i,
  /^session(id)?$/i,
  /^sid$/i,
  /^phpsessid$/i,
  /^_ga$/i,
  /^print$/i
];

function isTrackingParam(key) {
  return TRACKING_PARAM_PATTERNS.some((re) => re.test(key));
}

/**
 * Normalizes a URL for crawl-queue/dedup purposes: strips tracking params,
 * fragments, trailing slash duplication, and lowercases the host. Keeps the
 * path/remaining query intact since those usually do affect content.
 */
function normalizeUrlForCrawl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  const keptParams = [...parsed.searchParams.entries()].filter(([key]) => !isTrackingParam(key));
  parsed.search = "";
  keptParams.sort(([a], [b]) => a.localeCompare(b)); // stable order → equivalent URLs dedupe identically
  for (const [key, value] of keptParams) parsed.searchParams.append(key, value);
  // Trailing-slash normalization (never touch the root "/").
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

function resolveUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function getRegistrableHost(hostname) {
  // Lightweight heuristic (no public-suffix-list dependency in this repo):
  // treat the last two labels as the registrable domain for common cases.
  // Good enough for same-domain/subdomain classification of customer sites;
  // does not need to be perfect for two-level ccTLDs (e.g. co.uk) since we
  // only use it for a same-vs-subdomain distinction, not security policy —
  // SSRF/public-IP checks in websiteAnalyzer.js are the actual security gate.
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join(".");
}

/**
 * Classifies a discovered URL relative to the root submitted domain.
 * Returns one of: same_domain | linked_subdomain | linked_external.
 */
function classifySourceType(url, rootHostname) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "linked_external";
  }
  const host = parsed.hostname.toLowerCase();
  const root = rootHostname.toLowerCase();
  if (host === root) return "same_domain";
  const rootRegistrable = getRegistrableHost(root);
  const hostRegistrable = getRegistrableHost(host);
  if (hostRegistrable === rootRegistrable && host !== root) return "linked_subdomain";
  return "linked_external";
}

function isMailto(href) {
  return typeof href === "string" && href.trim().toLowerCase().startsWith("mailto:");
}

function isTel(href) {
  return typeof href === "string" && href.trim().toLowerCase().startsWith("tel:");
}

/** Simple, stable content hash for duplicate-content detection (not cryptographic use). */
function hashContent(text) {
  return crypto.createHash("sha256").update(String(text || "").trim().toLowerCase()).digest("hex").slice(0, 24);
}

// Path/URL patterns that should never be prioritized for crawling — legal,
// auth, pagination/filter/tracking pages that don't help business understanding.
const LOW_PRIORITY_PATH_PATTERNS = [
  /\/(privacy|privacy-policy)\/?$/i,
  /\/(terms|terms-of-service|tos)\/?$/i,
  /\/(login|signin|sign-in|logout|register|account|my-account)\/?/i,
  /\/(cart|checkout)\/?/i,
  /\/tag\//i,
  /\/page\/\d+/i,
  /\/calendar\//i,
  /[?&](sort|orderby|filter)=/i,
  /\/print\//i,
  /\/wp-json\//i,
  /\.(jpg|jpeg|png|gif|svg|webp|css|js|pdf|zip|xml)$/i
];

function isLowPriorityUrl(url) {
  return LOW_PRIORITY_PATH_PATTERNS.some((re) => re.test(url));
}

module.exports = {
  normalizeUrlForCrawl,
  resolveUrl,
  classifySourceType,
  getRegistrableHost,
  isMailto,
  isTel,
  hashContent,
  isLowPriorityUrl
};
