"use strict";

/** Throwaway: does Gemini actually accept our realtime audio? */

const fs = require("fs");
const WebSocket = require("ws");
require("dotenv").config({ override: true });
const { resample, int16ToBuffer } = require("../src/pitch/audio/resample");

const WAV = process.argv[2];
const SHAPE = process.argv[3] || "audio";       // "audio" | "mediaChunks"
const CHUNK_MS = Number(process.argv[4] || 100); // ms per websocket message

const MODEL = process.env.PITCH_GEMINI_LIVE_MODEL
  || "gemini-2.5-flash-native-audio-preview-12-2025";
const URL = "wss://generativelanguage.googleapis.com/ws/"
  + "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
  + "?key=" + encodeURIComponent(process.env.GEMINI_API_KEY);

// Read 8k mono WAV, skip 44-byte header.
const buf = fs.readFileSync(WAV).subarray(44);
const pcm8 = new Int16Array(buf.length / 2);
for (let i = 0; i < pcm8.length; i++) pcm8[i] = buf.readInt16LE(i * 2);
const pcm16 = resample(pcm8, 8000, 16000);
console.log(`${WAV}: ${(pcm8.length / 8000).toFixed(1)}s  shape=${SHAPE}  chunk=${CHUNK_MS}ms`);

const samplesPerChunk = 16000 * CHUNK_MS / 1000;

const ws = new WebSocket(URL);
let sent = 0, events = [], transcript = "", audioParts = 0;

ws.on("open", () => ws.send(JSON.stringify({
  setup: {
    model: `models/${MODEL}`,
    generationConfig: { responseModalities: ["AUDIO"] },
    systemInstruction: { parts: [{ text: "You answer the phone for a business. Reply briefly in the caller's language." }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  },
})));

ws.on("message", async (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  events.push(Object.keys(m).join("+"));

  if (m.setupComplete) {
    for (let o = 0; o < pcm16.length; o += samplesPerChunk) {
      const slice = pcm16.subarray(o, Math.min(o + samplesPerChunk, pcm16.length));
      const data = int16ToBuffer(slice).toString("base64");
      const payload = SHAPE === "audio"
        ? { realtimeInput: { audio: { data, mimeType: "audio/pcm;rate=16000" } } }
        : { realtimeInput: { mediaChunks: [{ data, mimeType: "audio/pcm;rate=16000" }] } };
      ws.send(JSON.stringify(payload));
      sent++;
      await new Promise((r) => setTimeout(r, CHUNK_MS));
    }
    console.log(`sent ${sent} chunks, waiting for reply...`);
    return;
  }
  const sc = m.serverContent;
  if (!sc) { if (m.error) console.log("ERROR:", JSON.stringify(m.error).slice(0, 200)); return; }
  if (sc.inputTranscription?.text) transcript += "[in]" + sc.inputTranscription.text;
  if (sc.outputTranscription?.text) transcript += sc.outputTranscription.text;
  for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data) audioParts++;
});

setTimeout(() => {
  console.log("events:", [...new Set(events)].join(", ") || "(none)");
  console.log("audio parts back:", audioParts);
  console.log("transcript:", transcript || "(none)");
  process.exit(0);
}, 45000);
