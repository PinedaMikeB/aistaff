/**
 * Reply style per channel (Settings > Channels). Added 2026-10-20.
 *   formal  — business email: greeting, short paragraphs, numbered lists, closing line.
 *   casual  — chat: 1-3 short, warm sentences (Messenger / website chat).
 * Defaults: email = formal, every other channel = casual. Stored in
 * tenant_channels.config.reply_style. Used by the Director communicator,
 * the main Closer prompt (ai.js) and the email sender (rich HTML for formal).
 */
const { prisma } = require("./db");

const STYLES = ["formal", "casual"];
const CHANNEL_KEY = { email: "email", facebook_messenger: "facebook_messenger", messenger: "facebook_messenger", website_chat: "website_chat", web_chat: "website_chat", mobile_phone: "mobile_phone", sms: "mobile_phone", phone: "mobile_phone", website_call: "website_call" };
const LABEL = { email: "email", facebook_messenger: "Facebook Messenger", website_chat: "website chat", mobile_phone: "SMS" };

function channelKey(channel) { return CHANNEL_KEY[String(channel || "facebook_messenger")] || "facebook_messenger"; }
function defaultStyle(channel) { return channelKey(channel) === "email" ? "formal" : "casual"; }

/** Style + the business's own instructions for this channel (Settings > Channels). */
async function channelSettings(companyId, channel) {
  const key = channelKey(channel);
  if (!companyId) return { style: defaultStyle(key), instructions: "" };
  const row = await prisma.tenantChannel.findUnique({ where: { company_id_channel_key: { company_id: companyId, channel_key: key } }, select: { config: true } }).catch(() => null);
  const saved = row?.config?.reply_style;
  return { style: STYLES.includes(saved) ? saved : defaultStyle(key), instructions: String(row?.config?.instructions || "").trim().slice(0, 2000) };
}

async function styleFor(companyId, channel) { return (await channelSettings(companyId, channel)).style; }

/** Prompt line for the channel instructions (most specific: after company and engine instructions). */
function instructionLine(instructions, channel) {
  const text = String(instructions || "").trim();
  return text ? `CHANNEL INSTRUCTIONS from the business (${String(channel) === "phone" ? "phone calls" : String(channel) === "website_call" ? "website calls" : (LABEL[channelKey(channel)] || "this channel")} only; they add to the company and engine instructions): ${text}` : "";
}

/** Writing rules for the model. */
function rules(style, channel) {
  if (["phone", "website_call"].includes(String(channel))) {
    return [
      "REPLY STYLE: SPOKEN (live voice call). Your words are read aloud to the caller:",
      "- One or two short sentences, under 35 words. Ask only ONE question at a time.",
      "- Speak only English, Tagalog or Taglish (follow the caller). Never Indonesian or Malay.",
      "- Do not greet again or say your name again after the first turn; go straight to the point.",
      "- No lists, numbering, bullet points, links, emoji, markdown or symbols.",
      "- Never say a serial number unless the task tells you to; then read it one character at a time (E, 6, 9, 8...), never as a big number. Say reference numbers in small groups.",
      "- The caller cannot see or remember a list. Never read a list of choices or numbered options; ask an open question (\"what model is it?\", \"how is the machine working?\") and let them answer in their own words.",
      "- Only mention options or examples the task gives you. Never invent options, colours, models or examples.",
      "- Never ask again for something the caller already told you.",
      "- Do not call the caller Ma'am or Sir unless they told you how to address them or the business's instructions say so; use their name if you know it.",
      "- Keep the item type exactly as the caller said it (ink is not toner).",
      "- Use the language of the caller's latest words (English, Tagalog or Taglish), warm and polite. If they ask for a language, switch at once and keep it."
    ].join("\n");
  }
  const key = channelKey(channel);
  const where = LABEL[key] || "chat";
  if (style === "formal") {
    return [
      `REPLY STYLE: FORMAL (${where}). Write like a professional customer-care ${key === "email" ? "email" : "message"}, not a chat:`,
      "- First line: a polite greeting on its own line, e.g. \"Dear Ms. Ana,\" (use their name and title if known) or \"Good day,\".",
      "- Then 1-3 short paragraphs separated by a blank line. Complete sentences, courteous and clear. No emojis, no slang, no \"po/opo\".",
      "- When you ask for several items or offer choices, put them as a numbered list, one per line (\"1. ...\"). Put the choices of one item on separate lines too.",
      "- End with a short closing line that fits: when you ask them something, e.g. \"Thank you, and we look forward to your reply.\"; when you ask nothing, e.g. \"Thank you for your patience.\" or \"Thank you for choosing us.\" Never ask for a reply when nothing is needed from them. Do NOT add a sign-off name or signature: the system adds it.",
      "- Write in English. If the customer wrote fully in Filipino, you may reply in polite formal Filipino."
    ].join("\n");
  }
  return `REPLY STYLE: CASUAL (${where}). 1-3 short, warm sentences like a chat message; offer choices as a short numbered list.`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function inline(text) { return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>"); }

/** Plain reply text -> rich email HTML (paragraphs, numbered / bullet lists with one indented level, **bold**). */
function emailHtml(text) {
  const blocks = String(text || "").replace(/\r/g, "").replace(/\t/g, "    ").split(/\n\s*\n/).filter((b) => b.trim());
  const out = [];
  const listHtml = (list) => `<${list.tag} style="margin:0 0 14px;padding-left:22px">${list.items.map((i) => `<li style="margin:4px 0">${inline(i.text)}${i.sub ? `<${i.sub.tag} style="margin:4px 0 0;padding-left:20px">${i.sub.items.map((x) => `<li style="margin:2px 0">${inline(x)}</li>`).join("")}</${i.sub.tag}>` : ""}</li>`).join("")}</${list.tag}>`;
  for (const block of blocks) {
    let para = [];
    let list = null;
    const flushPara = () => { if (para.length) { out.push(`<p style="margin:0 0 14px">${para.map(inline).join("<br>")}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(listHtml(list)); list = null; } };
    for (const raw of block.split("\n")) {
      if (!raw.trim()) continue;
      const indent = raw.match(/^\s*/)[0].length;
      const line = raw.trim();
      const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
      const bullet = line.match(/^[-•*]\s+(.*)$/);
      const item = numbered ? numbered[2] : bullet ? bullet[1] : null;
      const tag = numbered ? "ol" : "ul";
      if (item !== null && indent >= 2 && list && list.items.length) {
        const last = list.items[list.items.length - 1];
        if (!last.sub) last.sub = { tag, items: [] };
        last.sub.items.push(item);
      } else if (item !== null) {
        flushPara();
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag, items: [] };
        list.items.push({ text: item });
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara(); flushList();
  }
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:640px">${out.join("")}</div>`;
}

module.exports = { STYLES, channelKey, defaultStyle, styleFor, channelSettings, instructionLine, rules, emailHtml };
