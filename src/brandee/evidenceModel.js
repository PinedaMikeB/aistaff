// Shared Evidence model + verified/user-supplied/inferred separation
// (PART 12). Every fact used anywhere downstream (planner, results page)
// should be traceable to exactly one of these three sourceTypes — never
// displayed as "verified" unless it actually is.

const SOURCE_TYPES = ["website", "linked_subdomain", "linked_external", "user", "inference"];

function makeEvidence({ statement, sourceType, sourceUrl = null, excerpt = null, confidence = 0.5, entityType = "unknown" }) {
  return { statement, sourceType, sourceUrl, excerpt, confidence, entityType };
}

function isVerified(evidence) {
  return evidence.sourceType === "website" || evidence.sourceType === "linked_subdomain" || evidence.sourceType === "linked_external";
}

function isUserSupplied(evidence) {
  return evidence.sourceType === "user";
}

function isInferred(evidence) {
  return evidence.sourceType === "inference";
}

/** Splits a mixed evidence list into the three PART 12 buckets for display. */
function partitionEvidence(evidenceList = []) {
  const verified = [];
  const userSupplied = [];
  const inferred = [];
  for (const e of evidenceList) {
    if (isInferred(e)) inferred.push(e);
    else if (isUserSupplied(e)) userSupplied.push(e);
    else verified.push(e);
  }
  return { verified, userSupplied, inferred };
}

module.exports = { SOURCE_TYPES, makeEvidence, isVerified, isUserSupplied, isInferred, partitionEvidence };
