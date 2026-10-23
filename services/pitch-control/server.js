"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..", "..");
const { readConfig, writeConfig, CONFIG_PATH } = require(path.join(ROOT, "src", "pitch", "runtime-config"));

const HOST = process.env.PITCH_CONTROL_HOST || "0.0.0.0";
const PORT = numberFromEnv("PITCH_CONTROL_PORT", 5198);
const TOKEN = String(process.env.PITCH_CONTROL_TOKEN || "");
const ALLOWED_IPS = new Set(String(process.env.PITCH_CONTROL_ALLOWED_IPS || "127.0.0.1,::1,192.168.254.125,::ffff:192.168.254.125")
  .split(",").map((value) => value.trim()).filter(Boolean));
const BODY_LIMIT = 256 * 1024;
const PIPER_ROOT = process.env.PITCH_CONTROL_PIPER_ROOT || "/home/ai-server/projects/piper-serve";
const PIPER_VOICE_DIRS = [
  path.join(PIPER_ROOT, "voices"),
  path.join(ROOT, "local-runtime", "piper", "voices"),
];
const PIPER_BIN = process.env.PITCH_CONTROL_PIPER_BIN || path.join(PIPER_ROOT, "venv", "bin", "piper");
const RESTART_SCRIPT = path.join(ROOT, "scripts", "restart-pitch-stack.sh");
const PREVIEW_DIR = path.join(ROOT, "local-runtime", "pitch-control-previews");

if (TOKEN.length < 32) {
  throw new Error("PITCH_CONTROL_TOKEN must contain at least 32 characters");
}

fs.mkdirSync(PREVIEW_DIR, { recursive: true, mode: 0o700 });

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function json(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(payload);
}

function clientIp(req) {
  return String(req.socket.remoteAddress || "");
}

function authorized(req) {
  if (!ALLOWED_IPS.has(clientIp(req))) return false;
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = Buffer.from(TOKEN);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw httpError(413, "request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "invalid JSON body");
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function ensureObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw httpError(400, `${label} must be an object`);
  return value;
}

function rejectUnknown(object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw httpError(400, `${label}.${key} is not an allowed setting`);
  }
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw httpError(400, `${label} must be one of: ${allowed.join(", ")}`);
  return value;
}

function stringValue(value, label, { min = 0, max = 500, pattern = null } = {}) {
  if (typeof value !== "string") throw httpError(400, `${label} must be text`);
  const clean = value.trim();
  if (clean.length < min || clean.length > max) throw httpError(400, `${label} must be ${min}-${max} characters`);
  if (pattern && !pattern.test(clean)) throw httpError(400, `${label} contains unsupported characters`);
  return clean;
}

function numberValue(value, label, min, max, integer = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw httpError(400, `${label} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}`);
  }
  return number;
}

function loopbackUrl(value, label) {
  let parsed;
  try { parsed = new URL(String(value)); } catch { throw httpError(400, `${label} must be a valid URL`); }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw httpError(400, `${label} must use a loopback HTTP address`);
  }
  return parsed.toString();
}

function piperVoices() {
  const byKey = new Map();
  for (const directory of PIPER_VOICE_DIRS) {
    let names = [];
    try { names = fs.readdirSync(directory); } catch { continue; }
    for (const name of names.filter((item) => item.endsWith(".onnx"))) {
      const key = name.slice(0, -5);
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          name: key.replace(/_/g, " "),
          engine: "piper",
          modelPath: path.join(directory, name),
          installed: true,
        });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function validatePatch(input) {
  const body = ensureObject(input, "config");
  rejectUnknown(body, ["pipeline", "bargeInEnabled", "business", "geminiLive", "openaiRealtime", "local"], "config");
  const patch = {};

  if (body.pipeline !== undefined) patch.pipeline = enumValue(body.pipeline, ["gemini-live", "openai-realtime", "local"], "pipeline");
  if (body.bargeInEnabled !== undefined) {
    if (typeof body.bargeInEnabled !== "boolean") throw httpError(400, "bargeInEnabled must be true or false");
    patch.bargeInEnabled = body.bargeInEnabled;
  }
  if (body.business !== undefined) {
    const value = ensureObject(body.business, "business");
    rejectUnknown(value, ["name", "agentName"], "business");
    patch.business = {};
    if (value.name !== undefined) patch.business.name = stringValue(value.name, "business.name", { min: 1, max: 100 });
    if (value.agentName !== undefined) patch.business.agentName = stringValue(value.agentName, "business.agentName", { min: 1, max: 60 });
  }
  for (const section of ["geminiLive", "openaiRealtime"]) {
    if (body[section] === undefined) continue;
    const value = ensureObject(body[section], section);
    rejectUnknown(value, ["model", "voice"], section);
    patch[section] = {};
    if (value.model !== undefined) patch[section].model = stringValue(value.model, `${section}.model`, { min: 1, max: 120, pattern: /^[\w.:-]+$/ });
    if (value.voice !== undefined) patch[section].voice = stringValue(value.voice, `${section}.voice`, { min: 1, max: 80, pattern: /^[\w.:-]+$/ });
  }

  if (body.local !== undefined) {
    const value = ensureObject(body.local, "local");
    const allowed = [
      "brainProvider", "asrUrl", "asrContext", "whisperModel", "whisperLanguage",
      "qwenApiUrl", "qwenModel", "ttsEngine", "piperUrl", "piperVoice", "piperSpeakerId",
      "piperLengthScale", "piperNoiseScale", "piperVolumeDb", "greetingText", "greetingStartDelayMs",
      "maxOutputTokens", "temperature", "historyTurns", "requestTimeoutMs",
      "vadPositiveSpeechThreshold", "vadNegativeSpeechThreshold", "vadMinSpeechMsSilero",
      "vadPreSpeechPadMs", "vadRedemptionMs", "vadMaxSpeechMs", "vadBargeInThreshold",
      "vadBargeInSustainMs", "minUtteranceRmsDb", "kbMaxChars",
    ];
    rejectUnknown(value, allowed, "local");
    const local = {};
    if (value.brainProvider !== undefined) local.brainProvider = enumValue(value.brainProvider, ["qwen"], "local.brainProvider");
    if (value.asrUrl !== undefined) local.asrUrl = loopbackUrl(value.asrUrl, "local.asrUrl");
    if (value.asrContext !== undefined) local.asrContext = stringValue(value.asrContext, "local.asrContext", { max: 500 });
    if (value.whisperModel !== undefined) local.whisperModel = stringValue(value.whisperModel, "local.whisperModel", { min: 1, max: 120, pattern: /^[\w.:-]+$/ });
    if (value.whisperLanguage !== undefined) local.whisperLanguage = enumValue(value.whisperLanguage, ["taglish", "auto", "en", "tl"], "local.whisperLanguage");
    if (value.qwenApiUrl !== undefined) local.qwenApiUrl = loopbackUrl(value.qwenApiUrl, "local.qwenApiUrl");
    if (value.qwenModel !== undefined) local.qwenModel = stringValue(value.qwenModel, "local.qwenModel", { min: 1, max: 120, pattern: /^[\w.:-]+$/ });
    if (value.ttsEngine !== undefined) local.ttsEngine = enumValue(value.ttsEngine, ["piper"], "local.ttsEngine");
    if (value.piperUrl !== undefined) local.piperUrl = loopbackUrl(value.piperUrl, "local.piperUrl");
    if (value.piperVoice !== undefined) {
      const voice = stringValue(value.piperVoice, "local.piperVoice", { min: 1, max: 160, pattern: /^[\w.-]+$/ });
      if (!piperVoices().some((item) => item.key === voice)) throw httpError(400, `Piper model is not installed: ${voice}`);
      local.piperVoice = voice;
    }
    if (value.piperSpeakerId !== undefined) {
      local.piperSpeakerId = value.piperSpeakerId === null || value.piperSpeakerId === ""
        ? null : numberValue(value.piperSpeakerId, "local.piperSpeakerId", 0, 999, true);
    }
    const numeric = [
      ["piperLengthScale", 0.6, 1.6, false], ["piperNoiseScale", 0, 2, false],
      ["piperVolumeDb", -18, 6, false], ["greetingStartDelayMs", 0, 3000, true],
      ["maxOutputTokens", 40, 512, true], ["temperature", 0, 2, false],
      ["historyTurns", 2, 20, true], ["requestTimeoutMs", 1000, 120000, true],
      ["vadPositiveSpeechThreshold", 0.05, 0.99, false], ["vadNegativeSpeechThreshold", 0.01, 0.98, false],
      ["vadMinSpeechMsSilero", 32, 5000, true], ["vadPreSpeechPadMs", 0, 3000, true],
      ["vadRedemptionMs", 100, 10000, true], ["vadMaxSpeechMs", 1000, 60000, true],
      ["vadBargeInThreshold", 0.05, 0.99, false], ["vadBargeInSustainMs", 32, 2000, true],
      ["minUtteranceRmsDb", 0, 100, false], ["kbMaxChars", 0, 60000, true],
    ];
    for (const [key, min, max, integer] of numeric) {
      if (value[key] !== undefined) local[key] = numberValue(value[key], `local.${key}`, min, max, integer);
    }
    if (value.greetingText !== undefined) local.greetingText = stringValue(value.greetingText, "local.greetingText", { min: 1, max: 500 });
    const merged = { ...(readConfig().local || {}), ...local };
    if (Number(merged.vadNegativeSpeechThreshold) >= Number(merged.vadPositiveSpeechThreshold)) {
      throw httpError(400, "VAD negative threshold must be lower than the positive threshold");
    }
    patch.local = local;
  }
  return patch;
}

async function probe(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { up: response.status < 500, status: response.status };
  } catch (error) {
    return { up: false, error: error.name === "AbortError" ? "timeout" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function pitchPid() {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", "node src/pitch/index.js"]);
    const pid = Number(String(stdout).trim().split("\n")[0]);
    return Number.isFinite(pid) ? pid : null;
  } catch { return null; }
}

async function serviceState() {
  const config = readConfig();
  const local = config.local || {};
  const [pid, asr, llm, piper] = await Promise.all([
    pitchPid(),
    probe(new URL("/health", local.asrUrl || "http://127.0.0.1:8190").toString()),
    probe(new URL("/health", local.qwenApiUrl || "http://127.0.0.1:8090").toString()),
    probe(new URL("/", local.piperUrl || "http://127.0.0.1:5001").toString()),
  ]);
  return {
    ok: true,
    host: require("os").hostname(),
    config,
    configPath: CONFIG_PATH,
    services: {
      pitch: { up: Boolean(pid), pid },
      asr: { ...asr, label: "Qwen3-ASR", port: 8190 },
      llm: { ...llm, label: "SEA-LION", port: 8090 },
      piper: { ...piper, label: "Piper", port: 5001 },
    },
    options: {
      asrModels: [{ value: "Qwen3-ASR-0.6B", label: "Qwen3-ASR 0.6B" }],
      asrLanguages: [
        { value: "taglish", label: "Taglish comparison" },
        { value: "auto", label: "Automatic" },
        { value: "en", label: "English" },
        { value: "tl", label: "Filipino" },
      ],
      llmModels: [{ provider: "qwen", value: "sealion", label: "Gemma SEA-LION v4.5 E2B Q8" }],
      ttsEngines: [{ value: "piper", label: "Piper" }],
      piperVoices: piperVoices().map(({ modelPath, ...voice }) => voice),
    },
  };
}

async function synthesizePreview(body) {
  const config = readConfig();
  const local = config.local || {};
  const text = stringValue(body.text || local.greetingText || "Hello, how can I help you today?", "text", { min: 1, max: 400 });
  const voice = body.voice === undefined ? local.piperVoice : body.voice;
  const selected = piperVoices().find((item) => item.key === voice);
  if (!selected) throw httpError(400, `Piper model is not installed: ${voice}`);
  const lengthScale = numberValue(body.lengthScale ?? local.piperLengthScale ?? 1, "lengthScale", 0.6, 1.6);
  const noiseScale = numberValue(body.noiseScale ?? local.piperNoiseScale ?? 0.667, "noiseScale", 0, 2);
  const volumeDb = numberValue(body.volumeDb ?? local.piperVolumeDb ?? 0, "volumeDb", -18, 6);
  const speakerId = body.speakerId ?? local.piperSpeakerId;
  if (speakerId !== null && speakerId !== undefined && speakerId !== "") numberValue(speakerId, "speakerId", 0, 999, true);

  const stamp = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const rawPath = path.join(PREVIEW_DIR, `${stamp}-raw.wav`);
  const outputPath = path.join(PREVIEW_DIR, `${stamp}.wav`);
  const args = ["-m", selected.modelPath, "-f", rawPath, "--length-scale", String(lengthScale), "--noise-scale", String(noiseScale)];
  if (speakerId !== null && speakerId !== undefined && speakerId !== "") args.push("-s", String(Number(speakerId)));
  const started = Date.now();
  await new Promise((resolve, reject) => {
    const child = spawn(PIPER_BIN, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Piper preview failed: ${stderr.slice(0, 300)}`)));
    child.stdin.end(`${text}\n`);
  });
  if (volumeDb === 0) fs.renameSync(rawPath, outputPath);
  else {
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", rawPath, "-filter:a", `volume=${volumeDb}dB`, outputPath]);
    fs.unlinkSync(rawPath);
  }
  for (const name of fs.readdirSync(PREVIEW_DIR).sort().slice(0, -30)) {
    try { fs.unlinkSync(path.join(PREVIEW_DIR, name)); } catch {}
  }
  return { outputPath, text, voice, elapsedMs: Date.now() - started, volumeDb, lengthScale, noiseScale };
}

async function restartStack() {
  if (!fs.existsSync(RESTART_SCRIPT)) throw httpError(500, "approved Pitch restart script is missing");
  const child = spawn("bash", [RESTART_SCRIPT], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return child.pid;
}

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", requestId);
  try {
    if (!authorized(req)) return json(res, 401, { error: "unauthorized", requestId });
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, service: "aistaff-pitch-control", host: require("os").hostname() });
    }
    if (req.method === "GET" && url.pathname === "/v1/state") return json(res, 200, await serviceState());
    if (req.method === "PUT" && url.pathname === "/v1/config") {
      const body = await readJson(req);
      const config = writeConfig(validatePatch(body.config || body));
      return json(res, 200, { ok: true, saved: true, config });
    }
    if (req.method === "POST" && url.pathname === "/v1/preview") {
      const result = await synthesizePreview(await readJson(req));
      const stat = fs.statSync(result.outputPath);
      res.writeHead(200, {
        "Content-Type": "audio/wav",
        "Content-Length": stat.size,
        "Cache-Control": "no-store",
        "X-Preview-Ms": String(result.elapsedMs),
        "X-Piper-Voice": result.voice,
        "X-Piper-Volume-Db": String(result.volumeDb),
        "X-Content-Type-Options": "nosniff",
      });
      return fs.createReadStream(result.outputPath).pipe(res);
    }
    if (req.method === "POST" && url.pathname === "/v1/restart") {
      const pid = await restartStack();
      return json(res, 202, { ok: true, restarting: true, supervisorPid: pid, note: "Pitch stack restart requested" });
    }
    return json(res, 404, { error: "not found", requestId });
  } catch (error) {
    console.error(JSON.stringify({ requestId, method: req.method, url: req.url, error: error.stack || error.message }));
    return json(res, error.status || 500, { error: error.status ? error.message : "internal error", requestId });
  }
});

server.requestTimeout = 120000;
server.headersTimeout = 10000;
server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ event: "pitch-control-listening", host: HOST, port: PORT, allowedIps: [...ALLOWED_IPS] }));
});

