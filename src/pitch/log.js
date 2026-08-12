"use strict";

const { config } = require("./config");

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function emit(level, msg) {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} [pitch:${level}] ${msg}`;
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

const log = {
  debug: (m) => emit("debug", m),
  info: (m) => emit("info", m),
  warn: (m) => emit("warn", m),
  error: (m) => emit("error", m),
};

module.exports = { log };
