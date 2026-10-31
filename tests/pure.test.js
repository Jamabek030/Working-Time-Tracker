// Tests for pure business-logic helpers in src/pure.gs.
const { loadPure } = require('./load-pure');
const pure = loadPure();

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + (msg || ''));
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error('Expected ' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + (msg ? ' - ' + msg : ''));
}
function assertNear(a, b, tolerance, msg) {
  if (Math.abs(a - b) > tolerance) throw new Error('Expected ' + a + ' ~= ' + b + ' (±' + tolerance + ')' + (msg ? ' - ' + msg : ''));
}
function assertThrows(fn, msg) {
  try { fn(); } catch (e) { return e; }
  throw new Error('Expected to throw: ' + (msg || ''));
}

// overlapMs ---------------------------------------------------------------

test('overlapMs: session fully inside range', () => {
  assertEq(pure.overlapMs(100, 200, 0, 1000, 10000), 100);
});
test('overlapMs: session fully outside range', () => {
  assertEq(pure.overlapMs(100, 200, 300, 400, 10000), 0);
  assertEq(pure.overlapMs(500, 600, 100, 400, 10000), 0);
});
test('overlapMs: partial overlap left', () => {
  assertEq(pure.overlapMs(50, 150, 100, 200, 10000), 50);
});
test('overlapMs: partial overlap right', () => {
  assertEq(pure.overlapMs(150, 250, 100, 200, 10000), 50);
});
test('overlapMs: active session (no endTime) uses nowMs', () => {
  assertEq(pure.overlapMs(100, null, 0, 1000, 500), 400);
  assertEq(pure.overlapMs(100, '', 0, 1000, 500), 400);
});
test('overlapMs: accepts ISO strings', () => {
  const from = new Date('2024-01-01T00:00:00Z').getTime();
  const to = new Date('2024-01-02T00:00:00Z').getTime();
  assertEq(pure.overlapMs('2024-01-01T10:00:00Z', '2024-01-01T11:30:00Z', from, to, Date.now()), 90 * 60 * 1000);
});
test('overlapMs: zero-length session', () => {
  assertEq(pure.overlapMs(100, 100, 0, 1000, 10000), 0);
});
test('overlapMs: invalid dates return 0', () => {
  assertEq(pure.overlapMs('not-a-date', 100, 0, 1000, 10000), 0);
});

// sumSessionMs / sumSessionMsWithDiagnostics ------------------------------

test('sumSessionMs: sums closed durations', () => {
  assertEq(pure.sumSessionMs([
    { status: 'paused', durationMs: 1000 },
    { status: 'paused', durationMs: 2000 },
    { status: 'completed', durationMs: 3000 }
  ], Date.now()), 6000);
});
test('sumSessionMs: active session uses now - start', () => {
  assertEq(pure.sumSessionMs([
    { status: 'paused', durationMs: 1000 },
    { status: 'active', startTime: 7000, endTime: '' }
  ], 10000), 1000 + 3000);
});
test('sumSessionMs: does not go negative if clock skews', () => {
  assertEq(pure.sumSessionMs([{ status: 'active', startTime: 5000, endTime: '' }], 1000), 0);
});
test('sumSessionMs: falls back to endpoints when durationMs missing', () => {
  // closed row, no durationMs, but valid timestamps → derive from endpoints
  const r = pure.sumSessionMsWithDiagnostics([
    { id: 's1', status: 'paused', startTime: '2026-01-01T10:00:00Z', endTime: '2026-01-01T10:15:00Z', durationMs: '' }
  ], Date.now());
  assertEq(r.totalMs, 15 * 60 * 1000);
  assertEq(r.warnings.length, 1, 'warning emitted');
  assertEq(r.warnings[0].sessionId, 's1');
});
test('sumSessionMs: unrecoverable row produces warning, counts 0', () => {
  const r = pure.sumSessionMsWithDiagnostics([
    { id: 'bad', status: 'paused', startTime: '', endTime: '', durationMs: 'nope' }
  ], Date.now());
  assertEq(r.totalMs, 0);
  assertEq(r.warnings.length, 1);
});
test('sumSessionMs: active row with no startTime emits warning', () => {
  const r = pure.sumSessionMsWithDiagnostics([
    { id: 'a', status: 'active', startTime: '', endTime: '', durationMs: '' }
  ], 5000);
  assertEq(r.totalMs, 0);
  assertEq(r.warnings.length, 1);
});

// isValidEmail -----------------------------------------------------------

test('isValidEmail: accepts normal addresses', () => {
  assert(pure.isValidEmail('alice@example.com'));
  assert(pure.isValidEmail('a.b+tag@sub.example.co.uk'));
});
test('isValidEmail: rejects nonsense', () => {
  ['', 'not-an-email', 'missing@dot', '@no-local.com', 'spaces @example.com', null, undefined, 42]
    .forEach(x => assert(!pure.isValidEmail(x), String(x)));
});
test('isValidEmail: rejects anything over the length cap', () => {
  const over = 'a'.repeat(pure.FIELD_LIMITS.email + 1) + '@example.com';
  assert(!pure.isValidEmail(over));
});

// sanitize ---------------------------------------------------------------

test('sanitize: trims strings', () => {
  assertEq(pure.sanitize('  hello  '), 'hello');
});
test('sanitize: converts null/undefined to empty', () => {
  assertEq(pure.sanitize(null), '');
  assertEq(pure.sanitize(undefined), '');
});
test('sanitize: coerces non-strings', () => {
  assertEq(pure.sanitize(42), '42');
});

// nextStateAfter ---------------------------------------------------------

test('nextStateAfter: cannot start without a task', () => {
  assert(!pure.nextStateAfter('start', false, false).ok);
});
test('nextStateAfter: cannot start twice', () => {
  assert(!pure.nextStateAfter('start', true, true).ok);
});
test('nextStateAfter: start OK when idle with active task', () => {
  assert(pure.nextStateAfter('start', true, false).ok);
});
test('nextStateAfter: cannot pause when nothing is running', () => {
  assert(!pure.nextStateAfter('pause', true, false).ok);
});
test('nextStateAfter: pause OK when active session', () => {
  assert(pure.nextStateAfter('pause', true, true).ok);
});
test('nextStateAfter: resume is like start', () => {
  assert(pure.nextStateAfter('resume', true, false).ok);
  assert(!pure.nextStateAfter('resume', true, true).ok);
});
test('nextStateAfter: finish OK whenever a task exists', () => {
  assert(pure.nextStateAfter('finish', true, true).ok);
  assert(pure.nextStateAfter('finish', true, false).ok);
  assert(!pure.nextStateAfter('finish', false, false).ok);
});
test('nextStateAfter: unknown action rejected', () => {
  assert(!pure.nextStateAfter('explode', true, false).ok);
});

// cellSafe (F-01) --------------------------------------------------------

test('cellSafe: pass-through for non-strings', () => {
  assertEq(pure.cellSafe(42), 42);
  assertEq(pure.cellSafe(0), 0);
  assertEq(pure.cellSafe(true), true);
  assertEq(pure.cellSafe(false), false);
  const d = new Date();
  assertEq(pure.cellSafe(d), d);
});
test('cellSafe: null/undefined → empty string', () => {
  assertEq(pure.cellSafe(null), '');
  assertEq(pure.cellSafe(undefined), '');
});
test('cellSafe: ordinary text pass-through', () => {
  assertEq(pure.cellSafe('Alice'), 'Alice');
  assertEq(pure.cellSafe(''), '');
  assertEq(pure.cellSafe('abc123'), 'abc123');
  assertEq(pure.cellSafe('alice@example.com'), 'alice@example.com');
  assertEq(pure.cellSafe('2026-01-01T10:00:00Z'), '2026-01-01T10:00:00Z');
});
test('cellSafe: formula triggers get a leading apostrophe', () => {
  assertEq(pure.cellSafe('=HYPERLINK("http://evil","x")'), "'=HYPERLINK(\"http://evil\",\"x\")");
  assertEq(pure.cellSafe('+1'), "'+1");
  assertEq(pure.cellSafe('-1'), "'-1");
  assertEq(pure.cellSafe('@tag'), "'@tag");
  assertEq(pure.cellSafe('|pipe'), "'|pipe");
});
test('cellSafe: leading whitespace does not bypass check', () => {
  assertEq(pure.cellSafe('   =SUM(A1:A2)'), "'   =SUM(A1:A2)");
  assertEq(pure.cellSafe('\t\n=A1'), "'\t\n=A1");
  assertEq(pure.cellSafe('\u00001-evil'), '\u00001-evil' /* NUL then "1-" - first non-ctrl is "1", OK */);
});
test('cellSafe: BOM/control-char + = still neutralized', () => {
  assertEq(pure.cellSafe('﻿=A1'), "'﻿=A1");
  assertEq(pure.cellSafe('​+1'), "'​+1");
});
test('cellSafe: an email like +1@example.com gets protected', () => {
  assertEq(pure.cellSafe('+1@example.com'), "'+1@example.com");
});

// validateLength / FIELD_LIMITS -----------------------------------------

test('validateLength: within limit passes', () => {
  pure.validateLength('short', 10, 'X');
});
test('validateLength: over limit throws', () => {
  assertThrows(() => pure.validateLength('a'.repeat(11), 10, 'X'));
});
test('FIELD_LIMITS: expected keys and sane values', () => {
  const keys = ['firstName', 'lastName', 'middleName', 'email', 'taskTitle'];
  keys.forEach(k => assert(pure.FIELD_LIMITS[k] > 0, k));
  assert(pure.FIELD_LIMITS.email >= 254, 'email cap at least 254');
});

// parseYmdStrictUtc (F-07) -----------------------------------------------

test('parseYmdStrictUtc: valid dates parse at UTC day boundaries', () => {
  const d = pure.parseYmdStrictUtc('2026-10-30', false);
  assertEq(d.toISOString(), '2026-10-30T00:00:00.000Z');
  const d2 = pure.parseYmdStrictUtc('2026-10-30', true);
  assertEq(d2.toISOString(), '2026-10-30T23:59:59.999Z');
});
test('parseYmdStrictUtc: rejects bad formats', () => {
  ['', '2024/01/01', 'Jan 1, 2024', '2024-1-1', '2024-01-01T00:00:00Z', null, undefined, 42]
    .forEach(x => assertThrows(() => pure.parseYmdStrictUtc(x, false), String(x)));
});
test('parseYmdStrictUtc: rejects impossible calendar dates', () => {
  assertThrows(() => pure.parseYmdStrictUtc('2024-02-30', false));
  assertThrows(() => pure.parseYmdStrictUtc('2024-13-01', false));
  assertThrows(() => pure.parseYmdStrictUtc('2024-00-05', false));
  assertThrows(() => pure.parseYmdStrictUtc('2024-04-31', false));  // 30-day month
});

// UserError marker -------------------------------------------------------

test('UserError: marked for safe surfacing', () => {
  const e = pure.UserError('something');
  // Not checking instanceof Error — different VM realm for pure.gs.
  assertEq(typeof e.message, 'string');
  assertEq(e.message, 'something');
  assertEq(e.userSafe, true);
});

// Scenario: cross-day session accounting --------------------------------

test('scenario: overnight gap is NOT counted', () => {
  const sessions = [
    { status: 'paused', startTime: '2026-01-15T23:00:00Z', endTime: '2026-01-15T23:30:00Z', durationMs: 30 * 60 * 1000 },
    { status: 'paused', startTime: '2026-01-16T09:00:00Z', endTime: '2026-01-16T09:10:00Z', durationMs: 10 * 60 * 1000 }
  ];
  assertEq(pure.sumSessionMs(sessions, Date.now()), 40 * 60 * 1000);
});
test('scenario: pre-midnight + post-midnight sessions, gap excluded', () => {
  // Sessions straddling midnight UTC (audit F-16).
  const sessions = [
    { status: 'paused', startTime: '2026-10-29T23:50:00Z', endTime: '2026-10-29T23:55:00Z', durationMs: 5 * 60 * 1000 },
    { status: 'paused', startTime: '2026-10-30T00:05:00Z', endTime: '2026-10-30T00:10:00Z', durationMs: 5 * 60 * 1000 }
  ];
  assertEq(pure.sumSessionMs(sessions, Date.now()), 10 * 60 * 1000);
});
test('scenario: report overlap for an active session clamped to range end', () => {
  const from = new Date('2026-01-15T00:00:00Z').getTime();
  const to = new Date('2026-01-15T23:59:59.999Z').getTime();
  const start = new Date('2026-01-15T22:00:00Z').getTime();
  const now = new Date('2026-01-16T05:00:00Z').getTime();
  assertNear(pure.overlapMs(start, null, from, to, now), 2 * 3600 * 1000, 1000);
});

// Demo helpers (F-20, F-21) ----------------------------------------------

test('validateLength: failure is a user-safe error (understandable message in the UI)', () => {
  const e = assertThrows(() => pure.validateLength('a'.repeat(11), 10, 'Last name'));
  assertEq(e.userSafe, true);
  assert(/Last name is too long/.test(e.message), e.message);
});
test('parseYmdStrictUtc: every rejection is user-safe', () => {
  ['2026-1-1', 'abc', '2026-02-30', '2026-13-01'].forEach(s => {
    const e = assertThrows(() => pure.parseYmdStrictUtc(s, false), s);
    assertEq(e.userSafe, true, s);
  });
});
test('isDemoEnvironmentName: only test/demo workbooks qualify', () => {
  assertEq(pure.isDemoEnvironmentName('Working Time Tracker — Test Env'), true);
  assertEq(pure.isDemoEnvironmentName('WTT Demo'), true);
  assertEq(pure.isDemoEnvironmentName('Payroll 2026'), false);
  assertEq(pure.isDemoEnvironmentName('Contest results'), false, 'substring must not match');
  assertEq(pure.isDemoEnvironmentName(''), false);
  assertEq(pure.isDemoEnvironmentName(null), false);
  assertEq(pure.isDemoEnvironmentName(undefined), false);
});
test('checkRowLimit: allows below the cap, refuses at the cap with a user-safe message', () => {
  pure.checkRowLimit(99, 100, 'Employees');
  const e = assertThrows(() => pure.checkRowLimit(100, 100, 'Employees'));
  assertEq(e.userSafe, true);
  assert(/Storage limit reached/.test(e.message), e.message);
});
test('checkRowLimit: a zero or missing cap means unlimited', () => {
  pure.checkRowLimit(1e6, 0, 'x');
  pure.checkRowLimit(1e6, undefined, 'x');
});
// Runner ----------------------------------------------------------------

let passed = 0;
const failures = [];
for (const t of tests) {
  try {
    t.fn();
    passed++;
    console.log('  OK   ' + t.name);
  } catch (err) {
    failures.push({ name: t.name, err });
    console.log('  FAIL ' + t.name + ' -- ' + err.message);
  }
}
console.log('\n' + passed + '/' + tests.length + ' passed');
if (failures.length) process.exit(1);
