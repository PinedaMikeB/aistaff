/* Universal tenant application connections. Loaded before app.js so the
 * admin route keeps the authenticated shell mounted during every step. */
(function () {
  'use strict';

  var STEP_ORDER = ['discover', 'authenticate', 'test', 'review', 'activate'];
  var STEP_LABELS = { discover: 'Discover', authenticate: 'Authenticate', test: 'Test', review: 'Review actions', activate: 'Activate' };
  var CATEGORY_LABELS = { read: 'Read information', create: 'Create records', update: 'Update records', delete: 'Delete records', communication: 'Communication', other: 'Other' };

  function selectedConnectionId() {
    return new URL(window.location.href).searchParams.get('manage') || '';
  }

  function setSelectedConnection(id) {
    var url = new URL(window.location.href);
    if (id) url.searchParams.set('manage', id); else url.searchParams.delete('manage');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }

  function statusLabel(value) {
    return ({ active: 'Active', ready_review: 'Ready to review', draft: 'Setup in progress', discovery_failed: 'Needs manual setup', attention_required: 'Needs attention', disabled: 'Disabled' })[value] || String(value || 'Setup in progress').replaceAll('_', ' ');
  }

  function testLabel(value) {
    return ({ passed: 'Verified', unverified: 'Reachable, not verified', manually_verified: 'Manually verified', failed: 'Test failed', attention_required: 'Try again later' })[value] || 'Not tested';
  }

  function executionLabel(value) {
    return ({ pending_staff_approval: 'Needs staff approval', pending_customer_confirmation: 'Waiting for customer', running: 'Running', succeeded: 'Succeeded', failed: 'Failed', queued: 'Queued' })[value] || String(value || 'Unknown').replaceAll('_', ' ');
  }

  function metrics(data) {
    var active = data.connections.reduce(function (count, connection) { return count + connection.approvedActions; }, 0);
    var approvals = data.executions.filter(function (row) { return row.status === 'pending_staff_approval'; }).length;
    return '<div class="integration-metrics"><span><b>' + data.connections.length + '</b> applications</span><span><b>' + active + '</b> approved actions</span><span class="' + (approvals ? 'needs-attention' : '') + '"><b>' + approvals + '</b> approvals</span></div>';
  }

  function connectPanel() {
    return [
      '<section class="integration-connect-simple"><h2>Connect an application</h2>',
      '<form id="integrationDiscoverForm" class="integration-discover-form" novalidate>',
      '<label>Website or API guide<input name="sourceUrl" type="url" required maxlength="2000" placeholder="https://app.example.com/docs"></label>',
      '<div class="integration-form-errors full" id="integrationDiscoverError" role="alert" hidden></div>',
      '<button class="button button-primary" id="integrationDiscoverBtn" type="submit">Connect</button>',
      '</form></section>'
    ].join('');
  }

  function connectedApplications(connections) {
    if (!connections.length) return '<div class="empty-state integration-empty"><p><b>No applications yet.</b></p><p>Connect one above.</p></div>';
    return '<div class="integration-app-list">' + connections.map(function (connection) {
      return [
        '<article class="integration-app-card"><div class="integration-app-main"><div class="integration-app-icon" aria-hidden="true">', escapeHtml(connection.name.slice(0, 1).toUpperCase()), '</div><div>',
        '<div class="integration-title-line"><h3>', escapeHtml(connection.name), '</h3><span class="integration-state ', escapeHtml(connection.status), '">', escapeHtml(statusLabel(connection.status)), '</span></div>',
        '<p class="muted">', connection.approvedActions, ' approved action', connection.approvedActions === 1 ? '' : 's', ' · ', escapeHtml(testLabel(connection.lastTestStatus)), '</p></div></div>',
        '<button class="button button-soft" type="button" data-manage-connection="', escapeHtml(connection.id), '">Manage</button></article>'
      ].join('');
    }).join('') + '</div>';
  }

  function currentConnectionStep(connection) {
    if (connection.discoveryStatus === 'failed' || connection.status === 'discovery_failed' || !connection.actions.length) return 'discover';
    if (connection.wizardStep === 'authenticate') return 'authenticate';
    if (connection.wizardStep === 'review') return 'review';
    if (connection.wizardStep === 'activate' || connection.approvedActions) return 'activate';
    return 'test';
  }

  function progress(connection) {
    var step = currentConnectionStep(connection);
    var number = Math.max(1, STEP_ORDER.indexOf(step) + 1);
    return '<div class="integration-progress" aria-label="Step ' + number + ' of 5"><div><small>Step ' + number + ' of 5</small><b>' + STEP_LABELS[step] + '</b></div><span><i style="width:' + (number * 20) + '%"></i></span></div>';
  }

  function discoveryStep(connection) {
    return [
      '<section class="integration-wizard-step integration-recovery-step"><h3>We couldn\'t find the API setup.</h3>',
      '<p class="muted">Open advanced setup and provide the API base URL plus an OpenAPI URL or document.</p>',
      '<div class="actions-row"><button class="button button-primary" type="button" data-open-manual-setup>Open advanced setup</button>',
      '<button class="button button-soft" type="button" data-retry-discovery>Try another URL</button></div>',
      '<form id="integrationRetryForm" class="integration-inline-form integration-recovery-form" hidden>',
      '<label>Website or API guide<input name="sourceUrl" type="url" required maxlength="2000" value="', escapeHtml(connection.sourceUrl || ''), '"></label>',
      '<button class="button button-primary" type="submit">Try this URL</button><div class="integration-form-errors" id="integrationRetryError" hidden></div></form>',
      '<details class="integration-manual-setup" id="integrationManualSetup"><summary>Advanced setup</summary>',
      '<form id="integrationSpecImportForm" class="form-grid integration-form"><label>API base URL<input name="baseUrl" type="url" value="', escapeHtml(connection.baseUrl || ''), '" placeholder="https://api.example.com"></label>',
      '<label>OpenAPI URL<input name="specUrl" type="url" placeholder="https://api.example.com/openapi.json"></label>',
      '<label class="full">Or paste OpenAPI JSON or YAML<textarea name="specText" rows="5"></textarea></label>',
      '<div class="actions-row full"><button class="button button-primary" type="submit">Continue setup</button></div></form></details>',
      '</section>'
    ].join('');
  }

  function authInputs(connection) {
    if (connection.authType === 'unsupported') {
      return [
        '<p class="settings-warning"><b>Authentication was detected but cannot be selected automatically.</b> Choose the method documented by the provider. AIStaff will not guess a credential type.</p>',
        '<label>Authentication method<select name="authType" id="integrationManualAuthType"><option value="bearer">Bearer token</option><option value="api_key_header">API key header</option><option value="api_key_query">API key query parameter</option><option value="basic">Basic authentication</option><option value="none">No authentication</option></select></label>',
        '<label data-manual-auth="parameter">Header or query name<input name="parameterName" value="X-API-Key"></label>',
        '<label data-manual-auth="username" hidden>Username<input name="username" autocomplete="username"></label>',
        '<label data-manual-auth="secret">Credential<input name="authSecret" type="password" autocomplete="new-password" required></label>',
        '<button class="button button-primary" type="submit">Save authentication</button>'
      ].join('');
    }
    if (connection.authType === 'none') return '<p class="integration-good">This API documents no authentication requirement.</p><input type="hidden" name="authType" value="none">';
    if (connection.authType === 'oauth2_pkce') {
      return '<input type="hidden" name="authType" value="oauth2_pkce"><label>OAuth client ID<input name="clientId" required maxlength="500" autocomplete="off"></label><p class="muted">You will sign in on the provider\'s own authorization page. AIStaff uses Authorization Code with PKCE and validates the return state.</p><button class="button button-primary" type="button" data-start-oauth>Authorize with provider</button>';
    }
    var secretLabel = connection.authType === 'basic' ? 'Password' : connection.authType === 'bearer' ? 'Bearer token' : 'API key';
    return [
      '<input type="hidden" name="authType" value="', escapeHtml(connection.authType), '">',
      connection.authType === 'basic' ? '<label>Username<input name="username" autocomplete="username" required></label>' : '',
      ['api_key_header', 'api_key_query'].includes(connection.authType) ? '<label>' + (connection.authType === 'api_key_header' ? 'Header name' : 'Query parameter name') + '<input name="parameterName" required value="' + escapeHtml(connection.authConfig.parameterName || '') + '"></label>' : '',
      '<label>', secretLabel, '<input name="authSecret" type="password" autocomplete="new-password" required><small>Stored encrypted. It is never placed in an AI prompt.</small></label>',
      '<button class="button button-primary" type="submit">Save authentication</button>'
    ].join('');
  }

  function authenticationStep(connection) {
    return '<section class="integration-wizard-step"><h3>Connect securely</h3><p class="muted">Enter the access required by this application.</p><form id="integrationAuthForm" class="integration-auth-form">' + authInputs(connection) + '<div class="integration-form-errors" id="integrationAuthError" hidden></div></form></section>';
  }

  function testStep(connection) {
    return [
      '<section class="integration-wizard-step"><h3>Test the connection</h3>',
      '<p class="muted">AIStaff will make a safe, read-only check.</p>',
      '<div class="integration-test-box"><span class="integration-test-result ', escapeHtml(connection.lastTestStatus || 'untested'), '">', escapeHtml(connection.lastTestMessage || 'Not tested yet'), '</span>',
      '<button class="button button-primary" type="button" data-test-integration="', escapeHtml(connection.id), '">Test safely</button></div>',
      '<details><summary>No safe verification endpoint?</summary><form id="integrationManualVerifyForm" class="integration-inline-form"><label>Reason for manual verification<input name="reason" minlength="10" maxlength="300" required placeholder="Verified in the provider dashboard"></label><button class="button button-soft" type="submit">Mark manually verified</button></form></details>',
      '</section>'
    ].join('');
  }

  function policyOptions(action) {
    var labels = { automatic: 'Automatic', customer_confirmation: 'Customer confirmation', staff_approval: 'Staff approval' };
    var rank = { automatic: 0, customer_confirmation: 1, staff_approval: 2 };
    return Object.keys(labels).map(function (value) {
      var disabled = rank[value] < rank[action.minimumApprovalPolicy];
      return '<option value="' + value + '" ' + (action.approvalPolicy === value ? 'selected' : '') + ' ' + (disabled ? 'disabled' : '') + '>' + labels[value] + (disabled ? ' (not allowed)' : '') + '</option>';
    }).join('');
  }

  function assignmentOptions(action, engineOperations) {
    if (!engineOperations.length) return '<p class="muted">Enable a Business Engine first to assign this action.</p>';
    var assigned = new Set(action.assignments.map(function (item) { return item.tenantOperationId; }));
    return '<label>Assign to AI Employee work<select name="tenantOperationIds" multiple size="' + Math.min(5, engineOperations.length) + '">' + engineOperations.map(function (operation) {
      return '<option value="' + escapeHtml(operation.id) + '" ' + (assigned.has(operation.id) ? 'selected' : '') + '>' + escapeHtml(operation.engineName + ' — ' + operation.operationName) + '</option>';
    }).join('') + '</select><small>Only enabled actions can be assigned.</small></label>';
  }

  function actionCard(action, engineOperations) {
    return [
      '<article class="integration-action-card" data-integration-action="', escapeHtml(action.id), '"><div class="integration-action-heading"><div><h4>', escapeHtml(action.displayName), '</h4><p>', escapeHtml(action.description), '</p></div>',
      '<div><span class="http-method ', escapeHtml(action.method.toLowerCase()), '">', escapeHtml(action.method), '</span>', action.highImpact ? '<span class="integration-risk high">High impact</span>' : '', '</div></div>',
      '<details><summary>Review permissions and inputs</summary><code>', escapeHtml(action.path), '</code><p class="muted">Required inputs: ', escapeHtml((action.inputSchema.required || []).join(', ') || 'None'), '</p>',
      '<label class="integration-enable"><input type="checkbox" name="enabled" ', action.enabled ? 'checked' : '', '> Allow AIStaff to use this action</label>',
      '<label>Approval<select name="approvalPolicy">', policyOptions(action), '</select></label>',
      assignmentOptions(action, engineOperations),
      action.highImpact ? '<label class="integration-high-confirm"><input type="checkbox" name="acknowledgeHighImpact"> I understand this action can make a significant change.</label>' : '',
      '<div class="actions-row"><button class="button button-primary" type="button" data-save-integration-action="', escapeHtml(action.id), '">Save action</button>',
      action.enabled ? '<button class="button button-soft" type="button" data-save-assignments="' + escapeHtml(action.id) + '">Save AI Employee assignment</button>' : '', '</div></details></article>'
    ].join('');
  }

  function reviewStep(connection, engineOperations) {
    var grouped = {};
    connection.actions.forEach(function (action) { (grouped[action.category] = grouped[action.category] || []).push(action); });
    return [
      '<section class="integration-wizard-step"><h3>Choose allowed actions</h3>',
      '<p class="muted">Open and approve only the work AIStaff may perform.</p>',
      Object.keys(CATEGORY_LABELS).filter(function (category) { return grouped[category]?.length; }).map(function (category) {
        return '<details class="integration-action-group"><summary><span><b>' + CATEGORY_LABELS[category] + '</b><small>' + grouped[category].length + ' action' + (grouped[category].length === 1 ? '' : 's') + '</small></span></summary>' + grouped[category].map(function (action) { return actionCard(action, engineOperations); }).join('') + '</details>';
      }).join(''),
      connection.actions.length ? '' : '<div class="empty-state"><p><b>No actions available.</b></p><p>Use Advanced Settings to import a specification or define one REST operation.</p></div>',
      '</section>'
    ].join('');
  }

  function inputLabel(name, schema) {
    if (schema && schema.title) return String(schema.title);
    return String(name || 'Input')
      .replaceAll('_', ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/(number|name|email|phone|mobile|status|date|time|type|code|key|url|id)$/i, ' $1')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function actionTestField(action, name, schema) {
    schema = schema || {};
    var required = (action.inputSchema.required || []).includes(name);
    var label = inputLabel(name, schema);
    var id = 'action-test-' + action.id + '-' + name;
    var field;
    if (Array.isArray(schema.enum) && schema.enum.length) {
      field = '<select id="' + escapeHtml(id) + '" name="' + escapeHtml(name) + '" ' + (required ? 'required' : '') + '><option value="">Choose…</option>' + schema.enum.map(function (value) { return '<option value="' + escapeHtml(String(value)) + '">' + escapeHtml(String(value)) + '</option>'; }).join('') + '</select>';
    } else if (schema.type === 'boolean') {
      field = '<select id="' + escapeHtml(id) + '" name="' + escapeHtml(name) + '" ' + (required ? 'required' : '') + '><option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option></select>';
    } else if (schema.type === 'object' || schema.type === 'array') {
      field = '<textarea id="' + escapeHtml(id) + '" name="' + escapeHtml(name) + '" rows="3" ' + (required ? 'required' : '') + ' placeholder="' + (schema.type === 'array' ? '[ ]' : '{ }') + '"></textarea>';
    } else {
      var type = ['integer', 'number'].includes(schema.type) ? 'number' : schema.format === 'email' ? 'email' : schema.format === 'date' ? 'date' : schema.format === 'date-time' ? 'datetime-local' : schema.format === 'uri' || schema.format === 'url' ? 'url' : 'text';
      var step = schema.type === 'integer' ? ' step="1"' : schema.type === 'number' ? ' step="any"' : '';
      var limits = (schema.minimum !== undefined ? ' min="' + escapeHtml(String(schema.minimum)) + '"' : '') + (schema.maximum !== undefined ? ' max="' + escapeHtml(String(schema.maximum)) + '"' : '');
      field = '<input id="' + escapeHtml(id) + '" name="' + escapeHtml(name) + '" type="' + type + '"' + step + limits + ' ' + (required ? 'required' : '') + '>';
    }
    return '<label for="' + escapeHtml(id) + '"><span>' + escapeHtml(label) + (required ? ' <b aria-label="required">*</b>' : '') + '</span>' + field + (schema.description ? '<small>' + escapeHtml(schema.description) + '</small>' : '') + '</label>';
  }

  function actionTestCard(action) {
    var properties = action.inputSchema.properties || {};
    var requiredNames = (action.inputSchema.required || []).filter(function (name) { return properties[name]; });
    var optionalNames = Object.keys(properties).filter(function (name) { return !requiredNames.includes(name); });
    var changesData = !['GET', 'HEAD', 'OPTIONS'].includes(action.method);
    return [
      '<details class="integration-tool-test" data-tool-test="', escapeHtml(action.id), '"><summary><span><b>', escapeHtml(action.displayName), '</b><small>', escapeHtml(action.method), ' ', escapeHtml(action.path), '</small></span><span>Test</span></summary>',
      '<form class="integration-tool-test-form" data-action-test-form="', escapeHtml(action.id), '">',
      '<p class="muted">', escapeHtml(action.description || 'Run this action with your own test input.'), '</p>',
      requiredNames.length ? '<div class="integration-tool-test-fields">' + requiredNames.map(function (name) { return actionTestField(action, name, properties[name]); }).join('') + '</div>' : '<p class="integration-tool-no-input">This action needs no required input.</p>',
      optionalNames.length ? '<details class="integration-tool-optional"><summary>Optional inputs</summary><div class="integration-tool-test-fields">' + optionalNames.map(function (name) { return actionTestField(action, name, properties[name]); }).join('') + '</div></details>' : '',
      changesData ? '<label class="integration-live-write"><input type="checkbox" name="confirmLiveWrite" required> I understand this test will create or change real data.</label>' : '',
      action.highImpact ? '<label class="integration-live-write high-impact"><input type="checkbox" name="acknowledgeHighImpact" required> I understand this may delete data or send a real message.</label>' : '',
      '<div class="integration-tool-test-actions"><button class="button button-primary" type="submit">', changesData ? 'Run live test' : 'Run test', '</button><span class="muted">Uses this tenant\'s saved connection.</span></div>',
      '<div class="integration-tool-test-result" data-action-test-result="', escapeHtml(action.id), '" role="status" hidden></div>',
      '</form></details>'
    ].join('');
  }

  function actionTestPanel(connection) {
    var actions = connection.actions.filter(function (action) { return action.enabled; });
    if (!actions.length) return '';
    return [
      '<section class="integration-action-test-panel"><div><h3>Test available actions</h3><p class="muted">Open one action, enter what it needs, and see the real response.</p></div>',
      '<div class="integration-tool-tests">', actions.map(actionTestCard).join(''), '</div></section>'
    ].join('');
  }

  function activateStep(connection) {
    return '<section class="integration-wizard-step integration-ready-step"><h3>' + (connection.approvedActions ? 'Connection ready' : 'Approve one action to finish') + '</h3><p>' + connection.approvedActions + ' action' + (connection.approvedActions === 1 ? ' is' : 's are') + ' available to AIStaff.</p></section>' + actionTestPanel(connection);
  }

  function currentStepView(connection, engineOperations) {
    var step = currentConnectionStep(connection);
    if (step === 'discover') return discoveryStep(connection);
    if (step === 'authenticate') return authenticationStep(connection);
    if (step === 'review') return reviewStep(connection, engineOperations);
    if (step === 'activate') return activateStep(connection);
    return testStep(connection);
  }

  function connectionAdvanced(connection) {
    var behavior = connection.behaviorConfig || {};
    return [
      '<details class="integration-manage-advanced"><summary>Advanced connection settings</summary>',
      connection.actions.length ? '' : '<form id="integrationSpecImportForm" class="form-grid integration-form"><p class="muted full">Import OpenAPI for this saved application without starting over.</p><label>API base URL<input name="baseUrl" type="url" value="' + escapeHtml(connection.baseUrl) + '"></label><label>OpenAPI URL<input name="specUrl" type="url"></label><label class="full">Or paste OpenAPI JSON/YAML<textarea name="specText" rows="6"></textarea></label><div class="actions-row full"><button class="button button-soft" type="submit">Import and continue setup</button></div></form>',
      '<form id="integrationAdvancedForm" class="form-grid integration-form"><label class="full">API base URL<input name="baseUrl" type="url" required value="', escapeHtml(connection.baseUrl), '"></label>',
      '<label>API version<input name="apiVersion" maxlength="80" value="', escapeHtml(connection.apiVersion || ''), '"></label>',
      '<label>Timeout (ms)<input name="timeoutMs" type="number" min="1000" max="30000" value="', behavior.timeoutMs || 12000, '"></label>',
      '<label>Requests per minute<input name="requestsPerMinute" type="number" min="1" max="120" value="', behavior.requestsPerMinute || 30, '"></label>',
      '<label>Maximum response characters<input name="maxResponseChars" type="number" min="1000" max="100000" value="', behavior.maxResponseChars || 20000, '"></label>',
      '<label>Read retries<input name="retryReads" type="number" min="0" max="2" value="', behavior.retryReads || 0, '"></label>',
      '<div class="actions-row full"><button class="button button-soft" type="submit">Save advanced settings</button></div></form>',
      '<details><summary>Define one REST action manually</summary><form id="integrationManualActionForm" class="form-grid integration-form">',
      '<label>Action name<input name="displayName" required maxlength="120"></label><label>Operation ID<input name="operationId" required maxlength="180"></label>',
      '<label>Method<select name="method"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label>',
      '<label>Endpoint path<input name="path" required placeholder="/tickets/{id}"></label><label class="full">Description<input name="description" maxlength="1000"></label>',
      '<label>Approval<select name="approvalPolicy"><option value="automatic">Automatic (read only)</option><option value="customer_confirmation">Customer confirmation</option><option value="staff_approval" selected>Staff approval</option></select></label>',
      '<label class="full">Input JSON Schema<textarea name="inputSchema" rows="5">{"type":"object","properties":{},"required":[],"additionalProperties":false}</textarea></label>',
      '<div class="actions-row full"><button class="button button-soft" type="submit">Add disabled action</button></div></form></details>',
      '<div class="integration-danger-actions"><button class="button button-soft" type="button" data-connection-operation="', connection.status === 'disabled' ? 'enable' : 'disable', '">', connection.status === 'disabled' ? 'Enable connection' : 'Disable connection', '</button>',
      '<button class="button button-danger" type="button" data-connection-operation="revoke">Revoke credentials</button></div></details>'
    ].join('');
  }

  function manageConnection(connection, engineOperations) {
    if (!connection) return '';
    var step = currentConnectionStep(connection);
    return [
      '<section class="integration-manage-panel" data-managing="', escapeHtml(connection.id), '"><div class="panel-header"><div><p class="eyebrow">Set up application</p><h2>', escapeHtml(connection.name), '</h2></div>',
      '<button class="button button-soft" type="button" data-close-manage>Back</button></div>', progress(connection),
      currentStepView(connection, engineOperations), step === 'discover' ? '' : connectionAdvanced(connection), '</section>'
    ].join('');
  }

  function historyPanel(executions) {
    var approvals = executions.filter(function (row) { return row.status === 'pending_staff_approval'; });
    return [
      '<section class="integration-history-panel"><div class="panel-header"><div><h2>Action history</h2><p class="muted settings-lede">', executions.length, ' recent · ', approvals.length, ' waiting</p></div>',
      '<button class="button button-soft" type="button" data-toggle-history>View history</button></div>',
      '<div class="integration-history-list" id="integrationHistoryList" hidden>', executions.length ? executions.map(function (row) {
        return '<article class="integration-history-item"><div><b>' + escapeHtml(row.actionName) + '</b><small>' + escapeHtml(row.connectionName) + ' · ' + escapeHtml(fmtDate(row.createdAt)) + '</small></div><span class="integration-execution-status ' + escapeHtml(row.status) + '">' + escapeHtml(executionLabel(row.status)) + '</span><button class="button button-soft" type="button" data-history-detail="' + escapeHtml(row.id) + '">View</button>' + (row.status === 'pending_staff_approval' ? '<button class="button button-primary" type="button" data-approve-integration="' + escapeHtml(row.id) + '">Approve &amp; run</button>' : '') + '<div class="integration-history-detail" data-history-detail-for="' + escapeHtml(row.id) + '" hidden></div></article>';
      }).join('') : '<div class="empty-state">No connected-application action has been requested yet.</div>', '</div></section>'
    ].join('');
  }

  function bindDiscoverForm() {
    var form = $('#integrationDiscoverForm');
    var errorBox = $('#integrationDiscoverError');
    form.onsubmit = async function (event) {
      event.preventDefault(); errorBox.hidden = true;
      var button = $('#integrationDiscoverBtn'); button.disabled = true; button.textContent = 'Checking…';
      try {
        var result = await api('/api/integrations/discover', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
        setSelectedConnection(result.connectionId); toast(result.message); await window.connectionsActionsSettingsView();
      } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; button.disabled = false; button.textContent = 'Connect'; }
    };
  }

  function bindImportForm() {
    var form = $('#integrationImportForm');
    form.onsubmit = async function (event) {
      event.preventDefault();
      var errorBox = $('#integrationImportError'); errorBox.hidden = true;
      var values = Object.fromEntries(new FormData(form));
      var button = $('#integrationImportBtn'); button.disabled = true; button.textContent = 'Importing…';
      try {
        var result = await api('/api/integrations', { method: 'POST', body: values }); setSelectedConnection(result.connectionId); toast(result.actionsDiscovered + ' functions discovered; all are disabled'); await window.connectionsActionsSettingsView();
      } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; button.disabled = false; button.textContent = 'Import definition'; }
    };
  }

  function bindManage(connection) {
    if (!connection) return;
    var openManual = document.querySelector('[data-open-manual-setup]');
    var manualSetup = $('#integrationManualSetup');
    if (openManual && manualSetup) openManual.onclick = function () {
      manualSetup.open = true;
      manualSetup.scrollIntoView({ behavior: 'smooth', block: 'center' });
      manualSetup.querySelector('input')?.focus();
    };
    var retryButton = document.querySelector('[data-retry-discovery]');
    var retryForm = $('#integrationRetryForm');
    if (retryButton && retryForm) retryButton.onclick = function () {
      retryForm.hidden = false;
      retryButton.hidden = true;
      retryForm.elements.sourceUrl.focus();
    };
    if (retryForm) retryForm.onsubmit = async function (event) {
      event.preventDefault();
      var button = retryForm.querySelector('button[type="submit"]');
      var errorBox = $('#integrationRetryError');
      errorBox.hidden = true; button.disabled = true; button.textContent = 'Checking…';
      try {
        var result = await api('/api/integrations/' + connection.id + '/discover', { method: 'POST', body: Object.fromEntries(new FormData(retryForm)) });
        toast(result.discoveryStatus === 'failed' ? 'API setup still not found' : 'API setup found');
        await window.connectionsActionsSettingsView();
      } catch (error) {
        errorBox.textContent = error.message; errorBox.hidden = false; button.disabled = false; button.textContent = 'Try this URL';
      }
    };
    var authForm = $('#integrationAuthForm');
    if (authForm) authForm.onsubmit = async function (event) {
      event.preventDefault();
      try { await api('/api/integrations/' + connection.id + '/auth', { method: 'PUT', body: Object.fromEntries(new FormData(authForm)) }); toast('Authentication saved securely'); await window.connectionsActionsSettingsView(); }
      catch (error) { var box = $('#integrationAuthError'); box.textContent = error.message; box.hidden = false; }
    };
    var manualAuthType = $('#integrationManualAuthType');
    if (manualAuthType) {
      var updateManualAuth = function () {
        var value = manualAuthType.value;
        authForm.querySelector('[data-manual-auth="parameter"]').hidden = !['api_key_header', 'api_key_query'].includes(value);
        authForm.querySelector('[data-manual-auth="username"]').hidden = value !== 'basic';
        authForm.querySelector('[data-manual-auth="secret"]').hidden = value === 'none';
        authForm.elements.authSecret.required = value !== 'none';
      };
      manualAuthType.onchange = updateManualAuth; updateManualAuth();
    }
    var oauthButton = document.querySelector('[data-start-oauth]');
    if (oauthButton) oauthButton.onclick = async function () {
      var clientId = authForm.elements.clientId.value.trim(); if (!clientId) return authForm.elements.clientId.focus();
      try { var result = await api('/api/integrations/' + connection.id + '/oauth/start', { method: 'POST', body: { clientId: clientId, scopes: [] } }); window.location.assign(result.authorizationUrl); } catch (error) { toast(error.message); }
    };
    document.querySelectorAll('[data-test-integration]').forEach(function (button) { button.onclick = async function () { button.disabled = true; button.textContent = 'Testing safely…'; try { var result = await api('/api/integrations/' + connection.id + '/test', { method: 'POST', body: {} }); toast(result.message); await window.connectionsActionsSettingsView(); } catch (error) { toast(error.message); button.disabled = false; button.textContent = 'Test safely'; } }; });
    var verifyForm = $('#integrationManualVerifyForm');
    if (verifyForm) verifyForm.onsubmit = async function (event) { event.preventDefault(); try { await api('/api/integrations/' + connection.id + '/manual-verification', { method: 'POST', body: Object.fromEntries(new FormData(verifyForm)) }); toast('Manual verification recorded in the audit log'); await window.connectionsActionsSettingsView(); } catch (error) { toast(error.message); } };

    document.querySelectorAll('.integration-tool-test').forEach(function (details) {
      details.ontoggle = function () {
        if (!details.open) return;
        document.querySelectorAll('.integration-tool-test[open]').forEach(function (other) { if (other !== details) other.open = false; });
      };
    });
    document.querySelectorAll('[data-action-test-form]').forEach(function (form) {
      form.onsubmit = async function (event) {
        event.preventDefault();
        var action = connection.actions.find(function (item) { return item.id === form.dataset.actionTestForm; });
        var resultBox = form.querySelector('[data-action-test-result]');
        var button = form.querySelector('button[type="submit"]');
        if (!action || !resultBox || !button) return;
        var args = {};
        try {
          Object.entries(action.inputSchema.properties || {}).forEach(function (entry) {
            var name = entry[0]; var schema = entry[1] || {}; var input = form.elements.namedItem(name);
            if (!input || input.value === '') return;
            if (schema.type === 'integer') args[name] = Number.parseInt(input.value, 10);
            else if (schema.type === 'number') args[name] = Number(input.value);
            else if (schema.type === 'boolean') args[name] = input.value === 'true';
            else if (schema.type === 'object' || schema.type === 'array') args[name] = JSON.parse(input.value);
            else args[name] = input.value;
          });
        } catch (error) {
          resultBox.className = 'integration-tool-test-result failed'; resultBox.innerHTML = '<b>Check the input.</b><p>' + escapeHtml(error.message) + '</p>'; resultBox.hidden = false; return;
        }
        button.disabled = true; button.textContent = 'Running…'; resultBox.hidden = true;
        try {
          var result = await api('/api/integrations/actions/' + action.id + '/test', { method: 'POST', body: { args: args, confirmLiveWrite: Boolean(form.elements.confirmLiveWrite && form.elements.confirmLiveWrite.checked), acknowledgeHighImpact: Boolean(form.elements.acknowledgeHighImpact && form.elements.acknowledgeHighImpact.checked) } });
          resultBox.className = 'integration-tool-test-result ' + (result.ok ? 'succeeded' : 'failed');
          resultBox.innerHTML = '<div><b>' + (result.ok ? 'Action succeeded' : 'Action failed') + '</b><span>' + (result.http_status ? 'HTTP ' + escapeHtml(String(result.http_status)) : '') + '</span></div><pre class="code-panel">' + escapeHtml(JSON.stringify(result.data !== undefined ? result.data : result, null, 2)) + '</pre><small>Recorded in Action history as a manual admin test.</small>';
          resultBox.hidden = false;
        } catch (error) {
          resultBox.className = 'integration-tool-test-result failed'; resultBox.innerHTML = '<b>Action failed</b><p>' + escapeHtml(error.message) + '</p>'; resultBox.hidden = false;
        } finally {
          button.disabled = false; button.textContent = !['GET', 'HEAD', 'OPTIONS'].includes(action.method) ? 'Run live test' : 'Run test';
        }
      };
    });

    document.querySelectorAll('[data-save-integration-action]').forEach(function (button) {
      button.onclick = async function () {
        var card = button.closest('[data-integration-action]');
        var enabled = card.querySelector('[name="enabled"]').checked;
        var acknowledge = card.querySelector('[name="acknowledgeHighImpact"]');
        try { await api('/api/integrations/actions/' + button.dataset.saveIntegrationAction, { method: 'PUT', body: { enabled: enabled, approvalPolicy: card.querySelector('[name="approvalPolicy"]').value, acknowledgeHighImpact: Boolean(acknowledge && acknowledge.checked) } }); toast(enabled ? 'Action approved for this tenant' : 'Action disabled'); await window.connectionsActionsSettingsView(); } catch (error) { toast(error.message); }
      };
    });
    document.querySelectorAll('[data-save-assignments]').forEach(function (button) {
      button.onclick = async function () {
        var card = button.closest('[data-integration-action]'); var select = card.querySelector('[name="tenantOperationIds"]');
        var ids = select ? Array.from(select.selectedOptions).map(function (option) { return option.value; }) : [];
        try { await api('/api/integrations/actions/' + button.dataset.saveAssignments + '/assignments', { method: 'PUT', body: { tenantOperationIds: ids } }); toast('AI Employee assignment saved'); await window.connectionsActionsSettingsView(); } catch (error) { toast(error.message); }
      };
    });
    var advancedForm = $('#integrationAdvancedForm');
    if (advancedForm) advancedForm.onsubmit = async function (event) { event.preventDefault(); var values = Object.fromEntries(new FormData(advancedForm)); try { await api('/api/integrations/' + connection.id + '/advanced', { method: 'PUT', body: { baseUrl: values.baseUrl, apiVersion: values.apiVersion, behaviorConfig: { timeoutMs: values.timeoutMs, requestsPerMinute: values.requestsPerMinute, maxResponseChars: values.maxResponseChars, retryReads: values.retryReads } } }); toast('Advanced settings saved'); await window.connectionsActionsSettingsView(); } catch (error) { toast(error.message); } };
    var specForm = $('#integrationSpecImportForm');
    if (specForm) specForm.onsubmit = async function (event) { event.preventDefault(); try { var result = await api('/api/integrations/' + connection.id + '/spec', { method: 'POST', body: Object.fromEntries(new FormData(specForm)) }); toast(result.actionCount + ' functions imported; all are disabled'); await window.connectionsActionsSettingsView(); } catch (error) { toast(error.message); } };
    var manualForm = $('#integrationManualActionForm');
    if (manualForm) manualForm.onsubmit = async function (event) { event.preventDefault(); var values = Object.fromEntries(new FormData(manualForm)); try { values.inputSchema = JSON.parse(values.inputSchema); await api('/api/integrations/' + connection.id + '/actions/manual', { method: 'POST', body: values }); toast('Manual action added disabled for review'); await window.connectionsActionsSettingsView(); } catch (error) { toast(error.message); } };
    document.querySelectorAll('[data-connection-operation]').forEach(function (button) { button.onclick = async function () { var operation = button.dataset.connectionOperation; if (!window.confirm(operation === 'revoke' ? 'Revoke stored credentials and disable this connection?' : operation.charAt(0).toUpperCase() + operation.slice(1) + ' this connection?')) return; try { await api('/api/integrations/' + connection.id + '/' + operation, { method: 'POST', body: {} }); toast('Connection updated'); await window.connectionsActionsSettingsView(); } catch (error) { toast(error.message); } }; });
  }

  function bindHistory() {
    var toggle = document.querySelector('[data-toggle-history]'); var list = $('#integrationHistoryList');
    toggle.onclick = function () { list.hidden = !list.hidden; toggle.textContent = list.hidden ? 'View history' : 'Hide history'; };
    document.querySelectorAll('[data-history-detail]').forEach(function (button) { button.onclick = async function () { var target = document.querySelector('[data-history-detail-for="' + button.dataset.historyDetail + '"]'); if (!target.hidden) { target.hidden = true; return; } try { var detail = await api('/api/integrations/executions/' + button.dataset.historyDetail); target.innerHTML = '<pre class="code-panel">' + escapeHtml(JSON.stringify(detail, null, 2)) + '</pre>'; target.hidden = false; } catch (error) { toast(error.message); } }; });
    document.querySelectorAll('[data-approve-integration]').forEach(function (button) { button.onclick = async function () { if (!window.confirm('Approve and run this pending action now?')) return; button.disabled = true; try { var result = await api('/api/integrations/executions/' + button.dataset.approveIntegration + '/approve', { method: 'POST', body: {} }); toast(result.ok ? 'Approved action completed' : 'Action failed'); await window.connectionsActionsSettingsView(); } catch (error) { toast(error.message); button.disabled = false; } }; });
  }

  window.connectionsActionsSettingsView = async function () {
    setTitle('Connections & Actions');
    var data = await api('/api/integrations');
    var selected = data.connections.find(function (item) { return item.id === selectedConnectionId(); }) || null;
    var mainView = [
      '<header class="integration-page-heading"><h2>Connections &amp; Actions</h2></header>',
      connectPanel(),
      '<section class="integration-list-panel"><h2>Connected applications</h2>', connectedApplications(data.connections), '</section>',
      historyPanel(data.executions)
    ].join('');
    $('#adminContent').innerHTML = settingsTabs('connections-actions') + '<div class="settings-stack integration-settings">' + (selected ? manageConnection(selected, data.engineOperations || []) : mainView) + '</div>';

    if (selected) bindManage(selected);
    else {
      bindDiscoverForm(); bindHistory();
      document.querySelectorAll('[data-manage-connection]').forEach(function (button) { button.onclick = async function () { setSelectedConnection(button.dataset.manageConnection); await window.connectionsActionsSettingsView(); }; });
    }
    var close = document.querySelector('[data-close-manage]'); if (close) close.onclick = async function () { setSelectedConnection(''); await window.connectionsActionsSettingsView(); };
  };
})();
