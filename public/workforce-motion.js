(() => {
  const section = document.querySelector("#services");
  const cards = [...document.querySelectorAll("#services .service-card")].filter((card) => !card.closest("[hidden]"));
  if (!section || !cards.length) return;

  section.classList.add("workforce-reveal-ready");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduceMotion.matches || !("IntersectionObserver" in window)) {
    section.classList.add("is-visible");
    cards.forEach((card) => card.classList.add("is-visible"));
    return;
  }

  const cardObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      entry.target.classList.toggle("is-visible", entry.isIntersecting);
    });
  }, { rootMargin: "-12% 0px -12% 0px", threshold: 0.14 });

  const sectionObserver = new IntersectionObserver(([entry]) => {
    section.classList.toggle("is-visible", entry.isIntersecting);
  }, { rootMargin: "-18% 0px -18% 0px", threshold: 0.08 });

  cards.forEach((card) => cardObserver.observe(card));
  sectionObserver.observe(section);

  reduceMotion.addEventListener?.("change", (event) => {
    if (event.matches) {
      section.classList.add("is-visible");
      cards.forEach((card) => card.classList.add("is-visible"));
    }
  });
})();

// Card image carousels (Brandee, Closer, etc.) — Motion-powered crossfade,
// synced progress bars, click-to-pause, swipe. Initializes every [data-carousel] independently.
document.querySelectorAll("[data-carousel]").forEach((carousel) => {
  if (carousel.closest("[hidden]")) return;
  const images = [...carousel.querySelectorAll(".carousel-track img")];
  const segments = [...carousel.querySelectorAll(".carousel-progress span")];
  const fills = segments.map((s) => s.querySelector("i"));
  if (!images.length) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SLIDE_MS = 3500;
  const hasMotion = typeof window.Motion !== "undefined";
  const pauseIcon = carousel.querySelector(".icon-pause");
  const playIcon = carousel.querySelector(".icon-play");
  let index = 0;
  let fillControls = null;
  let paused = false;
  let touchStartX = 0;
  let justSwiped = false;

  function setPausedUI(isPaused) {
    paused = isPaused;
    if (pauseIcon) pauseIcon.hidden = isPaused;
    if (playIcon) playIcon.hidden = !isPaused;
  }

  function crossfade(prevEl, nextEl) {
    if (hasMotion && !reduceMotion) {
      window.Motion.animate(prevEl, { opacity: [1, 0] }, { duration: 0.5, easing: "ease-out" });
      window.Motion.animate(nextEl, { opacity: [0, 1] }, { duration: 0.6, easing: "ease-out" });
    } else {
      prevEl.style.opacity = 0;
      nextEl.style.opacity = 1;
    }
  }

  function setProgress(newIndex) {
    segments.forEach((seg, n) => {
      seg.classList.toggle("done", n < newIndex);
      seg.classList.toggle("active", n === newIndex);
      if (n !== newIndex) fills[n].style.width = n < newIndex ? "100%" : "0%";
    });
  }

  function playFill(n) {
    if (!hasMotion || reduceMotion) return null;
    fills[n].style.width = "0%";
    const controls = window.Motion.animate(fills[n], { width: ["0%", "100%"] },
      { duration: SLIDE_MS / 1000, easing: "linear" });
    controls.finished.then(() => { if (!paused) show(index + 1); }).catch(() => {});
    return controls;
  }

  function show(i) {
    const prev = index;
    index = (i + images.length) % images.length;
    if (prev !== index) crossfade(images[prev], images[index]);
    else images[index].style.opacity = 1;
    images.forEach((img, n) => img.classList.toggle("active", n === index));
    setProgress(index);
    fillControls?.stop?.();
    fillControls = playFill(index);
  }

  show(0);

  // Carousel's own entrance reveal — independent timing/easing from the caption text beside it.
  // Resets to hidden on leave so it replays every time it re-enters the viewport.
  if (typeof window.Motion !== "undefined" && !reduceMotion) {
    window.Motion.inView(carousel, () => {
      window.Motion.animate(carousel, { opacity: [0, 1], scale: [0.88, 1] },
        { duration: 0.9, easing: [0.34, 1.4, 0.64, 1] });
      return () => {
        carousel.style.opacity = 0;
        carousel.style.transform = "scale(0.88)";
      };
    }, { margin: "-10% 0px -10% 0px" });
  } else {
    carousel.style.opacity = 1;
    carousel.style.transform = "none";
  }

  segments.forEach((seg, n) => seg.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    show(n);
  }));

  carousel.addEventListener("click", () => {
    if (justSwiped) { justSwiped = false; return; }
    setPausedUI(!paused);
    paused ? fillControls?.pause?.() : fillControls?.play?.();
    carousel.blur();
  });
  carousel.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    carousel.dispatchEvent(new Event("click"));
  });

  carousel.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  carousel.addEventListener("touchend", (e) => {
    const delta = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(delta) > 40) {
      justSwiped = true;
      show(index + (delta < 0 ? 1 : -1));
    }
  }, { passive: true });
});

// Caption text reveal (Brandee + Closer) — shared letter-by-letter 3D flip entrance.
// Resets to hidden on leave so it replays every time the caption re-enters the viewport.
function initCaptionReveal(prefix, titleId) {
  const caption = document.querySelector(`.${prefix}`);
  const title = document.getElementById(titleId);
  if (!caption || !title) return;
  if (caption.closest("[hidden]")) return;

  const eyebrow = caption.querySelector(`.${prefix}-eyebrow`);
  const body = caption.querySelector(`.${prefix}-body`);
  const cta = caption.querySelector(`.${prefix}-cta`);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Group letters inside a per-word wrapper so the browser treats each word as one
  // atomic unit for line-wrapping (prevents mid-word breaks like "Messeng" | "er").
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
    return setHidden;
  }, { margin: "-10% 0px -10% 0px" });
}

initCaptionReveal("pitch-caption", "pitchCaptionTitle");
initCaptionReveal("brandee-caption", "brandeeCaptionTitle");
initCaptionReveal("closer-caption", "closerCaptionTitle");

// Services section heading — same letter-flip technique, its own trigger/target
(function () {
  const kicker = document.querySelector(".section-heading-compact .section-kicker");
  const title = document.getElementById("workforceHeadingTitle");
  const support = document.querySelector(".section-heading-compact .section-support");
  if (!title) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  title.innerHTML = title.textContent
    .split(" ")
    .map((word) => {
      const letterSpans = word.split("").map((ch) => `<span class="letter">${ch}</span>`).join("");
      return `<span class="word-group">${letterSpans}</span>`;
    })
    .join(" ");
  const letters = title.querySelectorAll(".letter");
  const allEls = [kicker, ...letters, support].filter(Boolean);

  if (reduceMotion || typeof window.Motion === "undefined") {
    allEls.forEach((el) => (el.style.opacity = 1));
    return;
  }

  const { inView, animate, stagger } = window.Motion;
  const setHidden = () => allEls.forEach((el) => (el.style.opacity = 0));
  setHidden();

  inView(title, () => {
    animate(kicker, { opacity: [0, 1], y: [-8, 0] }, { duration: 0.4, easing: "ease-out" });
    animate(letters, { opacity: [0, 1], rotateX: [-90, 0], y: [16, 0] },
      { delay: stagger(0.02, { startDelay: 0.15 }), duration: 0.45, easing: "ease-out" });
    animate(support, { opacity: [0, 1], y: [10, 0] },
      { delay: 0.15 + letters.length * 0.02 + 0.15, duration: 0.5, easing: "ease-out" });
    return setHidden;
  }, { margin: "-10% 0px -10% 0px" });
})();
