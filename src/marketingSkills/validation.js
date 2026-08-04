// Validates that the marketing-skills runtime module is being used
// correctly — specifically, that nothing in this repo claims a skill is
// "active" without going through registry.js's isActive() (which always
// returns false today). Intended for a future integration PR to import as
// a guard/test helper, not part of the live request path.

const { listSkills } = require("./registry");

function assertNoSkillClaimsActive() {
  const activeClaims = listSkills().filter((s) => s.status === "active");
  if (activeClaims.length) {
    throw new Error(`Marketing-skills runtime is not production-ready but these report active: ${activeClaims.map((s) => s.skillId).join(", ")}`);
  }
  return true;
}

module.exports = { assertNoSkillClaimsActive };
