#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const envPath = path.join(__dirname, "..", ".env");
if (!fs.existsSync(envPath)) {
  console.error(".env not found");
  process.exit(1);
}

let env = fs.readFileSync(envPath, "utf8");
const updates = {
  JWT_SECRET: crypto.randomBytes(48).toString("base64"),
  ENCRYPTION_SECRET: crypto.randomBytes(32).toString("base64"),
  META_APP_ID: "3204429623074319",
  META_PAGE_ID: "1164341106754995",
  APP_PUBLIC_URL: "https://aistaff.click"
};

for (const [key, value] of Object.entries(updates)) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(env)) env = env.replace(pattern, `${key}="${value}"`);
  else env += `\n${key}="${value}"`;
}

fs.writeFileSync(envPath, env);
console.log("Updated .env secrets and Meta IDs. Add META_APP_SECRET from Meta Developer Console if missing.");
