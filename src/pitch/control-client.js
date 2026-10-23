"use strict";

const BASE_URL = String(process.env.PITCH_CONTROL_URL || "").replace(/\/+$/, "");
const TOKEN = String(process.env.PITCH_CONTROL_TOKEN || "");

function enabled() {
  return Boolean(BASE_URL && TOKEN);
}

async function request(path, { method = "GET", body, timeoutMs = 10000, raw = false } = {}) {
  if (!enabled()) throw new Error("Pitch control service is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (raw && response.ok) {
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") || "application/octet-stream",
        headers: response.headers,
      };
    }
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || `HTTP ${response.status}` }; }
    if (!response.ok) throw new Error(data.error || `Pitch control failed with HTTP ${response.status}`);
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Pitch control service timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  enabled,
  getState: () => request("/v1/state"),
  saveConfig: (config) => request("/v1/config", { method: "PUT", body: { config } }),
  preview: (options) => request("/v1/preview", { method: "POST", body: options, timeoutMs: 120000, raw: true }),
  restart: () => request("/v1/restart", { method: "POST", timeoutMs: 10000 }),
};
