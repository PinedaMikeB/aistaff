const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.join(__dirname, "..");
const remotionDir = path.join(rootDir, "remotion");
const outDir = path.join(remotionDir, "out");
const statePath = path.join(rootDir, "data", "marketing-state.json");

const LAUNCH_CHECKLIST = [
  { id: "landing-live", group: "Launch", label: "Landing page live at aistaff.click", href: "/" },
  { id: "audit-form", group: "Launch", label: "Audit form saves leads to admin dashboard", href: "/admin/leads" },
  { id: "messenger-bot", group: "Launch", label: "AIStaff Messenger bot replies with gated pricing", href: "/admin/conversations" },
  { id: "ad-creatives", group: "Ads", label: "Taglish ad videos reviewed and exported", href: "/admin/marketing/ads" },
  { id: "ad-copy", group: "Ads", label: "Facebook ad copy pasted into Ads Manager", href: "/admin/marketing/ads" },
  { id: "ads-launched", group: "Ads", label: "Facebook ads launched (₱300–500/day test budget)", href: null },
  { id: "bot-reviewed", group: "Review", label: "Messenger bot responses reviewed for overpromising", href: "/admin/marketing/review" },
  { id: "audit-followup", group: "Review", label: "Audit leads contacted within 24 hours", href: "/admin/leads" },
  { id: "first-call", group: "Sales", label: "First sales call booked from ad or audit lead", href: "/admin/leads" }
];

const AD_CREATIVES = [
  {
    id: "AdLostSales-Feed",
    title: "Lost Sales — Feed",
    angle: "Late Facebook replies lose sales",
    format: "1080×1080 · 15s",
    language: "Taglish",
    outputFile: "ad-lost-sales-feed.mp4",
    previewFile: "preview-lost-sales-feed.png",
    previewFrame: 45,
    copy: {
      primary: "Maraming B2B business nawawalan ng inquiry sa Facebook dahil late ang reply.\n\nAIStaff magse-setup ng AI sa Facebook Page inbox ninyo para:\n✅ Sumagot agad\n✅ Magtanong ng qualifying details\n✅ I-save ang leads\n✅ Maghanda ng quotation draft bago i-approve ninyo\n\nBook a free inbox audit today.",
      headline: "Stop Losing Facebook Sales Leads",
      cta: "Learn More"
    }
  },
  {
    id: "AdLostSales-Feed-VO",
    title: "Lost Sales — Feed (Voiceover)",
    angle: "Late Facebook replies lose sales · Taglish AI voice",
    format: "1080×1080 · 15s · with VO",
    language: "Taglish + voiceover",
    outputFile: "ad-lost-sales-feed-vo.mp4",
    previewFile: "preview-lost-sales-feed-vo.png",
    previewFrame: 45,
    voiceoverFile: "voiceovers/ad-lost-sales-feed.mp3",
    copy: {
      primary: "🎙️ Taglish voiceover ad — same message as Lost Sales Feed, with AI narration.\n\nNawawala ang sales dahil late ang reply sa Facebook?\n\nAIStaff: instant Messenger replies, lead qualification, dashboard capture, quotation drafts with admin approval.\n\nBook a free inbox audit today.",
      headline: "Stop Losing Facebook Sales Leads",
      cta: "Learn More"
    }
  },
  {
    id: "AdLostSales-Story-VO",
    title: "Lost Sales — Story (Voiceover)",
    angle: "Late Facebook replies lose sales · Taglish AI voice",
    format: "1080×1920 · 15s · with VO",
    language: "Taglish + voiceover",
    outputFile: "ad-lost-sales-story-vo.mp4",
    previewFile: "preview-lost-sales-story-vo.png",
    previewFrame: 45,
    voiceoverFile: "voiceovers/ad-lost-sales-story.mp3",
    copy: {
      primary: "🎙️ Vertical voiceover ad for Stories/Reels.\n\nNawawala ang sales dahil late ang reply sa Facebook?\n\nBook your free inbox audit today — aistaff.click",
      headline: "AI Sales Assistant for Facebook Pages",
      cta: "Send Message"
    }
  },
  {
    id: "AdLostSales-Story",
    title: "Lost Sales — Story",
    angle: "Late Facebook replies lose sales",
    format: "1080×1920 · 15s",
    language: "Taglish",
    outputFile: "ad-lost-sales-story.mp4",
    previewFile: "preview-lost-sales-story.png",
    previewFrame: 45,
    copy: {
      primary: "Nawawala ang sales dahil late ang reply sa Facebook?\n\nAIStaff helps your Page reply faster, qualify leads, and prepare quotation-ready drafts.\n\nBook your free inbox audit today — aistaff.click",
      headline: "AI Sales Assistant for Facebook Pages",
      cta: "Send Message"
    }
  },
  {
    id: "AdQuotation-Feed",
    title: "Quotation Flow — Feed",
    angle: "Manual quotation from Messenger",
    format: "1080×1080 · 15s",
    language: "Taglish",
    outputFile: "ad-quotation-feed.mp4",
    previewFile: "preview-quotation-feed.png",
    previewFrame: 45,
    copy: {
      primary: "Manual pa rin ang quotation mula sa Messenger?\n\nAI magtatanong ng tamang details. Team ninyo ang mag-aapprove bago mag-send.\n\nFree inbox audit today para sa copier, CCTV, supplier, aircon, construction, at logistics Pages.",
      headline: "Turn Messenger Into Quotation-Ready Leads",
      cta: "Learn More"
    }
  },
  {
    id: "AdQuotation-Story",
    title: "Quotation Flow — Story",
    angle: "Manual quotation from Messenger",
    format: "1080×1920 · 15s",
    language: "Taglish",
    outputFile: "ad-quotation-story.mp4",
    previewFile: "preview-quotation-story.png",
    previewFrame: 45,
    copy: {
      primary: "From messy chat → quotation-ready lead.\n\nAIStaff qualifies every Messenger inquiry and saves complete lead details in your dashboard.\n\nBook free inbox audit today.",
      headline: "Free Inbox Audit for B2B Pages",
      cta: "Send Message"
    }
  }
];

const renderJobs = new Map();
const latestJobsByComposition = new Map();

function remotionBin() {
  return path.join(remotionDir, "node_modules", ".bin", "remotion");
}

function remotionEnv() {
  return {
    ...process.env,
    REMOTION_BROWSER_TIMEOUT: process.env.REMOTION_BROWSER_TIMEOUT || "120000"
  };
}

function getRenderJobs() {
  return [...renderJobs.values()].sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

function getLatestJobForComposition(compositionId) {
  return latestJobsByComposition.get(compositionId) || null;
}

function parseRemotionOutput(text) {
  const renderedMatches = [...String(text || "").matchAll(/Rendered\s+(\d+)\/(\d+)/g)];
  if (renderedMatches.length) {
    const last = renderedMatches[renderedMatches.length - 1];
    const current = Number(last[1]);
    const total = Number(last[2]);
    const percent = total ? Math.min(99, Math.round((current / total) * 100)) : 0;
    return {
      progress: percent,
      progressLabel: `Rendering frames ${current}/${total}`
    };
  }

  const bundleMatch = String(text || "").match(/Bundling code\s+.*?(\d+)%/);
  if (bundleMatch) {
    const percent = Math.min(25, Math.round(Number(bundleMatch[1]) * 0.25));
    return {
      progress: percent,
      progressLabel: `Bundling project ${bundleMatch[1]}%`
    };
  }

  if (/Getting composition|Launching browser|Opening browser/i.test(text)) {
    return { progress: 8, progressLabel: "Starting render engine…" };
  }

  return null;
}

function attachJobOutput(job, chunk) {
  job.logTail = `${job.logTail || ""}${chunk}`.slice(-8000);
  const parsed = parseRemotionOutput(job.logTail);
  if (parsed) {
    job.progress = parsed.progress;
    job.progressLabel = parsed.progressLabel;
  }
}

function ensureDirs() {
  fs.mkdirSync(path.join(rootDir, "data"), { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
}

function defaultState() {
  return {
    checklist: Object.fromEntries(LAUNCH_CHECKLIST.map((item) => [item.id, false])),
    adReviews: Object.fromEntries(AD_CREATIVES.map((item) => [item.id, { status: "draft", note: "", updatedAt: null }])),
    notes: ""
  };
}

function readState() {
  ensureDirs();
  if (!fs.existsSync(statePath)) return defaultState();
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const base = defaultState();
    return {
      checklist: { ...base.checklist, ...(parsed.checklist || {}) },
      adReviews: { ...base.adReviews, ...(parsed.adReviews || {}) },
      notes: parsed.notes || ""
    };
  } catch {
    return defaultState();
  }
}

function writeState(state) {
  ensureDirs();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function assetUrl(filename) {
  if (!filename) return null;
  const full = path.join(outDir, filename);
  if (!fs.existsSync(full)) return null;
  const stat = fs.statSync(full);
  return {
    filename,
    url: `/marketing-assets/${filename}`,
    sizeBytes: stat.size,
    updatedAt: stat.mtime.toISOString()
  };
}

function listCreatives() {
  return AD_CREATIVES.map((creative) => {
    const video = assetUrl(creative.outputFile);
    const preview = assetUrl(creative.previewFile) || assetUrl("preview-hook.png");
    const review = readState().adReviews[creative.id] || { status: "draft", note: "" };
    const job = [...renderJobs.values()].reverse().find((entry) => entry.compositionId === creative.id);
    const exportJob = getLatestJobForComposition(creative.id);
    return { ...creative, video, preview, review, job: job || exportJob || null, exportJob };
  });
}

function updateChecklistItem(id, done) {
  const state = readState();
  if (!(id in state.checklist)) throw new Error("Unknown checklist item");
  state.checklist[id] = Boolean(done);
  writeState(state);
  return state.checklist;
}

function updateAdReview(id, payload) {
  const state = readState();
  if (!state.adReviews[id]) throw new Error("Unknown creative");
  state.adReviews[id] = {
    status: payload.status || state.adReviews[id].status,
    note: payload.note ?? state.adReviews[id].note,
    updatedAt: new Date().toISOString()
  };
  writeState(state);
  return state.adReviews[id];
}

function updateMarketingNotes(notes) {
  const state = readState();
  state.notes = String(notes || "");
  writeState(state);
  return state.notes;
}

function runRemotion(args, compositionId, kind) {
  return new Promise((resolve, reject) => {
    const jobId = `${compositionId}-${Date.now()}`;
    const job = {
      id: jobId,
      compositionId,
      kind,
      status: "running",
      progress: 2,
      progressLabel: kind === "still" ? "Preparing preview image…" : "Starting MP4 export…",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      logTail: ""
    };
    renderJobs.set(jobId, job);
    latestJobsByComposition.set(compositionId, job);

    const child = spawn(remotionBin(), args, {
      cwd: remotionDir,
      shell: false,
      env: remotionEnv()
    });

    let stderr = "";
    child.stdout.on("data", (chunk) => attachJobOutput(job, chunk.toString()));
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      attachJobOutput(job, text);
    });
    child.on("error", (error) => {
      job.status = "failed";
      job.progress = 100;
      job.progressLabel = "Export failed";
      job.error = error.message;
      job.finishedAt = new Date().toISOString();
      reject(error);
    });
    child.on("close", (code) => {
      job.finishedAt = new Date().toISOString();
      const creative = AD_CREATIVES.find((item) => item.id === compositionId);
      const outputExists = creative && assetUrl(kind === "still" ? creative.previewFile : creative.outputFile);

      if (code === 0 || outputExists) {
        job.status = "done";
        job.progress = 100;
        job.progressLabel = kind === "still" ? "Preview image ready" : "MP4 export complete";
        job.error = code === 0 ? null : "Render reported an error, but the output file was created.";
        resolve(job);
        return;
      }

      job.status = "failed";
      job.progress = 100;
      job.progressLabel = "Export failed";
      job.error = (stderr.trim() || `Render exited with code ${code}`).split("\n").slice(-3).join(" ");
      reject(new Error(job.error));
    });
  });
}

async function renderCreative(compositionId) {
  const creative = AD_CREATIVES.find((item) => item.id === compositionId);
  if (!creative) throw new Error("Unknown composition");
  ensureDirs();
  return runRemotion(
    ["render", "src/index.ts", compositionId, `out/${creative.outputFile}`],
    compositionId,
    "video"
  );
}

async function renderPreviewStill(compositionId) {
  const creative = AD_CREATIVES.find((item) => item.id === compositionId);
  if (!creative) throw new Error("Unknown composition");
  ensureDirs();
  return runRemotion(
    ["still", "src/index.ts", compositionId, `--frame=${creative.previewFrame}`, `out/${creative.previewFile}`],
    compositionId,
    "still"
  );
}

function generateVoiceover(compositionId) {
  return new Promise((resolve, reject) => {
    const script = path.join(remotionDir, "scripts", "generate-voiceover.js");
    const child = spawn(process.execPath, [script, compositionId], {
      cwd: remotionDir,
      env: process.env
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(stderr.trim() || `Voiceover generation exited with code ${code}`));
    });
  });
}

function getRenderStatus() {
  return AD_CREATIVES.map((creative) => ({
    compositionId: creative.id,
    exportJob: getLatestJobForComposition(creative.id),
    video: assetUrl(creative.outputFile),
    preview: assetUrl(creative.previewFile) || assetUrl("preview-hook.png")
  }));
}

function getMarketingOverview() {
  const state = readState();
  const checklistItems = LAUNCH_CHECKLIST.map((item) => ({
    ...item,
    done: Boolean(state.checklist[item.id])
  }));
  const checklistDone = checklistItems.filter((item) => item.done).length;
  return {
    checklist: checklistItems,
    checklistDone,
    checklistTotal: checklistItems.length,
    creatives: listCreatives(),
    notes: state.notes,
    funnel: {
      destination: "https://aistaff.click/#audit",
      messengerPage: "AIStaff Facebook Page",
      testBudget: "₱300–500/day",
      killRule: "Pause if cost per audit lead > ₱500 after 3 days"
    }
  };
}

module.exports = {
  LAUNCH_CHECKLIST,
  AD_CREATIVES,
  getMarketingOverview,
  listCreatives,
  updateChecklistItem,
  updateAdReview,
  updateMarketingNotes,
  renderCreative,
  renderPreviewStill,
  generateVoiceover,
  getRenderJobs,
  getRenderStatus,
  getLatestJobForComposition,
  readState
};
