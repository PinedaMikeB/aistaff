// Loader stub. In production integration, this would load a
// version-controlled, reviewed skill document (e.g. from a vetted internal
// package or a signed content bundle) — NOT a filesystem path like
// `.claude/skills`, which is a local development convenience only and may
// not even exist on a deployed server. Until that real source exists, every
// call here returns null and logs nothing sensitive.

function loadSkillContent(_skillId) {
  return null; // no production source wired yet — see registry.js RUNTIME_STATUS
}

module.exports = { loadSkillContent };
