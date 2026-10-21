#!/usr/bin/env node
/**
 * Install a durable (System-user) Page token for a client's Facebook Page.
 *
 * Use when a client's Page keeps disconnecting with 190/460 because the token
 * came from a person's Facebook session. A System user created in the client's
 * Business Portfolio (Business Settings > Users > System users, assigned the
 * Page + the AIStaff app) produces tokens that do not die with anyone's login.
 *
 * Usage (token is read from stdin so it never lands in shell history):
 *   node scripts/install-page-token.js <page_id>
 *   paste the System-user token (or a Page token derived from it), press Enter
 *
 * Accepts either the system-user token itself (Page token is fetched via
 * /me/accounts) or a Page token. Refuses tokens tied to a person's session
 * unless --allow-user-token is passed.
 */
require("dotenv").config({ override: true });
const readline = require("readline");
const { PrismaClient } = require("@prisma/client");
const { encryptSecret } = require("../src/crypto");
const { inspectMetaToken, metaGraphVersion } = require("../src/meta-access-tokens");

const prisma = new PrismaClient();
const G = () => `https://graph.facebook.com/${metaGraphVersion()}`;

async function readTokenFromStdin() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: false });
  process.stderr.write("Paste token, then Enter: ");
  for await (const line of rl) { rl.close(); return line.trim(); }
  return "";
}

async function main() {
  const pageId = process.argv[2];
  const allowUser = process.argv.includes("--allow-user-token");
  if (!pageId) throw new Error("Usage: node scripts/install-page-token.js <page_id> [--allow-user-token]");
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const existing = await prisma.facebookPage.findUnique({ where: { page_id: pageId } });
  if (!existing) throw new Error(`Page ${pageId} is not connected to any company. Connect it once through AIStaff first.`);

  const raw = await readTokenFromStdin();
  // Clean up common paste damage: terminal paste markers, quotes, spaces,
  // line breaks, a leading "access_token=" label.
  const input = String(raw || "")
    .replace(/\x1b\[20[01]~/g, "")
    .replace(/^access_token=/i, "")
    .replace(/["'\s]/g, "");
  if (!input) throw new Error("No token given.");
  console.log(`received ${input.length} characters, starts with "${input.slice(0, 3)}" (Facebook tokens start with "EAA" and are usually 150-300 characters)`);
  if (!input.startsWith("EAA")) throw new Error("That does not look like a Facebook access token. Copy the full token from the Generate token dialog (it starts with EAA).");
  const info = await inspectMetaToken({ token: input, appId, appSecret });
  if (!info || !info.isValid) throw new Error(`Facebook says this token is not valid: ${JSON.stringify(info?.error || info)}`);
  console.log(`token type=${info.type} user_id=${info.userId} expires_at=${info.expiresAt} scopes=${info.scopes.join(",")}`);

  let pageToken = input;
  if (info.type !== "PAGE") {
    const r = await fetch(`${G()}/me/accounts?fields=id,name,access_token&limit=200&access_token=${encodeURIComponent(input)}`);
    const j = await r.json();
    const hit = (j.data || []).find((p) => String(p.id) === pageId);
    if (!hit?.access_token) throw new Error(`This token cannot see Page ${pageId}. Assign the Page to the System user first. ${JSON.stringify(j.error || {})}`);
    pageToken = hit.access_token;
  }

  const durable = info.type === "SYSTEM_USER";
  if (info.type === "USER" && !allowUser) {
    throw new Error("This is a personal USER token - it will die again with that person's Facebook session (190/460). Use a System-user token, or pass --allow-user-token to install it anyway.");
  }
  if (info.type === "PAGE" && !allowUser) {
    console.warn("WARNING: a bare Page token cannot be proven to come from a System user. If it was made from a personal login it will expire again. Prefer pasting the System-user token itself.");
  }

  const sub = await fetch(`${G()}/${encodeURIComponent(pageId)}/subscribed_apps`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ subscribed_fields: "messages,messaging_postbacks", access_token: pageToken })
  });
  const subJson = await sub.json().catch(() => ({}));
  if (!sub.ok || !subJson.success) throw new Error(`Webhook subscription failed: ${JSON.stringify(subJson)}`);

  await prisma.facebookPage.update({
    where: { page_id: pageId },
    data: { page_access_token_encrypted: encryptSecret(pageToken), status: "active" }
  });
  console.log(`Installed ${durable ? "durable " : ""}token for ${existing.page_name} (${pageId}); Page is active and subscribed.`);
}

main()
  .catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
