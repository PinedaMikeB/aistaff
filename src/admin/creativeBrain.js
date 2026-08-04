// Brandee "Creative Brain" resource validator.
//
// This module is read-only and does not touch the scraping/planning engine
// itself (that engine — src/brandee/* — was built in a prior task and is
// intentionally left alone here). It only INSPECTS what that engine already
// exports and reports whether each resource is actually present and
// well-formed — never "Active" just because a file happens to exist.
//
// Scope note: this repo has no automated resource-version-bump system yet,
// so `version` below is a static baseline ("1.0.0") for every resource
// introduced in the same original Brandee build. `lastUpdated` is NOT
// hardcoded — it is read from each source file's real on-disk mtime, so it
// stays truthful as files change.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CREATIVE_BRAIN_VERSION = "1.0.0";
const RESOURCE_BASELINE_VERSION = "1.0.0";

const STATUS = Object.freeze({
  ACTIVE: "Active",
  MISSING: "Missing",
  INVALID: "Invalid",
  INACTIVE: "Inactive",
  NOT_VALIDATED: "Not validated"
});

const EXPECTED_COUNTS = Object.freeze({
  staticAdFrameworks: 10,
  hookTemplates: 100,
  businessGoals: 7,
  awarenessLevels: 5
});

function fileInfo(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return { exists: false, mtime: null, sizeBytes: 0, absPath: abs };
  const stat = fs.statSync(abs);
  return { exists: true, mtime: stat.mtime.toISOString(), sizeBytes: stat.size, absPath: abs };
}

function safeRequire(relPath) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(path.join(ROOT, relPath));
    return { ok: true, mod, error: null };
  } catch (error) {
    return { ok: false, mod: null, error: error.message };
  }
}

function sha256Of(text) {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

function checksumOfFile(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return sha256Of(fs.readFileSync(abs, "utf8"));
}

// ---------------------------------------------------------------------
// Individual resource validators
// ---------------------------------------------------------------------

function validateStaticAdFrameworks() {
  const relPath = "src/brandee/frameworks.js";
  const info = fileInfo(relPath);
  const name = "Static Ad Frameworks";
  const type = "framework-library";
  if (!info.exists) return notPresent(name, type, relPath);

  const { ok, mod, error } = safeRequire(relPath);
  if (!ok) return invalid(name, type, relPath, info, `Module failed to load: ${error}`);

  const list = mod.STATIC_AD_FRAMEWORKS;
  if (!Array.isArray(list)) return invalid(name, type, relPath, info, "STATIC_AD_FRAMEWORKS is not an array.");

  const requiredFields = ["id", "name", "description", "bestForGoals", "bestForAwareness", "requiredInputs", "requiredProof", "layoutRules", "copyRules", "risks", "exampleStructure"];
  const malformed = list.filter((f) => requiredFields.some((field) => f[field] === undefined));
  const countOk = list.length === EXPECTED_COUNTS.staticAdFrameworks;

  const problems = [];
  if (!countOk) problems.push(`Expected ${EXPECTED_COUNTS.staticAdFrameworks} frameworks, found ${list.length}.`);
  if (malformed.length) problems.push(`${malformed.length} framework(s) missing required fields.`);
  const duplicateIds = findDuplicates(list.map((f) => f.id));
  if (duplicateIds.length) problems.push(`Duplicate framework id(s): ${duplicateIds.join(", ")}.`);

  return {
    name, type,
    version: RESOURCE_BASELINE_VERSION,
    source: relPath,
    status: problems.length ? STATUS.INVALID : STATUS.ACTIVE,
    itemCount: list.length,
    expectedItemCount: EXPECTED_COUNTS.staticAdFrameworks,
    validationStatus: problems.length ? "Failed" : "Passed",
    validationDetails: problems,
    lastUpdated: info.mtime,
    runtimeUsageStatus: "Used by src/brandee/planner.js (buildDeterministicPlan → orderByPreference/candidateFrameworks)"
  };
}

function validateHookLibrary() {
  const relPath = "src/brandee/hooks.js";
  const info = fileInfo(relPath);
  const name = "Hook Framework";
  const type = "hook-library";
  if (!info.exists) return notPresent(name, type, relPath);

  const { ok, mod, error } = safeRequire(relPath);
  if (!ok) return invalid(name, type, relPath, info, `Module failed to load: ${error}`);

  const list = mod.HOOK_TEMPLATES;
  const categories = mod.HOOK_CATEGORIES;
  if (!Array.isArray(list)) return invalid(name, type, relPath, info, "HOOK_TEMPLATES is not an array.");

  const requiredFields = ["id", "category", "template", "requiredVariables", "bestForGoals", "bestForAwareness", "requiredProof", "canUseWithoutProof", "supportedPlatforms"];
  const malformed = list.filter((h) => requiredFields.some((field) => h[field] === undefined));
  const invalidCategory = Array.isArray(categories) ? list.filter((h) => !categories.includes(h.category)) : list;
  const countOk = list.length === EXPECTED_COUNTS.hookTemplates;
  const duplicateIds = findDuplicates(list.map((h) => h.id));

  const problems = [];
  if (!countOk) problems.push(`Expected ${EXPECTED_COUNTS.hookTemplates} hook templates, found ${list.length}.`);
  if (malformed.length) problems.push(`${malformed.length} hook(s) missing required fields.`);
  if (invalidCategory.length) problems.push(`${invalidCategory.length} hook(s) reference an undeclared category.`);
  if (duplicateIds.length) problems.push(`Duplicate hook id(s): ${duplicateIds.slice(0, 5).join(", ")}${duplicateIds.length > 5 ? "…" : ""}.`);

  return {
    name, type,
    version: RESOURCE_BASELINE_VERSION,
    source: relPath,
    status: problems.length ? STATUS.INVALID : STATUS.ACTIVE,
    itemCount: list.length,
    expectedItemCount: EXPECTED_COUNTS.hookTemplates,
    categoryCount: Array.isArray(categories) ? categories.length : null,
    validationStatus: problems.length ? "Failed" : "Passed",
    validationDetails: problems,
    lastUpdated: info.mtime,
    runtimeUsageStatus: "Used by src/brandee/planner.js (rankedHookScores/buildAngles) and src/brandee/frameworks.js proof gating"
  };
}

function validateGoalMappings() {
  const relPath = "src/brandee/goalMappings.js";
  const info = fileInfo(relPath);
  const name = "Goal Mappings";
  const type = "rule-set";
  if (!info.exists) return notPresent(name, type, relPath);

  const { ok, mod, error } = safeRequire(relPath);
  if (!ok) return invalid(name, type, relPath, info, `Module failed to load: ${error}`);

  const goals = mod.BUSINESS_GOALS;
  const mappings = mod.GOAL_MAPPINGS;
  if (!Array.isArray(goals)) return invalid(name, type, relPath, info, "BUSINESS_GOALS is not an array.");

  const problems = [];
  if (goals.length !== EXPECTED_COUNTS.businessGoals) problems.push(`Expected ${EXPECTED_COUNTS.businessGoals} business goals, found ${goals.length}.`);
  const missingMappings = goals.filter((g) => !mappings || !mappings[g]);
  if (missingMappings.length) problems.push(`Goal(s) missing a mapping entry: ${missingMappings.join(", ")}.`);
  if (typeof mod.correctGoal !== "function") problems.push("correctGoal() function is missing.");

  return {
    name, type,
    version: RESOURCE_BASELINE_VERSION,
    source: relPath,
    status: problems.length ? STATUS.INVALID : STATUS.ACTIVE,
    itemCount: goals.length,
    expectedItemCount: EXPECTED_COUNTS.businessGoals,
    validationStatus: problems.length ? "Failed" : "Passed",
    validationDetails: problems,
    lastUpdated: info.mtime,
    runtimeUsageStatus: "Used by src/brandee/planner.js (effectiveGoal correction) and the Guided Mode goal selector"
  };
}

function validateAwarenessRules() {
  const relPath = "src/brandee/awareness.js";
  const info = fileInfo(relPath);
  const name = "Awareness Rules";
  const type = "rule-set";
  if (!info.exists) return notPresent(name, type, relPath);

  const { ok, mod, error } = safeRequire(relPath);
  if (!ok) return invalid(name, type, relPath, info, `Module failed to load: ${error}`);

  const levels = mod.AWARENESS_LEVELS;
  const guidance = mod.AWARENESS_GUIDANCE;
  if (!Array.isArray(levels)) return invalid(name, type, relPath, info, "AWARENESS_LEVELS is not an array.");

  const problems = [];
  if (levels.length !== EXPECTED_COUNTS.awarenessLevels) problems.push(`Expected ${EXPECTED_COUNTS.awarenessLevels} awareness levels, found ${levels.length}.`);
  const missingGuidance = levels.filter((l) => !guidance || !guidance[l]);
  if (missingGuidance.length) problems.push(`Level(s) missing guidance: ${missingGuidance.join(", ")}.`);
  if (typeof mod.classifyAwareness !== "function") problems.push("classifyAwareness() function is missing.");

  return {
    name, type,
    version: RESOURCE_BASELINE_VERSION,
    source: relPath,
    status: problems.length ? STATUS.INVALID : STATUS.ACTIVE,
    itemCount: levels.length,
    expectedItemCount: EXPECTED_COUNTS.awarenessLevels,
    validationStatus: problems.length ? "Failed" : "Passed",
    validationDetails: problems,
    lastUpdated: info.mtime,
    runtimeUsageStatus: "Used by src/brandee/planner.js (classifyAwareness) for hook/framework selection weighting"
  };
}

function validateProofRules() {
  const relPath = "src/brandee/planner.js";
  const info = fileInfo(relPath);
  const name = "Proof Rules";
  const type = "rule-set";
  if (!info.exists) return notPresent(name, type, relPath);

  const { ok, mod, error } = safeRequire(relPath);
  if (!ok) return invalid(name, type, relPath, info, `Module failed to load: ${error}`);

  const requiredFns = ["computeAvailableProofTypes", "buildRestrictedClaims", "buildEvidenceList"];
  const missing = requiredFns.filter((fn) => typeof mod[fn] !== "function");

  return {
    name, type,
    version: RESOURCE_BASELINE_VERSION,
    source: relPath,
    status: missing.length ? STATUS.INVALID : STATUS.ACTIVE,
    itemCount: requiredFns.length - missing.length,
    expectedItemCount: requiredFns.length,
    validationStatus: missing.length ? "Failed" : "Passed",
    validationDetails: missing.length ? [`Missing function(s): ${missing.join(", ")}`] : [],
    lastUpdated: info.mtime,
    runtimeUsageStatus: "Gates every hook/framework against available proof before it can be used (never fabricates testimonials, ratings, urgency, etc.)"
  };
}

function validatePlatformRules() {
  const relPath = "src/brandee/schemas.js";
  const info = fileInfo(relPath);
  const name = "Platform Rules";
  const type = "rule-set";
  if (!info.exists) return notPresent(name, type, relPath);

  const { ok, mod, error } = safeRequire(relPath);
  if (!ok) return invalid(name, type, relPath, info, `Module failed to load: ${error}`);

  const platforms = mod.PLATFORMS;
  const plannerInfo = safeRequire("src/brandee/planner.js");
  const hasAspectRatioFn = plannerInfo.ok && typeof plannerInfo.mod.aspectRatioForPlatform === "function";

  const problems = [];
  if (!Array.isArray(platforms) || platforms.length === 0) problems.push("PLATFORMS list is missing or empty.");
  if (!hasAspectRatioFn) problems.push("aspectRatioForPlatform() is missing from planner.js.");

  return {
    name, type,
    version: RESOURCE_BASELINE_VERSION,
    source: relPath,
    status: problems.length ? STATUS.INVALID : STATUS.ACTIVE,
    itemCount: Array.isArray(platforms) ? platforms.length : 0,
    expectedItemCount: null,
    validationStatus: problems.length ? "Failed" : "Passed",
    validationDetails: problems,
    lastUpdated: info.mtime,
    runtimeUsageStatus: "Used to pick aspect ratio/format defaults per platform in the generated plan"
  };
}

function validatePerformanceDiagnostics() {
  // Honest gap: there is no closed-loop ad-performance feedback system yet
  // (no ingestion of real campaign results back into hook/framework scoring).
  // Do not fabricate a status for this.
  return {
    name: "Performance Diagnostics",
    type: "feedback-loop",
    version: null,
    source: null,
    status: STATUS.MISSING,
    itemCount: 0,
    expectedItemCount: null,
    validationStatus: "Not validated",
    validationDetails: ["Not implemented — no real ad-performance data is fed back into Brandee's planning logic yet."],
    lastUpdated: null,
    runtimeUsageStatus: "Not used"
  };
}

function validatePlannerRules() {
  const relPath = "src/brandee/planner.js";
  const info = fileInfo(relPath);
  const name = "Planner Rules";
  const type = "engine";
  if (!info.exists) return notPresent(name, type, relPath);

  const { ok, mod, error } = safeRequire(relPath);
  if (!ok) return invalid(name, type, relPath, info, `Module failed to load: ${error}`);

  const requiredFns = ["generateCreativePlan", "buildDeterministicPlan", "buildAngles", "scoreHook"];
  const missing = requiredFns.filter((fn) => typeof mod[fn] !== "function");

  return {
    name, type,
    version: RESOURCE_BASELINE_VERSION,
    source: relPath,
    status: missing.length ? STATUS.INVALID : STATUS.ACTIVE,
    itemCount: requiredFns.length - missing.length,
    expectedItemCount: requiredFns.length,
    validationStatus: missing.length ? "Failed" : "Passed",
    validationDetails: missing.length ? [`Missing function(s): ${missing.join(", ")}`] : [],
    lastUpdated: info.mtime,
    runtimeUsageStatus: "Core deterministic planning engine — always runs; AI is an optional polish layer on top"
  };
}

function validateSchema(resourceName, exportName) {
  const relPath = "src/brandee/schemas.js";
  const info = fileInfo(relPath);
  const type = "schema";
  if (!info.exists) return notPresent(resourceName, type, relPath);

  const { ok, mod, error } = safeRequire(relPath);
  if (!ok) return invalid(resourceName, type, relPath, info, `Module failed to load: ${error}`);

  const schema = mod[exportName];
  const problems = [];
  if (!schema || typeof schema.safeParse !== "function") {
    problems.push(`${exportName} is missing or is not a Zod schema.`);
  } else {
    // Confirm the schema actually rejects a deliberately-malformed object —
    // this is what makes this "validated," not just "present."
    const rejectsBad = schema.safeParse({ __obviously_invalid__: true }).success === false;
    if (!rejectsBad) problems.push(`${exportName} did not reject a malformed test object — schema may be too permissive.`);
  }

  return {
    name: resourceName, type,
    version: RESOURCE_BASELINE_VERSION,
    source: relPath,
    status: problems.length ? STATUS.INVALID : STATUS.ACTIVE,
    itemCount: 1,
    expectedItemCount: 1,
    validationStatus: problems.length ? "Failed" : "Passed",
    validationDetails: problems,
    lastUpdated: info.mtime,
    runtimeUsageStatus: `Used to validate ${exportName === "WebsiteBusinessAnalysisSchema" ? "website analysis output" : "the final creative plan"} before it is persisted or returned`
  };
}

function validateAdCreativeSkill() {
  const relPath = "skills/ad-creative/SKILL.md";
  const info = fileInfo(relPath);
  const present = info.exists;

  return {
    name: "Ad Creative Skill",
    type: "external-skill",
    version: null,
    source: "coreyhaines31/marketingskills (skills/ad-creative/SKILL.md)",
    status: present ? STATUS.INACTIVE : STATUS.MISSING,
    itemCount: present ? 1 : 0,
    expectedItemCount: 1,
    validationStatus: "Not validated",
    validationDetails: present
      ? ["File is present locally but is not wired into any runtime code path — see runtimeUsageStatus."]
      : ["Not present locally. This skill has never been vendored into this repository."],
    lastUpdated: info.mtime,
    runtimeUsageStatus: "Not integrated — Brandee's hook/framework/goal/awareness rules (src/brandee/*) were authored independently in this repo and do not reference this external skill's content.",
    presentLocally: present,
    licenseOrAttribution: present ? "Not extracted — inspect the file directly." : "Unknown (not present locally)",
    supportingReferencesPresent: false,
    contentChecksum: present ? checksumOfFile(relPath) : null,
    distinctions: {
      documentationPresent: present,
      rulesAdaptedIntoRuntime: false,
      actuallyUsedByPlanner: false
    }
  };
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

function notPresent(name, type, relPath) {
  return {
    name, type, version: null, source: relPath, status: STATUS.MISSING,
    itemCount: 0, expectedItemCount: null, validationStatus: "Not validated",
    validationDetails: [`File not found: ${relPath}`], lastUpdated: null, runtimeUsageStatus: "Not used"
  };
}

function invalid(name, type, relPath, info, reason) {
  return {
    name, type, version: null, source: relPath, status: STATUS.INVALID,
    itemCount: 0, expectedItemCount: null, validationStatus: "Failed",
    validationDetails: [reason], lastUpdated: info.mtime, runtimeUsageStatus: "Unknown — module failed to load"
  };
}

function findDuplicates(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

const RESOURCE_VALIDATORS = Object.freeze({
  adCreativeSkill: validateAdCreativeSkill,
  staticAdFrameworks: validateStaticAdFrameworks,
  hookFramework: validateHookLibrary,
  goalMappings: validateGoalMappings,
  awarenessRules: validateAwarenessRules,
  proofRules: validateProofRules,
  platformRules: validatePlatformRules,
  performanceDiagnostics: validatePerformanceDiagnostics,
  plannerRules: validatePlannerRules,
  businessProfileSchema: () => validateSchema("Business Profile Schema", "WebsiteBusinessAnalysisSchema"),
  creativePlanSchema: () => validateSchema("Creative Plan Schema", "BrandeeCreativePlanSchema")
});

function validateAllResources() {
  const results = {};
  for (const [key, fn] of Object.entries(RESOURCE_VALIDATORS)) {
    try {
      results[key] = fn();
    } catch (error) {
      results[key] = { name: key, type: "unknown", status: STATUS.INVALID, validationStatus: "Failed", validationDetails: [`Validator threw: ${error.message}`] };
    }
  }
  return results;
}

function getCreativeBrainStatus() {
  const resources = validateAllResources();
  const anyInvalidOrMissing = Object.values(resources).some((r) => r.status === STATUS.INVALID || (r.status === STATUS.MISSING && r.name !== "Ad Creative Skill" && r.name !== "Performance Diagnostics"));
  return {
    version: CREATIVE_BRAIN_VERSION,
    active: !anyInvalidOrMissing,
    lastValidation: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    extractionPromptVersion: "n/a — deterministic heuristic extraction, no LLM prompt in the extraction path (see src/brandee/websiteAnalyzer.js)",
    plannerPromptVersion: RESOURCE_BASELINE_VERSION,
    businessProfileSchemaVersion: RESOURCE_BASELINE_VERSION,
    creativePlanSchemaVersion: RESOURCE_BASELINE_VERSION
  };
}

module.exports = {
  CREATIVE_BRAIN_VERSION,
  EXPECTED_COUNTS,
  STATUS,
  RESOURCE_VALIDATORS,
  validateAllResources,
  getCreativeBrainStatus,
  validateAdCreativeSkill,
  validateStaticAdFrameworks,
  validateHookLibrary,
  validateGoalMappings,
  validateAwarenessRules,
  validateProofRules,
  validatePlatformRules,
  validatePerformanceDiagnostics,
  validatePlannerRules
};
