// Typed, stage-aware Brandee errors.
//
// Every failure in the analyze pipeline should end up as one of these
// (or be caught and converted into a non-blocking fallback — see
// PART 5 / isManualInfoSufficient below) rather than a bare Error whose
// .message leaks into a generic "something went wrong" response.

const crypto = require("crypto");

const STAGES = Object.freeze({
  INPUT: "input",
  SCRAPING: "scraping",
  EXTRACTION: "extraction",
  RULES: "rules",
  PLANNING: "planning",
  VALIDATION: "validation",
  PERSISTENCE: "persistence"
});

// code -> { stage, publicMessage, retryable }
const ERROR_DEFAULTS = Object.freeze({
  BRANDEE_INVALID_INPUT: { stage: STAGES.INPUT, publicMessage: "Please check the form — some required information is missing or invalid.", retryable: true },
  BRANDEE_INVALID_URL: { stage: STAGES.INPUT, publicMessage: "That website address doesn't look valid. Please double-check it.", retryable: true },
  BRANDEE_URL_BLOCKED: { stage: STAGES.INPUT, publicMessage: "That web address can't be analyzed. Please use your public website or Facebook Page link.", retryable: true },
  BRANDEE_SCRAPER_NOT_CONFIGURED: { stage: STAGES.SCRAPING, publicMessage: "Brandee could not read this website automatically. She can still build a plan from the details you entered.", retryable: false },
  BRANDEE_SCRAPER_FAILED: { stage: STAGES.SCRAPING, publicMessage: "Brandee could not read this website automatically. She can still build a plan from the details you entered.", retryable: true },
  BRANDEE_SCRAPER_TIMEOUT: { stage: STAGES.SCRAPING, publicMessage: "Brandee could not read this website automatically. She can still build a plan from the details you entered.", retryable: true },
  BRANDEE_EMPTY_WEBSITE_CONTENT: { stage: STAGES.SCRAPING, publicMessage: "Brandee could not read this website automatically. She can still build a plan from the details you entered.", retryable: false },
  BRANDEE_EXTRACTION_MODEL_NOT_CONFIGURED: { stage: STAGES.EXTRACTION, publicMessage: "Brandee is building your plan from the details you entered.", retryable: false },
  BRANDEE_EXTRACTION_MODEL_FAILED: { stage: STAGES.EXTRACTION, publicMessage: "Brandee is building your plan from the details you entered.", retryable: true },
  BRANDEE_EXTRACTION_SCHEMA_FAILED: { stage: STAGES.EXTRACTION, publicMessage: "Brandee is building your plan from the details you entered.", retryable: true },
  BRANDEE_RULES_NOT_LOADED: { stage: STAGES.RULES, publicMessage: "Brandee understood your business but could not complete the creative plan. Please retry.", retryable: true },
  BRANDEE_PLANNER_MODEL_NOT_CONFIGURED: { stage: STAGES.PLANNING, publicMessage: "Brandee understood your business but could not complete the creative plan. Please retry.", retryable: false },
  BRANDEE_PLANNER_MODEL_FAILED: { stage: STAGES.PLANNING, publicMessage: "Brandee understood your business but could not complete the creative plan. Please retry.", retryable: true },
  BRANDEE_PLANNER_SCHEMA_FAILED: { stage: STAGES.VALIDATION, publicMessage: "Brandee understood your business but could not complete the creative plan. Please retry.", retryable: true },
  BRANDEE_PLAN_REPAIR_FAILED: { stage: STAGES.VALIDATION, publicMessage: "Brandee understood your business but could not complete the creative plan. Please retry.", retryable: true },
  BRANDEE_DATABASE_FAILED: { stage: STAGES.PERSISTENCE, publicMessage: "Brandee built your plan but could not save it. Please retry.", retryable: true },
  BRANDEE_PLAN_NOT_FOUND: { stage: STAGES.PERSISTENCE, publicMessage: "Brandee couldn't find that plan. It may have expired.", retryable: false },
  BRANDEE_RATE_LIMITED: { stage: STAGES.INPUT, publicMessage: "Brandee is getting a lot of requests right now. Please wait a moment and try again.", retryable: true },
  BRANDEE_UNKNOWN_ERROR: { stage: STAGES.PLANNING, publicMessage: "Brandee ran into an unexpected problem. Please try again.", retryable: true },

  // PART 30 — crawler/extraction/planning-quality error codes added for the
  // deep-understanding reliability upgrade. All non-blocking by design: the
  // analyze route catches every one of these and falls back to a safer
  // (still complete) plan rather than surfacing a hard failure, except
  // where a genuinely empty result leaves nothing safe to build from.
  BRANDEE_CRAWL_DISCOVERY_FAILED: { stage: STAGES.SCRAPING, publicMessage: "Brandee could not fully explore this website automatically. She can still build a plan from what she found and what you entered.", retryable: true },
  BRANDEE_CRAWL_LIMIT_REACHED: { stage: STAGES.SCRAPING, publicMessage: "Brandee reached her page-reading limit for this website. She used the most relevant pages she found.", retryable: false },
  BRANDEE_PAGE_FETCH_FAILED: { stage: STAGES.SCRAPING, publicMessage: "Brandee could not read one or more pages on this website.", retryable: true },
  BRANDEE_PAGE_CLASSIFICATION_FAILED: { stage: STAGES.EXTRACTION, publicMessage: "Brandee had trouble understanding the structure of this website.", retryable: false },
  BRANDEE_NO_RELEVANT_PAGES: { stage: STAGES.SCRAPING, publicMessage: "Brandee could not find relevant pages on this website. She can still build a plan from the details you entered.", retryable: false },
  BRANDEE_BUSINESS_NAME_UNCERTAIN: { stage: STAGES.EXTRACTION, publicMessage: "Brandee isn't fully sure of your business name yet — please confirm it.", retryable: false },
  BRANDEE_PROFILE_CONFIRMATION_REQUIRED: { stage: STAGES.EXTRACTION, publicMessage: "Please confirm a few details before Brandee builds your final creative plan.", retryable: false },
  BRANDEE_ENTITY_CLASSIFICATION_FAILED: { stage: STAGES.EXTRACTION, publicMessage: "Brandee had trouble classifying some information on this website.", retryable: true },
  BRANDEE_PRODUCT_DISCOVERY_FAILED: { stage: STAGES.EXTRACTION, publicMessage: "Brandee could not confidently identify specific products or services.", retryable: false },
  BRANDEE_CONTACT_EXTRACTION_FAILED: { stage: STAGES.EXTRACTION, publicMessage: "Brandee could not confirm a direct contact method on this website.", retryable: false },
  BRANDEE_ANGLE_DIVERSITY_FAILED: { stage: STAGES.PLANNING, publicMessage: "Brandee could not build three clearly different creative angles from what's available yet.", retryable: true },
  BRANDEE_HOOK_QUALITY_FAILED: { stage: STAGES.PLANNING, publicMessage: "Brandee could not find a hook that met her quality and proof-safety bar.", retryable: true },
  BRANDEE_FRAMEWORK_ALIGNMENT_FAILED: { stage: STAGES.PLANNING, publicMessage: "Brandee could not align a static-ad framework with what's verified about this business.", retryable: true },
  BRANDEE_COPY_QUALITY_FAILED: { stage: STAGES.VALIDATION, publicMessage: "Brandee's draft copy did not pass her own quality check — retrying.", retryable: true },
  BRANDEE_SCRIPT_VALIDATION_FAILED: { stage: STAGES.VALIDATION, publicMessage: "Brandee's draft script did not pass her own quality check — retrying.", retryable: true }
});

class BrandeeError extends Error {
  constructor(code, { internalMessage, cause, metadata = {}, requestId, publicMessage, stage, retryable } = {}) {
    const defaults = ERROR_DEFAULTS[code] || ERROR_DEFAULTS.BRANDEE_UNKNOWN_ERROR;
    const resolvedPublicMessage = publicMessage || defaults.publicMessage;
    super(internalMessage || resolvedPublicMessage);
    this.name = "BrandeeError";
    this.code = code in ERROR_DEFAULTS ? code : "BRANDEE_UNKNOWN_ERROR";
    this.stage = stage || defaults.stage;
    this.publicMessage = resolvedPublicMessage;
    this.internalMessage = internalMessage || this.message;
    this.retryable = retryable !== undefined ? retryable : defaults.retryable;
    this.requestId = requestId || crypto.randomUUID();
    this.cause = cause;
    this.metadata = metadata;
  }

  /** Safe shape for an HTTP response — never includes stack traces or secrets. */
  toSafeJson() {
    return {
      ok: false,
      error: this.publicMessage,
      code: this.code,
      stage: this.stage,
      requestId: this.requestId,
      retryable: this.retryable
    };
  }

  /** Full detail for server-side logs only. */
  toLogEntry() {
    return {
      code: this.code,
      stage: this.stage,
      requestId: this.requestId,
      internalMessage: this.internalMessage,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
      metadata: this.metadata
    };
  }
}

/** Wraps any thrown value into a BrandeeError, preserving one if already thrown. */
function toBrandeeError(error, { code = "BRANDEE_UNKNOWN_ERROR", stage, requestId, metadata } = {}) {
  if (error instanceof BrandeeError) return error;
  return new BrandeeError(code, {
    internalMessage: error?.message || String(error),
    cause: error,
    stage,
    requestId,
    metadata
  });
}

module.exports = { STAGES, ERROR_DEFAULTS, BrandeeError, toBrandeeError };
