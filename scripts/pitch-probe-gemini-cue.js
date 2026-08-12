"use strict";

/** Throwaway: does an English trigger cue bias the opening language? */

const WebSocket = require("ws");
require("dotenv").config({ override: true });

const MODEL = process.env.PITCH_GEMINI_LIVE_MODEL
  || "gemini-2.5-flash-native-audio-preview-12-2025";
const URL = "wss://generativelanguage.googleapis.com/ws/"
  + "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
  + "?key=" + encodeURIComponent(process.env.GEMINI_API_KEY);

const CUE = process.argv[2] || "The call has just connected.";
const RUNS = 4;

function once() {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    let audio = 0, text = "", err = null;
    const done = () => { try { ws.close(); } catch {} resolve({ audio, text, err }); };
    const timer = setTimeout(done, 12000);

    ws.on("open", () => ws.send(JSON.stringify({
      setup: {
        model: `models/${MODEL}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          temperature: Number(process.env.TEMP || 1.0),
        },
        systemInstruction: { parts: [{ text:
          "You are a voice assistant answering the phone for Marga Enterprises, "
          + "a copier and printer rental business in Metro Manila. Open the call by "
          + "identifying the business and offering to help, in whatever way feels "
          + "natural in the moment. Vary it between calls. Listen to the caller and "
          + "reply in whatever language they use - English, Tagalog or Taglish - and "
          + "switch with them mid-call without comment. Keep turns short." }] },
        outputAudioTranscription: {},
      },
    })));

    ws.on("message", (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.setupComplete) return ws.send(JSON.stringify({
        clientContent: { turns: [{ role: "user", parts: [{ text: CUE }] }], turnComplete: true },
      }));
      if (m.error) { err = m.error.message; clearTimeout(timer); return done(); }
      const sc = m.serverContent;
      if (!sc) return;
      if (sc.outputTranscription?.text) text += sc.outputTranscription.text;
      for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data) audio++;
      if (sc.turnComplete) { clearTimeout(timer); done(); }
    });
    ws.on("error", (e) => { err = e.message; clearTimeout(timer); done(); });
  });
}

(async () => {
  console.log(`cue: "${CUE}"\n`);
  for (let i = 1; i <= RUNS; i++) {
    const r = await once();
    console.log(`${i}. audio=${String(r.audio).padStart(3)}  ${r.err ? "ERR " + r.err.slice(0,80) : r.text || "(no speech)"}`);
  }
  process.exit(0);
})();
