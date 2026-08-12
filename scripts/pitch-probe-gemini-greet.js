"use strict";

/** Throwaway: find which client message actually triggers a first turn. */

const WebSocket = require("ws");
require("dotenv").config({ override: true });

const MODEL = process.env.PITCH_GEMINI_LIVE_MODEL
  || "gemini-2.5-flash-native-audio-preview-12-2025";
const URL = "wss://generativelanguage.googleapis.com/ws/"
  + "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
  + "?key=" + encodeURIComponent(process.env.GEMINI_API_KEY);

const VARIANTS = {
  "A empty turns array": { clientContent: { turns: [], turnComplete: true } },
  "B turnComplete only": { clientContent: { turnComplete: true } },
  "C empty user parts": { clientContent: { turns: [{ role: "user", parts: [] }], turnComplete: true } },
  "D audioStreamEnd": { realtimeInput: { audioStreamEnd: true } },
  "E activity end": { realtimeInput: { activityStart: {} , activityEnd: {} } },
};

async function tryVariant(label, payload) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    let audio = 0, text = "", err = null;
    const done = () => { try { ws.close(); } catch {} resolve({ label, audio, text, err }); };
    const timer = setTimeout(done, 9000);

    ws.on("open", () => ws.send(JSON.stringify({
      setup: {
        model: `models/${MODEL}`,
        generationConfig: { responseModalities: ["AUDIO"] },
        systemInstruction: { parts: [{ text:
          "You are answering the phone for a business. Greet the caller and offer to help. Match the caller's language." }] },
        outputAudioTranscription: {},
      },
    })));

    ws.on("message", (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.setupComplete) return ws.send(JSON.stringify(payload));
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
  for (const [label, payload] of Object.entries(VARIANTS)) {
    const r = await tryVariant(label, payload);
    console.log(`${r.label.padEnd(22)} audio=${String(r.audio).padStart(3)}  ${r.err ? "ERR: " + r.err.slice(0, 70) : "text: " + (r.text || "(none)").slice(0, 70)}`);
  }
  process.exit(0);
})();
