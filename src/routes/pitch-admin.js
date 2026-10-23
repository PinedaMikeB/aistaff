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
const PIPER_ROOT = process.env.PITCH_PIPER_ROOT || "/home/ai-server/projects/piper-serve";
const PIPER_BIN = path.join(PIPER_ROOT, "venv", "bin", "piper");
const PIPER_EXTERNAL_VOICES = path.join(PIPER_ROOT, "voices");
const WHISPER_MODELS = path.join(REPO_ROOT, "local-runtime", "whisper.cpp", "models");
const PREVIEW_DIR = path.join(REPO_ROOT, "local-runtime", "piper", "previews");

const QWEN_ASR_HEALTH = "http://127.0.0.1:8190/health";
const SEA_LION_HEALTH = "http://127.0.0.1:8090/health";
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

const GEMINI_LIVE_MODELS = [
  { model: "gemini-3.1-flash-live-preview", label: "Gemini 3.1 Flash Live" },
  { model: "gemini-2.5-flash-native-audio-preview-09-2025", label: "Gemini 2.5 Flash Native Audio" },
];

const OPENAI_REALTIME_MODELS = [
  { model: "gpt-realtime", label: "GPT Realtime" },
];

const OPENAI_FALLBACK_MODELS = [
  { model: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { model: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { model: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { model: "gpt-5-mini", label: "GPT-5 mini" },
  { model: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { model: "gpt-realtime", label: "GPT Realtime" },
];

const LOCAL_TEXT_MODELS = {
  qwen: [
    { model: "sealion", label: "SEA-LION (local)" },
  ],
  gemini: [
    { model: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
    { model: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
    { model: "gemini-3-flash", label: "Gemini 3 Flash" },
    { model: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
  ],
  openai: OPENAI_FALLBACK_MODELS,
};

function safeModel(value) {
  return String(value || "").trim().replace(/[^\w.\-:]/g, "").slice(0, 120);
}

function safeText(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function safeUrl(value) {
  const text = safeText(value, 300);
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch { return ""; }
}

function finiteIn(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

let openAiModelCache = { expiresAt: 0, models: null, error: null };

function labelOpenAiModel(id) {
  return String(id || "")
    .replace(/^gpt-/, "GPT-")
    .replace(/-/g, " ")
    .replace(/\bmini\b/i, "mini")
    .replace(/\bnano\b/i, "nano")
    .replace(/\brealtime\b/i, "Realtime")
    .replace(/\bluna\b/i, "Luna")
    .replace(/\bterra\b/i, "Terra")
    .replace(/\bsol\b/i, "Sol");
}

function sortOpenAiModels(models) {
  const rank = (id) => {
    const s = String(id || "");
    if (/^gpt-5\.6/.test(s)) return 0;
    if (/^gpt-5/.test(s)) return 1;
    if (/^gpt-4\.1/.test(s)) return 2;
    if (/realtime/.test(s)) return 3;
    if (/^gpt/.test(s)) return 4;
    return 5;
  };
  return [...models].sort((a, b) => rank(a.model) - rank(b.model) || a.model.localeCompare(b.model));
}

async function openAiModels() {
  const now = Date.now();
  if (openAiModelCache.models && openAiModelCache.expiresAt > now) return openAiModelCache;
  if (!process.env.OPENAI_API_KEY) {
    openAiModelCache = {
      expiresAt: now + 60_000,
      models: OPENAI_FALLBACK_MODELS,
      error: "OPENAI_API_KEY is not set",
    };
    return openAiModelCache;
  }

  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || `OpenAI models failed with HTTP ${res.status}`);
    }
    const seen = new Set();
    const models = sortOpenAiModels((data.data || [])
      .map((m) => safeModel(m.id))
      .filter(Boolean)
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((id) => ({ model: id, label: labelOpenAiModel(id) })));
    openAiModelCache = {
      expiresAt: now + 5 * 60_000,
      models: models.length ? models : OPENAI_FALLBACK_MODELS,
      error: null,
    };
  } catch (error) {
    openAiModelCache = {
      expiresAt: now + 60_000,
      models: OPENAI_FALLBACK_MODELS,
      error: error.message || String(error),
    };
  }
  return openAiModelCache;
}

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

function probeTcp(port, host = "127.0.0.1", ms = 1500) {
  return new Promise((resolve) => {
    const net = require("net");
    const socket = net.createConnection({ port, host });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(ms);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function piperModelPath(voice) {
  const file = `${String(voice || "").replace(/[^\w.\-]/g, "")}.onnx`;
  const external = path.join(PIPER_EXTERNAL_VOICES, file);
  if (fs.existsSync(external)) return external;
  const local = path.join(VOICE_DIR, file);
  return fs.existsSync(local) ? local : null;
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
    const m = last.match(/brain=([\w-]+)/);
    if (!m) return null;
    if (m[1] === "local") return "local";
    if (m[1] === "openai") return "openai-realtime";
    return "gemini-live";
  } catch { return null; }
}

function buildRouter({ requireAuth } = {}) {
  const r = express.Router();
  const guard = requireAuth || ((req, res, next) => next());
  r.use(express.json({ limit: "256kb" }));

  // ---- current state -------------------------------------------------
  r.get("/", guard, wrap(async (req, res) => {
    const [qwenAsrUp, seaLionUp, piperUp, pid, openaiModels] = await Promise.all([
      probe(QWEN_ASR_HEALTH), probe(SEA_LION_HEALTH), probeTcp(5001), pitchProcess(), openAiModels(),
    ]);
    res.json({
      config: readConfig(),
      configPath: CONFIG_PATH,
      services: { qwenAsr: qwenAsrUp, seaLion: seaLionUp, piper: piperUp, pitchPid: pid },
      runningPipeline: runningPipeline(),
      whisperModels: whisperModels(),
      languages: listLanguages(),
      geminiVoices: GEMINI_VOICES,
      pitchModels: {
        geminiLive: GEMINI_LIVE_MODELS,
        openaiRealtime: openaiModels.models,
        localText: {
          ...LOCAL_TEXT_MODELS,
          openai: openaiModels.models,
        },
      },
      modelFetch: {
        openai: {
          live: !openaiModels.error,
          error: openaiModels.error,
        },
      },
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
    const model = piperModelPath(voice);
    if (!model) {
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
    if (["gemini-live", "openai-realtime", "local"].includes(b.pipeline)) patch.pipeline = b.pipeline;
    if (typeof b.bargeInEnabled === "boolean") patch.bargeInEnabled = b.bargeInEnabled;
    if (b.geminiLive && typeof b.geminiLive === "object") {
      patch.geminiLive = {};
      if (b.geminiLive.voice) {
        const v = String(b.geminiLive.voice);
        if (GEMINI_VOICES.some((g) => g.name === v)) patch.geminiLive.voice = v;
      }
      if (b.geminiLive.model) patch.geminiLive.model = safeModel(b.geminiLive.model);
    }
    if (b.openaiRealtime && typeof b.openaiRealtime === "object") {
      patch.openaiRealtime = {};
      if (b.openaiRealtime.model) patch.openaiRealtime.model = safeModel(b.openaiRealtime.model);
      if (b.openaiRealtime.voice) patch.openaiRealtime.voice = safeModel(b.openaiRealtime.voice);
    }
    if (b.business && typeof b.business === "object") {
      patch.business = {};
      const name = safeText(b.business.name, 120);
      const agentName = safeText(b.business.agentName, 80);
      if (name) patch.business.name = name;
      if (agentName) patch.business.agentName = agentName;
    }
    if (b.local && typeof b.local === "object") {
      patch.local = {};
      const L = b.local;
      patch.local.brainProvider = "qwen";
      for (const k of ["asrUrl", "qwenApiUrl", "piperUrl"]) {
        const url = safeUrl(L[k]);
        if (url) patch.local[k] = url;
      }
      if (L.qwenModel !== undefined) {
        if (L.qwenModel !== "sealion") return res.status(400).json({ error: "local LLM is not available" });
        patch.local.qwenModel = "sealion";
      }
      if (typeof L.asrContext === "string") patch.local.asrContext = L.asrContext.trim().slice(0, 500);
      if (L.ttsEngine === "piper") patch.local.ttsEngine = "piper";
      if (L.piperVoice) {
        const voice = String(L.piperVoice).replace(/[^\w.\-]/g, "");
        if (!piperModelPath(voice)) return res.status(400).json({ error: `voice not installed: ${voice}` });
        patch.local.piperVoice = voice;
      }
      if (L.whisperModel !== undefined) {
        if (L.whisperModel !== "Qwen3-ASR-0.6B") return res.status(400).json({ error: "local STT model is not available" });
        patch.local.whisperModel = "Qwen3-ASR-0.6B";
      }
      if (["taglish", "auto", "en", "fil"].includes(L.whisperLanguage)) patch.local.whisperLanguage = L.whisperLanguage;
      if (typeof L.greetingText === "string") {
        const text = L.greetingText.trim().slice(0, 500);
        if (text) patch.local.greetingText = text;
      }
      if (L.piperSpeakerId !== undefined) {
        if (L.piperSpeakerId === null || L.piperSpeakerId === "") {
          patch.local.piperSpeakerId = null;
        } else {
          const speakerId = Number(L.piperSpeakerId);
          if (!Number.isInteger(speakerId) || speakerId < 0) {
            return res.status(400).json({ error: "speaker ID must be a non-negative integer" });
          }
          patch.local.piperSpeakerId = speakerId;
        }
      }
      const ranges = {
        piperLengthScale: [0.6, 1.6], piperNoiseScale: [0, 1.5], piperVolumeDb: [-12, 3],
        greetingStartDelayMs: [0, 3000], maxOutputTokens: [20, 500], temperature: [0, 2],
        historyTurns: [2, 30], requestTimeoutMs: [1000, 120000],
        vadPositiveSpeechThreshold: [0.1, 0.95], vadNegativeSpeechThreshold: [0.05, 0.9],
        vadMinSpeechMsSilero: [64, 2000], vadPreSpeechPadMs: [0, 3000], vadRedemptionMs: [100, 5000],
        vadMaxSpeechMs: [1000, 60000], vadBargeInThreshold: [0.1, 0.95], vadBargeInSustainMs: [32, 2000],
      };
      for (const [k, range] of Object.entries(ranges)) {
        if (L[k] === undefined) continue;
        const value = finiteIn(L[k], range[0], range[1]);
        if (value === undefined) {
          return res.status(400).json({ error: `${k} must be between ${range[0]} and ${range[1]}` });
        }
        patch.local[k] = value;
      }
      if (patch.local.vadPositiveSpeechThreshold <= patch.local.vadNegativeSpeechThreshold) {
        return res.status(400).json({ error: "speech start threshold must be higher than speech end threshold" });
      }
    }
    res.json({ config: writeConfig(patch), saved: true });
  }));

  // ---- restart the voice services --------------------------------------
  r.post("/restart", guard, wrap(async (req, res) => {
    const script = path.join(REPO_ROOT, "scripts", "restart-pitch-stack.sh");
    if (!fs.existsSync(script)) {
      return res.status(500).json({ error: "restart-pitch-stack.sh not found" });
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
    PROMPT_KEYS, buildSeed, normalizePromptForPipeline, fillVariables, ensurePitchPrompts, clearPitchPromptCache,
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
    const activeRow = revisions.find((x) => x.is_active) || revisions[0] || null;
    const viewRevision = (x) => ({
      id: x.id, version: x.version, note: x.note, created_by: x.created_by,
      is_active: x.is_active, created_at: x.created_at,
      chars: x.content.length,
      content: normalizePromptForPipeline(x.content, pipeline),
    });
    res.json({
      pipeline, key,
      active: activeRow ? viewRevision(activeRow) : null,
      revisions: revisions.map(viewRevision),
    });
  }));

  r.post("/prompt", guard, wrap(async (req, res) => {
    const pipeline = req.body.pipeline || readConfig().pipeline;
    const key = keyFor(pipeline);
    const content = normalizePromptForPipeline(String(req.body.content || ""), pipeline);
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
    const runtime = readConfig();
    const key = keyFor(pipeline);
    const row = await prisma.promptRevision.findFirst({
      where: { key, is_active: true }, orderBy: { version: "desc" },
    });
    const text = normalizePromptForPipeline(
      row ? row.content : buildSeed({ pipeline, smsEnabled: pipeline !== "local" }),
      pipeline
    );
    let content = fillVariables(text, {
        businessName: safeText(req.query.businessName, 120)
          || runtime.business?.name || process.env.PITCH_BUSINESS_NAME || "your business",
        agentName: safeText(req.query.agentName, 80)
          || runtime.business?.agentName || process.env.PITCH_AGENT_NAME || "Pitch",
        callerId: safeText(req.query.callerNumber, 40) || "+639171234567",
      });
    if (pipeline === "local") {
      const { buildPiperLanguageGuidance } = require("../pitch/voice-language");
      content = `${content}\n\n${buildPiperLanguageGuidance(runtime.local?.piperVoice)}`;
    }
    res.json({ pipeline, key, content });
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
