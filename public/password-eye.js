/* Show/hide eye on every password field (added 2026-10-21).
   Works for fields already on the page and fields rendered later. */
(function () {
  'use strict';
  var EYE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  var css = document.createElement('style');
  css.textContent =
    '.pw-eye-wrap{position:relative;display:block;width:100%}' +
    '.pw-eye-wrap>input{width:100%;padding-right:46px!important;box-sizing:border-box}' +
    '.pw-eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:36px;height:36px;display:flex;align-items:center;justify-content:center;' +
    'border:0;background:transparent;color:#64748b;cursor:pointer;border-radius:8px;padding:0;margin:0}' +
    '.pw-eye:hover{color:#111827;background:rgba(100,116,139,.12)}' +
    '.pw-eye:focus-visible{outline:2px solid #6366f1;outline-offset:1px}';
  document.head.appendChild(css);

  function add(input) {
    if (!input || input.dataset.pwEye) return;
    input.dataset.pwEye = '1';
    var wrap = document.createElement('span');
    wrap.className = 'pw-eye-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    btn.setAttribute('aria-label', 'Show password');
    btn.title = 'Show password';
    btn.innerHTML = EYE;
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.title = show ? 'Hide password' : 'Show password';
      input.focus();
    });
    wrap.appendChild(btn);
  }

  function scan(root) {
    (root.querySelectorAll ? root : document).querySelectorAll('input[type="password"]').forEach(add);
  }

  function start() {
    scan(document);
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('input[type="password"]')) add(n); else scan(n);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
