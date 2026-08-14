/**
 * Rendered scraping with Playwright.
 *
 * WHY: page-intelligence.js is fetch + Open Graph regex. That works on simple
 * sites (marga.biz yielded 10 facts) and fails completely on anything that
 * renders prices with JavaScript. A Lazada product page returned the title and
 * the bag dimensions but NOT the ₱143 price, because the price is not in the
 * HTML that arrives over the wire.
 *
 * So: render the page in a real browser, read the text, and — when prices
 * still are not found — screenshot it and let Gemini vision read the pixels.
 * That is the same extractor the uploaded price-list path already uses, so
 * "the price is in an image" and "the price is in JavaScript" collapse into
 * one solution.
 *
 * DELIBERATELY NOT USED FOR FACEBOOK. Logged out, Facebook serves an error
 * page (measured: 1,542 bytes, <title>Error</title>) — rendering it would burn
 * ~500MB of Chromium to load a block page. Worse, automating a logged-in
 * session breaks Meta's terms and risks the published app that every client's
 * Messenger depends on (HANDOFF-CLOSER.md §12).
 */

const PAGE_TIMEOUT_MS = 20000;
const MAX_PAGES = 4;
const MAX_TILES = 3;
const VIEWPORT = { width: 1280, height: 900 };

/** Paths worth trying when a site does not link its catalogue obviously. */
const CANDIDATE_PATHS = [
  "/products", "/product", "/shop", "/store", "/menu", "/pricing",
  "/price", "/prices", "/services", "/catalog", "/rates", "/packages"
];

/** Link text that suggests prices live behind it — English and Filipino. */
const LINK_HINT = /(product|shop|store|menu|price|pricing|rate|package|service|catalog|order|paninda|presyo|serbisyo|bilihin)/i;

// Multi-currency. The first version matched only pesos, so a Shopify store
// priced in $100 was judged "no prices found" and needlessly escalated to
// vision — 24.5s and tokens spent to re-read a price already in the text.
const PRICE_PATTERN = /(₱|PHP|Php|\$|US\$|€|£|¥|SGD|MYR|THB|IDR|AUD|CAD)\s?\d[\d,]*(\.\d{2})?|\b\d{1,3},\d{3}(\.\d{2})?\b/;


/**
 * Which currency are these prices in?
 *
 * WHY THIS MATTERS: the price detector matches many currencies, but until now
 * nothing recorded WHICH one. A US Shopify store showing $100 was stored as a
 * bare number, so the agent could quote "100" to a customer who reasonably
 * reads it as ₱100. Quoting the wrong currency is a worse failure than
 * quoting no price at all — it is a number the customer will hold you to.
 *
 * Counts occurrences and returns the dominant one. Explicit ISO codes from
 * structured data outrank bare symbols, because "$" is ambiguous across USD,
 * CAD, AUD and SGD while "USD" is not.
 */
const CURRENCY_SIGNALS = [
  { code: "PHP", pattern: /₱|\bPHP\b|\bPhp\b/g, weight: 1 },
  { code: "USD", pattern: /\bUSD\b|\bUS\$/g, weight: 3 },
  { code: "CAD", pattern: /\bCAD\b|\bC\$/g, weight: 3 },
  { code: "AUD", pattern: /\bAUD\b|\bA\$/g, weight: 3 },
  { code: "SGD", pattern: /\bSGD\b|\bS\$/g, weight: 3 },
  { code: "EUR", pattern: /€|\bEUR\b/g, weight: 2 },
  { code: "GBP", pattern: /£|\bGBP\b/g, weight: 2 },
  { code: "JPY", pattern: /¥|\bJPY\b/g, weight: 2 },
  { code: "MYR", pattern: /\bMYR\b|\bRM\s?\d/g, weight: 3 },
  { code: "THB", pattern: /฿|\bTHB\b/g, weight: 2 },
  { code: "IDR", pattern: /\bIDR\b|\bRp\s?\d/g, weight: 3 },
  { code: "VND", pattern: /₫|\bVND\b/g, weight: 2 }
];

function detectCurrency(text, fallbackDomain) {
  const body = String(text || "");
  let best = null;
  let bestScore = 0;

  for (const signal of CURRENCY_SIGNALS) {
    const hits = (body.match(signal.pattern) || []).length;
    if (!hits) continue;
    const score = hits * signal.weight;
    if (score > bestScore) { bestScore = score; best = signal.code; }
  }

  // A bare "$" with no ISO code anywhere: ambiguous. Fall back to the domain,
  // which is a better guess than assuming dollars are American.
  if (!best && /\$\s?\d/.test(body)) {
    const host = String(fallbackDomain || "").toLowerCase();
    if (host.endsWith(".ca")) return "CAD";
    if (host.endsWith(".au")) return "AUD";
    if (host.endsWith(".sg")) return "SGD";
    if (host.endsWith(".ph")) return "PHP";
    return "USD";
  }
  return best;
}

function hasPrices(text) {
  return PRICE_PATTERN.test(String(text || ""));
}

function sameHost(a, b) {
  try {
    return new URL(a).host.replace(/^www\./, "") === new URL(b).host.replace(/^www\./, "");
  } catch {
    return false;
  }
}

function isFacebook(url) {
  return /(^|\.)facebook\.com|fb\.com|m\.me/i.test(String(url || ""));
}

module.exports = {
  PAGE_TIMEOUT_MS, MAX_PAGES, MAX_TILES, VIEWPORT,
  CANDIDATE_PATHS, LINK_HINT, PRICE_PATTERN,
  hasPrices, sameHost, isFacebook, detectCurrency
};

/** One shared browser per process. Chromium startup is the expensive part. */
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    const { chromium } = require("playwright");
    browserPromise = chromium.launch({
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch { /* already gone */ }
  browserPromise = null;
}

/** Visible text, trimmed. Nav and boilerplate come along; the model copes. */
async function readableText(page) {
  try {
    const text = await page.evaluate(() => {
      const drop = ["script", "style", "noscript", "svg"];
      drop.forEach((tag) => document.querySelectorAll(tag).forEach((n) => n.remove()));
      return document.body ? document.body.innerText : "";
    });
    return String(text || "").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return "";
  }
}

/** Same-host links whose text or href suggests a catalogue. */
async function findCatalogueLinks(page, baseUrl) {
  try {
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        href: a.href,
        text: (a.textContent || "").trim().slice(0, 80)
      }))
    );
    const seen = new Set();
    const out = [];
    for (const link of links) {
      if (!link.href || seen.has(link.href)) continue;
      if (!sameHost(link.href, baseUrl)) continue;
      if (isFacebook(link.href)) continue;
      if (!LINK_HINT.test(link.text) && !LINK_HINT.test(link.href)) continue;
      seen.add(link.href);
      out.push(link.href);
      if (out.length >= MAX_PAGES) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Screenshot in viewport-sized TILES rather than one tall image.
 *
 * A full-page capture of a long store page is downscaled before the model
 * reads it, and a ₱143 price tag turns to mush. Tiles keep text legible.
 */
async function screenshotTiles(page, maxTiles = MAX_TILES) {
  const shots = [];
  try {
    const height = await page.evaluate(() => document.body ? document.body.scrollHeight : 0);
    const tiles = Math.max(1, Math.min(maxTiles, Math.ceil(height / VIEWPORT.height)));
    for (let i = 0; i < tiles; i += 1) {
      await page.evaluate((y) => window.scrollTo(0, y), i * VIEWPORT.height);
      await page.waitForTimeout(400);
      shots.push(await page.screenshot({ type: "png" }));
    }
  } catch { /* return whatever we managed */ }
  return shots;
}


/**
 * Read the structured product data platforms publish for Google Shopping.
 *
 * MEASURED across platforms: WooCommerce exposes
 * <meta property="product:price:amount" content="279.00">, Shopify embeds a
 * product JSON with prices in CENTS, and most carts emit schema.org Product
 * offers in ld+json. All of this is exact, machine-written and free to read —
 * far more reliable than guessing at rendered text, and it never needs vision.
 *
 * This is the step that was missing: the crawler read visible text and pixels
 * but ignored the data the site is already publishing for machines.
 */
async function readStructuredProducts(page) {
  try {
    return await page.evaluate(() => {
      const out = [];

      const push = (name, price, currency, extra) => {
        if (price === undefined || price === null || price === "") return;
        const clean = String(price).replace(/[^\d.]/g, "");
        if (!clean) return;
        out.push([name || "Item", ((currency || "") + " " + clean).trim(), extra || ""].filter(Boolean).join(" | "));
      };

      // schema.org Product in ld+json
      document.querySelectorAll('script[type="application/ld+json"]').forEach((tag) => {
        let data;
        try { data = JSON.parse(tag.textContent); } catch { return; }
        const queue = Array.isArray(data) ? data.slice() : [data];
        while (queue.length) {
          const node = queue.shift();
          if (!node || typeof node !== "object") continue;
          if (node["@graph"]) queue.push(...[].concat(node["@graph"]));
          if (node.itemListElement) queue.push(...[].concat(node.itemListElement));
          if (node.item) queue.push(node.item);
          const type = String(node["@type"] || "");
          if (type.indexOf("Product") !== -1) {
            const offers = [].concat(node.offers || []);
            if (offers.length) {
              offers.forEach((o) => push(node.name, o.price, o.priceCurrency, o.availability));
            } else {
              push(node.name, node.price, node.priceCurrency);
            }
          }
        }
      });

      // Open Graph / product meta (WooCommerce and many themes)
      const metaPrice = document.querySelector('meta[property="product:price:amount"]');
      const metaCur = document.querySelector('meta[property="product:price:currency"]');
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (metaPrice) {
        push(ogTitle && ogTitle.content, metaPrice.content, metaCur && metaCur.content);
      }

      // Microdata
      document.querySelectorAll('[itemprop="price"]').forEach((el) => {
        push(document.title, el.getAttribute("content") || el.textContent, "");
      });

      return out.slice(0, 60);
    });
  } catch {
    return [];
  }
}

/**
 * Render a site, follow its catalogue pages, and read prices — from text where
 * possible, from pixels when not.
 *
 * Never throws. A demo in progress must not die because a site was slow.
 *
 * @returns {Promise<{ok:boolean, text:string, pages:string[], usedVision:boolean, reason?:string}>}
 */
async function renderAndExtract(startUrl, { onVision } = {}) {
  if (!startUrl) return { ok: false, text: "", pages: [], usedVision: false, reason: "no_url" };
  if (isFacebook(startUrl)) {
    // Measured: logged out, Facebook returns <title>Error</title> in ~1.5KB.
    // Rendering it would spend Chromium on a block page.
    return { ok: false, text: "", pages: [], usedVision: false, reason: "facebook_not_supported" };
  }

  let context = null;
  const visited = [];
  const chunks = [];
  let usedVision = false;

  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      viewport: VIEWPORT,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      locale: "en-PH"
    });

    const page = await context.newPage();
    // Fonts and media add seconds and tell us nothing. Images stay: they are
    // often where the prices are.
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "media" || type === "font") return route.abort();
      return route.continue();
    });

    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    await page.waitForTimeout(1500);
    visited.push(startUrl);

    const homeText = await readableText(page);
    if (homeText) chunks.push(`--- ${startUrl} ---\n${homeText.slice(0, 6000)}`);

    // Machine-readable prices first: exact, free, and no vision needed.
    const structured = await readStructuredProducts(page);
    if (structured.length) {
      chunks.push(`--- product data published by the site ---\n${structured.join("\n")}`);
    }

    // Follow catalogue links only when the landing page shows no prices.
    if (!hasPrices(homeText)) {
      const links = await findCatalogueLinks(page, startUrl);
      for (const link of links) {
        if (visited.length >= MAX_PAGES) break;
        try {
          await page.goto(link, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
          await page.waitForTimeout(1200);
          visited.push(link);
          const text = await readableText(page);
          if (text) chunks.push(`--- ${link} ---\n${text.slice(0, 6000)}`);
          if (hasPrices(text)) break;
        } catch { /* skip a page that will not load */ }
      }
    }

    let combined = chunks.join("\n\n").trim();

    // Still no prices in the text? They are in the pixels. Same extractor the
    // uploaded price list uses.
    if (!hasPrices(combined) && typeof onVision === "function") {
      try {
        await page.goto(visited[visited.length - 1] || startUrl, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_TIMEOUT_MS
        });
        await page.waitForTimeout(1200);
        const tiles = await screenshotTiles(page);
        for (const buffer of tiles) {
          const seen = await onVision(buffer);
          if (seen) {
            usedVision = true;
            combined += `\n\n--- read from the page image ---\n${seen}`;
            if (hasPrices(seen)) break;
          }
        }
      } catch { /* vision is best effort */ }
    }

    return {
      ok: Boolean(combined),
      text: combined.slice(0, 14000),
      pages: visited,
      usedVision
    };
  } catch (error) {
    return {
      ok: false, text: "", pages: visited, usedVision,
      reason: String(error.message).slice(0, 200)
    };
  } finally {
    if (context) { try { await context.close(); } catch { /* noop */ } }
  }
}

module.exports.getBrowser = getBrowser;
module.exports.closeBrowser = closeBrowser;
module.exports.renderAndExtract = renderAndExtract;
module.exports.readStructuredProducts = readStructuredProducts;
module.exports.readableText = readableText;
module.exports.screenshotTiles = screenshotTiles;
