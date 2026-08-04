// Entity extraction + classification (PARTS 8-11) over crawled pages.
//
// Root causes fixed here (verified against the previous implementation in
// websiteAnalyzer.js buildHeuristicAnalysis, not assumed):
// - Generic headings ("Conclusion", "Related Posts") were filtered from
//   `productsOrServices` by a small stoplist, but the SAME filtered list was
//   reused verbatim for `primaryBenefits` — so a benefit and a product name
//   were always identical strings from the same source array. This module
//   keeps products/services, features, and benefits as separate extractions
//   with separate evidence, and a page must be classified as a
//   product/service page (or a homepage heading must match a concrete
//   product/service pattern) before it becomes a product/service candidate.
// - `offers` was always returned empty by the heuristic extractor (safe, but
//   meant every offer had to come from the user-entered form field even
//   when the website plainly had a real one). This module now looks for
//   actual value-exchange language on pricing/plans/offers pages.
// - Contact extraction only ever regexed the homepage's visible text for an
//   email/PH-mobile pattern — it never looked at tel:/mailto: hrefs, and
//   never visited a dedicated contact page. This module reads contacts from
//   every crawled page's tel:/mailto: links plus Messenger/WhatsApp/Viber/
//   social hrefs, so "direct contact method missing" is no longer reported
//   when one was actually discovered.

const { makeEvidence } = require("./evidenceModel");
const { isNonContentHeading } = require("./pageClassifier");

// ---------------------------------------------------------------------------
// Contacts (PART 10)
// ---------------------------------------------------------------------------

const CONTACT_LINK_PATTERNS = [
  { type: "messenger", re: /(m\.me\/|messenger\.com\/t\/)/i },
  { type: "whatsapp", re: /(wa\.me\/|whatsapp\.com\/send)/i },
  { type: "viber", re: /(viber:\/\/|viber\.com)/i },
  { type: "booking", re: /(calendly\.com|cal\.com|acuityscheduling\.com|booksy\.com|setmore\.com)/i },
  { type: "facebook", re: /(facebook\.com\/)/i },
  { type: "instagram", re: /(instagram\.com\/)/i }
];

function classifyContactHref(href) {
  for (const { type, re } of CONTACT_LINK_PATTERNS) {
    if (re.test(href)) return type;
  }
  return null;
}

/**
 * Extracts publicly-presented business contact methods from every crawled
 * page — tel:/mailto: hrefs plus Messenger/WhatsApp/Viber/booking/social
 * links found anywhere on the site (not just the homepage body text).
 */
function extractContacts(pages = []) {
  const contacts = [];
  const seen = new Set();

  const add = (type, value, sourceUrl) => {
    const key = `${type}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    contacts.push({ type, value, sourceUrl, verified: true });
  };

  for (const page of pages) {
    for (const phone of page.telLinks || []) add("phone", phone, page.url);
    for (const email of page.mailtoLinks || []) add("email", email, page.url);
    for (const link of page.callsToAction || []) {
      const type = classifyContactHref(link.href || "");
      if (type) add(type, link.href, page.url);
    }
    // Also scan every anchor-derived list we have (callsToAction only
    // captures CTA-worded links) — re-derive from raw contact-style hrefs
    // recorded on contact/booking pages specifically, where non-CTA-worded
    // social/booking links are common (e.g. a bare Facebook icon link).
    if (["contact", "booking"].includes(page.pageType)) {
      for (const link of page.callsToAction || []) {
        const type = classifyContactHref(link.href || "");
        if (type) add(type, link.href, page.url);
      }
    }
    if (page.pageType === "contact") {
      add("contact_form", `Contact form present on ${page.url}`, page.url);
    }
  }

  return contacts;
}

// ---------------------------------------------------------------------------
// Blog detection (PART 11) — never assume a blog exists or has content.
// ---------------------------------------------------------------------------

function detectBlogState({ pages = [], navLinkedBlog = false }) {
  const blogArticles = pages.filter((p) => p.pageType === "blog_article");
  const blogIndexes = pages.filter((p) => p.pageType === "blog_index");
  if (blogArticles.length > 0) return "blog_present";
  if (blogIndexes.length > 0) return "blog_link_present_but_no_articles";
  if (navLinkedBlog) return "blog_link_present_but_no_articles";
  return "blog_not_found";
}

// ---------------------------------------------------------------------------
// Offers (PART 8) — a concrete value exchange, never a raw generic heading.
// ---------------------------------------------------------------------------

const OFFER_VALUE_PATTERNS = [
  /\b\d{1,3}%\s*off\b/i,
  /\bfree\s+(trial|shipping|consultation|delivery|installation|month|quote)\b/i,
  /\b(discount|promo|bundle|package)\b/i,
  /\b(buy\s*1\s*get\s*1|bogo)\b/i,
  /\bmoney[-\s]back\s+guarantee\b/i,
  /(?:₱|php\s?|\$)\s?\d[\d,]*(?:\.\d{2})?/i,
  /\blimited[-\s](time|slots?|offer)\b/i
];

const OFFER_REJECT_PATTERNS = [
  /^best\s+deals?$/i,
  /^affordable\s+/i,
  /^conclusion$/i,
  /^learn\s+more$/i,
  /^great\s+value$/i
];

function looksLikeRealOffer(text) {
  if (!text) return false;
  if (OFFER_REJECT_PATTERNS.some((re) => re.test(text.trim()))) return false;
  return OFFER_VALUE_PATTERNS.some((re) => re.test(text));
}

function extractOffers(pages = []) {
  const offers = [];
  const offerPages = pages.filter((p) => ["offers", "pricing", "plans"].includes(p.pageType));
  const candidatePages = offerPages.length ? offerPages : pages;

  for (const page of candidatePages) {
    const textBlocks = [page.mainText, ...(page.headings || []).map((h) => h.text)];
    for (const block of textBlocks) {
      if (!block) continue;
      // Scan sentence-ish chunks rather than the whole page blob, so the
      // evidence excerpt is short and specific.
      const chunks = block.split(/(?<=[.!?])\s+|\n/).slice(0, 40);
      for (const chunk of chunks) {
        const trimmed = chunk.trim();
        if (trimmed.length > 4 && trimmed.length < 160 && looksLikeRealOffer(trimmed)) {
          offers.push(makeEvidence({
            statement: trimmed,
            sourceType: page.sourceType === "linked_subdomain" ? "linked_subdomain" : "website",
            sourceUrl: page.url,
            excerpt: trimmed,
            confidence: offerPages.length ? 0.7 : 0.5,
            entityType: "offer"
          }));
        }
      }
    }
  }

  // Dedup by normalized statement text.
  const seen = new Set();
  return offers.filter((o) => {
    const key = o.statement.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

// ---------------------------------------------------------------------------
// Products / services (PART 9) — discovered across multiple pages,
// consolidated, never one-heading-per-product with no regard for duplicates.
// ---------------------------------------------------------------------------

function normalizeNameForDedup(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function extractProductsAndServices(pages = []) {
  const relevantPages = pages.filter((p) => ["product", "product_category", "service", "service_category"].includes(p.pageType));
  const sourcePages = relevantPages.length ? relevantPages : pages.filter((p) => p.pageType === "homepage");

  const byKey = new Map();

  for (const page of sourcePages) {
    const type = ["product", "product_category"].includes(page.pageType) ? "product" : "service";
    const headingCandidates = (page.headings || []).filter((h) => h.level >= 2 && !isNonContentHeading(h.text));
    // On a dedicated single product/service page (pageType "product"/
    // "service"), the page's OWN title is itself a strong product/service
    // name candidate. A *category/listing* page ("product_category"/
    // "service_category") is a different case — its title is normally a
    // generic label for the whole category ("Services", "Our Products",
    // "Shop") rather than the name of one specific offering, so it must NOT
    // be captured as if it were a product/service — only its sub-headings
    // (the actual listed items) are candidates there. isNonContentHeading is
    // also applied to the title as a safety net against other generic
    // openers ("Home", "Welcome", etc.).
    const isSingleItemPage = page.pageType === "product" || page.pageType === "service";
    const titleCandidate = isSingleItemPage && page.title ? { level: 1, text: page.title.split(/[-|–]/)[0].trim() } : null;
    const nameCandidates = relevantPages.length
      ? [...(titleCandidate && !isNonContentHeading(titleCandidate.text) ? [titleCandidate] : []), ...headingCandidates]
      : headingCandidates;

    for (const heading of nameCandidates) {
      const name = heading.text.trim();
      if (!name || name.length > 80) continue;
      const key = normalizeNameForDedup(name);
      if (!key) continue;
      if (!byKey.has(key)) {
        byKey.set(key, {
          id: key.replace(/\s+/g, "-").slice(0, 40),
          name,
          type: relevantPages.length ? type : "service",
          category: null,
          description: page.metaDescription || null,
          features: [],
          functionalBenefits: [],
          businessOutcomes: [],
          customerProblemsSolved: [],
          idealCustomers: [],
          price: null,
          offer: null,
          availability: null,
          sourceUrls: [],
          evidence: [],
          confidence: relevantPages.length ? 0.65 : 0.35
        });
      }
      const entry = byKey.get(key);
      if (!entry.sourceUrls.includes(page.url)) entry.sourceUrls.push(page.url);
      entry.evidence.push(makeEvidence({
        statement: `"${name}" found on ${page.pageType} page`,
        sourceType: page.sourceType === "linked_subdomain" ? "linked_subdomain" : "website",
        sourceUrl: page.url,
        excerpt: name,
        confidence: entry.confidence,
        entityType: relevantPages.length ? "product_or_service" : "product_or_service_weak"
      }));
    }
  }

  return [...byKey.values()].slice(0, 12);
}

// ---------------------------------------------------------------------------
// Feature / functional-benefit / business-outcome separation (PART 13)
// ---------------------------------------------------------------------------

const BENEFIT_VERB_PATTERN = /\b(save|saves|saving|reduce|reduces|faster|easier|improve|improves|increase|increases|less|more|simplify|simplifies|convenient|convenience|effortless|hassle-free|automate|automates)\b/i;

/**
 * Classifies a short heading/phrase as a feature (a concrete capability) or
 * a functional benefit (a stated improvement) using surface language only —
 * never invents which one it "really" is beyond what the wording supports.
 */
function classifyFeatureOrBenefit(text) {
  return BENEFIT_VERB_PATTERN.test(text) ? "functional_benefit" : "feature";
}

/**
 * Builds features[] and functionalBenefits[] from crawled headings across
 * all pages (not just product/service pages — differentiator/benefit
 * language often lives on the homepage or an about page too).
 */
function extractFeaturesAndBenefits(pages = []) {
  const features = [];
  const functionalBenefits = [];
  const seen = new Set();

  for (const page of pages) {
    for (const heading of page.headings || []) {
      const text = heading.text.trim();
      if (!text || text.length > 100) continue;
      const key = normalizeNameForDedup(text);
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = classifyFeatureOrBenefit(text) === "functional_benefit" ? functionalBenefits : features;
      bucket.push(makeEvidence({
        statement: text,
        sourceType: page.sourceType === "linked_subdomain" ? "linked_subdomain" : "website",
        sourceUrl: page.url,
        excerpt: text,
        confidence: 0.5,
        entityType: classifyFeatureOrBenefit(text)
      }));
    }
  }

  return { features: features.slice(0, 10), functionalBenefits: functionalBenefits.slice(0, 10) };
}

/**
 * Business outcomes are one level MORE interpretive than a functional
 * benefit (PART 13 example: feature "customer portal" -> benefit "easier
 * reporting" -> outcome "less administrative effort"). Deriving this from
 * regex alone would require fabricating the "so that" clause, so this
 * module only ever returns outcomes explicitly tagged as `sourceType:
 * "inference"` — never presented as a verified website claim (PART 12) —
 * and only when there is at least one real feature+benefit pair to derive
 * from. The optional AI enrichment layer (extraction.js) is better suited
 * to writing good outcome language and may add more; this keeps a safe,
 * always-available floor.
 */
function deriveBusinessOutcomes({ features, functionalBenefits }) {
  if (!functionalBenefits.length) return [];
  return functionalBenefits.slice(0, 3).map((benefit) => makeEvidence({
    statement: `Possible outcome for the customer: ${benefit.statement.replace(/\.$/, "")} may reduce day-to-day effort or delay.`,
    sourceType: "inference",
    sourceUrl: benefit.sourceUrl,
    excerpt: benefit.statement,
    confidence: 0.3,
    entityType: "business_outcome"
  }));
}

// ---------------------------------------------------------------------------
// Proof (testimonials/rating/review count/customer count/years/awards/etc.)
// — extended across ALL crawled pages, not just the homepage.
// ---------------------------------------------------------------------------

const RATING_PATTERN = /\b([0-4](?:\.\d)?|5(?:\.0)?)\s*(?:\/\s*5|out of 5|stars?)\b/i;
const REVIEW_COUNT_PATTERN = /\b(\d{1,5})\+?\s+(?:reviews?|ratings?)\b/i;
const CUSTOMER_COUNT_PATTERN = /\b(\d{2,7})\+?\s+(?:customers?|clients?|businesses?|companies)\b/i;
const YEARS_PATTERN = /(?:since\s+((?:19|20)\d{2})|(\d{1,2})\+?\s+years?\s+(?:of\s+)?(?:experience|in business|serving))/i;
const AWARD_PATTERN = /\b(award|winner|awarded|certified|accredited)\b[^.]{0,80}/i;
const GUARANTEE_PATTERN = /\b(money[-\s]back guarantee|satisfaction guaranteed|warranty)\b[^.]{0,80}/i;
const TESTIMONIAL_BLOCK_PATTERN = /["“]([^"”]{15,220})["”]\s*[-–—]\s*([A-Z][A-Za-z.'\s]{1,40})/g;

function extractProof(pages = []) {
  const proof = {
    testimonials: [],
    rating: null,
    reviewCount: null,
    customerCount: null,
    yearsInBusiness: null,
    awards: [],
    certifications: [],
    guarantees: []
  };

  for (const page of pages) {
    const text = page.mainText || "";

    if (proof.rating === null) {
      const m = text.match(RATING_PATTERN);
      if (m) proof.rating = { value: Number(m[1]), sourceUrl: page.url, excerpt: m[0] };
    }
    if (proof.reviewCount === null) {
      const m = text.match(REVIEW_COUNT_PATTERN);
      if (m) proof.reviewCount = { value: Number(m[1]), sourceUrl: page.url, excerpt: m[0] };
    }
    if (proof.customerCount === null) {
      const m = text.match(CUSTOMER_COUNT_PATTERN);
      if (m) proof.customerCount = { value: Number(m[1]), sourceUrl: page.url, excerpt: m[0] };
    }
    if (proof.yearsInBusiness === null) {
      const m = text.match(YEARS_PATTERN);
      if (m) {
        const years = m[2] ? Number(m[2]) : (new Date().getFullYear() - Number(m[1]));
        proof.yearsInBusiness = { value: years, sourceUrl: page.url, excerpt: m[0] };
      }
    }
    const awardMatch = text.match(AWARD_PATTERN);
    if (awardMatch && (page.pageType === "about" || page.pageType === "homepage")) {
      proof.awards.push(makeEvidence({ statement: awardMatch[0].trim(), sourceType: "website", sourceUrl: page.url, excerpt: awardMatch[0], confidence: 0.5, entityType: "award" }));
    }
    const guaranteeMatch = text.match(GUARANTEE_PATTERN);
    if (guaranteeMatch) {
      proof.guarantees.push(makeEvidence({ statement: guaranteeMatch[0].trim(), sourceType: "website", sourceUrl: page.url, excerpt: guaranteeMatch[0], confidence: 0.55, entityType: "guarantee" }));
    }

    if (page.pageType === "testimonial" || /testimonial/i.test(page.title || "")) {
      let match;
      TESTIMONIAL_BLOCK_PATTERN.lastIndex = 0;
      while ((match = TESTIMONIAL_BLOCK_PATTERN.exec(text)) && proof.testimonials.length < 5) {
        proof.testimonials.push({ quote: match[1].trim(), attribution: match[2].trim(), sourceText: match[0], sourceUrl: page.url });
      }
    }
  }

  return proof;
}

module.exports = {
  extractContacts,
  detectBlogState,
  extractOffers,
  extractProductsAndServices,
  extractFeaturesAndBenefits,
  deriveBusinessOutcomes,
  extractProof,
  looksLikeRealOffer,
  classifyFeatureOrBenefit
};
