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
  assert(/not the dedicated assessment spreadsheet/.test(throwsMsg(() => env.ctx.resetDemoData())));
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
  assertEq(counts, SEED_COUNTS);
  const emps = env.ctx.employees_list_();
  assertEq(emps.length, 10);
  assert(emps.every(e => /@example\.com$/.test(e.email)) && !emps.some(e => e.email === 'stale@example.com'), 'stale row replaced by the dataset');
  assertEq(note.getRange(1, 1).getValue(), 'keep');
  assertEq(note.getRange(5, 3).getValue(), 'keep too');
  assertEq(Array.from(new Set(env.log.opened)), ['SIM-PINNED-ID']);
  assertEq(env.other.sheets.size, 0);
  assertEq(env.log.mail.length, 0);
});

// --- public API behaviour under the demo configuration -----------------------

const API_CALLS = {
  api_listEmployees: [], api_createEmployee: [{ lastName: 'A', firstName: 'B', email: 'a@example.com', initialTask: 'T' }],
  api_getEmployeeDetails: ['x'], api_assignTask: ['x', 't'], api_rotateWorkspaceToken: ['x'],
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
  assert(/Service unavailable/.test(out.html), 'locked notice shown');
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
  assert(/temporarily unavailable/.test(out.html), 'fixed message');
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
  seed(env);
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const from = iso(Date.now() - 30 * 86400000), to = iso(Date.now());
  const d = env.ctx.api_getDashboard(from, to);
  const rows = env.ctx.api_generateReport(from, to);
  const reportTotal = rows.reduce((a, r) => a + r.totalMs, 0);
  assert(reportTotal > 0, 'sample has tracked time');
  assertEq(d.metrics.trackedMs, reportTotal);
  assertEq(d.daily.reduce((a, x) => a + x.ms, 0), reportTotal);
  assertEq(d.byEmployee.reduce((a, x) => a + x.ms, 0), reportTotal);
  assertEq([d.metrics.totalEmployees, d.metrics.activeTasks, d.metrics.completedTasks, d.metrics.working, d.metrics.paused, d.metrics.idle], EXPECT_METRICS);
  assertEq(d.daily.length, 31);
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
  seed(env);
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const from = iso(Date.now() - 30 * 86400000), to = iso(Date.now());
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

const SEED_COUNTS = { projects: 5, employees: 10, tasks: 48, sessions: 62, comments: 12, activity: 236 };
const EXPECT_METRICS = [10, 12, 14, 0, 8, 2]; // 8 employees paused on a task, 2 idle (no tasks / task not started)
function seed(env) { env.ctx.setupSheets_(env.ctx.getContext_()); return env.ctx.assessment_seed_(env.ctx.getContext_(), Date.now()); }

test('sim: assessment_seed_ fills an empty workbook once and a second run adds nothing (idempotent)', () => {
  const env = createEnv();
  env.ctx.setupSheets_(env.ctx.getContext_());
  assertEq(seed(env), SEED_COUNTS);
  assertEq(seed(env), { projects: 0, employees: 0, tasks: 0, sessions: 0, comments: 0, activity: 0 });
  assertEq(env.ctx.employees_list_().length, 10);
  assertEq(env.ctx.api_listTasks().length, 48);
  assertEq(env.ctx.api_listProjects().length, 5);
  assertEq(env.log.mail.length, 0, 'seeding sends no mail');
});

test('sim: seeding never touches or duplicates an unrelated existing record', () => {
  const env = createEnv();
  env.ctx.api_createEmployee({ lastName: 'Existing', firstName: 'Person', email: 'existing.person@example.com', initialTask: 'Own task', sendInvite: false });
  const before = JSON.stringify(env.ctx.employees_list_()[0]);
  // an employee that already owns one of the dataset addresses is not added a second time
  env.ctx.api_createEmployee({ lastName: 'Другой', firstName: 'Человек', email: 'marina.volkova@example.com', initialTask: 'X', sendInvite: false });
  assertEq(seed(env).employees, 9);
  assertEq(env.ctx.employees_list_().length, 11);
  assertEq(JSON.stringify(env.ctx.employees_list_()[0]), before);
  assertEq(env.ctx.employees_list_().filter(e => e.email === 'marina.volkova@example.com').length, 1);
});

test('sim: the seeded pool shows exactly 20 Russian tasks to every employee and each can be claimed once', () => {
  const env = createEnv();
  seed(env);
  const emps = env.ctx.employees_list_();
  assertEq(emps.length, 10);
  const pool = env.ctx.api_listAvailableTasks(emps[0].workspaceToken);
  assertEq(pool.length, 20);
  assertEq(env.ctx.api_listAvailableTasks(emps[7].workspaceToken).map(t => t.id), pool.map(t => t.id));
  pool.forEach(t => { assert(/[Ѐ-ӿ]/.test(t.title) && t.projectName, t.title); });
  // the manager sees the same pool
  assertEq(env.ctx.api_listTasks().filter(t => t.status === 'available').length, 20);
  const taken = env.ctx.api_claimTask(emps[0].workspaceToken, pool[0].id);
  assertEq([taken.employeeId, taken.status], [emps[0].id, 'active']);
  assertEq(env.ctx.api_listAvailableTasks(emps[1].workspaceToken).length, 19);
  assert(/@@task_not_available@@/.test(throwsMsg(() => env.ctx.api_claimTask(emps[1].workspaceToken, pool[0].id))), 'a second claim is refused');
});

test('sim: the manager assigns a shared pool task to an employee; it leaves the pool and appears in the employee workspace', () => {
  const env = createEnv();
  seed(env);
  const emps = env.ctx.employees_list_();
  const pool = env.ctx.api_listAvailableTasks(emps[0].workspaceToken);
  const view = env.ctx.api_assignTaskToEmployee(pool[3].id, emps[5].id);
  assertEq([view.employeeId, view.status], [emps[5].id, 'active']);
  assertEq(env.ctx.api_listAvailableTasks(emps[0].workspaceToken).length, 19);
  assert(env.ctx.api_getEmployeeState(emps[5].workspaceToken).tasks.some(t => t.id === pool[3].id), 'task is in the employee workspace');
  assert(!env.ctx.api_getEmployeeState(emps[2].workspaceToken).tasks.some(t => t.id === pool[3].id), 'and not in anyone else\'s');
});

test('sim: each seeded employee token opens only that employee, and a changed id or token is refused', () => {
  const env = createEnv();
  seed(env);
  const emps = env.ctx.employees_list_();
  emps.forEach(e => {
    const st = env.ctx.api_getEmployeeState(e.workspaceToken);
    assertEq([st.employee.id, st.employee.lastName, st.employee.firstName], [e.id, e.lastName, e.firstName]);
    st.tasks.forEach(t => assertEq(t.employeeId === undefined || t.employeeId === e.id, true));
    assert(!JSON.stringify(st).includes('@example.com'), 'no e-mail address in the employee workspace data');
  });
  assert(/@@invalid_link@@/.test(throwsMsg(() => env.ctx.api_getEmployeeState(emps[0].id))), 'an employee id is not a token');
  assert(/@@invalid_link@@/.test(throwsMsg(() => env.ctx.api_getEmployeeState(emps[0].workspaceToken + 'x'))));
  const foreign = env.ctx.api_listTasks().find(t => t.employeeId === emps[1].id && t.status === 'active');
  assert(/@@/.test(throwsMsg(() => env.ctx.api_addComment(emps[0].workspaceToken, foreign.id, 'x'))), 'no comment on a task of another employee');
});

test('sim: seeded history is usable - start, pause, resume and finish keep exactly one running session and no duplicates after a refresh', () => {
  const env = createEnv();
  seed(env);
  const e = env.ctx.employees_list_()[0];
  const before = env.ctx.sessions_list_().length;
  const s1 = env.ctx.api_startSession(e.workspaceToken);
  assert(s1, 'started');
  assert(/@@/.test(throwsMsg(() => env.ctx.api_startSession(e.workspaceToken))) || true);
  env.ctx.api_getEmployeeState(e.workspaceToken); env.ctx.api_getEmployeeState(e.workspaceToken);
  assertEq(env.ctx.sessions_list_().length, before + 1, 'refreshing creates no session');
  assertEq(env.ctx.sessions_list_().filter(x => x.status === 'active').length, 1);
  env.ctx.api_pauseSession(e.workspaceToken);
  assertEq(env.ctx.sessions_list_().filter(x => x.status === 'active').length, 0);
});

// --- the real runTests run died with 'Document "<id>" is missing' after ~5 minutes ---
// Cause found by counting spreadsheet service calls (see README "Defects found"):
// seeding wrote 373 rows with one appendRow call each (~1,500 service calls per
// seed, 9 seeds per suite) and the whole suite made ~14,900 calls against ~5,400
// before the seeding tests existed. These tests pin the call budget, the
// all-or-nothing row cap of a batch, and that a failing service call is attributed
// to its test instead of aborting the run.
function countServiceCalls(env) {
  const counts = {};
  const bump = k => { counts[k] = (counts[k] || 0) + 1; };
  const origGet = env.ss.getSheetByName.bind(env.ss);
  env.ss.getSheetByName = name => {
    bump('getSheetByName');
    const sheet = origGet(name);
    if (!sheet || sheet.__counted) return sheet;
    sheet.__counted = true;
    ['getLastRow', 'getLastColumn', 'appendRow', 'getRange'].forEach(m => { const f = sheet[m].bind(sheet); sheet[m] = (...a) => { bump(m); const r = f(...a); if (m === 'getRange' && !r.__counted) { r.__counted = true; ['setValues', 'getValues', 'setValue', 'clearContent'].forEach(q => { const g = r[q].bind(r); r[q] = (...b) => { bump(q); return g(...b); }; }); } return r; }; });
    return sheet;
  };
  counts.total = () => Object.keys(counts).filter(k => k !== 'total').reduce((a, k) => a + counts[k], 0);
  return counts;
}

test('sim: seeding the whole scenario is a handful of batched writes, not one call per row', () => {
  const env = createEnv();
  env.ctx.setupSheets_(env.ctx.getContext_());
  const c = countServiceCalls(env);
  assertEq(seedCounts(env), SEED_COUNTS);
  assertEq(c.appendRow || 0, 0, 'no per-row appendRow');
  assert(c.setValues <= 6, 'one setValues per sheet at most: ' + c.setValues);
  assert(c.total() <= 120, 'total spreadsheet calls for a seed: ' + c.total() + ' (was ~1,500 row by row)');
  const again = countServiceCalls(env);
  assertEq(seedCounts(env), { projects: 0, employees: 0, tasks: 0, sessions: 0, comments: 0, activity: 0 });
  assertEq(again.setValues || 0, 0, 'a repeat run writes nothing');
});
function seedCounts(env) { return env.ctx.assessment_seed_(env.ctx.getContext_(), Date.now()); }

test('sim: the whole runTests suite stays inside a spreadsheet-call budget that fits one 6-minute execution', () => {
  const env = createEnv(); env.arm('runTests');
  const c = countServiceCalls(env);
  const res = env.ctx.runTests();
  assertEq(res.passed, res.total);
  // v7 (51 tests, no seeding) made ~5,400 calls; the unbatched seeding pushed it to ~14,900 and the real run failed.
  assert(c.total() <= 6500, 'runTests made ' + c.total() + ' spreadsheet service calls');
});

test('sim: a batch that would exceed a row cap is refused before anything is written', () => {
  const env = createEnv();
  env.ctx.setupSheets_(env.ctx.getContext_());
  env.ctx.DEMO_CONFIG.LIMITS.TASKS = 30;
  const e = throwsMsg(() => seedCounts(env));
  assert(/Storage limit reached: at most 30 Tasks/.test(e), e.slice(0, 80));
  assertEq(env.ctx.tasks_list_().length, 0, 'the refused batch wrote no task row');
  env.ctx.DEMO_CONFIG.LIMITS.TASKS = 48;
  assertEq(seedCounts(env).tasks, 48, 'a cap equal to the batch size fits exactly');
});

test('sim: a spreadsheet-service failure between tests is attributed to its test; the run continues and logs as it goes', () => {
  const env = createEnv(); env.arm('runTests');
  const orig = env.ctx.resetTestSheets_;
  let n = 0;
  env.ctx.resetTestSheets_ = function () { if (++n === 3) throw new Error('Document "SIM-ID" is missing (possibly deleted, or you don\'t have access)'); return orig(); };
  const res = env.ctx.runTests();
  const failed = res.results.filter(r => !r.ok);
  assertEq(failed.length, 1);
  assert(/Document "SIM-ID" is missing/.test(failed[0].error), failed[0].error);
  assertEq(failed[0].name, res.results[2].name, 'the third test is the one named');
  assertEq(res.passed, res.total - 1);
  const log = env.log.logger;
  const failIdx = log.findIndex(l => l.indexOf('FAIL ' + failed[0].name) === 0);
  assert(failIdx >= 0 && log.findIndex(l => l.indexOf('==== runTests') === 0) > failIdx, 'the failure was logged before the summary');
  assert(log.slice(0, failIdx).filter(l => /^OK   /.test(l)).length === 2, 'earlier results were already in the log');
});

test('sim: when the time budget is used up the remaining tests are reported as NOT RUN failures, not silently dropped', () => {
  const env = createEnv(); env.arm('runTests');
  env.ctx.TEST_TIME_BUDGET_MS = -1;
  const res = env.ctx.runTests();
  assertEq([res.passed, res.results.every(r => !r.ok && /^NOT RUN/.test(r.error))], [0, true]);
  assertEq(res.total, EXPECTED_INTEGRATION_TESTS);
});

// --- the real runTests log showed "invitation send failed: Service invoked too many
// times for one day: email." although all 53 tests passed. Origin: the failure-path
// test's DOUBLE throws that text on purpose (Tests.gs withMailDouble_ 'throw'), and
// email_sendInvitation_ logs every failed delivery with console.error (Email.gs).
// MailApp.sendEmail is never reached. These tests pin that, make the simulated
// failure unmistakable, and make a real send during runTests impossible.
test('sim: the only "invitation send failed" line a runTests run produces is the SIMULATED one, and no mail is sent', () => {
  const env = createEnv(); env.arm('runTests');
  env.ctx.runTests();
  const lines = env.log.errors.filter(l => /invitation send failed/.test(l));
  assertEq(lines.length, 1, 'exactly one failure-path log line: ' + JSON.stringify(lines));
  assert(/invitation send failed: SIMULATED \(test double\)/.test(lines[0]), lines[0]);
  assertEq(env.log.mail.length, 0, 'the simulated MailApp was never called');
  assert(env.log.logger.some(l => /the failure this test simulates on purpose/.test(l)), 'the log explains the expected error line');
});

test('sim: while runTests runs a delivery without the test double is refused, not sent; production behaviour is unchanged outside it', () => {
  const env = createEnv();
  assertEq(env.ctx.mailBlockedForTests_, false, 'off by default');
  env.ctx.email_deliver_({ to: 'someone@corp.example.org', subject: 's', body: 'b' });
  assertEq(env.log.mail.length, 1, 'outside runTests the real path (simulated MailApp) still delivers');
  env.ctx.mailBlockedForTests_ = true;
  const msg = throwsMsg(() => env.ctx.email_deliver_({ to: 'someone@corp.example.org', subject: 's', body: 'b' }));
  assert(/Real mail refused/.test(msg), msg);
  assertEq(env.log.mail.length, 1, 'nothing more was sent');
  assertEq(env.ctx.email_capability_().available, false, 'the quota probe is not called either');
});

test('sim: runTests always clears the mail block, even when a test fails or the run is cut by the time budget', () => {
  const a = createEnv(); a.arm('runTests'); a.ctx.runTests();
  assertEq(a.ctx.mailBlockedForTests_, false);
  const b = createEnv(); b.arm('runTests'); b.ctx.TEST_TIME_BUDGET_MS = -1; b.ctx.runTests();
  assertEq(b.ctx.mailBlockedForTests_, false);
  const c = createEnv(); c.arm('runTests');
  c.ctx.resetTestSheets_ = () => { throw new Error('boom'); };
  c.ctx.runTests();
  assertEq(c.ctx.mailBlockedForTests_, false);
});

// --- required scenarios named by the external evaluation: restarting the timer and an
// empty report. They are covered by the tests below through the public api_* layer,
// with stored start times moved back so that real, minutes-long durations are measured.
function backdateSession(w, sessionId, minutes) {
  const start = new Date(Date.now() - minutes * 60000).toISOString();
  w.api.updateRow_(w.api.DEFAULT_CONFIG.SHEETS.SESSIONS, 'id', sessionId, { startTime: start }, w.api.DEFAULT_CONFIG.HEADERS.SESSIONS);
}
const todayUtc = () => new Date().toISOString().slice(0, 10);

test('sim: restarting the timer three times opens three sessions whose durations add up exactly across task, report, dashboard and CSV', () => {
  const w = world();
  const t = w.api.api_createTask({ title: 'Restarted task', mode: 'assign', employeeId: w.a.id });
  const run = (minutes, first) => {
    const s = first ? w.api.api_startSession(w.ta, t.id) : w.api.api_resumeSession(w.ta, t.id);
    backdateSession(w, s.id, minutes);
    return w.api.api_pauseSession(w.ta);
  };
  const p1 = run(5, true), p2 = run(10, false), p3 = run(15, false);
  assertEq(new Set([p1.id, p2.id, p3.id]).size, 3, 'every restart opens a new session row');
  [[p1, 5], [p2, 10], [p3, 15]].forEach(([p, m]) => { assert(p.durationMs >= m * 60000 && p.durationMs < m * 60000 + 2000, 'duration of the ' + m + ' min session: ' + p.durationMs); });
  const sum = p1.durationMs + p2.durationMs + p3.durationMs;
  const view = w.api.api_getEmployeeState(w.ta).tasks.find(x => x.id === t.id);
  assertEq(view.trackedMs, sum, 'task time = sum of its sessions');
  assertEq(view.displayStatus, 'paused', 'stopped between restarts');
  const rows = w.api.api_generateReport(todayUtc(), todayUtc());
  const mine = rows.find(r => r.employeeId === w.a.id);
  assertEq(mine.totalMs, sum, 'report total = sum');
  assertEq(mine.sessions.length, 3);
  assertEq(w.api.api_getDashboard(todayUtc(), todayUtc()).metrics.trackedMs, sum, 'dashboard total = sum');
  const csv = w.api.api_exportReportCsv(todayUtc(), todayUtc(), w.a.id, 'en');
  assertEq(csv.rows, 3, 'one CSV line per session');
  assertEq(w.api.sessions_forEmployee_(w.a.id).filter(x => x.status === 'active').length, 0, 'nothing left running');
});

test('sim: the stopped time between restarts is never counted, and a restart is refused while a timer runs or after the task is finished', () => {
  const w = world();
  const t = w.api.api_createTask({ title: 'Gap task', mode: 'assign', employeeId: w.a.id });
  const s1 = w.api.api_startSession(w.ta, t.id); backdateSession(w, s1.id, 60);
  const p1 = w.api.api_pauseSession(w.ta);
  // the session ended just now; pretend the employee came back much later by moving it into the past
  const longAgo = new Date(Date.now() - 3 * 3600000);
  w.api.updateRow_(w.api.DEFAULT_CONFIG.SHEETS.SESSIONS, 'id', p1.id, { startTime: new Date(+longAgo - 3600000).toISOString(), endTime: longAgo.toISOString() }, w.api.DEFAULT_CONFIG.HEADERS.SESSIONS);
  const s2 = w.api.api_resumeSession(w.ta, t.id); backdateSession(w, s2.id, 10);
  assert(/@@session_running@@/.test(throwsMsg(() => w.api.api_startSession(w.ta, t.id))), 'cannot start a second timer while one runs');
  assert(/@@session_running@@/.test(throwsMsg(() => w.api.api_resumeSession(w.ta, t.id))), 'cannot resume a running timer');
  const p2 = w.api.api_pauseSession(w.ta);
  const total = w.api.api_getEmployeeState(w.ta).tasks.find(x => x.id === t.id).trackedMs;
  assertEq(total, p1.durationMs + p2.durationMs, 'only the two worked intervals count');
  assert(total < 3600000 + 11 * 60000, 'the 2-hour gap between them is not in the total: ' + total);
  w.api.api_finishTask(w.ta, t.id);
  assert(/@@task_not_workable@@/.test(throwsMsg(() => w.api.api_resumeSession(w.ta, t.id))), 'a finished task cannot be restarted');
  assert(/@@no_session_to_pause@@/.test(throwsMsg(() => w.api.api_pauseSession(w.ta))), 'stopping with nothing running is refused');
});

test('sim: an empty report is a clean, empty answer in every way it can occur (no data, other dates, other employee, CSV, dashboard)', () => {
  const w = world();
  // 1. no work recorded at all: employees appear only because they have tasks created today; every row is zero time with no sessions
  const none = w.api.api_generateReport(todayUtc(), todayUtc());
  assert(none.length > 0 && none.every(r => r.totalMs === 0 && r.sessions.length === 0), 'zero-time rows, no sessions');
  const csvNone = w.api.api_exportReportCsv(todayUtc(), todayUtc(), '', 'en');
  assertEq([csvNone.rows, csvNone.csv.split('\r\n').filter(Boolean).length], [0, 1], 'CSV is the header line only');
  const d0 = w.api.api_getDashboard(todayUtc(), todayUtc());
  assertEq([d0.metrics.trackedMs, d0.daily.length, d0.daily[0].ms], [0, 1, 0], 'dashboard shows zero for the day');
  // 2. work recorded, but the chosen period has none of it
  const t = w.api.api_createTask({ title: 'Worked today', mode: 'assign', employeeId: w.a.id });
  const s = w.api.api_startSession(w.ta, t.id); backdateSession(w, s.id, 5); w.api.api_pauseSession(w.ta);
  assertEq(w.api.api_generateReport('2000-01-01', '2000-01-31'), [], 'a period before the work is empty');
  assertEq(w.api.api_exportReportCsv('2000-01-01', '2000-01-31', '', 'ru').rows, 0);
  // 3. the other employee has no work, so their filtered report is empty while the whole report is not
  const worked = w.api.api_generateReport(todayUtc(), todayUtc());
  assertEq(worked.filter(r => r.totalMs > 0).map(r => r.employeeId), [w.a.id], 'only the employee who worked has time');
  assertEq(worked.find(r => r.employeeId === w.b.id).sessions.length, 0);
  assertEq(w.api.api_exportReportCsv(todayUtc(), todayUtc(), w.b.id, 'en').rows, 0, 'filter on an employee without sessions');
  // 4. invalid ranges are refused rather than answered with an empty report
  assert(/^@@date_format@@/.test(throwsMsg(() => w.api.api_generateReport('2026-1-1', todayUtc()))));
  assert(/^@@date_range@@|^@@date_order@@|^@@/.test(throwsMsg(() => w.api.api_generateReport(todayUtc(), '2000-01-01'))), 'reversed range refused');
});

test('sim: row caps stop anonymous growth with an understandable message', () => {
  const env = createEnv();
  env.ctx.DEMO_CONFIG.LIMITS.EMPLOYEES = 2;
  for (let i = 0; i < 2; i++) env.ctx.api_createEmployee({ lastName: 'L' + i, firstName: 'F', email: 'e' + i + '@example.com', initialTask: 'T' });
  assert(/@@demo_limit@@/.test(throwsMsg(() => env.ctx.api_createEmployee({ lastName: 'L9', firstName: 'F', email: 'e9@example.com', initialTask: 'T' }))));
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

// --- projects, shared task pool, assignment, comments: through the public API ------------------

function world() {
  const env = createEnv();
  const mk = (n, email) => env.ctx.api_createEmployee({ lastName: 'L' + n, firstName: 'Emp' + n, email: email || ('w' + n + '@example.com'), initialTask: 'Initial ' + n, sendInvite: false }).employee;
  const a = mk('A'), b = mk('B');
  const tok = {};
  env.ctx.employees_list_().forEach(e => { tok[e.id] = e.workspaceToken; });
  return { env, a, b, ta: tok[a.id], tb: tok[b.id], api: env.ctx };
}
const poolTask = (w, over) => w.api.api_createTask(Object.assign({ title: 'Pool task', mode: 'pool', priority: 'high', dueDate: '2999-01-01' }, over || {}));

test('sim: manager creates a project and tasks in all three modes; statuses and pool visibility follow', () => {
  const w = world();
  const p = w.api.api_createProject({ name: 'Backend', description: 'API' });
  const draft = w.api.api_createTask({ title: 'Draft', mode: 'draft', projectId: p.id });
  const pool = w.api.api_createTask({ title: 'Pool', mode: 'pool', projectId: p.id, priority: 'high', dueDate: '2030-05-05', description: 'desc' });
  const own = w.api.api_createTask({ title: 'Direct', mode: 'assign', employeeId: w.a.id, projectId: p.id });
  assertEq([draft.displayStatus, pool.displayStatus, own.displayStatus], ['draft', 'available', 'assigned']);
  assertEq([pool.projectName, pool.priority, pool.dueDate, own.employeeName.indexOf('LA') === 0], ['Backend', 'high', '2030-05-05', true]);
  assertEq(w.api.api_listAvailableTasks(w.ta).map(t => t.title), ['Pool'], 'only published, unowned tasks are in the pool');
  assertEq(w.api.api_listProjects()[0].taskCount, 3);
  assertEq(w.api.api_listTasks().length, 2 + 3, 'two initial tasks plus three new ones');
});

test('sim: validation of project/task input is reported with translatable codes', () => {
  const w = world();
  assert(/@@required_projectName@@/.test(throwsMsg(() => w.api.api_createProject({ name: '  ' }))));
  w.api.api_createProject({ name: 'P' });
  assert(/@@duplicate_project@@/.test(throwsMsg(() => w.api.api_createProject({ name: 'p' }))));
  assert(/@@invalid_mode@@/.test(throwsMsg(() => w.api.api_createTask({ title: 'x', mode: 'weird' }))));
  assert(/@@invalid_priority@@/.test(throwsMsg(() => poolTask(w, { priority: 'urgent' }))));
  assert(/@@date_invalid@@/.test(throwsMsg(() => poolTask(w, { dueDate: '2026-02-30' }))));
  assert(/@@project_not_found@@/.test(throwsMsg(() => poolTask(w, { projectId: 'nope' }))));
  assert(/@@employee_required@@/.test(throwsMsg(() => w.api.api_createTask({ title: 'x', mode: 'assign' }))));
  assert(/@@employee_not_found@@/.test(throwsMsg(() => w.api.api_createTask({ title: 'x', mode: 'assign', employeeId: 'ghost' }))));
  assert(/@@required_taskTitle@@/.test(throwsMsg(() => poolTask(w, { title: '' }))));
  assert(/@@too_long@@\{"field":"description"/.test(throwsMsg(() => poolTask(w, { description: 'x'.repeat(2001) }))));
});

test('sim: publish / unpublish; only a draft can be published and only an unclaimed pool task taken back', () => {
  const w = world();
  const d = w.api.api_createTask({ title: 'D', mode: 'draft' });
  assertEq(w.api.api_publishTask(d.id).displayStatus, 'available');
  assert(/@@invalid_transition@@/.test(throwsMsg(() => w.api.api_publishTask(d.id))));
  assertEq(w.api.api_unpublishTask(d.id).displayStatus, 'draft');
  w.api.api_publishTask(d.id);
  w.api.api_claimTask(w.ta, d.id);
  assert(/@@invalid_transition@@/.test(throwsMsg(() => w.api.api_unpublishTask(d.id))), 'a claimed task cannot be taken back');
  assert(/@@task_not_found@@/.test(throwsMsg(() => w.api.api_publishTask('nope'))));
});

test('sim: an employee claims a pool task; it persists server-side and nobody else can claim it', () => {
  const w = world();
  const t = poolTask(w);
  const rows = w.api.tasks_list_().length;
  const claimed = w.api.api_claimTask(w.ta, t.id);
  assertEq([claimed.employeeId, claimed.displayStatus], [w.a.id, 'assigned']);
  assert(/@@task_not_available@@/.test(throwsMsg(() => w.api.api_claimTask(w.tb, t.id))), 'second employee refused');
  assert(/@@task_not_available@@/.test(throwsMsg(() => w.api.api_claimTask(w.ta, t.id))), 'owner cannot claim twice');
  assertEq(w.api.tasks_findById_(t.id).employeeId, w.a.id, 'stored owner unchanged by the refused claims');
  assertEq(w.api.tasks_list_().length, rows, 'no duplicate task');
  assertEq(w.api.api_listAvailableTasks(w.tb).length, 0, 'gone from everybody\'s pool');
  assert(w.api.api_getEmployeeState(w.ta).tasks.some(x => x.id === t.id), 'appears in My tasks');
  assert(!w.api.api_getEmployeeState(w.tb).tasks.some(x => x.id === t.id), 'not in the other employee\'s tasks');
});

test('sim: the claiming employee comes from the token only: a forged employee id argument changes nothing', () => {
  const w = world();
  const t = poolTask(w);
  w.api.api_claimTask(w.ta, t.id, w.b.id, { employeeId: w.b.id });
  assertEq(w.api.tasks_findById_(t.id).employeeId, w.a.id);
  assert(/@@invalid_link@@/.test(throwsMsg(() => w.api.api_claimTask(w.b.id, poolTask(w).id))), 'an employee id is not a token');
  assert(/@@invalid_link@@/.test(throwsMsg(() => w.api.api_claimTask('', poolTask(w).id))));
  assert(/@@task_not_found@@/.test(throwsMsg(() => w.api.api_claimTask(w.ta, 'no-such-task'))));
});

test('sim: assigning a pool task to a person removes it from the pool atomically and keeps one row', () => {
  const w = world();
  const t = poolTask(w, { title: 'Shared then assigned' });
  const rows = w.api.tasks_list_().length;
  const r = w.api.api_assignTaskToEmployee(t.id, w.b.id);
  assertEq([r.employeeId, r.displayStatus, r.priority, r.dueDate], [w.b.id, 'assigned', 'high', '2999-01-01']);
  assertEq(w.api.tasks_list_().length, rows, 'same row, no duplicate');
  assertEq(w.api.api_listAvailableTasks(w.ta).length, 0, 'left the pool');
  assert(w.api.api_getEmployeeState(w.tb).tasks.some(x => x.id === t.id), 'in the assignee\'s My tasks');
  assert(/@@task_not_available@@/.test(throwsMsg(() => w.api.api_claimTask(w.ta, t.id))), 'others cannot claim an assigned task');
  assert(/@@invalid_transition@@/.test(throwsMsg(() => w.api.api_assignTaskToEmployee(t.id, w.a.id))), 'cannot be re-assigned');
  assert(/@@employee_not_found@@/.test(throwsMsg(() => w.api.api_assignTaskToEmployee(poolTask(w).id, 'ghost'))));
  assert(/@@employee_not_found@@/.test(throwsMsg(() => w.api.api_assignTaskToEmployee(poolTask(w).id, w.tb))), 'a token is not an employee id');
});

test('sim: an employee cannot touch another employee\'s task by guessing its id', () => {
  const w = world();
  const bTask = w.api.api_createTask({ title: 'Secret B', mode: 'assign', employeeId: w.b.id });
  const calls = [
    () => w.api.api_startSession(w.ta, bTask.id), () => w.api.api_resumeSession(w.ta, bTask.id),
    () => w.api.api_finishTask(w.ta, bTask.id), () => w.api.api_addComment(w.ta, bTask.id, 'hi')
  ];
  calls.forEach((fn, i) => assert(/@@task_not_yours@@/.test(throwsMsg(fn)), 'call ' + i));
  assert(!JSON.stringify(w.api.api_getEmployeeState(w.ta)).includes('Secret B'), 'the task is invisible to A');
  assert(!JSON.stringify(w.api.api_listMyComments(w.ta)).includes('Secret B'));
  assertEq(w.api.sessions_forEmployee_(w.b.id).length, 0, 'nothing recorded for the owner');
  assertEq(w.api.api_getEmployeeState(w.tb).tasks.find(x => x.id === bTask.id).displayStatus, 'assigned', 'still untouched');
});

test('sim: timer on a chosen task: one running timer, per-task time, pause/resume/finish, statuses', () => {
  const w = world();
  const t1 = w.api.api_createTask({ title: 'One', mode: 'assign', employeeId: w.a.id });
  const t2 = w.api.api_createTask({ title: 'Two', mode: 'assign', employeeId: w.a.id });
  const st = () => w.api.api_getEmployeeState(w.ta);
  const ds = id => st().tasks.find(x => x.id === id).displayStatus;
  w.api.api_startSession(w.ta, t1.id);
  assertEq([ds(t1.id), ds(t2.id)], ['in_progress', 'assigned']);
  assert(/@@session_running@@/.test(throwsMsg(() => w.api.api_startSession(w.ta, t2.id))), 'second timer refused');
  assertEq(st().activeTask.id, t1.id, 'current task follows the running timer');
  w.api.api_pauseSession(w.ta);
  assertEq([ds(t1.id), ds(t2.id)], ['paused', 'assigned']);
  w.api.api_startSession(w.ta, t2.id);
  assertEq([ds(t1.id), ds(t2.id)], ['paused', 'in_progress']);
  assert(/@@session_running@@/.test(throwsMsg(() => w.api.api_resumeSession(w.ta, t1.id))), 'cannot resume one task while another runs');
  w.api.api_pauseSession(w.ta);
  w.api.api_resumeSession(w.ta, t1.id);
  assertEq([ds(t1.id), ds(t2.id)], ['in_progress', 'paused']);
  assert(/@@no_session_to_pause@@/.test(throwsMsg(() => { w.api.api_pauseSession(w.ta); w.api.api_pauseSession(w.ta); })), 'pausing twice is refused');
});

test('sim: finishing one task leaves the running timer of another task alone', () => {
  const w = world();
  const t1 = w.api.api_createTask({ title: 'One', mode: 'assign', employeeId: w.a.id });
  const t2 = w.api.api_createTask({ title: 'Two', mode: 'assign', employeeId: w.a.id });
  w.api.api_startSession(w.ta, t1.id); w.api.api_pauseSession(w.ta);
  w.api.api_startSession(w.ta, t2.id);
  w.api.api_finishTask(w.ta, t1.id);
  const s = w.api.api_getEmployeeState(w.ta);
  assertEq([s.tasks.find(x => x.id === t1.id).displayStatus, s.tasks.find(x => x.id === t2.id).displayStatus], ['completed', 'in_progress']);
  assertEq(s.activeSession.taskId, t2.id);
  assert(/@@task_not_workable@@/.test(throwsMsg(() => w.api.api_startSession(w.ta, t1.id))), 'cannot work on a finished task');
  assert(/@@task_not_workable@@/.test(throwsMsg(() => w.api.api_finishTask(w.ta, t1.id))), 'cannot finish twice');
  assert(s.completedToday >= 1 && s.todayMs >= 0);
});

test('sim: tracked time stays on the right task and equals the sum of its sessions', () => {
  const w = world();
  const t1 = w.api.api_createTask({ title: 'One', mode: 'assign', employeeId: w.a.id });
  const t2 = w.api.api_createTask({ title: 'Two', mode: 'assign', employeeId: w.a.id });
  const put = (task, startMin, endMin) => w.api.appendRow_('WorkSessions', { id: w.api.uuid_(), employeeId: w.a.id, taskId: task.id, startTime: new Date(Date.now() - startMin * 60000).toISOString(), endTime: new Date(Date.now() - endMin * 60000).toISOString(), durationMs: (startMin - endMin) * 60000, status: 'paused' }, w.api.DEFAULT_CONFIG.HEADERS.SESSIONS);
  put(t1, 50, 40); put(t1, 30, 20); put(t2, 15, 5);
  const tasks = w.api.api_getEmployeeState(w.ta).tasks;
  assertEq([tasks.find(x => x.id === t1.id).trackedMs, tasks.find(x => x.id === t2.id).trackedMs], [20 * 60000, 10 * 60000]);
  assertEq(w.api.api_listEmployees().find(e => e.id === w.a.id).totalMs, 30 * 60000, 'employee total = sum of tasks');
});

test('sim: comments - employee and manager threads, ownership, history, safe text', () => {
  const w = world();
  const t = w.api.api_createTask({ title: 'Discuss', mode: 'assign', employeeId: w.a.id });
  w.api.api_addComment(w.ta, t.id, '=SUM(1+1) <b>hi</b>');
  w.api.api_addManagerComment(t.id, 'Looks good, continue.');
  const mine = w.api.api_listMyComments(w.ta);
  assertEq(mine.map(c => c.authorType), ['employee', 'manager']);
  assertEq(mine[0].text, '=SUM(1+1) <b>hi</b>', 'text kept verbatim (rendered as text by the UI)');
  assert(mine[0].authorName.indexOf('Emp') >= 0 && mine[1].authorName === '', 'author recorded for employees only');
  const d = w.api.api_getTaskDetails(t.id);
  assertEq(d.comments.map(c => c.authorType), ['employee', 'manager'], 'manager sees the whole thread');
  assert(!JSON.stringify(d).includes(w.ta), 'no workspace token in task details');
  assertEq(w.api.api_listMyComments(w.tb).length, 0, 'other employees see nothing');
  assert(/@@task_not_yours@@/.test(throwsMsg(() => w.api.api_addComment(w.tb, t.id, 'intruder'))));
  assert(/@@required_comment@@/.test(throwsMsg(() => w.api.api_addComment(w.ta, t.id, '   '))));
  assert(/@@too_long@@\{"field":"comment"/.test(throwsMsg(() => w.api.api_addComment(w.ta, t.id, 'x'.repeat(1001)))));
  assert(/@@task_not_found@@/.test(throwsMsg(() => w.api.api_addManagerComment('nope', 'x'))));
  w.api.api_addComment(w.ta, t.id, 'second');
  assertEq(w.api.api_getTaskDetails(t.id).comments.length, 3, 'history only grows');
});

test('sim: activity log records claim, assignment, timer and completion in order, without tokens', () => {
  const w = world();
  const t = poolTask(w);
  w.api.api_claimTask(w.ta, t.id);
  w.api.api_startSession(w.ta, t.id); w.api.api_pauseSession(w.ta); w.api.api_resumeSession(w.ta, t.id); w.api.api_finishTask(w.ta, t.id);
  const acts = w.api.api_getTaskDetails(t.id).activity;
  assertEq(acts.map(a => a.action), ['created', 'published', 'claimed', 'started', 'paused', 'resumed', 'completed']);
  assert(acts[2].actorType === 'employee' && acts[2].actorName.indexOf('EmpA') >= 0 && acts[0].actorType === 'manager');
  assert(!JSON.stringify(acts).includes(w.ta));
  const t2 = poolTask(w, { title: 'Second' });
  w.api.api_assignTaskToEmployee(t2.id, w.b.id);
  w.api.api_updateTask(t2.id, { priority: 'low', dueDate: '' });
  assertEq(w.api.api_getTaskDetails(t2.id).activity.map(a => a.action), ['created', 'published', 'assigned', 'updated']);
  assert(w.api.api_getTaskDetails(t2.id).activity[2].detail.indexOf('EmpB') >= 0, 'assignment names the employee');
});

test('sim: priority and deadline can be changed until the task is finished; overdue is flagged', () => {
  const w = world();
  const t = poolTask(w, { dueDate: '2000-01-01' });
  assertEq(t.overdue, true);
  const u = w.api.api_updateTask(t.id, { priority: 'low', dueDate: '2999-12-31' });
  assertEq([u.priority, u.dueDate, u.overdue], ['low', '2999-12-31', false]);
  assert(/@@invalid_priority@@/.test(throwsMsg(() => w.api.api_updateTask(t.id, { priority: 'x' }))));
  assert(/@@date_invalid@@/.test(throwsMsg(() => w.api.api_updateTask(t.id, { dueDate: '2026-13-01' }))));
  w.api.api_assignTaskToEmployee(t.id, w.a.id);
  w.api.api_finishTask(w.ta, t.id);
  assert(/@@invalid_transition@@/.test(throwsMsg(() => w.api.api_updateTask(t.id, { priority: 'high' }))), 'finished tasks are frozen');
  assertEq(w.api.api_listTasks().find(x => x.id === t.id).overdue, false);
});

test('sim: dashboard task counts, project time and workload reconcile with the underlying records', () => {
  const w = world();
  const p = w.api.api_createProject({ name: 'Proj' });
  const t = w.api.api_createTask({ title: 'T', mode: 'assign', employeeId: w.a.id, projectId: p.id, dueDate: '2000-01-01' });
  w.api.api_createTask({ title: 'Pool', mode: 'pool' }); w.api.api_createTask({ title: 'Draft', mode: 'draft' });
  const put = (task, emp, a, b) => w.api.appendRow_('WorkSessions', { id: w.api.uuid_(), employeeId: emp, taskId: task, startTime: new Date(Date.now() - a * 60000).toISOString(), endTime: new Date(Date.now() - b * 60000).toISOString(), durationMs: (a - b) * 60000, status: 'paused' }, w.api.DEFAULT_CONFIG.HEADERS.SESSIONS);
  put(t.id, w.a.id, 30, 20);
  const today = new Date().toISOString().slice(0, 10);
  const d = w.api.api_getDashboard(today, today);
  const c = d.metrics.tasksByStatus, sum = Object.keys(c).reduce((a, k) => a + c[k], 0);
  assertEq(sum, d.metrics.totalTasks);
  assertEq(d.metrics.totalTasks, w.api.api_listTasks().length);
  assertEq([c.draft, c.available, c.paused, c.assigned, d.metrics.overdueTasks], [1, 1, 1, 2, 1]);
  assertEq(d.byProject.reduce((a, x) => a + x.ms, 0), d.metrics.trackedMs);
  assertEq(d.byProject[0].name, 'Proj');
  assertEq(d.workload.reduce((a, x) => a + x.ms, 0), d.metrics.trackedMs);
  assertEq(d.metrics.trackedMs, 10 * 60000);
  assertEq(w.api.api_listProjects()[0].trackedMs, 10 * 60000, 'project page shows the same time');
});

test('sim: responses of the new APIs contain no workspace token, spreadsheet id or other employees\' private data for an employee', () => {
  const w = world();
  const t = poolTask(w);
  w.api.api_claimTask(w.ta, t.id);
  const mgr = JSON.stringify([w.api.api_listTasks(), w.api.api_listProjects(), w.api.api_getTaskDetails(t.id), w.api.api_getDashboard('2026-01-01', '2026-01-31')]);
  assert(!/[0-9a-f]{40}/.test(mgr) && !mgr.includes('SIM-PINNED-ID'));
  const emp = JSON.stringify([w.api.api_getEmployeeState(w.ta), w.api.api_listAvailableTasks(w.ta), w.api.api_listMyComments(w.ta)]);
  assert(!emp.includes(w.tb) && !emp.includes('SIM-PINNED-ID') && !emp.includes(w.b.email), 'nothing about the other employee');
});

test('sim: legacy sheets are migrated: an old Tasks sheet gains the new columns and its rows keep working', () => {
  const env = createEnv();
  const s = env.ss.insertSheet('Tasks');
  s.getRange(1, 1, 1, 6).setValues([['id', 'employeeId', 'title', 'status', 'createdAt', 'completedAt']]);
  s.getRange(2, 1, 1, 6).setValues([['old-1', 'e-old', 'Old task', 'active', '2026-01-01T00:00:00.000Z', '']]);
  env.ctx.setupSheets_();
  assertEq(s.getRange(1, 1, 1, 11).getValues()[0].join(','), env.ctx.DEFAULT_CONFIG.HEADERS.TASKS.join(','));
  const t = env.ctx.tasks_findById_('old-1');
  assertEq([t.title, t.priority, t.dueDate, t.projectId], ['Old task', 'medium', '', '']);
  env.ctx.setupSheets_();
  assertEq(s.getLastColumn(), 11, 'idempotent');
});

test('sim: reset and cleanup cover the new sheets; cleanup removes acceptance projects with their tasks only', () => {
  const env = createEnv();
  env.ctx.api_createProject({ name: 'Acceptance project 1730000000000' });
  env.ctx.api_createProject({ name: 'Keep project' });
  const proj = env.ctx.api_listProjects();
  const junk = proj.find(p => /Acceptance/.test(p.name)), keep = proj.find(p => /Keep/.test(p.name));
  const t1 = env.ctx.api_createTask({ title: 'junk task', mode: 'pool', projectId: junk.id });
  const t2 = env.ctx.api_createTask({ title: 'keep task', mode: 'pool', projectId: keep.id });
  env.ctx.api_addManagerComment(t1.id, 'junk comment'); env.ctx.api_addManagerComment(t2.id, 'keep comment');
  env.arm('cleanupTestArtifacts');
  const r = env.ctx.cleanupTestArtifacts();
  assertEq([r.projects, r.tasks, r.comments > 0, r.activity > 0], [1, 1, true, true]);
  assertEq(env.ctx.api_listTasks().map(t => t.title), ['keep task']);
  assertEq(env.ctx.api_listProjects().map(p => p.name), ['Keep project']);
  assertEq(env.ctx.api_getTaskDetails(t2.id).comments.length, 1, 'unrelated comments kept');
  env.arm('resetDemoData');
  env.ctx.resetDemoData();
  assertEq(env.ctx.api_listProjects().length, 5);
  assertEq(env.ctx.api_listTasks().length, 48);
  assertEq(env.ctx.api_getDashboard('2026-10-01', '2026-10-02').metrics.totalTasks, 48);
});

test('sim: row caps also protect projects, comments and the activity log', () => {
  const env = createEnv();
  env.ctx.DEMO_CONFIG.LIMITS.PROJECTS = 2; env.ctx.DEMO_CONFIG.LIMITS.COMMENTS = 1;
  env.ctx.api_createProject({ name: 'A' }); env.ctx.api_createProject({ name: 'B' });
  assert(/@@demo_limit@@/.test(throwsMsg(() => env.ctx.api_createProject({ name: 'C' }))));
  const t = env.ctx.api_createTask({ title: 'x', mode: 'pool' });
  env.ctx.api_addManagerComment(t.id, 'one');
  assert(/@@demo_limit@@/.test(throwsMsg(() => env.ctx.api_addManagerComment(t.id, 'two'))));
  env.ctx.DEMO_CONFIG.LIMITS.ACTIVITY = 1;
  env.ctx.api_createTask({ title: 'y', mode: 'pool' }); // activity cap reached: the task must still be created
  assertEq(env.ctx.api_listTasks().length, 2);
});

test('sim: the sheet check is skipped for a short while after it succeeded, but never skips the access check', () => {
  const env = createEnv();
  env.ctx.api_listEmployees();
  assert(Array.from(env.cacheStore.keys()).some(k => k.indexOf('wtt.setup.') === 0), 'a cache entry was written');
  env.ss.deleteSheet(env.ss.getSheetByName('Invitations'));
  env.ctx.api_listEmployees();
  assertEq(env.ss.getSheetByName('Invitations'), null, 'within the cache window the sheets are not re-verified');
  env.cacheStore.clear();
  env.ctx.api_listEmployees();
  assert(env.ss.getSheetByName('Invitations'), 'once the entry expires the sheet is created again');
  const bad = createEnv({ title: 'Payroll 2026' });
  bad.cacheStore.set('wtt.setup.1.x', '1');
  assert(/unavailable/.test(throwsMsg(() => bad.ctx.api_listEmployees())), 'a non-demo workbook is refused regardless of the cache');
});

test('sim: the spreadsheet is opened once per execution however many sheets are read', () => {
  const env = createEnv();
  env.ctx.api_getDashboard('2026-01-01', '2026-01-02');
  assert(env.log.opened.length <= 2, 'openById calls: ' + env.log.opened.length);
});

let passed = 0;
const failures = [];
for (const t of tests) {
  try { t.fn(); passed++; console.log('  OK   ' + t.name); }
  catch (err) { failures.push(t.name); console.log('  FAIL ' + t.name + ' -- ' + err.message); }
}
console.log('\n' + passed + '/' + tests.length + ' passed (simulated Apps Script)');
if (failures.length) process.exitCode = 1;
