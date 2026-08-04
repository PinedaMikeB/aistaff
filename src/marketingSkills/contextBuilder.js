// Builds the (currently empty) extra context a marketing skill would need
// once wired up — e.g. the BusinessProfile + form for "customer-research",
// or the candidate hook list for "ad-creative". Returns an explicit
// `available: false` today so any future caller can tell the difference
// between "the skill ran and had nothing to add" and "the skill isn't
// wired up yet" — never silently returns an empty object that could be
// misread as a real (if unhelpful) result.

function buildContextFor(_skillId, _payload) {
  return { available: false, reason: "Marketing-skill runtime integration is not active in production yet." };
}

module.exports = { buildContextFor };
