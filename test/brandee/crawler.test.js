// Multi-page crawler tests (PARTS 2-5). All network access is replaced with
// an injected in-memory fake site graph (`fetchHtmlPage`) — no real fetch is
// ever made, and no owner/real-business data is used anywhere here.

const test = require("node:test");
const assert = require("node:assert/strict");

const { discoverAndCrawl } = require("../../src/brandee/crawler");
const { normalizeUrlForCrawl, classifySourceType } = require("../../src/brandee/urlUtils");

const ROOT = "https://sample-co.example/";

function page({ nav = "", footer = "", body = "", title = "Sample Co" }) {
  return `<!doctype html><html><head><title>${title}</title></head><body>
    <nav>${nav}</nav>
    ${body}
    <footer>${footer}</footer>
  </body></html>`;
}

const SITE = {
  "https://sample-co.example/": page({
    title: "Sample Co - Generic Business Services",
    nav: `<a href="/about">About</a> <a href="/services">Services</a> <a href="/contact">Contact</a> <a href="/blog">Blog</a> <a href="https://portal.sample-co.example/login">Customer Portal</a> <a href="https://unrelated-external-site.example/">Partner site</a>`,
    footer: `&copy; 2026 Sample Co. All rights reserved.`,
    body: `<h1>Generic Business Services</h1><p>We help small businesses with generic services.</p>`
  }),
  "https://sample-co.example/about": page({
    title: "About - Sample Co",
    body: `<h1>About Sample Co</h1><p>Sample Co has been operating since 2018.</p>`
  }),
  "https://sample-co.example/services": page({
    title: "Services - Sample Co",
    body: `<h2>Consulting Package</h2><p>Our flagship offering.</p><h2>Support Plan</h2><p>Ongoing support.</p>`
  }),
  "https://sample-co.example/contact": page({
    title: "Contact - Sample Co",
    body: `<p>Email <a href="mailto:hello@sample-co.example">hello@sample-co.example</a> or call <a href="tel:+15551234567">+1 555 123 4567</a>. Message us on <a href="https://m.me/samplecopage">Messenger</a>.</p>`
  }),
  "https://sample-co.example/blog": page({
    title: "Blog - Sample Co",
    body: `<p>No posts yet — check back soon.</p>`
  }),
  "https://portal.sample-co.example/login": page({
    title: "Customer Portal Login",
    body: `<h1>Sign in to your account</h1>`
  })
};

function fakeFetchHtmlPage(url) {
  const normalized = normalizeUrlForCrawl(url) || url;
  const html = SITE[normalized] || SITE[url];
  if (!html) {
    const err = new Error(`404: ${url}`);
    throw err;
  }
  return Promise.resolve({ html, finalUrl: normalized });
}

async function fakeFetchTextResource() {
  throw new Error("no sitemap in this fixture");
}

const baseConfig = { maxPages: 20, maxDepth: 3, timeoutMs: 5000, maxResponseBytes: 1_500_000, allowSubdomains: true, maxSubdomains: 3 };

test("crawler discovers and crawls the homepage plus nav-linked pages", async () => {
  const { pages, diagnostics } = await discoverAndCrawl({ rootUrl: ROOT, form: {}, fetchHtmlPage: fakeFetchHtmlPage, fetchTextResource: fakeFetchTextResource, config: baseConfig });
  const urls = pages.map((p) => p.normalizedUrl);
  assert.ok(urls.includes("https://sample-co.example/"), "homepage must be crawled");
  assert.ok(urls.includes("https://sample-co.example/about"), "nav-linked about page must be crawled");
  assert.ok(urls.includes("https://sample-co.example/services"), "nav-linked services page must be crawled");
  assert.ok(urls.includes("https://sample-co.example/contact"), "nav-linked contact page must be crawled");
  assert.ok(diagnostics.pagesCrawled >= 4);
});

test("crawler classifies page types correctly (homepage/about/service/contact/blog_index)", async () => {
  const { pages } = await discoverAndCrawl({ rootUrl: ROOT, form: {}, fetchHtmlPage: fakeFetchHtmlPage, fetchTextResource: fakeFetchTextResource, config: baseConfig });
  const byUrl = Object.fromEntries(pages.map((p) => [p.normalizedUrl, p]));
  assert.equal(byUrl["https://sample-co.example/"].pageType, "homepage");
  assert.equal(byUrl["https://sample-co.example/about"].pageType, "about");
  assert.equal(byUrl["https://sample-co.example/services"].pageType, "service_category");
  assert.equal(byUrl["https://sample-co.example/contact"].pageType, "contact");
  assert.equal(byUrl["https://sample-co.example/blog"].pageType, "blog_index");
});

test("crawler captures tel:/mailto: links as contact evidence on the contact page", async () => {
  const { pages } = await discoverAndCrawl({ rootUrl: ROOT, form: {}, fetchHtmlPage: fakeFetchHtmlPage, fetchTextResource: fakeFetchTextResource, config: baseConfig });
  const contactPage = pages.find((p) => p.pageType === "contact");
  assert.ok(contactPage.mailtoLinks.includes("hello@sample-co.example"));
  assert.ok(contactPage.telLinks.some((t) => t.includes("5551234567")));
});

test("crawler follows a linked subdomain (customer portal) discovered in the homepage nav", async () => {
  const { pages, diagnostics } = await discoverAndCrawl({ rootUrl: ROOT, form: {}, fetchHtmlPage: fakeFetchHtmlPage, fetchTextResource: fakeFetchTextResource, config: baseConfig });
  const portalPage = pages.find((p) => p.normalizedUrl.includes("portal.sample-co.example"));
  assert.ok(portalPage, "linked subdomain must be crawled since it was discovered in nav");
  assert.equal(portalPage.sourceType, "linked_subdomain");
  assert.ok(diagnostics.subdomainsCrawled.includes("portal.sample-co.example"));
});

test("crawler never crawls an unrelated external domain even when linked", async () => {
  const { pages } = await discoverAndCrawl({ rootUrl: ROOT, form: {}, fetchHtmlPage: fakeFetchHtmlPage, fetchTextResource: fakeFetchTextResource, config: baseConfig });
  assert.ok(!pages.some((p) => p.normalizedUrl.includes("unrelated-external-site.example")));
});

test("crawler never guesses an unlinked subdomain (e.g. app.sample-co.example was never referenced anywhere)", async () => {
  const { pages } = await discoverAndCrawl({ rootUrl: ROOT, form: {}, fetchHtmlPage: fakeFetchHtmlPage, fetchTextResource: fakeFetchTextResource, config: baseConfig });
  assert.ok(!pages.some((p) => p.normalizedUrl.includes("app.sample-co.example")));
});

test("crawler enforces the configured page-count limit", async () => {
  const { diagnostics } = await discoverAndCrawl({ rootUrl: ROOT, form: {}, fetchHtmlPage: fakeFetchHtmlPage, fetchTextResource: fakeFetchTextResource, config: { ...baseConfig, maxPages: 2 } });
  assert.ok(diagnostics.pagesCrawled <= 2);
});

test("crawler detects a blog link with no published articles as blog_link_present_but_no_articles-eligible page type", async () => {
  const { pages } = await discoverAndCrawl({ rootUrl: ROOT, form: {}, fetchHtmlPage: fakeFetchHtmlPage, fetchTextResource: fakeFetchTextResource, config: baseConfig });
  const blogPage = pages.find((p) => p.normalizedUrl.endsWith("/blog"));
  assert.equal(blogPage.pageType, "blog_index");
});

test("normalizeUrlForCrawl strips tracking parameters so duplicate-looking URLs dedupe", () => {
  const a = normalizeUrlForCrawl("https://sample-co.example/services?utm_source=fb&utm_medium=cpc");
  const b = normalizeUrlForCrawl("https://sample-co.example/services");
  assert.equal(a, b);
});

test("classifySourceType distinguishes same_domain / linked_subdomain / linked_external", () => {
  assert.equal(classifySourceType("https://sample-co.example/about", "sample-co.example"), "same_domain");
  assert.equal(classifySourceType("https://portal.sample-co.example/login", "sample-co.example"), "linked_subdomain");
  assert.equal(classifySourceType("https://unrelated-external-site.example/", "sample-co.example"), "linked_external");
});
