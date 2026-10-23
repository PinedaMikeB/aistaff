/*! AIStaff Closer website chat widget (2026-10-20).
 * <script src="https://aistaff.click/embed/closer-widget.js" data-key="YOUR_WIDGET_KEY" defer></script>
 */
(function () {
  "use strict";
  if (window.__aistaffCloserWidget) return;
  window.__aistaffCloserWidget = true;
  var script = document.currentScript || document.querySelector('script[src*="closer-widget.js"]');
  if (!script) return;
  var KEY = script.getAttribute("data-key");
  var API = new URL(script.src).origin + "/api/public/widget/" + encodeURIComponent(KEY || "");
  if (!KEY) return;

  var VISITOR_KEY = "aistaff_widget_visitor_" + KEY.slice(0, 8);
  var OPEN_KEY = "aistaff_widget_open_" + KEY.slice(0, 8);
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  var visitorId = store(VISITOR_KEY);
  if (!visitorId || !/^[a-zA-Z0-9_-]{8,80}$/.test(visitorId)) {
    var rnd = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "" + Math.random()).replace(".", "");
    visitorId = ("v_" + rnd).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
    store(VISITOR_KEY, visitorId);
  }

  var cfg = { name: "Chat with us", greeting: "Hi! How can we help you today?", color: "#1d4ed8" };
  var seen = {};
  var lastAt = "";
  var open = false, sending = false, pollTimer = null, booting = true;
  var pendingVisitor = [];
  var waiting = false, progressTimer = null;
  // Live steps while the reply is prepared ("Looking up your machine in our records…").
  function showProgress(start) {
    clearInterval(progressTimer);
    if (!start) { waiting = false; typing.style.display = "none"; return; }
    waiting = true;
    var startedAt = Date.now();
    typing.textContent = "Reading your message…";
    typing.style.display = "block"; msgs.scrollTop = msgs.scrollHeight;
    progressTimer = setInterval(function () {
      api("/progress?visitorId=" + encodeURIComponent(visitorId)).then(function (d) {
        if (!waiting) return;
        if (d && d.step) { typing.textContent = d.step; msgs.scrollTop = msgs.scrollHeight; }
        else if (Date.now() - startedAt > 20000) typing.textContent = "Still working on it… your reply will appear here.";
      }).catch(function () {});
    }, 1500);
  }

  var host = document.createElement("div");
  host.setAttribute("id", "aistaff-closer-widget");
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  root.innerHTML = [
    "<style>",
    ":host{all:initial}",
    ".btn{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:2147483000;display:flex;align-items:center;justify-content:center;color:#fff}",
    ".btn svg{width:28px;height:28px}",
    ".dot{position:absolute;top:6px;right:6px;width:12px;height:12px;border-radius:50%;background:#ef4444;border:2px solid #fff;display:none}",
    ".panel{position:fixed;right:20px;bottom:92px;width:370px;max-width:calc(100vw - 24px);height:540px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.28);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#111827}",
    ".panel.open{display:flex}",
    ".head{padding:14px 16px;color:#fff;display:flex;align-items:center;justify-content:space-between}",
    ".head b{font-size:15px}.head small{display:block;opacity:.85;font-size:12px;margin-top:2px}",
    ".x{background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}",
    ".msgs{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;display:flex;flex-direction:column;gap:8px}",
    ".m{max-width:82%;padding:9px 12px;border-radius:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}",
    ".m a{color:inherit;text-decoration:underline}",
    ".m.visitor{align-self:flex-end;color:#fff;border-bottom-right-radius:4px}",
    ".m.closer,.m.staff{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:4px}",
    ".m.staff:before{content:'Team';display:block;font-size:11px;font-weight:700;color:#6b7280;margin-bottom:2px}",
    ".m.note{align-self:center;background:transparent;color:#6b7280;font-size:12px}",
    ".typing{align-self:flex-start;color:#6b7280;font-size:12px;padding:2px 4px;display:none}",
    "form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}",
    "textarea{flex:1;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:9px 10px;font:inherit;max-height:96px;outline:none}",
    "textarea:focus{border-color:#93c5fd}",
    ".send{border:0;border-radius:10px;color:#fff;padding:0 14px;font-weight:700;cursor:pointer}",
    ".send:disabled{opacity:.5;cursor:default}",
    ".foot{font-size:10px;color:#9ca3af;text-align:center;padding:0 0 6px;background:#fff}",
    "@media (max-width:480px){.panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}.btn{right:14px;bottom:14px}}",
    "</style>",
    '<button class="btn" type="button" aria-label="Open chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="dot"></span></button>',
    '<div class="panel" role="dialog" aria-label="Chat"><div class="head"><div><b class="title">Chat with us</b><small>We usually reply in a few seconds</small></div><button class="x" type="button" aria-label="Close">&times;</button></div>',
    '<div class="msgs"><div class="typing">typing…</div></div>',
    '<form><textarea rows="1" placeholder="Type your message…" maxlength="2000"></textarea><button class="send" type="submit">Send</button></form>',
    '<div class="foot">Powered by AIStaff</div></div>'
  ].join("");

  var $ = function (sel) { return root.querySelector(sel); };
  var btn = $(".btn"), panel = $(".panel"), msgs = $(".msgs"), typing = $(".typing"), form = $("form"), input = $("textarea"), send = $(".send"), dot = $(".dot");

  function paint() {
    btn.style.background = cfg.color; $(".head").style.background = cfg.color; send.style.background = cfg.color;
    $(".title").textContent = cfg.name;
    root.querySelectorAll(".m.visitor").forEach(function (n) { n.style.background = cfg.color; });
  }
  function linkify(node, text) {
    var re = /https?:\/\/[^\s<>"']+/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
      var href = m[0].replace(/[),.;!?]+$/, ""), a = document.createElement("a");
      a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = href; node.appendChild(a);
      if (m[0].length > href.length) node.appendChild(document.createTextNode(m[0].slice(href.length)));
      last = m.index + m[0].length;
    }
    if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
  }
  function add(from, text, id, at) {
    if (id && seen[id]) return;
    if (from === "visitor" && id) {
      var i = pendingVisitor.indexOf(String(text || ""));
      if (i > -1) { pendingVisitor.splice(i, 1); seen[id] = true; if (at && (!lastAt || at > lastAt)) lastAt = at; return; }
    }
    if (id) seen[id] = true;
    if (at && (!lastAt || at > lastAt)) lastAt = at;
    if (waiting && id && from !== "visitor") showProgress(false);
    var div = document.createElement("div");
    div.className = "m " + from;
    if (from === "visitor") div.style.background = cfg.color;
    linkify(div, String(text || ""));
    msgs.insertBefore(div, typing);
    msgs.scrollTop = msgs.scrollHeight;
    if (!open && !booting && from !== "visitor" && id) dot.style.display = "block";
  }
  function api(pathPart, opts) {
    return fetch(API + pathPart, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {})).then(function (r) { return r.json(); });
  }
  function load() {
    return api("/messages?visitorId=" + encodeURIComponent(visitorId) + (lastAt ? "&after=" + encodeURIComponent(lastAt) : ""))
      .then(function (d) { (d.messages || []).forEach(function (m) { add(m.from, m.text, m.id, m.at); }); })
      .catch(function () {});
  }
  function setOpen(v) {
    open = v; panel.classList.toggle("open", v); store(OPEN_KEY, v ? "1" : "0");
    if (v) {
      dot.style.display = "none";
      if (!msgs.querySelector(".m")) add("closer", cfg.greeting);
      load(); clearInterval(pollTimer); pollTimer = setInterval(load, 8000);
      setTimeout(function () { input.focus(); }, 50);
    } else { clearInterval(pollTimer); }
  }
  btn.addEventListener("click", function () { setOpen(!open); });
  $(".x").addEventListener("click", function () { setOpen(false); });
  input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit")); } });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || sending) return;
    sending = true; send.disabled = true; input.value = "";
    var tempId = "tmp" + Date.now();
    pendingVisitor.push(text);
    add("visitor", text);
    showProgress(true);
    api("/messages", { method: "POST", body: JSON.stringify({ visitorId: visitorId, text: text, page: location.href }) })
      .then(function (d) {
        if (!d.ok) { showProgress(false); add("note", d.error || "Message not sent. Please try again."); return; }
        (d.messages || []).forEach(function (m) { add(m.from, m.text, m.id, m.at); });
        if (d.note) add("note", d.note);
        showProgress(false);
      })
      .catch(function () {
        // The message is already saved; the reply is still coming (slow answer or a restart). Keep checking.
        // Keep showing the live steps until the reply arrives.
        clearInterval(pollTimer); pollTimer = setInterval(load, 4000);
      })
      .then(function () { sending = false; send.disabled = false; void tempId; });
  });

  function start() {
    document.body.appendChild(host);
    api("/config").then(function (d) { if (d && d.ok) { cfg = d; } paint(); }).catch(paint).then(function () {
      load().then(function () { booting = false; if (store(OPEN_KEY) === "1") setOpen(true); setInterval(function () { if (!open) load(); }, 60000); });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
