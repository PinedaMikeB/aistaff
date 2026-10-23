/* Business Engines tenant settings. Automatic setup first; technical controls stay under Advanced. */
(function () {
  'use strict';

  var policyOrder = ['automatic', 'customer_confirmation', 'staff_approval', 'staff_only'];
  var policyLabels = {
    automatic: 'Automatic',
    customer_confirmation: 'Customer confirms',
    staff_approval: 'Staff approves',
    staff_only: 'Staff handles it'
  };
  var fallbackLabels = {
    create_human_task: 'Ask a staff member to do it',
    create_pending_action: 'Save it for staff approval',
    escalate_to_staff: 'Send it to staff',
    inform_customer_review: 'Tell the customer staff will review it',
    ask_staff_manual: 'Ask staff to complete it manually',
    log_missing_capability: 'Record the missing job only'
  };
  var requestStatusLabels = {
    pending_customer_confirmation: 'Waiting for the customer',
    pending_staff_approval: 'Waiting for staff approval',
    succeeded: 'Completed',
    failed: 'Could not complete'
  };

  function engineUrl(key) {
    return '/admin/settings/business-engines' + (key ? '?engine=' + encodeURIComponent(key) : '');
  }

  function selectedEngineKey() {
    return new URLSearchParams(location.search).get('engine') || '';
  }

  function engineState(engine) {
    if (!engine.enabled) return '<span class="engine-state inactive">Not active</span>';
    return '<span class="engine-state active"><i></i>Active</span>';
  }

  function capabilitySummary(engine) {
    if (!engine.enabled && engine.recommendation) {
      return [
        '<div class="engine-capability-summary">',
        '<span><b>', engine.recommendation.ready, '</b> suggested</span>',
        engine.recommendation.review ? '<span class="has-warning"><b>' + engine.recommendation.review + '</b> need review</span>' : '',
        '</div>'
      ].join('');
    }
    var warnings = engine.operations.filter(function (operation) {
      return operation.enabled && (!operation.mapping || operation.policy === 'staff_only');
    });
    return [
      '<div class="engine-capability-summary">',
      '<span><b>', engine.summary.available, '</b> available</span>',
      warnings.length ? '<span class="has-warning"><b>' + warnings.length + '</b> need staff</span>' : '',
      '</div>'
    ].join('');
  }

  function engineInstructionDisclosure(engine) {
    var config = engine.instructionConfig || {};
    var instruction = String(config.currentInstruction || engine.systemGuidance || engine.defaultInstruction || '').trim();
    var revisions = Array.isArray(config.revisions) ? config.revisions : [];
    var status = config.usingDefault ? 'Platform default' : 'Custom v' + (config.activeVersion || '');
    var history = revisions.map(function (revision) {
      return [
        '<article class="engine-instruction-version">',
        '<div><b>Version ', revision.version, '</b>', revision.active ? '<span class="engine-version-active">Active</span>' : '',
        '<small>', escapeHtml(revision.note || 'No change note'), ' · ', escapeHtml(new Date(revision.createdAt).toLocaleString()), '</small></div>',
        '<div class="engine-version-actions">',
        '<details><summary>View</summary><p>', escapeHtml(revision.content), '</p></details>',
        revision.active ? '' : '<button class="button button-soft" type="button" data-restore-engine-instruction="' + revision.version + '">Restore</button>',
        revision.active ? '' : '<button class="button button-danger-soft" type="button" data-delete-engine-instruction="' + revision.version + '">Delete</button>',
        '</div></article>'
      ].join('');
    }).join('');
    return [
      '<details class="panel engine-instruction-disclosure">',
      '<summary><span><b>Engine instructions</b><small>Rules for this type of work</small></span>',
      '<span class="engine-guidance-state is-on">', escapeHtml(status), '</span></summary>',
      '<div class="engine-instruction-body">',
      '<form id="engineInstructionForm" class="engine-instruction-form">',
      '<label>Instructions<textarea name="content" rows="8" maxlength="12000" required>', escapeHtml(instruction), '</textarea></label>',
      '<label>What changed? <span>(optional)</span><input name="note" maxlength="300" placeholder="Example: Search a serial number before asking for customer details" /></label>',
      '<div class="engine-instruction-actions"><button class="button button-primary" type="submit">Save new version</button>',
      config.usingDefault ? '' : '<button class="button button-soft" id="resetEngineInstruction" type="button">Use platform default</button>',
      '</div></form>',
      '<p class="engine-instruction-source">This applies only to ', escapeHtml(engine.name), ' for this company. Saving creates a new version.</p>',
      revisions.length ? '<details class="engine-instruction-history"><summary>Version history (' + revisions.length + ')</summary><div>' + history + '</div></details>' : '',
      '</div></details>'
    ].join('');
  }

  function cards(engines) {
    return engines.map(function (engine) {
      return [
        '<article class="business-engine-card ', engine.enabled ? 'is-active' : '', '">',
        '<div class="engine-card-stripe"></div><header><div><p class="eyebrow">Business Engine</p><h3>', escapeHtml(engine.name), '</h3></div>',
        engineState(engine), '</header>',
        '<p class="engine-description">', escapeHtml(engine.description), '</p>',
        capabilitySummary(engine),
        '<div class="engine-card-actions"><a class="button ', engine.enabled ? 'button-soft' : 'button-primary', '" href="', engineUrl(engine.key), '" data-configure-engine="', escapeHtml(engine.key), '">', engine.enabled ? 'Manage' : 'Review setup', '</a>',
        engine.enabled ? '<button class="button button-soft engine-deactivate" type="button" data-toggle-engine="' + escapeHtml(engine.key) + '">Deactivate</button>' : '',
        '</div></article>'
      ].join('');
    }).join('');
  }

  function actionOptions(data, operation) {
    var items = ['<option value="">Staff handles this</option>'];
    data.connections.forEach(function (connection) {
      connection.actions.forEach(function (action) {
        var selected = operation.mapping && operation.mapping.actionId === action.id;
        items.push('<option value="' + escapeHtml(action.id) + '" ' + (selected ? 'selected' : '') + '>' +
          escapeHtml(connection.name + ' · ' + action.displayName) + '</option>');
      });
    });
    return items.join('');
  }

  function policyOptions(operation) {
    var minimum = policyOrder.indexOf(operation.minimumPolicy);
    return policyOrder.map(function (policy, index) {
      return '<option value="' + policy + '" ' + (operation.policy === policy ? 'selected' : '') + ' ' + (index < minimum ? 'disabled' : '') + '>' + policyLabels[policy] + '</option>';
    }).join('');
  }

  function fallbackOptions(operation) {
    return Object.keys(fallbackLabels).map(function (key) {
      return '<option value="' + key + '" ' + (operation.fallbackPolicy === key ? 'selected' : '') + '>' + fallbackLabels[key] + '</option>';
    }).join('');
  }

  function fieldRows(engine) {
    return engine.fields.map(function (field) {
      return [
        '<tr data-engine-field="', escapeHtml(field.key), '"><td><input type="checkbox" name="enabled" ', field.enabled ? 'checked' : '', ' aria-label="Enable ', escapeHtml(field.label), '" /></td>',
        '<td><b>', escapeHtml(field.label), '</b><code>', escapeHtml(field.key), '</code>', field.custom ? '<small>Custom field</small>' : '', '</td>',
        '<td><select name="required"><option value="false" ', !field.required ? 'selected' : '', '>Optional</option><option value="true" ', field.required ? 'selected' : '', '>Required</option></select></td>',
        '<td><input name="externalField" value="', escapeHtml(field.externalField), '" placeholder="Matched automatically" aria-label="External field for ', escapeHtml(field.label), '" /></td>',
        '<td><button class="button button-soft" type="button" data-save-field="', escapeHtml(field.key), '">Save</button></td></tr>'
      ].join('');
    }).join('');
  }

  // Integration blueprint: labels, notes, steps, derived fields and anchors for
  // the mapped app action. See docs/MASTERPLAN-integration-blueprints.md.
  function blueprintEditor(operation) {
    if (!operation.mapping || !operation.mapping.action) return '';
    var action = operation.mapping.action;
    var warnings = operation.mapping.blueprintWarnings || [];
    var fields = (action.fields || []).map(function (field) {
      return '<li><code>' + escapeHtml(field.key) + '</code> ' + escapeHtml(field.type || '') +
        (field.required ? ' · required' : '') +
        (field.enum ? ' · ' + escapeHtml(field.enum.join(', ')) : '') +
        (field.description ? '<small>' + escapeHtml(field.description) + '</small>' : '') + '</li>';
    }).join('');
    return [
      '<details class="engine-advanced engine-blueprint"', warnings.length ? ' open' : '', '><summary>Blueprint', warnings.length ? ' · ' + warnings.length + ' to review' : '', '</summary>',
      warnings.length ? '<ul class="engine-blueprint-warnings">' + warnings.map(function (text) { return '<li>' + escapeHtml(text) + '</li>'; }).join('') + '</ul>' : '',
      '<p class="engine-instruction-source">Closer sees these app fields exactly as the app defines them. Use the blueprint to label coded values, add notes, set the usual question order, derive fields (for example priority from machine status), and name where the reference number is returned.</p>',
      '<details><summary>App fields (', escapeHtml(action.method + ' ' + action.path), ')</summary><ul class="engine-blueprint-fields">', fields, '</ul></details>',
      '<label>Blueprint (JSON)<textarea name="workflowConfig" rows="10" spellcheck="false">', escapeHtml(JSON.stringify(operation.mapping.workflowConfig || {}, null, 2)), '</textarea></label>',
      '<button class="button button-soft" type="button" data-save-blueprint="', escapeHtml(operation.key), '">Save blueprint</button>',
      '</details>'
    ].join('');
  }

  function operationRows(data, engine) {
    return engine.operations.map(function (operation) {
      var mappingJson = JSON.stringify(operation.mapping ? operation.mapping.fieldMapping : {}, null, 2);
      var mappingState = operation.mapping ? '<span class="mapping-state mapped">Connected</span>' : '<span class="mapping-state missing">Staff</span>';
      return [
        '<tr data-engine-operation="', escapeHtml(operation.key), '">',
        '<td><input name="enabled" type="checkbox" ', operation.enabled ? 'checked' : '', ' aria-label="Enable ', escapeHtml(operation.name), '" /></td>',
        '<td><b>', escapeHtml(operation.name), '</b><small>', escapeHtml(operation.description), '</small></td>',
        '<td>', mappingState, '<select name="actionId">', actionOptions(data, operation), '</select></td>',
        '<td><select name="policy">', policyOptions(operation), '</select></td>',
        '<td><select name="fallbackPolicy">', fallbackOptions(operation), '</select></td>',
        '<td><details class="engine-advanced"><summary>Field mapping</summary><label>AIStaff field → app field<textarea name="fieldMapping" rows="5" spellcheck="false">', escapeHtml(mappingJson), '</textarea></label></details>',
        blueprintEditor(operation),
        '<button class="button button-soft" type="button" data-save-operation="', escapeHtml(operation.key), '">Save</button></td>',
        '</tr>'
      ].join('');
    }).join('');
  }

  function requestRows(data, engine) {
    var rows = data.requests.filter(function (request) { return request.engine === engine.name; });
    if (!rows.length) return '<tr><td colspan="6" class="muted">No activity yet.</td></tr>';
    return rows.map(function (request) {
      return '<tr><td>' + fmtDate(request.createdAt) + '</td><td><b>' + escapeHtml(request.operation) + '</b></td><td><span class="mapping-state">' + escapeHtml(requestStatusLabels[request.status] || request.status.replaceAll('_', ' ')) + '</span></td><td>' + escapeHtml(policyLabels[request.policy] || request.policy.replaceAll('_', ' ')) + '</td><td>' + escapeHtml(request.requestedBy || 'Closer') + '</td><td>' +
        (request.status === 'pending_staff_approval' ? '<button class="button button-primary" type="button" data-approve-engine-request="' + escapeHtml(request.id) + '">Approve</button>' : '') + '</td></tr>';
    }).join('');
  }

  function candidateFor(recommendation, actionId) {
    return recommendation.alternatives.find(function (candidate) { return candidate.actionId === actionId; }) || null;
  }

  function safestPolicy(operationPolicy, candidate) {
    var values = [operationPolicy, candidate && candidate.minimumPolicy].filter(Boolean);
    return values.sort(function (left, right) { return policyOrder.indexOf(right) - policyOrder.indexOf(left); })[0] || 'staff_approval';
  }

  function fieldReviewMarkup(engine, candidate) {
    if (!candidate || !candidate.unresolved.length) return '<span class="engine-match-ok">Fields matched</span>';
    return [
      '<div class="engine-field-review"><b>Match ', candidate.unresolved.length, ' required ', candidate.unresolved.length === 1 ? 'field' : 'fields', '</b>',
      candidate.unresolved.map(function (issue) {
        return '<label><span class="engine-field-target"><small>App field</small><code>' + escapeHtml(issue.label) + '</code></span><select data-map-external="' + escapeHtml(issue.externalField) + '"><option value="">Choose information…</option>' +
          engine.fields.filter(function (field) { return field.enabled; }).map(function (field) {
            return '<option value="' + escapeHtml(field.key) + '">' + escapeHtml(field.label) + '</option>';
          }).join('') + '</select></label>';
      }).join(''),
      '</div>'
    ].join('');
  }

  function recommendationRows(engine) {
    var visible = engine.recommendation.recommendations.filter(function (item) { return item.status !== 'missing'; });
    return visible.map(function (item) {
      var candidate = candidateFor(item, item.recommendedActionId);
      var status = item.status === 'connected' ? 'Connected' : item.status === 'ready' ? 'Suggested' : 'Needs review';
      return [
        '<article class="engine-recommendation-row ', item.status === 'review' ? 'needs-review' : '', '" data-engine-recommendation="', escapeHtml(item.operationKey), '">',
        '<label class="engine-job-choice"><input type="checkbox" ', item.selected ? 'checked' : '', ' />',
        '<span><b>', escapeHtml(item.operationName), '</b><small>', escapeHtml(item.operationDescription), '</small></span></label>',
        '<div class="engine-match-choice"><span class="engine-suggestion-state ', escapeHtml(item.status), '">', status, '</span>',
        '<select data-recommended-action aria-label="Company function for ', escapeHtml(item.operationName), '">',
        item.alternatives.map(function (alternative) {
          return '<option value="' + escapeHtml(alternative.actionId) + '" ' + (alternative.actionId === item.recommendedActionId ? 'selected' : '') + '>' + escapeHtml(alternative.connectionName + ' · ' + alternative.actionName) + '</option>';
        }).join(''),
        '</select><small data-permission-label>', escapeHtml(policyLabels[safestPolicy(item.policy, candidate)]), '</small></div>',
        '<div class="engine-field-review-slot">', fieldReviewMarkup(engine, candidate), '</div>',
        '<details class="engine-technical-detail"><summary>Technical details</summary><code>', candidate ? escapeHtml(candidate.method + ' ' + candidate.path) : '', '</code></details>',
        '</article>'
      ].join('');
    }).join('');
  }

  function renderOverview(data) {
    var active = data.engines.filter(function (engine) { return engine.enabled; }).length;
    $('#adminContent').innerHTML = [
      settingsTabs('business-engines'),
      '<div class="settings-stack business-engines-view">',
      '<section class="panel engine-control-strip"><div><p class="eyebrow">AI Employee work</p><h2>Business Engines</h2><p class="muted settings-lede">Choose a type of work. AIStaff will match your connected app automatically before anything is activated.</p></div>',
      '<div class="engine-overview-metrics"><span><b>', active, '</b> active</span><span><b>', data.engines.length - active, '</b> available</span></div></section>',
      // Folded by default (Mike 2026-10-20): advanced; the summary line still shows waiting customers.
      '<details class="panel workflows-panel" id="workflowsPanel"><summary style="cursor:pointer;font-weight:600">Workflows (advanced) <span class="muted small" id="workflowsSummary"></span></summary><div class="workflows-list muted">Loading workflows…</div></details>',
      '<section class="engine-card-grid">', cards(data.engines), '</section>',
      '<section class="panel engine-system-note"><div><h3>Connected applications</h3><p class="muted">Add an application once. AIStaff will suggest the work it can perform.</p></div><a class="button button-soft" href="/admin/settings/connections-actions">Manage connections</a></section>',
      '</div>'
    ].join('');
  }

  function renderConfiguration(data, engine) {
    var draftKey = 'aistaff:engine-field-draft:' + ((state.company && state.company.id) || engine.tenantId) + ':' + engine.key;
    var setup = engine.recommendation || { ready: 0, review: 0, missing: engine.operations.length, recommendations: [] };
    var visibleCount = setup.recommendations.filter(function (item) { return item.status !== 'missing'; }).length;
    var setupBody;
    if (!data.connections.length) {
      setupBody = '<div class="empty-state"><b>Connect your company application first.</b><p>AIStaff will then detect and suggest the available work.</p><a class="button button-primary" href="/admin/settings/connections-actions">Connect application</a></div>';
    } else if (!visibleCount) {
      setupBody = '<div class="empty-state"><b>No matching work was found.</b><p>The connected application does not describe functions for this engine yet.</p><a class="button button-soft" href="/admin/settings/connections-actions">Review connection</a></div>';
    } else {
      setupBody = [
        '<form id="guidedEngineSetup">',
        '<div class="engine-recommendation-list">', recommendationRows(engine), '</div>',
        setup.missing ? '<details class="engine-missing-jobs"><summary>' + setup.missing + ' other jobs will stay with staff</summary><p>AIStaff will not pretend it can perform work that your application does not provide.</p></details>' : '',
        '<div class="engine-activation-bar"><span>Nothing runs until you activate it.</span><button class="button button-primary" type="submit">', engine.enabled ? 'Save setup' : 'Activate ' + escapeHtml(engine.name), '</button></div>',
        '</form>'
      ].join('');
    }

    $('#adminContent').innerHTML = [
      settingsTabs('business-engines'),
      '<div class="settings-stack business-engine-config">',
      '<section class="engine-config-heading"><a href="', engineUrl(''), '" data-engine-back>← All engines</a><div><p class="eyebrow">', escapeHtml(engine.name), '</p><h2>', escapeHtml(engine.name), '</h2><p>', escapeHtml(engine.description), '</p></div>', engineState(engine), '</section>',
      engineInstructionDisclosure(engine),
      engine.key === 'customer_service' ? '<section class="panel" id="engineSchedulingPanel"><p class="muted">Loading the scheduling cut-off…</p></section>' : '',
      engine.key === 'customer_service' ? '<section class="panel" id="engineFeedbackPanel"><p class="muted">Loading the after-service follow-up…</p></section>' : '',
      '<section class="panel engine-guided-panel"><div class="engine-guided-heading"><div><h3>', engine.enabled ? 'Review connected work' : 'Review and activate', '</h3><p class="muted">AIStaff matched your app to this work. Keep the suggestions you want.</p></div>',
      '<div class="engine-overview-metrics"><span><b>', setup.ready, '</b> ready</span>', setup.review ? '<span class="has-warning"><b>' + setup.review + '</b> need review</span>' : '', '</div></div>',
      setupBody,
      engine.enabled ? '<button class="button button-soft engine-deactivate" id="deactivateEngine" type="button">Deactivate engine</button>' : '',
      '</section>',

      '<details class="panel engine-advanced-panel"><summary>Advanced engine settings</summary><div class="engine-advanced-content">',
      '<section><div class="panel-header"><div><h3>Standard fields</h3><p class="muted">Usually matched automatically. Change these only when your application uses a different field name.</p></div></div>',
      '<div class="engine-table-wrap"><table class="engine-table"><thead><tr><th>Use</th><th>Business field</th><th>Requirement</th><th>App field</th><th></th></tr></thead><tbody>', fieldRows(engine), '</tbody></table></div>',
      '<details class="engine-custom-field" id="customFieldDisclosure"><summary>Add a custom field</summary><form id="customEngineFieldForm" class="form-grid" novalidate>',
      '<label>Field label<input name="label" required maxlength="120" placeholder="Membership number" /></label><label>Field key<input name="fieldKey" required maxlength="80" placeholder="membership_number" /></label>',
      '<label>Data type<select name="dataType"><option value="string">Text</option><option value="number">Number</option><option value="boolean">Yes / No</option><option value="date">Date</option></select></label>',
      '<label>Requirement<select name="required"><option value="false">Optional</option><option value="true">Required</option></select></label>',
      '<label class="full">Description<input name="description" maxlength="500" placeholder="When Closer should collect this field" /></label>',
      '<div class="actions-row full"><button class="button button-primary" type="submit">Add field</button><button class="button button-soft" id="resetEngineFieldDraft" type="button">Reset draft</button></div></form></details></section>',
      '<section><div class="panel-header"><div><h3>Manual job mapping</h3><p class="muted">Technical fallback when the automatic suggestion needs adjustment.</p></div><button class="button button-soft" id="testBusinessEngine" type="button">Test safely</button></div>',
      '<div class="engine-table-wrap"><table class="engine-table operation-matrix"><thead><tr><th>Use</th><th>Job</th><th>Company function</th><th>Permission</th><th>Fallback</th><th>Save</th></tr></thead><tbody>', operationRows(data, engine), '</tbody></table></div></section>',
      '</div></details>',

      '<details class="panel engine-advanced-panel"><summary>Activity and approvals</summary><div class="engine-advanced-content"><div class="engine-table-wrap"><table class="engine-table"><thead><tr><th>When</th><th>Job</th><th>Result</th><th>Permission</th><th>Requested by</th><th></th></tr></thead><tbody>', requestRows(data, engine), '</tbody></table></div></div></details>',
      '</div>'
    ].join('');

    if (engine.key === 'customer_service' && window.mountSchedulingSettings) window.mountSchedulingSettings(engine.key);
    if (engine.key === 'customer_service' && window.mountFeedbackSettings) window.mountFeedbackSettings(engine.key);
    var instructionForm = $('#engineInstructionForm');
    instructionForm.onsubmit = async function (event) {
      event.preventDefault();
      var button = instructionForm.querySelector('[type="submit"]');
      var body = Object.fromEntries(new FormData(instructionForm));
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        var saved = await api('/api/business-engines/' + encodeURIComponent(engine.key) + '/instructions', { method: 'POST', body: body });
        toast('Engine instruction saved as version ' + saved.version);
        await window.businessEnginesSettingsView();
      } catch (error) {
        toast(error.message);
        button.disabled = false;
        button.textContent = 'Save new version';
      }
    };

    var resetInstruction = $('#resetEngineInstruction');
    if (resetInstruction) resetInstruction.onclick = async function () {
      if (!window.confirm('Use the platform default for ' + engine.name + '? Your saved versions will remain available.')) return;
      resetInstruction.disabled = true;
      try {
        await api('/api/business-engines/' + encodeURIComponent(engine.key) + '/instructions', { method: 'DELETE' });
        toast('Platform default restored');
        await window.businessEnginesSettingsView();
      } catch (error) { toast(error.message); resetInstruction.disabled = false; }
    };

    document.querySelectorAll('[data-restore-engine-instruction]').forEach(function (button) {
      button.onclick = async function () {
        var version = Number(button.dataset.restoreEngineInstruction);
        if (!window.confirm('Restore engine instruction version ' + version + '?')) return;
        button.disabled = true;
        try {
          await api('/api/business-engines/' + encodeURIComponent(engine.key) + '/instructions/activate', { method: 'POST', body: { version: version } });
          toast('Version ' + version + ' restored');
          await window.businessEnginesSettingsView();
        } catch (error) { toast(error.message); button.disabled = false; }
      };
    });

    document.querySelectorAll('[data-delete-engine-instruction]').forEach(function (button) {
      button.onclick = async function () {
        var version = Number(button.dataset.deleteEngineInstruction);
        if (!window.confirm('Permanently delete engine instruction version ' + version + '?')) return;
        button.disabled = true;
        try {
          await api('/api/business-engines/' + encodeURIComponent(engine.key) + '/instructions/' + version, { method: 'DELETE' });
          toast('Version ' + version + ' deleted');
          await window.businessEnginesSettingsView();
        } catch (error) { toast(error.message); button.disabled = false; }
      };
    });

    document.querySelectorAll('[data-engine-recommendation]').forEach(function (row) {
      var recommendation = setup.recommendations.find(function (item) { return item.operationKey === row.dataset.engineRecommendation; });
      var actionSelect = row.querySelector('[data-recommended-action]');
      actionSelect.onchange = function () {
        var candidate = candidateFor(recommendation, actionSelect.value);
        row.querySelector('.engine-field-review-slot').innerHTML = fieldReviewMarkup(engine, candidate);
        row.querySelector('[data-permission-label]').textContent = policyLabels[safestPolicy(recommendation.policy, candidate)];
        row.querySelector('.engine-technical-detail code').textContent = candidate ? candidate.method + ' ' + candidate.path : '';
        row.querySelector('input[type="checkbox"]').checked = Boolean(candidate && !candidate.unresolved.length);
      };
    });

    var guidedForm = $('#guidedEngineSetup');
    if (guidedForm) guidedForm.onsubmit = async function (event) {
      event.preventDefault();
      var button = guidedForm.querySelector('[type="submit"]');
      var mappings = [];
      try {
        guidedForm.querySelectorAll('[data-engine-recommendation]').forEach(function (row) {
          if (!row.querySelector('input[type="checkbox"]').checked) return;
          var recommendation = setup.recommendations.find(function (item) { return item.operationKey === row.dataset.engineRecommendation; });
          var actionId = row.querySelector('[data-recommended-action]').value;
          var candidate = candidateFor(recommendation, actionId);
          if (!candidate) throw new Error('Choose a company function for ' + recommendation.operationName + '.');
          var fieldMapping = Object.assign({}, candidate.fieldMapping || {});
          row.querySelectorAll('[data-map-external]').forEach(function (select) {
            if (!select.value) throw new Error('Choose what “' + select.dataset.mapExternal.replaceAll('_', ' ') + '” means for ' + recommendation.operationName + '.');
            fieldMapping[select.value] = select.dataset.mapExternal;
          });
          mappings.push({ operationKey: recommendation.operationKey, actionId: actionId, fieldMapping: fieldMapping });
        });
        if (!mappings.length) throw new Error('Choose at least one suggested job.');
        button.disabled = true;
        button.textContent = 'Checking and activating…';
        var result = await api('/api/business-engines/' + engine.key + '/setup', { method: 'POST', body: { mappings: mappings } });
        toast(result.mapped + ' jobs connected — ' + engine.name + ' is active');
        await window.businessEnginesSettingsView();
      } catch (error) {
        toast(error.message);
        button.disabled = false;
        button.textContent = engine.enabled ? 'Save setup' : 'Activate ' + engine.name;
      }
    };

    var deactivate = $('#deactivateEngine');
    if (deactivate) deactivate.onclick = async function () {
      if (!window.confirm('Deactivate ' + engine.name + '? Saved mappings stay available for later.')) return;
      deactivate.disabled = true;
      await api('/api/business-engines/' + engine.key, { method: 'PUT', body: { enabled: false } });
      toast(engine.name + ' deactivated');
      await window.businessEnginesSettingsView();
    };

    document.querySelectorAll('[data-save-field]').forEach(function (button) {
      button.onclick = async function () {
        var row = button.closest('[data-engine-field]');
        button.disabled = true;
        try {
          await api('/api/business-engines/' + engine.key + '/fields/' + encodeURIComponent(button.dataset.saveField), { method: 'PUT', body: {
            enabled: row.querySelector('[name="enabled"]').checked,
            required: row.querySelector('[name="required"]').value === 'true',
            externalField: row.querySelector('[name="externalField"]').value
          }});
          toast('Field saved');
          await window.businessEnginesSettingsView();
        } catch (error) { toast(error.message); button.disabled = false; }
      };
    });

    document.querySelectorAll('[data-save-operation]').forEach(function (button) {
      button.onclick = async function () {
        var row = button.closest('[data-engine-operation]');
        var fieldMapping = {};
        try { fieldMapping = JSON.parse(row.querySelector('[name="fieldMapping"]').value || '{}'); }
        catch (_) { toast('Field mapping must be valid JSON.'); return; }
        button.disabled = true;
        try {
          await api('/api/business-engines/' + engine.key + '/operations/' + encodeURIComponent(button.dataset.saveOperation), { method: 'PUT', body: {
            enabled: row.querySelector('[name="enabled"]').checked,
            policy: row.querySelector('[name="policy"]').value,
            fallbackPolicy: row.querySelector('[name="fallbackPolicy"]').value,
            actionId: row.querySelector('[name="actionId"]').value || null,
            fieldMapping: fieldMapping
          }});
          toast('Job saved');
          await window.businessEnginesSettingsView();
        } catch (error) { toast(error.message); button.disabled = false; }
      };
    });

    document.querySelectorAll('[data-save-blueprint]').forEach(function (button) {
      button.onclick = async function () {
        var row = button.closest('[data-engine-operation]');
        var workflowConfig;
        try { workflowConfig = JSON.parse(row.querySelector('[name="workflowConfig"]').value || '{}'); }
        catch (_) { toast('Blueprint must be valid JSON.'); return; }
        button.disabled = true;
        try {
          var result = await api('/api/business-engines/' + engine.key + '/operations/' + encodeURIComponent(button.dataset.saveBlueprint) + '/blueprint', { method: 'PUT', body: { workflowConfig: workflowConfig } });
          toast(result.warnings && result.warnings.length ? 'Blueprint saved · ' + result.warnings.length + ' item(s) still to review' : 'Blueprint saved');
          await window.businessEnginesSettingsView();
        } catch (error) { toast(error.message); button.disabled = false; }
      };
    });

    var customForm = $('#customEngineFieldForm');
    var draftFields = ['label', 'fieldKey', 'dataType', 'required', 'description'];
    try {
      var draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (draft) draftFields.forEach(function (name) { if (draft[name] !== undefined) customForm.elements[name].value = draft[name]; });
      if (draft) $('#customFieldDisclosure').open = true;
    } catch (_) { localStorage.removeItem(draftKey); }
    customForm.oninput = function () {
      var draft = {};
      draftFields.forEach(function (name) { draft[name] = customForm.elements[name].value; });
      localStorage.setItem(draftKey, JSON.stringify(draft));
    };
    $('#resetEngineFieldDraft').onclick = function () {
      if (!window.confirm('Clear only this unsaved custom-field draft?')) return;
      localStorage.removeItem(draftKey);
      customForm.reset();
      toast('Draft cleared');
    };
    customForm.onsubmit = async function (event) {
      event.preventDefault();
      var body = Object.fromEntries(new FormData(customForm));
      body.required = body.required === 'true';
      await api('/api/business-engines/' + engine.key + '/fields', { method: 'POST', body: body });
      localStorage.removeItem(draftKey);
      toast('Custom field added');
      await window.businessEnginesSettingsView();
    };

    $('#testBusinessEngine').onclick = async function () {
      var button = $('#testBusinessEngine');
      button.disabled = true;
      button.textContent = 'Testing…';
      try {
        var result = await api('/api/business-engines/' + engine.key + '/test', { method: 'POST', body: {} });
        toast(result.message);
      } catch (error) { toast(error.message); }
      button.disabled = false;
      button.textContent = 'Test safely';
    };

    document.querySelectorAll('[data-approve-engine-request]').forEach(function (button) {
      button.onclick = async function () {
        if (!window.confirm('Approve and run this company-system action now?')) return;
        button.disabled = true;
        try {
          var result = await api('/api/business-engines/requests/' + button.dataset.approveEngineRequest + '/approve', { method: 'POST', body: {} });
          toast(result.ok ? 'Approved action completed' : 'Approved action failed');
          await window.businessEnginesSettingsView();
        } catch (error) { toast(error.message); button.disabled = false; }
      };
    });
  }

  var WORKFLOW_ICONS = { chat: '💬', search: '🔎', ask: '❓', auto: '⚙️', check: '🧪', confirm: '✅', save: '💾', alert: '🚨', memory: '🧠' };

  function renderWorkflows(data) {
    var box = document.querySelector('#workflowsPanel .workflows-list');
    if (!box) return;
    if (!data.workflows.length) {
      box.innerHTML = '<p>No workflows yet. Connect your company application and turn on a Business Engine job that saves something (for example "Create Service Request").</p>';
      return;
    }
    box.classList.remove('muted');
    var waitingTotal = data.workflows.reduce(function (sum, flow) { return sum + ((flow.openCases || []).length); }, 0);
    var summaryEl = document.getElementById('workflowsSummary');
    if (summaryEl) summaryEl.innerHTML = waitingTotal ? '· <b style="color:#9a3412">' + waitingTotal + ' customer' + (waitingTotal === 1 ? '' : 's') + ' waiting</b>' : '· nobody waiting';
    box.innerHTML = data.workflows.map(function (flow) {
      var steps = flow.steps.map(function (step, index) {
        return '<li class="workflow-step"><span class="workflow-step-no">' + (index + 1) + '</span><div><b>' + (WORKFLOW_ICONS[step.icon] || '•') + ' ' + escapeHtml(step.title) + '</b><p>' + escapeHtml(step.text) + '</p>' +
          (step.options && step.options.length ? '<div class="workflow-options">' + step.options.map(function (option) { return '<span>' + escapeHtml(option) + '</span>'; }).join('') + '</div>' : '') +
          '</div></li>';
      }).join('');
      // Progressive disclosure (Mike 2026-10-20): show only what needs action; details on demand.
      var warnings = flow.warnings.length ? '<details class="workflow-warnings"><summary><b>⚠️ ' + flow.warnings.length + ' setup note' + (flow.warnings.length === 1 ? '' : 's') + '</b> <span class="muted small">(show)</span></summary><ul>' + flow.warnings.map(function (text) { return '<li>' + escapeHtml(text) + '</li>'; }).join('') + '</ul></details>' : '';
      var hrs = function (m) { return m >= 120 ? (Math.round(m / 6) / 10) + ' h' : m + ' min'; };
      var open = (flow.openCases || []);
      var casesHtml = !open.length ? '' : '<div class="workflow-cases"><b>Customers waiting (' + open.length + ')</b>' +
        ('' +
          '<table class="workflow-case-table"><thead><tr><th>Customer</th><th>Need</th><th>Waiting</th><th>Follow-ups</th><th>Why not saved</th><th></th></tr></thead><tbody>' +
          open.map(function (c) {
            var ticket = c.caseStatus === 'ticket_open';
            var btn = function (act, cls, label) { return '<button class="button ' + cls + ' button-sm" data-case-action="' + act + '" data-case-id="' + escapeHtml(c.id) + '">' + label + '</button>'; };
            return '<tr><td><b>' + escapeHtml(c.customer) + '</b><br><span class="muted">' + escapeHtml(c.channel) + ' · ' + escapeHtml(c.reference || c.code) + '</span></td><td>' + escapeHtml(c.need || '') + '</td><td>' + hrs(c.waitingMinutes) + '</td><td>' + c.followups + '</td><td class="muted">' + (ticket ? 'Ticket open — not done yet' : escapeHtml(c.problem || '')) + '</td>' +
              '<td class="workflow-case-actions">' + (ticket
                ? btn('done', 'button-primary', 'Done — close') + btn('still_open', 'button-soft', 'Still open') + btn('cancel', 'button-soft', 'Cancel ticket')
                : btn('retry', 'button-primary', 'I fixed it — try again') + btn('close', 'button-soft', 'Not needed — close')) + '</td></tr>';
          }).join('') + '</tbody></table>') + '</div>';
      return '<article class="workflow-card">' +
        '<header><div><p class="eyebrow">' + escapeHtml(flow.engineName) + '</p><h3>' + escapeHtml(flow.name) + '</h3>' +
        '<p class="muted">This week: <b>' + flow.stats.saved7d + '</b> saved · <b>' + flow.stats.blocked7d + '</b> blocked' + (open.length ? '' : ' · nobody waiting 👍') + '</p></div>' +
        '<label class="workflow-switch"><input type="checkbox" data-workflow-toggle="' + escapeHtml(flow.engine) + '|' + escapeHtml(flow.operation) + '"' + (flow.enabled ? ' checked' : '') + (flow.available ? '' : ' disabled') + '> <span>' + (flow.enabled ? 'Guided mode ON' : 'Guided mode OFF') + '</span></label></header>' +
        warnings + casesHtml +
        '<details class="workflow-more"><summary>How it works <span class="muted small">(' + flow.steps.length + ' steps · show)</span></summary>' +
        '<p class="muted workflow-mode-note">' + (flow.enabled ? 'Guided mode ON: AIStaff drives this request step by step (recommended).' : 'Guided mode OFF: the AI handles this request on its own using the tools.') + '</p>' +
        '<ol class="workflow-steps">' + steps + '</ol></details></article>';
    }).join('');
    document.querySelectorAll('[data-case-action]').forEach(function (button) {
      button.onclick = async function () {
        var action = button.dataset.caseAction;
        var body = {};
        if (action === 'manual') {
          var ref = window.prompt('Reference number you created in your system (e.g. SR-2026-000123):');
          if (!ref) return;
          body.reference = ref.trim();
        }
        if (action === 'close') {
          var note = window.prompt('Close this case without saving it? Closer will stop alerting about it. Optional note:', '');
          if (note === null) return;
          body.note = note;
        }
        if (action === 'done') {
          var how = window.prompt('Close as done in your system and tell the customer it is completed? How was it resolved (optional):', '');
          if (how === null) return;
          body.note = how;
        }
        if (action === 'still_open') {
          var why = window.prompt('Keep it open. Note (optional):', '');
          if (why === null) return;
          body.note = why;
        }
        if (action === 'cancel') {
          var reason = window.prompt('Cancel this ticket and its schedule in your system? Reason:', '');
          if (reason === null) return;
          body.note = reason;
        }
        if (action === 'retry' && !window.confirm('Did you fix the problem? Closer will save this request now and tell the customer. Other customers blocked by the same problem are retried too.')) return;
        button.disabled = true;
        try {
          var result = await api('/api/business-engines/cases/' + encodeURIComponent(button.dataset.caseId) + '/' + action, { method: 'POST', body: body });
          toast(result.message || 'Done');
          loadWorkflows();
        } catch (error) { toast(error.message); button.disabled = false; }
      };
    });
    document.querySelectorAll('[data-workflow-toggle]').forEach(function (input) {
      input.onchange = async function () {
        var parts = input.dataset.workflowToggle.split('|');
        input.disabled = true;
        try {
          await api('/api/business-engines/workflows/' + encodeURIComponent(parts[0]) + '/' + encodeURIComponent(parts[1]), { method: 'PUT', body: { enabled: input.checked } });
          toast(input.checked ? 'Guided mode is on' : 'Guided mode is off');
          loadWorkflows();
        } catch (error) { toast(error.message); input.checked = !input.checked; input.disabled = false; }
      };
    });
  }

  async function loadWorkflows() {
    try { renderWorkflows(await api('/api/business-engines/workflows')); }
    catch (error) {
      var box = document.querySelector('#workflowsPanel .workflows-list');
      if (box) box.textContent = 'Could not load workflows: ' + error.message;
    }
  }

  function bindOverview(data) {
    loadWorkflows();
    document.querySelectorAll('[data-configure-engine]').forEach(function (link) {
      link.onclick = function (event) {
        event.preventDefault();
        history.pushState(null, '', engineUrl(link.dataset.configureEngine));
        window.businessEnginesSettingsView();
      };
    });
    document.querySelectorAll('[data-toggle-engine]').forEach(function (button) {
      button.onclick = async function () {
        var engine = data.engines.find(function (item) { return item.key === button.dataset.toggleEngine; });
        if (!window.confirm('Deactivate ' + engine.name + '? Saved mappings remain available.')) return;
        button.disabled = true;
        try {
          await api('/api/business-engines/' + engine.key, { method: 'PUT', body: { enabled: false } });
          toast(engine.name + ' deactivated');
          await window.businessEnginesSettingsView();
        } catch (error) { toast(error.message); button.disabled = false; }
      };
    });
  }

  window.businessEnginesSettingsView = async function () {
    setTitle('Business Engines');
    var data = await api('/api/business-engines');
    var key = selectedEngineKey();
    var engine = data.engines.find(function (item) { return item.key === key; });
    if (key && !engine) {
      history.replaceState(null, '', engineUrl(''));
      key = '';
    }
    if (engine) {
      engine.instructionConfig = await api('/api/business-engines/' + encodeURIComponent(engine.key) + '/instructions');
      renderConfiguration(data, engine);
    }
    else { renderOverview(data); bindOverview(data); }
  };
})();
