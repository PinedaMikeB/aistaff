"use strict";

/** Throwaway: send one SMS via the gateway's SIP MESSAGE path. */

const { SipUa } = require("../src/pitch/sip/ua");
const { config } = require("../src/pitch/config");

const TO = process.argv[2];
const TEXT = process.argv[3] || "Pitch SMS path test. Reply not needed.";

if (!TO) {
  console.log('usage: node scripts/pitch-probe-sms.js <number> ["text"]');
  process.exit(1);
}

const ua = new SipUa(config.sip);
ua.on("error", (e) => console.log("ua error:", e.message));

ua.on("registered", async () => {
  console.log("registered — sending SMS to", TO);
  try {
    const status = await ua.sendMessage(TO, TEXT);
    console.log("SENT ok, SIP status", status);
  } catch (err) {
    console.log("FAILED:", err.message);
  }
  ua.stop();
  process.exit(0);
});

ua.on("register_failed", (s, r) => {
  console.log("registration failed:", s, r);
  process.exit(1);
});

ua.start();
setTimeout(() => { console.log("timed out"); process.exit(1); }, 30000);
