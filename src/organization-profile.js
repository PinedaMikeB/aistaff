function emptyOrganizationProfile() {
  return {
    industryOrFocus: "",
    operationsSummary: "",
    typicalInquiries: [],
    painPoints: [],
    personalizedBenefits: [],
    messengerUseCase: "",
    updatedAt: null
  };
}

function hasOrganizationProfile(profile) {
  if (!profile) return false;
  return Boolean(
    profile.industryOrFocus
    || profile.operationsSummary
    || profile.messengerUseCase
    || profile.typicalInquiries?.length
    || profile.painPoints?.length
    || profile.personalizedBenefits?.length
  );
}

function normalizeStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8);
  }
  return String(value)
    .split(/\n|;|•/)
    .map((item) => item.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function applyOrganizationProfile(session, patch = {}) {
  const current = session.organizationProfile || emptyOrganizationProfile();
  const next = { ...current };

  if (patch.industryOrFocus) next.industryOrFocus = String(patch.industryOrFocus).trim().slice(0, 200);
  if (patch.operationsSummary) next.operationsSummary = String(patch.operationsSummary).trim().slice(0, 500);
  if (patch.messengerUseCase) next.messengerUseCase = String(patch.messengerUseCase).trim().slice(0, 300);

  for (const key of ["typicalInquiries", "painPoints", "personalizedBenefits"]) {
    if (patch[key] !== undefined && patch[key] !== null && patch[key] !== "") {
      next[key] = normalizeStringList(patch[key]);
    }
  }

  if (patch.replace) {
    if (patch.typicalInquiries !== undefined) next.typicalInquiries = normalizeStringList(patch.typicalInquiries);
    if (patch.painPoints !== undefined) next.painPoints = normalizeStringList(patch.painPoints);
    if (patch.personalizedBenefits !== undefined) next.personalizedBenefits = normalizeStringList(patch.personalizedBenefits);
  }

  next.updatedAt = new Date().toISOString();
  session.organizationProfile = next;
  return next;
}

function syncLegacyBusinessFieldsFromProfile(session) {
  const profile = session.organizationProfile;
  if (!profile) return;
  if (profile.industryOrFocus && !session.businessType) {
    session.businessType = profile.industryOrFocus;
  }
  if (profile.typicalInquiries?.length && !session.inquiryTopics) {
    session.inquiryTopics = profile.typicalInquiries.join("; ");
  }
}

function personalizeAssessment(baseAssessment, session) {
  const profile = session.organizationProfile;
  if (!hasOrganizationProfile(profile)) return { ...baseAssessment };

  const personalized = { ...baseAssessment };
  const noticed = [];

  if (profile.operationsSummary) {
    personalized.summary = profile.operationsSummary;
  } else if (profile.industryOrFocus) {
    personalized.summary = `Based on your public presence as ${profile.industryOrFocus}, a Messenger inbox assistant can help capture and qualify inquiries consistently.`;
  }

  if (profile.typicalInquiries?.length) {
    for (const inquiry of profile.typicalInquiries.slice(0, 4)) {
      noticed.push(`Typical Messenger inquiry: ${inquiry}`);
    }
  }
  if (profile.messengerUseCase) {
    noticed.push(`How Messenger is used: ${profile.messengerUseCase}`);
  }
  if (profile.industryOrFocus) {
    noticed.push(`Organization focus: ${profile.industryOrFocus}`);
  }

  personalized.signals = [...noticed, ...(baseAssessment.signals || [])].slice(0, 6);

  if (profile.painPoints?.length) {
    personalized.missedOpportunities = profile.painPoints.slice(0, 4);
  }

  if (profile.personalizedBenefits?.length) {
    personalized.benefits = profile.personalizedBenefits.slice(0, 5);
  } else if (profile.typicalInquiries?.length) {
    personalized.benefits = profile.typicalInquiries.slice(0, 3).map((inquiry) => (
      `Faster replies when someone asks about ${inquiry.toLowerCase()}: Instant Messenger response plus captured details for your team.`
    ));
  }

  return personalized;
}

function organizationProfileForContext(session) {
  const profile = session.organizationProfile;
  if (!hasOrganizationProfile(profile)) return null;
  return {
    industryOrFocus: profile.industryOrFocus || null,
    operationsSummary: profile.operationsSummary || null,
    typicalInquiries: profile.typicalInquiries || [],
    painPoints: profile.painPoints || [],
    personalizedBenefits: profile.personalizedBenefits || [],
    messengerUseCase: profile.messengerUseCase || null,
    updatedAt: profile.updatedAt || null
  };
}

module.exports = {
  emptyOrganizationProfile,
  hasOrganizationProfile,
  applyOrganizationProfile,
  syncLegacyBusinessFieldsFromProfile,
  personalizeAssessment,
  organizationProfileForContext,
  normalizeStringList
};
