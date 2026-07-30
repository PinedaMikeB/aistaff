#!/usr/bin/env node
require("dotenv").config({ override: true });

const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

async function main() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const verifyToken = process.env.META_VERIFY_TOKEN || "aistaff_verify_2026";
  const publicUrl = process.env.APP_PUBLIC_URL;
  const pageId = process.env.META_PAGE_ID;

  if (!publicUrl) {
    console.error("Set APP_PUBLIC_URL in .env first (your persistent tunnel URL).");
    process.exit(1);
  }

  const callbackUrl = `${publicUrl.replace(/\/$/, "")}/api/webhooks/messenger`;
  console.log(`Messenger webhook callback URL: ${callbackUrl}`);
  console.log(`Verify token: ${verifyToken}`);

  if (!appId || !appSecret) {
    console.log("\nMETA_APP_ID or META_APP_SECRET is missing.");
    console.log("Add them in Meta Developer Console → App → Settings → Basic, then rerun:");
    console.log("  npm run configure:webhook");
    console.log("\nManual setup:");
    console.log("1. Meta Developer Console → Messenger → Webhooks");
    console.log(`2. Callback URL: ${callbackUrl}`);
    console.log(`3. Verify token: ${verifyToken}`);
    console.log("4. Subscribe to: messages, messaging_postbacks");
    process.exit(0);
  }

  const appAccessToken = `${appId}|${appSecret}`;
  const subscribeUrl = `https://graph.facebook.com/v20.0/${appId}/subscriptions?access_token=${encodeURIComponent(appAccessToken)}`;
  const body = new URLSearchParams({
    object: "page",
    callback_url: callbackUrl,
    verify_token: verifyToken,
    fields: "messages,messaging_postbacks,messaging_optins,message_deliveries,message_reads"
  });

  const response = await fetch(subscribeUrl, { method: "POST", body });
  const json = await response.json();
  if (!response.ok) {
    console.error("Failed to configure Meta webhook:", JSON.stringify(json, null, 2));
    process.exit(1);
  }

  console.log("Meta app webhook subscription updated.");

  if (pageId && process.env.META_PAGE_ACCESS_TOKEN) {
    const pageSubUrl = `https://graph.facebook.com/v20.0/${pageId}/subscribed_apps?access_token=${encodeURIComponent(process.env.META_PAGE_ACCESS_TOKEN)}`;
    const pageResponse = await fetch(pageSubUrl, {
      method: "POST",
      body: new URLSearchParams({ subscribed_fields: "messages,messaging_postbacks,messaging_optins,message_deliveries,message_reads" })
    });
    const pageJson = await pageResponse.json();
    if (!pageResponse.ok) {
      console.warn("Page subscription warning:", JSON.stringify(pageJson, null, 2));
    } else {
      console.log(`Page ${pageId} subscribed to webhook events.`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
