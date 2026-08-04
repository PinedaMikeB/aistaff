// Landing page + deprecated-route copy assertions (PART 3/4/16/24/PART 23
// "Landing Page" test category). These read the actual shipped HTML files
// from disk (not a mock) so a future edit that silently reintroduces a
// removed claim, or drops the new hero copy, fails a real test.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const landingPath = path.join(__dirname, "..", "..", "public", "agents", "brandee", "index.html");
const createRedirectPath = path.join(__dirname, "..", "..", "public", "agents", "brandee", "create", "index.html");
const analyzeRedirectPath = path.join(__dirname, "..", "..", "public", "agents", "brandee", "analyze", "index.html");
const imagePagePath = path.join(__dirname, "..", "..", "public", "agents", "brandee", "image", "index.html");
const videoPagePath = path.join(__dirname, "..", "..", "public", "agents", "brandee", "video", "index.html");

const landingHtml = fs.readFileSync(landingPath, "utf8");

test("landing page files exist on disk", () => {
  for (const p of [landingPath, createRedirectPath, analyzeRedirectPath, imagePagePath, videoPagePath]) {
    assert.ok(fs.existsSync(p), `missing file: ${p}`);
  }
});

test("hero leads with the required product-upload headline", () => {
  assert.match(landingHtml, /Upload your product\. Brandee turns it into an ad\./);
});

test("hero shows 'No script, designer, or filming required.'", () => {
  assert.match(landingHtml, /No script, designer, or filming required\./);
});

test("primary CTAs are 'Create an Image Ad' and 'Create a Video Ad'", () => {
  assert.match(landingHtml, /Create an Image Ad/);
  assert.match(landingHtml, /Create a Video Ad/);
});

test("Image/Video Ad CTAs link to the new flow routes", () => {
  assert.match(landingHtml, /href="\/agents\/brandee\/image\/"/);
  assert.match(landingHtml, /href="\/agents\/brandee\/video\/"/);
});

test("landing page never mentions Guided Mode or Pro Mode as a first choice", () => {
  assert.doesNotMatch(landingHtml, /Guided Mode/);
  assert.doesNotMatch(landingHtml, /Pro Mode/);
});

test("landing page never uses 'Help me decide' / 'I know what I want' as the primary entry choice", () => {
  assert.doesNotMatch(landingHtml, /Help me decide/);
  assert.doesNotMatch(landingHtml, /I know what I want/);
});

test("landing page never promises full business/website analysis, campaign calendars, or complete marketing plans", () => {
  const forbidden = [
    /full business analysis/i,
    /complete marketing plan/i,
    /campaign calendar/i,
    /full campaign strategy/i,
    /audience[- ]awareness diagnos/i
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(landingHtml, pattern, `landing page still contains forbidden claim matching ${pattern}`);
  }
});

test("landing page does not promise 'Generate and publish' (publishing is not implemented)", () => {
  assert.doesNotMatch(landingHtml, /generate and publish/i);
});

test("pricing section shows exactly the three final plans at their exact published prices", () => {
  assert.match(landingHtml, /Image Starter/);
  assert.match(landingHtml, /₱599\/month/);
  assert.match(landingHtml, /Video Starter/);
  assert.match(landingHtml, /₱1,199\/month/);
  assert.match(landingHtml, /Brandee Combo/);
  assert.match(landingHtml, /₱2,999\/month/);
});

test("Brandee Combo is marked 'Best Value'", () => {
  assert.match(landingHtml, /Best Value/);
});

test("pricing section shows the ₱597 combo savings explanation", () => {
  assert.match(landingHtml, /Save ₱597/);
});

test("pricing section shows the non-VAT disclosure and never claims VAT is charged or included", () => {
  assert.match(landingHtml, /non-VAT registered/i);
  assert.doesNotMatch(landingHtml, /VAT included/i);
  // The page legitimately says "no 12% VAT is added" (a disclosure that VAT
  // is NOT charged) — what must never appear is the same figure presented
  // as an actual charge, e.g. "plus 12% VAT" or "12% VAT is added" without
  // the "no" that negates it.
  assert.doesNotMatch(landingHtml, /plus 12% VAT/i);
  assert.match(landingHtml, /no 12% VAT is added/i);
});

test("pricing section never uses the old 'X creatives' or combined 'static ads or videos' wording", () => {
  assert.doesNotMatch(landingHtml, /\d+\s+creatives/i);
  assert.doesNotMatch(landingHtml, /static ads or videos/i);
});

test("pricing section no longer shows the old Starter/Creator/Growth placeholder plan prices", () => {
  assert.doesNotMatch(landingHtml, /₱999\/month/);
  assert.doesNotMatch(landingHtml, /₱2,499\/month/);
  assert.doesNotMatch(landingHtml, /₱5,999\/month/);
});

test("pricing section does not display 'unlimited'", () => {
  assert.doesNotMatch(landingHtml, /unlimited/i);
});

test("Why Brandee section uses the required 'More than a template tool.' framing", () => {
  assert.match(landingHtml, /More than a template tool\./);
});

for (const [label, filePath] of [["create", createRedirectPath], ["analyze", analyzeRedirectPath]]) {
  test(`deprecated /agents/brandee/${label}/ route redirects to the new landing page (meta refresh + JS fallback)`, () => {
    const html = fs.readFileSync(filePath, "utf8");
    assert.match(html, /<meta http-equiv="refresh" content="0; url=\/agents\/brandee\/" \/>/);
    assert.match(html, /window\.location\.replace\("\/agents\/brandee\/"\)/);
    assert.match(html, /DEPRECATED/);
  });
}

test("the image-ad and video-ad flow pages have distinct, descriptive <title> tags", () => {
  const imageHtml = fs.readFileSync(imagePagePath, "utf8");
  const videoHtml = fs.readFileSync(videoPagePath, "utf8");
  assert.match(imageHtml, /<title>[^<]*Image Ad[^<]*<\/title>/i);
  assert.match(videoHtml, /<title>[^<]*Video Ad[^<]*<\/title>/i);
});
