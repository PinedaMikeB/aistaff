// Narrow, single-page product URL extraction (PART 8).
//
// This is deliberately NOT the multi-page business crawler (crawler.js /
// businessProfileBuilder.js) — the product-ad MVP's URL field is scoped to
// ONE specific product listing (an ecommerce/Shopify/WooCommerce/Lazada/
// Shopee product page, or a Facebook/Instagram product post), never the
// whole site. This module fetches exactly the submitted URL, reuses the
// SAME SSRF-safe fetch primitives as the business analyzer (no separate,
// weaker fetch path), parses it with the same dependency-free HTML parser
// already used by the crawler, and pulls product-shaped fields only. It
// never follows links, never visits a second page, and never treats page
// content as instructions — every extracted value is plain data the
// customer can review, edit, or discard.

const { safeFetchAny, normalizeUrlInput, WebsiteAnalysisError } = require("./websiteAnalyzer");
const { parseHtmlDocument } = require("./crawler");

const PRICE_PATTERN = /(?:₱|php\s?)\s?[\d,]+(?:\.\d{2})?/i;

function firstJsonLdProductOrOffer(structuredData = []) {
  for (const entry of structuredData) {
    const types = Array.isArray(entry["@type"]) ? entry["@type"] : [entry["@type"]];
    if (types.some((t) => String(t || "").toLowerCase() === "product")) return entry;
  }
  return null;
}

/**
 * Fetches and parses exactly ONE submitted product page/listing. Never
 * throws for ordinary unreachable/unsupported cases — returns
 * { ok: false, reason } so the caller can fall back to manually entered
 * details, per PART 8's "If the page cannot be read, continue using the
 * manually entered product details."
 */
async function extractProductFromUrl(rawUrl, { fetchHtmlPage } = {}) {
  let normalized;
  try {
    normalized = normalizeUrlInput(rawUrl);
  } catch (error) {
    return { ok: false, reason: "invalid_url", message: "That does not look like a valid product link." };
  }

  let html;
  try {
    if (fetchHtmlPage) {
      ({ html } = await fetchHtmlPage(normalized));
    } else {
      const result = await safeFetchAny(normalized, {
        acceptContentType: (ct) => ct.includes("text/html") || ct.includes("application/xhtml+xml")
      });
      html = result.body;
    }
  } catch (error) {
    const known = error instanceof WebsiteAnalysisError;
    return {
      ok: false,
      reason: known ? error.code : "unreachable",
      message: "Brandee could not read this product page, so she will use the information you entered."
    };
  }

  let parsed;
  try {
    parsed = parseHtmlDocument(html);
  } catch (error) {
    return { ok: false, reason: "parse_failed", message: "Brandee could not read this product page, so she will use the information you entered." };
  }

  const jsonLdProduct = firstJsonLdProductOrOffer(parsed.structuredData || []);
  const offer = jsonLdProduct?.offers ? (Array.isArray(jsonLdProduct.offers) ? jsonLdProduct.offers[0] : jsonLdProduct.offers) : null;

  const priceFromText = [...(parsed.mainText || "").matchAll(new RegExp(PRICE_PATTERN, "gi"))].map((m) => m[0]);

  const extracted = {
    productName: jsonLdProduct?.name || parsed.openGraphTitle || parsed.title || null,
    description: jsonLdProduct?.description || parsed.openGraphDescription || parsed.metaDescription || null,
    images: [
      ...(jsonLdProduct?.image ? (Array.isArray(jsonLdProduct.image) ? jsonLdProduct.image : [jsonLdProduct.image]) : []),
      ...(parsed.openGraphImage ? [parsed.openGraphImage] : []),
      ...(parsed.logoAltCandidates?.length ? [] : []) // logos are never treated as product images
    ].slice(0, 5),
    price: offer?.price ? String(offer.price) : (priceFromText[0] || null),
    salePrice: offer?.priceSpecification?.price ? String(offer.priceSpecification.price) : null,
    availability: offer?.availability ? String(offer.availability).replace(/^https?:\/\/schema\.org\//i, "") : null,
    offer: jsonLdProduct?.offers ? null : null, // no fabricated offer text — a real offer string, if any, comes from OFFER-shaped copy only
    features: [],
    schemaFound: Boolean(jsonLdProduct),
    openGraphFound: Boolean(parsed.openGraphTitle || parsed.openGraphDescription || parsed.openGraphImage),
    sourceUrl: normalized
  };

  const hasAnything = Boolean(extracted.productName || extracted.description || extracted.images.length || extracted.price);
  if (!hasAnything) {
    return { ok: false, reason: "no_product_data_found", message: "Brandee could not find product details on this page, so she will use the information you entered." };
  }

  return { ok: true, extracted };
}

/**
 * Merges extracted values into a customer's form WITHOUT overwriting
 * anything the customer already typed themselves (PART 8: "Do not overwrite
 * manually entered information without consent"). Returns the merged
 * object plus which fields were filled from the URL, so the UI can show
 * "confirm or edit" affordances only on those fields.
 */
function mergeExtractedIntoForm(form = {}, extracted = {}) {
  const filledFromUrl = [];
  const merged = { ...form };
  const maybeFill = (formKey, value) => {
    if (value === null || value === undefined || value === "") return;
    if (merged[formKey] === null || merged[formKey] === undefined || merged[formKey] === "") {
      merged[formKey] = value;
      filledFromUrl.push(formKey);
    }
  };
  maybeFill("productName", extracted.productName);
  maybeFill("productDescription", extracted.description);
  maybeFill("price", extracted.price);
  return { merged, filledFromUrl };
}

module.exports = { extractProductFromUrl, mergeExtractedIntoForm };
