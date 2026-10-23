/* Inquiries refresh themselves while open (2026-10-21), so a phone call (or any
   channel) shows up turn by turn. Re-renders only when something changed, never
   while someone is typing. In a conversation, the transcript stays on the newest
   message unless you scrolled up to read older ones. */
(function () {
  'use strict';
  var sig = null, busy = false, lastPath = '';
  function box() { return document.querySelector('.message-list.transcript'); }
  function atBottom(el) { return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120; }
  function toBottom() { var el = box(); if (el) el.scrollTop = el.scrollHeight; }
  async function tick() {
    if (document.hidden || busy || typeof api !== 'function') return;
    var m = location.pathname.match(/^\/admin\/conversations(?:\/([^/?#]+))?\/?$/);
    if (location.pathname !== lastPath) { sig = null; lastPath = location.pathname; }
    if (!m) return;
    var ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    busy = true;
    try {
      var s, y = window.scrollY;
      if (m[1]) {
        var first = sig === null;
        var stick = first || atBottom(box());
        var c = await api('/api/conversations/' + m[1]);
        s = m[1] + ':' + (c.messages || []).length + ':' + c.needs_human + ':' + c.status;
        if (!first && s !== sig && typeof conversationDetailView === 'function') {
          await conversationDetailView(m[1]);
          window.scrollTo(0, y);
        }
        if (stick) toBottom();
      } else {
        var rows = await api('/api/conversations');
        s = 'list:' + (rows || []).map(function (r) { return r.id + '@' + (r.last_message_at || '') + (r.needs_human ? '!' : ''); }).join('|');
        if (sig !== null && s !== sig && typeof conversationsView === 'function') { await conversationsView(); window.scrollTo(0, y); }
      }
      sig = s;
    } catch (e) { /* offline or logged out: try again next tick */ }
    busy = false;
  }
  setInterval(tick, 2000);
  // Open a conversation at its newest message.
  var obs = new MutationObserver(function () { if (/^\/admin\/conversations\/[^/]+/.test(location.pathname) && sig === null) toBottom(); });
  document.addEventListener('DOMContentLoaded', function () { obs.observe(document.body, { childList: true, subtree: true }); });
  if (document.body) obs.observe(document.body, { childList: true, subtree: true });
})();
