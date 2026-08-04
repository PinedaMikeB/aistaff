// Real video-teaser generation (PART 11/12) via the Remotion pipeline this
// codebase already uses for its marketing ad videos (src/marketing.js,
// remotion/). This module renders an ACTUAL short MP4 using a new
// parameterized composition (remotion/src/compositions/ProductTeaser.tsx)
// — it does not fabricate a fake "teaser" when a real render can't happen.
//
// Capability probe: Remotion's renderer needs a platform-matched native
// compositor binary (e.g. @remotion/compositor-darwin-arm64). If the
// installed binary doesn't match the current OS/arch (or Remotion isn't
// installed at all), rendering will fail immediately — this module detects
// that UP FRONT and reports `available: false` with a clear reason instead
// of spawning a render that's certain to fail, per PART 12: "If the video
// provider is not configured or generation fails, do not fabricate a
// generated teaser. Show a clear safe error and preserve the project."

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const rootDir = path.join(__dirname, "..", "..");
const remotionDir = path.join(rootDir, "remotion");
const outDir = path.join(remotionDir, "out", "product-teasers");
const tmpAssetsDir = path.join(remotionDir, "tmp-product-assets");

const RENDER_TIMEOUT_MS = Number(process.env.BRANDEE_VIDEO_RENDER_TIMEOUT_MS || 60000);
const PREVIEW_DURATION_SECONDS = 3;

function remotionBin() {
  return path.join(remotionDir, "node_modules", ".bin", "remotion");
}

function compositorAvailableForThisPlatform() {
  const remotionPkgDir = path.join(remotionDir, "node_modules", "@remotion");
  if (!fs.existsSync(remotionPkgDir)) return false;
  const prefix = `compositor-${process.platform}-${process.arch}`;
  try {
    return fs.readdirSync(remotionPkgDir).some((name) => name.startsWith(prefix));
  } catch {
    return false;
  }
}

/**
 * Cheap, synchronous-ish capability check — does not spawn a process. Used
 * both to decide whether to attempt a render and to show an honest
 * "video preview isn't available right now" state in the UI ahead of time.
 */
function probeVideoProviderAvailability() {
  if (!fs.existsSync(remotionBin())) {
    return { available: false, reason: "remotion_not_installed" };
  }
  if (!compositorAvailableForThisPlatform()) {
    return { available: false, reason: "compositor_binary_platform_mismatch" };
  }
  return { available: true, reason: null };
}

function ensureDirs() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(tmpAssetsDir, { recursive: true });
}

function writeDataUrlToTempFile(dataUrl, filePrefix) {
  const match = String(dataUrl || "").match(/^data:image\/([a-z]+);base64,(.+)$/i);
  if (!match) return null;
  const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  const filePath = path.join(tmpAssetsDir, `${filePrefix}.${ext}`);
  fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
  return filePath;
}

function runRemotionRender({ compositionId, outputPath, props, timeoutMs }) {
  return new Promise((resolve) => {
    const args = ["render", "src/index.ts", compositionId, outputPath, `--props=${JSON.stringify(props)}`, "--log=error"];
    const child = spawn(remotionBin(), args, { cwd: remotionDir, env: { ...process.env, REMOTION_BROWSER_TIMEOUT: String(timeoutMs) } });

    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, reason: "render_timeout" });
    }, timeoutMs);

    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: "spawn_failed", detail: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, reason: "render_failed", detail: stderr.slice(-2000) });
      }
    });
  });
}

/**
 * Shared render path for both the free 3-second preview and the paid full
 * video — same composition, different `watermark`/`durationInSeconds`.
 * Returns { ok: true, relativeUrl, durationSeconds } on a genuine
 * successful render, or { ok: false, reason } if the provider is
 * unavailable or the render fails/times out — never a fabricated
 * placeholder video.
 */
async function renderProductVideo({ projectId, styleId, hookText, headline, ctaText, productImageDataUrl, brandColor, watermark, durationSeconds, filePrefix }) {
  const capability = probeVideoProviderAvailability();
  if (!capability.available) {
    return { ok: false, reason: capability.reason, message: "Brandee's video generation isn't available right now. Your project has been saved — try again shortly." };
  }

  ensureDirs();
  const jobId = crypto.randomUUID();
  let productImagePath = null;
  try {
    productImagePath = productImageDataUrl ? writeDataUrlToTempFile(productImageDataUrl, `${jobId}-product`) : null;
  } catch {
    productImagePath = null;
  }

  const outputFile = `${filePrefix}-${projectId}-${jobId}.mp4`;
  const outputPath = path.join(outDir, outputFile);

  const props = {
    styleId,
    hookText: hookText || headline || "",
    headline: headline || "",
    ctaText: ctaText || "Learn more",
    productImagePath: productImagePath || "",
    brandColor: brandColor || "#0f172a",
    watermark,
    durationInSeconds: durationSeconds
  };

  const result = await runRemotionRender({ compositionId: "ProductTeaser", outputPath, props, timeoutMs: RENDER_TIMEOUT_MS });

  if (productImagePath) {
    try { fs.unlinkSync(productImagePath); } catch { /* best-effort cleanup */ }
  }

  if (!result.ok) {
    return { ok: false, reason: result.reason, detail: result.detail, message: "Brandee could not generate the video this time. Your project has been saved — try again shortly." };
  }

  return { ok: true, relativeUrl: `/marketing-assets/product-teasers/${outputFile}`, outputPath, durationSeconds, watermarked: watermark };
}

/** Free-preview entry point: always 3 seconds, always watermarked. */
async function generateVideoTeaser(args) {
  return renderProductVideo({ ...args, watermark: true, durationSeconds: PREVIEW_DURATION_SECONDS, filePrefix: "teaser" });
}

/** Paid full-video entry point: no watermark, plan-defined duration. */
async function generateFinalVideo(args) {
  return renderProductVideo({ ...args, watermark: false, durationSeconds: args.durationSeconds || 15, filePrefix: "final" });
}

module.exports = { probeVideoProviderAvailability, generateVideoTeaser, generateFinalVideo, PREVIEW_DURATION_SECONDS };
