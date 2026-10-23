/* Settings › Email Engine › Outreach (added 2026-10-22). One-to-one prospecting done properly.
   Loaded before email-engine-settings.js, which calls window.EEOutreach. Progressive disclosure:
   a draft outreach shows a 4-step checklist; a running one shows numbers, the review list and folded details. */
(function () {
  'use strict';

  function esc(v) { return escapeHtml(v == null ? '' : String(v)); }
  function n(v) { return Number(v || 0).toLocaleString('en-PH'); }
  function when(iso) { return iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
  function tick(ok) { return ok ? '<span style="color:#137a52;font-weight:800">✓</span>' : '<span style="color:#9a6510;font-weight:800">○</span>'; }
  var TYPE = { role: 'company address', personal: 'personal address', freemail: 'free email (Gmail…)' };
  var STATUS = { draft_needed: 'AI will write', drafting: 'AI writing…', review: 'Waiting for your approval', pending: 'Approved — queued', sending: 'Sending', waiting: 'Sent — follow-up later',
    sent: 'Sent', held: 'Held — needs your check', skipped: 'Not sent', failed: 'Failed' };
  var OUTCOME = { replied: 'Replied', opted_out: 'Opted out', bounced: 'Bounced', no_reply: 'No reply' };
  var open = {};

  /* ---------- pace (shared with broadcast emails) ---------- */
  function paceFieldset(c, opts) {
    c = c || {}; opts = opts || {};
    var w = c.send_window || {};
    var on = Boolean(c.pace_count && c.pace_hours);
    var winOn = Boolean(w.weekdays_only || w.from || w.to);
    return '<fieldset class="ee-pace" style="border:1px solid #eceaf2;border-radius:10px;padding:10px 14px;margin:6px 0 12px"><legend class="small"><b>' + (opts.title || 'Sending pace') + '</b></legend>' +
      (opts.required ? '' : '<label class="ee-choice"><input type="radio" name="pace_on" value="no"' + (on ? '' : ' checked') + '> As fast as the mailbox allows</label>') +
      '<label class="ee-choice"><input type="radio" name="pace_on" value="yes"' + (on || opts.required ? ' checked' : '') + '> At most <input name="pace_count" type="number" min="1" max="10000" value="' + (c.pace_count || 10) + '" style="max-width:90px"> emails every <input name="pace_hours" type="number" min="1" max="168" value="' + (c.pace_hours || 24) + '" style="max-width:80px"> hours</label>' +
      '<p class="muted small" style="margin:-4px 0 8px 26px">Spread evenly, e.g. 10 every 24 hours ≈ one every 2.4 hours; 10 every 3 hours ≈ one every 18 minutes.</p>' +
      '<label class="ee-choice"><input type="checkbox" name="win_on"' + (winOn ? ' checked' : '') + '> Only send <select name="win_days"><option value="weekdays"' + (w.weekdays_only !== false ? ' selected' : '') + '>Monday–Friday</option><option value="all"' + (w.weekdays_only === false ? ' selected' : '') + '>every day</option></select> from <input name="win_from" type="time" value="' + esc(w.from || '08:00') + '"> to <input name="win_to" type="time" value="' + esc(w.to || '18:00') + '"> <span class="muted small">Philippine time</span></label>' +
      '</fieldset>';
  }
  function readPace(form) {
    var on = form.querySelector('input[name=pace_on]:checked');
    var paceOn = on ? on.value === 'yes' : true;
    var winOn = form.win_on && form.win_on.checked;
    return {
      pace_count: paceOn ? Number(form.pace_count.value) : 0, pace_hours: paceOn ? Number(form.pace_hours.value) : 0,
      send_window: winOn ? { weekdays_only: form.win_days.value === 'weekdays', from: form.win_from.value, to: form.win_to.value } : { enabled: false }
    };
  }
  function paceText(c) {
    var w = c.send_window || {};
    var p = c.pace_count && c.pace_hours ? c.pace_count + ' every ' + c.pace_hours + ' h' : 'no extra pace';
    return p + (w.from || w.weekdays_only ? ' · ' + (w.weekdays_only ? 'Mon–Fri ' : '') + (w.from || '00:00') + '–' + (w.to || '24:00') : '');
  }

  /* ---------- outreach card ---------- */
  function statsLine(c) {
    var s = c.stats || {};
    return '<p class="small" style="margin:8px 0 0"><b>' + n(c.sent) + '</b> sent · <b>' + n(s.replied) + '</b> replied · ' + n(s.opted_out) + ' opted out · ' + n(s.bounced) + ' bounced' +
      (s.waiting_followup ? ' · ' + n(s.waiting_followup) + ' waiting for follow-up' : '') + (s.no_reply ? ' · ' + n(s.no_reply) + ' no reply' : '') + '</p>' +
      '<p class="muted small" style="margin:2px 0 0">' + (s.drafting ? n(s.drafting) + ' for the AI to write · ' : '') + (s.ready ? n(s.ready) + ' approved and queued · ' : '') + 'pace ' + esc(paceText(c)) + ' · follow-ups: ' + c.followups + (c.followups ? ' after ' + c.followup_days + ' days' : '') + '</p>';
  }

  function setupSteps(c, data) {
    var s = c.stats || {};
    var prospects = Math.max(0, c.total - c.skipped);
    var ok1 = (c.brief || '').trim().length >= 30 && (c.sender_person.name || '').trim();
    var ok2 = s.drafting > 0;
    var ok4 = c.pia_done;
    var okBox = data.outreach_sender.ok;
    var p = c.pia && c.pia.purpose ? c.pia : data.pia_defaults;
    var confirms = (c.pia && c.pia.confirms) || {};
    var step = function (id, ok, title, sub, body) {
      return '<details class="ee-step" data-step="' + id + '"' + (open[c.id + id] ? ' open' : '') + ' style="border-top:1px solid #eceaf2;padding:10px 0"><summary style="cursor:pointer">' + tick(ok) + ' <b>' + title + '</b> <small class="muted">' + sub + '</small></summary><div style="margin-top:10px">' + body + '</div></details>';
    };
    return '<div style="margin-top:10px">' +
      step('1', ok1, '1. What you offer', ok1 ? 'from ' + esc(c.sender_person.name) : 'the AI uses this for every email',
        '<form class="channel-form" data-o-basics="' + c.id + '">' +
        '<label>What you offer and why it helps them <span class="muted small">(the AI writes each email from this — facts only, it will not invent anything)</span><textarea name="brief" rows="6" style="width:100%" placeholder="Example: AIStaff gives businesses an AI employee that answers Facebook, email and phone inquiries 24/7, books service and follows up…">' + esc(c.brief) + '</textarea></label>' +
        '<div class="channel-grid"><label>Sender — your name<input name="sp_name" value="' + esc(c.sender_person.name || '') + '" placeholder="Mike Pineda"></label><label>Your title<input name="sp_title" value="' + esc(c.sender_person.title || '') + '" placeholder="Founder"></label></div>' +
        '<div class="channel-actions"><button class="button button-primary" type="submit">Save</button></div></form>') +
      step('2', ok2, '2. Prospects', n(prospects) + ' added' + (s.held ? ' · ' + n(s.held) + ' held' : ''),
        prospectForm(c) + heldBox(c)) +
      step('3', true, '3. Pace and follow-ups', esc(paceText(c)) + ' · ' + c.followups + ' follow-up' + (c.followups === 1 ? '' : 's'),
        '<form class="channel-form" data-o-pace="' + c.id + '">' + paceFieldset(c, { required: true }) + followupFields(c) +
        '<div class="channel-actions"><button class="button button-primary" type="submit">Save</button></div></form>') +
      step('4', ok4, '4. Privacy check', ok4 ? 'done ' + when(c.pia_done_at) + ' by ' + esc(c.pia_by) : 'required once per outreach',
        '<form class="channel-form" data-o-pia="' + c.id + '"><p class="muted small">Your written record of why and how you contact these businesses (Data Privacy Act). Edit the suggested answers so they are true for you.</p>' +
        [['purpose', 'Purpose'], ['data_used', 'What data you use'], ['source_of_data', 'Where the addresses come from'], ['lawful_basis', 'Why you may contact them (lawful basis)'], ['opt_out', 'How people opt out'], ['security', 'How the data is kept safe']].map(function (f) {
          return '<label>' + f[1] + '<textarea name="' + f[0] + '" rows="2" style="width:100%">' + esc(p[f[0]] || '') + '</textarea></label>';
        }).join('') +
        '<label>Delete records of people who did not reply after (days)<input name="retention_days" type="number" min="1" value="' + esc(p.retention_days || 180) + '" style="max-width:120px"></label>' +
        Object.keys(data.pia_confirms).map(function (k) { return '<label class="ee-choice"><input type="checkbox" name="cf_' + k + '"' + (confirms[k] ? ' checked' : '') + '> ' + esc(data.pia_confirms[k]) + '</label>'; }).join('') +
        '<div class="channel-actions"><button class="button button-primary" type="submit">Save privacy check</button></div></form>') +
      '<div style="border-top:1px solid #eceaf2;padding:10px 0">' + tick(okBox) + ' <b>Outreach mailbox</b> <small class="muted">' + (okBox ? esc(data.outreach_sender.address) : esc(data.outreach_sender.problem)) + '</small></div>' +
      '<div class="channel-actions" style="margin-top:6px"><button class="button button-primary" data-o-start="' + c.id + '"' + (ok1 && ok2 && ok4 && okBox ? '' : ' disabled title="Finish the steps above first"') + '>Start outreach</button>' +
      '<button class="button button-soft" data-del="' + c.id + '">Delete</button></div>' +
      '<p class="muted small">After you start, the AI writes the emails a few at a time. ' + (c.require_review ? 'Each one waits for your approval before it is sent.' : 'They are sent without review (you switched review off).') + '</p></div>';
  }

  function followupFields(c) {
    return '<div class="channel-grid"><label>Follow-ups to people who do not reply<select name="followups">' + [0, 1, 2].map(function (k) { return '<option value="' + k + '"' + (c.followups === k ? ' selected' : '') + '>' + (k ? k + ' follow-up' + (k > 1 ? 's' : '') : 'None') + '</option>'; }).join('') + '</select></label>' +
      '<label>Days to wait before a follow-up<input name="followup_days" type="number" min="2" max="30" value="' + (c.followup_days || 4) + '"></label></div>' +
      '<label class="ee-choice"><input type="checkbox" name="require_review"' + (c.require_review ? ' checked' : '') + '> Let me approve every email before it is sent <span class="muted small">(recommended)</span></label>';
  }

  function prospectForm(c) {
    return '<form class="channel-form" data-o-prospects="' + c.id + '"><p class="muted small">One company per line (or rows copied from Excel): <b>email, company, contact name, where you found it, why they fit</b>. ' +
      'Company addresses (info@, sales@, procurement@…) are used. Personal or Gmail-type addresses are held until you confirm the company published them for business inquiries. Each address needs "where you found it".</p>' +
      '<textarea name="text" rows="5" style="width:100%" placeholder="procurement@abcfoods.ph, ABC Foods Inc., , abcfoods.ph/contact, 12 branches, many Facebook inquiries"></textarea>' +
      '<div class="channel-actions"><button class="button button-primary" type="submit">Add prospects</button></div><div data-o-presult="' + c.id + '"></div></form>';
  }

  function heldBox(c) {
    var s = c.stats || {};
    if (!s.held) return '';
    return '<div class="settings-warning" style="margin-top:10px"><b>' + n(s.held) + ' held.</b> Personal or free-email addresses, or rows without "where you found it". ' +
      '<details data-o-held="' + c.id + '" style="margin-top:6px"><summary style="cursor:pointer">See them</summary><div class="small">Loading…</div></details></div>';
  }

  function runningBody(c) {
    var s = c.stats || {};
    return statsLine(c) +
      (s.review ? '<div class="channel-actions" style="margin-top:10px"><button class="button button-primary" data-o-review="' + c.id + '">Review ' + n(s.review) + ' email' + (s.review > 1 ? 's' : '') + '</button></div>' : '') +
      '<div data-o-reviewbox="' + c.id + '"></div>' + heldBox(c) +
      '<details data-o-list="' + c.id + '" style="margin-top:8px"><summary style="cursor:pointer" class="small">Prospects and replies</summary><div class="small">Loading…</div></details>' +
      '<details style="margin-top:4px"><summary style="cursor:pointer" class="small">Add more prospects</summary>' + prospectForm(c) + '</details>' +
      '<details style="margin-top:4px"><summary style="cursor:pointer" class="small">Pace and follow-ups</summary><form class="channel-form" data-o-pace="' + c.id + '" style="margin-top:8px">' + paceFieldset(c, { required: true }) + followupFields(c).replace('<label>Days to wait', '<label hidden>Days to wait') +
      '<div class="channel-actions"><button class="button button-primary" type="submit">Save</button></div></form></details>' +
      '<p class="small" style="margin-top:8px"><a href="/api/email-engine/campaigns/' + c.id + '/record.csv">Download the record (CSV)</a> <span class="muted">— who, where found, why, what was sent, replies, privacy check</span></p>';
  }

  function card(c, data) {
    var badges = { draft: ['Setting up', 'warn'], sending: ['Running', 'active'], paused: ['Paused', 'warn'], done: ['Finished', 'active'], cancelled: ['Stopped', 'inactive'] };
    var b = badges[c.status] || [c.status, 'inactive'];
    var actions = [];
    if (c.status === 'sending') actions.push('<button class="button button-soft" data-act="pause" data-id="' + c.id + '">Pause</button>');
    if (c.status === 'paused') actions.push('<button class="button button-primary" data-act="resume" data-id="' + c.id + '">Resume</button>');
    if (c.status === 'sending' || c.status === 'paused') actions.push('<button class="button button-soft" data-act="cancel" data-id="' + c.id + '">Stop</button>');
    var note = '';
    if (c.status === 'paused' && c.last_error && c.pause_reason !== 'manual') note = '<div class="settings-warning"><b>Paused:</b> ' + esc(c.last_error) + '</div>';
    if (c.status === 'sending' && c.waiting) note = '<p class="muted small">⏳ ' + esc(c.waiting) + '</p>';
    return '<section class="panel channel-card"><div class="channel-head"><div><p class="eyebrow" style="margin:0">Outreach · one-to-one</p><b>' + esc(c.name) + '</b>' +
      (c.from_address ? '<br><small class="muted">from ' + esc(c.from_address) + (c.started_at ? ' · started ' + when(c.started_at) : '') + '</small>' : '') + '</div>' +
      '<span class="channel-state ' + b[1] + '"><i></i>' + esc(b[0]) + '</span></div>' + note +
      (c.status === 'draft' ? setupSteps(c, data) : runningBody(c)) +
      (actions.length ? '<div class="channel-actions" style="margin-top:10px">' + actions.join('') + '</div>' : '') + '</section>';
  }

  /* ---------- review list ---------- */
  async function loadReview(id) {
    var box = document.querySelector('[data-o-reviewbox="' + id + '"]');
    if (!box) return;
    box.innerHTML = '<p class="muted small">Loading…</p>';
    var r = await api('/api/email-engine/campaigns/' + id + '/prospects?status=review');
    if (!r.prospects.length) { box.innerHTML = '<p class="muted small">Nothing waiting for approval.</p>'; return; }
    box.innerHTML = r.prospects.map(function (x) {
      return '<form class="channel-form" data-o-item="' + x.id + '" style="border:1px solid #eceaf2;border-radius:10px;padding:12px 14px;margin:10px 0">' +
        '<p class="small" style="margin:0 0 6px"><b>To:</b> ' + esc(x.name ? x.name + ' · ' : '') + esc(x.email) + ' · ' + esc(x.organization || '') + ' <span class="muted">(' + esc(TYPE[x.address_type] || '') + ')</span>' +
        (x.step ? ' · <b>follow-up ' + x.step + '</b>' : '') + '<br><span class="muted">Found on: ' + esc(x.source_note || '—') + ' · Why: ' + esc(x.reason_note || '—') + '</span></p>' +
        (x.draft_error ? '<div class="settings-warning">' + esc(x.draft_error) + '</div>' : '') +
        (x.step ? '' : '<label>Subject<input name="subject" value="' + esc(x.draft_subject || '') + '"></label>') +
        '<label>Message <span class="muted small">(the footer with your name, where you found them and "reply STOP" is added automatically)</span><textarea name="body" rows="8" style="width:100%">' + esc(x.draft_body || '') + '</textarea></label>' +
        '<div class="channel-actions"><button class="button button-primary" type="button" data-ra="approve">Approve</button><button class="button button-soft" type="button" data-ra="test">Send me this</button>' +
        '<button class="button button-soft" type="button" data-ra="redraft">Write again</button><button class="button button-soft" type="button" data-ra="reject">Don\'t send</button></div></form>';
    }).join('');
    box.querySelectorAll('[data-o-item]').forEach(function (f) {
      f.querySelectorAll('[data-ra]').forEach(function (btn) {
        btn.onclick = async function () {
          var action = btn.getAttribute('data-ra');
          var body = { action: action, body: f.body.value };
          if (f.subject) body.subject = f.subject.value;
          if (action === 'redraft') { var note = window.prompt('Anything the AI should know about this company? (optional — saved as "why they fit")', ''); if (note === null) return; if (note) body.note = note; }
          btn.disabled = true;
          try {
            var r2 = await api('/api/email-engine/campaigns/' + id + '/review/' + f.getAttribute('data-o-item'), { method: 'POST', body: body });
            if (action === 'test') { toast('Sent to ' + r2.to); btn.disabled = false; return; }
            toast({ approve: 'Approved — it will be sent at the pace you set', reject: 'Will not be sent', redraft: 'The AI will write it again' }[action]);
            f.remove();
            if (!box.querySelector('[data-o-item]')) window.emailEngineSettingsView();
          } catch (err) { toast(err.message); btn.disabled = false; }
        };
      });
    });
  }

  async function loadList(id, details) {
    var box = details.querySelector('div');
    var r = await api('/api/email-engine/campaigns/' + id + '/prospects');
    if (!r.prospects.length) { box.textContent = 'No prospects yet.'; return; }
    box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Company</th><th>Email</th><th>Status</th><th>Result</th><th></th></tr></thead><tbody>' + r.prospects.map(function (x) {
      return '<tr><td>' + esc(x.organization || '') + (x.name ? '<br><span class="muted">' + esc(x.name) + '</span>' : '') + '</td><td>' + esc(x.email) + '<br><span class="muted">' + esc(TYPE[x.address_type] || '') + '</span></td>' +
        '<td>' + esc(STATUS[x.status] || x.status) + (x.step ? ' (follow-up ' + x.step + ')' : '') + (x.error ? '<br><span class="muted">' + esc(x.error) + '</span>' : '') + '</td>' +
        '<td>' + esc(OUTCOME[x.outcome] || '') + (x.reply_snippet ? '<details><summary style="cursor:pointer">reply</summary><pre style="white-space:pre-wrap;font:inherit">' + esc(x.reply_snippet) + '</pre></details>' : '') + '</td>' +
        '<td>' + (x.outcome ? '' : '<select data-mark="' + x.id + '"><option value="">Mark…</option><option value="replied">They replied</option><option value="opted_out">Asked to stop</option></select>') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    box.querySelectorAll('[data-mark]').forEach(function (sel) {
      sel.onchange = async function () {
        if (!sel.value) return;
        try { await api('/api/email-engine/campaigns/' + id + '/review/' + sel.getAttribute('data-mark'), { method: 'POST', body: { action: sel.value } }); toast('Saved — no more emails to them'); loadList(id, details); } catch (err) { toast(err.message); }
      };
    });
  }

  async function loadHeld(id, details) {
    var box = details.querySelector('div');
    var r = await api('/api/email-engine/campaigns/' + id + '/prospects?status=held');
    box.innerHTML = '<ul style="padding-left:18px">' + r.prospects.map(function (x) { return '<li>' + esc(x.email) + ' · ' + esc(x.organization || '') + ' — ' + esc(x.error || '') + (x.source_note ? ' <span class="muted">(found on ' + esc(x.source_note) + ')</span>' : '') + '</li>'; }).join('') + '</ul>' +
      '<label class="ee-choice"><input type="checkbox" data-held-confirm> I checked: the company publishes these addresses for business inquiries (on its website, page or listing).</label>' +
      '<button class="button button-soft" type="button" data-held-allow>Allow these</button> <span class="muted small">Rows without "where you found it" stay held — add them again with the source.</span>';
    box.querySelector('[data-held-allow]').onclick = async function () {
      if (!box.querySelector('[data-held-confirm]').checked) { toast('Tick the confirmation first'); return; }
      try { var a = await api('/api/email-engine/campaigns/' + id + '/allow-held', { method: 'POST', body: { confirm: true } }); toast(a.allowed + ' allowed' + (a.still_missing_source ? ', ' + a.still_missing_source + ' still need a source' : '')); window.emailEngineSettingsView(); } catch (err) { toast(err.message); }
    };
  }

  function wire(data) {
    var rerender = window.emailEngineSettingsView;
    document.querySelectorAll('.ee-step').forEach(function (d) {
      d.ontoggle = function () { var card = d.closest('section'); var id = card && card.querySelector('[data-o-start],[data-del]'); if (id) open[(id.getAttribute('data-o-start') || id.getAttribute('data-del')) + d.getAttribute('data-step')] = d.open; };
    });
    document.querySelectorAll('[data-o-basics]').forEach(function (f) {
      f.onsubmit = async function (e) { e.preventDefault(); var id = f.getAttribute('data-o-basics');
        try { await api('/api/email-engine/campaigns/' + id, { method: 'PUT', body: { brief: f.brief.value, sender_person: { name: f.sp_name.value, title: f.sp_title.value } } }); toast('Saved'); open[id + '1'] = false; open[id + '2'] = true; rerender(); } catch (err) { toast(err.message); } };
    });
    document.querySelectorAll('[data-o-pace]').forEach(function (f) {
      f.onsubmit = async function (e) { e.preventDefault(); var id = f.getAttribute('data-o-pace');
        var body = readPace(f); body.followups = Number(f.followups.value); body.followup_days = Number(f.followup_days.value); body.require_review = f.require_review.checked;
        if (!body.require_review && !window.confirm('Send emails without your approval? The AI writes them from your notes; you will not see them first.')) return;
        try { await api('/api/email-engine/campaigns/' + id, { method: 'PUT', body: body }); toast('Saved'); open[id + '3'] = false; rerender(); } catch (err) { toast(err.message); } };
    });
    document.querySelectorAll('[data-o-pia]').forEach(function (f) {
      f.onsubmit = async function (e) { e.preventDefault(); var id = f.getAttribute('data-o-pia');
        var body = { retention_days: Number(f.retention_days.value), confirms: {} };
        ['purpose', 'data_used', 'source_of_data', 'lawful_basis', 'opt_out', 'security'].forEach(function (k) { body[k] = f[k].value; });
        Object.keys(data.pia_confirms).forEach(function (k) { body.confirms[k] = f['cf_' + k].checked; });
        try { await api('/api/email-engine/campaigns/' + id + '/pia', { method: 'PUT', body: body }); toast('Privacy check saved'); open[id + '4'] = false; rerender(); } catch (err) { toast(err.message); } };
    });
    document.querySelectorAll('[data-o-prospects]').forEach(function (f) {
      f.onsubmit = async function (e) { e.preventDefault(); var id = f.getAttribute('data-o-prospects');
        try {
          var r = await api('/api/email-engine/campaigns/' + id + '/prospects', { method: 'POST', body: { text: f.text.value } });
          toast(r.added + ' added' + (r.held ? ', ' + r.held + ' held' : '') + (r.blocked ? ', ' + r.blocked + ' on do-not-email list' : '') + (r.recently_contacted ? ', ' + r.recently_contacted + ' contacted recently' : '') + (r.already ? ', ' + r.already + ' already in' : '') + (r.invalid_count ? ', ' + r.invalid_count + ' not valid' : ''));
          open[id + '2'] = true; rerender();
        } catch (err) { toast(err.message); } };
    });
    document.querySelectorAll('[data-o-start]').forEach(function (b) {
      b.onclick = async function () {
        if (!window.confirm('Start this outreach? The AI begins writing the emails' + (b.closest('section').textContent.indexOf('without review') > -1 ? '' : ' and you approve each one') + '.')) return;
        try { await api('/api/email-engine/campaigns/' + b.getAttribute('data-o-start') + '/send', { method: 'POST' }); toast('Started — the first drafts appear in a few minutes'); rerender(); } catch (err) { toast(err.message); }
      };
    });
    document.querySelectorAll('[data-o-review]').forEach(function (b) { b.onclick = function () { b.remove(); loadReview(b.getAttribute('data-o-review')).catch(function (err) { toast(err.message); }); }; });
    document.querySelectorAll('[data-o-list]').forEach(function (d) { d.ontoggle = function () { if (d.open) loadList(d.getAttribute('data-o-list'), d).catch(function (err) { toast(err.message); }); }; });
    document.querySelectorAll('[data-o-held]').forEach(function (d) { d.ontoggle = function () { if (d.open) loadHeld(d.getAttribute('data-o-held'), d).catch(function (err) { toast(err.message); }); }; });
  }

  /* ---------- outreach mailbox (Sending settings) ---------- */
  function settingsSection(data) {
    var o = data.settings.outreach;
    return '<details class="panel channel-card" id="eeOutreachBox"><summary style="cursor:pointer"><b>Outreach mailbox</b> <small class="muted">' +
      (data.outreach_sender.ok ? esc(o.address) + ' · ready' : (o.address ? esc(o.address) + ' · not ready' : 'not set up')) + ' · used only for one-to-one outreach</small></summary>' +
      '<form id="eeOutreachForm" class="channel-form" style="margin-top:12px">' +
      '<p class="muted small">Use a mailbox on a <b>separate domain</b> (for example a sister domain you bought for outreach), so your main inbox is never at risk. Not allowed: ' + esc(data.forbidden_domains.join(', ') || '—') + ' and free email addresses. Replies to outreach are read from this inbox.</p>' +
      (o.last_error ? '<div class="settings-warning">' + esc(o.last_error) + '</div>' : '') +
      '<div class="channel-grid"><label>Mailbox address<input name="address" type="email" value="' + esc(o.address) + '" placeholder="mike@youroutreachdomain.com"></label>' +
      '<label>Sender name<input name="sender_name" value="' + esc(o.sender_name) + '" placeholder="Mike Pineda"></label>' +
      '<label>Password ' + (o.has_password ? '<span class="muted small">(saved — type only to change)</span>' : '') + '<input name="password" type="password" autocomplete="new-password"></label>' +
      '<label>Daily limit of this mailbox<input name="daily_limit" type="number" min="10" value="' + o.daily_limit + '"></label></div>' +
      '<details><summary style="cursor:pointer" class="muted small">Servers (Hostinger is filled in)</summary><div class="channel-grid">' +
      '<label>Login username<input name="username" value="' + esc(o.username) + '" placeholder="same as address"></label>' +
      '<label>Outgoing (SMTP)<input name="smtp_host" value="' + esc(o.smtp_host) + '"></label><label>SMTP port<input name="smtp_port" type="number" value="' + o.smtp_port + '"></label>' +
      '<label>Incoming (IMAP)<input name="imap_host" value="' + esc(o.imap_host) + '"></label><label>IMAP port<input name="imap_port" type="number" value="' + o.imap_port + '"></label></div></details>' +
      '<p class="small">' + (o.tested ? '<span class="channel-state active"><i></i>Test passed ' + when(o.tested_at) + '</span>' : '<span class="channel-state warn"><i></i>Not tested</span>') +
      (o.replies_checked_at ? ' <span class="muted">replies last checked ' + when(o.replies_checked_at) + '</span>' : '') + '</p>' +
      '<details><summary style="cursor:pointer" class="small"><b>Footer added to every outreach email</b></summary><p class="muted small">Must keep {{source}} (where you found them) and tell people to reply STOP. Also available: {{sender_name}}, {{sender_title}}, {{company}}.</p>' +
      '<textarea name="footer" rows="5" style="width:100%">' + esc(data.settings.outreach_footer) + '</textarea></details>' +
      '<div class="channel-actions"><button class="button button-primary" type="submit">Save</button><button class="button button-soft" type="button" id="eeOutreachTest">Test connection</button></div><div id="eeOutreachResult"></div></form></details>';
  }

  function wireSettings() {
    var f = document.getElementById('eeOutreachForm');
    if (!f) return;
    f.onsubmit = async function (e) {
      e.preventDefault();
      var body = { outreach: { address: f.address.value, sender_name: f.sender_name.value, username: f.username.value, smtp_host: f.smtp_host.value, smtp_port: f.smtp_port.value, imap_host: f.imap_host.value, imap_port: f.imap_port.value, daily_limit: f.daily_limit.value, password: f.password.value || undefined }, outreach_footer: f.footer.value };
      try { await api('/api/email-engine/settings', { method: 'PUT', body: body }); toast('Saved — now press Test connection'); window.emailEngineSettingsView().then(function () { var b = document.getElementById('eeOutreachBox'); if (b) b.open = true; }); } catch (err) { toast(err.message); }
    };
    document.getElementById('eeOutreachTest').onclick = async function () {
      var btn = this; btn.disabled = true; btn.textContent = 'Testing…';
      try {
        var r = await api('/api/email-engine/outreach/test', { method: 'POST' });
        document.getElementById('eeOutreachResult').innerHTML = r.ok ? '<div class="channel-test ok">Sending and reading replies both work. Nothing was sent.</div>' :
          '<div class="channel-test bad">' + esc(r.error) + (r.steps ? '<ol>' + r.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' : '') + '</div>';
      } catch (err) { toast(err.message); }
      btn.disabled = false; btn.textContent = 'Test connection';
    };
  }

  window.EEOutreach = { paceFieldset: paceFieldset, readPace: readPace, paceText: paceText, card: card, wire: wire, settingsSection: settingsSection, wireSettings: wireSettings };
})();
