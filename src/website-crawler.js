const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^facebook\.com\//i.test(raw) || /^www\.facebook\.com\//i.test(raw)) return `https://${raw.replace(/^www\./i, "")}`;
  return `https://${raw}`;
}

function isFacebookUrl(value) {
  try {
    const host = new URL(normalizeUrl(value)).hostname.toLowerCase();
    return host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com";
  } catch {
    return /facebook\.com|fb\.com/i.test(String(value || ""));
  }
}

const FETCH_TIMEOUT_MS = 12000;
const USER_AGENT = "AIStaffPageIntel/1.0 (+https://aistaff.click)";
const MAX_PAGES = 3;

function parseMetaTag(html, prop) {
  const htmlText = String(html || "");
  const direct = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  const reverse = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i");
  return (htmlText.match(direct) || htmlText.match(reverse))?.[1]?.trim() || "";
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    const html = await response.text();
    return { ok: response.ok, status: response.status, finalUrl: response.url, html };
  } finally {
    clearTimeout(timer);
  }
}

function extractInternalLinks(html, baseUrl) {
  const links = new Set();
  const base = new URL(baseUrl);
  const patterns = [
    /href=["'](\/[^"'#?]+)["']/gi,
    /href=["'](https?:\/\/[^"'#?]+)["']/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      try {
        const href = match[1];
        const url = href.startsWith("/") ? new URL(href, base.origin) : new URL(href);
        if (url.hostname !== base.hostname) continue;
        const path = url.pathname.toLowerCase();
        if (/(about|service|product|solution|offer|contact)/i.test(path)) {
          links.add(url.toString().split("#")[0]);
        }
      } catch {
        // ignore invalid URLs
      }
    }
  }

  return [...links].slice(0, MAX_PAGES - 1);
}

function extractServiceHints(html) {
  const text = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const headings = [...text.matchAll(/\b(?:services|products|solutions|what we offer|our services)\b[^.!?]{0,180}/gi)]
    .map((match) => match[0].trim())
    .slice(0, 3);

  const bullets = [...String(html || "").matchAll(/<li[^>]*>([^<]{4,120})<\/li>/gi)]
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter((line) => /service|product|rental|install|supply|repair|maintenance|solution/i.test(line))
    .slice(0, 6);

  return [...new Set([...headings, ...bullets])].slice(0, 6);
}

function parseWebsitePage(html, sourceUrl) {
  const title = parseMetaTag(html, "og:title") || parseMetaTag(html, "twitter:title") || (html.match(/<title[^>]*>([^<]+)/i)?.[1] || "").trim();
  const description = parseMetaTag(html, "og:description") || parseMetaTag(html, "description");
  const lowerHtml = html.toLowerCase();

  return {
    title: title.replace(/\s+/g, " ").trim(),
    description: description.trim(),
    url: sourceUrl,
    hasContactSignals: /contact|inquiry|quote|quotation|get in touch|email us|call us/i.test(`${title} ${description} ${html.slice(0, 12000)}`),
    hasMessengerSignals: /m\.me\/|messenger|facebook\.com\/messages|chat with us/i.test(lowerHtml),
    hasMetaDescription: Boolean(description),
    serviceHints: extractServiceHints(html),
    source: "website_public_preview"
  };
}

async function crawlWebsiteBounded(input) {
  const startUrl = normalizeUrl(input);
  if (!startUrl || isFacebookUrl(startUrl)) {
    return { ok: false, error: "Invalid website URL.", website: null };
  }

  try {
    const homepage = await fetchHtml(startUrl);
    if (!homepage.ok) {
      return { ok: false, error: `Website request failed (${homepage.status}).`, website: null, checkedUrl: startUrl };
    }

    const pages = [{ url: homepage.finalUrl || startUrl, html: homepage.html }];
    const extraLinks = extractInternalLinks(homepage.html, homepage.finalUrl || startUrl);

    for (const link of extraLinks) {
      if (pages.length >= MAX_PAGES) break;
      const result = await fetchHtml(link);
      if (result.ok) pages.push({ url: result.finalUrl || link, html: result.html });
    }

    const snapshots = pages.map((page) => parseWebsitePage(page.html, page.url));
    const primary = snapshots[0];
    if (!primary.title && !primary.description) {
      return { ok: false, error: "Website preview did not return readable public metadata.", website: null, checkedUrl: homepage.finalUrl || startUrl };
    }

    const serviceHints = [...new Set(snapshots.flatMap((snapshot) => snapshot.serviceHints || []))].slice(0, 8);
    return {
      ok: true,
      website: {
        ...primary,
        serviceHints,
        pagesChecked: snapshots.map((snapshot) => snapshot.url)
      },
      checkedUrl: homepage.finalUrl || startUrl
    };
  } catch (error) {
    return {
      ok: false,
      error: error.name === "AbortError" ? "Website preview timed out." : error.message,
      website: null,
      checkedUrl: startUrl
    };
  }
}

module.exports = {
  crawlWebsiteBounded,
  extractServiceHints
};
