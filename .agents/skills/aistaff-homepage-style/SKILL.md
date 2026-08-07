---
name: aistaff-homepage-style
description: Use this skill whenever building or editing any AIStaff marketing page — the homepage, an agent landing page (like /agents/brandee/ or /agents/closer/), a new section on either, or any new card/hero/scroll-animation component. Trigger it for requests like "add a new agent page," "match our homepage style," "add an animation like the other cards," "build a hero section," or anything touching the dark cinematic theme, Motion-powered reveals, or the card layout system. This captures the exact design tokens, animation patterns, and layout conventions established for AIStaff so new work stays visually and technically consistent instead of drifting or reinventing patterns from scratch.
---

# AIStaff Homepage Style & Animation

Reusable design system and animation patterns for AIStaff's marketing site
(`public/index.html`, `public/agents/*`). Read this before styling any new
section, card, or page so it matches what already exists instead of
inventing a new look or duplicating logic that's already been solved.

For the fuller narrative of *why* these decisions were made (bugs hit,
things tried and reverted), see `docs/WEBSITE-MARKETING-HANDOFF.md` in
this repo — this skill is the distilled "how to apply it," that doc is
the "what we learned."

## Design tokens

All defined as CSS custom properties on `.modern-home` in `style.css` —
inherit them, don't hardcode hex values in new components.

```css
--night: #030810   /* page background */
--cyan:  #24a9ff    /* primary accent */
--ice:   #c7ecff    /* secondary/muted accent text */
/* glow highlight, not a variable, used directly: #5dd0ff */
```

**Card surface treatment** (dark glass panel, used for anything that
needs to look like a floating card):
```css
background: linear-gradient(160deg, rgba(19, 39, 54, .55), rgba(3, 8, 16, .82));
border: 1px solid rgba(117, 204, 255, .18);
backdrop-filter: blur(10px);
```
**Important exception:** the two agent cards on the homepage
(`.service-card-media`) deliberately have NO border/background box —
Mike explicitly asked for them to not "look boxed." Use the glass-panel
treatment above for other UI (chat widget, dropdowns, tooltips), not for
every card by default. Ask before assuming a new element should be boxed
or borderless.

## Fonts

- **Space Grotesk** — all headings (h1-h3), big stylized copy
- **DM Mono** — eyebrows/labels/kickers, always uppercase, always
  `letter-spacing: .14em` to `.16em`
- **Manrope** — all body text

Load via Google Fonts `<link>` in `<head>`, weights 500/600/700(/800 for
Space Grotesk display sizes).

## Animation library: Motion (vanilla, not React)

Load once per page, before any script that uses it:
```html
<script src="https://cdn.jsdelivr.net/npm/motion@11/dist/motion.js"></script>
```
This exposes `window.Motion` with `{ animate, inView, stagger }`. Do NOT
use `motion/react` imports or JSX-style `<motion.div>` — this is a plain
HTML/JS site, not React.

## The core reveal pattern: letter-flip with persistent replay

This is the signature AIStaff text-reveal animation. Used for card
captions and section headings. Copy this pattern for any new headline
that should animate in on scroll:

```js
function initCaptionReveal(prefix, titleId) {
  const caption = document.querySelector(`.${prefix}`);
  const title = document.getElementById(titleId);
  if (!caption || !title) return;

  const eyebrow = caption.querySelector(`.${prefix}-eyebrow`);
  const body = caption.querySelector(`.${prefix}-body`);
  const cta = caption.querySelector(`.${prefix}-cta`);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // CRITICAL: wrap letters inside a per-word .word-group (white-space: nowrap)
  // or the browser will insert line-breaks mid-word (e.g. "Messeng" | "er").
  title.innerHTML = title.textContent
    .split(" ")
    .map((word) => {
      const letterSpans = word.split("").map((ch) => `<span class="letter">${ch}</span>`).join("");
      return `<span class="word-group">${letterSpans}</span>`;
    })
    .join(" ");
  const letters = title.querySelectorAll(".letter");
  const allEls = [eyebrow, ...letters, body, cta].filter(Boolean);

  if (reduceMotion || typeof window.Motion === "undefined") {
    allEls.forEach((el) => (el.style.opacity = 1));
    return;
  }

  const { inView, animate, stagger } = window.Motion;
  const setHidden = () => allEls.forEach((el) => (el.style.opacity = 0));
  setHidden();

  inView(caption, () => {
    animate(eyebrow, { opacity: [0, 1], y: [-8, 0] }, { duration: 0.4, easing: "ease-out" });
    animate(letters, { opacity: [0, 1], rotateX: [-90, 0], y: [14, 0] },
      { delay: stagger(0.015, { startDelay: 0.15 }), duration: 0.4, easing: "ease-out" });
    animate(body, { opacity: [0, 1], y: [12, 0] },
      { delay: 0.15 + letters.length * 0.015 + 0.15, duration: 0.5, easing: "ease-out" });
    animate(cta, { opacity: [0, 1], y: [10, 0] },
      { delay: 0.15 + letters.length * 0.015 + 0.32, duration: 0.45, easing: "ease-out" });
    return setHidden; // <- THIS is what makes it replay every scroll-in, not just once
  }, { margin: "-10% 0px -10% 0px" });
}
```

**The `return setHidden` line is the single most important detail.**
Motion's `inView()` callback can return a cleanup function that fires
when the element scrolls OUT of view. Without it, the animation only
ever plays once — scrolling away and back shows everything already
visible with no replay, since there's nothing left to animate *from*.
This was a real bug found and fixed this session; don't reintroduce it.

**Matching CSS** (needed for every element this targets):
```css
.your-eyebrow, .your-body, .your-cta { opacity: 0; } /* prevents flash-before-JS */
.your-title { perspective: 700px; }
.your-title .word-group { display: inline-block; white-space: nowrap; }
.your-title .letter { display: inline-block; opacity: 0; transform-style: preserve-3d; }
```

## Independent element reveals (don't force everything to sync)

Not everything needs to animate on the same trigger. The homepage cards
deliberately give the carousel image its own separate `inView()` call
with different easing/timing from the caption text beside it — a bouncy
"pop" scale-in, distinct from the caption's letter-flip:

```js
window.Motion.inView(carousel, () => {
  window.Motion.animate(carousel, { opacity: [0, 1], scale: [0.88, 1] },
    { duration: 0.9, easing: [0.34, 1.4, 0.64, 1] }); // overshoots then settles
  return () => {
    carousel.style.opacity = 0;
    carousel.style.transform = "scale(0.88)";
  };
}, { margin: "-10% 0px -10% 0px" });
```
When adding a new component with multiple animated pieces, ask whether
they should feel like one synced block or independent arrivals — usually
independent reads as more alive and intentional.

## Card layout: centering a variable-width row correctly

If a card contains two side-by-side elements of different fixed widths
(e.g. an image + a text panel) and needs to stay centered as ONE unit at
every screen width, do not center the outer card and separately position
the inner elements with `position: absolute` — that was tried and
produced visibly off-center results, since the browser has no way to
account for an absolutely-positioned sibling when centering its parent.

**Correct approach:** put both elements as normal flex children inside
one wrapper, and center that wrapper:
```css
.your-card { width: fit-content !important; margin: 0 auto !important; }
.your-row { display: flex; align-items: center; gap: 36px; }
.your-image { width: 440px; flex-shrink: 0; }
.your-text { width: 380px; flex-shrink: 0; }
```
This guarantees true centering because the browser is centering the
*whole* rendered content, not guessing at absolute offsets.

**Responsive fallback:** below the breakpoint where both fit side by
side, switch `.your-row` to `flex-direction: column` and use CSS `order`
to control which stacks first — don't reorder the actual HTML, so
accessibility/reading order stays sensible regardless of visual order.

## SVG icons, never emoji or Unicode glyphs

Older cards on this site used Unicode symbols (✦ ◉ ⌁) as icons —
flagged as inconsistent-rendering-across-platforms. Any new icon should
be inline SVG:
```html
<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">...</svg>
```

## Before shipping any new script or stylesheet file

1. **Add it to the no-cache list** in `src/server.js` (`express.static`
   `setHeaders` callback) — new `.js`/`.css` files won't hot-reload
   without this, and you'll waste time thinking your edit isn't
   registering when it's actually just cached.
2. **If it touches `server.js` itself** (new API route, backend logic),
   the site won't pick it up automatically — run
   `launchctl kickstart -k gui/$(id -u)/com.aistaff.api` to restart the
   real production process. `npm run dev` / manual `node` will just
   create a conflicting duplicate process since the live domain is
   served by a launchd-managed service, not whatever you happen to run
   in a terminal.
3. **Static file edits (HTML/CSS/JS)** need no restart at all — Express
   reads them fresh from disk every request, and this same server IS
   what's live at aistaff.click (via Cloudflare Tunnel). But Cloudflare's
   edge CDN caches static assets independently — if a change isn't
   showing on the live domain but is correct on `localhost:3000`, that's
   almost always Cloudflare's cache, not a real bug. Toggle Development
   Mode in the Cloudflare dashboard during active work sessions.

## Quick checklist for a new agent page or major section

- [ ] Fonts loaded: Space Grotesk, DM Mono, Manrope
- [ ] Colors reference `--night`/`--cyan`/`--ice`, not new hardcoded hex
- [ ] Headings use real `<h1>`-`<h3>` tags in logical order (check
      `grep -o "<h1[^>]*>" public/index.html` still returns exactly 1
      if editing the homepage)
- [ ] Any reveal animation uses the `initCaptionReveal` pattern (or an
      explicit, deliberate variant of it) with `return setHidden` for replay
- [ ] Icons are inline SVG, not emoji/Unicode
- [ ] "Agent," not "specialist," in all copy
- [ ] New JS/CSS files added to the `server.js` no-cache list
- [ ] Real facts only — no invented pricing/features. Check
      `src/payments.js` for Closer's actual pricing tiers before writing
      any pricing copy
