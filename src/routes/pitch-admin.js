"use strict";

/**
 * Pitch admin API — everything the AI Studio "Pitch" tab needs.
 *
 * Mounted at /api/pitch-admin. Kept out of server.js so voice-agent settings
 * can evolve without touching the main route file.
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const { readConfig, writeConfig, CONFIG_PATH } = require("../pitch/runtime-config");
const { listVoices, listLanguages, VOICE_DIR } = require("../pitch/voice-catalogue");

const REPO_ROOT = path.join(__dirname, "..", "..");
const PIPER_BIN = path.join(REPO_ROOT, "local-runtime", "venvs", "piper", "bin", "piper");
const WHISPER_MODELS = path.join(REPO_ROOT, "local-runtime", "whisper.cpp", "models");
const PREVIEW_DIR = path.join(REPO_ROOT, "local-runtime", "piper", "previews");

const PIPER_HEALTH = "http://127.0.0.1:9891/health";
const WHISPER_HEALTH = "http://127.0.0.1:8080/";
const HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

// Gemini Live prebuilt voices. These are Google's, not ours — no download,
// no custom voice, and no language setting (the model matches the caller).
// Characterisations are from Google's own voice descriptions.
const GEMINI_VOICES = [
  { name: "Aoede",  gender: "female", note: "breezy" },
  { name: "Kore",   gender: "female", note: "firm" },
  { name: "Leda",   gender: "female", note: "youthful" },
  { name: "Zephyr", gender: "female", note: "bright" },
  { name: "Puck",   gender: "male",   note: "upbeat" },
  { name: "Charon", gender: "male",   note: "informative" },
  { name: "Fenrir", gender: "male",   note: "excitable" },
  { name: "Orus",   gender: "male",   note: "firm" },
];

fs.mkdirSync(PREVIEW_DIR, { recursive: true });

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) =>
    res.status(500).json({ error: e.message || String(e) }));

async function probe(url, ms = 2500) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}

function whisperModels() {
  try {
    return fs.readdirSync(WHISPER_MODELS)
      .filter((f) => f.startsWith("ggml-") && f.endsWith(".bin"))
      .map((f) => {
        const size = fs.statSync(path.join(WHISPER_MODELS, f)).size;
        return { name: f.replace(/\.bin$/, ""), sizeMB: Math.round(size / 1048576) };
      })
      // 562K files are the repo's test stubs, not real models.
      .filter((m) => m.sizeMB > 5)
      .sort((a, b) => a.sizeMB - b.sizeMB);
  } catch { return []; }
}

function pitchProcess() {
  return new Promise((resolve) => {
    execFile("pgrep", ["-f", "src/pitch/index.js"], (err, stdout) => {
      const pid = String(stdout || "").trim().split("\n")[0];
      resolve(pid ? Number(pid) : null);
    });
  });
}

/**
 * What the RUNNING Pitch actually started as, read from its log.
 * Saved settings only take effect on restart, so the UI needs to be able to
 * say "you saved X but Y is answering calls" rather than silently drifting.
 */
function runningPipeline() {
  try {
    const log = fs.readFileSync(path.join(REPO_ROOT, "logs", "pitch-live.log"), "utf8");
    const lines = log.split("\n").filter((l) => l.includes("starting — extension"));
    const last = lines[lines.length - 1] || "";
    const m = last.match(/brain=(\w+)/);
    if (!m) return null;
    return m[1] === "local" ? "local" : "gemini-live";
  } catch { return null; }
}

function buildRouter({ requireAuth } = {}) {
  const r = express.Router();
  const guard = requireAuth || ((req, res, next) => next());
  r.use(express.json({ limit: "256kb" }));

  // ---- current state -------------------------------------------------
  r.get("/", guard, wrap(async (req, res) => {
    const [piperUp, whisperUp, pid] = await Promise.all([
      probe(PIPER_HEALTH), probe(WHISPER_HEALTH), pitchProcess(),
    ]);
    res.json({
      config: readConfig(),
      configPath: CONFIG_PATH,
      services: { piper: piperUp, whisper: whisperUp, pitchPid: pid },
      runningPipeline: runningPipeline(),
      whisperModels: whisperModels(),
      languages: listLanguages(),
      geminiVoices: GEMINI_VOICES,
    });
  }));

  // ---- voice catalogue ------------------------------------------------
  r.get("/voices", guard, wrap(async (req, res) => {
    const { language, gender, installedOnly } = req.query;
    let voices = listVoices({ language: language || null, gender: gender || null });
    if (installedOnly === "true") voices = voices.filter((v) => v.installed);
    res.json({ voices, count: voices.length });
  }));

  // ---- download a voice on demand -------------------------------------
  r.post("/voices/:key/install", guard, wrap(async (req, res) => {
    const key = String(req.params.key).replace(/[^\w.\-]/g, "");
    const meta = listVoices().find((v) => v.key === key);
    if (!meta) return res.status(404).json({ error: "unknown voice" });
    if (meta.installed) return res.json({ key, installed: true, already: true });

    // en_US-amy-medium -> en/en_US/amy/medium/en_US-amy-medium
    const m = key.match(/^([a-z]{2}_[A-Z]{2})-(.+)-(low|medium|high)$/);
    if (!m) return res.status(400).json({ error: `cannot derive path for ${key}` });
    const [, lang, speaker, quality] = m;
    const rel = `${lang.slice(0, 2)}/${lang}/${speaker}/${quality}/${key}`;

    fs.mkdirSync(VOICE_DIR, { recursive: true });
    for (const ext of [".onnx", ".onnx.json"]) {
      const url = `${HF_BASE}/${rel}${ext}`;
      const out = path.join(VOICE_DIR, `${key}${ext}`);
      await execFileAsync("curl", ["-sL", "--fail", "-o", out, url], { maxBuffer: 1 << 26 });
    }
    res.json({ key, installed: true });
  }));

  // ---- synthesize a preview clip --------------------------------------
  r.post("/preview", guard, wrap(async (req, res) => {
    const cfg = readConfig();
    const voice = String(req.body.voice || cfg.local.piperVoice).replace(/[^\w.\-]/g, "");
    const text = String(req.body.text || "").trim().slice(0, 400)
      || "Good afternoon! Thank you for calling. How can I help you today?";
    const model = path.join(VOICE_DIR, `${voice}.onnx`);
    if (!fs.existsSync(model)) {
      return res.status(400).json({ error: `voice not installed: ${voice}` });
    }

    const out = path.join(PREVIEW_DIR, `${voice}-${Date.now()}.wav`);
    const args = ["-m", model, "-f", out];
    if (req.body.speakerId !== undefined && req.body.speakerId !== null && req.body.speakerId !== "") {
      args.push("-s", String(Number(req.body.speakerId)));
    }
    const ls = Number(req.body.lengthScale ?? cfg.local.piperLengthScale);
    const ns = Number(req.body.noiseScale ?? cfg.local.piperNoiseScale);
    if (Number.isFinite(ls)) args.push("--length-scale", String(ls));
    if (Number.isFinite(ns)) args.push("--noise-scale", String(ns));

    const t0 = Date.now();
    await new Promise((resolve, reject) => {
      const p = spawn(PIPER_BIN, args, { stdio: ["pipe", "ignore", "pipe"] });
      let err = "";
      p.stderr.on("data", (d) => { err += d; });
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(0, 300)))));
      p.on("error", reject);
      p.stdin.write(text); p.stdin.end();
    });

    // Prune old previews so this directory does not grow forever.
    const files = fs.readdirSync(PREVIEW_DIR).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 40))) {
      try { fs.unlinkSync(path.join(PREVIEW_DIR, f)); } catch {}
    }

    res.json({ voice, text, ms: Date.now() - t0, url: `/api/pitch-admin/preview/${path.basename(out)}` });
  }));

  r.get("/preview/:file", guard, (req, res) => {
    const f = path.join(PREVIEW_DIR, path.basename(req.params.file));
    if (!fs.existsSync(f)) return res.sendStatus(404);
    res.type("audio/wav").sendFile(f);
  });

  // ---- save settings ---------------------------------------------------
  r.put("/config", guard, wrap(async (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.pipeline === "gemini-live" || b.pipeline === "local") patch.pipeline = b.pipeline;
    if (typeof b.bargeInEnabled === "boolean") patch.bargeInEnabled = b.bargeInEnabled;
    if (b.geminiLive && typeof b.geminiLive === "object" && b.geminiLive.voice) {
      const v = String(b.geminiLive.voice);
      if (GEMINI_VOICES.some((g) => g.name === v)) patch.geminiLive = { voice: v };
    }
    if (b.local && typeof b.local === "object") {
      patch.local = {};
      const L = b.local;
      if (L.ttsEngine) patch.local.ttsEngine = String(L.ttsEngine);
      if (L.piperVoice) patch.local.piperVoice = String(L.piperVoice).replace(/[^\w.\-]/g, "");
      if (L.whisperModel) patch.local.whisperModel = String(L.whisperModel).replace(/[^\w.\-]/g, "");
      if (L.whisperLanguage) patch.local.whisperLanguage = String(L.whisperLanguage).slice(0, 8);
      if (L.piperSpeakerId !== undefined) {
        patch.local.piperSpeakerId = L.piperSpeakerId === null || L.piperSpeakerId === ""
          ? null : Number(L.piperSpeakerId);
      }
      for (const k of ["piperLengthScale", "piperNoiseScale"]) {
        if (L[k] !== undefined && Number.isFinite(Number(L[k]))) patch.local[k] = Number(L[k]);
      }
    }
    res.json({ config: writeConfig(patch), saved: true });
  }));

  // ---- restart the voice services --------------------------------------
  r.post("/restart", guard, wrap(async (req, res) => {
    const script = path.join(REPO_ROOT, "local-runtime", "bin", "restart-voice-stack.sh");
    if (!fs.existsSync(script)) {
      return res.status(500).json({ error: "restart-voice-stack.sh not found" });
    }
    const child = spawn("bash", [script], {
      detached: true, stdio: "ignore", cwd: REPO_ROOT,
    });
    child.unref();
    res.json({ restarting: true, note: "services take ~30s to come back" });
  }));

  promptRoutes(r, guard);
  return r;
}

module.exports = { buildRouter };

// ---------------------------------------------------------------------------
// Pitch prompt revisions — same store and versioning as Closer, different key.
//
// PromptRevision is keyed, so "pitch_system" lives alongside "closer_system"
// with no schema change. Pitch and Closer share NO prompt text: one answers a
// phone, the other types in Messenger, and conflating them would make both
// worse.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Pitch prompt revisions — one COMPLETE prompt per pipeline, both editable.
//
// Nothing about the prompt lives in code any more. src/pitch/prompt.js only
// seeds these rows on first run and serves as a fallback if the database is
// unreachable mid-call. AI Studio is the source of truth.
// ---------------------------------------------------------------------------
function promptRoutes(r, guard) {
  const {
    PROMPT_KEYS, buildSeed, fillVariables, ensurePitchPrompts, clearPitchPromptCache,
  } = require("../pitch/prompt");
  const { PrismaClient } = require("@prisma/client");
  if (!global.__pitchPrisma) global.__pitchPrisma = new PrismaClient();
  const prisma = global.__pitchPrisma;

  const keyFor = (p) => PROMPT_KEYS[p] || PROMPT_KEYS["gemini-live"];

  r.get("/prompt", guard, wrap(async (req, res) => {
    await ensurePitchPrompts();
    const pipeline = req.query.pipeline || readConfig().pipeline;
    const key = keyFor(pipeline);
    const revisions = await prisma.promptRevision.findMany({
      where: { key }, orderBy: { version: "desc" },
    });
    const active = revisions.find((x) => x.is_active) || revisions[0] || null;
    res.json({
      pipeline, key, active,
      revisions: revisions.map((x) => ({
        id: x.id, version: x.version, note: x.note, created_by: x.created_by,
        is_active: x.is_active, created_at: x.created_at,
        chars: x.content.length, content: x.content,
      })),
    });
  }));

  r.post("/prompt", guard, wrap(async (req, res) => {
    const key = keyFor(req.body.pipeline || readConfig().pipeline);
    const content = String(req.body.content || "");
    if (content.length < 20) return res.status(400).json({ error: "content too short" });
    const top = await prisma.promptRevision.findFirst({
      where: { key }, orderBy: { version: "desc" },
    });
    const version = (top ? top.version : 0) + 1;
    await prisma.promptRevision.updateMany({ where: { key }, data: { is_active: false } });
    await prisma.promptRevision.create({
      data: {
        key, version, content, is_active: true,
        note: String(req.body.note || "").slice(0, 300) || null,
        created_by: (req.user && req.user.email) || "admin",
      },
    });
    clearPitchPromptCache();
    res.json({ ok: true, version, key });
  }));

  r.post("/prompt/activate", guard, wrap(async (req, res) => {
    const key = keyFor(req.body.pipeline || readConfig().pipeline);
    const version = Number(req.body.version);
    const target = await prisma.promptRevision.findFirst({ where: { key, version } });
    if (!target) return res.status(404).json({ error: "no such version" });
    await prisma.promptRevision.updateMany({ where: { key }, data: { is_active: false } });
    await prisma.promptRevision.update({ where: { id: target.id }, data: { is_active: true } });
    clearPitchPromptCache();
    res.json({ ok: true, version, key });
  }));

  // Exactly what goes to the model, with the runtime variables filled in.
  r.get("/prompt/preview", guard, wrap(async (req, res) => {
    await ensurePitchPrompts();
    const pipeline = req.query.pipeline || readConfig().pipeline;
    const key = keyFor(pipeline);
    const row = await prisma.promptRevision.findFirst({
      where: { key, is_active: true }, orderBy: { version: "desc" },
    });
    const text = row ? row.content
      : buildSeed({ pipeline, smsEnabled: pipeline !== "local" });
    res.json({
      pipeline, key,
      content: fillVariables(text, {
        businessName: process.env.PITCH_BUSINESS_NAME || "your business",
        agentName: process.env.PITCH_AGENT_NAME || "Pitch",
        callerId: "+639171234567",
      }),
    });
  }));

  // Put the code seed back, for when an edit goes wrong.
  r.post("/prompt/reset", guard, wrap(async (req, res) => {
    const pipeline = req.body.pipeline || readConfig().pipeline;
    const key = keyFor(pipeline);
    const top = await prisma.promptRevision.findFirst({
      where: { key }, orderBy: { version: "desc" },
    });
    const version = (top ? top.version : 0) + 1;
    await prisma.promptRevision.updateMany({ where: { key }, data: { is_active: false } });
    await prisma.promptRevision.create({
      data: {
        key, version, is_active: true,
        content: buildSeed({ pipeline, smsEnabled: pipeline !== "local" }),
        note: "Reset to the built-in default",
        created_by: (req.user && req.user.email) || "admin",
      },
    });
    clearPitchPromptCache();
    res.json({ ok: true, version, key });
  }));
}
