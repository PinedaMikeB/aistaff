// Page-type classification for the Brandee multi-page crawler.
//
// Runs BEFORE business-fact extraction (PART 7 of the reliability brief) so
// downstream extraction knows what kind of page it's reading — a heading
// found on a blog article ("Conclusion", "Related Posts") must never be
// treated the same as a heading found on a real services page.

const PAGE_TYPES = [
  "homepage", "about", "product", "product_category", "service", "service_category",
  "pricing", "plans", "offers", "contact", "location", "faq", "testimonial",
  "case_study", "portfolio", "booking", "terms", "privacy", "blog_index",
  "blog_article", "unknown"
];

// Headings that are structural/navigational, never a product, offer, or
// proof claim in their own right — regardless of which page they appear on.
// This directly targets the "Conclusion / Summary / Related Posts / Learn
// More" failure mode named in the brief.
const NON_CONTENT_HEADING_PATTERNS = [
  /^conclusion$/i,
  /^summary$/i,
  /^in\s+summary$/i,
  /^related\s+(posts?|articles?)$/i,
  /^you\s+(might|may)\s+also\s+like$/i,
  /^learn\s+more$/i,
  /^read\s+more$/i,
  /^table\s+of\s+contents$/i,
  /^share\s+this$/i,
  /^leave\s+a\s+(comment|reply)$/i,
  /^comments?$/i,
  /^recent\s+posts?$/i,
  /^categories$/i,
  /^tags?$/i,
  /^next\s+(post|article)$/i,
  /^previous\s+(post|article)$/i,
  /^about\s+the\s+author$/i,
  /^references?$/i,
  /^sources?$/i,
  /^frequently\s+asked\s+questions?$/i, // FAQ page marker, not a proof/offer
  /^why\b/i,
  /^about\b/i,
  /^contact\b/i,
  /^home\b/i,
  /^welcome\b/i,
  /^our\s+(services|products|story|team)\b/i,
  /^testimonials?\b/i,
  /^reviews?\b/i
];

function isNonContentHeading(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return true;
  return NON_CONTENT_HEADING_PATTERNS.some((re) => re.test(trimmed));
}

const URL_TYPE_RULES = [
  { type: "about", pattern: /\/(about|about-us|our-story|company)\/?($|[/?#])/i },
  { type: "contact", pattern: /\/(contact|contact-us|get-in-touch)\/?($|[/?#])/i },
  { type: "pricing", pattern: /\/(pricing|prices|rates)\/?($|[/?#])/i },
  { type: "plans", pattern: /\/(plans|packages|subscriptions)\/?($|[/?#])/i },
  { type: "offers", pattern: /\/(offers?|deals|promos?|promotions?)\/?($|[/?#])/i },
  { type: "faq", pattern: /\/(faq|faqs|frequently-asked-questions|help)\/?($|[/?#])/i },
  { type: "testimonial", pattern: /\/(testimonials?|reviews?|success-stories)\/?($|[/?#])/i },
  { type: "case_study", pattern: /\/(case-stud(y|ies)|client-stories)\/?($|[/?#])/i },
  { type: "portfolio", pattern: /\/(portfolio|our-work|gallery|projects)\/?($|[/?#])/i },
  { type: "booking", pattern: /\/(book(ing)?|schedule|reserve|appointment)\/?($|[/?#])/i },
  { type: "location", pattern: /\/(locations?|branches|find-us|stores?)\/?($|[/?#])/i },
  { type: "terms", pattern: /\/(terms|terms-of-service|tos|terms-and-conditions)\/?($|[/?#])/i },
  { type: "privacy", pattern: /\/(privacy|privacy-policy)\/?($|[/?#])/i },
  { type: "blog_index", pattern: /\/(blog|news|articles|insights)\/?$/i },
  { type: "blog_article", pattern: /\/(blog|news|articles|insights)\/[^/?#]+/i },
  { type: "service_category", pattern: /\/(services|solutions)\/?$/i },
  { type: "service", pattern: /\/(services|solutions)\/[^/?#]+/i },
  { type: "product_category", pattern: /\/(products|shop|store|catalog)\/?$/i },
  { type: "product", pattern: /\/(products|shop|store|catalog)\/[^/?#]+/i }
];

/**
 * Classifies a crawled page's type using URL patterns first (most reliable,
 * language-independent), falling back to title/heading/schema signals.
 * Never guesses "product"/"offer" purely from a generic homepage heading.
 */
function classifyPageType({ url, depth = 0, title = "", headings = [], schemaTypes = [] } = {}) {
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = String(url || "");
  }

  if (depth === 0 || pathname === "" || pathname === "/") return "homepage";

  // Schema.org type is strong, direct evidence when present and unambiguous.
  const schemaSet = new Set((schemaTypes || []).map((t) => String(t).toLowerCase()));
  if (schemaSet.has("product")) return "product";
  if (schemaSet.has("service")) return "service";
  if (schemaSet.has("faqpage")) return "faq";
  if (schemaSet.has("localbusiness") || schemaSet.has("organization")) {
    // Structured business data commonly lives on homepage/about/contact —
    // not decisive for page type on its own, fall through to URL rules.
  }

  for (const rule of URL_TYPE_RULES) {
    if (rule.pattern.test(pathname)) return rule.type;
  }

  const titleLower = String(title || "").toLowerCase();
  if (/\bfaq\b|\bfrequently asked\b/.test(titleLower)) return "faq";
  if (/\bcontact\b/.test(titleLower)) return "contact";
  if (/\babout\b/.test(titleLower)) return "about";
  if (/\bpricing\b|\bprices\b/.test(titleLower)) return "pricing";
  if (/\btestimonials?\b|\breviews?\b/.test(titleLower)) return "testimonial";

  return "unknown";
}

// Page types worth spending crawl budget on, in priority order (PART 2).
const PRIORITY_ORDER = [
  "homepage", "product", "service", "product_category", "service_category",
  "pricing", "plans", "offers", "about", "contact", "faq",
  "testimonial", "case_study", "location", "booking", "portfolio"
];

// Never prioritized — legal/auth/duplicate/tracking pages (PART 2 "do not prioritize").
const DEPRIORITIZED_TYPES = new Set(["terms", "privacy", "blog_index", "blog_article", "unknown"]);

function priorityRank(pageType) {
  const idx = PRIORITY_ORDER.indexOf(pageType);
  if (idx !== -1) return idx;
  if (DEPRIORITIZED_TYPES.has(pageType)) return PRIORITY_ORDER.length + 10;
  return PRIORITY_ORDER.length + 5;
}

module.exports = {
  PAGE_TYPES,
  isNonContentHeading,
  classifyPageType,
  priorityRank,
  DEPRIORITIZED_TYPES
};
