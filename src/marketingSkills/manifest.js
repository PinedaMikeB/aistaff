// Manifest of marketing-skill mappings Brandee COULD draw on once a real,
// version-controlled, production integration is built. PART 29 of the
// deep-understanding reliability upgrade explicitly requires this to be
// prepared but NOT wired into live customer requests yet — every entry here
// is `status: "installed_for_development"` and this module reads nothing
// from disk. It exists so the eventual production integration has a single,
// obvious place to fill in, instead of Brandee silently claiming a
// capability it doesn't have.
//
// This does NOT read from `.claude/skills` or any local Claude Code skill
// directory at runtime — those are development-time tools, not a
// production data source, and this repo's server process must never depend
// on them (PART 29 "Do not read .claude/skills from live customer requests").

const MARKETING_SKILL_MAP = Object.freeze({
  "product-marketing": { status: "installed_for_development", appliesTo: ["businessProfileBuilder", "planner"] },
  "customer-research": { status: "installed_for_development", appliesTo: ["businessProfileBuilder"] },
  "ad-creative": { status: "installed_for_development", appliesTo: ["planner", "hookScoring"] },
  copywriting: { status: "installed_for_development", appliesTo: ["planner", "copyQuality"] },
  "copy-editing": { status: "installed_for_development", appliesTo: ["copyQuality"] },
  "marketing-psychology": { status: "installed_for_development", appliesTo: ["angleDiversity", "planner"] },
  offers: { status: "installed_for_development", appliesTo: ["entityExtraction"] },
  "ab-testing": { status: "installed_for_development", appliesTo: ["planner"] }
});

module.exports = { MARKETING_SKILL_MAP };
