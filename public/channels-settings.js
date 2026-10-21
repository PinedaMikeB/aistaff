/* Settings > Channels (added 2026-10-20). Checkbox cards; ticking a card reveals its settings.
   Facebook Messenger: status + link to the EXISTING Facebook Page Connection tab (never changed here). */
(function () {
  'use strict';

  var STATE = {
    off: ['Off', 'inactive'], needs_setup: ['Needs setup', 'warn'], paused: ['Paused', 'inactive'],
    connected: ['Connected', 'active'], problem: ['Problem', 'bad'], later: ['Set up later', 'inactive']
  };
  var INFO = {
    facebook_messenger: ['Facebook Messenger', 'Closer answers messages sent to your Facebook Page.'],
    email: ['Email', 'Closer reads your customer-service inbox and replies from that address, in the same email thread.'],
    website_chat: ['Website Chat Widget', 'A chat box on your website, answered by Closer.'],
    mobile_phone: ['Mobile Phone', 'Calls and SMS through AIStaff’s own VoLTE line (the same router Pitch uses).']
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

  function card(ch, data) {
    var info = INFO[ch.key];
    var later = ch.state === 'later';
    var ticked = ch.key === 'email' ? (ch.enabled || openCards.email) : ch.enabled;
    var showBody = later ? false : (ticked || (ch.key === 'facebook_messenger' && !ch.page_name) || (ch.key === 'email' && ch.config.address) || (ch.key === 'website_chat' && ch.public_key));
    if (openCards[ch.key] === true) showBody = true;
    var body = ch.key === 'facebook_messenger' ? facebookBody(ch) : ch.key === 'email' ? emailBody(ch, data) : ch.key === 'website_chat' ? chatBody(ch) : laterBody(ch);
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
