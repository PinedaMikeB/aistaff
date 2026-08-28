#!/usr/bin/env node
"use strict";

/**
 * Voice Lab — browser-capture edition.
 *
 * Records a Piper training dataset with ZERO dependencies: no ffmpeg, no
 * Homebrew, no npm install. Node's built-in http module only.
 *
 * The Mac Mini version captured audio server-side via ffmpeg + avfoundation.
 * That cannot work on a machine without ffmpeg, and it tied the recorder to
 * whichever machine ran the server. Here the BROWSER captures raw PCM through
 * the Web Audio API and encodes WAV itself.
 *
 * Raw PCM, deliberately NOT MediaRecorder: MediaRecorder emits lossy Opus,
 * and compression artefacts get baked permanently into the trained voice.
 *
 *   node server.js   ->  http://127.0.0.1:9890
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const WAVS = path.join(ROOT, "dataset", "wavs");
const TAKES = path.join(ROOT, "dataset", "takes.json");
const SCRIPTS = path.join(ROOT, "scripts");
const PORT = Number(process.env.VOICE_LAB_PORT || 9890);

fs.mkdirSync(WAVS, { recursive: true });

const loadTakes = () => { try { return JSON.parse(fs.readFileSync(TAKES, "utf8")); } catch { return {}; } };
const saveTakes = (t) => fs.writeFileSync(TAKES, JSON.stringify(t, null, 2));
const safeId = (s) => String(s || "").replace(/[^\w\-]/g, "");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".wav": "audio/wav" };

/**
 * Peak, RMS and noise floor straight from the PCM samples.
 *
 * The Mac Mini version shelled out to ffmpeg's astats for this. Doing the
 * arithmetic here removes the last reason to need ffmpeg at all, and it is
 * only a few lines: peak is the loudest sample, RMS is the energy average,
 * and the noise floor is the quietest 100 ms window — which is what tells you
 * whether the room is actually silent between words.
 */
function analyse(int16) {
  const n = int16.length;
  if (!n) return { peak: null, rms: null, floor: null, seconds: 0 };

  let peak = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(int16[i]);
    if (v > peak) peak = v;
    sumSq += int16[i] * int16[i];
  }
  const db = (x) => (x <= 0 ? -Infinity : 20 * Math.log10(x / 32768));

  // Quietest 100 ms window = the noise floor.
  const win = Math.max(1, Math.floor(22050 * 0.1));
  let quietest = Infinity;
  for (let s = 0; s + win <= n; s += win) {
    let sq = 0;
    for (let i = s; i < s + win; i++) sq += int16[i] * int16[i];
    const r = Math.sqrt(sq / win);
    if (r < quietest) quietest = r;
  }

  return {
    peak: db(peak),
    rms: db(Math.sqrt(sumSq / n)),
    floor: Number.isFinite(quietest) ? db(quietest) : null,
    seconds: n / 22050,
  };
}

function verdict(a) {
  const issues = [];
  if (a.peak > -1) issues.push("CLIPPING — turn the Yeti gain down");
  else if (a.peak > -2.5) issues.push("Too hot — close to clipping");
  else if (a.peak < -12) issues.push("Too quiet — turn the Yeti gain up");
  if (a.floor !== null && a.floor > -40) issues.push("Noisy room — check aircon or fan");
  if (a.seconds < 1) issues.push("Very short — did it capture?");
  let status = "good";
  if (issues.some((i) => /CLIPPING|Too quiet|capture/.test(i))) status = "bad";
  else if (issues.length) status = "warn";
  return { issues, status };
}

function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": body.length });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 60 * 1024 * 1024) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    // ---- script + existing takes ----
    if (p === "/api/script") {
      const name = (url.searchParams.get("name") || "taglish-core.json").replace(/[^\w.\-]/g, "");
      const file = path.join(SCRIPTS, name);
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: "script not found", looked: file });
      const script = JSON.parse(fs.readFileSync(file, "utf8"));
      return sendJson(res, 200, { lines: script.lines || script, takes: loadTakes() });
    }

    // ---- save a take: raw 16-bit PCM body, 22050 mono ----
    if (p.startsWith("/api/take/") && req.method === "POST") {
      const id = safeId(p.split("/").pop());
      const text = url.searchParams.get("text") || "";
      const raw = await readBody(req);
      const int16 = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));

      const a = analyse(int16);
      const v = verdict(a);
      fs.writeFileSync(path.join(WAVS, `${id}.wav`), wavFromPcm(raw, 22050));

      const takes = loadTakes();
      takes[id] = {
        id, text, wav: `wavs/${id}.wav`,
        peak: a.peak, rms: a.rms, floor: a.floor, duration: a.seconds,
        issues: v.issues, status: v.status, recordedAt: new Date().toISOString(),
      };
      saveTakes(takes);
      return sendJson(res, 200, takes[id]);
    }

    // ---- delete a take ----
    if (p.startsWith("/api/take/") && req.method === "DELETE") {
      const id = safeId(p.split("/").pop());
      const f = path.join(WAVS, `${id}.wav`);
      if (fs.existsSync(f)) fs.unlinkSync(f);
      const takes = loadTakes();
      delete takes[id];
      saveTakes(takes);
      return sendJson(res, 200, { deleted: id });
    }

    // ---- play back a take ----
    if (p.startsWith("/api/audio/")) {
      const f = path.join(WAVS, `${safeId(p.split("/").pop())}.wav`);
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      const buf = fs.readFileSync(f);
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": buf.length });
      return res.end(buf);
    }

    // ---- LJSpeech export for Piper ----
    if (p === "/api/export" && req.method === "POST") {
      const takes = loadTakes();
      const rows = Object.values(takes)
        .filter((t) => t.text && t.status !== "bad" && fs.existsSync(path.join(WAVS, `${t.id}.wav`)))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((t) => `${t.id}|${t.text.replace(/\|/g, " ")}`);
      const out = path.join(ROOT, "dataset", "metadata.csv");
      fs.writeFileSync(out, rows.join("\n") + "\n");
      return sendJson(res, 200, { written: rows.length, path: out });
    }

    // ---- static ----
    const file = path.join(ROOT, "public", p === "/" ? "index.html" : p.replace(/^\//, ""));
    if (file.startsWith(path.join(ROOT, "public")) && fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      // No caching: the script and the UI change while recording is in
      // progress, and a stale cached copy silently shows the wrong line count.
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "text/plain",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
      return res.end(buf);
    }

    res.writeHead(404);
    res.end("not found");
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

/** Minimal 16-bit mono WAV header around raw PCM. */
function wavFromPcm(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);          // PCM
  h.writeUInt16LE(1, 22);          // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);   // byte rate
  h.writeUInt16LE(2, 32);          // block align
  h.writeUInt16LE(16, 34);         // bits
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Voice Lab  ->  http://127.0.0.1:${PORT}`);
  console.log(`  browser capture, 22050 Hz mono 16-bit, no ffmpeg needed\n`);
});
