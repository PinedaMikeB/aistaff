const { prisma } = require("./db");
const {
  lookupFacebookPage,
  lookupWebsite,
  buildPresenceSnapshot,
  assessAiSalesFit
} = require("./page-intelligence");
const {
  personalizeAssessment,
  organizationProfileForContext,
  hasOrganizationProfile
} = require("./organization-profile");
const {
  buildAssessmentToolInstruction,
  buildAssessmentFactsPayload
} = require("./aistaff-assessment-principles");

// Derived from payments.js — this module writes real Quotation.amount values,
// so a wrong number here becomes a written quote the customer can hold us to.
const { MINIMUM_OFFER } = require("./closer-pricing");

async function nextQuotationNumber(companyId) {
  const count = await prisma.quotation.count({ where: { company_id: companyId } });
  return `Q-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;
}

function buildQuotationDetails(session) {
  const lines = [
    `${MINIMUM_OFFER.name}`,
    `Package: ${MINIMUM_OFFER.price}`,
    `Channel: ${MINIMUM_OFFER.channel}`,
    "",
    "Includes:",
    "- Chat-only AI replies on Facebook Messenger",
    "- Public Facebook Page + website review for products/services",
    "- Real-time inquiry qualification",
    "- Quotation drafts with admin approval before sending",
    "",
    `Customer: ${session.customerName || "TBD"}`,
    `Company: ${session.companyName || session.businessType || "TBD"}`,
    `Facebook Page: ${session.pageName || session.pageUrl || "TBD"}`,
    `Website: ${session.websiteUrl || (session.websiteStatus === "none" ? "none" : "TBD")}`,
    `Email: ${session.email || "TBD"}`,
    `Mobile: ${session.phone || "TBD"}`
  ];
  if (session.inquiryTopics) lines.push(`Inquiry topics: ${session.inquiryTopics}`);
  if (session.pageSnapshot?.assessment?.summary) {
    lines.push("", "Fit assessment:", session.pageSnapshot.assessment.summary);
  }
  return lines.join("\n");
}

async function checkFacebookPageTool(session, { name, url } = {}) {
  const input = url || name || session.pageUrl || session.pageName;
  if (!input) {
    return { ok: false, error: "Need a Facebook Page URL or name first." };
  }

  const result = await lookupFacebookPage(input, {
    requestedName: name || session.pageName || input
  });

  if (!session.pageSnapshot) session.pageSnapshot = {};
  if (result.ok && result.facebook) {
    session.pageSnapshot.facebook = result.facebook;
    session.pageSnapshot.facebookMatch = result.match || null;
    session.pageSnapshot.facebookCheckedUrl = result.checkedUrl || "";
    if (result.candidates?.length) session.pageSnapshot.facebookCandidates = result.candidates;
  } else {
    session.pageSnapshot.facebookError = result.error || "Facebook lookup failed";
  }

  return {
    ok: Boolean(result.ok && result.facebook),
    pageName: result.facebook?.name || null,
    url: result.facebook?.url || result.checkedUrl || null,
    description: result.facebook?.description || null,
    followers: result.facebook?.followers ?? result.facebook?.likes ?? null,
    candidates: (result.candidates || []).map((candidate, index) => ({
      index: index + 1,
      name: candidate.name || candidate.slug,
      slug: candidate.slug
    })),
    error: result.ok ? null : (result.error || "Could not load Facebook Page preview")
  };
}

async function checkWebsiteTool(session, { url } = {}) {
  const target = url || session.websiteUrl;
  if (!target) {
    return {
      ok: false,
      error: session.websiteStatus === "none" ? "Customer said they have no website." : "Need a website URL first."
    };
  }

  const result = await lookupWebsite(target);
  if (!session.pageSnapshot) session.pageSnapshot = {};

  if (result.ok && result.website) {
    session.websiteUrl = result.website.url || target;
    session.websiteStatus = "provided";
    session.pageSnapshot.website = result.website;
    session.pageSnapshot.websiteCheckedUrl = result.checkedUrl || target;
    return {
      ok: true,
      url: result.website.url,
      title: result.website.title || null,
      description: result.website.description || null,
      serviceHints: result.website.serviceHints || [],
      pagesChecked: result.website.pagesChecked || [],
      hasContactSignals: Boolean(result.website.hasContactSignals),
      hasMessengerSignals: Boolean(result.website.hasMessengerSignals)
    };
  }

  session.pageSnapshot.websiteError = result.error || "Website check failed";
  return { ok: false, error: result.error || "Could not read website preview", url: target };
}

async function assessAiFitTool(session) {
  const snapshot = await buildPresenceSnapshot({
    facebookInput: session.pageUrl || session.pageName,
    websiteInput: session.websiteStatus === "provided" ? session.websiteUrl : "",
    requestedPageName: [session.pageName, session.businessType, session.inquiryTopics].filter(Boolean).join(" "),
    websiteStatus: session.websiteStatus
  });

  session.pageSnapshot = snapshot;
  session.pageSnapshotKey = [session.pageUrl, session.pageName, session.websiteUrl, session.websiteStatus]
    .filter(Boolean)
    .join("|")
    .toLowerCase();
  session.pageSnapshotShown = true;

  const baseAssessment = assessAiSalesFit(snapshot);
  snapshot.assessment = personalizeAssessment(baseAssessment, session);
  const assessment = snapshot.assessment;
  session.assessmentDelivered = true;
  const pageFacts = buildAssessmentFactsPayload(snapshot, session);
  return {
    ok: Boolean(snapshot.ok),
    pageFacts,
    fit: assessment?.fit || "needs_review",
    summary: assessment?.summary || "",
    signals: assessment?.signals || [],
    missedOpportunities: assessment?.missedOpportunities || [],
    benefitAngles: assessment?.benefits || [],
    opportunities: assessment?.opportunities || [],
    thoughts: snapshot.thoughts || [],
    organizationProfile: organizationProfileForContext(session),
    instruction: buildAssessmentToolInstruction({
      hasProfile: hasOrganizationProfile(session.organizationProfile)
    })
  };
}

async function makeQuotationDraftTool(session, { companyId, psid, pageId } = {}) {
  if (!companyId || !psid) {
    return { ok: false, error: "Missing company or conversation context for quotation draft." };
  }

  session.quotationOffered = true;
  const details = buildQuotationDetails(session);

  const conversation = await prisma.conversation.upsert({
    where: { company_id_psid: { company_id: companyId, psid } },
    create: {
      company_id: companyId,
      psid,
      customer_name: session.customerName || session.contact || null,
      channel: "facebook_messenger",
      status: "open",
      intent: "aistaff_demo_inquiry",
      last_message_at: new Date()
    },
    update: { last_message_at: new Date() }
  });

  let lead = await prisma.lead.findFirst({
    where: { company_id: companyId, conversation_id: conversation.id },
    orderBy: { updated_at: "desc" }
  });

  const leadData = {
    customer_name: session.customerName || null,
    mobile_number: session.phone || null,
    email: session.email || null,
    company_name: session.companyName || session.businessType || null,
    location: session.pageUrl || null,
    service_needed: [
      MINIMUM_OFFER.name,
      session.inquiryTopics || "",
      session.pageName ? `Facebook Page: ${session.pageName}` : "",
      session.websiteUrl ? `Website: ${session.websiteUrl}` : (session.websiteStatus === "none" ? "Website: none" : "")
    ].filter(Boolean).join(" | "),
    budget: session.weeklyInquiries || null,
    urgency: session.sendsQuotations || null,
    lead_status: "qualified",
    lead_score: session.weeklyInquiries ? "hot" : "warm",
    quotation_ready: true
  };

  if (lead) {
    lead = await prisma.lead.update({ where: { id: lead.id }, data: leadData });
  } else {
    lead = await prisma.lead.create({
      data: { company_id: companyId, conversation_id: conversation.id, ...leadData }
    });
  }

  const existing = await prisma.quotation.findFirst({
    where: { company_id: companyId, lead_id: lead.id, status: { in: ["draft", "pending_approval"] } }
  });
  if (existing) {
    session.quotationDraftId = existing.id;
    session.quotationNumber = existing.quotation_number;
    return {
      ok: true,
      quotationNumber: existing.quotation_number,
      status: existing.status,
      package: MINIMUM_OFFER.name,
      price: MINIMUM_OFFER.price,
      summary: `Quotation draft ${existing.quotation_number} already on file.`,
      email: session.email || null
    };
  }

  const settings = await prisma.companySetting.findUnique({ where: { company_id: companyId } });
  const quotation = await prisma.quotation.create({
    data: {
      company_id: companyId,
      lead_id: lead.id,
      conversation_id: conversation.id,
      quotation_number: await nextQuotationNumber(companyId),
      customer_name: lead.customer_name,
      customer_company: lead.company_name,
      service_needed: lead.service_needed,
      quotation_details: details,
      // Plans are pure monthly recurring — there is no mandatory setup fee.
      // Onboarding items in MINIMUM_OFFER.optionalSetup are quoted separately.
      amount: MINIMUM_OFFER.monthly,
      terms: [
        `Monthly subscription: PHP ${MINIMUM_OFFER.monthly.toLocaleString()}/month (${MINIMUM_OFFER.name}).`,
        `Includes up to ${MINIMUM_OFFER.conversationLimit.toLocaleString()} AI-assisted conversations per month.`,
        "No setup fee. Optional one-time onboarding add-ons are quoted separately:",
        MINIMUM_OFFER.optionalSetup.map((a) => `${a.name} ${a.priceLabel}`).join("; ") + ".",
        "Subject to admin review and approval before email send."
      ].join(" "),
      status: settings?.quotation_requires_admin_approval === false ? "draft" : "pending_approval",
      mode: settings?.quotation_mode || "approval_required"
    }
  });

  session.quotationDraftId = quotation.id;
  session.quotationNumber = quotation.quotation_number;

  return {
    ok: true,
    quotationNumber: quotation.quotation_number,
    status: quotation.status,
    package: MINIMUM_OFFER.name,
    price: MINIMUM_OFFER.price,
    setupAmount: MINIMUM_OFFER.setup,
    monthlyAmount: MINIMUM_OFFER.monthly,
    summary: `Created quotation draft ${quotation.quotation_number} for admin approval.`,
    email: session.email || null,
    readyToEmail: Boolean(session.email)
  };
}

module.exports = {
  MINIMUM_OFFER,
  checkFacebookPageTool,
  checkWebsiteTool,
  assessAiFitTool,
  makeQuotationDraftTool,
  buildQuotationDetails
};
