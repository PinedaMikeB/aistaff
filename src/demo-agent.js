/**
 * Public demo: scrape a prospect's own business, then let them talk to an
 * agent that knows it.
 *
 * The point of the demo is NOT to describe Closer. It is to let a prospect
 * watch an agent sell THEIR products, in THEIR customer's language. So every
 * fact comes from their own site or Page, and the model writes every word.
 */

const { prisma } = require("./db");
const { buildPresenceSnapshot } = require("./page-intelligence");
const { normalizePhone } = require("./phone");
const { renderAndExtract, detectCurrency } = require("./rendered-scrape");
const { extractPriceList } = require("./price-list-extract");
const { toGemini, parseToolCalls, execute } = require("./tools/adapters");
const { SCOPES } = require("./tools/registry");
require("./tools/sms");

const SESSION_TTL_HOURS = 48;
const MAX_MESSAGES_PER_SESSION = 40;

function demoModel() {
  return process.env.DEMO_GEMINI_MODEL || "gemini-3.5-flash-lite";
}

/** Create the session first, scrape after, so a slow site never blocks the UI. */
async function createDemoSession({ name, email, websiteUrl, facebookUrl, mobile, ip }) {
  return prisma.demoSession.create({
    data: {
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      website_url: websiteUrl || null,
      facebook_url: facebookUrl || null,
      mobile_number: normalizePhone(mobile),
      requested_ip: ip || null,
      scrape_status: "pending",
      expires_at: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000)
    }
  });
}

/**
 * Run the scrape and persist the structured result.
 *
 * Before demo_sessions existed this output was formatted into a message body
 * and discarded, so nobody could review what the agent had learned. Storing it
 * is what makes the scrape auditable AND reusable when the prospect buys.
 */
async function runScrape(sessionId) {
  const session = await prisma.demoSession.findUnique({ where: { id: sessionId } });
  if (!session) return null;

  try {
    const snapshot = await buildPresenceSnapshot({
      websiteInput: session.website_url || "",
      facebookInput: session.facebook_url || "",
      requestedPageName: session.business_name || session.name || "",
      websiteStatus: session.website_url ? "has_website" : "unknown"
    });

    const facts = extractFacts(snapshot);

    // The fetch above reads Open Graph tags only, so it misses any price that
    // JavaScript renders (Lazada) or that lives inside a graphic. Escalate to
    // a real browser, then to vision if the text still shows no prices.
    // Websites only — Facebook serves a block page to logged-out clients.
    let rendered = null;
    if (session.website_url) {
      rendered = await renderAndExtract(session.website_url, {
        onVision: async (buffer) => {
          const seen = await extractPriceList({
            buffer, mimeType: "image/png", filename: "page.png"
          });
          return seen.ok ? seen.text : "";
        }
      });
    }

    const renderedText = rendered && rendered.ok ? rendered.text : "";
    // An uploaded price list always wins: that is the owner telling us
    // directly, rather than us inferring from their page.
    const priceText = session.price_list_text || renderedText || null;

    return prisma.demoSession.update({
      where: { id: sessionId },
      data: {
        snapshot,
        business_name: facts.businessName || session.business_name,
        price_list_text: priceText,
        price_list_kind: session.price_list_text
          ? session.price_list_kind
          : (renderedText ? (rendered.usedVision ? "rendered_vision" : "rendered_text") : null),
        price_currency: detectCurrency(priceText || "", session.website_url),
        // 4, not 1. A Facebook preview yields name + one-line description and
        // nothing else — enough to pass a >0 check while leaving the agent
        // with no real knowledge, which is how it invented a Sunday walk-in
        // policy for a clinic it knew nothing about.
        scrape_status: (facts.factCount >= 4 || renderedText) ? "ready" : "thin",
        scrape_error: null
      }
    });
  } catch (error) {
    return prisma.demoSession.update({
      where: { id: sessionId },
      data: { scrape_status: "failed", scrape_error: String(error.message).slice(0, 400) }
    });
  }
}

/** Pull the useful bits out of a snapshot and count how much we actually got. */
function extractFacts(snapshot) {
  const website = (snapshot && snapshot.website) || {};
  const facebook = (snapshot && snapshot.facebook) || {};

  // serviceHints is the richest thing the crawler produces — the actual copy
  // describing what they sell. Ignoring it was leaving the knowledge base
  // thin: marga.biz scored 2 facts on title+description alone, while its
  // hints named copier rental, leasing, and specific models.
  const hints = Array.isArray(website.serviceHints) ? website.serviceHints : [];
  const cleanHints = hints
    .map((h) => String(h).replace(/\s+/g, " ").trim())
    .filter((h) => h.length > 15)
    .slice(0, 8);

  const values = [
    website.title, website.description, facebook.name,
    facebook.description, facebook.category
  ].filter((v) => typeof v === "string" && v.trim().length > 2);

  return {
    businessName: facebook.name || website.title || "",
    factCount: values.length + cleanHints.length,
    serviceHints: cleanHints,
    hasContactSignals: Boolean(website.hasContactSignals),
    assessment: (snapshot && snapshot.assessment) || null,
    website,
    facebook
  };
}

module.exports = {
  SESSION_TTL_HOURS,
  MAX_MESSAGES_PER_SESSION,
  demoModel,
  createDemoSession,
  runScrape,
  extractFacts
};


/**
 * Send SMS via Pitch's loopback bridge.
 *
 * The SIP UA lives in the Pitch process, not this one. Returns a rejected
 * promise on failure so the tool's handler turns it into facts the model can
 * talk about, rather than a crash.
 */
async function sendSmsViaPitch(to, message) {
  const token = process.env.PITCH_INTERNAL_TOKEN;
  if (!token) throw new Error("sms_bridge_not_configured");
  const port = process.env.PITCH_INTERNAL_PORT || 5199;
  const fetchImpl = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

  const res = await fetchImpl(`http://127.0.0.1:${port}/internal/sms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pitch-token": token },
    body: JSON.stringify({ to, message })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || `bridge_${res.status}`);
  return json;
}

/**
 * The system prompt. FACTS ONLY.
 *
 * Two rules from docs/handoff-masterplan.md, and the demo is where they matter
 * most — this is the agent a prospect judges the whole product by:
 *
 *   1. NO language instruction. Not "reply in Tagalog", not "detect language".
 *      The model reads how the person writes and matches it, switching
 *      mid-sentence if they do. A Filipino owner typing "magkano po ang
 *      delivery sa Cavite?" gets an answer in that same register.
 *   2. NO scripted lines. Everything below is information about the
 *      prospect's business. The model writes every word itself. A canned
 *      demo would be a lie about the product they are buying.
 */
function buildDemoPrompt(session) {
  const facts = extractFacts(session.snapshot);
  const lines = [];

  lines.push(
    "You are an AI sales assistant answering messages for the business described below. " +
    "You are not selling AIStaff. You ARE that business's assistant, talking to one of its customers."
  );

  lines.push("");
  lines.push("WHAT YOU KNOW ABOUT THIS BUSINESS:");
  if (facts.businessName) lines.push(`- Name: ${facts.businessName}`);
  if (facts.website.title) lines.push(`- Website title: ${facts.website.title}`);
  if (facts.website.description) lines.push(`- Website says: ${facts.website.description}`);
  if (facts.facebook.category) lines.push(`- Facebook category: ${facts.facebook.category}`);
  if (facts.facebook.description) lines.push(`- Facebook page says: ${facts.facebook.description}`);
  if (facts.serviceHints.length) {
    lines.push("- What their own pages say they offer:");
    for (const hint of facts.serviceHints) lines.push(`    * ${hint}`);
  }
  if (facts.hasContactSignals) lines.push("- Their site shows contact details publicly.");
  if (session.website_url) lines.push(`- Website: ${session.website_url}`);
  if (session.facebook_url) lines.push(`- Facebook page: ${session.facebook_url}`);

  if (session.price_list_text) {
    lines.push("");
    lines.push("THEIR PRICES (read from their own pages or uploaded by them — authoritative):");
    if (session.price_currency) {
      // Say the currency explicitly. "100" read off a US store and quoted to
      // a Filipino customer as ₱100 is a number they will hold the business
      // to, and a far worse failure than quoting nothing.
      lines.push(`All amounts below are in ${session.price_currency}. Always state the currency when you quote one, and never convert to another currency.`);
    }
    lines.push(session.price_list_text);
  }

  if (facts.factCount === 0 && !session.price_list_text) {
    lines.push("- Very little could be read from their public pages.");
    lines.push("");
    lines.push(
      "Because you know almost nothing concrete yet, do not guess at products, prices " +
      "or services. Ask what they sell and who buys it, then use their answers. " +
      "Inventing details would be worse than admitting the gap."
    );
  }

  lines.push("");
  lines.push("HOW TO BEHAVE:");
  lines.push("- Answer as that business would: helpful, specific, trying to win the sale.");
  lines.push(
    session.price_list_text
      ? "- Quote prices ONLY from the price list above, exactly as written. For anything not on it, say you will confirm."
      : "- You have no price list, so never state a price. Offer to check and come back with it."
  );
  lines.push(
    "- The same applies to EVERY other specific claim: opening hours, walk-in " +
    "or booking policy, branch address, delivery areas, stock, lead times, " +
    "warranties. If it is not written above, you do not know it. Say so and " +
    "offer to confirm — never guess, even when guessing sounds helpful."
  );
  lines.push("- Ask one qualifying question at a time when it moves the sale forward.");
  lines.push("- Keep replies short, the length a real person types on a phone.");
  lines.push("- If they ask something you have no fact for, say so plainly and offer to check.");

  if (session.mobile_number) {
    lines.push("");
    lines.push(
      "You can send them ONE text message with send_sms if they ask for confirmation, " +
      "a booking, or details to keep. Write it yourself. It goes to the number they " +
      "already gave; you cannot choose a different one."
    );
  }

  return lines.join("\n");
}

/** One turn. Handles a tool call, then asks the model for the reply. */
async function replyToDemoMessage({ session, messages }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "demo_not_configured" };

  const model = demoModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const fetchImpl = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content).slice(0, 2000) }]
  }));

  const body = {
    systemInstruction: { parts: [{ text: buildDemoPrompt(session) }] },
    contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 500 }
  };

  const tools = session.mobile_number ? toGemini(SCOPES.DEMO) : [];
  if (tools.length) body.tools = tools;

  let response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, error: "model_unavailable", detail: detail.slice(0, 300) };
  }

  let json = await response.json();
  const calls = parseToolCalls(json, "gemini");
  const actions = [];

  if (calls.length) {
    for (const call of calls) {
      const result = await execute({
        name: call.name,
        args: call.args,
        ctx: {
          scope: SCOPES.DEMO,
          smsSent: session.sms_sent,
          mobileNumber: session.mobile_number,
          sendSms: sendSmsViaPitch
        }
      });
      actions.push({ tool: call.name, result });
      if (call.name === "send_sms" && result && result.sent) {
        // Persist immediately: the cap must survive across HTTP requests,
        // not just within this one.
        await prisma.demoSession.update({
          where: { id: session.id },
          data: { sms_sent: { increment: 1 } }
        });
        session.sms_sent += 1;
      }

      // Gemini 3 returns a `thoughtSignature` next to the functionCall and
      // REQUIRES it back on the next turn — rebuilding the call from
      // {name,args} alone gets a 400 "Function call is missing a
      // thought_signature", which is why a tool turn produced no reply.
      // Echo the original part back untouched.
      contents.push({ role: "model", parts: [call.rawPart || { functionCall: { name: call.name, args: call.args } }] });
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name: call.name, response: result } }]
      });
    }

    // Second pass so the model can put the outcome in its own words.
    body.contents = contents;
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (response.ok) json = await response.json();
  }

  let parts = (json.candidates && json.candidates[0] && json.candidates[0].content.parts) || [];
  let reply = parts.map((p) => p.text).filter(Boolean).join("").trim();

  // After running a tool, Gemini sometimes returns a turn with no text — it
  // considers the tool call to BE the answer. The customer is then left
  // staring at nothing. Ask once more with tools removed so the only thing it
  // can produce is words. Still the model writing them, never a canned line.
  if (!reply && calls.length) {
    const followUp = Object.assign({}, body, { contents, tools: undefined });
    delete followUp.tools;
    const retry = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(followUp)
    });
    if (retry.ok) {
      const retryJson = await retry.json();
      parts = (retryJson.candidates && retryJson.candidates[0] && retryJson.candidates[0].content.parts) || [];
      reply = parts.map((p) => p.text).filter(Boolean).join("").trim();
    }
  }

  if (!reply) return { ok: false, error: "empty_reply", actions };
  return { ok: true, reply, actions, model };
}

module.exports.sendSmsViaPitch = sendSmsViaPitch;
module.exports.buildDemoPrompt = buildDemoPrompt;
module.exports.replyToDemoMessage = replyToDemoMessage;
