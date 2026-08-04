// Orchestrates the multi-page crawl + entity extraction + business-name
// resolution into a single BusinessProfile object (PART 14). This is the
// new entry point the analyze route calls instead of the old single-page
// "fetch homepage, regex it" flow.
//
// Kept as its own module (rather than folded into websiteAnalyzer.js) to
// avoid a circular require: crawler.js already depends on websiteAnalyzer.js
// for the SSRF-safe fetch primitives, so the orchestrator that depends on
// BOTH crawler.js and websiteAnalyzer.js has to live one level up.

const { discoverAndCrawl, getCrawlConfig } = require("./crawler");
const { resolveBusinessName } = require("./businessNameResolver");
const {
  extractContacts,
  detectBlogState,
  extractOffers,
  extractProductsAndServices,
  extractFeaturesAndBenefits,
  deriveBusinessOutcomes,
  extractProof
} = require("./entityExtraction");
const { makeEvidence } = require("./evidenceModel");
const { normalizeUrlInput } = require("./websiteAnalyzer");

const SERVICE_HINTS = ["rental", "rent", "service", "repair", "maintenance", "installation", "consultation", "leasing", "booking", "appointment"];
const PRODUCT_HINTS = ["shop", "store", "buy", "order", "product", "shipping", "catalog", "add to cart"];

function guessBusinessType({ pages, productsOrServices }) {
  const combinedText = pages.map((p) => `${p.title || ""} ${p.mainText || ""}`).join(" ").toLowerCase();
  const serviceScore = SERVICE_HINTS.filter((kw) => combinedText.includes(kw)).length
    + productsOrServices.filter((p) => p.type === "service").length;
  const productScore = PRODUCT_HINTS.filter((kw) => combinedText.includes(kw)).length
    + productsOrServices.filter((p) => p.type === "product").length;
  if (serviceScore > 0 && productScore > 0) return "both";
  if (serviceScore > productScore) return "service";
  if (productScore > 0) return "product";
  return "unknown";
}

function buildSummary({ businessName, homepage, productsOrServices }) {
  const parts = [];
  if (businessName) parts.push(businessName);
  if (homepage?.metaDescription) parts.push(homepage.metaDescription);
  else if (homepage?.headings?.[0]?.text) parts.push(homepage.headings[0].text);
  if (productsOrServices.length) parts.push(`Offers: ${productsOrServices.slice(0, 3).map((p) => p.name).join(", ")}`);
  const summary = parts.filter(Boolean).join(" — ").slice(0, 400);
  return summary || "Brandee could not find a clear summary on this website.";
}

/**
 * Builds a full BusinessProfile (schemas.js WebsiteBusinessAnalysisSchema /
 * BusinessProfileSchema) from a submitted URL via the real multi-page
 * crawler. Never throws for ordinary crawl issues — a page that can't be
 * reached simply yields fewer crawled pages, reflected honestly in
 * `crawlSummary`/`fetchStatus`/`confirmationRequired`, exactly like the
 * previous single-page heuristic extractor's manual-fallback contract.
 */
async function buildBusinessProfile({ rootUrl, form, fetchHtmlPage, fetchTextResource, config = getCrawlConfig() } = {}) {
  const normalizedRoot = normalizeUrlInput(rootUrl);
  const { pages, diagnostics } = await discoverAndCrawl({ rootUrl: normalizedRoot, form, fetchHtmlPage, fetchTextResource, config });

  if (!pages.length) {
    return {
      sourceUrl: normalizedRoot,
      crawlSummary: { pagesDiscovered: diagnostics.pagesDiscovered, pagesCrawled: 0, pagesRejected: diagnostics.pagesRejected, subdomainsCrawled: [], pageTypes: {}, warnings: diagnostics.warnings },
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
      differentiators: [],
      offers: [],
      callsToAction: [],
      contactMethods: [],
      locations: [],
      blogState: "unknown",
      proof: { testimonials: [], reviewCount: null, rating: null, customerCount: null, yearsInBusiness: null, awards: [], certifications: [], guarantees: [] },
      brandTone: [],
      claimsFound: [],
      evidence: [],
      inferences: [],
      missingInformation: ["Everything — Brandee could not read the website automatically"],
      contradictions: [],
      confirmationRequired: true,
      confirmationReasons: ["Brandee could not read any page of this website automatically."],
      confidence: 0.1,
      fetchStatus: "unreachable"
    };
  }

  const { businessName, confidence: businessNameConfidence, evidence: nameEvidence } = resolveBusinessName({ pages });
  const productsOrServices = extractProductsAndServices(pages);
  const contacts = extractContacts(pages);
  const offerEvidence = extractOffers(pages);
  const { features, functionalBenefits } = extractFeaturesAndBenefits(pages);
  const businessOutcomeEvidence = deriveBusinessOutcomes({ features, functionalBenefits });
  const proof = extractProof(pages);
  const blogState = detectBlogState({
    pages,
    navLinkedBlog: pages.some((p) => (p.navigationText || []).some((t) => /\bblog\b|\bnews\b|\barticles\b/i.test(t)))
  });
  const businessType = guessBusinessType({ pages, productsOrServices });
  const homepage = pages.find((p) => p.pageType === "homepage") || pages[0];

  const callsToAction = [...new Set(pages.flatMap((p) => (p.callsToAction || []).map((c) => c.text)))].slice(0, 8);

  const evidence = [
    ...nameEvidence,
    ...productsOrServices.flatMap((p) => p.evidence),
    ...features,
    ...functionalBenefits,
    ...businessOutcomeEvidence,
    ...offerEvidence,
    ...proof.awards,
    ...proof.guarantees,
    ...proof.certifications,
    ...contacts.map((c) => makeEvidence({
      statement: `Contact method found: ${c.type} (${c.value})`,
      sourceType: c.sourceUrl && new URL(c.sourceUrl).hostname !== new URL(normalizedRoot).hostname ? "linked_subdomain" : "website",
      sourceUrl: c.sourceUrl,
      excerpt: c.value,
      confidence: 0.75,
      entityType: "contact_method"
    }))
  ];

  const missingInformation = [];
  if (!contacts.length) missingInformation.push("A direct contact method");
  if (!offerEvidence.length) missingInformation.push("A confirmed offer, discount, or package");
  if (!proof.testimonials.length) missingInformation.push("A verified testimonial");
  if (proof.reviewCount === null) missingInformation.push("Verified review count");
  if (proof.rating === null) missingInformation.push("Verified rating");
  if (proof.yearsInBusiness === null) missingInformation.push("Years in business");
  if (blogState === "blog_not_found") missingInformation.push("No blog was found on this website");
  else if (blogState === "blog_link_present_but_no_articles") missingInformation.push("A blog link exists but no published articles were found");

  const confirmationReasons = [];
  if (businessNameConfidence < 0.4) confirmationReasons.push("Brandee is not fully confident about the business name.");
  if (!productsOrServices.length) confirmationReasons.push("Brandee could not confidently identify specific products or services.");
  if (!contacts.length) confirmationReasons.push("Brandee could not find a direct contact method on the website.");
  if (diagnostics.pagesCrawled < 2) confirmationReasons.push("Brandee could only read a limited number of pages on this website.");
  if (!form?.idealCustomer) confirmationReasons.push("Ideal audience was not clearly confirmed.");

  const confidence = Math.max(0.15, Math.min(0.9,
    0.2
    + (businessNameConfidence * 0.25)
    + (productsOrServices.length ? 0.2 : 0)
    + (contacts.length ? 0.15 : 0)
    + (diagnostics.pagesCrawled >= 3 ? 0.15 : diagnostics.pagesCrawled >= 1 ? 0.05 : 0)
  ));

  return {
    sourceUrl: homepage?.url || normalizedRoot,
    crawlSummary: {
      pagesDiscovered: diagnostics.pagesDiscovered,
      pagesCrawled: diagnostics.pagesCrawled,
      pagesRejected: diagnostics.pagesRejected,
      subdomainsCrawled: diagnostics.subdomainsCrawled,
      pageTypes: diagnostics.pageTypes,
      warnings: diagnostics.warnings
    },
    sourceMode: "website_and_manual",
    businessName,
    businessNameConfidence,
    businessType,
    industry: null, // populated only by optional AI enrichment (extraction.js) — never guessed heuristically
    summary: buildSummary({ businessName, homepage, productsOrServices }),
    productsOrServices,
    targetAudienceSignals: [],
    primaryProblemsSolved: [],
    customerDesires: [],
    features: features.map((f) => f.statement),
    functionalBenefits: functionalBenefits.map((f) => f.statement),
    businessOutcomes: businessOutcomeEvidence.map((o) => o.statement),
    primaryBenefits: functionalBenefits.map((f) => f.statement),
    differentiators: [],
    offers: offerEvidence.map((o) => o.statement),
    callsToAction,
    contactMethods: contacts,
    locations: [],
    blogState,
    proof,
    brandTone: [],
    claimsFound: evidence.map((e) => e.statement),
    evidence,
    inferences: evidence.filter((e) => e.sourceType === "inference"),
    missingInformation,
    contradictions: [],
    confirmationRequired: confirmationReasons.length > 0,
    confirmationReasons,
    confidence,
    fetchStatus: "ok"
  };
}

module.exports = { buildBusinessProfile };
