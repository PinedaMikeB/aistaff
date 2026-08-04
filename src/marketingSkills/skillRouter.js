// Routes a task (e.g. "score this hook", "extract customer problems") to a
// candidate marketing-skill id, for future use once the loader has a real
// production source. Never invoked from the live analyze route today —
// this is the seam a future task wires up, kept separate so that wiring is
// a one-file change instead of scattering `isActive()` checks everywhere.

const { getSkillStatus, isActive } = require("./registry");

function routeTask(taskType) {
  const candidates = {
    extract_business_profile: "customer-research",
    score_hook: "ad-creative",
    edit_copy: "copy-editing",
    pick_angle: "marketing-psychology",
    evaluate_offer: "offers",
    plan_test: "ab-testing"
  };
  const skillId = candidates[taskType] || null;
  if (!skillId) return { skillId: null, active: false };
  return { skillId, ...getSkillStatus(skillId), active: isActive(skillId) };
}

module.exports = { routeTask };
