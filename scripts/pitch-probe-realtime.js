"use strict";

/**
 * Throwaway diagnostic: connect the Pitch brain to OpenAI Realtime and report
 * whether the GA session config is accepted — without needing a phone call.
 * Safe to delete. Not referenced by anything.
 */

const { createBrain } = require("../src/pitch/brain");

(async () => {
  const brain = createBrain({ callerId: "+639175769817" });
  let sawError = null;

  brain.on("error", (err) => { if (!sawError) sawError = err; });
  brain.on("transcript", ({ role, text }) => console.log(`[${role}] ${text}`));

  let audioChunks = 0;
  let audioSamples = 0;
  brain.on("audio", (pcm) => { audioChunks += 1; audioSamples += pcm.length; });

  try {
    await brain.connect();
    console.log("connected OK");
  } catch (err) {
    console.log("CONNECT FAILED:", err.message);
    process.exit(1);
  }

  brain.greet();
  await new Promise((r) => setTimeout(r, 12000));

  console.log("---");
  console.log("error:", sawError ? sawError.message : "none");
  console.log("audio chunks:", audioChunks, "samples@8k:", audioSamples,
    "(~" + (audioSamples / 8000).toFixed(1) + "s of speech)");
  brain.close();
  process.exit(0);
})();
