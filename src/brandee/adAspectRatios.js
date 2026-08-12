// Ad aspect ratios offered to customers, and the exact generation sizes
// used for each.
//
// GPT Image 2 accepts arbitrary sizes provided BOTH dimensions are
// divisible by 16 (verified against the live API — 1080x1350 and
// 1080x1920 are rejected for exactly this reason, which is why an earlier
// version of this file wrongly assumed only 1024x1024 / 1024x1536 were
// available and silently substituted 2:3 for every 4:5 request).
//
// Every size below is an EXACT ratio match and clears Meta's 1080px
// short-edge floor, so nothing is ever cropped or upscaled.

const AD_ASPECT_RATIOS = {
  "4:5": {
    id: "4:5",
    label: "4:5",
    placement: "Feed",
    recommended: true,
    width: 1280,
    height: 1600,
    metaTarget: "1080x1350",
    // Where Meta's own UI chrome sits on this placement, expressed as
    // guidance the art director must respect. Feed has no overlay chrome.
    safeZoneNote: null
  },
  "1:1": {
    id: "1:1",
    label: "1:1",
    placement: "Square",
    recommended: false,
    width: 1024,
    height: 1024,
    metaTarget: "1080x1080",
    safeZoneNote: null
  },
  "9:16": {
    id: "9:16",
    label: "9:16",
    placement: "Stories, Reels",
    recommended: false,
    width: 1152,
    height: 2048,
    metaTarget: "1080x1920",
    safeZoneNote: "Meta's own interface covers the top ~14% (profile name, Sponsored label) and the bottom ~35% (call-to-action button, engagement icons) of this placement."
  }
};

const DEFAULT_ASPECT_RATIO = "4:5";
const ASPECT_RATIO_IDS = Object.keys(AD_ASPECT_RATIOS);

function getAspectRatio(id) {
  return AD_ASPECT_RATIOS[id] || AD_ASPECT_RATIOS[DEFAULT_ASPECT_RATIO];
}

/**
 * Snaps arbitrary dimensions to the nearest multiple of 16 the image API
 * will accept. Used as a guard so a caller passing a raw pixel size can
 * never produce a 400 from the provider.
 */
function snapToProviderGrid(width, height) {
  const snap = (n) => Math.max(256, Math.round(n / 16) * 16);
  return { width: snap(width), height: snap(height) };
}

module.exports = { AD_ASPECT_RATIOS, ASPECT_RATIO_IDS, DEFAULT_ASPECT_RATIO, getAspectRatio, snapToProviderGrid };
