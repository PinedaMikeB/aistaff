/* Settings > General > Daily briefing report (added 2026-10-20). */
(function () {
  'use strict';
  var DAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']];
  function esc(v) { return escapeHtml(v == null ? '' : String(v)); }

  window.mountBriefingSettings = async function () {
    var box = document.getElementById('briefingSettingsPanel');
    if (!box) return;
    var data;
    try { data = await api('/api/briefing'); } catch (error) { box.innerHTML = '<p class="muted">Could not load the briefing settings: ' + esc(error.message) + '</p>'; return; }
    var s = data.settings;
    var sum = document.getElementById('briefingSummary');
    if (sum) sum.textContent = s.enabled ? 'On · ' + s.time + ' · ' + s.days.length + ' days a week' : 'Off';
    box.innerHTML = [
      '<p class="muted">One email with every unresolved customer request — with or without a reference number — with the problem, a recommendation and buttons to close or retry. Tickets already finished in your system are closed automatically and the customer is told.</p>',
      '<form id="briefingForm" class="briefing-form">',
      '<label class="briefing-on"><input type="checkbox" name="enabled"' + (s.enabled ? ' checked' : '') + '> <b>Send the daily briefing report</b></label>',
      '<div class="briefing-row"><span class="briefing-label">Days</span>' + DAYS.map(function (d) { return '<label class="briefing-chip"><input type="checkbox" name="day" value="' + d[0] + '"' + (s.days.indexOf(Number(d[0])) > -1 ? ' checked' : '') + '> ' + d[1] + '</label>'; }).join('') + '</div>',
      '<div class="briefing-row"><span class="briefing-label">Time</span><input type="time" name="time" value="' + esc(s.time) + '"> <span class="muted small">Philippine time · repeats every chosen day</span></div>',
      '<div class="briefing-row briefing-sections"><span class="briefing-label">Include</span>' + Object.keys(data.sections).map(function (k) { return '<label><input type="checkbox" name="section" value="' + k + '"' + (s.sections[k] ? ' checked' : '') + '> ' + esc(data.sections[k]) + '</label>'; }).join('') + '</div>',
      '<p class="muted small">Sent to: <b>' + (data.recipients.length ? data.recipients.map(function (r) { return esc(r.name ? r.name + ' <' + r.email + '>' : r.email); }).join(', ') : 'nobody yet') + '</b> — tick <b>Daily report</b> for a person in "Who gets alerts" above (everyone in that list gets it when nobody is ticked). The platform admin gets a copy.' + (s.last_sent_at ? ' Last sent ' + esc(new Date(s.last_sent_at).toLocaleString('en-PH')) + '.' : '') + '</p>',
      '<div class="channel-actions"><button class="button button-primary" type="submit">Save briefing settings</button><button class="button button-soft" type="button" id="briefingTest">Send a test report to me now</button></div>',
      '</form>'
    ].join('');
    var form = document.getElementById('briefingForm');
    form.onsubmit = async function (event) {
      event.preventDefault();
      var body = {
        enabled: form.enabled.checked,
        time: form.time.value,
        days: Array.prototype.map.call(form.querySelectorAll('[name="day"]:checked'), function (i) { return Number(i.value); }),
        sections: Object.fromEntries(Array.prototype.map.call(form.querySelectorAll('[name="section"]'), function (i) { return [i.value, i.checked]; }))
      };
      try { await api('/api/briefing', { method: 'PUT', body: body }); toast('Briefing settings saved'); window.mountBriefingSettings(); } catch (error) { toast(error.message); }
    };
    document.getElementById('briefingTest').onclick = async function (event) {
      var btn = event.currentTarget;
      btn.disabled = true; btn.textContent = 'Building the report…';
      try { var r = await api('/api/briefing/test', { method: 'POST' }); toast(r.ok ? 'Test report sent to ' + r.to : 'Could not send the test report'); }
      catch (error) { toast(error.message); }
      btn.disabled = false; btn.textContent = 'Send a test report to me now';
    };
  };
})();
