// Shared client-side helpers for the Brandee product-ad MVP pages
// (landing, /image/, /video/). Kept dependency-free, consistent with the
// rest of this static site.

window.BrandeeProductAd = (function () {
  function track(event, properties) {
    try {
      fetch("/api/public/brandee/product-ads/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, properties: properties || {} }),
        credentials: "same-origin"
      }).catch(() => {});
    } catch (e) { /* analytics must never break the page */ }
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, { credentials: "same-origin", ...options });
    let body = null;
    try { body = await res.json(); } catch (e) { /* no body */ }
    return { ok: res.ok, status: res.status, body };
  }

  function showError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
  }

  return { track, fileToDataUrl, fetchJson, showError };
})();
