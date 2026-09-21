const fs = require("fs");
const path = require("path");
require("dotenv").config();

const UNGM_BASE_URL = "https://www.ungm.org";
const UNGM_SEARCH_URL = `${UNGM_BASE_URL}/Public/Notice/Search`;
const DEFAULT_PAGE_SIZE = 15;
const DEFAULT_MAX_PAGES = 2;
const DEFAULT_MAX_RESULTS = 30;
const DEFAULT_KEYWORDS = [
  "artificial intelligence",
  "generative ai",
  "chatbot",
  "virtual assistant",
  "voice",
  "customer service",
  "crm",
  "automation",
  "workflow automation",
  "software development",
  "web application",
  "website development",
  "system integration",
  "api integration",
  "saas",
  "cloud services",
  "information system",
  "it consulting",
  "technical support",
  "help desk",
  "knowledge management",
  "telephony",
  "voip",
  "booking system"
];

function parseArgs(argv) {
  const args = {
    maxPages: DEFAULT_MAX_PAGES,
    maxResults: DEFAULT_MAX_RESULTS,
    keywords: [],
    out: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--keyword") {
      args.keywords.push(argv[i + 1] || "");
      i += 1;
    } else if (arg === "--max-pages") {
      args.maxPages = Number(argv[i + 1] || DEFAULT_MAX_PAGES);
      i += 1;
    } else if (arg === "--max-results") {
      args.maxResults = Number(argv[i + 1] || DEFAULT_MAX_RESULTS);
      i += 1;
    } else if (arg === "--out") {
      args.out = argv[i + 1] || null;
      i += 1;
    }
  }

  if (!args.keywords.length) args.keywords = DEFAULT_KEYWORDS.slice();
  return args;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${UNGM_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function postSearch({ keyword, pageIndex }) {
  const body = {
    PageIndex: pageIndex,
    PageSize: DEFAULT_PAGE_SIZE,
    Title: keyword,
    Description: keyword,
    Reference: "",
    PublishedFrom: "",
    PublishedTo: "",
    DeadlineFrom: "",
    DeadlineTo: "",
    Countries: [],
    Agencies: [],
    UNSPSCs: [],
    NoticeTypes: [],
    SortField: "DatePublished",
    SortAscending: false,
    isPicker: false,
    IsSustainable: false,
    IsActive: true,
    NoticeDisplayType: "",
    NoticeSearchTotalLabelId: "searchRows",
    TypeOfCompetitions: []
  };

  const response = await fetch(UNGM_SEARCH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`UNGM search failed for "${keyword}" with ${response.status}`);
  }
  return response.text();
}

function parseSearchResults(html) {
  const rows = [...String(html || "").matchAll(/<div role="row"[\s\S]*?class="tableRow dataRow notice-table"[\s\S]*?<\/script>|<div role="row"[\s\S]*?class="tableRow dataRow notice-table"[\s\S]*?<\/div>\s*<\/div>/g)];
  const results = [];

  for (const match of rows) {
    const row = match[0];
    const noticeId = /data-noticeid="(\d+)"/.exec(row)?.[1] || null;
    const title = stripTags(/<span class="ungm-title[\s\S]*?">([\s\S]*?)<\/span>/.exec(row)?.[1]);
    const url = absoluteUrl(/<a target='_blank' href='([^']+)'/.exec(row)?.[1] || `/Public/Notice/${noticeId}`);
    const deadline = stripTags(/class="tableCell resultInfo1 deadline"[\s\S]*?<span>([\s\S]*?)<\/span>/.exec(row)?.[1]);
    const daysRemaining = Number(/remainingDaysToDeadline"[^>]*>([^<]+)/.exec(row)?.[1] || "");
    const published = stripTags(/class="tableCell">\s*<span>\s*([\s\S]*?)<\/span>\s*<\/div>\s*<div role="cell" class="tableCell resultAgency"/.exec(row)?.[1]);
    const organization = stripTags(/class="tableCell resultAgency"[\s\S]*?<span>([\s\S]*?)<\/span>/.exec(row)?.[1]);
    const type = stripTags(/<label for='[^']*'>([\s\S]*?)<\/label>/.exec(row)?.[1]);
    const reference = stripTags(/data-description="Reference"[\s\S]*?<span>([\s\S]*?)<\/span>/.exec(row)?.[1]);
    const country = stripTags(/data-description="Reference"[\s\S]*?<\/div>\s*<div role="cell" class="tableCell">\s*<span>([\s\S]*?)<\/span>/.exec(row)?.[1]);

    if (!noticeId || !title) continue;
    results.push({
      notice_id: noticeId,
      source: "UNGM",
      title,
      url,
      deadline: deadline || null,
      days_remaining: Number.isFinite(daysRemaining) ? Math.floor(daysRemaining) : null,
      published: published || null,
      organization: organization || null,
      procurement_type: type || null,
      reference_number: reference || null,
      country: country || null
    });
  }

  return results;
}

function extractLabeledValue(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<span class="label">${escaped}:<\\/span>\\s*<span class="value">([\\s\\S]*?)<\\/span>`, "i").exec(html);
  return stripTags(match?.[1] || "");
}

function extractDescription(html) {
  const match = /<div class="title">Description<\/div>\s*<div>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i.exec(html);
  return stripTags(match?.[1] || "");
}

function extractDocumentLinks(html) {
  const links = [...String(html || "").matchAll(/onclick="javascript:window\.open\('([^']+)'\)"/g)].map((match) => match[1]);
  return [...new Set(links)].map(absoluteUrl);
}

async function fetchNoticeDetail(noticeId) {
  const response = await fetch(`${UNGM_BASE_URL}/Public/Notice/${noticeId}`);
  if (!response.ok) {
    throw new Error(`UNGM notice detail ${noticeId} failed with ${response.status}`);
  }
  const html = await response.text();
  return {
    registration_level: extractLabeledValue(html, "Registration level") || null,
    beneficiary_country: extractLabeledValue(html, "Beneficiary countries or territories") || null,
    published_on: extractLabeledValue(html, "Published on") || null,
    deadline_on: extractLabeledValue(html, "Deadline on") || null,
    organization: extractLabeledValue(html, "Organization") || null,
    description: extractDescription(html) || null,
    document_links: extractDocumentLinks(html)
  };
}

function scoreNotice(notice) {
  const haystack = `${notice.title || ""} ${notice.description || ""}`.toLowerCase();
  const blockers = [];

  let technicalFit = 0;
  if (/(artificial intelligence|generative ai|chatbot|virtual assistant|conversational ai|ai assistant)/.test(haystack)) technicalFit += 18;
  if (/(voice|ivr|telephony|voip|customer service|contact center|help desk)/.test(haystack)) technicalFit += 8;
  if (/(software|web application|website|system integration|api|saas|automation|workflow|crm|information system|database|technical support)/.test(haystack)) technicalFit += 12;
  technicalFit = Math.min(30, technicalFit);

  let eligibilityProbability = 25;
  if (/\b([3-9]|10)\s+years?\b/.test(haystack)) {
    eligibilityProbability -= 10;
    blockers.push("Public notice appears to require multiple years of experience.");
  }
  if (/(similar contracts|completed contracts|prior experience|track record)/.test(haystack)) {
    eligibilityProbability -= 6;
    blockers.push("Public notice suggests similar completed contract requirements.");
  }
  if (/(iso|certification|licensed professional|cissp|pmp|itil)/.test(haystack)) {
    eligibilityProbability -= 6;
    blockers.push("Public notice suggests certifications or licensed specialists may be required.");
  }
  if (/(audited financial|turnover|annual turnover|bid security)/.test(haystack)) {
    eligibilityProbability -= 4;
    blockers.push("Public notice suggests financial or bid-security compliance requirements.");
  }
  if (/(hardware|server|data center|network equipment|telecom infrastructure|cybersecurity audit)/.test(haystack)) {
    eligibilityProbability -= 8;
    blockers.push("Public notice includes hardware-heavy or specialized infrastructure requirements.");
  }
  eligibilityProbability = Math.max(0, eligibilityProbability);

  let commercialValue = 8;
  if (notice.description && /(enterprise|regional|global|multi-country|platform)/i.test(notice.description)) commercialValue += 4;
  if (notice.registration_level && /basic/i.test(notice.registration_level)) commercialValue += 1;
  commercialValue = Math.min(15, commercialValue);

  let competitionAccessibility = 5;
  if (/(request for quotation|request for proposal|request for eoi)/i.test(notice.procurement_type || "")) competitionAccessibility += 2;
  if (notice.registration_level && /basic/i.test(notice.registration_level)) competitionAccessibility += 2;
  if (/limited/i.test(notice.procurement_type || "")) competitionAccessibility -= 3;
  competitionAccessibility = Math.max(0, Math.min(10, competitionAccessibility));

  let deadlineFeasibility = 6;
  if (notice.days_remaining == null) deadlineFeasibility = 5;
  else if (notice.days_remaining >= 10) deadlineFeasibility = 10;
  else if (notice.days_remaining >= 5) deadlineFeasibility = 8;
  else if (notice.days_remaining >= 2) deadlineFeasibility = 5;
  else deadlineFeasibility = 2;

  let strategicValue = 4;
  if (/(ai|automation|customer service|crm|support|software|platform|integration)/.test(haystack)) strategicValue += 4;
  if (/philippines/i.test(notice.country || "")) strategicValue += 2;
  strategicValue = Math.min(10, strategicValue);

  const total = technicalFit + eligibilityProbability + commercialValue + competitionAccessibility + deadlineFeasibility + strategicValue;
  let recommendation = "SKIP";
  if (total >= 80) recommendation = "BID";
  else if (total >= 65) recommendation = "HIGH PRIORITY REVIEW";
  else if (total >= 50) recommendation = "REVIEW";

  const qualificationPaths = [];
  if (eligibilityProbability >= 16) qualificationPaths.push("AIStaff directly");
  if (blockers.some((item) => /experience|completed contract/i.test(item))) qualificationPaths.push("Partner with an experienced prime contractor or consortium lead");
  if (blockers.some((item) => /certification|licensed/i.test(item))) qualificationPaths.push("Subcontract certified specialists only if the solicitation rules allow it");
  if (qualificationPaths.length === 0) qualificationPaths.push("Needs manual eligibility review before pursuing");

  return {
    score: total,
    recommendation,
    blockers,
    qualificationPaths
  };
}

function mergeNotice(list, notice, keyword) {
  const existing = list.get(notice.notice_id);
  if (!existing) {
    list.set(notice.notice_id, { ...notice, matched_keywords: [keyword] });
    return;
  }
  if (!existing.matched_keywords.includes(keyword)) existing.matched_keywords.push(keyword);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const notices = new Map();

  for (const keyword of args.keywords) {
    for (let pageIndex = 0; pageIndex < args.maxPages; pageIndex += 1) {
      const html = await postSearch({ keyword, pageIndex });
      const parsed = parseSearchResults(html);
      for (const notice of parsed) mergeNotice(notices, notice, keyword);
      if (parsed.length < DEFAULT_PAGE_SIZE || notices.size >= args.maxResults) break;
    }
    if (notices.size >= args.maxResults) break;
  }

  const selected = [...notices.values()].slice(0, args.maxResults);
  for (const notice of selected) {
    try {
      const detail = await fetchNoticeDetail(notice.notice_id);
      Object.assign(notice, detail);
    } catch (error) {
      notice.detail_error = error.message;
    }
    const scoring = scoreNotice(notice);
    notice.score = scoring.score;
    notice.recommendation = scoring.recommendation;
    notice.blockers = scoring.blockers;
    notice.how_we_could_qualify = scoring.qualificationPaths;
  }

  selected.sort((a, b) => b.score - a.score);

  const payload = {
    generated_at: new Date().toISOString(),
    source: "UNGM",
    source_url: `${UNGM_BASE_URL}/Public/Notice`,
    keywords_used: args.keywords,
    opportunities_scanned: selected.length,
    opportunities: selected
  };

  if (args.out) {
    const outPath = path.resolve(process.cwd(), args.out);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  }

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
