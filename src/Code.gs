// Entry point and HTTP-facing API.
//
// Access gate (audit F-04): the whole api_* surface is callable by any
// unauthenticated visitor of the deployed /exec URL. Because this build has
// no login, deployment with ANYONE_ANONYMOUS access = anyone who gets the
// URL can create employees, change tasks, read reports, and (via
// api_getEmployeeDetails) read every employee's workspace token. To make
// that posture explicit and prevent an accidentally public deployment, the
// api_* functions and doGet refuse to serve traffic until a Script Property
// `ACCESS_MODE` has been set to `OPEN` by running `enableOpenAccess()` from
// the editor. The default LOCKED state renders an unconfigured notice page.
//
// Public callable surface (audit F-19): google.script.run can invoke EVERY
// top-level function whose name does not end in "_", not just the ones the UI
// uses. Therefore the only non-underscore functions in this project are:
//   doGet, the api_* functions (all gated by requireOpenAccess_ and safeApi_),
//   the pure helpers in pure.gs (no I/O), and a short list of owner-only admin
//   functions that begin with adminOnly_(). tests/surface.test.js enforces
//   this allowlist so a new public function cannot slip in unnoticed.
//
// Error sanitization (audit F-18): api_* calls go through `safeApi_`, which
// surfaces messages marked `userSafe = true` as-is and replaces anything
// else with a generic string, while logging the full error server-side.

function doGet(e) {
  var params = (e && e.parameter) || {};
  var page = params.page || 'manager';
  // Access check FIRST: a spreadsheet that fails the demo check must not even
  // get its sheets created. Failures are logged, never echoed to the visitor.
  if (!access_isOpen_()) {
    return htmlLockedNotice_();
  }
  try {
    setupSheets_();
  } catch (err) {
    try { console.error('doGet setup failed: ' + (err && err.message ? err.message : String(err))); } catch (_) {}
    return htmlError_('Setup error', 'The application could not initialise its data store. The owner can find details in the Apps Script execution log.');
  }

  if (page === 'employee') {
    var token = params.token || '';
    var employee = employees_findByToken_(token);
    if (!employee) {
      return htmlError_(
        'Invalid workspace link',
        'The link you used is not recognized. Ask your manager to resend your personal link.'
      );
    }
    var tmpl = HtmlService.createTemplateFromFile('employee');
    tmpl.employee = employee;
    tmpl.workspaceTokenJs = jsonForScript_(employee.workspaceToken);
    return tmpl.evaluate()
      .setTitle('Workspace — ' + employee.firstName)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  var mgr = HtmlService.createTemplateFromFile('manager');
  mgr.demoMode = DEMO_CONFIG.ENABLED;
  return mgr.evaluate()
    .setTitle('Working Time Tracker — Manager')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// --- access gate ---------------------------------------------------------

function access_isOpen_() {
  // Demo build: access is granted only while the bound spreadsheet identifies
  // itself as a test/demo one (fails closed otherwise). enableOpenAccess() is
  // not part of the demo flow and is never called by it.
  if (DEMO_CONFIG.ENABLED) return demo_environmentOk_();
  return (PropertiesService.getScriptProperties().getProperty('ACCESS_MODE') || 'LOCKED') === 'OPEN';
}

function enableOpenAccess() {
  adminOnly_('enableOpenAccess');
  PropertiesService.getScriptProperties().setProperty('ACCESS_MODE', 'OPEN');
  return 'ACCESS_MODE = OPEN. The /exec URL now serves the manager console to anyone who has the link. Share the URL only with managers.';
}

function disableOpenAccess() {
  adminOnly_('disableOpenAccess');
  PropertiesService.getScriptProperties().setProperty('ACCESS_MODE', 'LOCKED');
  return 'ACCESS_MODE = LOCKED. The /exec URL now shows the unconfigured notice.';
}

function getAccessMode_() {
  return PropertiesService.getScriptProperties().getProperty('ACCESS_MODE') || 'LOCKED';
}

function requireOpenAccess_() {
  if (!access_isOpen_()) {
    if (DEMO_CONFIG.ENABLED) {
      throw UserError('The demonstration is unavailable: its environment check failed.');
    }
    throw UserError('This deployment is locked. An administrator must run enableOpenAccess() in the Apps Script editor before the console can be used.');
  }
}

// --- api wrapper ---------------------------------------------------------

function safeApi_(label, fn) {
  try {
    return fn();
  } catch (err) {
    var msg = (err && err.message) ? err.message : String(err);
    try {
      console.error(label + ' failed: ' + msg + '\n' + (err && err.stack ? err.stack : '(no stack)'));
    } catch (_) {
      try { Logger.log(label + ' failed: ' + msg); } catch (__) {}
    }
    if (err && err.userSafe) {
      throw new Error(errorEncode(msg));
    }
    throw new Error(errorEncode('A server error occurred. Check the Apps Script execution log.'));
  }
}

// --- utilities -----------------------------------------------------------

function htmlError_(title, message) {
  var html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml_(title) + '</title>' +
    '<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:40px auto;padding:16px;color:#111;}h1{font-size:20px}p{color:#444}</style>' +
    '<h1>' + escapeHtml_(title) + '</h1><p>' + escapeHtml_(message) + '</p>';
  return HtmlService.createHtmlOutput(html);
}

function htmlLockedNotice_() {
  if (DEMO_CONFIG.ENABLED) {
    return htmlError_('Demo unavailable',
      'This demonstration refuses to start because its environment check failed: the bound spreadsheet must be a dedicated test/demo spreadsheet. Nothing was read or changed.');
  }
  var body = [
    '<h1>Working Time Tracker — not yet configured</h1>',
    '<p>This deployment is in <strong>LOCKED</strong> mode. The manager console is intentionally unauthenticated: anyone who has this URL can create employees, change tasks and view reports once it is unlocked. To acknowledge this and switch on the console, an administrator must open the Apps Script editor, select <code>enableOpenAccess</code> from the function dropdown, and click Run.</p>',
    '<p>After enabling, reload this page to see the manager console.</p>'
  ].join('');
  return htmlError_('Not configured', body);
}

function escapeHtml_(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Returns a JSON-safe literal for direct injection inside <script>, with
// angle brackets escaped so no payload can close the enclosing script tag.
function jsonForScript_(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function getWebAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

function employeeWorkspaceUrl_(token, lang) {
  var baseUrl = getWebAppUrl_();
  if (!baseUrl) return '';
  return baseUrl + (baseUrl.indexOf('?') < 0 ? '?' : '&') +
    'page=employee&token=' + encodeURIComponent(token) +
    (lang ? '&lang=' + encodeURIComponent(normalizeLang(lang)) : '');
}

// -------- Manager API --------

function api_listEmployees() {
  return safeApi_('api_listEmployees', function () {
    requireOpenAccess_();
    setupSheets_();
    var employees = employees_list_();
    // Read sessions once and group by employeeId so the response is O(E + S)
    // sheet work rather than one full read per employee (audit F-08).
    var allSessions = sessions_list_();
    var byEmp = {};
    allSessions.forEach(function (s) {
      (byEmp[s.employeeId] = byEmp[s.employeeId] || []).push(s);
    });
    var nowMs = Date.now();
    var tasksByEmp = {};
    tasks_list_().forEach(function (t) { (tasksByEmp[t.employeeId] = tasksByEmp[t.employeeId] || []).push(t); });
    var invites = invites_latestByEmployee_();
    // The workspace token is deliberately NOT returned here (audit F-04).
    // Use api_getEmployeeDetails to fetch it on demand.
    return employees.map(function (e) {
      var sessions = byEmp[e.id] || [];
      var hasActive = sessions.some(function (s) { return s.status === 'active'; });
      return {
        workState: classifyWorkState(tasksByEmp[e.id] || [], sessions),
        invite: invites[e.id] || null,
        id: e.id,
        lastName: e.lastName,
        firstName: e.firstName,
        middleName: e.middleName,
        email: e.email,
        createdAt: e.createdAt,
        active: e.active,
        totalMs: sumSessionMs(sessions, nowMs),
        hasActiveSession: hasActive
      };
    });
  });
}

function api_createEmployee(data) {
  return safeApi_('api_createEmployee', function () {
    requireOpenAccess_();
    setupSheets_();
    var employee = employees_create_(data);
    var initialTask = sanitize(data && data.initialTask);
    var lang = normalizeLang(data && data.lang);
    // The employee is already saved. Whatever happens to the email, the record
    // stays and the manager can copy the workspace link or retry.
    var invite;
    if (data && data.sendInvite === false) {
      invite = { status: 'not_requested', at: nowIso_() };
      try { invites_log_(getContext_(), employee.id, employee.email, 'not_requested', ''); } catch (_) {}
    } else {
      try {
        invite = email_sendInvitation_(employee, initialTask, lang);
      } catch (err) {
        try { console.error('invitation step failed: ' + email_safeDetail_(err)); } catch (_) {}
        invite = { status: 'failed', at: nowIso_() };
      }
    }
    return {
      invite: invite,
      employee: {
        id: employee.id,
        lastName: employee.lastName,
        firstName: employee.firstName,
        middleName: employee.middleName,
        email: employee.email,
        createdAt: employee.createdAt
      }
    };
  });
}

// Retry / resend an invitation for an existing employee.
function api_resendInvitation(employeeId, lang) {
  return safeApi_('api_resendInvitation', function () {
    requireOpenAccess_();
    setupSheets_();
    var employee = employees_findById_(employeeId);
    if (!employee) throw UserError('Employee not found.');
    var task = tasks_getActive_(employee.id);
    return email_sendInvitation_(employee, task ? task.title : '', normalizeLang(lang));
  });
}

// What the Manager UI needs to know about this deployment's capabilities.
function api_getAppInfo() {
  return safeApi_('api_getAppInfo', function () {
    requireOpenAccess_();
    var cap = email_capability_();
    return { demo: !!DEMO_CONFIG.ENABLED, email: { enabled: cap.enabled, available: cap.available, remaining: cap.remaining } };
  });
}

function api_getDashboard(fromDate, toDate) {
  return safeApi_('api_getDashboard', function () {
    requireOpenAccess_();
    setupSheets_();
    return dashboard_get_(fromDate, toDate);
  });
}

// Returns the CSV text of the selected report (same logic as the on-screen
// report). The browser turns it into a file.
function api_exportReportCsv(fromDate, toDate, employeeId, lang) {
  return safeApi_('api_exportReportCsv', function () {
    requireOpenAccess_();
    setupSheets_();
    return reports_csv_(fromDate, toDate, employeeId, lang);
  });
}

// Demo only: populate an EMPTY demonstration with fictional employees so a
// reviewer can try reports immediately. Non-destructive: refuses when any
// employee already exists.
function api_loadDemoSample() {
  return safeApi_('api_loadDemoSample', function () {
    requireOpenAccess_();
    if (!DEMO_CONFIG.ENABLED) throw UserError('Sample data is only available in the demonstration build.');
    setupSheets_();
    return demo_loadSampleIfEmpty_();
  });
}

function api_getEmployeeDetails(employeeId) {
  return safeApi_('api_getEmployeeDetails', function () {
    requireOpenAccess_();
    setupSheets_();
    var employee = employees_findById_(employeeId);
    if (!employee) throw UserError('Employee not found.');
    var tasks = tasks_forEmployee_(employeeId);
    var sessions = sessions_forEmployee_(employeeId);
    var activeTask = null;
    for (var i = 0; i < tasks.length; i++) if (tasks[i].status === 'active') { activeTask = tasks[i]; break; }
    var activeSession = null;
    for (var j = 0; j < sessions.length; j++) if (sessions[j].status === 'active') { activeSession = sessions[j]; break; }
    var diag = sumSessionMsWithDiagnostics(sessions, Date.now());
    return {
      invite: invites_latestByEmployee_()[employee.id] || null,
      employee: {
        id: employee.id,
        lastName: employee.lastName,
        firstName: employee.firstName,
        middleName: employee.middleName,
        email: employee.email,
        createdAt: employee.createdAt
      },
      tasks: tasks,
      sessions: sessions,
      activeTask: activeTask,
      activeSession: activeSession,
      totalMs: diag.totalMs,
      dataWarnings: diag.warnings,
      workspaceUrl: employeeWorkspaceUrl_(employee.workspaceToken)
    };
  });
}

function api_assignTask(employeeId, title) {
  return safeApi_('api_assignTask', function () {
    requireOpenAccess_();
    setupSheets_();
    return employees_assignTask_(employeeId, title);
  });
}

function api_rotateWorkspaceToken(employeeId) {
  return safeApi_('api_rotateWorkspaceToken', function () {
    requireOpenAccess_();
    setupSheets_();
    var result = employees_rotateToken_(employeeId);
    return {
      employeeId: result.employeeId,
      workspaceUrl: employeeWorkspaceUrl_(result.workspaceToken)
    };
  });
}

function api_generateReport(fromDate, toDate) {
  return safeApi_('api_generateReport', function () {
    requireOpenAccess_();
    setupSheets_();
    return reports_generate_(fromDate, toDate);
  });
}

// -------- Employee API --------

function api_getEmployeeState(token) {
  return safeApi_('api_getEmployeeState', function () {
    requireOpenAccess_();
    setupSheets_();
    var employee = employees_findByToken_(token);
    if (!employee) throw UserError('Invalid workspace link.');
    var tasks = tasks_forEmployee_(employee.id);
    var sessions = sessions_forEmployee_(employee.id);
    var activeTask = null;
    for (var i = 0; i < tasks.length; i++) if (tasks[i].status === 'active') { activeTask = tasks[i]; break; }
    var activeSession = null;
    for (var j = 0; j < sessions.length; j++) if (sessions[j].status === 'active') { activeSession = sessions[j]; break; }
    var totalMsForActiveTask = 0;
    if (activeTask) {
      var activeTaskSessions = sessions.filter(function (s) { return s.taskId === activeTask.id; });
      totalMsForActiveTask = sumSessionMs(activeTaskSessions, Date.now());
    }
    return {
      employee: {
        id: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        middleName: employee.middleName
      },
      tasks: tasks,
      sessions: sessions,
      activeTask: activeTask,
      activeSession: activeSession,
      totalMsForActiveTask: totalMsForActiveTask,
      serverTime: new Date().toISOString()
    };
  });
}

function api_startSession(token) {
  return safeApi_('api_startSession', function () {
    requireOpenAccess_();
    setupSheets_();
    var employee = employees_findByToken_(token);
    if (!employee) throw UserError('Invalid workspace link.');
    return sessions_start_(employee.id);
  });
}

function api_pauseSession(token) {
  return safeApi_('api_pauseSession', function () {
    requireOpenAccess_();
    setupSheets_();
    var employee = employees_findByToken_(token);
    if (!employee) throw UserError('Invalid workspace link.');
    return sessions_pause_(employee.id);
  });
}

function api_resumeSession(token) {
  return safeApi_('api_resumeSession', function () {
    requireOpenAccess_();
    setupSheets_();
    var employee = employees_findByToken_(token);
    if (!employee) throw UserError('Invalid workspace link.');
    return sessions_resume_(employee.id);
  });
}

function api_finishTask(token) {
  return safeApi_('api_finishTask', function () {
    requireOpenAccess_();
    setupSheets_();
    var employee = employees_findByToken_(token);
    if (!employee) throw UserError('Invalid workspace link.');
    return sessions_finish_(employee.id);
  });
}
