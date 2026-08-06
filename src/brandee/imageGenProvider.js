// Optional pixel-level image-generation provider (PART 13/14 — "GPT Image
// 2"). This is a REAL integration (not a stub) against OpenAI's images API,
// gated entirely behind BRANDEE_IMAGE_MODEL/OPENAI_API_KEY — but this
// codebase has never had an image-generation provider configured anywhere
// (verified before writing imageAdRenderer.js in an earlier session), so in
// this environment today `probeImageProviderAvailability()` correctly
// reports unavailable and every caller falls back to the real, working,
// deterministic SVG compositor (imageAdRenderer.js) instead — exactly the
// same "never fabricate, always degrade honestly" posture already used for
// video generation (videoTeaserRenderer.js).
//
// IMPORTANT: nothing in this file is ever allowed to silently pretend an
// AI-generated image was produced when it wasn't. `generatePreviewImage`/
// `editPreviewImage` either return a real base64 image from a real
// successful API call, or `{ ok: false, reason }` — callers must treat
// `ok: false` as "fall back to the compositor," never as "retry forever" or
// "show a fabricated image."

const { getImageGenConfig } = require("./modelConfig");

const fetchImpl = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
// Measured directly against the live API: a real product-photo edit (not
// a tiny placeholder) took over 30s and hit the old ceiling. Raised with
// real margin, matching the same "reasoning/generation models take real
// time" lesson already learned for the text-based calls elsewhere in this
// subsystem (see productAnalysisService.js's identical comment).
const AI_IMAGE_TIMEOUT_MS = 90000;

function probeImageProviderAvailability() {
  const config = getImageGenConfig();
  if (!config.apiKeyConfigured) return { available: false, reason: "no_image_provider_configured", model: config.model };
  return { available: true, reason: null, model: config.model };
}

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Image generation timed out")), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function dataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/[a-z]+;base64,(.+)$/i);
  return match ? Buffer.from(match[1], "base64") : null;
}

/**
 * Generates a brand-new personalized ad image from a text brief + a
 * reference product photo (PART 14: "Send the selected template as a
 * visual reference ... Send the uploaded product as the actual product
 * reference"). Returns { ok: true, base64, model } on success or
 * { ok: false, reason } — never throws.
 */
async function generatePreviewImage({ prompt, productImageDataUrl, width = 1024, height = 1280 }) {
  const config = getImageGenConfig();
  const availability = probeImageProviderAvailability();
  if (!availability.available) return { ok: false, reason: availability.reason };

  try {
    if (config.provider !== "openai") return { ok: false, reason: "unsupported_image_provider" };

    // OpenAI's image-edit endpoint accepts a reference image + prompt, which
    // is the correct call shape for "use the real product photo, don't
    // repaint it from scratch" (PART 14's "prefer accurate product
    // compositing"). Uses multipart/form-data via a Blob, matching the
    // documented API shape.
    const FormDataImpl = globalThis.FormData;
    const BlobImpl = globalThis.Blob;
    if (!FormDataImpl || !BlobImpl) return { ok: false, reason: "runtime_missing_formdata_support" };

    const productBuffer = dataUrlToBuffer(productImageDataUrl);
    if (!productBuffer) return { ok: false, reason: "invalid_product_image" };

    const form = new FormDataImpl();
    form.append("model", config.model);
    form.append("prompt", prompt.slice(0, 4000));
    form.append("image", new BlobImpl([productBuffer], { type: "image/png" }), "product.png");
    form.append("size", `${width}x${height}` === "1024x1280" ? "1024x1536" : "1024x1024");
    form.append("n", "1");

    const response = await withTimeout(fetchImpl("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    }), AI_IMAGE_TIMEOUT_MS);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, reason: "provider_error", detail: `HTTP ${response.status}`, safeDetail: text.slice(0, 200) };
    }
    const json = await response.json();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) return { ok: false, reason: "empty_provider_response" };
    return { ok: true, base64: b64, model: config.model };
  } catch (error) {
    return { ok: false, reason: "provider_exception", detail: error.message };
  }
}

/**
 * Edits an EXISTING preview image in place given a revision instruction
 * (PART 17 — "edit the provided current preview, preserve everything not
 * asked to change"). Uses the current preview itself as the reference
 * image, not the original template/product, so unrelated composition is
 * naturally preserved by the underlying image-edit call.
 */
async function editPreviewImage({ prompt, currentPreviewDataUrl, width = 1024, height = 1280 }) {
  const config = getImageGenConfig();
  const availability = probeImageProviderAvailability();
  if (!availability.available) return { ok: false, reason: availability.reason };
  try {
    if (config.provider !== "openai") return { ok: false, reason: "unsupported_image_provider" };
    const FormDataImpl = globalThis.FormData;
    const BlobImpl = globalThis.Blob;
    if (!FormDataImpl || !BlobImpl) return { ok: false, reason: "runtime_missing_formdata_support" };

    const currentBuffer = dataUrlToBuffer(currentPreviewDataUrl);
    if (!currentBuffer) return { ok: false, reason: "invalid_reference_image" };

    const form = new FormDataImpl();
    form.append("model", config.model);
    form.append("prompt", prompt.slice(0, 4000));
    form.append("image", new BlobImpl([currentBuffer], { type: "image/png" }), "current-preview.png");
    form.append("size", "1024x1536");
    form.append("n", "1");

    const response = await withTimeout(fetchImpl("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    }), AI_IMAGE_TIMEOUT_MS);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, reason: "provider_error", detail: `HTTP ${response.status}`, safeDetail: text.slice(0, 200) };
    }
    const json = await response.json();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) return { ok: false, reason: "empty_provider_response" };
    return { ok: true, base64: b64, model: config.model };
  } catch (error) {
    return { ok: false, reason: "provider_exception", detail: error.message };
  }
}

module.exports = { probeImageProviderAvailability, generatePreviewImage, editPreviewImage };
