// Real image-ad compositor (PART 10) — no external image-generation
// provider required. Renders an SVG document that embeds the customer's
// actual uploaded product photo (never regenerated, so packaging/shape/
// labels/color are always preserved) plus a composed background, headline,
// supporting copy, CTA, and offer badge built from the template fields.
//
// Why SVG instead of calling a third-party image API: this codebase has no
// existing image-generation integration (verified — no OpenAI images/
// DALL-E/Replicate/etc. call exists anywhere), and adding a brand-new paid
// external dependency inside this task was avoided in favor of something
// that is REAL (not a fabricated placeholder) and works everywhere with
// zero additional provider configuration or native binary dependencies.
// SVG is rendered natively by every browser, can be displayed directly in
// the preview UI, and can be rasterized client-side (via <canvas>) for
// download once a plan's export gate allows it.

const { escapeXml } = require("./svgTextUtils");

const TEMPLATE_CONTENT_MAP = {
  product_highlight: (f) => ({ headline: f.headline, subcopy: f.keyBenefit, price: f.price, cta: f.cta, badge: null }),
  feature_benefit: (f) => ({ headline: f.feature, subcopy: `${f.customerBenefit}${f.supportingDetail ? ` — ${f.supportingDetail}` : ""}`, price: null, cta: f.cta, badge: null }),
  offer_promo: (f) => ({ headline: f.offer, subcopy: f.promoPrice && f.originalPrice ? `${f.originalPrice} → ${f.promoPrice}` : (f.promoPrice || null), price: null, cta: f.cta, badge: "OFFER" }),
  problem_solution: (f) => ({ headline: f.customerProblem, subcopy: f.productSolution, price: null, cta: f.cta, badge: null }),
  question_ad: (f) => ({ headline: f.customerQuestion, subcopy: f.supportingAnswer, price: null, cta: f.cta, badge: null }),
  comparison: (f) => ({ headline: `Vs. ${f.comparisonSubject || ""}`.trim(), subcopy: f.comparisonPoints, price: null, cta: f.cta, badge: null }),
  minimal_ecommerce: (f, form) => ({ headline: form.productName, subcopy: null, price: f.price, cta: f.cta, badge: null }),
  testimonial_style: (f) => ({ headline: `"${f.testimonialQuote || ""}"`, subcopy: `— ${f.testimonialAttribution || ""}`, price: null, cta: f.cta, badge: null }),
  before_and_after: (f) => ({ headline: `Before: ${f.beforeState || ""}`, subcopy: `After: ${f.afterState || ""}`, price: null, cta: f.cta, badge: null }),
  bold_claim: (f) => ({ headline: f.claim, subcopy: f.evidenceSource ? `Source: ${f.evidenceSource}` : null, price: null, cta: f.cta, badge: null })
};

function buildAdContent(templateId, templateFields = {}, form = {}) {
  const mapper = TEMPLATE_CONTENT_MAP[templateId];
  const base = mapper ? mapper(templateFields, form) : { headline: form.productName, subcopy: form.mainBenefit, price: form.price, cta: "Learn More", badge: null };
  return {
    headline: base.headline || form.productName || "Your product",
    subcopy: base.subcopy || form.mainBenefit || "",
    price: base.price || form.price || null,
    cta: base.cta || "Learn More",
    badge: base.badge
  };
}

function wrapText(text, maxCharsPerLine, maxLines) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\W*$/, "")}…`;
  }
  return lines;
}

function textLines(text, x, y, { fontSize, fontWeight = 600, fill = "#ffffff", maxCharsPerLine = 26, maxLines = 3, lineHeight = 1.25, anchor = "start" } = {}) {
  const lines = wrapText(text, maxCharsPerLine, maxLines);
  return lines
    .map((line, i) => `<text x="${x}" y="${y + i * fontSize * lineHeight}" font-family="Manrope, Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(line)}</text>`)
    .join("\n");
}

function watermarkOverlay(width, height) {
  const tiles = [];
  const step = 220;
  for (let y = -step; y < height + step; y += step) {
    for (let x = -step; x < width + step; x += step * 1.4) {
      tiles.push(`<text x="${x}" y="${y}" transform="rotate(-28 ${x} ${y})" font-family="Manrope, Arial, sans-serif" font-size="26" font-weight="700" fill="#ffffff" fill-opacity="0.16" text-anchor="middle">BRANDEE PREVIEW</text>`);
    }
  }
  return `<g>${tiles.join("")}</g>`;
}

/**
 * Renders a full SVG ad document. `productImageDataUrl` is embedded as-is —
 * this function never alters, regenerates, or replaces the actual uploaded
 * product photo. Set `watermark: true` for the free/anonymous preview
 * (smaller canvas + visible repeated watermark, no clean download); set it
 * to false only after the subscription/export gate has been checked by the
 * caller.
 */
function renderImageAdSvg({ templateId, templateFields = {}, form = {}, watermark = true }) {
  const content = buildAdContent(templateId, templateFields, form);
  const width = watermark ? 720 : 1080;
  const height = watermark ? 900 : 1350;
  const brandColor = (form.brandColors && form.brandColors[0]) || "#0f172a";
  const accentColor = (form.brandColors && form.brandColors[1]) || "#3b82f6";

  const productImageBlock = form.productImage
    ? `<image href="${form.productImage}" x="${width * 0.08}" y="${height * 0.1}" width="${width * 0.84}" height="${height * 0.46}" preserveAspectRatio="xMidYMid meet" />`
    : "";

  const badge = content.badge
    ? `<rect x="${width * 0.08}" y="${height * 0.62}" width="140" height="36" rx="18" fill="${accentColor}" /><text x="${width * 0.08 + 70}" y="${height * 0.62 + 24}" font-family="Manrope, Arial, sans-serif" font-size="16" font-weight="700" fill="#ffffff" text-anchor="middle">${escapeXml(content.badge)}</text>`
    : "";

  const priceBlock = content.price
    ? `<text x="${width * 0.08}" y="${height * 0.94}" font-family="DM Mono, monospace" font-size="28" font-weight="600" fill="${accentColor}">${escapeXml(content.price)}</text>`
    : "";

  const ctaBlock = `
    <rect x="${width * 0.08}" y="${height * 0.97 - 46}" width="${width * 0.5}" height="46" rx="10" fill="${accentColor}" />
    <text x="${width * 0.08 + (width * 0.25)}" y="${height * 0.97 - 17}" font-family="Manrope, Arial, sans-serif" font-size="18" font-weight="700" fill="#ffffff" text-anchor="middle">${escapeXml(content.cta)}</text>
  `;

  const svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${brandColor}" />
        <stop offset="100%" stop-color="#020617" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)" />
    ${productImageBlock}
    ${badge}
    ${textLines(content.headline, width * 0.08, height * 0.7, { fontSize: 34, maxCharsPerLine: 24, maxLines: 2 })}
    ${textLines(content.subcopy, width * 0.08, height * 0.79, { fontSize: 18, fontWeight: 500, fill: "#cbd5e1", maxCharsPerLine: 42, maxLines: 2 })}
    ${priceBlock}
    ${ctaBlock}
    ${watermark ? watermarkOverlay(width, height) : ""}
  </svg>`;

  return { svg, width, height, watermarked: watermark, content };
}

module.exports = { renderImageAdSvg, buildAdContent, wrapText };
