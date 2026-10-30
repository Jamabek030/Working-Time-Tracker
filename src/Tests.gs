// Integration tests. Run from the Apps Script editor by selecting runTests()
// and clicking Run. Tests write to dedicated Test_* sheets, so production data
// in the Employees/Tasks/WorkSessions sheets is never touched.

var TEST_CTX = {
  sheets: {
    EMPLOYEES: 'Test_Employees',
    TASKS: 'Test_Tasks',
    SESSIONS: 'Test_WorkSessions'
  },
  headers: DEFAULT_CONFIG.HEADERS
};

function runTests() {
  var tests = [
    test_createEmployeeAndLink,
    test_assignTask,
    test_startPauseResume,
    test_crossDayNoOvernight,
    test_sumAcrossSessions,
    test_reloadRestoresState,
    test_noDuplicateActiveTimer,
    test_changeTaskPreservesHistory,
    test_reportFiltersByRange,
    test_emptyReport,
    test_invalidInputsRejected,
    test_pauseWithNoActiveSessionRejected
  ];

  // Create test sheets once; rows are cleared between tests.
  setupSheets(TEST_CTX);

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

function patchSessionStart_(sessionId, msBefore) {
  var past = new Date(Date.now() - msBefore).toISOString();
  updateRow_(TEST_CTX.sheets.SESSIONS, 'id', sessionId, { startTime: past }, DEFAULT_CONFIG.HEADERS.SESSIONS);
}

function test_createEmployeeAndLink() {
  var emp = employees_create({
    lastName: 'Smith', firstName: 'John', middleName: '', email: 'john@example.com', initialTask: 'Write docs'
  }, TEST_CTX);
  assert_(emp.id, 'has id');
  assert_(emp.workspaceToken && emp.workspaceToken.length >= 20, 'has token of reasonable length');
  var list = employees_list(TEST_CTX);
  assertEq_(list.length, 1, 'one employee row');
  var t = tasks_getActive(emp.id, TEST_CTX);
  assert_(t, 'initial task created');
  assertEq_(t.title, 'Write docs');
  // Token lookup works.
  var found = employees_findByToken(emp.workspaceToken, TEST_CTX);
  assert_(found, 'can find by token');
  assertEq_(found.email, 'john@example.com');
}

function test_assignTask() {
  var emp = employees_create({ lastName: 'A', firstName: 'B', email: 'at@example.com', initialTask: 'T1' }, TEST_CTX);
  var oldActive = tasks_getActive(emp.id, TEST_CTX);
  var newTask = employees_assignTask(emp.id, 'T2', TEST_CTX);
  var active = tasks_getActive(emp.id, TEST_CTX);
  assertEq_(active.id, newTask.id, 'new task is active');
  var all = tasks_forEmployee(emp.id, TEST_CTX);
  assertEq_(all.length, 2, 'two tasks total');
  var replaced = null;
  for (var i = 0; i < all.length; i++) if (all[i].id === oldActive.id) replaced = all[i];
  assert_(replaced, 'old task still present');
  assertEq_(replaced.status, 'replaced', 'old task marked replaced');
}

function test_startPauseResume() {
  var emp = employees_create({ lastName: 'A', firstName: 'B', email: 'spr@example.com', initialTask: 'T1' }, TEST_CTX);
  var s1 = sessions_start(emp.id, TEST_CTX);
  patchSessionStart_(s1.id, 2000);
  var p1 = sessions_pause(emp.id, TEST_CTX);
  assertEq_(p1.status, 'paused');
  assert_(Number(p1.durationMs) >= 2000, 'closed session duration >= 2000ms');

  // Pausing again fails.
  var threw = false;
  try { sessions_pause(emp.id, TEST_CTX); } catch (e) { threw = true; }
  assert_(threw, 'cannot pause with no active session');

  var s2 = sessions_resume(emp.id, TEST_CTX);
  assert_(s2.id !== s1.id, 'resume creates a NEW session row');
  var all = sessions_forEmployee(emp.id, TEST_CTX);
  assertEq_(all.length, 2, 'two sessions after resume');
}

function test_crossDayNoOvernight() {
  var emp = employees_create({ lastName: 'A', firstName: 'B', email: 'xday@example.com', initialTask: 'T1' }, TEST_CTX);
  var taskId = tasks_getActive(emp.id, TEST_CTX).id;
  // Simulate: yesterday 23:00 -> 23:30 (30 minutes). Insert directly.
  var yesterday23 = new Date(Date.now() - 25 * 3600 * 1000);
  var yesterday2330 = new Date(yesterday23.getTime() + 30 * 60 * 1000);
  appendRow_(TEST_CTX.sheets.SESSIONS, {
    id: uuid_(), employeeId: emp.id, taskId: taskId,
    startTime: yesterday23.toISOString(), endTime: yesterday2330.toISOString(),
    durationMs: 30 * 60 * 1000, status: 'paused'
  }, DEFAULT_CONFIG.HEADERS.SESSIONS);
  // Today: 10-minute session.
  var s2 = sessions_resume(emp.id, TEST_CTX);
  patchSessionStart_(s2.id, 10 * 60 * 1000);
  sessions_pause(emp.id, TEST_CTX);

  var total = sessions_totalForTask(taskId, TEST_CTX);
  // Expected ~40 minutes; definitely NOT ~24h.
  assert_(total >= (40 * 60 * 1000) - 3000 && total <= (40 * 60 * 1000) + 3000,
    'total ~= 40 min, got ' + total + ' ms');
}

function test_sumAcrossSessions() {
  var emp = employees_create({ lastName: 'A', firstName: 'B', email: 'sum@example.com', initialTask: 'T1' }, TEST_CTX);
  var taskId = tasks_getActive(emp.id, TEST_CTX).id;
  [10000, 20000, 30000].forEach(function (d) {
    var now = Date.now();
    appendRow_(TEST_CTX.sheets.SESSIONS, {
      id: uuid_(), employeeId: emp.id, taskId: taskId,
      startTime: new Date(now - d - 1000).toISOString(),
      endTime: new Date(now - 1000).toISOString(),
      durationMs: d, status: 'paused'
    }, DEFAULT_CONFIG.HEADERS.SESSIONS);
  });
  assertEq_(sessions_totalForTask(taskId, TEST_CTX), 60000, 'sum of durations');
}

function test_reloadRestoresState() {
  var emp = employees_create({ lastName: 'A', firstName: 'B', email: 'rel@example.com', initialTask: 'T1' }, TEST_CTX);
  sessions_start(emp.id, TEST_CTX);
  // Simulate "reload": re-read everything with no in-memory cache.
  var active = sessions_findActive(emp.id, TEST_CTX);
  assert_(active, 'active session still present after fresh read');
  var task = tasks_getActive(emp.id, TEST_CTX);
  assert_(task, 'active task still present after fresh read');
}

function test_noDuplicateActiveTimer() {
  var emp = employees_create({ lastName: 'A', firstName: 'B', email: 'dup@example.com', initialTask: 'T1' }, TEST_CTX);
  sessions_start(emp.id, TEST_CTX);
  var threw = false;
  try { sessions_start(emp.id, TEST_CTX); } catch (e) { threw = true; }
  assert_(threw, 'second start rejected');
  var active = sessions_forEmployee(emp.id, TEST_CTX).filter(function (s) { return s.status === 'active'; });
  assertEq_(active.length, 1, 'exactly one active session');
}

function test_changeTaskPreservesHistory() {
  var emp = employees_create({ lastName: 'A', firstName: 'B', email: 'chg@example.com', initialTask: 'T1' }, TEST_CTX);
  var task1Id = tasks_getActive(emp.id, TEST_CTX).id;
  var s = sessions_start(emp.id, TEST_CTX);
  patchSessionStart_(s.id, 5000);
  employees_assignTask(emp.id, 'T2', TEST_CTX);
  var sessions = sessions_forEmployee(emp.id, TEST_CTX);
  assertEq_(sessions.length, 1, 'session row still exists');
  assertEq_(sessions[0].taskId, task1Id, 'session is still linked to original task');
  assertEq_(sessions[0].status, 'paused', 'session was auto-closed');
  var oldTotal = sessions_totalForTask(task1Id, TEST_CTX);
  assert_(oldTotal >= 5000, 'original task retains its elapsed time (' + oldTotal + ')');
  var newTaskId = tasks_getActive(emp.id, TEST_CTX).id;
  assertEq_(sessions_totalForTask(newTaskId, TEST_CTX), 0, 'new task starts at zero');
}

function test_reportFiltersByRange() {
  var emp = employees_create({ lastName: 'A', firstName: 'B', email: 'rep@example.com', initialTask: 'T1' }, TEST_CTX);
  var taskId = tasks_getActive(emp.id, TEST_CTX).id;
  var now = Date.now();
  // Today, 10 minutes.
  appendRow_(TEST_CTX.sheets.SESSIONS, {
    id: uuid_(), employeeId: emp.id, taskId: taskId,
    startTime: new Date(now - 10 * 60000).toISOString(),
    endTime: new Date(now).toISOString(),
    durationMs: 10 * 60000, status: 'paused'
  }, DEFAULT_CONFIG.HEADERS.SESSIONS);
  // 10 days ago, 20 minutes.
  appendRow_(TEST_CTX.sheets.SESSIONS, {
    id: uuid_(), employeeId: emp.id, taskId: taskId,
    startTime: new Date(now - 10 * 86400000 - 20 * 60000).toISOString(),
    endTime: new Date(now - 10 * 86400000).toISOString(),
    durationMs: 20 * 60000, status: 'paused'
  }, DEFAULT_CONFIG.HEADERS.SESSIONS);
  var yStr = toYmd_(new Date(now - 86400000));
  var tStr = toYmd_(new Date(now));
  var rep = reports_generate(yStr, tStr, TEST_CTX);
  assertEq_(rep.length, 1, 'one employee in report');
  var tolerance = 3000;
  assert_(Math.abs(rep[0].totalMs - 10 * 60000) <= tolerance, 'approx 10 min in range, got ' + rep[0].totalMs);
}

function toYmd_(d) {
  var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

function test_emptyReport() {
  var today = toYmd_(new Date());
  var rep = reports_generate(today, today, TEST_CTX);
  assertEq_(rep.length, 0, 'empty report returns an empty array');
}

function test_invalidInputsRejected() {
  var errs = 0;
  function tryIt(fn) { try { fn(); } catch (e) { errs++; } }
  tryIt(function () { employees_create({}, TEST_CTX); });
  tryIt(function () { employees_create({ lastName: 'A' }, TEST_CTX); });
  tryIt(function () { employees_create({ lastName: 'A', firstName: 'B', email: 'not-an-email', initialTask: 'T' }, TEST_CTX); });
  tryIt(function () { employees_create({ lastName: 'A', firstName: 'B', email: 'a@b.com', initialTask: '' }, TEST_CTX); });
  employees_create({ lastName: 'A', firstName: 'B', email: 'dupe@example.com', initialTask: 'T' }, TEST_CTX);
  tryIt(function () { employees_create({ lastName: 'A', firstName: 'C', email: 'dupe@example.com', initialTask: 'T2' }, TEST_CTX); });
  tryIt(function () { reports_generate('2024-05-01', '2024-04-01', TEST_CTX); });
  assertEq_(errs, 6, 'all six invalid cases rejected');
}

function test_pauseWithNoActiveSessionRejected() {
  var emp = employees_create({ lastName: 'A', firstName: 'B', email: 'nap@example.com', initialTask: 'T1' }, TEST_CTX);
  var threw = false;
  try { sessions_pause(emp.id, TEST_CTX); } catch (e) { threw = true; }
  assert_(threw, 'pause with no active session must throw');
}
