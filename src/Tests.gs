// Integration tests. Run from the Apps Script editor by selecting runTests()
// and clicking Run. Tests write to dedicated Test_* sheets, so production
// data in the Employees/Tasks/WorkSessions sheets is never touched.
//
// These tests do NOT run from Node — they require SpreadsheetApp,
// LockService, and the full Apps Script runtime. The Node suite in
// tests/pure.test.js covers pure logic separately.

var TEST_CTX = {
  sheets: {
    EMPLOYEES: 'Test_Employees',
    TASKS: 'Test_Tasks',
    SESSIONS: 'Test_WorkSessions',
    INVITES: 'Test_Invitations',
    PROJECTS: 'Test_Projects',
    COMMENTS: 'Test_TaskComments',
    ACTIVITY: 'Test_TaskActivity'
  },
  headers: DEFAULT_CONFIG.HEADERS
};

// OWNER-ONLY: runs only after the owner arms ADMIN_MODE (see adminOnly_ in
// Demo.gs) because runTests is publicly callable through google.script.run.
function runTests() {
  adminOnly_('runTests');
  var tests = [
    test_createEmployeeAndLink_,
    test_assignTask_,
    test_startPauseResume_,
    test_crossDayNoOvernight_,
    test_sumAcrossSessions_,
    test_reloadRestoresState_,
    test_noDuplicateActiveTimer_,
    test_changeTaskPreservesHistory_,
    test_reportFiltersByRange_,
    test_emptyReport_,
    test_invalidInputsRejected_,
    test_pauseWithNoActiveSessionRejected_,
    test_formulaInjectionNeutralized_,
    test_updateRowThrowsWhenMissing_,
    test_closeSessionRejectsBadStart_,
    test_rotateTokenInvalidatesOldLink_,
    test_lengthLimitsEnforced_,
    test_strictDateParsing_,
    test_sumSessionMsFallsBackToTimestamps_,
    test_ensureSheetRefusesToOverwriteDataWithBlankHeaders_,
    test_demoResetClearsOnlyTargetSheets_,
    test_demoSampleLoadsOnlyIntoEmptyDemo_,
    test_demoSampleReportsMatchSessions_,
    test_demoSampleKeepsTaskHistory_,
    test_emailKillSwitchStopsAllSending_,
    test_adminFunctionsRefuseWhenNotArmed_,
    test_adminArmingIsConsumedOnUse_,
    test_validationMessagesAreUserSafe_,
    test_inviteSentThroughDoubleWithCorrectLink_,
    test_inviteFailureKeepsEmployeeAndCanBeRetried_,
    test_inviteNeverMailsReservedAddresses_,
    test_inviteDailyAndRecipientLimits_,
    test_inviteTextCannotInjectHeadersOrLines_,
    test_dashboardAgreesWithReports_,
    test_dashboardWorkingAndPausedStates_,
    test_csvExportMatchesReportAndNeutralisesFormulas_,
    test_cleanupRemovesOnlyAcceptanceArtifacts_,
    test_cleanupRefusesWhenNotArmed_,
    test_poolTaskLifecycleDraftPublishUnpublish_,
    test_claimTaskOnlyOnce_,
    test_cannotClaimDraftOrCompletedOrAssignedTasks_,
    test_assignPoolTaskToEmployeeKeepsOneRow_,
    test_assignKeepsRecordedWorkOfTheEmployee_,
    test_transitionTableIsEnforced_,
    test_employeeCannotUseAnotherEmployeesTask_,
    test_oneTimerPerEmployeeAcrossSeveralTasks_,
    test_derivedStatusAndOverdue_,
    test_commentsAreOwnedAppendOnlyAndVisibleToTheManager_,
    test_dashboardStatusCountsAndProjectTimeReconcile_,
    test_tasksSheetGainsNewColumnsWithoutTouchingData_,
    test_projectsRequireUniqueNames_
  ];

  // Create the Test_* sheets. ensureSheet_ runs idempotently.
  setupSheets_(TEST_CTX);

  var results = [];
  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    resetTestSheets_();
    var name = t.name || ('test_' + i);
    try {
      t();
      results.push({ name: name, ok: true });
    } catch (err) {
      results.push({ name: name, ok: false, error: err && err.message ? err.message : String(err) });
    }
  }

  var passed = 0;
  for (var k = 0; k < results.length; k++) if (results[k].ok) passed++;
  Logger.log('==== runTests: ' + passed + '/' + results.length + ' passed ====');
  for (var m = 0; m < results.length; m++) {
    Logger.log((results[m].ok ? 'OK   ' : 'FAIL ') + results[m].name + (results[m].ok ? '' : ' -- ' + results[m].error));
  }
  return { total: results.length, passed: passed, results: results };
}

function resetTestSheets_() {
  var ss = getSpreadsheet_();
  [TEST_CTX.sheets.EMPLOYEES, TEST_CTX.sheets.TASKS, TEST_CTX.sheets.SESSIONS, TEST_CTX.sheets.INVITES, TEST_CTX.sheets.PROJECTS, TEST_CTX.sheets.COMMENTS, TEST_CTX.sheets.ACTIVITY].forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow > 1 && lastCol > 0) {
      sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    }
  });
}

function assert_(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}
function assertEq_(a, b, msg) {
  if (a !== b) throw new Error('Expected ' + JSON.stringify(a) + ' to equal ' + JSON.stringify(b) + (msg ? ' - ' + msg : ''));
}
function assertThrows_(fn, msg) {
  try { fn(); } catch (e) { return e; }
  throw new Error('Expected call to throw: ' + msg);
}

function patchSessionStart_(sessionId, msBefore) {
  var past = new Date(Date.now() - msBefore).toISOString();
  updateRow_(TEST_CTX.sheets.SESSIONS, 'id', sessionId, { startTime: past }, DEFAULT_CONFIG.HEADERS.SESSIONS);
}

function test_createEmployeeAndLink_() {
  var emp = employees_create_({
    lastName: 'Smith', firstName: 'John', middleName: '', email: 'john@example.com', initialTask: 'Write docs'
  }, TEST_CTX);
  assert_(emp.id, 'has id');
  assert_(emp.workspaceToken && emp.workspaceToken.length >= 20, 'has token of reasonable length');
  assertEq_(employees_list_(TEST_CTX).length, 1, 'one employee row');
  var t = tasks_getActive_(emp.id, TEST_CTX);
  assert_(t, 'initial task created');
  assertEq_(t.title, 'Write docs');
  assertEq_(employees_findByToken_(emp.workspaceToken, TEST_CTX).email, 'john@example.com');
}

function test_assignTask_() {
  var emp = employees_create_({ lastName: 'A', firstName: 'B', email: 'at@example.com', initialTask: 'T1' }, TEST_CTX);
  var oldActive = tasks_getActive_(emp.id, TEST_CTX);
  var newTask = employees_assignTask_(emp.id, 'T2', TEST_CTX);
  assertEq_(tasks_getActive_(emp.id, TEST_CTX).id, newTask.id, 'new task active');
  var all = tasks_forEmployee_(emp.id, TEST_CTX);
  assertEq_(all.length, 2);
  var replaced = null;
  for (var i = 0; i < all.length; i++) if (all[i].id === oldActive.id) replaced = all[i];
  assertEq_(replaced.status, 'replaced');
}

function test_startPauseResume_() {
  var emp = employees_create_({ lastName: 'A', firstName: 'B', email: 'spr@example.com', initialTask: 'T1' }, TEST_CTX);
  var s1 = sessions_start_(emp.id, TEST_CTX);
  patchSessionStart_(s1.id, 2000);
  var p1 = sessions_pause_(emp.id, TEST_CTX);
  assertEq_(p1.status, 'paused');
  assert_(Number(p1.durationMs) >= 2000, 'duration >= 2000ms');
  assertThrows_(function () { sessions_pause_(emp.id, TEST_CTX); }, 'second pause rejected');
  var s2 = sessions_resume_(emp.id, TEST_CTX);
  assert_(s2.id !== s1.id, 'resume creates a new row');
  assertEq_(sessions_forEmployee_(emp.id, TEST_CTX).length, 2);
}

// Session before midnight + resumed session after midnight; verifies that
// time between sessions (which crosses midnight) is NOT counted (audit F-16).
function test_crossDayNoOvernight_() {
  var emp = employees_create_({ lastName: 'A', firstName: 'B', email: 'xday@example.com', initialTask: 'T1' }, TEST_CTX);
  var taskId = tasks_getActive_(emp.id, TEST_CTX).id;
  // Deliberately fixed UTC fixtures that straddle 2026-10-29 24:00 UTC.
  // Pre-midnight: 23:50:00 to 23:55:00 (5 minutes).
  appendRow_(TEST_CTX.sheets.SESSIONS, {
    id: uuid_(), employeeId: emp.id, taskId: taskId,
    startTime: '2026-10-29T23:50:00.000Z',
    endTime: '2026-10-29T23:55:00.000Z',
    durationMs: 5 * 60 * 1000, status: 'paused'
  }, DEFAULT_CONFIG.HEADERS.SESSIONS);
  // Post-midnight: 00:05:00 to 00:10:00 (5 minutes). Gap between them =
  // 10 minutes and crosses midnight, must NOT be counted.
  appendRow_(TEST_CTX.sheets.SESSIONS, {
    id: uuid_(), employeeId: emp.id, taskId: taskId,
    startTime: '2026-10-30T00:05:00.000Z',
    endTime: '2026-10-30T00:10:00.000Z',
    durationMs: 5 * 60 * 1000, status: 'paused'
  }, DEFAULT_CONFIG.HEADERS.SESSIONS);
  var total = sessions_totalForTask_(taskId, TEST_CTX);
  assertEq_(total, 10 * 60 * 1000, 'exactly 10 minutes, overnight-crossing gap excluded');
}

function test_sumAcrossSessions_() {
  var emp = employees_create_({ lastName: 'A', firstName: 'B', email: 'sum@example.com', initialTask: 'T1' }, TEST_CTX);
  var taskId = tasks_getActive_(emp.id, TEST_CTX).id;
  [10000, 20000, 30000].forEach(function (d) {
    var now = Date.now();
    appendRow_(TEST_CTX.sheets.SESSIONS, {
      id: uuid_(), employeeId: emp.id, taskId: taskId,
      startTime: new Date(now - d - 1000).toISOString(),
      endTime: new Date(now - 1000).toISOString(),
      durationMs: d, status: 'paused'
    }, DEFAULT_CONFIG.HEADERS.SESSIONS);
  });
  assertEq_(sessions_totalForTask_(taskId, TEST_CTX), 60000);
}

function test_reloadRestoresState_() {
  var emp = employees_create_({ lastName: 'A', firstName: 'B', email: 'rel@example.com', initialTask: 'T1' }, TEST_CTX);
  sessions_start_(emp.id, TEST_CTX);
  assert_(sessions_findActive_(emp.id, TEST_CTX), 'active session after fresh read');
  assert_(tasks_getActive_(emp.id, TEST_CTX), 'active task after fresh read');
}

function test_noDuplicateActiveTimer_() {
  var emp = employees_create_({ lastName: 'A', firstName: 'B', email: 'dup@example.com', initialTask: 'T1' }, TEST_CTX);
  sessions_start_(emp.id, TEST_CTX);
  assertThrows_(function () { sessions_start_(emp.id, TEST_CTX); });
  var active = sessions_forEmployee_(emp.id, TEST_CTX).filter(function (s) { return s.status === 'active'; });
  assertEq_(active.length, 1);
}

function test_changeTaskPreservesHistory_() {
  var emp = employees_create_({ lastName: 'A', firstName: 'B', email: 'chg@example.com', initialTask: 'T1' }, TEST_CTX);
  var task1Id = tasks_getActive_(emp.id, TEST_CTX).id;
  var s = sessions_start_(emp.id, TEST_CTX);
  patchSessionStart_(s.id, 5000);
  employees_assignTask_(emp.id, 'T2', TEST_CTX);
  var sessions = sessions_forEmployee_(emp.id, TEST_CTX);
  assertEq_(sessions.length, 1);
  assertEq_(sessions[0].taskId, task1Id, 'session stays linked to old task');
  assertEq_(sessions[0].status, 'paused');
  assert_(sessions_totalForTask_(task1Id, TEST_CTX) >= 5000);
  assertEq_(sessions_totalForTask_(tasks_getActive_(emp.id, TEST_CTX).id, TEST_CTX), 0);
}

function test_reportFiltersByRange_() {
  var emp = employees_create_({ lastName: 'A', firstName: 'B', email: 'rep@example.com', initialTask: 'T1' }, TEST_CTX);
  var taskId = tasks_getActive_(emp.id, TEST_CTX).id;
  var now = Date.now();
  appendRow_(TEST_CTX.sheets.SESSIONS, {
    id: uuid_(), employeeId: emp.id, taskId: taskId,
    startTime: new Date(now - 10 * 60000).toISOString(),
    endTime: new Date(now).toISOString(),
    durationMs: 10 * 60000, status: 'paused'
  }, DEFAULT_CONFIG.HEADERS.SESSIONS);
  appendRow_(TEST_CTX.sheets.SESSIONS, {
    id: uuid_(), employeeId: emp.id, taskId: taskId,
    startTime: new Date(now - 10 * 86400000 - 20 * 60000).toISOString(),
    endTime: new Date(now - 10 * 86400000).toISOString(),
    durationMs: 20 * 60000, status: 'paused'
  }, DEFAULT_CONFIG.HEADERS.SESSIONS);
  var yStr = toYmd_(new Date(now - 86400000));
  var tStr = toYmd_(new Date(now));
  var rep = reports_generate_(yStr, tStr, TEST_CTX);
  assertEq_(rep.length, 1);
  assert_(Math.abs(rep[0].totalMs - 10 * 60000) <= 3000, 'approx 10 min in range');
  assert_('tasksCreatedInRange' in rep[0], 'report row carries tasksCreatedInRange field');
}

function toYmd_(d) {
  var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

function test_emptyReport_() {
  assertEq_(reports_generate_(toYmd_(new Date()), toYmd_(new Date()), TEST_CTX).length, 0);
}

function test_invalidInputsRejected_() {
  var errs = 0;
  function tryIt(fn) { try { fn(); } catch (e) { errs++; } }
  tryIt(function () { employees_create_({}, TEST_CTX); });
  tryIt(function () { employees_create_({ lastName: 'A' }, TEST_CTX); });
  tryIt(function () { employees_create_({ lastName: 'A', firstName: 'B', email: 'not-an-email', initialTask: 'T' }, TEST_CTX); });
  tryIt(function () { employees_create_({ lastName: 'A', firstName: 'B', email: 'a@b.com', initialTask: '' }, TEST_CTX); });
  employees_create_({ lastName: 'A', firstName: 'B', email: 'dupe@example.com', initialTask: 'T' }, TEST_CTX);
  tryIt(function () { employees_create_({ lastName: 'A', firstName: 'C', email: 'dupe@example.com', initialTask: 'T2' }, TEST_CTX); });
  tryIt(function () { reports_generate_('2024-05-01', '2024-04-01', TEST_CTX); });
  assertEq_(errs, 6, 'all six invalid cases rejected');
}

function test_pauseWithNoActiveSessionRejected_() {
  var emp = employees_create_({ lastName: 'A', firstName: 'B', email: 'nap@example.com', initialTask: 'T1' }, TEST_CTX);
  assertThrows_(function () { sessions_pause_(emp.id, TEST_CTX); });
}

// --- new tests for remediated findings ----------------------------------

function test_formulaInjectionNeutralized_() {
  // A name beginning with = must be stored with a leading apostrophe so
  // Sheets treats it as text. On read-back the apostrophe is stripped by
  // Sheets, so the application sees the user's original string.
  var emp = employees_create_({
    lastName: '=HYPERLINK("http://evil/","x")',
    firstName: '+1 Bob',
    middleName: '',
    email: 'inj@example.com',
    initialTask: '@tag item'
  }, TEST_CTX);
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(TEST_CTX.sheets.EMPLOYEES);
  // The raw cell displays with the sentinel but getValues() returns the
  // user-visible string.
  var lastName = sh.getRange(2, DEFAULT_CONFIG.HEADERS.EMPLOYEES.indexOf('lastName') + 1).getValue();
  var firstName = sh.getRange(2, DEFAULT_CONFIG.HEADERS.EMPLOYEES.indexOf('firstName') + 1).getValue();
  // Verify Sheets did not evaluate it as a formula. If it had, lastName
  // would be the hyperlink text 'x' instead of the original formula source.
  assert_(String(lastName).indexOf('=HYPERLINK') === 0, 'formula not evaluated: ' + lastName);
  assert_(String(firstName).indexOf('+1 Bob') === 0, 'formula-prefixed string preserved: ' + firstName);
  // The initial task row has the same treatment.
  var task = tasks_getActive_(emp.id, TEST_CTX);
  assertEq_(task.title, '@tag item');
}

function test_updateRowThrowsWhenMissing_() {
  assertThrows_(function () {
    updateRow_(TEST_CTX.sheets.SESSIONS, 'id', 'no-such-id', { status: 'paused' }, DEFAULT_CONFIG.HEADERS.SESSIONS);
  }, 'missing row throws');
}

function test_closeSessionRejectsBadStart_() {
  var fake = { id: uuid_(), employeeId: 'e', taskId: 't', startTime: '', endTime: '', durationMs: '', status: 'active' };
  assertThrows_(function () { closeSession_(fake, 'paused', TEST_CTX); }, 'bad startTime rejected');
}

function test_rotateTokenInvalidatesOldLink_() {
  var emp = employees_create_({ lastName: 'A', firstName: 'B', email: 'rot@example.com', initialTask: 'T' }, TEST_CTX);
  var oldToken = emp.workspaceToken;
  var res = employees_rotateToken_(emp.id, TEST_CTX);
  assert_(res.workspaceToken && res.workspaceToken !== oldToken, 'token changed');
  assertEq_(employees_findByToken_(oldToken, TEST_CTX), null, 'old token no longer resolves');
  assert_(employees_findByToken_(res.workspaceToken, TEST_CTX), 'new token resolves');
}

function test_lengthLimitsEnforced_() {
  var longName = new Array(FIELD_LIMITS.lastName + 2).join('A');
  assertThrows_(function () {
    employees_create_({ lastName: longName, firstName: 'B', email: 'ln@example.com', initialTask: 'T' }, TEST_CTX);
  });
}

function test_strictDateParsing_() {
  assertThrows_(function () { reports_generate_('2024-13-01', '2024-13-02', TEST_CTX); }, 'bad month');
  assertThrows_(function () { reports_generate_('2024-02-30', '2024-03-01', TEST_CTX); }, 'invalid day');
  assertThrows_(function () { reports_generate_('Jan 1, 2024', '2024-02-01', TEST_CTX); }, 'non-ISO rejected');
  // A legitimate request still succeeds.
  reports_generate_('2024-01-01', '2024-01-02', TEST_CTX);
}

function test_sumSessionMsFallsBackToTimestamps_() {
  // Closed row missing durationMs: should fall back to endTime - startTime.
  var emp = employees_create_({ lastName: 'A', firstName: 'B', email: 'fb@example.com', initialTask: 'T' }, TEST_CTX);
  var taskId = tasks_getActive_(emp.id, TEST_CTX).id;
  appendRow_(TEST_CTX.sheets.SESSIONS, {
    id: uuid_(), employeeId: emp.id, taskId: taskId,
    startTime: '2026-01-01T10:00:00.000Z', endTime: '2026-01-01T10:15:00.000Z',
    durationMs: '', status: 'paused'
  }, DEFAULT_CONFIG.HEADERS.SESSIONS);
  assertEq_(sessions_totalForTask_(taskId, TEST_CTX), 15 * 60 * 1000, 'computed from endpoints');
}

function test_ensureSheetRefusesToOverwriteDataWithBlankHeaders_() {
  var ss = getSpreadsheet_();
  var name = 'Test_BlankHeaders';
  var existing = ss.getSheetByName(name);
  if (existing) ss.deleteSheet(existing);
  var sheet = ss.insertSheet(name);
  // Explicitly leave header row blank; write a data row below.
  sheet.getRange(2, 1).setValue('data');
  try {
    assertThrows_(function () {
      ensureSheet_(ss, name, DEFAULT_CONFIG.HEADERS.EMPLOYEES);
    }, 'refuses to rewrite blank header above existing data');
  } finally {
    ss.deleteSheet(sheet);
  }
}

// --- demonstration-environment tests (audit F-19..F-24) ----------------------

function test_demoResetClearsOnlyTargetSheets_() {
  var ss = getSpreadsheet_();
  var realBefore = {};
  ['EMPLOYEES', 'TASKS', 'SESSIONS'].forEach(function (k) {
    var s = ss.getSheetByName(DEFAULT_CONFIG.SHEETS[k]);
    realBefore[k] = s ? s.getLastRow() : -1;
  });
  var canaryName = 'Test_Canary';
  var canary = ss.getSheetByName(canaryName) || ss.insertSheet(canaryName);
  try {
    canary.getRange(1, 1).setValue('keep me');
    employees_create_({ lastName: 'Stale', firstName: 'Row', email: 'stale@example.com', initialTask: 'Old' }, TEST_CTX);
    var counts = demo_reset_(TEST_CTX);
    assertEq_(employees_list_(TEST_CTX).length, counts.employees, 'stale employee replaced by seed');
    assertEq_(tasks_list_(TEST_CTX).length, counts.tasks, 'tasks reseeded');
    assertEq_(sessions_list_(TEST_CTX).length, counts.sessions, 'sessions reseeded');
    assertEq_(canary.getRange(1, 1).getValue(), 'keep me', 'unrelated sheet untouched');
    ['EMPLOYEES', 'TASKS', 'SESSIONS'].forEach(function (k) {
      var s = ss.getSheetByName(DEFAULT_CONFIG.SHEETS[k]);
      assertEq_(s ? s.getLastRow() : -1, realBefore[k], 'real ' + k + ' sheet untouched by a Test_* reset');
    });
  } finally {
    ss.deleteSheet(canary);
  }
}

function test_demoSampleLoadsOnlyIntoEmptyDemo_() {
  var first = demo_loadSampleIfEmpty_(TEST_CTX);
  assert_(first.employees >= 2, 'sample created employees');
  var err = assertThrows_(function () { demo_loadSampleIfEmpty_(TEST_CTX); }, 'second load must be refused');
  assert_(err.userSafe === true, 'refusal is a user-facing message');
  assertEq_(employees_list_(TEST_CTX).length, first.employees, 'nothing appended by the refused call');
}

function test_demoSampleReportsMatchSessions_() {
  demo_seed_(TEST_CTX);
  var sessions = sessions_list_(TEST_CTX);
  var expected = 0;
  sessions.forEach(function (s) { expected += s.durationMs; });
  var rows = reports_generate_('2000-01-01', '2100-01-01', TEST_CTX);
  var total = 0;
  rows.forEach(function (r) { total += r.totalMs; });
  assertEq_(total, expected, 'report total equals the sum of stored session durations');
  assertEq_(reports_generate_('2000-01-01', '2000-01-02', TEST_CTX).length, 0, 'empty range -> empty report');
}

function test_demoSampleKeepsTaskHistory_() {
  demo_seed_(TEST_CTX);
  var alex = employees_list_(TEST_CTX).filter(function (e) { return e.firstName === 'Alex'; })[0];
  var before = tasks_forEmployee_(alex.id, TEST_CTX).length;
  var sessionsBefore = sessions_forEmployee_(alex.id, TEST_CTX).length;
  employees_assignTask_(alex.id, 'Brand new task', TEST_CTX);
  assertEq_(tasks_forEmployee_(alex.id, TEST_CTX).length, before + 1, 'task appended, none removed');
  assertEq_(sessions_forEmployee_(alex.id, TEST_CTX).length, sessionsBefore, 'sessions preserved');
}

function test_emailKillSwitchStopsAllSending_() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('EMAIL_DISABLED', 'true');
  try {
    withMailDouble_(function (sent) {
      var emp = newPerson_('qa.kill@corp-demo.io');
      assertEq_(email_sendInvitation_(emp, 'T', 'en', TEST_CTX).status, 'disabled');
      assertEq_(sent.length, 0, 'nothing reaches the sender while the kill switch is on');
      assertEq_(email_capability_().enabled, false);
    });
  } finally {
    props.deleteProperty('EMAIL_DISABLED');
  }
}

function test_adminFunctionsRefuseWhenNotArmed_() {
  // runTests consumed ADMIN_MODE when it started, so it is absent here.
  assertEq_(PropertiesService.getScriptProperties().getProperty('ADMIN_MODE'), null, 'precondition: not armed');
  var guarded = { resetDemoData: resetDemoData, enableOpenAccess: enableOpenAccess, disableOpenAccess: disableOpenAccess, cleanupTestArtifacts: cleanupTestArtifacts };
  Object.keys(guarded).forEach(function (name) {
    var err = assertThrows_(function () { guarded[name](); }, name + ' must refuse while disarmed');
    assert_(/not armed/.test(err.message), name + ' reports it is not armed');
  });
  // Arming is bound to ONE function: a value for another function (or any
  // other string) must not unlock these, and must not be consumed by them.
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_MODE', 'some-other-function');
  try {
    Object.keys(guarded).forEach(function (name) {
      var err = assertThrows_(function () { guarded[name](); }, name + ' must refuse a mismatched arming');
      assert_(/not armed/.test(err.message), name + ' refuses on mismatch');
    });
    assertEq_(props.getProperty('ADMIN_MODE'), 'some-other-function', 'a refused call does not consume the arming');
  } finally {
    props.deleteProperty('ADMIN_MODE');
  }
}

function test_adminArmingIsConsumedOnUse_() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_MODE', 'unit-test-label');
  adminOnly_('unit-test-label');
  assertEq_(props.getProperty('ADMIN_MODE'), null, 'consumed before the operation runs');
  var err = assertThrows_(function () { adminOnly_('unit-test-label'); }, 'second use must refuse');
  assert_(/not armed/.test(err.message), 'second use refused');
}

function test_validationMessagesAreUserSafe_() {
  var err = assertThrows_(function () {
    employees_create_({ lastName: new Array(102).join('x'), firstName: 'A', email: 'a@example.com', initialTask: 'T' }, TEST_CTX);
  }, 'over-long name');
  assert_(err.userSafe === true, 'length error is surfaced verbatim, not as a generic server error');
  var err2 = assertThrows_(function () { reports_generate_('2026-13-01', '2026-13-02', TEST_CTX); }, 'bad date');
  assert_(err2.userSafe === true, 'date error is user-safe');
}

// --- invitations, dashboard, CSV, cleanup (no real mail is ever sent: every test
//     that reaches the delivery step installs the mailSender_ test double) ------

function withMailDouble_(fn, behaviour) {
  var sent = [];
  mailSender_ = function (msg) {
    if (behaviour === 'throw') throw new Error('Service invoked too many times for one day: email.');
    sent.push(msg);
  };
  try { fn(sent); } finally { mailSender_ = null; }
}

function newPerson_(email, first) {
  return employees_create_({ lastName: 'Tester', firstName: first || 'Pat', email: email, initialTask: 'Write the weekly summary' }, TEST_CTX);
}

function test_inviteSentThroughDoubleWithCorrectLink_() {
  withMailDouble_(function (sent) {
    var emp = newPerson_('qa.person@corp-demo.io', 'Анна');
    var res = email_sendInvitation_(emp, 'Write the weekly summary', 'ru', TEST_CTX);
    assertEq_(res.status, 'sent');
    assertEq_(sent.length, 1, 'exactly one message handed to the sender');
    assertEq_(sent[0].to, 'qa.person@corp-demo.io');
    assert_(sent[0].body.indexOf('token=' + emp.workspaceToken) >= 0, 'body carries this employee\'s workspace link');
    assert_(sent[0].body.indexOf('lang=ru') >= 0, 'link carries the language');
    assert_(sent[0].body.indexOf('Анна') >= 0 && sent[0].body.indexOf('Write the weekly summary') >= 0, 'name and task included as plain text');
    assertEq_(/<[a-z]/i.test(sent[0].body), false, 'plain text only');
    assertEq_(invites_latestByEmployee_(TEST_CTX)[emp.id].status, 'sent', 'attempt recorded');
    var logged = JSON.stringify(invites_list_(TEST_CTX));
    assertEq_(logged.indexOf(emp.workspaceToken), -1, 'token never written to the log');
    assertEq_(logged.indexOf('qa.person@corp-demo.io'), -1, 'address not duplicated in the log');
  });
}

function test_inviteFailureKeepsEmployeeAndCanBeRetried_() {
  var emp = newPerson_('qa.retry@corp-demo.io');
  withMailDouble_(function () {
    var res = email_sendInvitation_(emp, 'T', 'en', TEST_CTX);
    assertEq_(res.status, 'failed');
  }, 'throw');
  assertEq_(employees_findById_(emp.id, TEST_CTX).email, 'qa.retry@corp-demo.io', 'employee record preserved');
  assertEq_(invites_latestByEmployee_(TEST_CTX)[emp.id].status, 'failed');
  assertEq_(JSON.stringify(invites_list_(TEST_CTX)).indexOf(emp.workspaceToken), -1, 'no token in the failure detail');
  withMailDouble_(function (sent) {
    assertEq_(email_sendInvitation_(emp, 'T', 'en', TEST_CTX).status, 'sent', 'retry succeeds');
    assertEq_(sent.length, 1);
  });
}

function test_inviteNeverMailsReservedAddresses_() {
  withMailDouble_(function (sent) {
    var emp = newPerson_('someone@example.com');
    assertEq_(email_sendInvitation_(emp, 'T', 'en', TEST_CTX).status, 'skipped_reserved');
    assertEq_(sent.length, 0);
  });
}

function test_inviteDailyAndRecipientLimits_() {
  var cfg = DEMO_CONFIG.EMAIL;
  var saved = { d: cfg.DAILY_LIMIT, r: cfg.PER_RECIPIENT_DAILY };
  try {
    cfg.DAILY_LIMIT = 2; cfg.PER_RECIPIENT_DAILY = 1;
    withMailDouble_(function (sent) {
      var a = newPerson_('qa.a@corp-demo.io'), b = newPerson_('qa.b@corp-demo.io'), c = newPerson_('qa.c@corp-demo.io');
      assertEq_(email_sendInvitation_(a, 'T', 'en', TEST_CTX).status, 'sent');
      assertEq_(email_sendInvitation_(a, 'T', 'en', TEST_CTX).status, 'limit_recipient', 'second mail to the same address refused');
      assertEq_(email_sendInvitation_(b, 'T', 'en', TEST_CTX).status, 'sent');
      assertEq_(email_sendInvitation_(c, 'T', 'en', TEST_CTX).status, 'limit_global', 'global cap reached');
      assertEq_(sent.length, 2, 'only two messages ever reached the sender');
    });
  } finally {
    cfg.DAILY_LIMIT = saved.d; cfg.PER_RECIPIENT_DAILY = saved.r;
  }
}

function test_inviteTextCannotInjectHeadersOrLines_() {
  withMailDouble_(function (sent) {
    var emp = employees_create_({ lastName: 'X', firstName: 'Bob\r\nBcc: attacker@evil.example', email: 'qa.inject@corp-demo.io', initialTask: 'Task\r\nSubject: pwned' }, TEST_CTX);
    email_sendInvitation_(emp, 'Task\r\nSubject: pwned', 'en', TEST_CTX);
    assertEq_(sent.length, 1);
    assertEq_(/\n(Bcc|Subject):/i.test(sent[0].body), false, 'no injected header-looking line');
    assertEq_(sent[0].subject.indexOf('\n'), -1);
  });
}

function test_dashboardAgreesWithReports_() {
  demo_seed_(TEST_CTX);
  var now = Date.now();
  var from = ymdUtc(now - 10 * 86400000), to = ymdUtc(now);
  var d = dashboard_get_(from, to, TEST_CTX);
  var rows = reports_generate_(from, to, TEST_CTX);
  var reportTotal = 0;
  rows.forEach(function (r) { reportTotal += r.totalMs; });
  assertEq_(d.metrics.trackedMs, reportTotal, 'dashboard total equals the report total');
  var dailyTotal = 0;
  d.daily.forEach(function (x) { dailyTotal += x.ms; });
  assertEq_(dailyTotal, reportTotal, 'daily buckets sum to the same total');
  assertEq_(d.daily.length, 11, 'one bucket per UTC day');
  var byEmp = 0;
  d.byEmployee.forEach(function (x) { byEmp += x.ms; });
  assertEq_(byEmp, reportTotal, 'by-employee rows sum to the same total');
  assertEq_([d.metrics.totalEmployees, d.metrics.activeTasks, d.metrics.completedTasks, d.metrics.working, d.metrics.paused].join(','), '2,2,1,0,2');
  var empty = dashboard_get_('2000-01-01', '2000-01-03', TEST_CTX);
  assertEq_(empty.metrics.trackedMs, 0, 'empty period');
  assertEq_(empty.daily.length, 3);
  assertThrows_(function () { dashboard_get_('2000-01-01', '2100-01-01', TEST_CTX); }, 'overlong range refused');
}

function test_dashboardWorkingAndPausedStates_() {
  var emp = newPerson_('qa.state@corp-demo.io');
  var today = ymdUtc(Date.now());
  assertEq_(dashboard_get_(today, today, TEST_CTX).metrics.working, 0);
  sessions_start_(emp.id, TEST_CTX);
  assertEq_(dashboard_get_(today, today, TEST_CTX).metrics.working, 1, 'running timer counts as working');
  sessions_pause_(emp.id, TEST_CTX);
  var m = dashboard_get_(today, today, TEST_CTX).metrics;
  assertEq_([m.working, m.paused].join(','), '0,1', 'paused after pause');
}

function test_csvExportMatchesReportAndNeutralisesFormulas_() {
  demo_seed_(TEST_CTX);
  var evil = employees_create_({ lastName: '=1+1', firstName: '@SUM(A1)', email: 'qa.csv@corp-demo.io', initialTask: '-cmd|calc' }, TEST_CTX);
  var task = tasks_getActive_(evil.id, TEST_CTX);
  var s = new Date(Date.now() - 3600000).toISOString(), e = new Date(Date.now() - 1800000).toISOString();
  appendRow_(TEST_CTX.sheets.SESSIONS, { id: uuid_(), employeeId: evil.id, taskId: task.id, startTime: s, endTime: e, durationMs: 1800000, status: 'paused' }, DEFAULT_CONFIG.HEADERS.SESSIONS);
  var from = ymdUtc(Date.now() - 10 * 86400000), to = ymdUtc(Date.now());
  var res = reports_csv_(from, to, '', 'ru', TEST_CTX);
  var rows = reports_generate_(from, to, TEST_CTX);
  var n = 0;
  rows.forEach(function (r) { n += r.sessions.length; });
  assertEq_(res.rows, n, 'one CSV line per reported session');
  assertEq_(res.csv.split('\r\n').filter(function (l) { return l; }).length, n + 1, 'header + rows');
  assertEq_(res.csv.charCodeAt(0), 0xFEFF, 'BOM for spreadsheet applications');
  assert_(res.csv.indexOf('Сотрудник') >= 0, 'localized header');
  assertEq_(res.csv.indexOf('"=1+1'), -1, 'raw formula not present');
  assert_(res.csv.indexOf('"\'=1+1') >= 0, 'formula neutralised');
  assert_(res.csv.indexOf('"\'-cmd|calc"') >= 0, 'task text neutralised');
  var only = reports_csv_(from, to, evil.id, 'en', TEST_CTX);
  assertEq_(only.rows, 1, 'employee filter respected');
  assertEq_(res.filename, 'working-time-report_' + from + '_' + to + '.csv');
}

function test_cleanupRemovesOnlyAcceptanceArtifacts_() {
  var junk = employees_create_({ lastName: 'Verifier', firstName: 'Demo', email: 'demo.verifier.1700000000000@example.com', initialTask: 'x' }, TEST_CTX);
  var inj = employees_create_({ lastName: '=HYPERLINK("http://evil","x")', firstName: '+1', email: 'inj.verifier@example.com', initialTask: '@cmd' }, TEST_CTX);
  var keep = employees_create_({ lastName: 'Verifier', firstName: 'Keep', email: 'keep.me@corp-demo.io', initialTask: 'real work' }, TEST_CTX);
  var keep2 = employees_create_({ lastName: 'Demo', firstName: 'Verifier', email: 'demo.verifier@example.com', initialTask: 'near miss' }, TEST_CTX);
  [junk, inj, keep].forEach(function (x) {
    var t = tasks_getActive_(x.id, TEST_CTX);
    appendRow_(TEST_CTX.sheets.SESSIONS, { id: uuid_(), employeeId: x.id, taskId: t.id, startTime: '2026-01-01T10:00:00.000Z', endTime: '2026-01-01T10:10:00.000Z', durationMs: 600000, status: 'paused' }, DEFAULT_CONFIG.HEADERS.SESSIONS);
  });
  var removed = demo_cleanup_(TEST_CTX);
  assertEq_(removed.employees, 2);
  assertEq_(removed.tasks, 2);
  assertEq_(removed.sessions, 2);
  var left = employees_list_(TEST_CTX).map(function (x) { return x.email; }).sort();
  assertEq_(left.join('|'), 'demo.verifier@example.com|keep.me@corp-demo.io', 'only the exact fictional patterns were removed');
  assertEq_(sessions_forEmployee_(keep.id, TEST_CTX).length, 1, 'kept employee keeps their sessions');
  assert_(keep2.id, 'near-miss address untouched');
}

function test_cleanupRefusesWhenNotArmed_() {
  var err = assertThrows_(function () { cleanupTestArtifacts(); }, 'cleanupTestArtifacts must refuse while disarmed');
  assert_(/not armed/.test(err.message), 'reports it is not armed');
}

// --- projects, shared task pool, claiming, assignment, comments, activity ---------

function newTask_(mode, title, extra) {
  var status = mode === 'draft' ? 'draft' : (mode === 'pool' ? 'available' : 'active');
  var data = { title: title || 'Pool task', status: status };
  Object.keys(extra || {}).forEach(function (k) { data[k] = extra[k]; });
  return tasks_create_(data, TEST_CTX);
}

function test_poolTaskLifecycleDraftPublishUnpublish_() {
  var t = newTask_('draft', 'Backlog item');
  assertEq_(t.status, 'draft');
  assertEq_(tasks_views_(TEST_CTX, function (x) { return x.status === 'available'; }).length, 0, 'drafts are not in the pool');
  tasks_publish_(t.id, undefined, TEST_CTX);
  assertEq_(tasks_findById_(t.id, TEST_CTX).status, 'available');
  assertThrows_(function () { tasks_publish_(t.id, undefined, TEST_CTX); }, 'a published task cannot be published again');
  tasks_unpublish_(t.id, undefined, TEST_CTX);
  assertEq_(tasks_findById_(t.id, TEST_CTX).status, 'draft');
  var acts = activity_forTask_(t.id, TEST_CTX).map(function (a) { return a.action; });
  assertEq_(acts.join(','), 'published,unpublished', 'every move is audited');
}

function test_claimTaskOnlyOnce_() {
  var a = newPerson_('claim.a@corp-demo.io', 'Ann');
  var b = newPerson_('claim.b@corp-demo.io', 'Ben');
  var t = newTask_('pool', 'Shared work');
  var before = tasks_list_(TEST_CTX).length;
  var claimed = tasks_claim_(t.id, a, TEST_CTX);
  assertEq_(claimed.employeeId, a.id);
  assertEq_(claimed.status, 'active');
  var err = assertThrows_(function () { tasks_claim_(t.id, b, TEST_CTX); }, 'second claim must fail');
  assertEq_(err.userSafe, true);
  assert_(/no longer available/.test(err.message), err.message);
  assertEq_(tasks_findById_(t.id, TEST_CTX).employeeId, a.id, 'owner unchanged by the refused claim');
  assertEq_(tasks_list_(TEST_CTX).length, before, 'no duplicate task row');
  assertThrows_(function () { tasks_claim_(t.id, a, TEST_CTX); }, 'the owner cannot claim it again either');
  assertEq_(activity_forTask_(t.id, TEST_CTX).map(function (x) { return x.action; }).join(','), 'claimed');
}

function test_cannotClaimDraftOrCompletedOrAssignedTasks_() {
  var a = newPerson_('claim.c@corp-demo.io', 'Cy');
  var b = newPerson_('claim.d@corp-demo.io', 'Di');
  var draft = newTask_('draft', 'Not published');
  assertThrows_(function () { tasks_claim_(draft.id, a, TEST_CTX); }, 'draft');
  var mine = newTask_('assign', 'For Di', { employeeId: b.id });
  assertThrows_(function () { tasks_claim_(mine.id, a, TEST_CTX); }, 'assigned to someone else');
  assertThrows_(function () { tasks_claim_('no-such-task', a, TEST_CTX); }, 'unknown task');
}

function test_assignPoolTaskToEmployeeKeepsOneRow_() {
  var a = newPerson_('assign.a@corp-demo.io', 'Ana');
  var b = newPerson_('assign.b@corp-demo.io', 'Bo');
  var t = newTask_('pool', 'Assign me', { priority: 'high', dueDate: '2030-01-01' });
  var rows = tasks_list_(TEST_CTX).length;
  tasks_assign_(t.id, a.id, undefined, TEST_CTX);
  var after = tasks_findById_(t.id, TEST_CTX);
  assertEq_([after.status, after.employeeId, after.priority, after.dueDate].join('|'), 'active|' + a.id + '|high|2030-01-01', 'same row, details kept');
  assertEq_(tasks_list_(TEST_CTX).length, rows, 'no duplicate task');
  assertEq_(tasks_views_(TEST_CTX, function (x) { return x.status === 'available'; }).length, 0, 'left the pool');
  assertThrows_(function () { tasks_claim_(t.id, b, TEST_CTX); }, 'others cannot claim it');
  assertThrows_(function () { tasks_assign_(t.id, b.id, undefined, TEST_CTX); }, 'an owned task cannot be re-assigned');
  assertThrows_(function () { tasks_assign_(t.id, 'ghost', undefined, TEST_CTX); }, 'unknown employee');
  var mine = tasks_forEmployee_(a.id, TEST_CTX).map(function (x) { return x.id; });
  assert_(mine.indexOf(t.id) >= 0, 'appears in the employee\'s tasks');
  assertEq_(activity_forTask_(t.id, TEST_CTX).map(function (x) { return x.action; }).join(','), 'assigned');
}

function test_assignKeepsRecordedWorkOfTheEmployee_() {
  var a = newPerson_('assign.c@corp-demo.io', 'Cat');
  var first = tasks_getActive_(a.id, TEST_CTX);
  sessions_start_(a.id, TEST_CTX, first.id);
  sessions_pause_(a.id, TEST_CTX);
  var pool = newTask_('pool', 'Another');
  tasks_assign_(pool.id, a.id, undefined, TEST_CTX);
  assertEq_(sessions_forTask_(first.id, TEST_CTX).length, 1, 'earlier session intact');
  assertEq_(tasks_findById_(first.id, TEST_CTX).status, 'active', 'earlier task not replaced or closed');
}

function test_transitionTableIsEnforced_() {
  assertEq_(nextTaskStatus('available', 'claim'), 'active');
  assertEq_(nextTaskStatus('active', 'claim'), null);
  assertEq_(nextTaskStatus('completed', 'assign'), null);
  assertEq_(nextTaskStatus('draft', 'complete'), null);
  var e = newPerson_('trans.a@corp-demo.io', 'Tom');
  var done = newTask_('assign', 'Finish me', { employeeId: e.id });
  sessions_finish_(e.id, TEST_CTX, done.id);
  assertEq_(tasks_findById_(done.id, TEST_CTX).status, 'completed');
  assertThrows_(function () { sessions_start_(e.id, TEST_CTX, done.id); }, 'cannot work on a completed task');
  assertThrows_(function () { tasks_assign_(done.id, e.id, undefined, TEST_CTX); }, 'cannot assign a completed task');
  assertThrows_(function () { sessions_finish_(e.id, TEST_CTX, done.id); }, 'cannot finish twice');
}

function test_employeeCannotUseAnotherEmployeesTask_() {
  var a = newPerson_('own.a@corp-demo.io', 'Al');
  var b = newPerson_('own.b@corp-demo.io', 'Bea');
  var bTask = tasks_getActive_(b.id, TEST_CTX);
  var pool = newTask_('pool', 'In the pool');
  [function () { sessions_start_(a.id, TEST_CTX, bTask.id); },
   function () { sessions_finish_(a.id, TEST_CTX, bTask.id); },
   function () { sessions_start_(a.id, TEST_CTX, pool.id); },
   function () { tasks_requireOwned_(bTask.id, a.id, TEST_CTX); },
   function () { comments_add_(tasks_requireOwned_(bTask.id, a.id, TEST_CTX), { type: 'employee', id: a.id, name: 'x' }, 'hi', TEST_CTX); }
  ].forEach(function (fn, i) {
    var err = assertThrows_(fn, 'attempt ' + i + ' must fail');
    assertEq_(err.userSafe, true, 'attempt ' + i + ' reports a user-safe error');
  });
  assertEq_(sessions_forEmployee_(b.id, TEST_CTX).length, 0, 'nothing was recorded for the owner');
  assertEq_(comments_forTask_(bTask.id, TEST_CTX).length, 0, 'no comment was written');
}

function test_oneTimerPerEmployeeAcrossSeveralTasks_() {
  var e = newPerson_('multi.a@corp-demo.io', 'Max');
  var t1 = tasks_getActive_(e.id, TEST_CTX);
  var t2 = newTask_('assign', 'Second', { employeeId: e.id });
  sessions_start_(e.id, TEST_CTX, t1.id);
  assertThrows_(function () { sessions_start_(e.id, TEST_CTX, t2.id); }, 'a second timer must be refused');
  patchSessionStart_(sessions_findActive_(e.id, TEST_CTX).id, 60000);
  sessions_pause_(e.id, TEST_CTX);
  sessions_start_(e.id, TEST_CTX, t2.id);
  var views = tasks_views_(TEST_CTX, function (t) { return t.employeeId === e.id; });
  var v1 = views.filter(function (v) { return v.id === t1.id; })[0], v2 = views.filter(function (v) { return v.id === t2.id; })[0];
  assertEq_([v1.displayStatus, v2.displayStatus].join(','), 'paused,in_progress');
  assert_(v1.trackedMs >= 60000 && v1.trackedMs < 120000, 'time stays with the first task: ' + v1.trackedMs);
  sessions_finish_(e.id, TEST_CTX, t1.id);
  assertEq_(sessions_findActive_(e.id, TEST_CTX).taskId, t2.id, 'finishing task 1 does not stop the timer of task 2');
  assertEq_(tasks_findById_(t1.id, TEST_CTX).status, 'completed');
}

function test_derivedStatusAndOverdue_() {
  var e = newPerson_('derive.a@corp-demo.io', 'Dee');
  var t = newTask_('assign', 'Dated', { employeeId: e.id, dueDate: '2000-01-01' });
  function view() { return tasks_views_(TEST_CTX, function (x) { return x.id === t.id; })[0]; }
  assertEq_([view().displayStatus, view().overdue].join(','), 'assigned,true', 'past deadline is overdue');
  sessions_start_(e.id, TEST_CTX, t.id);
  assertEq_(view().displayStatus, 'in_progress');
  sessions_pause_(e.id, TEST_CTX);
  assertEq_(view().displayStatus, 'paused');
  sessions_finish_(e.id, TEST_CTX, t.id);
  assertEq_([view().displayStatus, view().overdue].join(','), 'completed,false', 'finished tasks are never overdue');
  assertEq_(newTask_('pool', 'Far future', { dueDate: '2999-12-31' }).dueDate, '2999-12-31');
  assertThrows_(function () { newTask_('pool', 'Bad date', { dueDate: '2026-02-30' }); }, 'impossible date');
  assertThrows_(function () { newTask_('pool', 'Bad priority', { priority: 'urgent' }); }, 'unknown priority');
}

function test_commentsAreOwnedAppendOnlyAndVisibleToTheManager_() {
  var e = newPerson_('com.a@corp-demo.io', 'Eve');
  var o = newPerson_('com.b@corp-demo.io', 'Oli');
  var t = tasks_getActive_(e.id, TEST_CTX);
  comments_add_(tasks_requireOwned_(t.id, e.id, TEST_CTX), { type: 'employee', id: e.id, name: 'Eve Tester' }, '=SUM(1+1) <b>x</b>', TEST_CTX);
  comments_add_(t, { type: 'manager', id: '' }, 'Thanks, please continue.', TEST_CTX);
  var list = comments_forTask_(t.id, TEST_CTX);
  assertEq_(list.length, 2);
  assertEq_([list[0].authorType, list[0].authorId, list[0].authorName].join('|'), 'employee|' + e.id + '|Eve Tester');
  assertEq_(list[0].text, '=SUM(1+1) <b>x</b>', 'stored as text and read back unchanged');
  assertEq_([list[1].authorType, list[1].authorId].join('|'), 'manager|', 'manager replies are visible in the same thread');
  assertThrows_(function () { comments_add_(t, { type: 'manager' }, '   ', TEST_CTX); }, 'empty comment');
  assertThrows_(function () { comments_add_(t, { type: 'manager' }, new Array(1002).join('x'), TEST_CTX); }, 'too long');
  assertThrows_(function () { tasks_requireOwned_(t.id, o.id, TEST_CTX); }, 'another employee cannot comment');
  assertEq_(activity_forTask_(t.id, TEST_CTX).filter(function (a) { return a.action === 'commented'; }).length, 2, 'comments are audited');
}

function test_dashboardStatusCountsAndProjectTimeReconcile_() {
  demo_seed_(TEST_CTX);
  var now = Date.now();
  var from = ymdUtc(now - 10 * 86400000), to = ymdUtc(now);
  var d = dashboard_get_(from, to, TEST_CTX);
  var m = d.metrics, c = m.tasksByStatus;
  var sum = 0;
  Object.keys(c).forEach(function (k) { sum += c[k]; });
  assertEq_(sum, m.totalTasks, 'status buckets add up to the number of tasks');
  assertEq_(m.totalTasks, tasks_list_(TEST_CTX).length, 'and to the task rows');
  assertEq_([c.draft, c.available, c.paused, c.completed, c.replaced].join(','), '1,3,2,1,1', 'sample distribution');
  assertEq_(m.overdueTasks, 1, 'one overdue task in the sample');
  var byProject = 0;
  d.byProject.forEach(function (p) { byProject += p.ms; });
  assertEq_(byProject, m.trackedMs, 'time by project adds up to the tracked time');
  var load = 0;
  d.workload.forEach(function (w) { load += w.ms; });
  assertEq_(load, m.trackedMs, 'workload adds up to the tracked time');
  assert_(d.recentActivity.length > 0 && d.recentComments.length > 0, 'real activity and comments are listed');
}

function test_tasksSheetGainsNewColumnsWithoutTouchingData_() {
  var ss = getSpreadsheet_();
  var name = 'Test_Migrate';
  var old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);
  var sheet = ss.insertSheet(name);
  try {
    var legacy = DEFAULT_CONFIG.HEADERS.TASKS.slice(0, 6);
    sheet.getRange(1, 1, 1, 6).setValues([legacy]);
    sheet.getRange(2, 1, 1, 6).setValues([['id-1', 'emp-1', 'Old task', 'active', '2026-01-01T00:00:00.000Z', '']]);
    ensureSheet_(ss, name, DEFAULT_CONFIG.HEADERS.TASKS);
    ensureSheet_(ss, name, DEFAULT_CONFIG.HEADERS.TASKS); // idempotent
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    assertEq_(header.join(','), DEFAULT_CONFIG.HEADERS.TASKS.join(','), 'new columns appended in canonical order, once');
    assertEq_(sheet.getRange(2, 1, 1, 4).getValues()[0].join('|'), 'id-1|emp-1|Old task|active', 'existing row untouched');
  } finally {
    ss.deleteSheet(sheet);
  }
}

function test_projectsRequireUniqueNames_() {
  var p = projects_create_({ name: 'Alpha', description: 'first' }, TEST_CTX);
  assertThrows_(function () { projects_create_({ name: ' alpha ' }, TEST_CTX); }, 'duplicate name (case-insensitive)');
  assertThrows_(function () { projects_create_({ name: '' }, TEST_CTX); }, 'empty name');
  assertThrows_(function () { newTask_('pool', 'Orphan', { projectId: 'no-such-project' }); }, 'unknown project');
  assertEq_(newTask_('pool', 'In Alpha', { projectId: p.id }).projectId, p.id);
}
