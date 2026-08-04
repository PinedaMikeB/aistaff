// Brandee multi-page website crawler (PART 2-5 of the deep-understanding
// reliability upgrade).
//
// Replaces "read the homepage text with regex" with a real, bounded,
// SSRF-safe crawl: discover links from nav/footer/body/sitemap.xml, classify
// and score them BEFORE visiting, fetch only the highest-value pages within
// a hard page/depth budget, and return a rich CrawledPage[] that downstream
// extraction (entityExtraction.js, businessNameResolver.js) reads from.
//
// Testability: every network call goes through the `fetchHtmlPage` /
// `fetchTextResource` dependencies (both default to the real SSRF-safe
// fetch in websiteAnalyzer.js). Tests inject an in-memory fake site graph
// instead of touching the network — see test/brandee/crawler.test.js.

const { WebsiteAnalysisError, safeFetchAny, normalizeUrlInput } = require("./websiteAnalyzer");
const { normalizeUrlForCrawl, resolveUrl, classifySourceType, hashContent, isLowPriorityUrl, isMailto, isTel } = require("./urlUtils");
const { classifyPageType, priorityRank, isNonContentHeading } = require("./pageClassifier");

// ---------------------------------------------------------------------------
// Configuration (env-driven, safe defaults — PART 2 "CRAWL LIMITS")
// ---------------------------------------------------------------------------

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return /^(1|true|yes)$/i.test(raw.trim());
}

function getCrawlConfig() {
  return {
    maxPages: envInt("BRANDEE_CRAWL_MAX_PAGES", 20),
    maxDepth: envInt("BRANDEE_CRAWL_MAX_DEPTH", 3),
    timeoutMs: envInt("BRANDEE_CRAWL_TIMEOUT_MS", 8000),
    maxResponseBytes: envInt("BRANDEE_CRAWL_MAX_RESPONSE_BYTES", 1_500_000),
    allowSubdomains: envBool("BRANDEE_CRAWL_ALLOW_SUBDOMAINS", true),
    maxSubdomains: envInt("BRANDEE_CRAWL_MAX_SUBDOMAINS", 3)
  };
}

// ---------------------------------------------------------------------------
// Lightweight, dependency-free HTML parsing (consistent with this repo's
// existing regex-based approach in websiteAnalyzer.js — no HTML-parser
// dependency). More feature-complete than extractStructuredContent(): this
// keeps nav/footer content (rather than discarding it) and extracts links,
// JSON-LD, canonical, and CTAs.
// ---------------------------------------------------------------------------

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

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function extractBlock(html, tag) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1] : null;
}

function extractAllBlocks(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const found = [];
  let match;
  while ((match = re.exec(html))) found.push(match[1]);
  return found;
}

function extractMetaAny(html, key) {
  const byName = html.match(new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']*)["']`, "i"));
  if (byName) return decodeEntities(byName[1]).trim();
  const byProperty = html.match(new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']*)["']`, "i"))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${key}["']`, "i"));
  return byProperty ? decodeEntities(byProperty[1]).trim() : null;
}

function extractCanonical(html) {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)
    || html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["']/i);
  return match ? match[1].trim() : null;
}

function extractHeadingsWithLevel(html) {
  const headings = [];
  for (let level = 1; level <= 4; level++) {
    const re = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi");
    let match;
    while ((match = re.exec(html))) {
      const text = stripTags(match[1]);
      if (text) headings.push({ level, text });
    }
  }
  return headings;
}

const CTA_TEXT_PATTERNS = [
  /book\s+(?:a\s+)?(?:now|appointment|consultation)/i,
  /contact\s+us/i,
  /get\s+a\s+quote/i,
  /message\s+us/i,
  /shop\s+now/i,
  /order\s+now/i,
  /call\s+(?:us\s+)?now/i,
  /inquire\s+now/i,
  /send\s+us\s+a\s+message/i,
  /learn\s+more/i,
  /sign\s+up/i,
  /get\s+started/i,
  /request\s+a\s+quote/i
];

function isCtaText(text) {
  return CTA_TEXT_PATTERNS.some((re) => re.test(text));
}

/** Extracts <a href="...">text</a> anchors from a raw HTML fragment. */
function extractAnchors(html) {
  const anchors = [];
  const re = /<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const href = decodeEntities(match[1]).trim();
    const text = stripTags(match[2]);
    if (href) anchors.push({ href, text });
  }
  return anchors;
}

function extractStructuredDataBlocks(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed["@graph"])) blocks.push(...parsed["@graph"]);
        else blocks.push(parsed);
      }
    } catch {
      // Malformed JSON-LD is common in the wild — skip rather than fail the
      // whole crawl. Not validated further here; entityExtraction.js is the
      // layer that decides whether to trust a given structured-data claim.
    }
  }
  return blocks;
}

function schemaTypesOf(structuredData) {
  return structuredData
    .map((item) => item?.["@type"])
    .flat()
    .filter(Boolean)
    .map((t) => String(t));
}

/**
 * Parses raw HTML into a rich, structured representation. Nav/footer are
 * extracted (not discarded) so link discovery and business-name resolution
 * can use them as evidence.
 */
function parseHtmlDocument(html) {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const structuredData = extractStructuredDataBlocks(withoutNoise);

  const navBlocks = extractAllBlocks(withoutNoise, "nav");
  const footerBlocks = extractAllBlocks(withoutNoise, "footer");
  const headerBlocks = extractAllBlocks(withoutNoise, "header");

  const navHtml = navBlocks.join(" ");
  const footerHtml = footerBlocks.join(" ");
  const headerHtml = headerBlocks.join(" ");

  let mainHtml = withoutNoise;
  for (const block of [...navBlocks, ...footerBlocks]) {
    if (block) mainHtml = mainHtml.replace(block, " ");
  }

  const title = (() => {
    const m = withoutNoise.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? stripTags(m[1]) : null;
  })();
  const metaDescription = extractMetaAny(withoutNoise, "description") || extractMetaAny(withoutNoise, "og:description");
  const openGraphSiteName = extractMetaAny(withoutNoise, "og:site_name");
  // og:title/og:description/og:image — used by the narrow single-page
  // product URL extractor (productUrlExtractor.js) in addition to the
  // business crawler's own use of metaDescription/openGraphSiteName above.
  const openGraphTitle = extractMetaAny(withoutNoise, "og:title");
  const openGraphDescription = extractMetaAny(withoutNoise, "og:description");
  const openGraphImage = extractMetaAny(withoutNoise, "og:image");
  const canonicalUrl = extractCanonical(withoutNoise);
  const headings = extractHeadingsWithLevel(mainHtml);
  const mainText = stripTags(mainHtml);
  const navigationText = navHtml ? [stripTags(navHtml)].filter(Boolean) : [];
  const footerText = footerHtml ? [stripTags(footerHtml)].filter(Boolean) : [];

  // Logo alt text — strong business-name evidence (PART 6 hierarchy #3).
  // Only kept when the alt text itself looks like a name, not a generic
  // "logo"/"image"/"icon" filler alt attribute.
  const logoAltCandidates = [];
  const imgRe = /<img\b[^>]*>/gi;
  let imgMatch;
  for (const block of [navHtml, headerHtml]) {
    if (!block) continue;
    imgRe.lastIndex = 0;
    while ((imgMatch = imgRe.exec(block))) {
      const tag = imgMatch[0];
      const altMatch = tag.match(/alt=["']([^"']*)["']/i);
      if (!altMatch) continue;
      const alt = decodeEntities(altMatch[1]).trim();
      if (alt && !/^(logo|image|icon|banner|site logo|company logo)$/i.test(alt)) {
        logoAltCandidates.push(alt.replace(/\s*logo$/i, "").trim());
      }
    }
  }

  const navAnchors = extractAnchors(navHtml).map((a) => ({ ...a, context: "nav" }));
  const footerAnchors = extractAnchors(footerHtml).map((a) => ({ ...a, context: "footer" }));
  const headerAnchors = extractAnchors(headerHtml).map((a) => ({ ...a, context: "nav" }));
  const bodyAnchors = extractAnchors(mainHtml).map((a) => ({ ...a, context: "body" }));
  const links = [...navAnchors, ...headerAnchors, ...footerAnchors, ...bodyAnchors];

  const callsToAction = links
    .filter((a) => isCtaText(a.text))
    .map((a) => ({ text: a.text, href: a.href }));

  // mailto:/tel: are contact evidence, never crawl targets (PART 4).
  const mailtoLinks = links.filter((a) => isMailto(a.href)).map((a) => a.href.replace(/^mailto:/i, "").split("?")[0]);
  const telLinks = links.filter((a) => isTel(a.href)).map((a) => a.href.replace(/^tel:/i, ""));

  return {
    title,
    metaDescription,
    openGraphSiteName,
    openGraphTitle,
    openGraphDescription,
    openGraphImage,
    canonicalUrl,
    headings,
    mainText,
    navigationText,
    footerText,
    links,
    callsToAction,
    structuredData,
    mailtoLinks,
    telLinks,
    logoAltCandidates,
    contentHash: hashContent(`${title || ""}|${mainText.slice(0, 2000)}`)
  };
}

// ---------------------------------------------------------------------------
// Sitemap / robots.txt discovery (best-effort, never blocks the crawl)
// ---------------------------------------------------------------------------

async function fetchTextResourceDefault(url, { timeoutMs, maxBytes }) {
  const { body, finalUrl } = await safeFetchAny(url, {
    acceptContentType: (ct) => ct.includes("xml") || ct.includes("text/plain") || ct.includes("text/html"),
    timeoutMs,
    maxBytes
  });
  return { text: body, finalUrl };
}

function extractSitemapUrls(xmlText) {
  const urls = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let match;
  while ((match = re.exec(xmlText))) urls.push(decodeEntities(match[1]).trim());
  return urls;
}

async function discoverSitemapUrls({ rootUrl, fetchTextResource, timeoutMs, maxBytes, warnings }) {
  const discovered = new Set();
  const candidates = [];

  try {
    const robotsUrl = new URL("/robots.txt", rootUrl).toString();
    const { text } = await fetchTextResource(robotsUrl, { timeoutMs, maxBytes });
    const sitemapLines = (text || "").split(/\r?\n/).filter((l) => /^sitemap:/i.test(l.trim()));
    for (const line of sitemapLines) {
      const url = line.split(":").slice(1).join(":").trim();
      if (url) candidates.push(url);
    }
  } catch (error) {
    warnings.push(`robots.txt not read: ${error.message || "unreachable"}`);
  }

  if (!candidates.length) {
    candidates.push(new URL("/sitemap.xml", rootUrl).toString());
  }

  for (const sitemapUrl of candidates.slice(0, 3)) {
    try {
      const { text } = await fetchTextResource(sitemapUrl, { timeoutMs, maxBytes });
      for (const url of extractSitemapUrls(text || "")) discovered.add(url);
    } catch (error) {
      warnings.push(`Sitemap not read (${sitemapUrl}): ${error.message || "unreachable"}`);
    }
  }

  return [...discovered];
}

// ---------------------------------------------------------------------------
// Link scoring (PART 2 "Each candidate page should be scored using...")
// ---------------------------------------------------------------------------

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

/**
 * Pre-fetch score: decides VISIT ORDER, computed only from what's knowable
 * before fetching the link (anchor text, URL, menu context, depth, guessed
 * page type). Post-fetch quality/duplication is applied separately once the
 * page is actually read (see selectFinalPages below).
 */
function scoreLinkCandidate({ href, text, context, depth, form }) {
  let score = 0;

  // Menu prominence.
  if (context === "nav") score += 30;
  else if (context === "footer") score += 12;
  else score += 18; // body/product-card links — often the most content-relevant

  // Anchor text + URL path relevance to what the business actually sells,
  // to contact, or to proof — not just keyword-matching in the abstract.
  const anchorTokens = tokenize(text);
  const urlTokens = tokenize(href);
  const sellTokens = tokenize(form?.whatYouSell);
  const relevanceHit = sellTokens.some((t) => anchorTokens.includes(t) || urlTokens.includes(t));
  if (relevanceHit) score += 20;

  const guessedType = classifyPageType({ url: href, depth: 1, title: text });
  score += Math.max(0, 40 - priorityRank(guessedType) * 4);

  if (isLowPriorityUrl(href)) score -= 40;

  // Crawl-depth penalty — prefer breadth-first, shallow, high-value pages.
  score -= depth * 6;

  return score;
}

// ---------------------------------------------------------------------------
// Main crawl orchestrator
// ---------------------------------------------------------------------------

/**
 * Crawls a submitted website beyond the homepage: discovers links from nav/
 * footer/body/sitemap, classifies + scores them, and fetches only the
 * highest-value pages within the configured page/depth budget. Every fetch
 * (homepage, sitemap, robots.txt, and every followed link — same-domain or
 * linked-subdomain) goes through the SSRF-safe fetch layer.
 *
 * Returns { pages: CrawledPage[], diagnostics }.
 */
async function discoverAndCrawl({
  rootUrl,
  form,
  fetchHtmlPage,
  fetchTextResource = fetchTextResourceDefault,
  config = getCrawlConfig()
} = {}) {
  const warnings = [];
  const normalizedRoot = normalizeUrlInput(rootUrl);
  const rootParsed = new URL(normalizedRoot);
  const rootHostname = rootParsed.hostname.toLowerCase();

  const fetchPage = fetchHtmlPage || (async (url) => {
    const { body, finalUrl } = await safeFetchAny(url, {
      acceptContentType: (ct) => ct.includes("text/html") || ct.includes("application/xhtml+xml"),
      timeoutMs: config.timeoutMs,
      maxBytes: config.maxResponseBytes
    });
    return { html: body, finalUrl };
  });

  const visited = new Set(); // normalized URL -> true
  const contentHashesSeen = new Set();
  const subdomainsCrawled = new Set();
  const pages = [];
  const pagesRejected = [];
  const pageTypeCounts = {};

  // BFS queue of { url, depth, context, anchorText }.
  const queue = [{ url: normalizedRoot, depth: 0, context: "seed", anchorText: null }];
  const queued = new Set([normalizeUrlForCrawl(normalizedRoot)]);

  let pagesDiscovered = 0;
  let pagesCrawled = 0;

  while (queue.length && pagesCrawled < config.maxPages) {
    // Sort remaining queue by score each pass so higher-value same-depth
    // links are visited first — cheap for the bounded sizes we deal with.
    queue.sort((a, b) => scoreLinkCandidate({ ...b, form }) - scoreLinkCandidate({ ...a, form }));
    const next = queue.shift();
    if (next.depth > config.maxDepth) continue;

    const normalized = normalizeUrlForCrawl(next.url);
    if (!normalized || visited.has(normalized)) continue;
    visited.add(normalized);

    const sourceType = classifySourceType(normalized, rootHostname);
    if (sourceType === "linked_external") continue; // never crawled deeply — recorded as evidence elsewhere
    if (sourceType === "linked_subdomain") {
      if (!config.allowSubdomains) continue;
      const host = new URL(normalized).hostname.toLowerCase();
      if (!subdomainsCrawled.has(host) && subdomainsCrawled.size >= config.maxSubdomains) continue;
      subdomainsCrawled.add(host);
    }

    let html;
    let finalUrl;
    try {
      ({ html, finalUrl } = await fetchPage(normalized));
      pagesCrawled += 1;
    } catch (error) {
      pagesRejected.push({ url: normalized, reason: error?.message || "fetch failed" });
      continue;
    }

    let parsed;
    try {
      parsed = parseHtmlDocument(html);
    } catch (error) {
      pagesRejected.push({ url: normalized, reason: `parse failed: ${error.message}` });
      continue;
    }

    if (contentHashesSeen.has(parsed.contentHash)) {
      pagesRejected.push({ url: normalized, reason: "duplicate content" });
      continue; // still counted against pagesCrawled — a real fetch happened
    }
    contentHashesSeen.add(parsed.contentHash);

    const schemaTypes = schemaTypesOf(parsed.structuredData);
    const pageType = classifyPageType({ url: finalUrl || normalized, depth: next.depth, title: parsed.title, headings: parsed.headings, schemaTypes });
    pageTypeCounts[pageType] = (pageTypeCounts[pageType] || 0) + 1;

    const cleanHeadings = parsed.headings.filter((h) => !isNonContentHeading(h.text));

    pages.push({
      url: normalized,
      normalizedUrl: normalized,
      canonicalUrl: parsed.canonicalUrl ? resolveUrl(parsed.canonicalUrl, normalized) : null,
      pageType,
      sourceType,
      depth: next.depth,
      title: parsed.title,
      metaDescription: parsed.metaDescription,
      openGraphSiteName: parsed.openGraphSiteName,
      headings: cleanHeadings,
      rejectedHeadings: parsed.headings.filter((h) => isNonContentHeading(h.text)).map((h) => h.text),
      mainText: parsed.mainText.slice(0, 6000),
      navigationText: parsed.navigationText,
      footerText: parsed.footerText,
      callsToAction: parsed.callsToAction,
      structuredData: parsed.structuredData,
      mailtoLinks: parsed.mailtoLinks,
      telLinks: parsed.telLinks,
      logoAltCandidates: parsed.logoAltCandidates,
      contentHash: parsed.contentHash,
      warnings: []
    });

    if (next.depth >= config.maxDepth) continue;

    // Enqueue newly discovered links (dedup by normalized URL against the
    // queue, not just against visited, to avoid re-scoring the same URL
    // from multiple pages).
    for (const link of parsed.links) {
      if (isMailto(link.href) || isTel(link.href)) continue;
      const resolved = resolveUrl(link.href, finalUrl || normalized);
      if (!resolved) continue;
      const normalizedLink = normalizeUrlForCrawl(resolved);
      if (!normalizedLink || queued.has(normalizedLink) || visited.has(normalizedLink)) continue;
      const linkSourceType = classifySourceType(normalizedLink, rootHostname);
      if (linkSourceType === "linked_external") continue; // never enqueued for crawling
      pagesDiscovered += 1;
      queued.add(normalizedLink);
      queue.push({ url: normalizedLink, depth: next.depth + 1, context: link.context, anchorText: link.text });
    }
  }

  // One-time sitemap discovery pass (best-effort) to catch pages the nav/
  // footer didn't surface — only used to ENQUEUE candidates, still subject
  // to the same score/limit/dedup/SSRF rules as any other discovered link.
  if (pagesCrawled < config.maxPages) {
    try {
      const sitemapUrls = await discoverSitemapUrls({ rootUrl: normalizedRoot, fetchTextResource, timeoutMs: config.timeoutMs, maxBytes: config.maxResponseBytes, warnings });
      for (const url of sitemapUrls) {
        if (pagesCrawled >= config.maxPages) break;
        const normalizedLink = normalizeUrlForCrawl(url);
        if (!normalizedLink || visited.has(normalizedLink)) continue;
        const sourceType = classifySourceType(normalizedLink, rootHostname);
        if (sourceType === "linked_external") continue;
        if (isLowPriorityUrl(normalizedLink)) continue;
        visited.add(normalizedLink);
        pagesDiscovered += 1;
        try {
          const { html, finalUrl } = await fetchPage(normalizedLink);
          pagesCrawled += 1;
          const parsed = parseHtmlDocument(html);
          if (contentHashesSeen.has(parsed.contentHash)) continue;
          contentHashesSeen.add(parsed.contentHash);
          const schemaTypes = schemaTypesOf(parsed.structuredData);
          const pageType = classifyPageType({ url: finalUrl || normalizedLink, depth: 1, title: parsed.title, headings: parsed.headings, schemaTypes });
          pageTypeCounts[pageType] = (pageTypeCounts[pageType] || 0) + 1;
          pages.push({
            url: normalizedLink,
            normalizedUrl: normalizedLink,
            canonicalUrl: parsed.canonicalUrl ? resolveUrl(parsed.canonicalUrl, normalizedLink) : null,
            pageType,
            sourceType: `${sourceType}_via_sitemap`,
            depth: 1,
            title: parsed.title,
            metaDescription: parsed.metaDescription,
            openGraphSiteName: parsed.openGraphSiteName,
            headings: parsed.headings.filter((h) => !isNonContentHeading(h.text)),
            rejectedHeadings: parsed.headings.filter((h) => isNonContentHeading(h.text)).map((h) => h.text),
            mainText: parsed.mainText.slice(0, 6000),
            navigationText: parsed.navigationText,
            footerText: parsed.footerText,
            callsToAction: parsed.callsToAction,
            structuredData: parsed.structuredData,
            mailtoLinks: parsed.mailtoLinks,
            telLinks: parsed.telLinks,
            logoAltCandidates: parsed.logoAltCandidates,
            contentHash: parsed.contentHash,
            warnings: []
          });
        } catch (error) {
          pagesRejected.push({ url: normalizedLink, reason: error?.message || "fetch failed" });
        }
      }
    } catch (error) {
      warnings.push(`Sitemap discovery skipped: ${error.message}`);
    }
  }

  const diagnostics = {
    submittedUrl: rootUrl,
    pagesDiscovered,
    pagesCrawled,
    pagesRejected: pagesRejected.length,
    pageTypes: pageTypeCounts,
    subdomainsCrawled: [...subdomainsCrawled],
    warnings,
    skipReasons: pagesRejected
  };

  return { pages, diagnostics };
}

module.exports = {
  getCrawlConfig,
  parseHtmlDocument,
  extractSitemapUrls,
  discoverSitemapUrls,
  scoreLinkCandidate,
  discoverAndCrawl
};
