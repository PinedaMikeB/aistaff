// Registry of marketing-skill availability. Everything reports
// `runtime_inactive` — this is a prepared integration boundary (PART 29),
// not a live capability. No code path in the analyze route or planner
// reads from this registry to make a real decision yet; it exists so a
// future task can flip specific entries to `active` deliberately, one at a
// time, once each has a real, tested, version-controlled source (not a
// local `.claude/skills` directory).

const { MARKETING_SKILL_MAP } = require("./manifest");

const RUNTIME_STATUS = "runtime_inactive";

function getSkillStatus(skillId) {
  const entry = MARKETING_SKILL_MAP[skillId];
  if (!entry) return { skillId, known: false, status: "unknown" };
  return { skillId, known: true, status: RUNTIME_STATUS, installedForDevelopment: entry.status === "installed_for_development", appliesTo: entry.appliesTo || [] };
}

function listSkills() {
  return Object.keys(MARKETING_SKILL_MAP).map(getSkillStatus);
}

function isActive(_skillId) {
  // Deliberately always false until a real production integration exists —
  // see module header. Takes an argument for forward-compat call sites.
  return false;
}

module.exports = { RUNTIME_STATUS, getSkillStatus, listSkills, isActive };
