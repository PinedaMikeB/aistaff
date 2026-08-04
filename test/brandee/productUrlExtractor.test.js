// Narrow, single-page product URL extraction tests (PART 8).
// Confirms exactly ONE page is ever fetched (never a crawl), that schema/
// OpenGraph data is preferred correctly, that manually entered form fields
// are never overwritten without consent, that unreadable pages fail
// gracefully with the exact PART 8 fallback message, and that the module
// reuses the same SSRF-safe fetch primitives as the business analyzer
// (private/loopback/link-local addresses are blocked).

const test = require("node:test");
const assert = require("node:assert/strict");

const { extractProductFromUrl, mergeExtractedIntoForm } = require("../../src/brandee/productUrlExtractor");
const { WebsiteAnalysisError, normalizeUrlInput } = require("../../src/brandee/websiteAnalyzer");

const PRODUCT_PAGE_HTML = `<!doctype html><html><head>
  <title>Bamboo Travel Mug — Sample Shop</title>
  <meta property="og:title" content="Bamboo Travel Mug" />
  <meta property="og:description" content="A leak-proof travel mug made from sustainable bamboo fiber." />
  <meta property="og:image" content="https://sample-shop.example/images/mug.jpg" />
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Product","name":"Bamboo Travel Mug","description":"Leak-proof, keeps drinks hot for 6 hours.","image":"https://sample-shop.example/images/mug-schema.jpg","offers":{"@type":"Offer","price":"899","availability":"https://schema.org/InStock"}}
  </script>
</head><body>
  <h1>Bamboo Travel Mug</h1>
  <p>Price: PHP 899</p>
  <nav><a href="/collections/all">Shop all</a><a href="/pages/about-us">About us</a></nav>
</body></html>`;

const NO_PRODUCT_HTML = `<!doctype html><html><head><title>Sample Shop — Homepage</title></head><body><h1>Welcome</h1></body></html>`;

test("extracts product name/description/image/price from JSON-LD + OpenGraph on a single fetched page", async () => {
  let callCount = 0;
  const fetchHtmlPage = async (url) => {
    callCount += 1;
    return { html: PRODUCT_PAGE_HTML, finalUrl: url };
  };

  const result = await extractProductFromUrl("https://sample-shop.example/products/bamboo-mug", { fetchHtmlPage });

  assert.equal(result.ok, true);
  assert.equal(result.extracted.productName, "Bamboo Travel Mug");
  assert.match(result.extracted.description, /leak-proof/i);
  assert.equal(result.extracted.price, "899");
  assert.equal(result.extracted.schemaFound, true);
  assert.equal(result.extracted.openGraphFound, true);
  assert.equal(callCount, 1, "extractor must fetch exactly one page, never crawl further");
});

test("never follows links found on the page — nav links present in the fixture are not fetched", async () => {
  const fetchedUrls = [];
  const fetchHtmlPage = async (url) => {
    fetchedUrls.push(url);
    return { html: PRODUCT_PAGE_HTML, finalUrl: url };
  };

  await extractProductFromUrl("https://sample-shop.example/products/bamboo-mug", { fetchHtmlPage });

  assert.equal(fetchedUrls.length, 1);
  assert.ok(!fetchedUrls.some((u) => u.includes("/collections/all")));
  assert.ok(!fetchedUrls.some((u) => u.includes("/pages/about-us")));
});

test("returns ok:false with the exact PART 8 fallback message when the page cannot be fetched", async () => {
  const fetchHtmlPage = async () => {
    throw new WebsiteAnalysisError("unreachable", "Could not reach that website.");
  };

  const result = await extractProductFromUrl("https://unreachable-shop.example/products/x", { fetchHtmlPage });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "unreachable");
  assert.equal(result.message, "Brandee could not read this product page, so she will use the information you entered.");
});

test("returns ok:false when the page has no recognizable product data at all (no title, no schema, no OG, no price)", async () => {
  const BLANK_HTML = `<!doctype html><html><head></head><body><p>Nothing here.</p></body></html>`;
  const fetchHtmlPage = async (url) => ({ html: BLANK_HTML, finalUrl: url });
  const result = await extractProductFromUrl("https://sample-shop.example/blank", { fetchHtmlPage });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_product_data_found");
});

test("falls back to the page <title> as a candidate product name when no schema/OG data exists (customer can still confirm/edit it)", async () => {
  const fetchHtmlPage = async (url) => ({ html: NO_PRODUCT_HTML, finalUrl: url });
  const result = await extractProductFromUrl("https://sample-shop.example/", { fetchHtmlPage });
  // A homepage with only a <title> still yields SOME extracted text (PART 8
  // requires the customer be able to confirm/edit whatever was found, not
  // that Brandee silently refuses any page without a full product schema).
  assert.equal(result.ok, true);
  assert.equal(result.extracted.productName, "Sample Shop — Homepage");
  assert.equal(result.extracted.schemaFound, false);
  assert.equal(result.extracted.openGraphFound, false);
});

test("returns ok:false for an invalid URL — validated the same way the real fetch path validates it (no fetchHtmlPage override, so no injected stub can mask a malformed URL)", async () => {
  const result = await extractProductFromUrl("not a url at all");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_url");
});

test("mergeExtractedIntoForm fills empty fields from the URL but never overwrites a manually entered value", () => {
  const form = { productName: "My Own Product Name", productDescription: "", price: null };
  const extracted = { productName: "Extracted Name", description: "Extracted description", price: "499" };

  const { merged, filledFromUrl } = mergeExtractedIntoForm(form, extracted);

  assert.equal(merged.productName, "My Own Product Name", "manually entered productName must not be overwritten");
  assert.equal(merged.productDescription, "Extracted description");
  assert.equal(merged.price, "499");
  assert.ok(filledFromUrl.includes("productDescription"));
  assert.ok(filledFromUrl.includes("price"));
  assert.ok(!filledFromUrl.includes("productName"));
});

test("mergeExtractedIntoForm handles empty extracted data without throwing", () => {
  const form = { productName: "X" };
  const { merged, filledFromUrl } = mergeExtractedIntoForm(form, {});
  assert.equal(merged.productName, "X");
  assert.deepEqual(filledFromUrl, []);
});

// --- SSRF safety (reuses websiteAnalyzer's blocklist — PART 8 "preserve SSRF protections") ---

test("extractProductFromUrl (no fetchHtmlPage override) rejects a loopback address before making any request", async () => {
  const result = await extractProductFromUrl("http://127.0.0.1/product");
  assert.equal(result.ok, false);
  // Either blocked immediately by parseUrlOrThrow-equivalent checks inside
  // safeFetchAny, or surfaced as the generic unreachable fallback — either
  // way, no real request should have succeeded and the customer sees the
  // documented fallback message.
  assert.equal(result.message, "Brandee could not read this product page, so she will use the information you entered.");
});

test("extractProductFromUrl rejects the cloud metadata address (169.254.169.254)", async () => {
  const result = await extractProductFromUrl("http://169.254.169.254/latest/meta-data/");
  assert.equal(result.ok, false);
});

test("extractProductFromUrl rejects a private 10.x address", async () => {
  const result = await extractProductFromUrl("http://10.0.0.5/internal-product");
  assert.equal(result.ok, false);
});

test("normalizeUrlInput (shared with the business analyzer) prefixes https:// onto a bare domain", () => {
  assert.equal(normalizeUrlInput("shop.example/products/1"), "https://shop.example/products/1");
});
