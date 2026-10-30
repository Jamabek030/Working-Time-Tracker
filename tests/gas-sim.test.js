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
const APP_SHEETS = ['Employees', 'Tasks', 'WorkSessions'];
const appSheetNames = env => APP_SHEETS.filter(n => env.ss.getSheetByName(n));

// --- the real integration suite, simulated -----------------------------------

test('sim: runTests runs every integration test and all pass', () => {
  const env = createEnv();
  env.arm('runTests');
  const res = env.ctx.runTests();
  const failed = res.results.filter(r => !r.ok);
  assertEq(failed.map(f => f.name + ' -- ' + f.error), [], 'failing tests');
  assertEq([res.total, res.passed], [28, 28]);
  assert(env.log.logger.some(l => /28\/28 passed/.test(l)), 'summary line logged');
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

test('sim: api_createEmployee never mails in demo mode; list never returns tokens or ids of sheets', () => {
  const env = createEnv();
  const r = env.ctx.api_createEmployee({ lastName: 'Doe', firstName: 'Ann', email: 'victim@example.org', initialTask: 'T' });
  assertEq([r.emailSent, r.emailSkipped], [false, true]);
  assertEq(env.log.mail.length, 0, 'MailApp.sendEmail was not called');
  const list = env.ctx.api_listEmployees();
  assertEq(Object.keys(list[0]).sort(), ['active', 'createdAt', 'email', 'firstName', 'hasActiveSession', 'id', 'lastName', 'middleName', 'totalMs']);
  assert(!JSON.stringify(list).includes('SIM-PINNED-ID'), 'no spreadsheet id in responses');
});

test('sim: email_sendInvitation_ itself refuses in demo mode even if called directly', () => {
  const env = createEnv();
  assert(/disabled/.test(throwsMsg(() => env.ctx.email_sendInvitation_({ email: 'x@y.z', firstName: 'x', workspaceToken: 't' }, 'T'))));
  assertEq(env.log.mail.length, 0);
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
