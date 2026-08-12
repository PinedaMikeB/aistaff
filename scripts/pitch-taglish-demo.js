"use strict";

/**
 * Throwaway: make Pitch answer a Taglish question and save the reply as a WAV,
 * so we can hear the language matching without dialling. Safe to delete.
 */

const fs = require("fs");
const { createBrain } = require("../src/pitch/brain");

const PROMPT = process.argv[2] ||
  "Hi, magkano po ang rental ninyo ng copier? Kailangan namin for our office sa Pasig.";
const OUT = process.argv[3] || `${process.env.HOME}/Desktop/pitch-taglish.wav`;

function wav(pcm, rate = 8000) {
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) data.writeInt16LE(pcm[i], i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

(async () => {
  const brain = createBrain({ callerId: "+639175769817" });
  const chunks = [];
  brain.on("audio", (pcm) => chunks.push(pcm));
  brain.on("transcript", ({ role, text }) => console.log(`[${role}] ${text}`));
  brain.on("error", (e) => console.log("ERROR:", e.message));

  await brain.connect();
  console.log(`caller says: ${PROMPT}\n`);

  // Feed the caller's turn as text so we exercise the model, not the mic.
  brain.ws.send(JSON.stringify({
    type: "conversation.item.create",
    item: { type: "message", role: "user",
      content: [{ type: "input_text", text: PROMPT }] },
  }));
  brain.ws.send(JSON.stringify({ type: "response.create" }));

  await new Promise((r) => setTimeout(r, 15000));

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Int16Array(total);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  fs.writeFileSync(OUT, wav(all));
  console.log(`\nwrote ${OUT} (${(total / 8000).toFixed(1)}s)`);
  brain.close();
  process.exit(0);
})();
