#!/usr/bin/env node
// Generates the 13 code-level template gallery thumbnails referenced by
// imageAdTemplates.js's `thumbnail` field (e.g.
// /agents/brandee/assets/templates/product-highlight.svg).
//
// These files were referenced in code but never actually created, which is
// why the public template gallery was rendering blank/broken card
// thumbnails for every one of the 13 built-in templates (the only ones
// currently ACTIVE — the 21 real-photo imports are still DRAFT pending
// Super Admin activation). This script generates a clean, on-brand SVG
// mockup per framework (dark theme matching the gallery's own card design)
// so every card shows a real, distinct visual instead of a broken <img>.
//
// Safe to re-run — it always overwrites these 13 known files, nothing else.

const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "public", "agents", "brandee", "assets", "templates");
const W = 480;
const H = 600;

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function base(bodyContent, { bg1 = "#0d2233", bg2 = "#050d15" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bg1}" />
      <stop offset="1" stop-color="${bg2}" />
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#24a9ff" />
      <stop offset="1" stop-color="#3ddc97" />
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)" />
  ${bodyContent}
</svg>`;
}

function photoBlock(x, y, w, h, r = 10) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#12293b" stroke="#1f3d52" stroke-width="1" />
    <circle cx="${x + w * 0.28}" cy="${y + h * 0.34}" r="${Math.min(w, h) * 0.11}" fill="#294a63" />
    <path d="M${x + w * 0.1} ${y + h * 0.82} L${x + w * 0.38} ${y + h * 0.52} L${x + w * 0.58} ${y + h * 0.7} L${x + w * 0.78} ${y + h * 0.46} L${x + w * 0.92} ${y + h * 0.82} Z" fill="#1c3a50" />`;
}

function bar(x, y, w, h, fill, r = 4) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" />`;
}

function ctaPill(x, y, w = 130, h = 30) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="url(#accent)" />`;
}

function caption(name) {
  return `<text x="24" y="${H - 22}" font-family="Manrope, sans-serif" font-size="14" font-weight="700" fill="#6f8a9c" letter-spacing=".01em">${esc(name)}</text>`;
}

const GENERATORS = {
  "product-highlight": (name) => base(`
    ${photoBlock(40, 40, W - 80, 300)}
    ${bar(40, 366, 280, 22, "#e9f6ff")}
    ${bar(40, 398, 180, 14, "#7ec69a")}
    ${ctaPill(40, 432)}
    ${caption(name)}
  `),
  "feature-benefit": (name) => base(`
    ${bar(40, 44, 260, 22, "#e9f6ff")}
    ${[0, 1, 2].map((i) => `
      <circle cx="58" cy="${110 + i * 56}" r="9" fill="#3ddc97" />
      ${bar(80, 100 + i * 56, 340, 14, "#b9d7e8")}
    `).join("")}
    ${photoBlock(40, 300, W - 80, 200)}
    ${ctaPill(40, 522)}
    ${caption(name)}
  `),
  "offer-promo": (name) => base(`
    ${photoBlock(40, 40, W - 80, 260)}
    <rect x="336" y="56" width="104" height="40" rx="20" fill="#ff5f7a" />
    <text x="388" y="82" font-family="Manrope, sans-serif" font-size="15" font-weight="800" fill="#fff" text-anchor="middle">-30%</text>
    ${bar(40, 322, 300, 24, "#e9f6ff")}
    ${bar(40, 358, 140, 30, "#7ec69a")}
    ${ctaPill(40, 410)}
    ${caption(name)}
  `),
  "problem-solution": (name) => base(`
    ${bar(40, 44, W - 80, 16, "#e0838f")}
    ${bar(40, 70, 260, 14, "#b9d7e8")}
    <text x="40" y="130" font-family="Space Grotesk, sans-serif" font-size="26" font-weight="700" fill="#e9f6ff">Before</text>
    ${photoBlock(40, 150, W - 80, 150)}
    <text x="40" y="336" font-family="Space Grotesk, sans-serif" font-size="26" font-weight="700" fill="#7ec69a">After</text>
    ${photoBlock(40, 356, W - 80, 150)}
    ${caption(name)}
  `),
  "question-ad": (name) => base(`
    <text x="240" y="150" font-family="Space Grotesk, sans-serif" font-size="90" font-weight="700" fill="#1f3d52" text-anchor="middle">?</text>
    ${bar(40, 200, W - 80, 26, "#e9f6ff")}
    ${bar(40, 238, 260, 16, "#b9d7e8")}
    ${photoBlock(40, 290, W - 80, 210)}
    ${ctaPill(40, 522)}
    ${caption(name)}
  `),
  "comparison": (name) => base(`
    ${bar(40, 44, W - 80, 20, "#e9f6ff")}
    <rect x="40" y="86" width="185" height="330" rx="10" fill="#1a2f40" />
    <rect x="255" y="86" width="185" height="330" rx="10" fill="#123a2c" stroke="#3ddc97" stroke-width="2" />
    <text x="132" y="112" font-family="Manrope, sans-serif" font-size="13" font-weight="700" fill="#9fc0d6" text-anchor="middle">THEM</text>
    <text x="347" y="112" font-family="Manrope, sans-serif" font-size="13" font-weight="700" fill="#3ddc97" text-anchor="middle">US</text>
    ${[0, 1, 2].map((i) => `${bar(56, 140 + i * 40, 150, 12, "#3a5468")}${bar(271, 140 + i * 40, 150, 12, "#3ddc97")}`).join("")}
    ${caption(name)}
  `),
  "minimal-ecommerce": (name) => base(`
    ${photoBlock(90, 60, W - 180, 340, 16)}
    ${bar(120, 424, 240, 20, "#e9f6ff")}
    ${bar(120, 456, 130, 16, "#7ec69a")}
    ${ctaPill(120, 494, 240)}
    ${caption(name)}
  `),
  "testimonial-style": (name) => base(`
    <text x="40" y="120" font-family="Space Grotesk, sans-serif" font-size="70" font-weight="700" fill="#3ddc97" opacity=".5">&#8220;</text>
    ${bar(40, 140, W - 80, 16, "#e9f6ff")}
    ${bar(40, 166, W - 120, 16, "#e9f6ff")}
    ${bar(40, 192, 220, 16, "#e9f6ff")}
    <circle cx="66" cy="260" r="22" fill="#294a63" />
    ${bar(98, 250, 160, 12, "#b9d7e8")}
    ${bar(98, 270, 100, 10, "#6f8a9c")}
    ${photoBlock(40, 320, W - 80, 170)}
    ${caption(name)}
  `),
  "before-and-after": (name) => base(`
    <text x="140" y="90" font-family="Manrope, sans-serif" font-size="15" font-weight="800" fill="#9fc0d6" text-anchor="middle">BEFORE</text>
    <text x="340" y="90" font-family="Manrope, sans-serif" font-size="15" font-weight="800" fill="#3ddc97" text-anchor="middle">AFTER</text>
    ${photoBlock(40, 110, 185, 300)}
    ${photoBlock(255, 110, 185, 300)}
    <rect x="235" y="110" width="10" height="300" fill="#050d15" />
    ${bar(40, 440, W - 80, 20, "#e9f6ff")}
    ${caption(name)}
  `),
  "bold-claim": (name) => base(`
    ${bar(40, 90, W - 80, 32, "#e9f6ff")}
    ${bar(40, 132, W - 140, 32, "#e9f6ff")}
    ${bar(40, 190, 200, 16, "#7ec69a")}
    ${photoBlock(40, 260, W - 80, 250)}
    ${caption(name)}
  `),
  "iphone-notes": (name) => base(`
    <rect x="70" y="40" width="${W - 140}" height="${H - 120}" rx="26" fill="#f4f2e8" />
    <rect x="70" y="40" width="${W - 140}" height="46" rx="26" fill="#e7e3d2" />
    <circle cx="90" cy="63" r="6" fill="#d8d2bd" />
    <text x="150" y="70" font-family="Manrope, sans-serif" font-size="13" font-weight="700" fill="#8a836a">Notes</text>
    ${[0, 1, 2, 3].map((i) => `<text x="96" y="${130 + i * 34}" font-family="Manrope, sans-serif" font-size="15" fill="#3a3626">&#8226; Reason ${i + 1}</text>`).join("")}
    ${caption(name)}
  `, { bg1: "#0d2233", bg2: "#050d15" }),
  "reasons-why": (name) => base(`
    ${bar(40, 44, W - 80, 22, "#e9f6ff")}
    ${[0, 1, 2, 3, 4].map((i) => `
      <circle cx="58" cy="${104 + i * 46}" r="14" fill="url(#accent)" />
      <text x="58" y="${109 + i * 46}" font-family="Space Grotesk, sans-serif" font-size="13" font-weight="700" fill="#04121c" text-anchor="middle">${i + 1}</text>
      ${bar(84, 96 + i * 46, 330, 16, "#b9d7e8")}
    `).join("")}
    ${caption(name)}
  `),
  "sticky-notes": (name) => base(`
    ${bar(40, 44, 260, 20, "#e9f6ff")}
    ${[[40, 90, "#ffe38a"], [180, 110, "#a6e8c9"], [320, 90, "#ffb3c6"], [40, 260, "#9fd8ff"], [220, 240, "#ffe38a"]].map(([x, y, c], i) => `
      <g transform="rotate(${(i % 2 ? -4 : 5)} ${x + 60} ${y + 60})">
        <rect x="${x}" y="${y}" width="120" height="120" fill="${c}" />
        <rect x="${x + 12}" y="${y + 20}" width="96" height="10" fill="#00000022" />
        <rect x="${x + 12}" y="${y + 40}" width="80" height="8" fill="#00000018" />
        <rect x="${x + 12}" y="${y + 56}" width="88" height="8" fill="#00000018" />
      </g>
    `).join("")}
    ${caption(name)}
  `)
};

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const names = {
    "product-highlight": "Product Highlight",
    "feature-benefit": "Features & Benefits",
    "offer-promo": "Offer & Promo",
    "problem-solution": "Before & After Story",
    "question-ad": "Question",
    "comparison": "Us vs Them",
    "minimal-ecommerce": "Minimal E-commerce",
    "testimonial-style": "Testimonial",
    "before-and-after": "Before & After",
    "bold-claim": "Bold Claim",
    "iphone-notes": "iPhone Notes",
    "reasons-why": "Reasons Why",
    "sticky-notes": "Sticky Notes"
  };
  let count = 0;
  for (const [slug, gen] of Object.entries(GENERATORS)) {
    const svg = gen(names[slug] || slug);
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.svg`), svg);
    count += 1;
  }
  console.log(`Generated ${count} template thumbnail SVGs in ${OUT_DIR}`);
}

if (require.main === module) main();
module.exports = { GENERATORS };
