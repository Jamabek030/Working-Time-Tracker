// SIMULATED Apps Script runs. The real src/*.gs files execute against the
// in-memory services in tests/gas-sim.js. This verifies the code's logic and
// its use of the services; it does NOT replace running `runTests` in a real
// Apps Script project (see README "Test results").
const { createEnv } = require('./gas-sim');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + (msg || '')); }
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Expected ' + JSON.stringify(a) + ' to equal ' + JSON.stringify(b) + (msg ? ' - ' + msg : ''));
}
function throwsMsg(fn) { try { fn(); } catch (e) { return String(e && e.message); } throw new Error('Expected call to throw'); }
const EXPECTED_INTEGRATION_TESTS = (require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'Tests.gs'), 'utf8').match(/^function test_/gm) || []).length;
const APP_SHEETS = ['Employees', 'Tasks', 'WorkSessions'];
const appSheetNames = env => APP_SHEETS.filter(n => env.ss.getSheetByName(n));

// --- the real integration suite, simulated -----------------------------------

test('sim: runTests runs every integration test and all pass', () => {
  const env = createEnv();
  env.arm('runTests');
  const res = env.ctx.runTests();
  const failed = res.results.filter(r => !r.ok);
  assertEq(failed.map(f => f.name + ' -- ' + f.error), [], 'failing tests');
  assertEq([res.total, res.passed], [EXPECTED_INTEGRATION_TESTS, EXPECTED_INTEGRATION_TESTS]);
  assert(env.log.logger.some(l => l.indexOf(EXPECTED_INTEGRATION_TESTS + '/' + EXPECTED_INTEGRATION_TESTS + ' passed') >= 0), 'summary line logged');
});

test('sim: runTests consumes its arming, touches only Test_* sheets, never mails, opens only the pinned id', () => {
  const env = createEnv();
  env.arm('runTests');
  env.ctx.runTests();
  assertEq(env.props.has('ADMIN_MODE'), false, 'arming consumed');
  assertEq(appSheetNames(env), [], 'no real application sheet created or written');
  env.ss.sheets.forEach((s, name) => assert(/^Test_/.test(name), 'unexpected sheet ' + name));
  assertEq(env.log.mail.length, 0, 'no email');
  assertEq(Array.from(new Set(env.log.opened)), ['SIM-PINNED-ID'], 'only the pinned spreadsheet is opened');
  assertEq(env.other.sheets.size, 0, 'unrelated spreadsheet untouched');
});

test('sim: runTests refuses when disarmed or armed for another function, and creates nothing', () => {
  const env = createEnv();
  assert(/not armed/.test(throwsMsg(() => env.ctx.runTests())));
  env.arm('resetDemoData');
  assert(/not armed/.test(throwsMsg(() => env.ctx.runTests())));
  assertEq(env.props.get('ADMIN_MODE'), 'resetDemoData', 'mismatched arming is not consumed');
  assertEq(env.ss.sheets.size, 0, 'no sheets created');
});

// --- admin guard ------------------------------------------------------------

test('sim: arming is bound to one function (each admin function refuses the others\' arming)', () => {
  const names = ['resetDemoData', 'enableOpenAccess', 'disableOpenAccess', 'runTests'];
  names.forEach(armed => {
    names.filter(n => n !== armed).forEach(called => {
      const env = createEnv();
      env.arm(armed);
      assert(/not armed/.test(throwsMsg(() => env.ctx[called]())), armed + ' must not unlock ' + called);
      assertEq(env.props.get('ADMIN_MODE'), armed, 'still armed for ' + armed);
    });
  });
});

test('sim: arming is consumed BEFORE the operation, so a failing operation does not stay armed', () => {
  const env = createEnv({ title: 'Payroll 2026' }); // not a demo workbook -> resetDemoData must refuse
  env.arm('resetDemoData');
  assert(/not a verified demonstration/.test(throwsMsg(() => env.ctx.resetDemoData())));
  assertEq(env.props.has('ADMIN_MODE'), false, 'consumed even though the operation failed');
  assertEq(env.ss.sheets.size, 0, 'nothing written to the non-demo workbook');
  assert(/not armed/.test(throwsMsg(() => env.ctx.resetDemoData())), 'cannot be replayed');
});

test('sim: admin check is skipped-safe under lock contention and the lock is always released', () => {
  const env = createEnv();
  env.arm('resetDemoData');
  env.holdLockExternally(true);
  assert(/try again/.test(throwsMsg(() => env.ctx.resetDemoData())), 'contended call is refused');
  assertEq(env.props.get('ADMIN_MODE'), 'resetDemoData', 'still armed: a refused-by-contention call consumes nothing');
  assertEq(env.isLockHeld(), false, 'this caller never holds the lock');
  env.holdLockExternally(false);
  env.ctx.resetDemoData();
  assertEq(env.props.has('ADMIN_MODE'), false);
  assertEq(env.isLockHeld(), false, 'lock released after the run');
  const acq = env.log.lockEvents.filter(e => e === 'acquire').length;
  const rel = env.log.lockEvents.filter(e => e === 'release').length;
  assertEq(acq, rel, 'every acquire has a release');
});

test('sim: of two sequential callers racing for one arming, exactly one wins', () => {
  const env = createEnv();
  env.arm('resetDemoData');
  const outcomes = [0, 1].map(() => { try { env.ctx.resetDemoData(); return 'ran'; } catch (e) { return 'refused'; } });
  assertEq(outcomes, ['ran', 'refused']);
});

test('sim: no admin or API function can create or change Script Properties other than the documented ones', () => {
  const env = createEnv({ noActive: true });
  env.arm('resetDemoData');
  env.ctx.resetDemoData();
  env.ctx.api_listEmployees();
  env.ctx.api_createEmployee({ lastName: 'A', firstName: 'B', email: 'a@example.com', initialTask: 'T' });
  assertEq(env.log.propWrites, [], 'no property was ever written by app operations');
});

// --- reset isolation --------------------------------------------------------

test('sim: resetDemoData clears and reseeds exactly Employees/Tasks/WorkSessions and nothing else', () => {
  const env = createEnv();
  const note = env.ss.insertSheet('Notes'); note.getRange(1, 1).setValue('keep'); note.getRange(5, 3).setValue('keep too');
  env.ctx.setupSheets_();
  env.ctx.api_createEmployee({ lastName: 'Stale', firstName: 'Row', email: 'stale@example.com', initialTask: 'Old' });
  env.arm('resetDemoData');
  const counts = env.ctx.resetDemoData();
  assertEq(counts, { employees: 2, tasks: 4, sessions: 8 });
  const emps = env.ctx.employees_list_();
  assertEq(emps.map(e => e.email).sort(), ['alex.rivera@example.com', 'sam.nguyen@example.com']);
  assertEq(note.getRange(1, 1).getValue(), 'keep');
  assertEq(note.getRange(5, 3).getValue(), 'keep too');
  assertEq(Array.from(new Set(env.log.opened)), ['SIM-PINNED-ID']);
  assertEq(env.other.sheets.size, 0);
  assertEq(env.log.mail.length, 0);
});

// --- public API behaviour under the demo configuration -----------------------

const API_CALLS = {
  api_listEmployees: [], api_createEmployee: [{ lastName: 'A', firstName: 'B', email: 'a@example.com', initialTask: 'T' }],
  api_loadDemoSample: [], api_getEmployeeDetails: ['x'], api_assignTask: ['x', 't'], api_rotateWorkspaceToken: ['x'],
  api_generateReport: ['2026-01-01', '2026-01-02'], api_getEmployeeState: ['tok'], api_startSession: ['tok'],
  api_pauseSession: ['tok'], api_resumeSession: ['tok'], api_finishTask: ['tok']
};

test('sim: on a workbook whose title is not test/demo, every api_* refuses before touching any sheet', () => {
  const env = createEnv({ title: 'Payroll 2026' });
  Object.keys(API_CALLS).forEach(n => {
    const m = throwsMsg(() => env.ctx[n].apply(null, API_CALLS[n]));
    assert(/unavailable/.test(m), n + ' -> ' + m);
  });
  assertEq(env.ss.sheets.size, 0, 'no sheet was created or written');
  assertEq(env.log.mail.length, 0);
});

test('sim: doGet on a non-demo workbook shows the fixed notice and creates no sheets', () => {
  const env = createEnv({ title: 'Payroll 2026' });
  const out = env.ctx.doGet({ parameter: {} });
  assert(/Demo unavailable/.test(out.html), 'locked notice shown');
  assert(!/Payroll/.test(out.html), 'workbook title is not echoed');
  assertEq(env.ss.sheets.size, 0, 'no sheets created before the access check');
});

test('sim: doGet on the demo workbook serves the manager page; a bad token is a generic error', () => {
  const env = createEnv();
  assertEq(env.ctx.doGet({ parameter: {} }).name, 'manager');
  const bad = env.ctx.doGet({ parameter: { page: 'employee', token: 'nope' } });
  assert(/Invalid workspace link/.test(bad.html));
});

test('sim: setup failure text is never shown to the visitor', () => {
  const env = createEnv();
  const s = env.ss.insertSheet('Employees'); s.getRange(2, 1).setValue('data below a blank header');
  const out = env.ctx.doGet({ parameter: {} });
  assert(/could not initialise/.test(out.html), 'fixed message');
  assert(!/blank headers|Employees/.test(out.html), 'internal detail not leaked');
});

test('sim: list never returns tokens or ids of sheets; it carries work state and invitation status', () => {
  const env = createEnv();
  env.ctx.api_createEmployee({ lastName: 'Doe', firstName: 'Ann', email: 'ann@example.org', initialTask: 'T', sendInvite: false });
  const list = env.ctx.api_listEmployees();
  assertEq(Object.keys(list[0]).sort(), ['active', 'createdAt', 'email', 'firstName', 'hasActiveSession', 'id', 'invite', 'lastName', 'middleName', 'totalMs', 'workState']);
  assertEq([list[0].workState, list[0].invite.status], ['idle', 'not_requested']);
  assert(!JSON.stringify(list).includes('SIM-PINNED-ID'), 'no spreadsheet id in responses');
  assert(!/[0-9a-f]{40}/.test(JSON.stringify(list)), 'no token-like value in the list');
});

// --- invitations through the real API path with a recording fake MailApp ---------

const REAL = { lastName: 'Doe', firstName: 'Ann', email: 'ann.real@corp-demo.io', initialTask: 'Prepare slides', lang: 'en' };

test('sim: invitation is mailed to a real-looking address with the correct workspace link, and recorded', () => {
  const env = createEnv();
  const r = env.ctx.api_createEmployee(REAL);
  assertEq(r.invite.status, 'sent');
  assertEq(env.log.mail.length, 1);
  const m = env.log.mail[0];
  assertEq(m.to, 'ann.real@corp-demo.io');
  const emp = env.ctx.employees_list_()[0];
  assert(m.body.includes('page=employee&token=' + emp.workspaceToken), 'link carries this employee\'s token');
  assert(m.body.includes('&lang=en'));
  assertEq(m.noReply, true);
  assert(!/<[a-z]/i.test(m.body), 'plain text');
  assertEq(env.ctx.api_listEmployees()[0].invite.status, 'sent');
  const logged = JSON.stringify(env.ctx.invites_list_());
  assert(!logged.includes(emp.workspaceToken) && !logged.includes('ann.real@corp-demo.io'), 'log holds neither the token nor the address');
  assert(!JSON.stringify(r).includes(emp.workspaceToken), 'create response does not echo the token');
});

test('sim: the Russian invitation is written in Russian and links with lang=ru', () => {
  const env = createEnv();
  env.ctx.api_createEmployee(Object.assign({}, REAL, { lang: 'ru' }));
  assert(/Здравствуйте/.test(env.log.mail[0].body) && env.log.mail[0].body.includes('&lang=ru'));
});

test('sim: a failing mail service keeps the employee, reports failed, and Retry succeeds', () => {
  const env = createEnv({ mailFails: true });
  const r = env.ctx.api_createEmployee(REAL);
  assertEq(r.invite.status, 'failed');
  assertEq(env.ctx.employees_list_().length, 1, 'employee kept');
  assertEq(env.ctx.api_listEmployees()[0].invite.status, 'failed');
  env.ctx.MailApp.sendEmail = m => { env.log.mail.push(m); }; // service recovers
  const id = env.ctx.employees_list_()[0].id;
  assertEq(env.ctx.api_resendInvitation(id, 'en').status, 'sent');
  assertEq(env.log.mail.length, 1);
});

test('sim: without the mail permission the app reports not authorized and still creates the employee', () => {
  const env = createEnv({ noMailScope: true });
  assertEq(env.ctx.api_getAppInfo().email, { enabled: true, available: false, remaining: 0 });
  const r = env.ctx.api_createEmployee(REAL);
  assertEq(r.invite.status, 'unavailable');
  assertEq(env.ctx.employees_list_().length, 1);
  assertEq(env.log.mail.length, 0);
});

test('sim: reserved example addresses and un-ticked invitations never reach MailApp', () => {
  const env = createEnv();
  assertEq(env.ctx.api_createEmployee({ lastName: 'A', firstName: 'B', email: 'a@example.com', initialTask: 'T' }).invite.status, 'skipped_reserved');
  assertEq(env.ctx.api_createEmployee({ lastName: 'A', firstName: 'C', email: 'c@x.example.org', initialTask: 'T' }).invite.status, 'skipped_reserved');
  assertEq(env.ctx.api_createEmployee(Object.assign({}, REAL, { sendInvite: false })).invite.status, 'not_requested');
  assertEq(env.log.mail.length, 0);
});

test('sim: daily and per-recipient limits stop mail; the kill switch property stops everything', () => {
  const env = createEnv();
  env.ctx.DEMO_CONFIG.EMAIL.DAILY_LIMIT = 2;
  const mk = (n) => env.ctx.api_createEmployee({ lastName: 'L' + n, firstName: 'F', email: 'p' + n + '@corp-demo.io', initialTask: 'T' }).invite.status;
  assertEq([mk(1), mk(2), mk(3)], ['sent', 'sent', 'limit_global']);
  assertEq(env.log.mail.length, 2);
  env.ctx.DEMO_CONFIG.EMAIL.DAILY_LIMIT = 50;
  const id = env.ctx.employees_list_()[0].id;
  assertEq(env.ctx.api_resendInvitation(id, 'en').status, 'sent');
  assertEq(env.ctx.api_resendInvitation(id, 'en').status, 'limit_recipient');
  env.props.set('EMAIL_DISABLED', 'true');
  assertEq(env.ctx.api_resendInvitation(env.ctx.employees_list_()[1].id, 'en').status, 'disabled');
  assertEq(env.ctx.api_getAppInfo().email.enabled, false);
  assertEq(env.log.mail.length, 3);
});

test('sim: invitation text cannot inject mail headers or extra lines', () => {
  const env = createEnv();
  env.ctx.api_createEmployee({ lastName: 'X', firstName: 'Bob\r\nBcc: evil@corp-demo.io', email: 'inj@corp-demo.io', initialTask: 'T\r\nSubject: pwned' });
  const m = env.log.mail[0];
  assert(!/\n(Bcc|Subject):/i.test(m.body) && m.subject.indexOf('\n') < 0);
  assertEq(m.to, 'inj@corp-demo.io');
});

test('sim: resendInvitation refuses unknown ids with a coded, translatable error', () => {
  const env = createEnv();
  const m = throwsMsg(() => env.ctx.api_resendInvitation('nope', 'en'));
  assert(/@@employee_not_found@@/.test(m), m);
});

// --- error codes, dashboard, CSV -----------------------------------------------

test('sim: server errors reach the browser as @@code@@params@@English so the UI can translate them', () => {
  const env = createEnv();
  assert(/^@@too_long@@\{"field":"lastName","limit":"100"\}@@Last name is too long/.test(throwsMsg(() => env.ctx.api_createEmployee({ lastName: 'x'.repeat(101), firstName: 'F', email: 'a@b.co', initialTask: 'T' }))));
  assert(/^@@invalid_link@@/.test(throwsMsg(() => env.ctx.api_getEmployeeState('nope'))));
  assert(/^@@date_format@@/.test(throwsMsg(() => env.ctx.api_getDashboard('2026-1-1', '2026-01-02'))));
  assert(/^@@range_too_long@@/.test(throwsMsg(() => env.ctx.api_getDashboard('2000-01-01', '2100-01-01'))));
  env.ctx.getContext_ = () => { throw new Error('boom SIM-PINNED-ID'); };
  const g = throwsMsg(() => env.ctx.api_listEmployees());
  assert(/^@@server_error@@/.test(g) && !/boom|SIM-PINNED-ID/.test(g), g);
});

test('sim: dashboard totals agree with the report and the daily buckets; counts come from real rows', () => {
  const env = createEnv();
  env.ctx.api_loadDemoSample();
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const from = iso(Date.now() - 10 * 86400000), to = iso(Date.now());
  const d = env.ctx.api_getDashboard(from, to);
  const rows = env.ctx.api_generateReport(from, to);
  const reportTotal = rows.reduce((a, r) => a + r.totalMs, 0);
  assert(reportTotal > 0, 'sample has tracked time');
  assertEq(d.metrics.trackedMs, reportTotal);
  assertEq(d.daily.reduce((a, x) => a + x.ms, 0), reportTotal);
  assertEq(d.byEmployee.reduce((a, x) => a + x.ms, 0), reportTotal);
  assertEq([d.metrics.totalEmployees, d.metrics.activeTasks, d.metrics.completedTasks, d.metrics.working, d.metrics.paused, d.metrics.idle], [2, 2, 1, 0, 2, 0]);
  assertEq(d.daily.length, 11);
  assertEq(env.ctx.api_getDashboard('2000-01-01', '2000-01-05').metrics.trackedMs, 0);
});

test('sim: a running timer is "working" on the dashboard and its time counts up to now', () => {
  const env = createEnv();
  env.ctx.api_createEmployee({ lastName: 'A', firstName: 'B', email: 'a@example.com', initialTask: 'T', sendInvite: false });
  const token = env.ctx.employees_list_()[0].workspaceToken;
  env.ctx.api_startSession(token);
  const today = new Date().toISOString().slice(0, 10);
  assertEq(env.ctx.api_getDashboard(today, today).metrics.working, 1);
  assertEq(env.ctx.api_listEmployees()[0].workState, 'working');
  env.ctx.api_pauseSession(token);
  assertEq(env.ctx.api_listEmployees()[0].workState, 'paused');
});

test('sim: CSV export matches the report, honours the employee filter, is localized and formula-safe', () => {
  const env = createEnv();
  env.ctx.api_loadDemoSample();
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const from = iso(Date.now() - 10 * 86400000), to = iso(Date.now());
  const all = env.ctx.api_exportReportCsv(from, to, '', 'en');
  const rows = env.ctx.api_generateReport(from, to);
  const n = rows.reduce((a, r) => a + r.sessions.length, 0);
  assertEq(all.rows, n);
  assertEq(all.csv.split('\r\n').filter(Boolean).length, n + 1);
  assert(all.csv.startsWith('﻿"Employee","Email"'));
  const ru = env.ctx.api_exportReportCsv(from, to, '', 'ru').csv;
  assert(ru.includes('Сотрудник') && ru.includes('завершено') || ru.includes('пауза'), 'Russian header and status');
  const one = env.ctx.api_exportReportCsv(from, to, rows[0].employeeId, 'en');
  assertEq(one.rows, rows[0].sessions.length);
  assertEq(env.ctx.api_exportReportCsv('2000-01-01', '2000-01-02', '', 'en').rows, 0, 'empty range gives a valid header-only file');
  env.ctx.api_createEmployee({ lastName: '=cmd|x', firstName: '@x', email: 'f@example.com', initialTask: '+task', sendInvite: false });
  const evil = env.ctx.employees_list_().find(e => e.firstName === '@x');
  const t0 = env.ctx.tasks_getActive_(evil.id);
  env.ctx.appendRow_('WorkSessions', { id: 'sx1', employeeId: evil.id, taskId: t0.id, startTime: new Date(Date.now() - 3600000).toISOString(), endTime: new Date(Date.now() - 1800000).toISOString(), durationMs: 1800000, status: 'paused' }, env.ctx.DEFAULT_CONFIG.HEADERS.SESSIONS);
  const csv = env.ctx.api_exportReportCsv(iso(Date.now() - 86400000), iso(Date.now() + 0), '', 'en').csv;
  assert(csv.includes('"\'=cmd|x @x"') && csv.includes('"\'+task"'), 'formula-looking text is neutralised in the CSV');
});

test('sim: cleanupTestArtifacts needs arming and removes only the exact fictional acceptance records', () => {
  const env = createEnv();
  const mk = (email, first) => env.ctx.api_createEmployee({ lastName: 'V', firstName: first, email, initialTask: 'T', sendInvite: false });
  mk('demo.verifier.1730000000000@example.com', 'junk1');
  mk('inj.verifier@example.com', 'junk2');
  mk('demo.verifier@example.com', 'keep1');
  mk('real@corp-demo.io', 'keep2');
  assert(/not armed/.test(throwsMsg(() => env.ctx.cleanupTestArtifacts())));
  assertEq(env.ctx.employees_list_().length, 4);
  env.arm('cleanupTestArtifacts');
  const r = env.ctx.cleanupTestArtifacts();
  assertEq([r.employees, r.tasks], [2, 2]);
  assertEq(env.ctx.employees_list_().map(e => e.firstName).sort(), ['keep1', 'keep2']);
  assertEq(env.props.has('ADMIN_MODE'), false);
});

test('sim: the workspace page opens with an employee token but offers no Manager capability', () => {
  const env = createEnv();
  env.ctx.api_createEmployee({ lastName: 'A', firstName: 'B', email: 'a@example.com', initialTask: 'T', sendInvite: false });
  const token = env.ctx.employees_list_()[0].workspaceToken;
  const page = env.ctx.doGet({ parameter: { page: 'employee', token } });
  assertEq(page.name, 'employee');
  // the employee token is rejected by every manager API (they take employee ids / dates, not tokens)
  assert(/@@employee_not_found@@/.test(throwsMsg(() => env.ctx.api_getEmployeeDetails(token))));
  assert(/@@employee_not_found@@/.test(throwsMsg(() => env.ctx.api_assignTask(token, 'x'))));
  assert(/@@employee_not_found@@/.test(throwsMsg(() => env.ctx.api_rotateWorkspaceToken(token))));
  // and a manager id is rejected by every employee API
  const id = env.ctx.employees_list_()[0].id;
  ['api_getEmployeeState', 'api_startSession', 'api_pauseSession', 'api_resumeSession', 'api_finishTask'].forEach(fn => {
    assert(/@@invalid_link@@/.test(throwsMsg(() => env.ctx[fn](id))), fn);
  });
});

test('sim: api_loadDemoSample works once on an empty demo, then refuses; it only appends', () => {
  const env = createEnv();
  const first = env.ctx.api_loadDemoSample();
  assertEq(first, { employees: 2, tasks: 4, sessions: 8 });
  assert(/no employees/.test(throwsMsg(() => env.ctx.api_loadDemoSample())));
  assertEq(env.ctx.employees_list_().length, 2);
});

test('sim: row caps stop anonymous growth with an understandable message', () => {
  const env = createEnv();
  env.ctx.DEMO_CONFIG.LIMITS.EMPLOYEES = 2;
  for (let i = 0; i < 2; i++) env.ctx.api_createEmployee({ lastName: 'L' + i, firstName: 'F', email: 'e' + i + '@example.com', initialTask: 'T' });
  assert(/Demo limit reached/.test(throwsMsg(() => env.ctx.api_createEmployee({ lastName: 'L9', firstName: 'F', email: 'e9@example.com', initialTask: 'T' }))));
  assertEq(env.ctx.employees_list_().length, 2);
});

test('sim: validation errors reach the visitor verbatim, internal errors do not', () => {
  const env = createEnv();
  const long = 'x'.repeat(101);
  assert(/Last name is too long/.test(throwsMsg(() => env.ctx.api_createEmployee({ lastName: long, firstName: 'F', email: 'a@example.com', initialTask: 'T' }))));
  assert(/YYYY-MM-DD/.test(throwsMsg(() => env.ctx.api_generateReport('2026-1-1', '2026-01-02'))));
  // an unexpected internal failure is generic
  env.ctx.getContext_ = () => { throw new Error('internal detail SIM-PINNED-ID'); };
  const m = throwsMsg(() => env.ctx.api_listEmployees());
  assert(/server error occurred/.test(m) && !/SIM-PINNED-ID/.test(m), m);
});

test('sim: formula-looking input is stored neutralised and read back unchanged', () => {
  const env = createEnv();
  env.ctx.api_createEmployee({ lastName: '=HYPERLINK("http://evil","x")', firstName: '+1', email: 'f@example.com', initialTask: '@cmd' });
  const e = env.ctx.employees_list_()[0];
  assertEq([e.lastName, e.firstName], ['=HYPERLINK("http://evil","x")', '+1']);
});

// --- pinning ------------------------------------------------------------------

test('sim: the app uses the pinned id and never accepts one from a caller', () => {
  const env = createEnv();
  env.ctx.api_listEmployees();
  assertEq(Array.from(new Set(env.log.opened)), ['SIM-PINNED-ID']);
  // no public function takes a spreadsheet handle: calling the API with a foreign id as an argument changes nothing
  env.props.set('SPREADSHEET_ID', 'SIM-PINNED-ID');
  assert(/not found|Employee not found/.test(throwsMsg(() => env.ctx.api_getEmployeeDetails('SIM-OTHER-ID'))));
  assertEq(env.other.sheets.size, 0);
  assertEq(env.log.opened.indexOf('SIM-OTHER-ID'), -1, 'the unrelated spreadsheet was never opened');
});

test('sim: with no pin and no container the demo fails closed', () => {
  const env = createEnv({ pin: false, noActive: true });
  assert(/unavailable/.test(throwsMsg(() => env.ctx.api_listEmployees())));
});

test('sim: with no pin the container id is adopted once (the only property the app ever writes)', () => {
  const env = createEnv({ pin: false });
  env.ctx.api_listEmployees();
  assertEq(env.props.get('SPREADSHEET_ID'), 'SIM-PINNED-ID');
  assertEq(env.log.propWrites, ['SPREADSHEET_ID']);
});

let passed = 0;
const failures = [];
for (const t of tests) {
  try { t.fn(); passed++; console.log('  OK   ' + t.name); }
  catch (err) { failures.push(t.name); console.log('  FAIL ' + t.name + ' -- ' + err.message); }
}
console.log('\n' + passed + '/' + tests.length + ' passed (simulated Apps Script)');
if (failures.length) process.exitCode = 1;
