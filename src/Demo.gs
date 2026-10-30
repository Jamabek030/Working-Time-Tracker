// Public-demonstration support. Everything here is guarded so that an
// anonymous visitor of the deployed /exec URL cannot use it for anything but
// the documented, non-destructive demo behaviour (audit F-19..F-24).
//
// Public (non-underscore) functions in this file: resetDemoData only, and it
// is owner-gated by adminOnly_.

// Owner-only gate for functions that must stay publicly *callable* because the
// Apps Script editor can only run non-underscore functions. google.script.run
// can call them too, so each one must refuse unless the owner has armed THAT
// function: Project Settings -> Script properties -> ADMIN_MODE = <function
// name> (e.g. resetDemoData). The value is bound to one function, so arming
// one cannot be used to run another. The check-and-consume is atomic under the
// script lock, and the property is deleted when it matches, before the
// operation starts: a failed run does not leave it armed, and two concurrent
// callers cannot both consume it. Visitors cannot create Script Properties.
function adminOnly_(label) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error(label + ' could not be checked right now; try again.');
  }
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('ADMIN_MODE') !== label) {
      throw new Error(label + ' is an owner-only operation and is not armed.');
    }
    props.deleteProperty('ADMIN_MODE');
  } finally {
    lock.releaseLock();
  }
}

var demoEnvMemo_ = null;

// True only when the bound spreadsheet identifies itself as a test/demo one.
// Fails closed: any error (including "no spreadsheet configured") is false.
function demo_environmentOk_() {
  if (demoEnvMemo_ !== null) return demoEnvMemo_;
  try {
    demoEnvMemo_ = isDemoEnvironmentName(getSpreadsheet_().getName());
  } catch (err) {
    demoEnvMemo_ = false;
  }
  return demoEnvMemo_;
}

// Row caps keep an anonymous audience from filling the spreadsheet. Only the
// three application sheets are capped; Test_* sheets used by runTests are not.
function demo_checkRowCap_(sheetName, sheet) {
  if (!DEMO_CONFIG.ENABLED) return;
  var keys = ['EMPLOYEES', 'TASKS', 'SESSIONS', 'INVITES'];
  for (var i = 0; i < keys.length; i++) {
    if (DEFAULT_CONFIG.SHEETS[keys[i]] === sheetName) {
      checkRowLimit(Math.max(0, sheet.getLastRow() - 1), DEMO_CONFIG.LIMITS[keys[i]], sheetName);
      return;
    }
  }
}

function demo_seed_(ctx) {
  var sample = buildDemoSample(Date.now(), uuid_, token_);
  sample.employees.forEach(function (r) { appendRow_(ctx.sheets.EMPLOYEES, r, DEFAULT_CONFIG.HEADERS.EMPLOYEES); });
  sample.tasks.forEach(function (r) { appendRow_(ctx.sheets.TASKS, r, DEFAULT_CONFIG.HEADERS.TASKS); });
  sample.sessions.forEach(function (r) { appendRow_(ctx.sheets.SESSIONS, r, DEFAULT_CONFIG.HEADERS.SESSIONS); });
  return { employees: sample.employees.length, tasks: sample.tasks.length, sessions: sample.sessions.length };
}

// Reachable by anonymous visitors through api_loadDemoSample. Non-destructive:
// it only ever appends, and only when there is not a single employee yet.
function demo_loadSampleIfEmpty_(ctx) {
  ctx = ctx || getContext_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (employees_list_(ctx).length > 0) {
      throw UserError('Sample data can only be loaded while the demo has no employees.');
    }
    return demo_seed_(ctx);
  } finally {
    lock.releaseLock();
  }
}

// Clears the rows of exactly three sheets named by `ctx` (Employees, Tasks,
// WorkSessions in the real context) and re-seeds them. It never deletes a
// sheet and never touches any other sheet or spreadsheet.
function demo_reset_(ctx) {
  ctx = ctx || getContext_();
  setupSheets_(ctx);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = getSpreadsheet_();
    [ctx.sheets.EMPLOYEES, ctx.sheets.TASKS, ctx.sheets.SESSIONS, ctx.sheets.INVITES].forEach(function (name) {
      if (!name) return;
      var sheet = ss.getSheetByName(name);
      if (!sheet) return;
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      if (lastRow > 1 && lastCol > 0) {
        sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
      }
    });
    return demo_seed_(ctx);
  } finally {
    lock.releaseLock();
  }
}

// OWNER-ONLY. Restores the demonstration to its known initial state. Arm it
// first (see adminOnly_), then run it from the Apps Script editor.
function resetDemoData() {
  adminOnly_('resetDemoData');
  if (!DEMO_CONFIG.ENABLED || !demo_environmentOk_()) {
    throw new Error('Refusing to reset: this is not a verified demonstration spreadsheet.');
  }
  var counts = demo_reset_(getContext_());
  Logger.log('resetDemoData: restored ' + counts.employees + ' employees, ' + counts.tasks +
    ' tasks, ' + counts.sessions + ' sessions.');
  return counts;
}

// Removes ONLY the fictional records created by this project's own acceptance
// runs (see isTestArtifactEmail in pure.gs: demo.verifier.<digits>@example.com
// and inj.verifier@example.com) together with their tasks, sessions and
// invitation log rows. Any other employee is left untouched.
function demo_cleanup_(ctx) {
  ctx = ctx || getContext_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ids = {};
    employees_list_(ctx).forEach(function (e) { if (isTestArtifactEmail(e.email)) ids[e.id] = true; });
    var removed = { employees: 0, tasks: 0, sessions: 0, invites: 0 };
    if (!Object.keys(ids).length) return removed;
    removed.sessions = deleteRowsWhere_(ctx.sheets.SESSIONS, function (r) { return ids[String(r.employeeId)] === true; });
    removed.tasks = deleteRowsWhere_(ctx.sheets.TASKS, function (r) { return ids[String(r.employeeId)] === true; });
    if (ctx.sheets.INVITES) removed.invites = deleteRowsWhere_(ctx.sheets.INVITES, function (r) { return ids[String(r.employeeId)] === true; });
    removed.employees = deleteRowsWhere_(ctx.sheets.EMPLOYEES, function (r) { return ids[String(r.id)] === true; });
    return removed;
  } finally {
    lock.releaseLock();
  }
}

// OWNER-ONLY. Arm with ADMIN_MODE=cleanupTestArtifacts, then run from the editor.
function cleanupTestArtifacts() {
  adminOnly_('cleanupTestArtifacts');
  if (!DEMO_CONFIG.ENABLED || !demo_environmentOk_()) {
    throw new Error('Refusing to clean up: this is not a verified demonstration spreadsheet.');
  }
  var removed = demo_cleanup_(getContext_());
  Logger.log('cleanupTestArtifacts: removed ' + JSON.stringify(removed));
  return removed;
}
