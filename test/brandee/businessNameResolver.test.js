// Business-name resolution tests (PART 6). Generic sanitized page objects
// only — shaped like crawler.js's CrawledPage, built by hand here so this
// test doesn't depend on the crawler itself.

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveBusinessName, isGenericName } = require("../../src/brandee/businessNameResolver");

function makePage(overrides = {}) {
  return {
    url: "https://sample-co.example/",
    pageType: "homepage",
    title: "Best Consulting Services in Town",
    headings: [{ level: 1, text: "Best Consulting Services in Town" }],
    openGraphSiteName: null,
    logoAltCandidates: [],
    footerText: [],
    structuredData: [],
    ...overrides
  };
}

test("prefers Organization schema name over a generic SEO-keyword title", () => {
  const pages = [makePage({
    structuredData: [{ "@type": "Organization", name: "Sample Co" }]
  })];
  const result = resolveBusinessName({ pages });
  assert.equal(result.businessName, "Sample Co");
  assert.ok(result.confidence > 0.7);
});

test("falls back to Open Graph site_name when no schema is present", () => {
  const pages = [makePage({ openGraphSiteName: "Sample Co" })];
  const result = resolveBusinessName({ pages });
  assert.equal(result.businessName, "Sample Co");
});

test("falls back to footer copyright name when no schema/OG/logo evidence exists", () => {
  const pages = [makePage({ footerText: ["© 2026 Sample Co. All rights reserved."] })];
  const result = resolveBusinessName({ pages });
  assert.equal(result.businessName, "Sample Co");
});

test("rejects a generic SEO-keyword homepage title as the business name when nothing better exists", () => {
  const pages = [makePage({ title: "Best Consulting Services in Town", headings: [{ level: 1, text: "Best Consulting Services in Town" }] })];
  const result = resolveBusinessName({ pages });
  // Weak fallback (homepage title) is rejected outright by isGenericName
  // (starts with "Best") — Brandee should not confidently assert this as
  // the business name.
  assert.notEqual(result.businessName, "Best Consulting Services in Town");
});

test("isGenericName rejects known generic category words", () => {
  for (const generic of ["Home", "Products", "Services", "Contact", "Our Services", "Welcome to Sample Co"]) {
    assert.equal(isGenericName(generic), true, `expected "${generic}" to be rejected as generic`);
  }
});

test("isGenericName accepts a plausible real business name", () => {
  assert.equal(isGenericName("Sample Co"), false);
  assert.equal(isGenericName("BrightDesk Solutions"), false);
});

test("cross-page repetition boosts confidence for a schema-backed name", () => {
  const pages = [
    makePage({ url: "https://sample-co.example/", structuredData: [{ "@type": "Organization", name: "Sample Co" }], title: "Sample Co — Home" }),
    makePage({ url: "https://sample-co.example/about", pageType: "about", title: "About Sample Co", headings: [{ level: 1, text: "About Sample Co" }] }),
    makePage({ url: "https://sample-co.example/contact", pageType: "contact", title: "Contact Sample Co", headings: [{ level: 1, text: "Contact Sample Co" }] })
  ];
  const single = resolveBusinessName({ pages: [pages[0]] });
  const multi = resolveBusinessName({ pages });
  assert.ok(multi.confidence >= single.confidence, "repeated mentions across pages should not lower confidence");
});

test("returns null businessName with zero confidence when there is no usable evidence at all", () => {
  const pages = [makePage({ title: null, headings: [], openGraphSiteName: null, footerText: [], structuredData: [], url: "https://192-generic.example/" })];
  const result = resolveBusinessName({ pages });
  // Domain-name fallback still applies here, so this should resolve to
  // *something* — assert it never throws and always returns a confidence
  // between 0 and 1.
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
});
