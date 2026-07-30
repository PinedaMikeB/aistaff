#!/usr/bin/env node
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const fs = require("fs");
const path = require("path");

const VOICES = {
  "AdLostSales-Feed": {
    file: "ad-lost-sales-feed.mp3",
    voice: "nova",
    text: "Late ang reply sa Facebook? Nawawala ang sales. AIStaff sumagot agad sa Messenger, mag-qualify ng leads, i-save sa dashboard, at maghanda ng quotation draft bago ninyo i-approve. Book free inbox audit today — aistaff dot click."
  },
  "AdLostSales-Story": {
    file: "ad-lost-sales-story.mp3",
    voice: "nova",
    text: "Nawawala ang sales dahil late ang reply sa Facebook? AIStaff helps your Page reply faster and qualify leads. Book free inbox audit today — aistaff dot click."
  },
  "AdLostSales-Feed-VO": {
    file: "ad-lost-sales-feed.mp3",
    voice: "nova",
    text: "Late ang reply sa Facebook? Nawawala ang sales. AIStaff sumagot agad sa Messenger, mag-qualify ng leads, i-save sa dashboard, at maghanda ng quotation draft bago ninyo i-approve. Book free inbox audit today — aistaff dot click."
  },
  "AdLostSales-Story-VO": {
    file: "ad-lost-sales-story.mp3",
    voice: "nova",
    text: "Nawawala ang sales dahil late ang reply sa Facebook? AIStaff helps your Page reply faster and qualify leads. Book free inbox audit today — aistaff dot click."
  }
};

async function generateWithOpenAI({ voice, text }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "tts-1",
      voice,
      input: text,
      response_format: "mp3"
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.warn(`OpenAI TTS unavailable (${response.status}). Falling back to macOS voice.`);
    console.warn(body.slice(0, 200));
    return null;
  }

  return Buffer.from(await response.arrayBuffer());
}

async function generateWithMacSay({ text, outPath }) {
  const { spawnSync } = require("child_process");
  const aiffPath = outPath.replace(/\.mp3$/i, ".aiff");
  const voice = process.env.MACOS_TTS_VOICE || "Samantha";
  const rate = process.env.MACOS_TTS_RATE || "200";

  const say = spawnSync("say", ["-v", voice, "-r", rate, "-o", aiffPath, text], { encoding: "utf8" });
  if (say.status !== 0) throw new Error(say.stderr || "macOS say failed");

  const ffmpeg = spawnSync("ffmpeg", ["-y", "-i", aiffPath, "-codec:a", "libmp3lame", "-qscale:a", "4", outPath], { encoding: "utf8" });
  if (ffmpeg.status !== 0) throw new Error(ffmpeg.stderr || "ffmpeg mp3 conversion failed");

  try { fs.unlinkSync(aiffPath); } catch {}
  return fs.readFileSync(outPath);
}

async function generateOne({ id, file, voice, text }) {
  const outDir = path.join(__dirname, "..", "public", "voiceovers");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, file);

  console.log(`Generating ${id} → ${file}`);
  let buffer = await generateWithOpenAI({ voice, text });
  if (!buffer) {
    buffer = await generateWithMacSay({ text, outPath });
  } else {
    fs.writeFileSync(outPath, buffer);
  }

  console.log(`Saved ${outPath} (${buffer.length} bytes)`);
  return outPath;
}

async function main() {
  const target = process.argv[2];
  const entries = target && VOICES[target]
    ? [[target, VOICES[target]]]
    : Object.entries(VOICES);

  for (const [id, config] of entries) {
    await generateOne({ id, ...config });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
