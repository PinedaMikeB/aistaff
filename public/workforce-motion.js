(() => {
  const section = document.querySelector("#services");
  const cards = [...document.querySelectorAll("#services .service-card")];
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

// Brandee caption — sequenced blur+scale entrance, triggered when the card enters view
(function () {
  const caption = document.querySelector(".brandee-caption");
  const title = document.getElementById("brandeeCaptionTitle");
  if (!caption || !title) return;

  const eyebrow = caption.querySelector(".brandee-caption-eyebrow");
  const body = caption.querySelector(".brandee-caption-body");
  const cta = caption.querySelector(".brandee-caption-cta");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  title.innerHTML = title.textContent
    .split(" ")
    .map((w) => `<span class="word">${w}</span>`)
    .join(" ");
  const words = title.querySelectorAll(".word");

  const allEls = [eyebrow, ...words, body, cta].filter(Boolean);
  if (reduceMotion || typeof window.Motion === "undefined") {
    allEls.forEach((el) => (el.style.opacity = 1));
    return;
  }

  const { inView, animate, stagger } = window.Motion;
  inView(caption, () => {
    animate(eyebrow, { opacity: [0, 1], y: [-8, 0] }, { duration: 0.4, easing: "ease-out" });
    animate(words, { opacity: [0, 1], y: [26, 0], scale: [0.94, 1], filter: ["blur(6px)", "blur(0px)"] },
      { delay: stagger(0.07, { startDelay: 0.12 }), duration: 0.6, easing: [0.16, 1, 0.3, 1] });
    animate(body, { opacity: [0, 1], y: [12, 0] }, { delay: 0.55, duration: 0.5, easing: "ease-out" });
    animate(cta, { opacity: [0, 1], y: [10, 0] }, { delay: 0.72, duration: 0.45, easing: "ease-out" });
  }, { margin: "-10% 0px -10% 0px" });
})();

// Closer caption — letter-by-letter 3D flip entrance, distinct from Brandee's word reveal
(function () {
  const caption = document.querySelector(".closer-caption");
  const title = document.getElementById("closerCaptionTitle");
  if (!caption || !title) return;

  const eyebrow = caption.querySelector(".closer-caption-eyebrow");
  const body = caption.querySelector(".closer-caption-body");
  const cta = caption.querySelector(".closer-caption-cta");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Group letters inside a per-word wrapper so the browser treats each word as one
  // atomic unit for line-wrapping (fixes mid-word breaks like "Messeng" | "er").
  title.innerHTML = title.textContent
    .split(" ")
    .map((word) => {
      const letterSpans = word.split("").map((ch) => `<span class="letter">${ch}</span>`).join("");
      return `<span class="word-group">${letterSpans}</span>`;
    })
    .join(" ");
  const letters = title.querySelectorAll(".letter");

  if (reduceMotion || typeof window.Motion === "undefined") {
    [eyebrow, ...letters, body, cta].filter(Boolean).forEach((el) => (el.style.opacity = 1));
    return;
  }

  const { inView, animate, stagger } = window.Motion;
  inView(caption, () => {
    animate(eyebrow, { opacity: [0, 1], y: [-8, 0] }, { duration: 0.4, easing: "ease-out" });
    animate(letters, { opacity: [0, 1], rotateX: [-90, 0], y: [14, 0] },
      { delay: stagger(0.015, { startDelay: 0.15 }), duration: 0.4, easing: "ease-out" });
    animate(body, { opacity: [0, 1], y: [12, 0] },
      { delay: 0.15 + letters.length * 0.015 + 0.15, duration: 0.5, easing: "ease-out" });
    animate(cta, { opacity: [0, 1], y: [10, 0] },
      { delay: 0.15 + letters.length * 0.015 + 0.32, duration: 0.45, easing: "ease-out" });
  }, { margin: "-10% 0px -10% 0px" });
})();
