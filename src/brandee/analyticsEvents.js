// Lightweight analytics-event logger (PART 21).
//
// This repo has no existing analytics system (no gtag/dataLayer/Plausible/
// etc. anywhere in the codebase — checked before writing this). Rather than
// pulling in a third-party analytics SDK for an MVP task, this follows the
// same JSON-file append pattern already used elsewhere in Brandee (run log,
// project store): every event is appended to data/brandee-analytics-events.json
// with a name, timestamp, and a small, explicitly non-sensitive properties
// object. If/when a real analytics provider is wired in, `track()` is the
// single call site every route already uses, so swapping the implementation
// is a one-file change.

const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..", "..");
const logPath = path.join(rootDir, "data", "brandee-analytics-events.json");

const ALLOWED_EVENTS = new Set([
  "brandee_landing_viewed",
  "brandee_image_selected",
  "brandee_video_selected",
  "product_upload_started",
  "product_upload_completed",
  "template_selected",
  "video_style_selected",
  "image_preview_requested",
  "image_preview_completed",
  "video_preview_requested",
  "video_preview_completed",
  "preview_failed",
  "registration_prompt_shown",
  "registration_started",
  "registration_completed",
  "pricing_viewed",
  "subscription_started",
  "subscription_completed",
  "final_generation_started",
  "final_generation_completed",

  // PART 32 — template gallery + revision funnel events.
  "image_product_step_completed",
  "template_gallery_opened",
  "template_filter_selected",
  "template_preview_opened",
  "preview_generation_started",
  "preview_generation_completed",
  "preview_generation_failed",
  "revision_started",
  "revision_completed",
  "revision_failed",
  "save_finish_clicked",
  "registration_gate_shown",
  "pricing_gate_shown",
  "plan_selected",
  "checkout_started",
  "final_downloaded"
  ,"image_ad_cta_clicked"
  ,"video_ad_cta_clicked"
  ,"image_approaches_viewed"
  ,"creative_approach_viewed"
  ,"creative_approach_selected"
  ,"template_example_viewed"
  ,"image_workspace_opened"
  ,"image_product_details_saved"
  ,"image_preview_started"
  ,"image_preview_failed"
  ,"image_revision_started"
  ,"image_revision_completed"
  ,"image_revision_failed"
  ,"image_save_finish_clicked"
  ,"image_registration_gate_shown"
  ,"image_registration_completed"
  ,"image_pricing_gate_shown"
  ,"image_checkout_started"
  ,"image_subscription_completed"
  ,"template_gallery_browsed_without_product"
]);

// Only these keys are ever allowed onto an event, and every value is
// coerced to a primitive — this is a hard boundary against accidentally
// logging product photos, descriptions, or any other customer content.
const ALLOWED_PROPERTY_KEYS = new Set(["templateId", "styleId", "kind", "planSlug", "goal", "platform", "language", "reason", "durationMs", "frameworkKey", "audienceType", "filterType", "filterValue"]);

function sanitizeProperties(properties = {}) {
  const clean = {};
  for (const key of Object.keys(properties || {})) {
    if (!ALLOWED_PROPERTY_KEYS.has(key)) continue;
    const value = properties[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue; // never log nested/rich objects
    clean[key] = String(value).slice(0, 120);
  }
  return clean;
}

function appendEvent(event) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  let all = [];
  if (fs.existsSync(logPath)) {
    try { all = JSON.parse(fs.readFileSync(logPath, "utf8")); } catch { all = []; }
  }
  all.push(event);
  if (all.length > 5000) all = all.slice(all.length - 5000); // simple bounded log
  fs.writeFileSync(logPath, JSON.stringify(all, null, 2));
}

function track(eventName, properties = {}, { anonymousSessionId = null, userId = null } = {}) {
  if (!ALLOWED_EVENTS.has(eventName)) return; // never silently accept an unknown/typo'd event name
  try {
    appendEvent({
      event: eventName,
      properties: sanitizeProperties(properties),
      anonymousSessionId: anonymousSessionId || null,
      userId: userId || null,
      at: new Date().toISOString()
    });
  } catch {
    // Analytics must never break the request it's attached to.
  }
}

module.exports = { track, ALLOWED_EVENTS, logPath };
