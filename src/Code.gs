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
// Error sanitization (audit F-18): api_* calls go through `safeApi_`, which
// surfaces messages marked `userSafe = true` as-is and replaces anything
// else with a generic string, while logging the full error server-side.

function doGet(e) {
  var params = (e && e.parameter) || {};
  var page = params.page || 'manager';
  try {
    setupSheets();
  } catch (err) {
    return htmlError_('Setup error', err.message);
  }

  if (!access_isOpen_()) {
    return htmlLockedNotice_();
  }

  if (page === 'employee') {
    var token = params.token || '';
    var employee = employees_findByToken(token);
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
  return mgr.evaluate()
    .setTitle('Working Time Tracker — Manager')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// --- access gate ---------------------------------------------------------

function access_isOpen_() {
  return (PropertiesService.getScriptProperties().getProperty('ACCESS_MODE') || 'LOCKED') === 'OPEN';
}

function enableOpenAccess() {
  PropertiesService.getScriptProperties().setProperty('ACCESS_MODE', 'OPEN');
  return 'ACCESS_MODE = OPEN. The /exec URL now serves the manager console to anyone who has the link. Share the URL only with managers.';
}

function disableOpenAccess() {
  PropertiesService.getScriptProperties().setProperty('ACCESS_MODE', 'LOCKED');
  return 'ACCESS_MODE = LOCKED. The /exec URL now shows the unconfigured notice.';
}

function getAccessMode() {
  return PropertiesService.getScriptProperties().getProperty('ACCESS_MODE') || 'LOCKED';
}

function requireOpenAccess_() {
  if (!access_isOpen_()) {
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
      throw new Error(msg);
    }
    throw new Error('A server error occurred. Check the Apps Script execution log.');
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

function getWebAppUrl() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

function employeeWorkspaceUrl_(token) {
  var baseUrl = getWebAppUrl();
  if (!baseUrl) return '';
  return baseUrl + (baseUrl.indexOf('?') < 0 ? '?' : '&') +
    'page=employee&token=' + encodeURIComponent(token);
}

// -------- Manager API --------

function api_listEmployees() {
  return safeApi_('api_listEmployees', function () {
    requireOpenAccess_();
    setupSheets();
    var employees = employees_list();
    // Read sessions once and group by employeeId so the response is O(E + S)
    // sheet work rather than one full read per employee (audit F-08).
    var allSessions = sessions_list();
    var byEmp = {};
    allSessions.forEach(function (s) {
      (byEmp[s.employeeId] = byEmp[s.employeeId] || []).push(s);
    });
    var nowMs = Date.now();
    // The workspace token is deliberately NOT returned here (audit F-04).
    // Use api_getEmployeeDetails to fetch it on demand.
    return employees.map(function (e) {
      var sessions = byEmp[e.id] || [];
      var hasActive = sessions.some(function (s) { return s.status === 'active'; });
      return {
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
    setupSheets();
    var employee = employees_create(data);
    var initialTask = sanitize(data && data.initialTask);
    var emailResult = { sent: false, error: '' };
    try {
      email_sendInvitation(employee, initialTask);
      emailResult.sent = true;
    } catch (err) {
      emailResult.error = err && err.message ? err.message : String(err);
      try { console.error('invitation email failed: ' + emailResult.error); } catch (_) {}
    }
    return {
      employee: {
        id: employee.id,
        lastName: employee.lastName,
        firstName: employee.firstName,
        middleName: employee.middleName,
        email: employee.email,
        createdAt: employee.createdAt
      },
      emailSent: emailResult.sent,
      emailError: emailResult.sent ? '' : emailResult.error
    };
  });
}

function api_getEmployeeDetails(employeeId) {
  return safeApi_('api_getEmployeeDetails', function () {
    requireOpenAccess_();
    setupSheets();
    var employee = employees_findById(employeeId);
    if (!employee) throw UserError('Employee not found.');
    var tasks = tasks_forEmployee(employeeId);
    var sessions = sessions_forEmployee(employeeId);
    var activeTask = null;
    for (var i = 0; i < tasks.length; i++) if (tasks[i].status === 'active') { activeTask = tasks[i]; break; }
    var activeSession = null;
    for (var j = 0; j < sessions.length; j++) if (sessions[j].status === 'active') { activeSession = sessions[j]; break; }
    var diag = sumSessionMsWithDiagnostics(sessions, Date.now());
    return {
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
    setupSheets();
    return employees_assignTask(employeeId, title);
  });
}

function api_rotateWorkspaceToken(employeeId) {
  return safeApi_('api_rotateWorkspaceToken', function () {
    requireOpenAccess_();
    setupSheets();
    var result = employees_rotateToken(employeeId);
    return {
      employeeId: result.employeeId,
      workspaceUrl: employeeWorkspaceUrl_(result.workspaceToken)
    };
  });
}

function api_generateReport(fromDate, toDate) {
  return safeApi_('api_generateReport', function () {
    requireOpenAccess_();
    setupSheets();
    return reports_generate(fromDate, toDate);
  });
}

// -------- Employee API --------

function api_getEmployeeState(token) {
  return safeApi_('api_getEmployeeState', function () {
    requireOpenAccess_();
    setupSheets();
    var employee = employees_findByToken(token);
    if (!employee) throw UserError('Invalid workspace link.');
    var tasks = tasks_forEmployee(employee.id);
    var sessions = sessions_forEmployee(employee.id);
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
    setupSheets();
    var employee = employees_findByToken(token);
    if (!employee) throw UserError('Invalid workspace link.');
    return sessions_start(employee.id);
  });
}

function api_pauseSession(token) {
  return safeApi_('api_pauseSession', function () {
    requireOpenAccess_();
    setupSheets();
    var employee = employees_findByToken(token);
    if (!employee) throw UserError('Invalid workspace link.');
    return sessions_pause(employee.id);
  });
}

function api_resumeSession(token) {
  return safeApi_('api_resumeSession', function () {
    requireOpenAccess_();
    setupSheets();
    var employee = employees_findByToken(token);
    if (!employee) throw UserError('Invalid workspace link.');
    return sessions_resume(employee.id);
  });
}

function api_finishTask(token) {
  return safeApi_('api_finishTask', function () {
    requireOpenAccess_();
    setupSheets();
    var employee = employees_findByToken(token);
    if (!employee) throw UserError('Invalid workspace link.');
    return sessions_finish(employee.id);
  });
}
