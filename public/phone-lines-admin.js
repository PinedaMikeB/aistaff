/* Platform > Phone Lines (added 2026-10-21).
   AIStaff staff add Pitch routers, assign one to a customer and hand over a kit
   with a one-time setup code. The customer finishes setup in their own
   Settings > Channels > Mobile Phone. Not yet connected to Pitch. */
(function () {
  'use strict';

  var LABEL = {
    in_stock: ['In stock', 'inactive'], assigned: ['Waiting for customer', 'warn'], active: ['Active', 'active'],
    suspended: ['Suspended', 'bad'], returned: ['Returned', 'inactive']
  };
  var devices = [];
  var openId = null;

  function esc(v) { return escapeHtml(v == null ? '' : String(v)); }
  function when(iso) { return iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
  function statusOf(d) {
    if (d.status === 'assigned' && d.claimed_at) return ['Set up by customer', 'active'];
    return LABEL[d.status] || [d.status, 'inactive'];
  }
  function badge(d) { var s = statusOf(d); return '<span class="channel-state ' + s[1] + '"><i></i>' + esc(s[0]) + '</span>'; }
  function customers() {
    var list = (window.platformState && window.platformState.customers) || (typeof platformState !== 'undefined' ? platformState.customers : []) || [];
    return list.filter(function (c) { return c.status === 'active'; });
  }

  function addForm() {
    return '<details class="channel-instructions"><summary style="cursor:pointer"><b>+ Add a router</b> <span class="muted small">new router and SIM into stock</span></summary>' +
      '<form id="plAddForm" class="channel-form"><div class="channel-grid">' +
      '<label>Where is the router?<select name="location"><option value="aistaff">Hosted at AIStaff (recommended)</option><option value="customer">At the customer\'s site</option></select></label>' +
      '<label>Model<input name="model" value="AIO100-1V" /></label>' +
      '<label>Serial number <span class="muted small">(router label)</span><input name="device_serial" required /></label>' +
      '<label>Phone number of the SIM<input name="phone_number" placeholder="0976 000 0000" /></label>' +
      '<label>SIM / ICCID number<input name="sim_number" /></label>' +
      '<label>Carrier<select name="carrier"><option>Smart</option><option>Globe</option><option>DITO</option><option>TNT</option><option>TM</option><option value="">Other</option></select></label>' +
      '<label>Simultaneous calls<input name="max_channels" type="number" min="1" max="8" value="1" /></label>' +
      '</div><details><summary style="cursor:pointer" class="muted small">Router network address (for the connection check)</summary><div class="channel-grid">' +
      '<label>Router address (IP)<input name="gateway_host" placeholder="192.168.100.200" /></label>' +
      '<label>SIP port<input name="gateway_port" type="number" placeholder="5080" /></label></div></details>' +
      '<label>Notes<input name="notes" maxlength="1000" /></label>' +
      '<div class="channel-actions"><button class="button button-primary" type="submit">Add router</button>' +
      '<span class="muted small">A private SIP login is created automatically.</span></div></form></details>';
  }

  function kit(d) {
    var expires = d.setup_code_expires_at ? new Date(d.setup_code_expires_at).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '';
    return '<div class="phone-kit" id="plKit">' +
      '<p class="eyebrow">AIStaff · Phone line setup</p>' +
      '<h3>' + esc(d.company_name) + '</h3>' +
      (d.phone_number ? '<p>Your AI phone number: <b>' + esc(d.phone_number) + '</b></p>' : '') +
      '<p>Your setup code:</p><div class="kit-code">' + esc(d.setup_code) + '</div>' +
      '<p class="muted small">Valid until ' + esc(expires) + '. Use it once.</p>' +
      (d.location === 'customer' ? '<ol><li>Put the SIM into the router (if it is not in yet).</li>' +
      '<li>Connect the router to your internet with the LAN cable, then plug in the power.</li>' : '<p class="muted small">AIStaff keeps and manages your router — nothing to install.</p><ol>') +
      '<li>Log in at <b>aistaff.click</b> and open <b>Settings › Channels › Mobile Phone</b>.</li>' +
      '<li>Type the setup code above and press <b>Link my router</b>.</li>' +
      '<li>Press <b>Check connection</b>, then give your phone assistant a name and greeting.</li></ol>' +
      '<p class="muted small">Router: ' + esc(d.model) + ' · Serial ' + esc(d.device_serial) + '</p></div>' +
      '<div class="channel-actions"><button class="button button-primary" type="button" data-kit-email="' + d.id + '">Email to customer</button>' +
      '<button class="button button-soft" type="button" data-kit-copy="' + d.id + '">Copy as text</button>' +
      '<button class="button button-soft" type="button" onclick="window.print()">Print</button>' +
      '<button class="button button-soft" type="button" data-kit-new="' + d.id + '">New code</button></div>';
  }

  function detail(d) {
    var c = customers();
    var assignable = d.status === 'in_stock' || (d.status === 'assigned' && !d.claimed_at);
    var parts = [];
    if (d.status === 'assigned' && !d.claimed_at && d.setup_code) parts.push('<h4>Handoff kit</h4>' + kit(d));
    if (assignable) {
      parts.push('<form class="channel-actions" data-assign="' + d.id + '"><label>Assign to customer <select name="company_id"><option value="">Choose…</option>' +
        c.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === d.company_id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') +
        '</select></label><button class="button button-primary" type="submit">' + (d.company_id ? 'Re-assign + new code' : 'Assign + create handoff kit') + '</button></form>');
    }
    parts.push('<div class="channel-actions"><span>' + (d.location === 'customer' ? 'At the customer\'s site' : 'Hosted at AIStaff') + '</span>' +
      '<button class="button button-soft" type="button" data-check="' + d.id + '">Check connection</button>' +
      '<span class="muted small">' + (d.last_check_at ? (d.last_check_ok ? '✔ reachable · ' : '✖ not reachable · ') + esc(when(d.last_check_at)) : 'not checked yet') + '</span></div>');
    if (d.claimed_at) parts.push('<p>Set up by <b>' + esc(d.company_name) + '</b> on ' + esc(when(d.claimed_at)) + '. Last connection check: ' + (d.last_check_at ? (d.last_check_ok ? '✔ ' : '✖ ') + esc(when(d.last_check_at)) : 'not yet') + '.</p>');
    parts.push('<details><summary style="cursor:pointer" class="muted small">Installer details and status</summary>' +
      '<p class="muted small">SIP login: <code>' + esc(d.auth_username) + '</code> <button class="button button-soft" type="button" data-sip="' + d.id + '">Show password</button> <span data-sip-out="' + d.id + '"></span></p>' +
      '<p class="muted small">SIM ' + esc(d.sim_number || '—') + ' · ' + esc(d.carrier || '—') + ' · Router address ' + esc(d.gateway_host || '—') + (d.gateway_port ? ':' + esc(d.gateway_port) : '') + ' · Calls at once: ' + esc(d.max_channels) + '</p>' +
      (d.notes ? '<p class="muted small">Notes: ' + esc(d.notes) + '</p>' : '') +
      '<div class="channel-actions">' +
        (d.status !== 'suspended' && d.company_id ? '<button class="button button-soft" type="button" data-st="suspended" data-id="' + d.id + '">Suspend</button>' : '') +
        (d.status === 'suspended' ? '<button class="button button-soft" type="button" data-st="active" data-id="' + d.id + '">Resume</button>' : '') +
        (d.status !== 'in_stock' ? '<button class="button button-soft" type="button" data-st="in_stock" data-id="' + d.id + '">Unassign → back to stock</button>' : '') +
        (d.status !== 'returned' ? '<button class="button button-soft" type="button" data-st="returned" data-id="' + d.id + '">Mark returned</button>' : '') +
      '</div></details>');
    return parts.join('');
  }

  function rows() {
    if (!devices.length) return '<p class="muted">No routers yet. Add the first one above.</p>';
    return '<div class="table-wrap"><table><thead><tr><th>Router</th><th>Phone number</th><th>Customer</th><th>Status</th><th>Last check</th><th></th></tr></thead><tbody>' +
      devices.map(function (d) {
        var open = openId === d.id;
        return '<tr><td><b>' + esc(d.model) + '</b><br><span class="muted small">' + esc(d.device_serial) + '</span></td>' +
          '<td>' + esc(d.phone_number || '—') + '</td><td>' + esc(d.company_name || '—') + '</td><td>' + badge(d) + '</td>' +
          '<td class="muted small">' + (d.last_check_at ? (d.last_check_ok ? '✔ ' : '✖ ') + esc(when(d.last_check_at)) : '—') + '</td>' +
          '<td><button class="intake-link" type="button" data-open="' + d.id + '">' + (open ? 'Close' : 'Open →') + '</button></td></tr>' +
          (open ? '<tr><td colspan="6">' + detail(d) + '</td></tr>' : '');
      }).join('') + '</tbody></table></div>';
  }

  function render() {
    var holder = document.getElementById('phoneLinesHolder');
    if (!holder) return;
    holder.innerHTML = '<section class="panel"><div class="platform-section-head"><div><h2>Phone Lines</h2>' +
      '<p class="muted settings-lede">Pitch routers. Add a router, assign it to a customer, and give them the handoff kit. They finish setup in their own Settings › Channels › Mobile Phone.</p></div></div>' +
      addForm() + '<div id="plRows">' + rows() + '</div></section>';
    wire();
  }

  async function load() {
    try { devices = (await api('/api/platform/phone-lines')).devices || []; } catch (e) { devices = []; toast(e.message || 'Could not load phone lines'); }
    render();
  }

  function replace(d) { devices = devices.map(function (x) { return x.id === d.id ? d : x; }); if (!devices.some(function (x) { return x.id === d.id; })) devices.unshift(d); }

  function wire() {
    var add = document.getElementById('plAddForm');
    if (add) add.onsubmit = async function (e) {
      e.preventDefault();
      var fd = new FormData(add); var body = {};
      fd.forEach(function (v, k) { body[k] = v; });
      try { var r = await api('/api/platform/phone-lines', { method: 'POST', body: body }); replace(r.device); openId = r.device.id; toast('Router added to stock'); render(); }
      catch (err) { toast(err.message || 'Could not add router'); }
    };
    document.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { var id = b.getAttribute('data-open'); openId = openId === id ? null : id; render(); }; });
    document.querySelectorAll('[data-assign]').forEach(function (f) {
      f.onsubmit = async function (e) {
        e.preventDefault();
        var id = f.getAttribute('data-assign');
        try { var r = await api('/api/platform/phone-lines/' + id + '/assign', { method: 'POST', body: { company_id: f.company_id.value } }); replace(r.device); toast('Assigned — handoff kit ready'); render(); }
        catch (err) { toast(err.message || 'Could not assign'); }
      };
    });
    document.querySelectorAll('[data-kit-new]').forEach(function (b) {
      b.onclick = async function () {
        if (!window.confirm('Create a new setup code? The old code stops working.')) return;
        try { var r = await api('/api/platform/phone-lines/' + b.getAttribute('data-kit-new') + '/new-code', { method: 'POST' }); replace(r.device); toast('New code created'); render(); }
        catch (err) { toast(err.message); }
      };
    });
    document.querySelectorAll('[data-kit-email]').forEach(function (b) {
      b.onclick = async function () {
        var id = b.getAttribute('data-kit-email');
        var suggested = [];
        try { suggested = (await api('/api/platform/phone-lines/' + id + '/kit-recipients')).emails || []; } catch (e) { suggested = []; }
        var to = window.prompt('Send the setup code and steps to (separate several with commas):', suggested.join(', '));
        if (to === null) return;
        b.disabled = true; b.textContent = 'Sending…';
        try { var r = await api('/api/platform/phone-lines/' + id + '/email-kit', { method: 'POST', body: { to: to } }); toast('Kit emailed to ' + r.sent_to.join(', ')); }
        catch (err) { toast(err.message || 'Could not send'); }
        b.disabled = false; b.textContent = 'Email to customer';
      };
    });
    document.querySelectorAll('[data-check]').forEach(function (b) {
      b.onclick = async function () {
        b.disabled = true; b.textContent = 'Checking…';
        try { var r = await api('/api/platform/phone-lines/' + b.getAttribute('data-check') + '/check', { method: 'POST' }); replace(r.device); toast(r.check.detail); render(); }
        catch (err) { toast(err.message); b.disabled = false; b.textContent = 'Check connection'; }
      };
    });
    document.querySelectorAll('[data-kit-copy]').forEach(function (b) {
      b.onclick = function () {
        var el = document.getElementById('plKit');
        var text = el ? el.innerText : '';
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('Copied — paste it into an email or chat to the customer'); });
      };
    });
    document.querySelectorAll('[data-sip]').forEach(function (b) {
      b.onclick = async function () {
        var id = b.getAttribute('data-sip');
        try { var r = await api('/api/platform/phone-lines/' + id + '/sip-login'); document.querySelector('[data-sip-out="' + id + '"]').innerHTML = '<code>' + esc(r.password) + '</code> <span class="muted small">(viewing is logged)</span>'; }
        catch (err) { toast(err.message); }
      };
    });
    document.querySelectorAll('[data-st]').forEach(function (b) {
      b.onclick = async function () {
        var st = b.getAttribute('data-st');
        var words = { suspended: 'Suspend this line? Calls stop once phone lines are connected to Pitch.', in_stock: 'Unassign this router and put it back in stock? The customer loses this phone line.', returned: 'Mark this router as returned?', active: 'Resume this line?' };
        if (!window.confirm(words[st])) return;
        try { var r = await api('/api/platform/phone-lines/' + b.getAttribute('data-id') + '/status', { method: 'POST', body: { status: st } }); replace(r.device); toast('Updated'); render(); }
        catch (err) { toast(err.message); }
      };
    });
  }

  window.loadPhoneLinesPanel = load;
})();
