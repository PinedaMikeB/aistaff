// Generic sanitized fixture only — never the owner's real business/website
// (see test/fixtures/generic-business.html, a fictional "BrightDesk
// Solutions" office-equipment-rental business).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  normalizeUrlInput,
  parseUrlOrThrow,
  isBlockedIp,
  assertHostResolvesToPublicIp,
  extractStructuredContent,
  buildHeuristicAnalysis
} = require("../../src/brandee/websiteAnalyzer");
const { WebsiteBusinessAnalysisSchema } = require("../../src/brandee/schemas");

test("normalizeUrlInput adds https:// when protocol is missing", () => {
  assert.equal(normalizeUrlInput("sample-co.example"), "https://sample-co.example");
  assert.equal(normalizeUrlInput("  sample-co.example  "), "https://sample-co.example");
  assert.equal(normalizeUrlInput("http://sample-co.example"), "http://sample-co.example");
});

test("parseUrlOrThrow rejects localhost", () => {
  try {
    parseUrlOrThrow(normalizeUrlInput("http://localhost:3000/admin"));
    assert.fail("expected throw");
  } catch (err) {
    assert.equal(err.code, "blocked_host");
  }
});

test("parseUrlOrThrow rejects unsupported protocols (file:, ftp:)", () => {
  for (const url of ["file:///etc/passwd", "ftp://example.com/file"]) {
    try {
      parseUrlOrThrow(url);
      assert.fail(`expected throw for ${url}`);
    } catch (err) {
      assert.equal(err.code, "unsupported_protocol");
    }
  }
});

test("isBlockedIp blocks private/loopback/link-local ranges", () => {
  const blocked = ["127.0.0.1", "10.1.2.3", "172.16.5.5", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1"];
  for (const ip of blocked) assert.equal(isBlockedIp(ip), true, `expected ${ip} to be blocked`);
});

test("isBlockedIp allows public IPs", () => {
  const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34"];
  for (const ip of allowed) assert.equal(isBlockedIp(ip), false, `expected ${ip} to be allowed`);
});

test("assertHostResolvesToPublicIp rejects an IP-literal private address (covers the post-redirect revalidation path)", async () => {
  await assert.rejects(() => assertHostResolvesToPublicIp("127.0.0.1"), (err) => err.code === "blocked_host");
  await assert.rejects(() => assertHostResolvesToPublicIp("169.254.169.254"), (err) => err.code === "blocked_host");
  await assert.rejects(() => assertHostResolvesToPublicIp("192.168.0.5"), (err) => err.code === "blocked_host");
});

test("assertHostResolvesToPublicIp allows a public IP literal", async () => {
  await assert.doesNotReject(() => assertHostResolvesToPublicIp("8.8.8.8"));
});

test("extractStructuredContent + buildHeuristicAnalysis parse the generic fixture into a schema-valid analysis", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "fixtures", "generic-business.html"), "utf8");
  const structured = extractStructuredContent(html);
  assert.match(structured.title, /BrightDesk Solutions/);
  assert.ok(structured.metaDescription.includes("office equipment rental"));
  assert.deepEqual(structured.h1s, ["Office Equipment Rental for Businesses"]);

  const analysis = buildHeuristicAnalysis({ sourceUrl: "https://sample-co.example/", structured });
  const check = WebsiteBusinessAnalysisSchema.safeParse(analysis);
  assert.equal(check.success, true, check.success ? "" : JSON.stringify(check.error.format()));

  assert.equal(analysis.businessType, "service");
  // contactMethods is now a structured ExtractedContact[] ({type, value}),
  // not a flat string[] — assert against the structured shape.
  const contactValues = analysis.contactMethods.map((c) => c.value);
  assert.ok(contactValues.includes("hello@brightdesk-solutions.example"));
  assert.ok(contactValues.includes("09171234567"));
  assert.equal(analysis.proof.yearsInBusiness.value, new Date().getFullYear() - 2015);
  // Generic section headings ("Why choose us", "Our Services", "Contact") must not
  // be reported as if they were product/service names.
  const productNames = analysis.productsOrServices.map((p) => p.name);
  assert.ok(!productNames.includes("Why choose us"));
  assert.ok(!productNames.includes("Contact"));
  assert.ok(productNames.includes("Desk Equipment Rental"));
});

test("extractStructuredContent strips <nav> and <footer> noise", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "fixtures", "generic-business.html"), "utf8");
  const structured = extractStructuredContent(html);
  assert.ok(!structured.visibleText.includes("All rights reserved"));
});
