/**
 * Knowledge base: what a row means, how it expires, and how it reaches the agent.
 *
 * RULE 2 (docs/handoff-masterplan.md, HANDOFF-CLOSER.md §0.2): everything here
 * returns FACTS. The wizard's own UI copy — labels, the "why this helps" line —
 * is product copy we author deliberately and is NOT a rule 2 violation. What is
 * forbidden is storing a sentence for the AGENT to recite to a customer. No
 * function in this file writes a customer-facing reply.
 *
 * RULE 1: no language setting anywhere. There is no locale field, no "reply in
 * Tagalog" option, and there must never be one. The model matches how the
 * customer writes.
 */

/** Row kinds. Unknown kinds render as prose rather than being dropped. */
const KINDS = {
  QA: "qa",
  PROSE: "prose",
  PRICELIST: "pricelist",
  PROMO: "promo",
  POLICY: "policy",
  PAIN_SOLUTION: "pain_solution",
  PAYMENT: "payment",
  DOCUMENT: "document",
  SHIPPING: "shipping",
  MEDIA: "media",
  INSTRUCTION: "instruction"
};

/**
 * Expiry behaviour differs by kind, and this is the important part.
 *
 * A promo that has ended must STOP being mentioned — quoting an expired promo
 * is an argument with a customer holding a screenshot. But a price list must
 * NEVER auto-deactivate: someone picks "30 days" on their main price list
 * because it was in the dropdown, and a month later Closer silently knows no
 * prices with no visible cause.
 */
const AUTO_DEACTIVATE_ON_EXPIRY = new Set([KINDS.PROMO]);

/** Manila, matching the SMS quiet-hours logic — a promo shouldn't die at 8am. */
function manilaNow(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

function isExpired(row, now = new Date()) {
  if (!row.valid_until) return false;
  return manilaNow(now) > manilaNow(new Date(row.valid_until));
}

/** Expired promos are suppressed; everything else expired is flagged for review. */
function partitionByFreshness(rows, now = new Date()) {
  const usable = [];
  const needsReview = [];
  for (const row of rows) {
    if (!isExpired(row, now)) {
      usable.push(row);
      continue;
    }
    if (AUTO_DEACTIVATE_ON_EXPIRY.has(row.kind)) needsReview.push(row);
    else {
      usable.push(row);
      needsReview.push(row);
    }
  }
  return { usable, needsReview };
}

/** Rows the agent may answer from: active, human-confirmed, not suppressed. */
function agentReadableRows(rows, now = new Date()) {
  const live = rows.filter((row) => row.active !== false && row.confirmed !== false);
  return partitionByFreshness(live, now).usable;
}

function moneyNote(row) {
  return row.currency ? ` All amounts are in ${row.currency}.` : "";
}

/** Structured rows -> compact lines. Lookup beats prose for tables. */
function renderDataRows(data) {
  if (!Array.isArray(data) || !data.length) return "";
  return data
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const label = String(entry.label || "").trim();
      const value = String(entry.value || "").trim();
      const note = String(entry.note || "").trim();
      if (!label && !value) return null;
      return `  - ${[label, value].filter(Boolean).join(": ")}${note ? ` (${note})` : ""}`;
    })
    .filter(Boolean)
    .join("\n");
}

function mediaSummary(row) {
  if (!Array.isArray(row.media) || !row.media.length) return "";
  // The ID is what the model returns in send_media, so it has to be visible
  // here. Without a real URL attached, an entry that DESCRIBES a poster made
  // the model invent "[IMAGE: ...]" — it knew one existed and had nothing to
  // send. Now the presence of a sendable file is explicit.
  const items = row.media
    .map((m, i) => (m && m.url
      ? `${row.id}:${i} (${m.type || "file"}${m.caption ? ` — ${m.caption}` : ""})`
      : null))
    .filter(Boolean);
  if (!items.length) return "";
  return `\n  SENDABLE FILES — use send_media with one of these ids: ${items.join("; ")}`;
}

/**
 * One row -> prompt text, by kind. Facts and labels only; no sentence the model
 * is expected to repeat verbatim.
 */
function renderRow(row) {
  const heading = row.title || row.category || "";
  const body = String(row.answer || "").trim();
  const rows = renderDataRows(row.data);
  const media = mediaSummary(row);

  switch (row.kind) {
    case KINDS.QA:
      return `Q: ${row.question || heading}\nA: ${body}${media}`;

    case KINDS.PRICELIST:
      return `PRICES — ${heading} (authoritative; quote exactly, never round or convert).${moneyNote(row)}\n${body}${rows ? `\n${rows}` : ""}${media}`;

    case KINDS.PROMO: {
      const until = row.valid_until
        ? ` Valid until ${new Date(row.valid_until).toISOString().slice(0, 10)}.`
        : " No end date given.";
      return `PROMO — ${heading}.${until}${moneyNote(row)}\n${body}${rows ? `\n${rows}` : ""}${media}`;
    }

    case KINDS.SHIPPING:
      return `SHIPPING AND DELIVERY — ${heading}. Read the matching area line; do not estimate an area that is not listed.${moneyNote(row)}\n${body}${rows ? `\n${rows}` : ""}`;

    case KINDS.POLICY:
      return `POLICY — ${heading}.\n${body}`;

    case KINDS.PAIN_SOLUTION:
      return `CUSTOMER PAINS AND SOLUTIONS — ${heading}. Use this to connect what the business sells to the problem the customer wants solved. Sell the pain and outcome, not just the feature.\n${body}${rows ? `\n${rows}` : ""}`;

    case KINDS.PAYMENT:
      return `PAYMENT AND CHECKOUT — ${heading}. This tells you how this business wants ready buyers to pay or reserve. Follow it before offering payment, booking or handoff.\n${body}${rows ? `\n${rows}` : ""}`;

    case KINDS.DOCUMENT:
      return `DOCUMENT OR TEMPLATE — ${heading}. Use this as company context, contract terms, quotation wording, or a template reference only when relevant. Do not invent missing legal or financial terms.\n${body}${rows ? `\n${rows}` : ""}${media}`;

    case KINDS.MEDIA:
      return `MEDIA — ${heading}.\n${body}${media}`;

    case KINDS.INSTRUCTION:
      return `HOUSE RULE — ${heading}. This constrains what you may say.\n${body}`;

    case KINDS.PROSE:
    default:
      return `${heading ? `${heading}.\n` : ""}${body}${rows ? `\n${rows}` : ""}${media}`;
  }
}

/**
 * Fit the knowledge base into the reply prompt.
 *
 * Entries are stored without limit — a full restaurant menu is a legitimate
 * single entry. But every entry is assembled into EVERY reply, so a workspace
 * can outgrow the prompt. Dropping the newest, or the longest, or whatever
 * happens to be last would silently lose the thing a customer is asking about.
 *
 * Priority order, most important first:
 *   1. instruction — house rules and boundaries. NEVER dropped. These are the
 *      "never quote below X" rules; losing them is a safety failure, not a
 *      quality one.
 *   2. pricelist / promo — the questions customers actually ask.
 *   3. shipping / policy — the questions that stall a ready buyer.
 *   4. everything else, in display order.
 *
 * Within a tier, display_order wins, so the wizard's sequence is preserved.
 * When anything is dropped it is LOGGED with the company id, because a silent
 * truncation is the §17.7 class of bug that hides for days.
 */
const PROMPT_BUDGET_CHARS = Number(process.env.KB_PROMPT_BUDGET_CHARS || 60000);

const KIND_PRIORITY = {
  [KINDS.INSTRUCTION]: 0,
  [KINDS.PAIN_SOLUTION]: 1,
  [KINDS.PRICELIST]: 1,
  [KINDS.PROMO]: 1,
  [KINDS.PAYMENT]: 2,
  [KINDS.DOCUMENT]: 2,
  [KINDS.SHIPPING]: 2,
  [KINDS.POLICY]: 2
};

function selectWithinBudget(rows, budget = PROMPT_BUDGET_CHARS, companyId = null) {
  const ranked = [...rows].sort((a, b) => {
    const pa = KIND_PRIORITY[a.kind] ?? 3;
    const pb = KIND_PRIORITY[b.kind] ?? 3;
    if (pa !== pb) return pa - pb;
    return (a.display_order || 0) - (b.display_order || 0);
  });

  const kept = [];
  const dropped = [];
  let used = 0;

  for (const row of ranked) {
    const size = renderRow(row).length;
    // House rules are never dropped, whatever the budget says.
    if (row.kind === KINDS.INSTRUCTION || used + size <= budget) {
      kept.push(row);
      used += size;
    } else {
      dropped.push(row);
    }
  }

  if (dropped.length) {
    console.warn(
      "[knowledge-base] prompt budget %d exceeded for company=%s — kept %d entries (%d chars), dropped %d: %s",
      budget, companyId || "unknown", kept.length, used, dropped.length,
      dropped.map((r) => r.title || r.question || r.category).join(" | ")
    );
  }

  // Restore the wizard's own order for the prompt itself.
  return kept.sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
}

/**
 * Make links survive Messenger.
 *
 * Facebook auto-links a URL only when it carries a scheme. "aistaff.click/
 * pricing" arrives as plain grey text a customer has to retype;
 * "https://aistaff.click/pricing" becomes tappable.
 *
 * Messenger also does NOT render markdown, so "[pricing](https://…)" shows the
 * brackets literally. Both are normalised here, at save time, so every channel
 * gets a clean URL and nobody has to remember the rule while typing.
 *
 * Emails are left alone — Messenger links those itself, and prefixing one with
 * https:// would break it.
 */
function normaliseLinks(text) {
  if (!text) return text;
  let out = String(text);

  // [label](url) -> "label: url". Keeps the label, drops syntax Messenger
  // cannot render.
  //
  // When the LABEL is itself a URL or domain — "[aistaff.click/pricing](https://
  // aistaff.click/pricing/?plan=starter)" — keep only the target. Otherwise the
  // bare-domain rule below upgrades the label too and the customer sees the
  // same link twice in a row.
  out = out.replace(/\[([^\]]{1,120})\]\((https?:\/\/[^\s)]+)\)/gi, (m, label, url) => {
    const clean = label.trim();
    const labelIsLink = /^(https?:\/\/|www\.)/i.test(clean)
      || /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(com|net|org|ph|click|io|co|app|ai|shop|biz|info)(\/\S*)?$/i.test(clean);
    if (labelIsLink) return url;
    return `${clean}: ${url}`;
  });

  // Bare domain -> https://. Requires a known-ish TLD shape, must not follow
  // "@" (emails) or an existing scheme, and keeps any trailing path.
  out = out.replace(
    /(^|[\s(])((?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|ph|click|io|co|app|ai|shop|biz|info)(?:\/[^\s)]*)?)/gi,
    (match, prefix, domain, offset, whole) => {
      const before = whole.slice(0, offset + prefix.length);
      if (/[@/]$/.test(before) || /https?:\/\/\S*$/i.test(before)) return match;
      return `${prefix}https://${domain}`;
    }
  );

  return out;
}

/**
 * The whole knowledge base as prompt text, grouped so house rules land last and
 * therefore closest to the model's output.
 */
function renderKnowledgeForPrompt(rows, now = new Date(), companyId = null) {
  const readable = agentReadableRows(rows, now);
  if (!readable.length) return "";

  const within = selectWithinBudget(readable, PROMPT_BUDGET_CHARS, companyId);

  const ordered = [...within].sort((a, b) => {
    const aRule = a.kind === KINDS.INSTRUCTION ? 1 : 0;
    const bRule = b.kind === KINDS.INSTRUCTION ? 1 : 0;
    if (aRule !== bRule) return aRule - bRule;
    return (a.display_order || 0) - (b.display_order || 0);
  });

  return ordered.map(renderRow).join("\n\n");
}

module.exports = {
  KINDS,
  normaliseLinks,
  AUTO_DEACTIVATE_ON_EXPIRY,
  PROMPT_BUDGET_CHARS,
  isExpired,
  partitionByFreshness,
  agentReadableRows,
  selectWithinBudget,
  renderRow,
  renderKnowledgeForPrompt
};
