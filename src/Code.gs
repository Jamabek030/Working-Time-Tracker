// Entry point and HTTP-facing API. Each api_* function is callable from the
// browser via google.script.run.

function doGet(e) {
  var params = (e && e.parameter) || {};
  var page = params.page || 'manager';
  try {
    setupSheets();
  } catch (err) {
    return htmlError_('Setup error', err.message);
  }

  if (page === 'employee') {
    var token = params.token || '';
    var employee = employees_findByToken(token);
    if (!employee) {
      return htmlError_('Invalid workspace link', 'The link you used is not recognized. Ask your manager to resend your personal link.');
    }
    var tmpl = HtmlService.createTemplateFromFile('employee');
    tmpl.employee = employee;
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

function htmlError_(title, message) {
  var html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml_(title) + '</title>' +
    '<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:40px auto;padding:16px;color:#111;}h1{font-size:20px}p{color:#444}</style>' +
    '<h1>' + escapeHtml_(title) + '</h1><p>' + escapeHtml_(message) + '</p>';
  return HtmlService.createHtmlOutput(html);
}

function escapeHtml_(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getWebAppUrl() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

// -------- Manager API --------

function api_listEmployees() {
  setupSheets();
  var baseUrl = getWebAppUrl();
  return employees_list().map(function (e) {
    var sessions = sessions_forEmployee(e.id);
    var hasActive = sessions.some(function (s) { return s.status === 'active'; });
    return {
      id: e.id,
      lastName: e.lastName,
      firstName: e.firstName,
      middleName: e.middleName,
      email: e.email,
      workspaceToken: e.workspaceToken,
      createdAt: e.createdAt,
      active: e.active,
      totalMs: sumSessionMs(sessions, Date.now()),
      hasActiveSession: hasActive,
      workspaceUrl: baseUrl ? (baseUrl + (baseUrl.indexOf('?') < 0 ? '?' : '&') + 'page=employee&token=' + encodeURIComponent(e.workspaceToken)) : ''
    };
  });
}

function api_createEmployee(data) {
  setupSheets();
  var employee = employees_create(data);
  var initialTask = sanitize(data && data.initialTask);
  try {
    email_sendInvitation(employee, initialTask);
    return { employee: employee, emailSent: true };
  } catch (err) {
    return { employee: employee, emailSent: false, emailError: err.message };
  }
}

function api_getEmployeeDetails(employeeId) {
  setupSheets();
  var employee = employees_findById(employeeId);
  if (!employee) throw new Error('Employee not found.');
  var tasks = tasks_forEmployee(employeeId);
  var sessions = sessions_forEmployee(employeeId);
  var activeTask = null;
  for (var i = 0; i < tasks.length; i++) if (tasks[i].status === 'active') { activeTask = tasks[i]; break; }
  var activeSession = null;
  for (var j = 0; j < sessions.length; j++) if (sessions[j].status === 'active') { activeSession = sessions[j]; break; }
  var totalMs = sumSessionMs(sessions, Date.now());
  var baseUrl = getWebAppUrl();
  var workspaceUrl = baseUrl ? (baseUrl + (baseUrl.indexOf('?') < 0 ? '?' : '&') + 'page=employee&token=' + encodeURIComponent(employee.workspaceToken)) : '';
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
    totalMs: totalMs,
    workspaceUrl: workspaceUrl
  };
}

function api_assignTask(employeeId, title) {
  setupSheets();
  return employees_assignTask(employeeId, title);
}

function api_generateReport(fromDate, toDate) {
  setupSheets();
  return reports_generate(fromDate, toDate);
}

// -------- Employee API --------

function api_getEmployeeState(token) {
  setupSheets();
  var employee = employees_findByToken(token);
  if (!employee) throw new Error('Invalid workspace link.');
  var tasks = tasks_forEmployee(employee.id);
  var sessions = sessions_forEmployee(employee.id);
  var activeTask = null;
  for (var i = 0; i < tasks.length; i++) if (tasks[i].status === 'active') { activeTask = tasks[i]; break; }
  var activeSession = null;
  for (var j = 0; j < sessions.length; j++) if (sessions[j].status === 'active') { activeSession = sessions[j]; break; }
  var totalMsForActiveTask = activeTask ? sumSessionMs(sessions.filter(function (s) { return s.taskId === activeTask.id; }), Date.now()) : 0;
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
}

function api_startSession(token) {
  setupSheets();
  var employee = employees_findByToken(token);
  if (!employee) throw new Error('Invalid workspace link.');
  return sessions_start(employee.id);
}

function api_pauseSession(token) {
  setupSheets();
  var employee = employees_findByToken(token);
  if (!employee) throw new Error('Invalid workspace link.');
  return sessions_pause(employee.id);
}

function api_resumeSession(token) {
  setupSheets();
  var employee = employees_findByToken(token);
  if (!employee) throw new Error('Invalid workspace link.');
  return sessions_resume(employee.id);
}

function api_finishTask(token) {
  setupSheets();
  var employee = employees_findByToken(token);
  if (!employee) throw new Error('Invalid workspace link.');
  return sessions_finish(employee.id);
}
