/* Business Engines > Customer Service > Scheduling cut-off (added 2026-10-20). Off by default. */
(function () {
  'use strict';
  var DAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']];
  var BOX = 'width:18px;height:18px;margin:0;flex:none;accent-color:#5b4bdb';
  function esc(v) { return escapeHtml(v == null ? '' : String(v)); }
  function tick(name, checked, label) {
    return '<label style="display:flex;align-items:center;gap:10px;margin:10px 0;cursor:pointer"><input type="checkbox" name="' + name + '" style="' + BOX + '"' + (checked ? ' checked' : '') + '> <span>' + label + '</span></label>';
  }
  function row(label, inner) {
    return '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:10px 0"><b style="min-width:150px">' + label + '</b>' + inner + '</div>';
  }

  window.mountSchedulingSettings = async function (engineKey) {
    var box = document.getElementById('engineSchedulingPanel');
    if (!box) return;
    var url = '/api/engine-scheduling/' + encodeURIComponent(engineKey || 'customer_service');
    var data;
    try { data = await api(url); } catch (error) { box.innerHTML = '<p class="muted">Could not load the scheduling rules: ' + esc(error.message) + '</p>'; return; }
    var s = data.settings, p = data.preview;
    box.innerHTML = [
      '<details class="engine-instruction-disclosure"><summary style="cursor:pointer"><span><b>Scheduling cut-off</b> <small class="muted">' + (s.enabled ? 'On · ' + esc(s.cutoff_time) + ' · ' + s.working_days.length + ' working days' : 'Off') + ' · customers ' + (s.tell_customer_schedule ? 'may be told the target day' : 'are never told a day or time') + '</small></span></summary>',
      '<p class="muted">Tick this only if your service work has a daily cut-off. AIStaff then saves new requests on the right day in your system. Leave it unticked if you don\'t use a cut-off. Nothing changes.</p>',
      '<form id="schedulingForm">',
      tick('enabled', s.enabled, '<b>We use a daily cut-off for scheduling service requests</b>'),
      '<div class="scheduling-fields"' + (s.enabled ? '' : ' hidden') + '>',
      row('Cut-off time', '<input type="time" name="cutoff_time" value="' + esc(s.cutoff_time) + '" style="width:9em"> <span class="muted small">Philippine time. Requests after this count as next-day calls.</span>'),
      row('Working days', DAYS.map(function (d) { return '<label style="display:inline-flex;align-items:center;gap:6px;margin-right:6px"><input type="checkbox" name="day" value="' + d[0] + '" style="' + BOX + '"' + (s.working_days.indexOf(Number(d[0])) > -1 ? ' checked' : '') + '> ' + d[1] + '</label>'; }).join('')),
      row('Earliest schedule', '<input type="number" name="lead_days" min="0" max="14" value="' + esc(s.lead_days) + '" style="width:5em"> <span class="muted small">working day(s) after the request (1 = next working day, 0 = same day).</span>'),
      row('Needs preparation', '<input type="text" name="prep_keywords" value="' + esc(s.prep_keywords.join(', ')) + '" placeholder="e.g. toner, ink, cartridge, parts" style="flex:1;min-width:16em">'),
      row('Preparation days', '<input type="number" name="prep_days" min="0" max="14" value="' + esc(s.prep_days) + '" style="width:5em"> <span class="muted small">extra working day(s) when such a request comes in after the cut-off. Before the cut-off it is prepared the same day.</span>'),
      row('Holidays', '<textarea name="holidays" rows="2" placeholder="One date per line, e.g. 2026-12-25" style="flex:1;min-width:16em">' + esc(s.holidays.join('\n')) + '</textarea>'),
      row('Order of calls', '<input type="text" name="queue_note" value="' + esc(s.queue_note) + '" style="flex:1;min-width:16em">'),
      '<p class="muted small">Example: a request right now would be saved for <b>' + esc(p.plain) + '</b>' + (s.prep_keywords.length ? ', or <b>' + esc(p.prep) + '</b> if it needs preparation' : '') + ' (' + (p.now_after_cutoff ? 'after' : 'before') + ' the cut-off).</p>',
      '</div>',
      tick('tell_customer_schedule', s.tell_customer_schedule, 'Closer may tell customers the target day <span class="muted small">(off: Closer never gives a day, date or time and never promises when; it only confirms the request is saved with its reference number)</span>'),
      '<div class="channel-actions"><button class="button button-primary" type="submit">Save scheduling rules</button></div>',
      '</form></details>'
    ].join('');
    var form = document.getElementById('schedulingForm');
    form.enabled.onchange = function () { form.querySelector('.scheduling-fields').hidden = !form.enabled.checked; };
    form.onsubmit = async function (event) {
      event.preventDefault();
      var body = {
        enabled: form.enabled.checked,
        cutoff_time: form.cutoff_time.value,
        working_days: Array.prototype.map.call(form.querySelectorAll('[name="day"]:checked'), function (i) { return Number(i.value); }),
        lead_days: Number(form.lead_days.value),
        prep_keywords: form.prep_keywords.value,
        prep_days: Number(form.prep_days.value),
        holidays: form.holidays.value,
        queue_note: form.queue_note.value,
        tell_customer_schedule: form.tell_customer_schedule.checked
      };
      if (body.enabled && !body.working_days.length) { toast('Choose at least one working day.'); return; }
      try { await api(url, { method: 'PUT', body: body }); toast('Scheduling rules saved'); window.mountSchedulingSettings(engineKey); } catch (error) { toast(error.message); }
    };
  };
})();
