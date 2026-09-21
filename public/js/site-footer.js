// Single source of truth for the site footer.
// Every page includes: <div id="site-footer-root"></div><script src="/js/site-footer.js" defer></script>
// Editing /partials/footer.html updates the footer on every page — nothing else needs to change.
(function () {
  var mount = document.getElementById("site-footer-root");
  if (!mount) return;
  if (window.location.pathname.indexOf("/admin") === 0) {
    mount.remove();
    return;
  }
  fetch("/partials/footer.html")
    .then(function (res) {
      if (!res.ok) throw new Error("footer fetch failed: " + res.status);
      return res.text();
    })
    .then(function (html) {
      mount.outerHTML = html;
    })
    .catch(function (err) {
      console.error("Site footer failed to load:", err);
    });
})();
