// Business-name resolution (PART 6 of the deep-understanding upgrade).
//
// Root cause fixed here: the previous heuristic extractor used
// `title.split(/[-|–]/)[0]` — the raw <title> tag, nothing else — as the
// business name. That reliably produces an SEO keyword phrase ("Copier and
// Printer Rental for Offices") instead of the actual business name whenever
// the site's <title> leads with a service description rather than the
// brand. This module replaces that with a weighted evidence hierarchy and
// an explicit confidence score, and rejects generic category/service
// phrases outright rather than accepting them as a fallback.

// Generic phrases that must NEVER be returned as a business name, however
// strong their surface-level "evidence" looks (PART 6 "Reject names that
// are only...").
const REJECT_EXACT = new Set([
  "home", "products", "services", "contact", "about", "welcome", "shop",
  "store", "blog", "news", "faq", "pricing", "menu", "gallery"
]);

const REJECT_PATTERNS = [
  /^(our\s+)?(services|products|solutions|offerings)$/i,
  /^why\s+(choose|us)\b/i,
  /^welcome\s+to\b/i, // "Welcome to [X]" is a greeting, not a name in isolation
  /^(best|top|#1|leading|trusted)\b/i, // SEO-keyword openers
  /\b(rental|rentals|repair|services?|solutions?|clinic|agency)\s+(for|in)\b/i, // "X Rental for Offices" style SEO titles
  /^\d+/ // starts with a number — unlikely a business name on its own
];

function isGenericName(candidate) {
  const trimmed = String(candidate || "").trim();
  if (!trimmed) return true;
  if (REJECT_EXACT.has(trimmed.toLowerCase())) return true;
  if (trimmed.split(/\s+/).length > 8) return true; // a whole sentence, not a name
  return REJECT_PATTERNS.some((re) => re.test(trimmed));
}

function cleanCandidate(text) {
  return String(text || "")
    .replace(/\s*[-|–]\s*(home|homepage)\s*$/i, "")
    .replace(/^\s*welcome\s+to\s+/i, "")
    .trim();
}

const COPYRIGHT_PATTERN = /(?:©|copyright)\s*(?:\d{4}\s*)?([A-Z][A-Za-z0-9&.,'\s]{1,60}?)(?:\.|,|\s+all\s+rights\s+reserved|\s*$)/i;

function extractCopyrightName(footerTextBlocks = []) {
  for (const block of footerTextBlocks) {
    const match = String(block || "").match(COPYRIGHT_PATTERN);
    if (match && match[1]) {
      const name = match[1].trim().replace(/\s+(inc\.?|llc|ltd\.?|corp\.?)$/i, (m) => ` ${m.trim()}`);
      if (name && !isGenericName(name)) return name;
    }
  }
  return null;
}

function extractSchemaOrgName(structuredDataByPage) {
  for (const items of structuredDataByPage) {
    for (const item of items || []) {
      const type = [].concat(item?.["@type"] || []).map((t) => String(t).toLowerCase());
      if ((type.includes("organization") || type.includes("localbusiness")) && typeof item.name === "string" && item.name.trim()) {
        return item.name.trim();
      }
    }
  }
  return null;
}

/**
 * Counts how many distinct crawled pages mention a given candidate name in
 * their title/headings — repeated appearance across multiple pages is
 * meaningfully stronger evidence than a single mention (PART 6 "Repeated
 * brand name across pages").
 */
function countCrossPageMentions(pages, candidate) {
  if (!candidate) return 0;
  const needle = candidate.toLowerCase();
  let count = 0;
  for (const page of pages) {
    const haystack = [page.title, ...(page.headings || []).map((h) => h.text)].filter(Boolean).join(" ").toLowerCase();
    if (haystack.includes(needle)) count += 1;
  }
  return count;
}

/**
 * Resolves the business name from crawled pages using a weighted evidence
 * hierarchy (strong -> weak), per PART 6. Returns
 * { businessName, confidence, evidence[] } — never silently substitutes a
 * generic heading/keyword phrase when better evidence exists, and rejects
 * generic candidates outright even as a last resort.
 */
function resolveBusinessName({ pages = [] } = {}) {
  const evidence = [];
  const homepage = pages.find((p) => p.pageType === "homepage") || pages[0] || null;
  const aboutPage = pages.find((p) => p.pageType === "about");
  const contactPage = pages.find((p) => p.pageType === "contact");

  const structuredDataByPage = pages.map((p) => p.structuredData || []);

  const candidates = [];

  // 1. Organization/LocalBusiness schema name — strongest.
  const schemaName = extractSchemaOrgName(structuredDataByPage);
  if (schemaName && !isGenericName(schemaName)) {
    candidates.push({ name: schemaName, weight: 1.0, source: "schema_org", sourceUrl: homepage?.url || null });
  }

  // 2. Open Graph site_name.
  const ogName = pages.map((p) => p.openGraphSiteName).find(Boolean);
  if (ogName && !isGenericName(ogName)) {
    candidates.push({ name: cleanCandidate(ogName), weight: 0.9, source: "open_graph_site_name", sourceUrl: homepage?.url || null });
  }

  // 3. Header logo alt text.
  const logoAlt = pages.flatMap((p) => p.logoAltCandidates || []).find((c) => c && !isGenericName(c));
  if (logoAlt) {
    candidates.push({ name: cleanCandidate(logoAlt), weight: 0.85, source: "logo_alt_text", sourceUrl: homepage?.url || null });
  }

  // 4. Footer copyright / legal business name.
  const footerBlocks = pages.flatMap((p) => p.footerText || []);
  const copyrightName = extractCopyrightName(footerBlocks);
  if (copyrightName) {
    candidates.push({ name: copyrightName, weight: 0.8, source: "footer_copyright", sourceUrl: pages.find((p) => (p.footerText || []).length)?.url || homepage?.url || null });
  }

  // 5/6. About-page or contact-page identity — look for "About <Name>" /
  // "<Name> is a..." patterns in the page's own title/first heading.
  for (const page of [aboutPage, contactPage].filter(Boolean)) {
    const heading = page.headings?.[0]?.text;
    if (heading && !isGenericName(heading) && heading.split(/\s+/).length <= 6) {
      candidates.push({ name: cleanCandidate(heading), weight: 0.55, source: page === aboutPage ? "about_page" : "contact_page", sourceUrl: page.url });
    }
  }

  // Weak fallback evidence — homepage title / H1 / domain.
  if (homepage?.title) {
    const first = cleanCandidate(homepage.title.split(/[-|–]/)[0]);
    if (first && !isGenericName(first)) {
      candidates.push({ name: first, weight: 0.35, source: "homepage_title", sourceUrl: homepage.url });
    }
  }
  const homepageH1 = homepage?.headings?.find((h) => h.level === 1)?.text;
  if (homepageH1 && !isGenericName(homepageH1) && homepageH1.split(/\s+/).length <= 6) {
    candidates.push({ name: cleanCandidate(homepageH1), weight: 0.3, source: "homepage_h1", sourceUrl: homepage.url });
  }
  if (homepage?.url) {
    try {
      const host = new URL(homepage.url).hostname.replace(/^www\./, "");
      const domainName = host.split(".")[0];
      if (domainName && domainName.length > 1) {
        const titleized = domainName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        candidates.push({ name: titleized, weight: 0.15, source: "domain_name", sourceUrl: homepage.url });
      }
    } catch {
      // ignore malformed homepage URL
    }
  }

  if (!candidates.length) {
    return { businessName: null, confidence: 0, evidence: [] };
  }

  // Cross-page repetition boosts confidence but never overrides a stronger
  // single source (schema/OG/logo always outrank frequency alone).
  for (const candidate of candidates) {
    const mentions = countCrossPageMentions(pages, candidate.name);
    candidate.crossPageMentions = mentions;
    candidate.finalScore = candidate.weight + Math.min(0.1, mentions * 0.02);
  }

  candidates.sort((a, b) => b.finalScore - a.finalScore);
  const winner = candidates[0];

  for (const c of candidates) {
    evidence.push({
      statement: `Candidate business name "${c.name}" (source: ${c.source}${c.crossPageMentions > 1 ? `, mentioned on ${c.crossPageMentions} pages` : ""})`,
      sourceType: "website",
      sourceUrl: c.sourceUrl,
      excerpt: c.name,
      confidence: Math.min(1, c.finalScore),
      entityType: "business_name"
    });
  }

  // Confidence is the winner's own score, penalized if the runner-up is
  // nearly tied (ambiguous) or if only weak fallback evidence exists at all.
  const runnerUp = candidates[1];
  const ambiguityPenalty = runnerUp && (winner.finalScore - runnerUp.finalScore) < 0.1 ? 0.15 : 0;
  const confidence = Math.max(0, Math.min(1, winner.finalScore - ambiguityPenalty));

  return { businessName: winner.name, confidence, evidence };
}

module.exports = { resolveBusinessName, isGenericName };
