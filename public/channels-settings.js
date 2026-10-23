/* Settings > Channels (added 2026-10-20). Checkbox cards; ticking a card reveals its settings.
   Facebook Messenger: status + link to the EXISTING Facebook Page Connection tab (never changed here). */
(function () {
  'use strict';

  var STATE = {
    off: ['Off', 'inactive'], needs_setup: ['Needs setup', 'warn'], paused: ['Paused', 'inactive'],
    connected: ['Connected', 'active'], problem: ['Problem', 'bad'], later: ['Set up later', 'inactive'], testing: ['Test mode', 'warn']
  };
  var INFO = {
    facebook_messenger: ['Facebook Messenger', 'Closer answers messages sent to your Facebook Page.'],
    email: ['Email', 'Closer reads your customer-service inbox and replies from that address, in the same email thread.'],
    website_chat: ['Website Chat Widget', 'A chat box on your website, answered by Closer.'],
    mobile_phone: ['Mobile Phone', 'Your AI phone assistant answers calls and sends SMS through the router AIStaff provides.']
  };
  var openCards = {};

  function esc(v) { return escapeHtml(v == null ? '' : String(v)); }
  function badge(state) { var s = STATE[state] || STATE.off; return '<span class="channel-state ' + s[1] + '"><i></i>' + s[0] + '</span>'; }
  function when(iso) { return iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'; }

  function aiSwitch(ch) {
    return '<label class="channel-ai"><input type="checkbox" data-ai="' + ch.key + '"' + (ch.ai_replies ? ' checked' : '') + (ch.state === 'later' ? ' disabled' : '') + ' />' +
      '<span><b>AI replies</b> — Closer answers customers on this channel. Off: messages are kept in Inquiries for your staff.</span></label>' +
      '<label class="channel-style" style="display:flex;align-items:center;gap:10px;margin:8px 0"><b>Reply style</b> <select data-style="' + ch.key + '">' +
      '<option value="formal"' + (ch.reply_style === 'formal' ? ' selected' : '') + '>Formal — greeting, paragraphs, numbered lists, closing</option>' +
      '<option value="casual"' + (ch.reply_style === 'casual' ? ' selected' : '') + '>Casual — short, friendly chat messages</option>' +
      '</select></label>' +
      '<details class="channel-instructions"><summary style="cursor:pointer"><b>Channel instructions</b> <span class="muted small">' + (ch.instructions ? 'set · show' : 'none · add') + '</span></summary>' +
      '<p class="muted small">Only for ' + esc(INFO[ch.key][0]) + '. Closer uses them together with your Closer instructions (Settings › General) and the Business Engine instructions.</p>' +
      '<textarea data-instr="' + ch.key + '" rows="4" maxlength="2000" style="width:100%" placeholder="Example: Mention our office hours (Mon–Sat, 8 AM–5 PM).">' + esc(ch.instructions || '') + '</textarea>' +
      '<button class="button button-soft" type="button" data-instr-save="' + ch.key + '" style="margin-top:6px">Save channel instructions</button></details>';
  }

  function facebookBody(ch) {
    return [
      ch.page_name
        ? '<p>Connected Page: <b>' + esc(ch.page_name) + '</b></p>'
        : '<p class="muted">No Facebook Page is connected yet.</p>',
      '<p><a class="button button-soft" href="' + adminPath('settings', 'facebook-page-connection') + '">Open Facebook Page Connection</a></p>',
      '<p class="muted small">Connecting, reconnecting or changing the Page is done in the Facebook Page Connection tab.</p>',
      ch.page_name ? aiSwitch(ch) : ''
    ].join('');
  }

  function emailBody(ch, data) {
    var c = ch.config;
    var hostinger = c.provider === 'hostinger';
    var status = '';
    if (ch.state === 'problem') status = '<div class="settings-warning"><b>Problem:</b> ' + esc(ch.last_error) + '</div>';
    else if (ch.last_error && !ch.tested) status = '<div class="settings-warning"><b>Last test failed:</b> ' + esc(ch.last_error) + '</div>';
    var facts = ch.config.address ? '<p class="muted small">Last test passed: ' + (ch.tested ? when(ch.last_tested_at) : 'not yet (or settings changed since)') +
      (ch.enabled ? ' · Inbox last checked: ' + when(ch.last_ok_at) + (ch.reading_since ? ' · Answering mail received since ' + when(ch.reading_since) : '') : '') + '</p>' : '';
    return [
      status,
      '<form id="emailChannelForm" class="channel-form" autocomplete="off">',
      '<p class="muted small">Use a customer-service inbox such as care@yourcompany.com — not an address from “Who gets alerts”.</p>',
      '<div class="channel-grid">',
      '<label>Inbox email address<input name="address" type="email" required value="' + esc(c.address) + '" placeholder="care@yourcompany.com" /></label>',
      '<label>Sender name customers see<input name="sender_name" value="' + esc(c.sender_name || data.company_name) + '" /></label>',
      '<label>Email provider<select name="provider">' + Object.keys(data.providers).map(function (k) {
        return '<option value="' + k + '"' + (c.provider === k ? ' selected' : '') + '>' + esc(data.providers[k].label) + '</option>';
      }).join('') + '</select></label>',
      '<label>Password' + (ch.has_password ? ' <span class="muted small">(saved — type only to change)</span>' : '') +
        '<input name="password" type="password" autocomplete="new-password" placeholder="' + (ch.has_password ? '•••••••• saved' : 'Mailbox password') + '" /></label>',
      '</div>',
      '<details class="channel-servers"' + (hostinger ? '' : ' open') + '><summary>Server settings' + (hostinger ? ' (filled in for Hostinger)' : '') + '</summary><div class="channel-grid">',
      '<label>Incoming server (IMAP)<input name="imap_host" value="' + esc(c.imap_host) + '" /></label>',
      '<label>IMAP port<input name="imap_port" type="number" value="' + esc(c.imap_port) + '" /></label>',
      '<label>Outgoing server (SMTP)<input name="smtp_host" value="' + esc(c.smtp_host) + '" /></label>',
      '<label>SMTP port<input name="smtp_port" type="number" value="' + esc(c.smtp_port) + '" /></label>',
      '<label>Login username <span class="muted small">(usually the email address)</span><input name="username" value="' + esc(c.username) + '" placeholder="same as the email address" /></label>',
      '</div></details>',
      '<label>Signature added under every reply<textarea name="signature" rows="3" placeholder="Marga Enterprises Customer Care&#10;0917 000 0000">' + esc(c.signature) + '</textarea></label>',
      '<div class="channel-actions">',
      '<button type="submit" class="button button-soft">Save</button>',
      '<button type="button" class="button button-soft" id="emailTestBtn">Test connection</button>',
      ch.enabled
        ? '<span class="muted small">Email replies are ON.</span>'
        : '<button type="button" class="button button-primary" id="emailEnableBtn"' + (ch.tested ? '' : ' disabled') + '>Turn on email replies</button>' +
          (ch.tested ? '' : '<span class="muted small">Unlocks after Test connection passes.</span>'),
      '</div>',
      '<div id="emailTestResult"></div>',
      facts,
      '</form>',
      ch.tested || ch.enabled ? aiSwitch(ch) : ''
    ].join('');
  }

  function chatBody(ch) {
    var snippet = ch.public_key ? '<script src="' + ch.embed_src + '" data-key="' + ch.public_key + '" defer></script>' : '';
    return [
      '<form id="chatChannelForm" class="form-grid">',
      '<label class="full">Websites where the chat may appear (one per line)<textarea name="allowed_origins" rows="2" placeholder="https://yourcompany.com">' + esc((ch.allowed_origins || []).join('\n')) + '</textarea></label>',
      '<label class="full">Greeting<input name="greeting" maxlength="300" value="' + esc(ch.greeting || '') + '" placeholder="Hi! Welcome. How can we help you today?"></label>',
      '<label>Colour<input name="color" type="color" value="' + esc(ch.color || '#1d4ed8') + '"></label>',
      '<div class="channel-actions full"><button class="button button-primary" type="submit">Save chat settings</button></div>',
      '</form>',
      snippet ? '<details class="channel-instructions"' + (ch.enabled ? '' : ' open') + '><summary style="cursor:pointer"><b>Code for your website</b> <span class="muted small">paste once before &lt;/body&gt; on every page</span></summary><textarea readonly rows="2" style="width:100%;font-family:monospace;font-size:12px" onclick="this.select()">' + esc(snippet) + '</textarea></details>' : '<p class="muted small">Save your website address to get the code to paste on your site.</p>',
      ch.public_key ? aiSwitch(ch) : ''
    ].join('');
  }

  function laterBody(ch) {
    var text = ch.key === 'mobile_phone'
      ? 'Set up later. Calls and SMS will go through AIStaff’s own VoLTE router with SIP (already working for Pitch) — no outside SMS company needed.'
      : 'Set up later. Coming after the email channel: allowed websites, greeting, colour, embed code and offline email capture.';
    return '<p class="muted">' + text + '</p>';
  }

  // ---- Mobile Phone (Pitch) — first-time setup, one step open at a time (added 2026-10-21) ----
  function stepBlock(n, title, done, open, inner) {
    return '<details class="phone-step' + (done ? ' is-done' : '') + '"' + (open ? ' open' : '') + '>' +
      '<summary><b>' + (done ? '✓' : n + '.') + ' ' + esc(title) + '</b>' + (done ? ' <span class="muted small">done · show</span>' : '') + '</summary>' +
      '<div class="phone-step-body">' + inner + '</div></details>';
  }

  function mobileBody(ch) {
    var d = ch.device;
    if (!d) {
      return '<p class="muted">No phone line yet. AIStaff gives you a ready router with a SIM and a <b>setup code</b>. Once you have the code, it is entered here.</p>' +
        '<p class="muted small">Want a phone line? Message AIStaff and we will prepare one for you.</p>';
    }
    var s = ch.steps || {};
    var p = ch.pitch || {};
    var hosted = d.hosted !== false;
    var current = !s.code ? 1 : (!s.plug && !hosted) ? 2 : !s.personalise ? 3 : !s.actions ? 4 : 5;

    var step1 = s.code
      ? '<p>Router linked to your account' + (d.phone_number ? ': <b>' + esc(d.phone_number) + '</b>' : '') + ' <span class="muted small">(' + esc(d.model) + (d.carrier ? ' · ' + esc(d.carrier) : '') + ')</span></p>'
      : '<form id="phoneClaimForm" class="channel-actions">' +
          '<input name="code" placeholder="AIS-XXXX-XXXX" autocomplete="off" style="text-transform:uppercase;max-width:220px" required />' +
          '<button class="button button-primary" type="submit">Link my router</button></form>' +
        '<p class="muted small">Your setup code is in the email from AIStaff (subject: <b>Your AIStaff phone line setup code</b>) or on the sheet that came with your router.</p>';
    if (!s.code) step1 = '<p>AIStaff has prepared a phone line for you' + (d.phone_number ? ': <b>' + esc(d.phone_number) + '</b>' : '') + ' <span class="muted small">(' + esc(d.model) + ')</span>.</p>' + step1 +
      '<details class="phone-howto"><summary style="cursor:pointer" class="muted small">How setup works</summary><ol class="phone-plug">' +
      (hosted ? '' : '<li>Put the SIM into the router (if it is not in yet).</li>' +
      '<li>Connect the router to your internet with the LAN cable, then plug in the power.</li>') +
      '<li>Type your setup code here and press <b>Link my router</b>.</li>' +
      (hosted ? '' : '<li>Press <b>Check connection</b>.</li>') +
      '<li>Give your phone assistant a name and greeting, and choose what it can do.</li></ol></details>';

    var lastCheck = d.last_check_at ? (d.last_check_ok ? '✔ Reachable · checked ' : '✖ Not reachable · checked ') + when(d.last_check_at) : 'Not checked yet';
    var step2 = hosted
      ? '<p>Your router is kept and managed by AIStaff — nothing to install or plug in.</p><p class="muted small">' +
        (d.last_check_at ? (d.last_check_ok ? '✔ Connected · checked ' : '✖ AIStaff is fixing the connection · checked ') + esc(when(d.last_check_at)) : 'AIStaff is connecting your line.') + '</p>'
      : '<ol class="phone-plug">' +
        '<li>Put the SIM card into the router (gold side down) if it is not in yet.</li>' +
        '<li>Connect the router to your internet with the LAN cable.</li>' +
        '<li>Plug in the power and wait about 2 minutes until the lights stop blinking.</li></ol>' +
      '<div class="channel-actions"><button class="button button-soft" type="button" id="phoneCheckBtn"' + (s.code ? '' : ' disabled') + '>Check connection</button>' +
      '<span class="muted small" id="phoneCheckResult">' + esc(lastCheck) + '</span></div>';

    var voiceOpts = (ch.voices || []).map(function (v) {
      return '<option value="' + esc(v.id) + '"' + (p.voice === v.id ? ' selected' : '') + '>' + esc(v.label) + '</option>';
    }).join('');
    var step3 = '<form id="phonePersonaliseForm" class="channel-form">' +
      '<div class="channel-grid">' +
      '<label>Assistant name callers hear<input name="agent_name" maxlength="40" value="' + esc(p.agent_name || '') + '" placeholder="Marie" required /></label>' +
      '<label>Voice<select name="voice">' + voiceOpts + '</select></label>' +
      '</div>' +
      '<label>Greeting (first thing callers hear)<input name="greeting" maxlength="300" value="' + esc(p.greeting || '') + '" placeholder="Hello po, this is Marie of your company. Paano ko kayo matutulungan?" required /></label>' +
      '<label class="channel-ai"><input type="checkbox" name="address_title"' + (p.address_title !== false ? ' checked' : '') + ' /><span><b>Address callers as Sir / Ma\'am + first name</b> — for example "Sir John", "Ma\'am Maria"</span></label>' +
      '<details><summary style="cursor:pointer">If the system has a problem <span class="muted small">' + (p.fallback_line ? 'custom line set' : 'default line · edit') + '</span></summary>' +
        '<p class="muted small">What the assistant says if it cannot reach your business system during a call. Tell callers where else they can reach you.</p>' +
        '<label class="full">Line callers hear<input name="fallback_line" maxlength="300" value="' + esc(p.fallback_line || '') + '" placeholder="Sorry, our system is having a problem right now. Please message us on our Facebook page or website, or send us an email, and our team will get back to you." /></label>' +
      '</details>' +
      '<details><summary style="cursor:pointer">Business hours <span class="muted small">' + (p.hours_days ? esc(p.hours_days + ' ' + (p.hours_open || '') + '–' + (p.hours_close || '')) : 'not set · add') + '</span></summary><div class="channel-grid">' +
        '<label>Days open<input name="hours_days" maxlength="60" value="' + esc(p.hours_days || '') + '" placeholder="Mon–Sat" /></label>' +
        '<label>Opens<input name="hours_open" type="time" value="' + esc(p.hours_open || '') + '" /></label>' +
        '<label>Closes<input name="hours_close" type="time" value="' + esc(p.hours_close || '') + '" /></label>' +
        '<label>After hours<select name="after_hours">' +
          '<option value="answer"' + (p.after_hours !== 'message' ? ' selected' : '') + '>Answer and record the request</option>' +
          '<option value="message"' + (p.after_hours === 'message' ? ' selected' : '') + '>Take a message for the next business day</option>' +
        '</select></label></div></details>' +
      '<details><summary style="cursor:pointer">Words callers often say <span class="muted small">' + ((p.asr_words || []).length ? (p.asr_words.length + ' words · show') : 'none · add') + '</span></summary>' +
        '<p class="muted small">Product names, brands, branches and places. They help the assistant hear these words correctly on a noisy phone line. Keep it short — only words that get misheard.</p>' +
        '<textarea name="asr_words" rows="3" style="width:100%" placeholder="toner, ink, Ricoh, Brother, serial number">' + esc((p.asr_words || []).join(', ')) + '</textarea>' +
        '<div class="channel-actions"><button class="button button-soft" type="button" id="phoneSuggestWords">Suggest from my knowledge base</button><span class="muted small" id="phoneSuggestOut"></span></div></details>' +
      '<div class="channel-actions"><button class="button button-primary" type="submit">Save</button></div></form>' +
      '<details class="channel-instructions"><summary style="cursor:pointer"><b>Extra instructions for phone calls</b> <span class="muted small">' + (ch.instructions ? 'set · show' : 'none · add') + '</span></summary>' +
        '<textarea data-instr="mobile_phone" rows="4" maxlength="2000" style="width:100%" placeholder="Example: Always ask for the machine serial number.">' + esc(ch.instructions || '') + '</textarea>' +
        '<button class="button button-soft" type="button" data-instr-save="mobile_phone" style="margin-top:6px">Save instructions</button></details>';

    function tick(name, label, hint) {
      var on = p[name] !== false;
      return '<label class="channel-ai"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + ' /><span><b>' + label + '</b>' + (hint ? ' — ' + hint : '') + '</span></label>';
    }
    var step4 = '<form id="phoneActionsForm" class="channel-form">' +
      tick('allow_sms', 'Send text messages', 'confirmations and reference numbers by SMS') +
      tick('allow_booking', 'Book appointments', 'into your Bookings calendar') +
      tick('allow_tickets', 'Create service requests', 'into your business system, the same way your chat assistant does') +
      '<label>Who gets alerted when the assistant needs help<input name="alert_contact" maxlength="120" value="' + esc(p.alert_contact || '') + '" placeholder="Name and mobile or email of your staff" /></label>' +
      '<div class="channel-actions"><button class="button button-primary" type="submit">Save</button></div></form>' +
      callOrderBlock(ch.call_order);

    var who = esc(p.agent_name || 'your assistant');
    var num = esc(d.phone_number || 'your number');
    var lastCall = d.last_call_at
      ? 'Last call: ' + when(d.last_call_at) + ' from ' + esc(d.last_call_from || 'unknown') + ' · ' + esc(d.last_call_seconds || 0) + ' seconds' + (d.last_call_mode === 'test' ? ' (test)' : '')
      : 'No calls yet.';
    var step5 = ch.enabled
      ? '<p>✅ <b>Live.</b> ' + who + ' answers every call to <b>' + num + '</b>.</p>' +
        '<p class="muted small">' + lastCall + '</p>' +
        '<button class="button button-soft" type="button" id="phonePauseBtn">Pause — back to test mode</button>'
      : '<form id="phoneTestForm" class="channel-form"><label>Your test mobile number(s) <span class="muted small">— until you go live, only these numbers reach ' + who + '</span>' +
          '<input name="test_numbers" value="' + esc((p.test_numbers || []).join(', ')) + '" placeholder="0917 123 4567" /></label>' +
          '<div class="channel-actions"><button class="button button-soft" type="submit">Save test numbers</button></div></form>' +
        '<p><b>Make a test call:</b> from your test number, call <b>' + num + '</b>. ' + who + ' answers with your greeting.</p>' +
        '<p class="muted small">' + lastCall + ' <button class="button button-soft" type="button" id="phoneRefreshBtn">Refresh</button></p>' +
        '<div class="channel-actions"><button class="button button-primary" type="button" id="phoneGoLiveBtn">Go live</button>' +
        '<span class="muted small">Then everyone who calls ' + num + ' reaches ' + who + '.</span></div>';

    return '<div class="phone-setup">' +
      stepBlock(1, 'Enter your setup code', s.code, current === 1, step1) +
      stepBlock(2, hosted ? 'Phone line connection (managed by AIStaff)' : 'Plug in your router', s.plug, current === 2, step2) +
      stepBlock(3, 'Personalise your phone assistant', s.personalise, current === 3, step3) +
      stepBlock(4, 'Choose what it can do', s.actions, current === 4, step4) +
      stepBlock(5, ch.enabled ? 'Live' : 'Test and go live', s.golive, current === 5 || ch.enabled, step5) +
      '</div>';
  }

  // Call order: the order the phone assistant collects a request's details (the Director follows it).
  function callOrderBlock(co) {
    if (!co || !co.available) return '';
    var rows = co.steps.map(function (s, i) {
      return '<li class="call-step" data-step="' + esc(s.key) + '" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line,#eee)">' +
        '<span class="muted small" style="width:18px">' + (i + 1) + '.</span>' +
        '<label style="flex:1;display:flex;gap:8px;align-items:center"><input type="checkbox" data-step-on' + (s.on ? ' checked' : '') + (s.required ? ' disabled' : '') + ' /><span>' + esc(s.label) +
        (s.required ? ' <span class="muted small">· required by your system</span>' : '') + '</span></label>' +
        '<button type="button" class="button button-soft" data-step-up title="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="button button-soft" data-step-down title="Move down"' + (i === co.steps.length - 1 ? ' disabled' : '') + '>↓</button></li>';
    }).join('');
    var summary = co.steps.filter(function (s) { return s.on; }).map(function (s) { return s.label.split(' (')[0]; }).join(' → ');
    return '<details class="channel-instructions" id="phoneCallOrder"><summary style="cursor:pointer"><b>Call order</b> <span class="muted small">' + esc(summary) + ' → summary · edit</span></summary>' +
      '<p class="muted small">The order your phone assistant asks for a request\'s details. It keeps anything the caller says early and never asks it again. Open requests always come right after the machine is identified; the summary and saving always come last.</p>' +
      '<ol id="callOrderList" style="list-style:none;padding:0;margin:8px 0">' + rows + '</ol>' +
      '<label class="channel-ai"><input type="checkbox" id="callSerialFirst"' + (co.serial_first ? ' checked' : '') + ' /><span><b>Ask for the serial number first</b> — off: start with the company name, then branch / department</span></label>' +
      '<div class="channel-actions"><button class="button button-primary" type="button" id="callOrderSave">Save call order</button><span class="muted small" id="callOrderOut"></span></div></details>';
  }
  function wireCallOrder() {
    var list = document.getElementById('callOrderList');
    if (!list) return;
    function renumber() {
      Array.prototype.forEach.call(list.children, function (li, i) {
        li.firstChild.textContent = (i + 1) + '.';
        li.querySelector('[data-step-up]').disabled = i === 0;
        li.querySelector('[data-step-down]').disabled = i === list.children.length - 1;
      });
    }
    list.onclick = function (event) {
      var li = event.target.closest('li.call-step');
      if (!li) return;
      if (event.target.hasAttribute('data-step-up') && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
      if (event.target.hasAttribute('data-step-down') && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
      renumber();
    };
    document.getElementById('callOrderSave').onclick = function () {
      var order = Array.prototype.map.call(list.children, function (li) { return { key: li.getAttribute('data-step'), on: li.querySelector('[data-step-on]').checked }; });
      openCards.mobile_phone = true;
      save('mobile_phone', { pitch: { call_order: order, call_serial_first: document.getElementById('callSerialFirst').checked } }, 'Call order saved. The next call follows it.');
    };
  }
  function wireMobile() {
    wireCallOrder();
    var sw = document.getElementById('phoneSuggestWords');
    if (sw) sw.onclick = async function () {
      var out = document.getElementById('phoneSuggestOut');
      var box = document.querySelector('#phonePersonaliseForm textarea[name=asr_words]');
      sw.disabled = true; out.textContent = 'Reading your knowledge base…';
      try {
        var r = await api('/api/channels/mobile_phone/word-suggestions');
        var have = box.value.split(/[,;\n]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
        var add = (r.words || []).filter(function (w) { return have.indexOf(w.toLowerCase()) < 0; });
        if (add.length) box.value = (box.value.trim() ? box.value.trim().replace(/,\s*$/, '') + ', ' : '') + add.join(', ');
        out.textContent = add.length ? 'Added ' + add.length + ' suggestions — remove any that are not needed, then Save.' : 'No new words found.';
      } catch (e) { out.textContent = e.message || 'Could not read the knowledge base'; }
      sw.disabled = false;
    };
    var tf = document.getElementById('phoneTestForm');
    if (tf) tf.onsubmit = function (event) {
      event.preventDefault(); openCards.mobile_phone = true;
      save('mobile_phone', { pitch: { test_numbers: tf.test_numbers.value } }, 'Test numbers saved — call your line now');
    };
    var rf = document.getElementById('phoneRefreshBtn');
    if (rf) rf.onclick = function () { openCards.mobile_phone = true; window.channelsSettingsView(); };
    var gl = document.getElementById('phoneGoLiveBtn');
    if (gl) gl.onclick = function () {
      if (!window.confirm('Go live? From now on everyone who calls your number reaches your AI phone assistant.')) return;
      openCards.mobile_phone = true; save('mobile_phone', { enabled: true }, 'Your phone assistant is live');
    };
    var pb = document.getElementById('phonePauseBtn');
    if (pb) pb.onclick = function () {
      if (!window.confirm('Pause? Only your test numbers will reach the assistant until you go live again.')) return;
      openCards.mobile_phone = true; save('mobile_phone', { enabled: false }, 'Back to test mode');
    };
    var claim = document.getElementById('phoneClaimForm');
    if (claim) claim.onsubmit = async function (event) {
      event.preventDefault();
      openCards.mobile_phone = true;
      try {
        await api('/api/channels/mobile_phone/claim', { method: 'POST', body: { code: claim.code.value } });
        toast('Router linked to your account');
      } catch (error) { toast(error.message || 'Could not link the router'); return; }
      await window.channelsSettingsView();
    };
    var check = document.getElementById('phoneCheckBtn');
    if (check) check.onclick = async function () {
      check.disabled = true; check.textContent = 'Checking…';
      openCards.mobile_phone = true;
      try {
        var r = await api('/api/channels/mobile_phone/check', { method: 'POST' });
        toast(r.check && r.check.ok ? 'Router is reachable' : (r.check && r.check.detail) || 'Router did not answer');
      } catch (error) { toast(error.message || 'Check failed'); }
      await window.channelsSettingsView();
    };
    var pf = document.getElementById('phonePersonaliseForm');
    if (pf) pf.onsubmit = function (event) {
      event.preventDefault();
      openCards.mobile_phone = true;
      save('mobile_phone', { pitch: { address_title: pf.address_title ? pf.address_title.checked : true, agent_name: pf.agent_name.value, greeting: pf.greeting.value, fallback_line: pf.fallback_line ? pf.fallback_line.value : undefined, voice: pf.voice.value,
        hours_days: pf.hours_days.value, hours_open: pf.hours_open.value, hours_close: pf.hours_close.value, after_hours: pf.after_hours.value, asr_words: pf.asr_words.value } }, 'Phone assistant saved');
    };
    var af = document.getElementById('phoneActionsForm');
    if (af) af.onsubmit = function (event) {
      event.preventDefault();
      openCards.mobile_phone = true;
      save('mobile_phone', { pitch: { allow_sms: af.allow_sms.checked, allow_booking: af.allow_booking.checked, allow_tickets: af.allow_tickets.checked,
        alert_contact: af.alert_contact.value, actions_saved: true } }, 'Saved what your phone assistant can do');
    };
  }

  function card(ch, data) {
    var info = INFO[ch.key];
    var later = ch.state === 'later';
    var ticked = ch.key === 'email' ? (ch.enabled || openCards.email) : ch.key === 'mobile_phone' ? (openCards.mobile_phone !== false && Boolean(ch.device || openCards.mobile_phone)) : ch.enabled;
    var showBody = later ? false : (ticked || (ch.key === 'facebook_messenger' && !ch.page_name) || (ch.key === 'email' && ch.config.address) || (ch.key === 'website_chat' && ch.public_key) || (ch.key === 'mobile_phone' && ticked));
    if (openCards[ch.key] === true) showBody = true;
    var body = ch.key === 'facebook_messenger' ? facebookBody(ch) : ch.key === 'email' ? emailBody(ch, data) : ch.key === 'website_chat' ? chatBody(ch) : ch.key === 'mobile_phone' ? mobileBody(ch) : laterBody(ch);
    return [
      '<section class="panel channel-card' + (later ? ' is-later' : '') + '" data-card="' + ch.key + '">',
      '<div class="channel-head">',
      '<label class="channel-tick"><input type="checkbox" data-tick="' + ch.key + '"' + (ticked ? ' checked' : '') + (later ? ' disabled' : '') + ' />',
      '<span><b>' + info[0] + '</b><small>' + info[1] + '</small></span></label>',
      badge(ch.state),
      '</div>',
      '<div class="channel-body"' + (showBody || later ? '' : ' hidden') + '>' + body + '</div>',
      '</section>'
    ].join('');
  }

  async function save(key, body, message) {
    try {
      await api('/api/channels/' + key, { method: 'PUT', body: body });
      if (message) toast(message);
    } catch (error) {
      toast(error.message || 'Could not save');
    }
    await window.channelsSettingsView();
  }

  function formValues(form) {
    var fd = new FormData(form);
    var config = {};
    ['address', 'sender_name', 'provider', 'imap_host', 'imap_port', 'smtp_host', 'smtp_port', 'username', 'signature'].forEach(function (k) { config[k] = fd.get(k) || ''; });
    return { config: config, password: fd.get('password') || '' };
  }

  window.channelsSettingsView = async function () {
    setTitle('Channels');
    var data = await api('/api/channels');
    var email = data.channels.find(function (c) { return c.key === 'email'; });
    $('#adminContent').innerHTML = [
      settingsTabs('channels'),
      '<div class="settings-stack channels-page">',
      '<section class="panel"><div class="panel-header"><div><p class="eyebrow">Where customers reach you</p><h2>Channels</h2></div></div>',
      '<p class="muted">Tick a channel to see its settings. Unticking pauses it and keeps the settings. Every channel is handled by the same Closer and the same workflows.</p></section>',
      data.channels.map(function (ch) { return card(ch, data); }).join(''),
      '</div>'
    ].join('');

    document.querySelectorAll('[data-tick]').forEach(function (box) {
      box.onchange = async function () {
        var key = box.getAttribute('data-tick');
        var ch = data.channels.find(function (c) { return c.key === key; });
        if (key === 'mobile_phone') { openCards.mobile_phone = box.checked; box.closest('.channel-card').querySelector('.channel-body').hidden = !box.checked; return; }
        if (key === 'email' && box.checked && !ch.enabled) {
          openCards.email = true;
          box.closest('.channel-card').querySelector('.channel-body').hidden = false;
          return;
        }
        if (key === 'website_chat' && box.checked && !ch.enabled && !(ch.allowed_origins || []).length) {
          openCards.website_chat = true;
          box.checked = false;
          box.closest('.channel-card').querySelector('.channel-body').hidden = false;
          toast('Add your website address and save first.');
          return;
        }
        if (!box.checked) {
          if (key === 'email' && !ch.enabled) { openCards.email = false; return window.channelsSettingsView(); }
          if (!window.confirm('Pause ' + INFO[key][0] + '? Closer stops answering there; your settings are kept.')) { box.checked = true; return; }
          openCards[key] = false;
          return save(key, { enabled: false }, INFO[key][0] + ' paused');
        }
        return save(key, { enabled: true }, INFO[key][0] + ' turned on');
      };
    });

    var chatForm = document.getElementById('chatChannelForm');
    if (chatForm) chatForm.onsubmit = function (event) {
      event.preventDefault();
      openCards.website_chat = true;
      save('website_chat', { widget: { allowed_origins: chatForm.allowed_origins.value, greeting: chatForm.greeting.value, color: chatForm.color.value } }, 'Website chat saved');
    };

    document.querySelectorAll('[data-instr-save]').forEach(function (button) {
      button.onclick = function () {
        var key = button.getAttribute('data-instr-save');
        var box = document.querySelector('[data-instr="' + key + '"]');
        save(key, { instructions: box ? box.value : '' }, INFO[key][0] + ': channel instructions saved');
      };
    });

    document.querySelectorAll('[data-style]').forEach(function (select) {
      select.onchange = function () {
        var key = select.getAttribute('data-style');
        save(key, { reply_style: select.value }, INFO[key][0] + ': ' + (select.value === 'formal' ? 'formal' : 'casual') + ' replies');
      };
    });

    document.querySelectorAll('[data-ai]').forEach(function (box) {
      box.onchange = function () {
        var key = box.getAttribute('data-ai');
        save(key, { ai_replies: box.checked }, 'AI replies ' + (box.checked ? 'on' : 'off') + ' for ' + INFO[key][0]);
      };
    });

    wireMobile();

    var form = document.getElementById('emailChannelForm');
    if (!form) return;
    form.provider.onchange = function () {
      var p = data.providers[form.provider.value];
      if (p && p.imap_host) { form.imap_host.value = p.imap_host; form.imap_port.value = p.imap_port; form.smtp_host.value = p.smtp_host; form.smtp_port.value = p.smtp_port; }
      else form.querySelector('.channel-servers').open = true;
    };
    form.onsubmit = async function (event) {
      event.preventDefault();
      var v = formValues(form);
      openCards.email = true;
      await save('email', v.password ? { config: v.config, password: v.password } : { config: v.config }, 'Email settings saved' + (email.enabled ? '' : ' — now run Test connection'));
    };
    var testBtn = document.getElementById('emailTestBtn');
    if (testBtn) testBtn.onclick = async function () {
      var v = formValues(form);
      var out = document.getElementById('emailTestResult');
      if (!v.config.address) { out.innerHTML = '<div class="channel-test bad">\u2716 Type the inbox email address first.</div>'; return; }
      if (!v.password && !email.has_password) { out.innerHTML = '<div class="channel-test bad">\u2716 Type the mailbox password first.</div>'; return; }
      testBtn.disabled = true;
      testBtn.textContent = 'Testing…';
      try {
        // Save what is on screen first, so the test checks exactly these settings.
        await api('/api/channels/email', { method: 'PUT', body: v.password ? { config: v.config, password: v.password } : { config: v.config } });
        var r = await api('/api/channels/email/test', { method: 'POST' });
        openCards.email = true;
        await window.channelsSettingsView();
        out = document.getElementById('emailTestResult');
        out.innerHTML = r.ok
          ? '<div class="channel-test ok">✔ Connected. Reading mail works (' + esc(r.imap.messages) + ' messages in the inbox) and sending mail works. You can turn on email replies now.</div>'
          : '<div class="channel-test bad">✖ ' + esc(r.error) + '</div>';
      } catch (error) {
        out.innerHTML = '<div class="channel-test bad">✖ ' + esc(error.message) + '</div>';
        testBtn.disabled = false;
        testBtn.textContent = 'Test connection';
      }
    };
    var enableBtn = document.getElementById('emailEnableBtn');
    if (enableBtn) enableBtn.onclick = function () {
      if (!window.confirm('Turn on email replies? Closer will answer NEW emails that arrive in ' + email.config.address + ' from now on. Older emails in the inbox are not answered.')) return;
      save('email', { enabled: true }, 'Email replies are on');
    };
  };
})();
