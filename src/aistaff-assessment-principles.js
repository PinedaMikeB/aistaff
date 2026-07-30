/**
 * Principles for AI-written Page/website assessments — NOT canned copy.
 * The model must synthesize fresh wording from tool facts each turn.
 */

const ASSESSMENT_REPLY_PRINCIPLES = [
  "YOU write every assessment reply in your own words — never paste a pre-written report or repeat fixed example sentences.",
  "Sound like a warm consultant chatting on Messenger, not a checklist, audit PDF, or marketing brochure.",
  "Ground every claim in assess_ai_fit / check_facebook_page / check_website facts and organizationProfile for THIS customer only.",
  "Never reuse phrasing from another company's conversation or from training examples — personalize from their Page, website, and operations."
].join("\n");

const ASSESSMENT_WHY_IT_WORKS = [
  "Why conversational assessments work (apply the principle, do not copy these lines):",
  "- The customer feels heard: you name their actual Page and website and show you understand what the organization does.",
  "- It connects findings to their world: typical Messenger inquiries and how they operate day to day.",
  "- It bridges to value naturally: what AIStaff would change for them, in their context — not generic feature lists.",
  "- Benefits feel human: numbered points with breathing room (blank line between each), each with a short title and a real explanation.",
  "- One gentle question at the end invites the next step without pressure or pricing."
].join("\n");

const ASSESSMENT_STRUCTURE_GUIDE = [
  "When assessing, analyzing, visiting, or checking a Page/website, structure your reply in two conversational parts (two Messenger bubbles when doing a full review):",
  "",
  "PART A — Review & fit (one flowing paragraph):",
  "- Open naturally with their name if you have it.",
  "- State what you reviewed (their Facebook Page name, website if known).",
  "- Explain what the Page/organization is about and how they appear to operate (from public preview + organizationProfile).",
  "- Mention likely Messenger inquiry patterns specific to them.",
  "- Give an honest fit read (strong / good / promising) tied to their situation.",
  "- Bridge to how AIStaff helps avoid missed or slow replies in their context.",
  "- Close with one question about exploring setup — not price.",
  "",
  "PART B — How it makes their life easier (only when they ask for benefits, or after Part A in a full review):",
  "- Short conversational intro tied to their organization name.",
  "- 3–4 numbered benefits; blank line between each point.",
  "- Format each as: Number. Short title: one or two sentences explaining the benefit in THEIR context (their inquiries, volunteers, seekers, quotes, etc.).",
  "- One-sentence wrap-up on less manual work / faster engagement / fewer missed opportunities.",
  "- One closing question.",
  "",
  "Avoid: ALL-CAPS section headers, bullet dumps, stiff labels like WHAT WE FOUND, walls of text with no spacing, or copying any example word-for-word."
].join("\n");

function buildMessengerAssessmentFormattingGuide() {
  return [
    "MESSENGER ASSESSMENT STYLE (when reviewing a Page/website):",
    "Plain text only — no bold, markdown, or HTML.",
    "",
    ASSESSMENT_WHY_IT_WORKS,
    "",
    ASSESSMENT_STRUCTURE_GUIDE,
    "",
    ASSESSMENT_REPLY_PRINCIPLES
  ].join("\n");
}

function buildAssessmentToolInstruction({ hasProfile = false } = {}) {
  const profileStep = hasProfile
    ? "organizationProfile is set — personalize operations, inquiries, and benefits from it."
    : "Call set_organization_profile first with THIS org's operations, typical inquiries, pain points, and personalized benefit angles — then assess_ai_fit again if needed.";
  return [
    "Write the Messenger reply yourself using pageFacts and assessment data below.",
    profileStep,
    "Follow ASSESSMENT_STRUCTURE_GUIDE in the system prompt: Part A (review & fit paragraph), Part B (spaced numbered benefits) when appropriate.",
    "Do NOT copy example phrases, templates, or any pre-written report field — synthesize fresh, conversational copy every time.",
    "Use organizationProfile and pageFacts only for THIS customer — never bleed details from other conversations."
  ].join(" ");
}

function buildAssessmentFactsPayload(snapshot, session = {}) {
  const assessment = snapshot?.assessment || {};
  const profile = session.organizationProfile || null;
  const websiteUrl = session.websiteUrl || snapshot?.website?.url || null;
  let websiteHost = null;
  if (websiteUrl) {
    try {
      websiteHost = new URL(websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`).hostname.replace(/^www\./i, "");
    } catch {
      websiteHost = String(websiteUrl).replace(/^https?:\/\//i, "").split("/")[0];
    }
  }

  return {
    pageName: snapshot?.facebook?.name || session.pageName || null,
    pageDescription: snapshot?.facebook?.description || null,
    pageUrl: snapshot?.facebook?.url || session.pageUrl || null,
    followersOrLikes: snapshot?.facebook?.followers ?? snapshot?.facebook?.likes ?? null,
    websiteTitle: snapshot?.website?.title || null,
    websiteHost,
    websiteDescription: snapshot?.website?.description || null,
    customerName: session.customerName || null,
    companyName: session.companyName || session.businessType || null,
    fit: assessment.fit || null,
    summary: assessment.summary || null,
    signals: assessment.signals || [],
    missedOpportunities: assessment.missedOpportunities || [],
    benefitAngles: assessment.benefits || [],
    opportunities: assessment.opportunities || [],
    thoughts: snapshot?.thoughts || [],
    organizationProfile: profile
      ? {
        industryOrFocus: profile.industryOrFocus || null,
        operationsSummary: profile.operationsSummary || null,
        typicalInquiries: profile.typicalInquiries || [],
        painPoints: profile.painPoints || [],
        personalizedBenefits: profile.personalizedBenefits || [],
        messengerUseCase: profile.messengerUseCase || null
      }
      : null
  };
}

module.exports = {
  ASSESSMENT_REPLY_PRINCIPLES,
  ASSESSMENT_WHY_IT_WORKS,
  ASSESSMENT_STRUCTURE_GUIDE,
  buildMessengerAssessmentFormattingGuide,
  buildAssessmentToolInstruction,
  buildAssessmentFactsPayload
};
