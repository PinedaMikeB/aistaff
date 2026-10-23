/* Business Engines > Customer Service > After-service follow-up (added 2026-10-20). Folded by default. */
(function () {
  'use strict';
  var BOX = 'width:18px;height:18px;margin:0;flex:none;accent-color:#5b4bdb';
  function esc(v) { return escapeHtml(v == null ? '' : String(v)); }
  function starsText(n) { return n ? n.toFixed(1) + ' ★' : '—'; }

  window.mountFeedbackSettings = async function (engineKey) {
    var box = document.getElementById('engineFeedbackPanel');
    if (!box) return;
    var url = '/api/engine-feedback/' + encodeURIComponent(engineKey || 'customer_service');
    var data;
    try { data = await api(url); } catch (error) { box.innerHTML = '<p class="muted">Could not load the after-service settings: ' + esc(error.message) + '</p>'; return; }
    var s = data.settings, sum = data.summary, topics = data.topics, freqs = data.frequencies;
    var surveyOn = Object.keys(s.topics).filter(function (k) { return s.topics[k] !== 'off'; }).length;
    var summaryLine = (s.completion_check ? 'Completion check on' : 'Completion check off') + ' · survey ' + (surveyOn ? surveyOn + ' topic' + (surveyOn > 1 ? 's' : '') : 'off') +
      (sum.answered ? ' · ' + sum.answered + ' answer' + (sum.answered > 1 ? 's' : '') + ' in 30 days' + (sum.not_done ? ', ' + sum.not_done + ' not done' : '') : '');
    var select = function (key) {
      return '<select name="topic_' + key + '">' + Object.keys(freqs).map(function (f) { return '<option value="' + f + '"' + (s.topics[key] === f ? ' selected' : '') + '>' + esc(freqs[f]) + '</option>'; }).join('') + '</select>';
    };
    var results = !sum.sent && !sum.answered ? '<p class="muted small">No follow-ups sent yet. They start when a job is closed or delivered.</p>' : [
      '<p class="small">Last 30 days: <b>' + sum.sent + '</b> sent · <b>' + sum.answered + '</b> answered · <b>' + sum.not_done + '</b> said not done</p>',
      '<table class="small" style="border-collapse:collapse;margin:6px 0 10px">' + Object.keys(topics).map(function (k) {
        var a = sum.average[k];
        return '<tr><td style="padding:3px 12px 3px 0">' + esc(topics[k].label) + '</td><td><b>' + starsText(a && a.average) + '</b> <span class="muted">' + (a ? '(' + a.count + ')' : '') + '</span></td></tr>';
      }).join('') + '</table>',
      sum.latest.length ? '<details><summary style="cursor:pointer" class="small">Latest answers</summary><ul class="small" style="padding-left:18px">' + sum.latest.map(function (r) {
        var rates = Object.keys(r.ratings).map(function (k) { return k.replace('_', ' ') + ' ' + r.ratings[k] + '/5'; }).join(', ');
        return '<li><b>' + esc(r.customer) + '</b> · ' + esc(r.reference || '') + ' · ' + (r.done === 'no' ? '<b style="color:#b91c1c">NOT done</b>' : 'done') + (rates ? ' · ' + esc(rates) : '') + (r.problem ? ' · "' + esc(r.problem) + '"' : '') + (r.comment ? ' · "' + esc(r.comment) + '"' : '') + '</li>';
      }).join('') + '</ul></details>' : ''
    ].join('');
    box.innerHTML = [
      '<details class="engine-instruction-disclosure"><summary style="cursor:pointer"><span><b>After-service follow-up</b> <small class="muted">' + esc(summaryLine) + '</small></span></summary>',
      '<form id="feedbackForm">',
      '<label style="display:flex;align-items:flex-start;gap:10px;margin:12px 0;cursor:pointer"><input type="checkbox" name="completion_check" style="' + BOX + ';margin-top:3px"' + (s.completion_check ? ' checked' : '') + '> <span><b>Completion check</b> — right after a job is closed or delivered, email the customer: "Was it done?" (Yes / No). <span class="muted small">"No" alerts your team at once.</span></span></label>',
      '<details style="margin:8px 0"><summary style="cursor:pointer"><b>Survey</b> <small class="muted">how often each customer is asked, counted in finished jobs (shown after they answer Yes)</small></summary>',
      '<table style="border-collapse:collapse;margin:8px 0">' + Object.keys(topics).map(function (k) {
        return '<tr><td style="padding:6px 14px 6px 0">' + esc(topics[k].label) + '</td><td>' + select(k) + '</td></tr>';
      }).join('') + '</table>',
      '<p style="margin:8px 0">Alert the team when a rating is <select name="low_rating">' + [1, 2, 3].map(function (n) { return '<option value="' + n + '"' + (s.low_rating === n ? ' selected' : '') + '>' + n + ' star' + (n > 1 ? 's' : '') + ' or lower</option>'; }).join('') + '</select></p>',
      '</details>',
      '<div class="channel-actions"><button class="button button-primary" type="submit">Save</button></div>',
      '</form>',
      '<details style="margin-top:10px"><summary style="cursor:pointer"><b>Results</b></summary>' + results + '</details>',
      '</details>'
    ].join('');
    var form = document.getElementById('feedbackForm');
    form.onsubmit = async function (event) {
      event.preventDefault();
      var body = { completion_check: form.completion_check.checked, low_rating: Number(form.low_rating.value), topics: {} };
      Object.keys(topics).forEach(function (k) { body.topics[k] = form['topic_' + k].value; });
      try { await api(url, { method: 'PUT', body: body }); toast('After-service follow-up saved'); window.mountFeedbackSettings(engineKey); } catch (error) { toast(error.message); }
    };
  };
})();
