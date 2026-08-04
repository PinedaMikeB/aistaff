// Entity extraction tests (PARTS 8-11). Generic hand-built CrawledPage-shaped
// fixtures — no real business data.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractContacts,
  detectBlogState,
  extractOffers,
  extractProductsAndServices,
  extractFeaturesAndBenefits,
  deriveBusinessOutcomes,
  extractProof,
  looksLikeRealOffer
} = require("../../src/brandee/entityExtraction");

function makePage(overrides = {}) {
  return {
    url: "https://sample-co.example/",
    pageType: "homepage",
    sourceType: "same_domain",
    title: null,
    headings: [],
    mainText: "",
    callsToAction: [],
    mailtoLinks: [],
    telLinks: [],
    ...overrides
  };
}

test("extractContacts reads tel:/mailto: links from any page, not just the homepage", () => {
  const pages = [
    makePage({ url: "https://sample-co.example/", mailtoLinks: [], telLinks: [] }),
    makePage({ url: "https://sample-co.example/contact", pageType: "contact", mailtoLinks: ["hello@sample-co.example"], telLinks: ["+15551234567"] })
  ];
  const contacts = extractContacts(pages);
  const types = contacts.map((c) => c.type);
  assert.ok(types.includes("email"));
  assert.ok(types.includes("phone"));
  assert.ok(types.includes("contact_form"), "a contact-page visit itself is contact-form evidence");
});

test("extractContacts recognizes Messenger/WhatsApp links from CTAs", () => {
  const pages = [makePage({ pageType: "contact", callsToAction: [{ text: "Message us", href: "https://m.me/samplecopage" }] })];
  const contacts = extractContacts(pages);
  assert.ok(contacts.some((c) => c.type === "messenger"));
});

test("detectBlogState reports blog_not_found when no blog page/link exists at all", () => {
  const pages = [makePage()];
  assert.equal(detectBlogState({ pages, navLinkedBlog: false }), "blog_not_found");
});

test("detectBlogState reports blog_link_present_but_no_articles for an empty blog index (never fabricates content history)", () => {
  const pages = [makePage({ url: "https://sample-co.example/blog", pageType: "blog_index" })];
  assert.equal(detectBlogState({ pages, navLinkedBlog: true }), "blog_link_present_but_no_articles");
});

test("detectBlogState reports blog_present only when actual blog_article pages were crawled", () => {
  const pages = [
    makePage({ url: "https://sample-co.example/blog", pageType: "blog_index" }),
    makePage({ url: "https://sample-co.example/blog/first-post", pageType: "blog_article" })
  ];
  assert.equal(detectBlogState({ pages }), "blog_present");
});

test("looksLikeRealOffer requires a concrete value exchange, rejects generic headings", () => {
  assert.equal(looksLikeRealOffer("Best deals"), false);
  assert.equal(looksLikeRealOffer("Conclusion"), false);
  assert.equal(looksLikeRealOffer("Learn more"), false);
  assert.equal(looksLikeRealOffer("20% off your first month"), true);
  assert.equal(looksLikeRealOffer("Free consultation this week"), true);
});

test("extractOffers never returns a raw generic heading as an offer", () => {
  const pages = [makePage({
    pageType: "pricing",
    headings: [{ level: 2, text: "Best deals" }, { level: 2, text: "Conclusion" }],
    mainText: "Best deals. Conclusion. Get 15% off your first invoice this month."
  })];
  const offers = extractOffers(pages);
  assert.ok(!offers.some((o) => /best deals/i.test(o.statement)));
  assert.ok(!offers.some((o) => /^conclusion$/i.test(o.statement)));
  assert.ok(offers.some((o) => /15% off/i.test(o.statement)));
});

test("extractProductsAndServices does not treat a generic heading (Conclusion, Related Posts) as a product", () => {
  const pages = [makePage({
    pageType: "service_category",
    headings: [{ level: 2, text: "Consulting Package" }, { level: 2, text: "Conclusion" }, { level: 2, text: "Related Posts" }]
  })];
  const items = extractProductsAndServices(pages);
  const names = items.map((i) => i.name);
  assert.ok(names.includes("Consulting Package"));
  assert.ok(!names.includes("Conclusion"));
  assert.ok(!names.includes("Related Posts"));
});

test("extractProductsAndServices consolidates the same product found on multiple pages", () => {
  const pages = [
    makePage({ url: "https://sample-co.example/services", pageType: "service_category", headings: [{ level: 2, text: "Consulting Package" }] }),
    makePage({ url: "https://sample-co.example/services/consulting", pageType: "service", title: "Consulting Package", headings: [] })
  ];
  const items = extractProductsAndServices(pages);
  const consulting = items.filter((i) => i.name.toLowerCase().includes("consulting package"));
  assert.equal(consulting.length, 1, "the same product name across two pages must consolidate into one entry");
  assert.ok(consulting[0].sourceUrls.length >= 1);
});

test("extractFeaturesAndBenefits separates a feature (capability) from a functional benefit (stated improvement)", () => {
  const pages = [makePage({
    headings: [{ level: 2, text: "Customer Portal" }, { level: 2, text: "Easier Reporting And Monitoring" }]
  })];
  const { features, functionalBenefits } = extractFeaturesAndBenefits(pages);
  assert.ok(features.some((f) => f.statement === "Customer Portal"));
  assert.ok(functionalBenefits.some((b) => b.statement === "Easier Reporting And Monitoring"));
});

test("deriveBusinessOutcomes always tags outcomes as inference, never as a verified website claim", () => {
  const outcomes = deriveBusinessOutcomes({ features: [], functionalBenefits: [{ statement: "Easier reporting", sourceUrl: "https://sample-co.example/", sourceType: "website" }] });
  assert.ok(outcomes.length > 0);
  for (const o of outcomes) assert.equal(o.sourceType, "inference");
});

test("extractProof extracts rating/review count/years with source attribution and doesn't invent testimonials", () => {
  const pages = [makePage({ mainText: "Trusted since 2015. Rated 4.8 out of 5 by 120 reviews." })];
  const proof = extractProof(pages);
  assert.equal(proof.yearsInBusiness.value, new Date().getFullYear() - 2015);
  assert.equal(proof.rating.value, 4.8);
  assert.equal(proof.reviewCount.value, 120);
  assert.equal(proof.testimonials.length, 0, "no quoted testimonial text was present in the fixture");
});
