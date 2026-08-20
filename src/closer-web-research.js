const {
  lookupWebsite,
  isFacebookUrl,
  isLikelyWebsiteUrl,
  normalizeUrl
} = require("./page-intelligence");

const RESEARCH_START = "[CLOSER_PUBLIC_WEBSITE_RESEARCH]";
const RESEARCH_END = "[/CLOSER_PUBLIC_WEBSITE_RESEARCH]";

function firstWebsiteUrl(text) {
  const raw = String(text || "");
  const matches = [
    ...raw.matchAll(/https?:\/\/[^\s<>()]+/gi),
    ...raw.matchAll(/\b(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:\/[^\s<>()]*)?/gi)
  ];

  for (const match of matches) {
    const candidate = String(match[0] || "").replace(/[.,!?;:)\]]+$/g, "");
    if (!candidate || isFacebookUrl(candidate) || !isLikelyWebsiteUrl(candidate)) continue;
    return normalizeUrl(candidate);
  }
  return "";
}

function shouldResearchWebsite({ company, message, url }) {
  if (!url) return false;
  const companyText = `${company?.name || ""} ${company?.industry || ""}`.toLowerCase();
  if (/aistaff|ai voice|ai chat|chat agent|sales agent|software|marketing|consult/i.test(companyText)) {
    return true;
  }

  const text = String(message || "").toLowerCase();
  return /\b(my|our|company|business|negosyo|website|site|page|sell|service|product|products|services)\b/i.test(text);
}

function stripResearchContext(notes) {
  return String(notes || "")
    .replace(new RegExp(`\\n?${escapeRegExp(RESEARCH_START)}[\\s\\S]*?${escapeRegExp(RESEARCH_END)}\\n?`, "g"), "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractResearchContext(notes) {
  const match = String(notes || "").match(new RegExp(`${escapeRegExp(RESEARCH_START)}\\n([\\s\\S]*?)\\n${escapeRegExp(RESEARCH_END)}`));
  return match ? match[1].trim() : "";
}

function hasResearchForUrl(notes, url) {
  const context = extractResearchContext(notes);
  return Boolean(context && url && context.includes(`URL: ${url}`));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function likelyPainAndSolutionLines(website) {
  const blob = [
    website?.title,
    website?.description,
    ...(website?.serviceHints || [])
  ].filter(Boolean).join(" ").toLowerCase();

  const lines = [];
  if (/spa|wellness|massage|facial|therapy|therapist|treatment|appointment|book now|booking/i.test(blob)) {
    lines.push("Likely conversion path: appointment booking or reservation, not quotation.");
    lines.push("Pain: customers often ask about treatments, branches, schedules, and booking slots, then disappear if booking is not easy.");
    lines.push("Solution: Closer can answer treatment questions, collect name/mobile/preferred date or branch, and move them to booking or reservation in chat.");
  } else if (/restaurant|cafe|food|menu|order|delivery|reservation|booking/i.test(blob)) {
    lines.push("Likely conversion path: order, table booking, reservation, or delivery inquiry, not quotation unless the site says catering/events.");
    lines.push("Pain: customers ask about menu, availability, reservations, or delivery and leave when replies are slow.");
    lines.push("Solution: Closer can answer common questions, guide booking/order details, and hand off complete inquiries.");
  } else if (/real estate|property|house|condo|apartment|rental|rent|sale|broker/i.test(blob)) {
    lines.push("Pain: buyers ask repeated questions about price, location, viewing, and availability.");
    lines.push("Solution: Closer can qualify budget/location/timeline, send property media, and route serious buyers quickly.");
  } else if (/car|auto|vehicle|dealer|financing|loan/i.test(blob)) {
    lines.push("Pain: buyers ask about the same units, monthly estimates, requirements, and availability.");
    lines.push("Solution: Closer can capture preferred model, budget, financing intent, and schedule a staff follow-up.");
  } else if (/clinic|dental|doctor|medical|health|therapy|appointment/i.test(blob)) {
    lines.push("Pain: patients ask service, schedule, location, and appointment questions after hours.");
    lines.push("Solution: Closer can answer stated clinic info, collect appointment details, and route sensitive questions to staff.");
  } else if (/school|course|training|enroll|tuition|student/i.test(blob)) {
    lines.push("Pain: parents/students ask about courses, fees, requirements, and enrollment steps repeatedly.");
    lines.push("Solution: Closer can explain stated programs, collect applicant details, and move interested families to enrollment.");
  } else if (/repair|maintenance|install|service|technician/i.test(blob)) {
    lines.push("Pain: customers need quick estimates, schedules, and service-area confirmation.");
    lines.push("Solution: Closer can collect issue, location, urgency, photos/files when available, and prepare the job for staff.");
  } else {
    lines.push("Pain: warm inquiries can go cold when replies are delayed, incomplete, or inconsistent.");
    lines.push("Solution: Closer can answer common questions, capture buyer details, follow up, and move ready prospects to the next step.");
  }

  if (website?.hasContactSignals) {
    lines.push("Opportunity: the site already invites contact or inquiries, so faster chat replies can capture more of that intent.");
  }
  if (!website?.hasMessengerSignals) {
    lines.push("Opportunity: Messenger is not strongly surfaced on the site, so Closer can help create a cleaner inquiry path.");
  }
  return lines;
}

function buildResearchBlock({ url, result }) {
  const website = result.website || {};
  const lines = [
    RESEARCH_START,
    `URL: ${url}`,
    `Checked: ${new Date().toISOString()}`,
    website.title ? `Title: ${website.title}` : null,
    website.description ? `Description: ${website.description}` : null,
    website.serviceHints?.length ? `Products/services hinted: ${website.serviceHints.slice(0, 8).join("; ")}` : null,
    website.pagesChecked?.length ? `Pages checked: ${website.pagesChecked.slice(0, 4).join("; ")}` : null,
    "Sales interpretation for this conversation only:",
    ...likelyPainAndSolutionLines(website),
    "Use: Mention one relevant pain and one matching solution at a time. Do not claim exact pricing, inventory, promos, or policies unless the website preview explicitly showed them.",
    "Source: public website preview only.",
    RESEARCH_END
  ];
  return lines.filter(Boolean).join("\n");
}

function mergeResearchNotes(existingNotes, researchBlock) {
  const humanNotes = stripResearchContext(existingNotes);
  return [humanNotes, researchBlock].filter(Boolean).join("\n\n").slice(0, 6000);
}

async function maybeAddWebsiteResearchToLead({ prisma, company, lead, message }) {
  const url = firstWebsiteUrl(message);
  if (!shouldResearchWebsite({ company, message, url })) return { ok: false, skipped: true, reason: "no relevant website url" };
  if (hasResearchForUrl(lead?.notes, url)) return { ok: true, skipped: true, reason: "already researched", url };

  const result = await lookupWebsite(url);
  if (!result.ok || !result.website) {
    return { ok: false, skipped: false, reason: result.error || "website lookup failed", url };
  }

  const notes = mergeResearchNotes(lead?.notes || "", buildResearchBlock({ url, result }));
  await prisma.lead.update({ where: { id: lead.id }, data: { notes } });
  return { ok: true, skipped: false, url, title: result.website.title || "" };
}

module.exports = {
  RESEARCH_START,
  RESEARCH_END,
  firstWebsiteUrl,
  extractResearchContext,
  stripResearchContext,
  maybeAddWebsiteResearchToLead
};
