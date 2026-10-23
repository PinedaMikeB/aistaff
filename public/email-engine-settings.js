/* Settings › Email Engine (added 2026-10-22). Send one email to many people.
   Simple on top (status + campaigns + "New email"); contacts, do-not-email list and
   sending settings are folded below. Also: Platform › Email Engine panel for AIStaff staff. */
(function () {
  'use strict';

  var STATUS = {
    draft: ['Draft', 'inactive'], sending: ['Sending', 'active'], paused: ['Paused', 'warn'],
    done: ['Finished', 'active'], cancelled: ['Stopped', 'inactive']
  };
  var view = { composing: null, timer: null, contactsList: '', contactsQ: '' };

  function esc(v) { return escapeHtml(v == null ? '' : String(v)); }
  function when(iso) { return iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
  function badge(s) { var x = STATUS[s] || [s, 'inactive']; return '<span class="channel-state ' + x[1] + '"><i></i>' + esc(x[0]) + '</span>'; }
  function n(v) { return Number(v || 0).toLocaleString('en-PH'); }
  function minutes(count, rate) { var m = Math.ceil(count / Math.max(1, rate)); return m < 90 ? m + ' min' : (Math.round(m / 6) / 10) + ' hours'; }

  function progress(c) {
    var done = c.sent + c.failed + c.skipped;
    var pct = c.total ? Math.round(done * 100 / c.total) : 0;
    return '<div style="height:8px;background:#eef0f4;border-radius:99px;overflow:hidden;margin:8px 0 4px"><div style="height:100%;width:' + pct + '%;background:#5b4bdb"></div></div>' +
      '<p class="muted small" style="margin:0"><b>' + n(c.sent) + '</b> sent of ' + n(c.total) + (c.failed ? ' · <span style="color:#b42318">' + n(c.failed) + ' failed</span>' : '') +
      (c.skipped ? ' · ' + n(c.skipped) + ' skipped' : '') + (c.pending ? ' · ' + n(c.pending) + ' waiting' : '') + '</p>';
  }

  function campaignCard(c, data) {
    var actions = [];
    if (c.status === 'draft') actions.push('<button class="button button-primary" data-open="' + c.id + '">Continue</button>', '<button class="button button-soft" data-del="' + c.id + '">Delete draft</button>');
    if (c.status === 'sending') actions.push('<button class="button button-soft" data-act="pause" data-id="' + c.id + '">Pause</button>');
    if (c.status === 'paused') actions.push('<button class="button button-primary" data-act="resume" data-id="' + c.id + '">Resume</button>');
    if (c.status === 'sending' || c.status === 'paused') actions.push('<button class="button button-soft" data-act="cancel" data-id="' + c.id + '">Stop</button>');
    if (c.failed && c.status !== 'draft') actions.push('<button class="button button-soft" data-act="retry-failed" data-id="' + c.id + '">Retry failed</button>');
    actions.push('<button class="button button-soft" data-copy="' + c.id + '">Copy as new</button>');
    var note = '';
    if (c.status === 'paused' && c.last_error && c.pause_reason !== 'manual') note = '<div class="settings-warning"><b>Paused:</b> ' + esc(c.last_error) + '</div>';
    if (c.status === 'sending' && c.waiting) note = '<p class="muted small">⏳ ' + esc(c.waiting) + '</p>';
    if (c.status === 'sending' && !c.waiting && c.pending) note = '<p class="muted small">' + (c.pace_count ? 'Pace ' + esc(window.EEOutreach.paceText(c)) + '.' : 'About ' + minutes(c.pending, data.rate_per_minute) + ' left at ' + data.rate_per_minute + ' per minute.') + '</p>';
    return '<section class="panel channel-card"><div class="channel-head"><div><b>' + esc(c.name) + '</b><br><small class="muted">' + esc(c.subject) +
      (c.from_address ? ' · from ' + esc(c.from_address) : '') + ' · ' + (c.started_at ? 'started ' + when(c.started_at) : 'created ' + when(c.created_at)) + '</small></div>' + badge(c.status) + '</div>' +
      (c.status !== 'draft' || c.total ? progress(c) : '') + note +
      '<div class="channel-actions" style="margin-top:10px">' + actions.join('') + '</div>' +
      (c.status !== 'draft' ? '<details data-details="' + c.id + '"><summary style="cursor:pointer" class="small">Details</summary><div class="ee-details muted small">Loading…</div></details>' : '') +
      (c.status === 'sending' || c.status === 'paused' ? '<details><summary style="cursor:pointer" class="small">Pace <span class="muted">' + esc(window.EEOutreach.paceText(c)) + '</span></summary><form class="channel-form" data-b-pace="' + c.id + '">' + window.EEOutreach.paceFieldset(c) + '<div class="channel-actions"><button class="button button-primary" type="submit">Save pace</button></div></form></details>' : '') +
      '</section>';
  }

  function senderLine(data) {
    if (data.platform.paused_all) return '<div class="settings-warning"><b>Sending is paused by AIStaff</b>' + (data.platform.pause_note ? ': ' + esc(data.platform.pause_note) : '') + '. Campaigns continue when it is turned back on.</div>';
    if (!data.sender.ok) return '<div class="settings-warning"><b>Not ready to send:</b> ' + esc(data.sender.problem) + '</div>';
    var t = data.today;
    return '<p style="margin:0">Sending from <b>' + esc(data.sender.sender_name) + ' &lt;' + esc(data.sender.address) + '&gt;</b> ' + badge('done').replace('Finished', 'Ready') + '</p>' +
      '<p class="muted small" style="margin:6px 0 0">Today: <b>' + n(t.left) + '</b> more campaign emails allowed (' + n(t.limit) + '/day' + (t.reserve ? ', ' + n(t.reserve) + ' kept for Closer replies' : '') +
      ', ' + n(t.campaign_sent_24h) + ' campaign emails sent in the last 24 hours) · ' + data.rate_per_minute + ' per minute · replies go to this inbox and Closer answers them.</p>';
  }

  function composer(data, c) {
    c = c || { name: '', subject: '', body_text: '' };
    var lists = data.lists.map(function (l) { return '<option value="' + esc(l.name) + '">' + esc(l.name) + ' (' + n(l.count) + ')</option>'; }).join('');
    return '<section class="panel" id="eeComposer"><div class="panel-header"><div><p class="eyebrow">' + (c.id ? 'Draft' : 'New email') + '</p><h2>' + (c.id ? esc(c.name) : 'Write the email') + '</h2></div></div>' +
      '<form id="eeForm" class="channel-form">' +
      '<label>Subject<input name="subject" maxlength="250" required value="' + esc(c.subject) + '" placeholder="Example: Our new official channels for service requests" /></label>' +
      '<label>Message<textarea name="body_text" rows="12" required style="width:100%" placeholder="Dear {{name|Valued Customer}},&#10;&#10;…">' + esc(c.body_text) + '</textarea></label>' +
      '<details style="margin:-4px 0 10px"><summary style="cursor:pointer" class="muted small">Personalise (optional)</summary><p class="muted small">' +
      '<code>{{name}}</code> the person\'s name · <code>{{name|Valued Customer}}</code> name, or the words after | when there is no name · <code>{{first_name}}</code> · <code>{{organization}}</code>. ' +
      'Links (https://…) become clickable. Your Email channel signature and an unsubscribe link are added at the bottom automatically.</p></details>' +
      '<label>Campaign name <span class="muted small">(only you see this)</span><input name="name" maxlength="120" value="' + esc(c.name) + '" placeholder="Defaults to the subject" /></label>' +
      '<fieldset style="border:1px solid #eceaf2;border-radius:10px;padding:10px 14px;margin:6px 0 12px"><legend class="small"><b>Who gets it</b></legend>' +
      '<label class="ee-choice"><input type="radio" name="source" value="all" ' + (data.contacts ? 'checked' : 'disabled') + '> All contacts (' + n(data.contacts) + ')</label>' +
      (lists ? '<label class="ee-choice"><input type="radio" name="source" value="list"> A list: <select name="list">' + lists + '</select></label>' : '') +
      '<label class="ee-choice"><input type="radio" name="source" value="paste" ' + (data.contacts ? '' : 'checked') + '> Paste addresses</label>' +
      '<div id="eePaste"' + (data.contacts ? ' hidden' : '') + '><textarea name="paste" rows="5" style="width:100%" placeholder="One per line. Also works: Juan Cruz <juan@company.com>  or  juan@company.com, Juan Cruz, ABC Corp  (rows copied from Excel)"></textarea>' +
      '<label style="flex-direction:row;align-items:center;gap:8px;font-weight:500;margin-top:6px">Also save them as contacts in list <input name="save_list" placeholder="e.g. Marga customers" style="max-width:220px"></label></div>' +
      '<p class="muted small" style="margin:4px 0 0">People on the do-not-email list (' + n(data.blocked) + ') are skipped automatically. Each person gets their own email — nobody sees the other addresses.</p></fieldset>' +
      window.EEOutreach.paceFieldset(c) +
      '<div id="eeCheck"></div>' +
      '<div class="channel-actions"><button class="button button-soft" type="submit" name="save">Save draft</button>' +
      '<input name="test_to" type="email" placeholder="Test address" value="' + esc(data.settings.test_address) + '" style="max-width:230px"> <button class="button button-soft" type="button" id="eeTest">Send me a test</button>' +
      '<button class="button button-primary" type="button" id="eeSend">Review and send…</button>' +
      '<button class="button button-soft" type="button" id="eeClose">Close</button></div>' +
      '</form></section>';
  }

  function contactsSection(data) {
    return '<details class="panel channel-card" id="eeContactsBox"><summary style="cursor:pointer"><b>Contacts</b> <small class="muted">' + n(data.contacts) + ' saved' + (data.lists.length ? ' · ' + data.lists.length + ' list' + (data.lists.length > 1 ? 's' : '') : '') + '</small></summary>' +
      '<div style="margin-top:12px">' +
      '<details><summary style="cursor:pointer"><b>+ Add contacts</b> <span class="muted small">paste or copy rows from Excel</span></summary><form id="eeImport" class="channel-form" style="margin-top:8px">' +
      '<textarea name="text" rows="6" style="width:100%" placeholder="email, name, company — one per line"></textarea>' +
      '<label>Put them in list <span class="muted small">(optional)</span><input name="list" placeholder="e.g. Marga customers" style="max-width:260px"></label>' +
      '<div class="channel-actions"><button class="button button-primary" type="submit">Add contacts</button></div></form></details>' +
      '<p class="small" style="margin:10px 0"><button class="button button-soft" type="button" id="eeImportCloser">Add emails Closer already collected</button> <span class="muted">customers who gave their email in Messenger, email, website chat or phone</span></p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0"><input id="eeQ" placeholder="Search name, email, company" value="' + esc(view.contactsQ) + '" style="max-width:260px">' +
      '<select id="eeListFilter"><option value="">All lists</option>' + data.lists.map(function (l) { return '<option' + (view.contactsList === l.name ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') + '</select></div>' +
      '<div id="eeContacts" class="small muted">Open to load…</div></div></details>';
  }

  function blockedSection(data) {
    return '<details class="panel channel-card" id="eeBlockedBox"><summary style="cursor:pointer"><b>Do-not-email list</b> <small class="muted">' + n(data.blocked) + ' address' + (data.blocked === 1 ? '' : 'es') + ' · unsubscribed, bounced or added by you</small></summary>' +
      '<form id="eeBlockForm" class="channel-form" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><input name="text" placeholder="email@company.com" style="max-width:260px"><button class="button button-soft" type="submit">Add</button></form>' +
      '<div id="eeBlocked" class="small muted">Open to load…</div></details>';
  }

  function settingsSection(data) {
    var s = data.settings, m = s.mailbox;
    return '<details class="panel channel-card"><summary style="cursor:pointer"><b>Sending settings</b> <small class="muted">' + (s.sender_mode === 'mailbox' ? 'separate mailbox ' + esc(m.address) : 'your Email channel inbox') + ' · ' + s.per_minute + '/min · ' + n(s.mailbox_daily_limit) + '/day</small></summary>' +
      '<form id="eeSettings" class="channel-form" style="margin-top:12px">' +
      '<p class="small"><b>Send from</b></p>' +
      '<label class="ee-choice"><input type="radio" name="sender_mode" value="channel"' + (s.sender_mode !== 'mailbox' ? ' checked' : '') + '> The inbox in Settings › Channels › Email <span class="muted">(recommended — replies reach Closer)</span></label>' +
      '<label class="ee-choice"><input type="radio" name="sender_mode" value="mailbox"' + (s.sender_mode === 'mailbox' ? ' checked' : '') + '> A separate sending mailbox (e.g. news@yourcompany.com)</label>' +
      '<div id="eeMailbox"' + (s.sender_mode === 'mailbox' ? '' : ' hidden') + ' style="border:1px solid #eceaf2;border-radius:10px;padding:10px 14px;margin:6px 0 12px"><div class="channel-grid">' +
      '<label>Mailbox address<input name="mb_address" type="email" value="' + esc(m.address) + '"></label>' +
      '<label>Sender name customers see<input name="mb_sender_name" value="' + esc(m.sender_name) + '"></label>' +
      '<label>Password ' + (m.has_password ? '<span class="muted small">(saved — type only to change)</span>' : '') + '<input name="mb_password" type="password" autocomplete="new-password"></label></div>' +
      '<details><summary style="cursor:pointer" class="muted small">Server (Hostinger is filled in)</summary><div class="channel-grid">' +
      '<label>Login username<input name="mb_username" value="' + esc(m.username) + '" placeholder="same as address"></label>' +
      '<label>Outgoing (SMTP) server<input name="mb_smtp_host" value="' + esc(m.smtp_host) + '"></label>' +
      '<label>Port<input name="mb_smtp_port" type="number" value="' + esc(m.smtp_port) + '"></label></div></details>' +
      '<p class="small">' + (m.tested ? '<span class="channel-state active"><i></i>Test passed ' + when(m.tested_at) + '</span>' : '<span class="channel-state warn"><i></i>Not tested</span>') +
      ' <button class="button button-soft" type="button" id="eeMbTest">Test connection</button></p><div id="eeMbResult"></div></div>' +
      '<div class="channel-grid">' +
      '<label>Emails per minute<input name="per_minute" type="number" min="1" max="120" value="' + s.per_minute + '"><span class="muted small">Slower is safer for your mailbox reputation. AIStaff maximum: ' + data.platform.max_per_minute + '.</span></label>' +
      '<label>Daily limit of the mailbox<input name="mailbox_daily_limit" type="number" min="10" value="' + s.mailbox_daily_limit + '"><span class="muted small">From your email plan. Hostinger: Business Starter 1,000 · Premium 3,000 · free/trial 100.</span></label>' +
      '<label>Keep free each day for Closer<input name="reserve_for_closer" type="number" min="0" value="' + s.reserve_for_closer + '"><span class="muted small">So customer replies and status emails always go out.</span></label></div>' +
      '<details><summary style="cursor:pointer" class="small"><b>Footer and unsubscribe</b></summary>' +
      '<label>Footer under every email <span class="muted small">(e.g. company address, why they get this email)</span><textarea name="footer_text" rows="3" style="width:100%">' + esc(s.footer_text) + '</textarea></label>' +
      '<div class="channel-grid"><label>Unsubscribe link text<input name="unsubscribe_label" value="' + esc(s.unsubscribe_label) + '"></label>' +
      '<label>Replies go to <span class="muted small">(blank = the sending inbox)</span><input name="reply_to" type="email" value="' + esc(s.reply_to) + '"></label></div></details>' +
      '<div class="channel-actions"><button class="button button-primary" type="submit">Save settings</button></div></form></details>';
  }

  async function render() {
    var data = await api('/api/email-engine');
    view.data = data;
    var active = data.campaigns.filter(function (c) { return c.status !== 'draft'; });
    var drafts = data.campaigns.filter(function (c) { return c.status === 'draft'; });
    var composing = view.composing === 'new' ? {} : (view.composing ? data.campaigns.find(function (c) { return c.id === view.composing; }) : null);
    $('#adminContent').innerHTML = [
      settingsTabs('email-engine'),
      '<div class="settings-stack channels-page">',
      '<section class="panel"><div class="panel-header"><div><p class="eyebrow">Email marketing · step 1</p><h2>Email Engine</h2></div>',
      composing ? '' : '<div class="channel-actions" style="margin:0"><button class="button button-primary" id="eeNew" type="button">New email</button><button class="button button-soft" id="eeNewOutreach" type="button" title="One-to-one emails to businesses, written by AI for each company">New outreach</button></div>', '</div>',
      senderLine(data), '</section>',
      composing ? composer(data, composing.id ? composing : null) : '',
      drafts.map(function (c) { return c.kind === 'outreach' ? window.EEOutreach.card(c, data) : campaignCard(c, data); }).join(''),
      active.length ? active.map(function (c) { return c.kind === 'outreach' ? window.EEOutreach.card(c, data) : campaignCard(c, data); }).join('') : (drafts.length || composing ? '' : '<section class="panel"><p class="muted">No emails sent yet. Press <b>New email</b> to write one.</p></section>'),
      contactsSection(data), blockedSection(data), settingsSection(data), window.EEOutreach.settingsSection(data),
      '</div>'
    ].join('');
    wire(data, composing);
    clearTimeout(view.timer);
    if (data.campaigns.some(function (c) { return c.status === 'sending'; })) view.timer = setTimeout(poll, 15000);
  }

  // Refresh progress every 15 s while sending — but never while the person is typing or reading something open.
  function poll() {
    if (location.pathname.indexOf('/settings/email-engine') === -1) return;
    if (document.querySelector('#eeComposer') || document.querySelector('#adminContent details[open]') || document.hidden) { view.timer = setTimeout(poll, 15000); return; }
    render().catch(function () { view.timer = setTimeout(poll, 30000); });
  }

  function formBody(form) { var b = window.EEOutreach.readPace(form); b.name = form.name.value; b.subject = form.subject.value; b.body_text = form.body_text.value; return b; }

  async function saveDraft(form, composing) {
    var body = formBody(form);
    if (!body.subject.trim() || !body.body_text.trim()) throw new Error('Write a subject and a message first.');
    var r = composing && composing.id ? await api('/api/email-engine/campaigns/' + composing.id, { method: 'PUT', body: body }) : await api('/api/email-engine/campaigns', { method: 'POST', body: body });
    view.composing = r.campaign.id;
    return r.campaign;
  }

  async function chooseRecipients(form, id) {
    var source = form.querySelector('input[name=source]:checked');
    source = source ? source.value : 'paste';
    var body = { source: source, list: form.list ? form.list.value : '', text: form.paste.value, save_list: form.save_list.value };
    if (source === 'paste' && !body.text.trim()) throw new Error('Paste the email addresses first.');
    return api('/api/email-engine/campaigns/' + id + '/recipients', { method: 'POST', body: body });
  }

  function wire(data, composing) {
    var nb = document.getElementById('eeNew');
    if (nb) nb.onclick = function () { view.composing = 'new'; render(); };
    var no = document.getElementById('eeNewOutreach');
    if (no) no.onclick = async function () {
      var name = window.prompt('Name this outreach (only you see it), e.g. "Clinics in Rizal – AI receptionist"', '');
      if (!name) return;
      try { await api('/api/email-engine/campaigns', { method: 'POST', body: { kind: 'outreach', name: name } }); render(); } catch (err) { toast(err.message); }
    };
    window.EEOutreach.wire(data);
    window.EEOutreach.wireSettings();
    document.querySelectorAll('[data-b-pace]').forEach(function (f) {
      f.onsubmit = async function (e) { e.preventDefault(); try { await api('/api/email-engine/campaigns/' + f.getAttribute('data-b-pace'), { method: 'PUT', body: window.EEOutreach.readPace(f) }); toast('Pace saved'); render(); } catch (err) { toast(err.message); } };
    });
    var form = document.getElementById('eeForm');
    if (form) {
      form.querySelectorAll('input[name=source]').forEach(function (r) { r.onchange = function () { document.getElementById('eePaste').hidden = form.querySelector('input[name=source]:checked').value !== 'paste'; }; });
      form.onsubmit = async function (e) { e.preventDefault(); try { await saveDraft(form, composing); toast('Draft saved'); render(); } catch (err) { toast(err.message); } };
      document.getElementById('eeClose').onclick = function () { view.composing = null; render(); };
      document.getElementById('eeTest').onclick = async function () {
        var btn = this; btn.disabled = true; btn.textContent = 'Sending…';
        try {
          var c = await saveDraft(form, composing); composing = c;
          var r = await api('/api/email-engine/campaigns/' + c.id + '/test', { method: 'POST', body: { to: form.test_to.value } });
          toast('Test sent to ' + r.to + ' from ' + r.from);
        } catch (err) { toast(err.message); }
        btn.disabled = false; btn.textContent = 'Send me a test';
      };
      document.getElementById('eeSend').onclick = async function () {
        var btn = this; btn.disabled = true;
        try {
          var c = await saveDraft(form, composing); composing = c;
          var r = await chooseRecipients(form, c.id);
          var t = data.today || { left: 0 };
          var box = document.getElementById('eeCheck');
          box.innerHTML = '<div class="channel-test ok" style="color:#1a2233;background:#f4f2ff"><b>' + n(r.will_send) + '</b> people will get this email' +
            (r.blocked ? ' · ' + n(r.blocked) + ' skipped (do-not-email list)' : '') + (r.invalid_count ? ' · ' + n(r.invalid_count) + ' lines were not valid addresses: ' + esc(r.invalid.join(', ')) : '') +
            '<br><span class="muted small">' + (r.campaign.pace_count ? 'At ' + r.campaign.pace_count + ' every ' + r.campaign.pace_hours + ' hours this takes about ' + Math.ceil(r.will_send / r.campaign.pace_count * r.campaign.pace_hours) + ' hours' + (r.campaign.send_window && r.campaign.send_window.from ? ' of sending time' : '') + '.' : 'At ' + data.rate_per_minute + ' per minute this takes about ' + minutes(r.will_send, data.rate_per_minute) + '.') +
            (data.sender.ok && r.will_send > t.left ? ' Only ' + n(t.left) + ' can go out today; the rest continue automatically in the next days.' : '') + '</span>' +
            '<div class="channel-actions" style="margin-top:8px"><button class="button button-primary" type="button" id="eeConfirm">Send now to ' + n(r.will_send) + '</button></div></div>';
          document.getElementById('eeConfirm').onclick = async function () {
            if (!window.confirm('Send "' + c.subject + '" to ' + r.will_send + ' people now? This cannot be undone (you can pause it).')) return;
            try { await api('/api/email-engine/campaigns/' + c.id + '/send', { method: 'POST' }); toast('Sending started'); view.composing = null; render(); } catch (err) { toast(err.message); }
          };
        } catch (err) { toast(err.message); }
        btn.disabled = false;
      };
    }
    document.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { view.composing = b.getAttribute('data-open'); render().then(function () { var el = document.getElementById('eeComposer'); if (el) el.scrollIntoView({ behavior: 'smooth' }); }); }; });
    document.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = async function () { if (!window.confirm('Delete this draft?')) return; try { await api('/api/email-engine/campaigns/' + b.getAttribute('data-del'), { method: 'DELETE' }); render(); } catch (err) { toast(err.message); } }; });
    document.querySelectorAll('[data-copy]').forEach(function (b) { b.onclick = async function () {
      var src = data.campaigns.find(function (c) { return c.id === b.getAttribute('data-copy'); });
      try { var r = await api('/api/email-engine/campaigns', { method: 'POST', body: { name: src.name + ' (copy)', subject: src.subject, body_text: src.body_text } }); view.composing = r.campaign.id; render(); } catch (err) { toast(err.message); }
    }; });
    document.querySelectorAll('[data-act]').forEach(function (b) { b.onclick = async function () {
      var act = b.getAttribute('data-act');
      if (act === 'cancel' && !window.confirm('Stop this campaign? People not reached yet will not get it.')) return;
      try { await api('/api/email-engine/campaigns/' + b.getAttribute('data-id') + '/' + act, { method: 'POST' }); toast({ pause: 'Paused', resume: 'Sending again', cancel: 'Stopped', 'retry-failed': 'Failed addresses queued again' }[act]); render(); } catch (err) { toast(err.message); }
    }; });
    document.querySelectorAll('[data-details]').forEach(function (d) { d.ontoggle = async function () {
      if (!d.open) return;
      var box = d.querySelector('.ee-details');
      try {
        var r = await api('/api/email-engine/campaigns/' + d.getAttribute('data-details'));
        box.innerHTML = '<p><b>Message</b></p><pre style="white-space:pre-wrap;font:inherit;background:#f8f8fb;padding:10px;border-radius:8px">' + esc(r.campaign.body_text) + '</pre>' +
          (r.problems.length ? '<p><b>Not sent</b></p><ul style="padding-left:18px">' + r.problems.map(function (p) { return '<li>' + esc(p.email) + ' — ' + esc(p.error || p.status) + '</li>'; }).join('') + '</ul>' : '<p>No failures.</p>');
      } catch (err) { box.textContent = err.message; }
    }; });

    var cb = document.getElementById('eeContactsBox');
    if (cb) cb.ontoggle = function () { if (cb.open) loadContacts(); };
    var q = document.getElementById('eeQ'), lf = document.getElementById('eeListFilter'), qt;
    if (q) q.oninput = function () { clearTimeout(qt); qt = setTimeout(function () { view.contactsQ = q.value; loadContacts(); }, 300); };
    if (lf) lf.onchange = function () { view.contactsList = lf.value; loadContacts(); };
    var imp = document.getElementById('eeImport');
    if (imp) imp.onsubmit = async function (e) {
      e.preventDefault();
      try { var r = await api('/api/email-engine/contacts/import', { method: 'POST', body: { text: imp.text.value, list: imp.list.value } }); toast(r.added + ' added, ' + r.updated + ' already saved' + (r.invalid_count ? ', ' + r.invalid_count + ' not valid' : '')); render(); } catch (err) { toast(err.message); }
    };
    var ic = document.getElementById('eeImportCloser');
    if (ic) ic.onclick = async function () {
      try { var r = await api('/api/email-engine/contacts/import-closer', { method: 'POST' }); toast(r.found + ' found · ' + r.added + ' new contacts (list "Closer customers")'); render(); } catch (err) { toast(err.message); }
    };
    var bb = document.getElementById('eeBlockedBox');
    if (bb) bb.ontoggle = function () { if (bb.open) loadBlocked(); };
    var bf = document.getElementById('eeBlockForm');
    if (bf) bf.onsubmit = async function (e) { e.preventDefault(); try { await api('/api/email-engine/blocked', { method: 'POST', body: { text: bf.text.value } }); bf.text.value = ''; toast('Added'); loadBlocked(); } catch (err) { toast(err.message); } };

    var sf = document.getElementById('eeSettings');
    if (sf) {
      sf.querySelectorAll('input[name=sender_mode]').forEach(function (r) { r.onchange = function () { document.getElementById('eeMailbox').hidden = sf.querySelector('input[name=sender_mode]:checked').value !== 'mailbox'; }; });
      sf.onsubmit = async function (e) {
        e.preventDefault();
        var body = {
          sender_mode: sf.querySelector('input[name=sender_mode]:checked').value, per_minute: sf.per_minute.value, mailbox_daily_limit: sf.mailbox_daily_limit.value,
          reserve_for_closer: sf.reserve_for_closer.value, footer_text: sf.footer_text.value, unsubscribe_label: sf.unsubscribe_label.value, reply_to: sf.reply_to.value
        };
        if (body.sender_mode === 'mailbox' || sf.mb_address.value) body.mailbox = { address: sf.mb_address.value, sender_name: sf.mb_sender_name.value, username: sf.mb_username.value, smtp_host: sf.mb_smtp_host.value, smtp_port: sf.mb_smtp_port.value, password: sf.mb_password.value || undefined };
        try { await api('/api/email-engine/settings', { method: 'PUT', body: body }); toast('Settings saved'); render(); } catch (err) { toast(err.message); }
      };
      var mt = document.getElementById('eeMbTest');
      if (mt) mt.onclick = async function () {
        mt.disabled = true; mt.textContent = 'Testing…';
        try {
          var r = await api('/api/email-engine/mailbox/test', { method: 'POST' });
          document.getElementById('eeMbResult').innerHTML = r.ok ? '<div class="channel-test ok">Login works. Nothing was sent.</div>' :
            '<div class="channel-test bad">' + esc(r.error) + '<ol>' + (r.steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>';
          if (r.ok) setTimeout(render, 1200);
        } catch (err) { toast(err.message); }
        mt.disabled = false; mt.textContent = 'Test connection';
      };
    }
  }

  async function loadContacts() {
    var box = document.getElementById('eeContacts'); if (!box) return;
    try {
      var r = await api('/api/email-engine/contacts?q=' + encodeURIComponent(view.contactsQ) + '&list=' + encodeURIComponent(view.contactsList));
      if (!r.contacts.length) { box.innerHTML = 'No contacts' + (view.contactsQ || view.contactsList ? ' match.' : ' yet.'); return; }
      box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Email</th><th>Name</th><th>Company</th><th>Lists</th><th></th></tr></thead><tbody>' +
        r.contacts.map(function (c) { return '<tr><td>' + esc(c.email) + '</td><td>' + esc(c.name || '') + '</td><td>' + esc(c.organization || '') + '</td><td>' + esc(c.lists.join(', ')) + '</td><td><button class="button button-soft" data-rmc="' + c.id + '">Remove</button></td></tr>'; }).join('') +
        '</tbody></table></div><p>' + (r.total > r.contacts.length ? 'Showing ' + r.contacts.length + ' of ' + n(r.total) + '. Search to find others.' : n(r.total) + ' contacts') + '</p>';
      box.querySelectorAll('[data-rmc]').forEach(function (b) { b.onclick = async function () { await api('/api/email-engine/contacts/' + b.getAttribute('data-rmc'), { method: 'DELETE' }); loadContacts(); }; });
    } catch (err) { box.textContent = err.message; }
  }

  async function loadBlocked() {
    var box = document.getElementById('eeBlocked'); if (!box) return;
    try {
      var r = await api('/api/email-engine/blocked');
      var label = { unsubscribed: 'Unsubscribed', bounced: 'Bounced (address does not exist)', manual: 'Added by you' };
      box.innerHTML = !r.blocked.length ? 'Nobody yet.' : '<ul style="padding-left:18px">' + r.blocked.map(function (b) { return '<li>' + esc(b.email) + ' — ' + esc(label[b.reason] || b.reason) + ' · ' + when(b.created_at) + ' <a href="#" data-unb="' + b.id + '" data-r="' + b.reason + '">remove</a></li>'; }).join('') + '</ul>';
      box.querySelectorAll('[data-unb]').forEach(function (a) { a.onclick = async function (e) {
        e.preventDefault();
        var unsub = a.getAttribute('data-r') === 'unsubscribed';
        if (unsub && !window.confirm('This person unsubscribed themselves. Remove only if they asked to get emails again. Remove?')) return;
        try { await api('/api/email-engine/blocked/' + a.getAttribute('data-unb'), { method: 'DELETE', body: { confirm: unsub } }); loadBlocked(); } catch (err) { toast(err.message); }
      }; });
    } catch (err) { box.textContent = err.message; }
  }

  (function injectStyles() {
    if (document.getElementById('eeStyles')) return;
    var st = document.createElement('style'); st.id = 'eeStyles';
    st.textContent = '.channel-form label.ee-choice{flex-direction:row;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:8px;font-weight:500;margin:0 0 8px}' +
      '.ee-choice input[type=radio],.ee-choice input[type=checkbox]{width:18px;height:18px;min-height:0;margin:0;padding:0;flex:none;accent-color:#5b4bdb;box-shadow:none}' +
      '.ee-choice select,.ee-choice input:not([type=radio]):not([type=checkbox]){width:auto;flex:1 1 180px;max-width:280px}';
    document.head.appendChild(st);
  })();

  window.emailEngineSettingsView = async function () { setTitle('Email Engine'); await render(); };

  /* ---------------- Platform › Email Engine (AIStaff staff) ---------------- */
  window.loadEmailEnginePlatformPanel = async function () {
    var holder = document.getElementById('emailEngineHolder'); if (!holder) return;
    var data;
    try { data = await api('/api/platform/email-engine'); } catch (err) { holder.innerHTML = ''; return; }
    var p = data.platform;
    var sending = data.campaigns.filter(function (c) { return c.status === 'sending'; }).length;
    holder.innerHTML = '<section class="panel"><details><summary style="cursor:pointer"><b>Email Engine</b> <small class="muted">' + (p.paused_all ? '<b style="color:#b42318">ALL SENDING PAUSED</b>' : 'running') + ' · ' + sending + ' sending now · max ' + p.max_per_minute + '/min, ' + n(p.max_per_day) + '/day per mailbox</small></summary>' +
      '<form id="eePlat" class="channel-form" style="margin-top:12px"><label class="ee-choice"><input type="checkbox" name="paused_all"' + (p.paused_all ? ' checked' : '') + '> Pause all tenant email campaigns</label>' +
      '<div class="channel-grid"><label>Note shown to tenants<input name="pause_note" value="' + esc(p.pause_note || '') + '"></label>' +
      '<label>Max emails per minute (any tenant)<input name="max_per_minute" type="number" value="' + p.max_per_minute + '"></label>' +
      '<label>Max emails per day per mailbox<input name="max_per_day" type="number" value="' + p.max_per_day + '"></label></div>' +
      '<p class="small" style="margin:10px 0 4px"><b>Outreach (one-to-one prospecting)</b></p>' +
      '<label class="ee-choice"><input type="checkbox" name="outreach_enabled"' + (p.outreach_enabled ? ' checked' : '') + '> Tenants may run outreach</label>' +
      '<div class="channel-grid"><label>Max outreach emails per company per day<input name="outreach_max_per_day" type="number" value="' + p.outreach_max_per_day + '"></label>' +
      '<label>Domains outreach may never send from<input name="protected_domains" value="' + esc((p.protected_domains || []).join(', ')) + '"></label></div>' +
      '<div class="channel-actions"><button class="button button-primary" type="submit">Save</button></div></form>' +
      (data.campaigns.length ? '<div class="table-wrap"><table><thead><tr><th>Tenant</th><th>Campaign</th><th>Status</th><th>Sent</th><th>Failed</th><th>Problem</th><th></th></tr></thead><tbody>' +
        data.campaigns.map(function (c) { return '<tr><td>' + esc(c.company) + '</td><td>' + (c.kind === 'outreach' ? '<span class="muted small">Outreach · </span>' : '') + esc(c.name) + '<br><small class="muted">' + esc(c.from_address || '') + '</small></td><td>' + badge(c.status) + '</td><td>' + n(c.sent) + '/' + n(c.total) + '</td><td>' + n(c.failed) + '</td><td class="small">' + esc(c.status === 'paused' ? (c.last_error || c.pause_reason) : '') + '</td><td>' + (c.status === 'sending' ? '<button class="button button-soft" data-ppause="' + c.id + '">Pause</button>' : '') + '</td></tr>'; }).join('') +
        '</tbody></table></div>' : '<p class="muted small">No campaigns in the last 14 days.</p>') +
      '</details></section>';
    var f = document.getElementById('eePlat');
    f.onsubmit = async function (e) {
      e.preventDefault();
      if (f.paused_all.checked !== p.paused_all && !window.confirm(f.paused_all.checked ? 'Pause email campaigns for ALL tenants?' : 'Turn tenant email campaigns back on?')) return;
      try { await api('/api/platform/email-engine', { method: 'PUT', body: { paused_all: f.paused_all.checked, pause_note: f.pause_note.value, max_per_minute: f.max_per_minute.value, max_per_day: f.max_per_day.value, outreach_enabled: f.outreach_enabled.checked, outreach_max_per_day: f.outreach_max_per_day.value, protected_domains: f.protected_domains.value } }); toast('Saved'); window.loadEmailEnginePlatformPanel(); } catch (err) { toast(err.message); }
    };
    holder.querySelectorAll('[data-ppause]').forEach(function (b) { b.onclick = async function () { try { await api('/api/platform/email-engine/campaigns/' + b.getAttribute('data-ppause') + '/pause', { method: 'POST' }); toast('Paused'); window.loadEmailEnginePlatformPanel(); } catch (err) { toast(err.message); } }; });
    holder.querySelector('details').open = p.paused_all || false;
  };
})();
