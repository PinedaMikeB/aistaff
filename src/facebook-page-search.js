const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const { buildNameSlugCandidates, scoreNameMatch } = require("./facebook-lookup");

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAX_CANDIDATES = 5;

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function normalizeFacebookPageUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "facebook.com" && host !== "m.facebook.com") return "";

    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    if (["watch", "groups", "events", "marketplace", "gaming", "reel", "reels", "photo", "photos", "video", "videos", "story", "stories", "share"].includes(parts[0])) {
      return "";
    }
    if (parts[0] === "profile.php") {
      const id = url.searchParams.get("id");
      return id ? `https://www.facebook.com/profile.php?id=${id}` : "";
    }

    const slug = parts[0];
    if (!/^[A-Za-z0-9._-]{2,120}$/.test(slug)) return "";
    return `https://www.facebook.com/${slug}`;
  } catch {
    return "";
  }
}

function extractSlug(pageUrl) {
  const normalized = normalizeFacebookPageUrl(pageUrl);
  if (!normalized) return "";
  if (normalized.includes("profile.php?id=")) {
    return normalized.split("id=")[1] || "";
  }
  return normalized.split("facebook.com/")[1] || "";
}

function humanizeSlug(slug) {
  return String(slug || "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function buildProbeSlugCandidates(pageName) {
  const slugs = buildNameSlugCandidates(pageName);
  const words = String(pageName || "").split(/\s+/).filter((word) => word.length > 1);
  const compact = words.join("");
  const lower = compact.toLowerCase();
  const titleCompact = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join("");
  const acronym = words.map((word) => word[0]?.toUpperCase() || "").join("");

  const extras = [
    acronym,
    `${acronym}CM`,
    `${acronym}Official`,
    `wotg.${lower}`,
    `${lower}2`,
    `${titleCompact}2`,
    `${lower}official`,
    `${titleCompact}Official`,
    words.join(".").toLowerCase(),
    words.map((word) => word.toLowerCase()).join("."),
    words.join("_").toLowerCase()
  ];

  return [...new Set([
    ...slugs,
    ...extras.map((value) => String(value || "").replace(/[^A-Za-z0-9._-]/g, ""))
  ])].filter((value) => value && value.length >= 3);
}

async function fetchPagePictureUrl(slug) {
  if (!slug) return "";
  try {
    const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(slug)}/picture?type=large&redirect=false`, {
      headers: { "User-Agent": USER_AGENT }
    });
    if (!response.ok) return "";
    const json = await response.json();
    return json?.data?.url || "";
  } catch {
    return "";
  }
}

async function probeSlugCandidate(slug, requestedName) {
  const imageUrl = await fetchPagePictureUrl(slug);
  if (!imageUrl) return null;

  const name = humanizeSlug(slug);
  const url = `https://www.facebook.com/${slug}`;
  return {
    name,
    slug,
    url,
    imageUrl,
    match: scoreNameMatch(requestedName, name),
    source: "facebook_slug_probe"
  };
}

function parseDuckDuckGoResults(html) {
  const results = [];
  const pattern = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    let href = decodeHtml(match[1]);
    const title = decodeHtml(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (href.startsWith("//")) href = `https:${href}`;
    if (href.includes("duckduckgo.com/l/?")) {
      try {
        const redirect = new URL(href);
        href = redirect.searchParams.get("uddg") || href;
      } catch {
        // keep original href
      }
    }
    const pageUrl = normalizeFacebookPageUrl(href);
    if (!pageUrl) continue;
    results.push({
      title: title.replace(/\s*-\s*Facebook$/i, "").trim(),
      pageUrl
    });
  }
  return results;
}

async function searchViaDuckDuckGo(pageName) {
  const query = encodeURIComponent(`site:facebook.com ${pageName}`);
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
      return [];
    }
    const html = await response.text();
    if (!html.includes("result__a")) return [];
    return parseDuckDuckGoResults(html);
  } catch {
    return [];
  }
}

async function searchViaSlugProbe(pageName) {
  const requestedName = String(pageName || "").trim();
  const slugs = buildProbeSlugCandidates(requestedName);
  const found = [];

  for (const slug of slugs) {
    const candidate = await probeSlugCandidate(slug, requestedName);
    if (candidate) found.push(candidate);
    if (found.length >= MAX_CANDIDATES) break;
  }

  return found;
}

async function enrichCandidate(candidate, requestedName) {
  const slug = candidate.slug || extractSlug(candidate.url);
  const imageUrl = candidate.imageUrl || await fetchPagePictureUrl(slug);
  if (!imageUrl) return null;

  const name = candidate.name || candidate.title || humanizeSlug(slug);
  return {
    name,
    slug,
    url: candidate.url || `https://www.facebook.com/${slug}`,
    imageUrl,
    match: scoreNameMatch(requestedName, name),
    source: candidate.source || "facebook_public_search"
  };
}

async function searchFacebookPagesByName(pageName, options = {}) {
  const requestedName = String(pageName || "").trim();
  const maxResults = options.maxResults || MAX_CANDIDATES;
  if (!requestedName) {
    return { ok: false, error: "Missing page name.", candidates: [] };
  }

  const merged = new Map();

  const [probeResults, ddgResults] = await Promise.all([
    searchViaSlugProbe(requestedName),
    searchViaDuckDuckGo(requestedName)
  ]);

  for (const candidate of probeResults) {
    merged.set(candidate.slug.toLowerCase(), candidate);
  }

  for (const item of ddgResults) {
    const slug = extractSlug(item.pageUrl);
    if (!slug || merged.has(slug.toLowerCase())) continue;
    const enriched = await enrichCandidate({
      slug,
      url: item.pageUrl,
      name: item.title,
      source: "duckduckgo_search"
    }, requestedName);
    if (enriched) merged.set(slug.toLowerCase(), enriched);
    if (merged.size >= maxResults) break;
  }

  const candidates = pickBestPageCandidates([...merged.values()], requestedName)
    .slice(0, maxResults);

  return {
    ok: candidates.length > 0,
    candidates,
    error: candidates.length ? "" : "No public Facebook Page matches found."
  };
}

function isLikelyPersonalFacebookProfile(candidate, context = {}) {
  const slug = String(candidate.slug || "");
  const name = String(candidate.name || "").toLowerCase();
  const customerName = String(context.customerName || "").toLowerCase().trim();
  if (/^\d{8,}$/.test(slug)) return true;
  if (customerName && name === customerName) return true;
  if (customerName && slug.toLowerCase() === customerName.replace(/\s+/g, "").toLowerCase()) return true;
  return false;
}

function rankPageCandidate(candidate, requestedName, context = {}) {
  let score = candidate.match?.score || 0;
  const slug = String(candidate.slug || "").toLowerCase();
  const name = String(candidate.name || "").toLowerCase();
  const req = String(requestedName || "").toLowerCase();

  if (isLikelyPersonalFacebookProfile(candidate, context)) score -= 1.25;

  if (/word on the go|\bwotg\b/.test(req)) {
    if (slug === "wotgcm") score -= 0.65;
    if (slug.includes("wordonthego") || slug.includes("wotg.word")) score += 0.55;
    if (name.includes("word on the go") && !name.includes("atlanta")) score += 0.45;
    if (name.includes("atlanta") || name.includes("christian ministries")) score -= 0.5;
  }

  if (slug.length <= 6 && req.split(/\s+/).length >= 3) score -= 0.15;
  return score;
}

function pickBestPageCandidates(candidates, requestedName, rejectedSlugs = [], context = {}) {
  const rejected = new Set((rejectedSlugs || []).map((slug) => String(slug || "").toLowerCase()));
  return [...(candidates || [])]
    .filter((candidate) => !rejected.has(String(candidate.slug || "").toLowerCase()))
    .filter((candidate) => !isLikelyPersonalFacebookProfile(candidate, context))
    .sort((a, b) => rankPageCandidate(b, requestedName, context) - rankPageCandidate(a, requestedName, context));
}

function buildMessengerCarouselElements(candidates, { isTagalog = false } = {}) {
  return candidates.map((candidate, index) => ({
    title: (candidate.name || candidate.slug || `Option ${index + 1}`).slice(0, 80),
    subtitle: isTagalog ? `Opsyon ${index + 1}` : `Option ${index + 1}`,
    image_url: candidate.imageUrl,
    buttons: [
      {
        type: "postback",
        title: isTagalog ? "Ito ang Page ko" : "This is my Page",
        payload: `PAGE_PICK:${candidate.slug}`
      }
    ]
  })).filter((element) => element.image_url);
}

function buildMessengerImageMessages(candidates, { isTagalog = false } = {}) {
  const items = (candidates || []).filter((candidate) => candidate.imageUrl);
  const multi = items.length > 1;
  return items.map((candidate, index) => ({
    imageUrl: candidate.imageUrl,
    caption: multi
      ? (isTagalog
        ? `Opsyon ${index + 1}: ${candidate.name || candidate.slug}`
        : `Option ${index + 1}: ${candidate.name || candidate.slug}`)
      : (candidate.name || candidate.slug)
  }));
}

function formatPageCandidatePickerMessage(candidates, { isTagalog = false, requestedName = "" } = {}) {
  const lines = candidates.map((candidate, index) => {
    const name = candidate.name || candidate.slug;
    return `${index + 1}. ${name}`;
  });
  return isTagalog
    ? `May ilang Page ako na nakita. Piliin po sa images sa ibaba, o reply 1, 2, o 3:\n${lines.join("\n")}`
    : `I found a few Pages. Pick from the images below, or reply 1, 2, or 3:\n${lines.join("\n")}`;
}

module.exports = {
  searchFacebookPagesByName,
  pickBestPageCandidates,
  rankPageCandidate,
  buildMessengerCarouselElements,
  buildMessengerImageMessages,
  formatPageCandidatePickerMessage,
  normalizeFacebookPageUrl,
  extractSlug,
  buildProbeSlugCandidates
};
