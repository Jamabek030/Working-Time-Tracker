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
    SESSIONS: 'Test_WorkSessions'
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
    test_demoEmailIsHardDisabled_,
    test_adminFunctionsRefuseWhenNotArmed_,
    test_adminArmingIsConsumedOnUse_,
    test_validationMessagesAreUserSafe_
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
  [TEST_CTX.sheets.EMPLOYEES, TEST_CTX.sheets.TASKS, TEST_CTX.sheets.SESSIONS].forEach(function (name) {
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

function test_demoEmailIsHardDisabled_() {
  if (!DEMO_CONFIG.ENABLED) return;
  var err = assertThrows_(function () {
    email_sendInvitation_({ email: 'victim@example.com', firstName: 'X', workspaceToken: 'abc' }, 'T');
  }, 'demo build must not send mail');
  assert_(/disabled/i.test(err.message), 'explains that email is disabled');
}

function test_adminFunctionsRefuseWhenNotArmed_() {
  // runTests consumed ADMIN_MODE when it started, so it is absent here.
  assertEq_(PropertiesService.getScriptProperties().getProperty('ADMIN_MODE'), null, 'precondition: not armed');
  var guarded = { resetDemoData: resetDemoData, enableOpenAccess: enableOpenAccess, disableOpenAccess: disableOpenAccess };
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
