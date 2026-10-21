/**
 * Saved contacts with the customer's permission — all channels (added 2026-10-20).
 *
 * Mike: ask once "may we save your official name, contact, company/branch and
 * machine so next time you are not asked again?" — on email, Messenger, website
 * chat and Pitch phone calls. Only consented details are kept across requests.
 *
 * UPDATE 2026-10-20 (Mike): saving is the default on every channel, like a browser cache
 * but in our database — no permission question. Customers are told the details are needed
 * once. consent "no" only happens when a customer asks us to delete their details (forget_me).
 *
 * One row per company + channel identity (email address, Messenger PSID,
 * website-chat id, phone number). phone_key lets Pitch recognise a caller whose
 * number was given (with consent) on any channel.
 */
const { prisma } = require("./db");

/** PH-friendly canonical phone: digits, 09xx… -> 639xx…, 9xx… (10 digits) -> 639xx…. */
function phoneKey(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits || digits.length < 7) return null;
  if (digits.startsWith("0") && digits.length === 11) digits = `63${digits.slice(1)}`;
  else if (digits.length === 10 && digits.startsWith("9")) digits = `63${digits}`;
  return digits;
}

function identityOf(conversation) {
  const profile = conversation?.customer_profile || {};
  const channel = conversation?.channel || "facebook_messenger";
  if (channel === "email") return { channel, identity: String(profile.known?.calleremail || conversation.external_id || "").toLowerCase() || null };
  if (channel === "facebook_messenger") return { channel, identity: conversation.psid || null };
  if (channel === "phone" || channel === "mobile_phone") return { channel: "phone", identity: phoneKey(conversation.contact_number || conversation.external_id) };
  return { channel, identity: conversation.external_id || null };
}

function summaryFromProfile(profile = {}) {
  const known = profile.known || {};
  const machine = Array.isArray(profile.machines) ? profile.machines[0] : null;
  return {
    name: known.callername || null,
    address_as: profile.address_as || null,
    phone: known.callerphone || null,
    phone_key: phoneKey(known.callerphone),
    email: known.calleremail || null,
    organization: machine?.company || null,
    branch: machine?.branch || null,
    department: known.callerdepartment || null
  };
}

/** Copy a consented conversation profile into the saved-contacts table. */
async function syncFromConversation(companyId, conversationId) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true, channel: true, psid: true, external_id: true, contact_number: true, customer_profile: true } }).catch(() => null);
  if (!conversation) return null;
  const profile = conversation.customer_profile || {};
  if (profile.consent === "no") return null;
  const { channel, identity } = identityOf(conversation);
  if (!identity) return null;
  const data = {
    ...summaryFromProfile(profile),
    conversation_id: conversation.id,
    details: { known: profile.known || {}, machines: profile.machines || [], last_identified: profile.last_identified || null },
    consent: "yes",
    consent_at: profile.consent_at ? new Date(profile.consent_at) : new Date()
  };
  return prisma.contactProfile.upsert({
    where: { company_id_channel_identity: { company_id: companyId, channel, identity } },
    create: { company_id: companyId, channel, identity, ...data },
    update: data
  }).catch((error) => { console.error("[contacts] sync failed: %s", error.message); return null; });
}

/** Record the customer's answer. "no" drops what was remembered (after the current request). */
async function setConsent(companyId, conversationId, answer) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { customer_profile: true, channel: true, psid: true, external_id: true, contact_number: true } }).catch(() => null);
  if (!conversation) return;
  const profile = { ...(conversation.customer_profile || {}), consent: answer === "yes" ? "yes" : "no", consent_at: new Date().toISOString() };
  await prisma.conversation.update({ where: { id: conversationId }, data: { customer_profile: profile } }).catch(() => {});
  if (answer === "yes") await syncFromConversation(companyId, conversationId);
  else {
    const { channel, identity } = identityOf({ ...conversation, customer_profile: profile });
    if (identity) await prisma.contactProfile.deleteMany({ where: { company_id: companyId, channel, identity } }).catch(() => {});
  }
  console.log("[contacts] company=%s conversation=%s consent=%s", companyId, conversationId, profile.consent);
}

/** "Forget my details": remove the saved contact and everything remembered in the conversation. */
async function forget(companyId, conversationId) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { customer_profile: true, channel: true, psid: true, external_id: true, contact_number: true } }).catch(() => null);
  if (!conversation) return;
  const { channel, identity } = identityOf(conversation);
  if (identity) await prisma.contactProfile.deleteMany({ where: { company_id: companyId, channel, identity } }).catch(() => {});
  const old = conversation.customer_profile || {};
  const keepEmail = conversation.channel === "email" && old.known?.calleremail ? { calleremail: old.known.calleremail } : {};
  const next = { consent: "no", consent_at: new Date().toISOString(), known: keepEmail, machines: [], ...(old.last_request ? { last_request: old.last_request } : {}), ...(old.pending_open_check ? { pending_open_check: old.pending_open_check } : {}) };
  await prisma.conversation.update({ where: { id: conversationId }, data: { customer_profile: next } }).catch(() => {});
  console.log("[contacts] company=%s conversation=%s forgotten", companyId, conversationId);
}

/** Consented contact for a phone number (any channel), newest first. */
async function findByPhone(companyId, rawPhone) {
  const key = phoneKey(rawPhone);
  if (!companyId || !key) return null;
  return prisma.contactProfile.findFirst({ where: { company_id: companyId, consent: "yes", OR: [{ phone_key: key }, { channel: "phone", identity: key }] }, orderBy: { updated_at: "desc" } }).catch(() => null);
}

/** Pitch: save (or decline) the caller's details after asking them. */
async function saveCaller(companyId, rawPhone, { name, address_as, organization, branch, department, consent }) {
  const key = phoneKey(rawPhone);
  if (!companyId || !key) return { saved: false, reason: "no_caller_id" };
  if (consent === false) {
    await prisma.contactProfile.deleteMany({ where: { company_id: companyId, channel: "phone", identity: key } }).catch(() => {});
    await prisma.contactProfile.create({ data: { company_id: companyId, channel: "phone", identity: key, phone: rawPhone, phone_key: key, consent: "no", consent_at: new Date() } }).catch(() => {});
    return { saved: false, reason: "caller_declined" };
  }
  const clean = (v, n = 120) => (v == null ? null : String(v).trim().slice(0, n) || null);
  const data = { name: clean(name), address_as: clean(address_as, 60), organization: clean(organization), branch: clean(branch), department: clean(department), phone: String(rawPhone), phone_key: key, consent: "yes", consent_at: new Date() };
  if (!data.name) return { saved: false, reason: "name_required" };
  await prisma.contactProfile.upsert({ where: { company_id_channel_identity: { company_id: companyId, channel: "phone", identity: key } }, create: { company_id: companyId, channel: "phone", identity: key, ...data }, update: data });
  return { saved: true };
}

/** Pitch prompt lines about who is calling. */
async function callerPromptSection(companyId, rawPhone) {
  const key = phoneKey(rawPhone);
  if (!companyId || !key) return "";
  const known = await findByPhone(companyId, rawPhone);
  const declined = !known && await prisma.contactProfile.findFirst({ where: { company_id: companyId, channel: "phone", identity: key, consent: "no" } }).catch(() => null);
  if (known) {
    const machines = (known.details?.machines || []).slice(0, 3).map((m) => [m.model, m.serial].filter(Boolean).join(" ")).filter(Boolean);
    return [
      "## Who is calling",
      "This number belongs to a SAVED contact (they agreed to be remembered):",
      `- Name: ${known.name || "unknown"}${known.address_as ? ` (address them as ${known.address_as})` : ""}`,
      known.organization ? `- Company: ${known.organization}` : "",
      known.branch || known.department ? `- Branch / department: ${[known.branch, known.department].filter(Boolean).join(" — ")}` : "",
      machines.length ? `- Machine(s) on file: ${machines.join("; ")}` : "",
      "Greet them warmly BY NAME in your first sentence. Do not ask again for these details — ask only what they need today. If they say something changed, accept it and call save_caller_details with the new details."
    ].filter(Boolean).join("\n");
  }
  if (declined) return "## Who is calling\nThis caller earlier asked us to delete their details. Do not save them again.";
  return [
    "## Who is calling",
    "This caller is not saved yet. You will need their name, company and branch / department — but this is a conversation, not a form:",
    "- Never ask these back to back or as a list. Ask ONE at a time, only where it fits naturally, woven into your replies about what they need (for example \"May I know who I'm speaking with?\" early on; the company and branch when you get to their request).",
    "- First listen and respond to what they called about. If they already mentioned a detail, do not ask it again.",
    "- Once, in passing, mention that you only need these the first time, so next time you can greet them properly and help with their future inquiries and requests faster. Do not ask for permission.",
    "- When you have their name (and whatever else came up), call save_caller_details."
  ].join("\n");
}

module.exports = { phoneKey, identityOf, syncFromConversation, setConsent, forget, findByPhone, saveCaller, callerPromptSection };
