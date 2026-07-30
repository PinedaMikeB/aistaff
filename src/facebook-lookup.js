function normalizeLookupText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNameSlugCandidates(pageName) {
  const raw = String(pageName || "").trim();
  if (!raw) return [];

  const compact = raw.replace(/[^a-zA-Z0-9]/g, "");
  const dashed = raw.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  const dotted = raw.replace(/[^a-zA-Z0-9]+/g, ".").replace(/^\.|\.$/g, "");
  const underscored = raw.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  const lowerCompact = raw.replace(/\s+/g, "").toLowerCase();
  const titleCase = raw
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");

  return [...new Set([
    compact,
    lowerCompact,
    titleCase.replace(/\s+/g, ""),
    dashed,
    dotted,
    underscored,
    raw.replace(/\s+/g, "")
  ].filter((value) => value.length >= 3))];
}

function scoreNameMatch(requestedName, foundName) {
  const requested = normalizeLookupText(requestedName);
  const found = normalizeLookupText(foundName?.replace(/\s+\|\s+facebook$/i, ""));
  if (!requested || !found) return { confidence: "low", score: 0 };

  if (requested === found) return { confidence: "high", score: 1 };
  if (found.includes(requested) || requested.includes(found)) {
    return { confidence: requested.length >= 4 ? "high" : "medium", score: 0.85 };
  }

  const requestedTokens = requested.split(" ").filter(Boolean);
  const foundTokens = found.split(" ").filter(Boolean);
  const overlap = requestedTokens.filter((token) => foundTokens.includes(token)).length;
  const ratio = overlap / Math.max(requestedTokens.length, 1);

  if (ratio >= 0.75) return { confidence: "medium", score: ratio };
  if (ratio >= 0.4) return { confidence: "low", score: ratio };
  return { confidence: "low", score: ratio };
}

function buildFacebookLookupUrls(reference) {
  const candidates = [];
  if (!reference) return candidates;

  if (reference.url) candidates.push(reference.url);
  if (reference.type === "id") {
    candidates.push(`https://www.facebook.com/profile.php?id=${reference.value}`);
  }
  if (reference.type === "name" && reference.value) {
    for (const slug of buildNameSlugCandidates(reference.value)) {
      candidates.push(`https://www.facebook.com/${encodeURIComponent(slug)}`);
    }
  }

  return [...new Set(candidates.filter(Boolean))];
}

function formatFacebookLookupMessage(result, { isTagalog = false, requestedName = "" } = {}) {
  if (!result?.ok || !result.facebook?.name) {
    return isTagalog
      ? "Hindi ko mahanap ang public Facebook Page mula sa name na binigay ninyo. Pwede po bang i-send ang direct Page URL? Sa Facebook app: buksan ang Page → About → hanapin ang Page link o Page ID."
      : "I could not find the public Facebook Page from the name you gave. May I get the direct Page URL? On the Facebook app: open your Page → About → look for the Page link or Page ID.";
  }

  const match = result.match || { confidence: "medium" };
  const pageLabel = result.facebook.name;

  if (match.confidence === "high") {
    return isTagalog
      ? `Nahanap ko ang public Facebook Page na "${pageLabel}" mula sa name na binigay ninyo. Ito po ba ang Page ninyo?`
      : `I found the public Facebook Page "${pageLabel}" from the name you gave. Is this your Facebook Page?`;
  }

  if (match.confidence === "medium") {
    return isTagalog
      ? `May possible match ako na "${pageLabel}" mula sa name na binigay ninyo. Ito po ba ang tamang Facebook Page ninyo?`
      : `I found a possible match "${pageLabel}" from the name you gave. Is this the correct Facebook Page?`;
  }

  return isTagalog
    ? `May nahanap akong Page na "${pageLabel}", pero hindi ako sigurado kung ito ang sa inyo. Paki-confirm po, o mas mabuti kung i-send ang direct Facebook Page URL.`
    : `I found a Page named "${pageLabel}", but I'm not fully sure it's yours. Please confirm, or send the direct Facebook Page URL if you can.`;
}

module.exports = {
  buildNameSlugCandidates,
  scoreNameMatch,
  buildFacebookLookupUrls,
  formatFacebookLookupMessage
};
