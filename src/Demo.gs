// Environment guard, owner-only administration and data seeding. Everything
// here is guarded so that an anonymous visitor of the deployed /exec URL cannot
// use it (audit F-19..F-24).
//
// Public (non-underscore) functions in this file: seedAssessmentData,
// resetDemoData and cleanupTestArtifacts; each is owner-gated by adminOnly_.

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
  var keys = ['EMPLOYEES', 'TASKS', 'SESSIONS', 'INVITES', 'PROJECTS', 'COMMENTS', 'ACTIVITY'];
  for (var i = 0; i < keys.length; i++) {
    if (DEFAULT_CONFIG.SHEETS[keys[i]] === sheetName) {
      checkRowLimit(Math.max(0, sheet.getLastRow() - 1), DEMO_CONFIG.LIMITS[keys[i]], sheetName);
      return;
    }
  }
}

// Appends the rows of the company scenario (src/dataset.gs) that are not there
// yet. Rows are matched by their fixed ids (and employees also by email), so
// running it again adds nothing and never duplicates anything. Existing rows are
// never modified or removed.
function assessment_seed_(ctx, nowMs) {
  ctx = ctx || getContext_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var data = buildAssessmentDataset(nowMs || Date.now(), token_);
    var plan = [['PROJECTS', 'projects'], ['EMPLOYEES', 'employees'], ['TASKS', 'tasks'],
      ['SESSIONS', 'sessions'], ['COMMENTS', 'comments'], ['ACTIVITY', 'activity']];
    var emails = {};
    employees_list_(ctx).forEach(function (e) { emails[e.email.toLowerCase()] = true; });
    var added = {};
    plan.forEach(function (p) {
      var have = {};
      readAll_(ctx.sheets[p[0]]).forEach(function (r) { if (r.id) have[String(r.id)] = true; });
      var n = 0;
      data[p[1]].forEach(function (row) {
        if (have[row.id]) return;
        if (p[0] === 'EMPLOYEES' && emails[row.email.toLowerCase()]) return;
        appendRow_(ctx.sheets[p[0]], row, DEFAULT_CONFIG.HEADERS[p[0]]);
        n++;
      });
      added[p[1]] = n;
    });
    return added;
  } finally {
    lock.releaseLock();
  }
}

// Clears the rows of the application sheets named by `ctx` and seeds the
// scenario again. It never deletes a sheet and never touches any other sheet or
// spreadsheet.
function demo_reset_(ctx) {
  ctx = ctx || getContext_();
  setupSheets_(ctx);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = getSpreadsheet_();
    [ctx.sheets.EMPLOYEES, ctx.sheets.TASKS, ctx.sheets.SESSIONS, ctx.sheets.INVITES, ctx.sheets.PROJECTS, ctx.sheets.COMMENTS, ctx.sheets.ACTIVITY].forEach(function (name) {
      if (!name) return;
      var sheet = ss.getSheetByName(name);
      if (!sheet) return;
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      if (lastRow > 1 && lastCol > 0) {
        sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
      }
    });
  } finally {
    lock.releaseLock();
  }
  return assessment_seed_(ctx, Date.now());
}

// OWNER-ONLY and non-destructive. Arm with ADMIN_MODE=seedAssessmentData, run it
// from the Apps Script editor: it adds whatever part of the scenario is missing.
function seedAssessmentData() {
  adminOnly_('seedAssessmentData');
  if (!DEMO_CONFIG.ENABLED || !demo_environmentOk_()) {
    throw new Error('Refusing to seed: this is not the dedicated assessment spreadsheet.');
  }
  var ctx = getContext_();
  setupSheets_(ctx);
  var added = assessment_seed_(ctx, Date.now());
  Logger.log('seedAssessmentData: added ' + JSON.stringify(added));
  return added;
}

// OWNER-ONLY and DESTRUCTIVE: replaces ALL rows of the application sheets with
// the scenario. Arm with ADMIN_MODE=resetDemoData, then run from the editor.
function resetDemoData() {
  adminOnly_('resetDemoData');
  if (!DEMO_CONFIG.ENABLED || !demo_environmentOk_()) {
    throw new Error('Refusing to reset: this is not the dedicated assessment spreadsheet.');
  }
  var counts = demo_reset_(getContext_());
  Logger.log('resetDemoData: restored ' + JSON.stringify(counts));
  return counts;
}

// Removes ONLY the fictional records created by this project's own acceptance
// runs: employees whose email matches isTestArtifactEmail (demo.verifier.<digits>@example.com,
// inj.verifier@example.com) and projects named like isTestArtifactProjectName
// ("Acceptance project <digits>"), together with their tasks, sessions, comments,
// activity and invitation rows. Anything else is left untouched.
function demo_cleanup_(ctx) {
  ctx = ctx || getContext_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var empIds = {}, projIds = {}, taskIds = {};
    employees_list_(ctx).forEach(function (e) { if (isTestArtifactEmail(e.email)) empIds[e.id] = true; });
    projects_list_(ctx).forEach(function (p) { if (isTestArtifactProjectName(p.name)) projIds[p.id] = true; });
    tasks_list_(ctx).forEach(function (t) {
      if ((t.employeeId && empIds[t.employeeId]) || (t.projectId && projIds[t.projectId])) taskIds[t.id] = true;
    });
    var removed = { employees: 0, tasks: 0, sessions: 0, invites: 0, projects: 0, comments: 0, activity: 0 };
    if (!Object.keys(empIds).length && !Object.keys(projIds).length) return removed;
    removed.sessions = deleteRowsWhere_(ctx.sheets.SESSIONS, function (r) { return empIds[String(r.employeeId)] === true || taskIds[String(r.taskId)] === true; });
    if (ctx.sheets.COMMENTS) removed.comments = deleteRowsWhere_(ctx.sheets.COMMENTS, function (r) { return taskIds[String(r.taskId)] === true; });
    if (ctx.sheets.ACTIVITY) removed.activity = deleteRowsWhere_(ctx.sheets.ACTIVITY, function (r) { return taskIds[String(r.taskId)] === true; });
    removed.tasks = deleteRowsWhere_(ctx.sheets.TASKS, function (r) { return taskIds[String(r.id)] === true; });
    if (ctx.sheets.INVITES) removed.invites = deleteRowsWhere_(ctx.sheets.INVITES, function (r) { return empIds[String(r.employeeId)] === true; });
    removed.employees = deleteRowsWhere_(ctx.sheets.EMPLOYEES, function (r) { return empIds[String(r.id)] === true; });
    if (ctx.sheets.PROJECTS) removed.projects = deleteRowsWhere_(ctx.sheets.PROJECTS, function (r) { return projIds[String(r.id)] === true; });
    return removed;
  } finally {
    lock.releaseLock();
  }
}

// OWNER-ONLY. Arm with ADMIN_MODE=cleanupTestArtifacts, then run from the editor.
function cleanupTestArtifacts() {
  adminOnly_('cleanupTestArtifacts');
  if (!DEMO_CONFIG.ENABLED || !demo_environmentOk_()) {
    throw new Error('Refusing to clean up: this is not the dedicated assessment spreadsheet.');
  }
  var removed = demo_cleanup_(getContext_());
  Logger.log('cleanupTestArtifacts: removed ' + JSON.stringify(removed));
  return removed;
}
