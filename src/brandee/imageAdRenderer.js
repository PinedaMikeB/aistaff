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
  offer_promo: (f) => ({ headline: f.offer, subcopy: f.promoPrice && f.originalPrice ? `${f.originalPrice} → ${f.promoPrice}` : (f.promoPrice || null), price: null, cta: f.cta, badge: null }),
  problem_solution: (f) => ({ headline: f.customerProblem, subcopy: f.productSolution, price: null, cta: f.cta, badge: null }),
  question_ad: (f) => ({ headline: f.customerQuestion, subcopy: f.supportingAnswer, price: null, cta: f.cta, badge: null }),
  comparison: (f) => ({ headline: `Vs. ${f.comparisonSubject || ""}`.trim(), subcopy: f.comparisonPoints, price: null, cta: f.cta, badge: null }),
  minimal_ecommerce: (f, form) => ({ headline: form.productName, subcopy: null, price: f.price, cta: f.cta, badge: null }),
  testimonial_style: (f) => ({ headline: `"${f.testimonialQuote || ""}"`, subcopy: `— ${f.testimonialAttribution || ""}`, price: null, cta: f.cta, badge: null }),
  before_and_after: (f) => ({ headline: `Before: ${f.beforeState || ""}`, subcopy: `After: ${f.afterState || ""}`, price: null, cta: f.cta, badge: null }),
  bold_claim: (f) => ({ headline: f.claim, subcopy: f.evidenceSource ? `Source: ${f.evidenceSource}` : null, price: null, cta: f.cta, badge: null, list: null }),
  iphone_notes: (f) => ({ headline: f.noteHeadline, subcopy: null, price: null, cta: f.cta, badge: null, list: [f.reason1, f.reason2, f.reason3, f.reason4, f.reason5].filter(Boolean) }),
  reasons_why: (f) => ({ headline: f.listHeadline, subcopy: null, price: null, cta: f.cta, badge: null, list: [f.reason1, f.reason2, f.reason3, f.reason4, f.reason5].filter(Boolean) }),
  sticky_notes: (f) => ({ headline: f.headline, subcopy: null, price: null, cta: f.cta, badge: null, list: [f.note1, f.note2, f.note3, f.note4, f.note5].filter(Boolean) })
};

/**
 * Builds the final renderable ad content from the template's raw field
 * values, with an optional `override` layered on top. `override` is where
 * the creative-planning AI (creativePlanner.js) and the revision flow
 * (Part 17 — "edit the current preview, preserve everything not asked to
 * change") apply their decisions: only the keys actually present in
 * `override` replace the template-field-derived value, so a revision that
 * only asks to change the headline never touches subcopy/cta/list/price.
 */
function buildAdContent(templateId, templateFields = {}, form = {}, override = null) {
  const mapper = TEMPLATE_CONTENT_MAP[templateId];
  const base = mapper ? mapper(templateFields, form) : { headline: form.productName, subcopy: form.mainBenefit, price: form.price, cta: "Learn More", badge: null, list: null };
  const merged = {
    headline: base.headline || form.productName || "Your product",
    subcopy: base.subcopy || form.mainBenefit || "",
    price: base.price || form.price || null,
    cta: base.cta || "Learn More",
    badge: base.badge || null,
    list: base.list || null
  };
  if (override && typeof override === "object") {
    for (const key of ["headline", "subcopy", "price", "cta", "badge", "list"]) {
      if (override[key] !== undefined && override[key] !== null) merged[key] = override[key];
    }
  }
  return merged;
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
function listBlock(items, x, y, width, { accentColor, style = "check" }) {
  if (!items || !items.length) return "";
  const rowHeight = 34;
  const rows = items.slice(0, 5).map((item, i) => {
    const rowY = y + i * rowHeight;
    const marker = style === "sticky"
      ? `<rect x="${x}" y="${rowY - 16}" width="20" height="20" rx="4" fill="${accentColor}" fill-opacity="0.85" />`
      : `<circle cx="${x + 10}" cy="${rowY - 6}" r="10" fill="${accentColor}" /><text x="${x + 10}" y="${rowY - 1}" font-family="Manrope, Arial, sans-serif" font-size="12" font-weight="700" fill="#ffffff" text-anchor="middle">${i + 1}</text>`;
    const textX = x + 30;
    return `${marker}${textLines(item, textX, rowY, { fontSize: 15, fontWeight: 600, fill: "#e6f2fa", maxCharsPerLine: 34, maxLines: 1 })}`;
  });
  return `<g>${rows.join("\n")}</g>`;
}

/**
 * Renders a full SVG ad document. `productImageDataUrl` is embedded as-is —
 * this function never alters, regenerates, or replaces the actual uploaded
 * product photo. Set `watermark: true` for the free/anonymous preview
 * (smaller canvas + visible repeated watermark, no clean download); set it
 * to false only after the subscription/export gate has been checked by the
 * caller. `override` layers creative-planning/revision decisions on top of
 * the raw template fields (see buildAdContent's doc comment).
 */
function renderImageAdSvg({ templateId, templateFields = {}, form = {}, watermark = true, override = null }) {
  const content = buildAdContent(templateId, templateFields, form, override);
  const width = watermark ? 720 : 1080;
  const height = watermark ? 900 : 1350;
  const brandColor = (form.brandColors && form.brandColors[0]) || "#0f172a";
  const accentColor = (form.brandColors && form.brandColors[1]) || "#3b82f6";
  const hasList = Array.isArray(content.list) && content.list.length > 0;

  // A soft rounded card + shadow behind the product photo reads as far more
  // "premium creative tool" than a bare embedded image — cheap to render,
  // real visual lift, and never touches the actual product pixels.
  const productImageBlock = form.productImage
    ? `<g>
        <rect x="${width * 0.06}" y="${height * 0.08}" width="${width * 0.88}" height="${height * 0.48}" rx="18" fill="#ffffff" fill-opacity="0.04" />
        <image href="${form.productImage}" x="${width * 0.08}" y="${height * 0.1}" width="${width * 0.84}" height="${height * 0.44}" preserveAspectRatio="xMidYMid meet" />
      </g>`
    : "";

  const badge = content.badge
    ? `<rect x="${width * 0.08}" y="${height * 0.58}" width="150" height="34" rx="17" fill="${accentColor}" /><text x="${width * 0.08 + 75}" y="${height * 0.58 + 23}" font-family="Manrope, Arial, sans-serif" font-size="15" font-weight="700" fill="#ffffff" text-anchor="middle">${escapeXml(content.badge)}</text>`
    : "";

  const priceBlock = content.price
    ? `<text x="${width * 0.08}" y="${height * 0.94}" font-family="DM Mono, monospace" font-size="26" font-weight="600" fill="${accentColor}">${escapeXml(content.price)}</text>`
    : "";

  const ctaBlock = `
    <rect x="${width * 0.08}" y="${height * 0.97 - 46}" width="${width * 0.5}" height="46" rx="23" fill="${accentColor}" />
    <text x="${width * 0.08 + (width * 0.25)}" y="${height * 0.97 - 17}" font-family="Manrope, Arial, sans-serif" font-size="18" font-weight="700" fill="#ffffff" text-anchor="middle">${escapeXml(content.cta)}</text>
  `;

  const headlineY = hasList ? height * 0.635 : height * 0.7;
  const bodyBlock = hasList
    ? listBlock(content.list, width * 0.08, height * 0.72, width * 0.84, { accentColor, style: templateId === "sticky_notes" ? "sticky" : "check" })
    : textLines(content.subcopy, width * 0.08, height * 0.79, { fontSize: 18, fontWeight: 500, fill: "#cbd5e1", maxCharsPerLine: 42, maxLines: 2 });

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
    ${textLines(content.headline, width * 0.08, headlineY, { fontSize: 34, maxCharsPerLine: 24, maxLines: hasList ? 2 : 2 })}
    ${bodyBlock}
    ${priceBlock}
    ${ctaBlock}
    ${watermark ? watermarkOverlay(width, height) : ""}
  </svg>`;

  return { svg, width, height, watermarked: watermark, content };
}

/**
 * Wraps a FULLY GENERATED ad image (AI_GENERATED_LAYOUT mode — GPT Image 2
 * produced the entire ad, text and all) in an SVG document so the rest of
 * the pipeline, which speaks SVG everywhere, needs no special case.
 * Composites NO text of its own — the image already contains it.
 *
 * The viewBox is derived from the image's REAL pixel dimensions, and
 * `preserveAspectRatio="meet"` guarantees the whole image is always
 * visible. A previous version hardcoded a 720x900 frame with "slice",
 * which silently cropped 16.7% off the top and bottom of every generated
 * ad whenever the generated ratio differed from 4:5.
 */
function renderGeneratedAdSvg({ imageDataUrl, watermark = true, imageWidth = null, imageHeight = null }) {
  const dims = (imageWidth && imageHeight)
    ? { width: imageWidth, height: imageHeight }
    : (readPngDimensions(imageDataUrl) || { width: 1280, height: 1600 });
  const { width, height } = dims;
  const svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <image href="${imageDataUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />
    ${watermark ? watermarkOverlay(width, height) : ""}
  </svg>`;
  return { svg, width, height, watermarked: watermark, generated: true };
}

/**
 * Reads width/height straight out of a base64 PNG's IHDR chunk so the
 * wrapper never has to assume a size.
 */
function readPngDimensions(dataUrl) {
  try {
    const base64 = String(dataUrl || "").split(",")[1];
    if (!base64) return null;
    const buffer = Buffer.from(base64.slice(0, 64), "base64");
    if (buffer.length < 24) return null;
    if (buffer.toString("ascii", 1, 4) !== "PNG") return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch {
    return null;
  }
}

module.exports = { renderImageAdSvg, renderGeneratedAdSvg, readPngDimensions, buildAdContent, wrapText };
