#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const scenes = [
  {
    id: "scene-01",
    text:
      "Closer does not guess. It works from the information you give it: your business details, products, prices, photos, rules, and the way you want customers handled."
  },
  {
    id: "scene-02",
    text:
      "First, open your tenant workspace. This is the control room for one company. Each customer has their own workspace, their own knowledge base, and their own settings."
  },
  {
    id: "scene-03",
    text:
      "Start with the basics: who you are, what you sell, your service area, your contact details, and what kind of customers you want Closer to qualify."
  },
  {
    id: "scene-04",
    text:
      "Next, add your products, services, pricing, inclusions, promos, payment terms, delivery rules, and anything Closer must never invent. This is the sales truth it will use in chat."
  },
  {
    id: "scene-05",
    text:
      "If customers need to see something, upload it. Product photos, posters, price cards, videos, and PDFs can be attached to knowledge entries, so Closer can send the right file at the right moment."
  },
  {
    id: "scene-06",
    text:
      "Then set the behavior in AI Studio. The platform general prompt and tenant settings tell Closer the tone, language behavior, qualification flow, handoff rules, and what to do next."
  },
  {
    id: "scene-07",
    text:
      "The same brain can power Messenger and the website chat widget. If you update the knowledge base or the AI Studio rules, both channels can use the latest approved information."
  },
  {
    id: "scene-08",
    text:
      "When prices change, promos expire, new products launch, or policies update, edit the knowledge base. Closer stays useful because your team keeps the source of truth clean."
  }
];

const outDir = path.join(__dirname, "..", "public", "voiceovers", "closer-knowledge-explainer");
fs.mkdirSync(outDir, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function duration(filePath) {
  const output = run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
  return Number.parseFloat(output.trim());
}

const voice = process.env.MACOS_TTS_VOICE || "Samantha";
const rate = process.env.MACOS_TTS_RATE || "185";
const concatListPath = path.join(outDir, "concat-list.txt");
const manifest = [];
const concatLines = [];

for (const scene of scenes) {
  const aiffPath = path.join(outDir, `${scene.id}.aiff`);
  const mp3Path = path.join(outDir, `${scene.id}.mp3`);

  run("say", ["-v", voice, "-r", rate, "-o", aiffPath, scene.text]);
  run("ffmpeg", ["-y", "-i", aiffPath, "-codec:a", "libmp3lame", "-qscale:a", "4", mp3Path]);
  fs.unlinkSync(aiffPath);

  concatLines.push(`file '${mp3Path.replace(/'/g, "'\\''")}'`);
  manifest.push({
    id: scene.id,
    file: path.relative(path.join(__dirname, "..", "public"), mp3Path),
    durationSeconds: Number(duration(mp3Path).toFixed(3)),
    narration: scene.text
  });
}

fs.writeFileSync(concatListPath, concatLines.join("\n"));
run("ffmpeg", [
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  concatListPath,
  "-c",
  "copy",
  path.join(outDir, "closer-knowledge-explainer-full.mp3")
]);

fs.writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      voice,
      rate,
      fullAudio: "voiceovers/closer-knowledge-explainer/closer-knowledge-explainer-full.mp3",
      totalDurationSeconds: Number(manifest.reduce((total, scene) => total + scene.durationSeconds, 0).toFixed(3)),
      scenes: manifest
    },
    null,
    2
  )
);

console.log(JSON.stringify({ ok: true, outDir, scenes: manifest }, null, 2));
