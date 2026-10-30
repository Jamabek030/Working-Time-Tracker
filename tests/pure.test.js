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

// overlapMs ---------------------------------------------------------------

test('overlapMs: session fully inside range', () => {
  const r = pure.overlapMs(100, 200, 0, 1000, 10000);
  assertEq(r, 100);
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
  const sStart = '2024-01-01T10:00:00Z';
  const sEnd = '2024-01-01T11:30:00Z';
  assertEq(pure.overlapMs(sStart, sEnd, from, to, Date.now()), 90 * 60 * 1000);
});

test('overlapMs: zero-length session', () => {
  assertEq(pure.overlapMs(100, 100, 0, 1000, 10000), 0);
});

test('overlapMs: invalid dates return 0', () => {
  assertEq(pure.overlapMs('not-a-date', 100, 0, 1000, 10000), 0);
});

// sumSessionMs ------------------------------------------------------------

test('sumSessionMs: sums closed durations', () => {
  const s = [
    { status: 'paused', durationMs: 1000 },
    { status: 'paused', durationMs: 2000 },
    { status: 'completed', durationMs: 3000 }
  ];
  assertEq(pure.sumSessionMs(s, Date.now()), 6000);
});

test('sumSessionMs: active session uses now - start', () => {
  const now = 10000;
  const s = [
    { status: 'paused', durationMs: 1000 },
    { status: 'active', startTime: 7000, endTime: '' }
  ];
  assertEq(pure.sumSessionMs(s, now), 1000 + 3000);
});

test('sumSessionMs: ignores malformed rows', () => {
  const s = [
    { status: 'paused', durationMs: 'abc' },
    { status: 'paused', durationMs: null },
    { status: 'paused', durationMs: 500 }
  ];
  assertEq(pure.sumSessionMs(s, Date.now()), 500);
});

test('sumSessionMs: does not go negative if clock skews', () => {
  const now = 1000;
  const s = [{ status: 'active', startTime: 5000, endTime: '' }];
  assertEq(pure.sumSessionMs(s, now), 0);
});

// isValidEmail ------------------------------------------------------------

test('isValidEmail: accepts normal addresses', () => {
  assert(pure.isValidEmail('alice@example.com'));
  assert(pure.isValidEmail('a.b+tag@sub.example.co.uk'));
});

test('isValidEmail: rejects nonsense', () => {
  assert(!pure.isValidEmail(''));
  assert(!pure.isValidEmail('not-an-email'));
  assert(!pure.isValidEmail('missing@dot'));
  assert(!pure.isValidEmail('@no-local.com'));
  assert(!pure.isValidEmail('spaces @example.com'));
  assert(!pure.isValidEmail(null));
  assert(!pure.isValidEmail(undefined));
  assert(!pure.isValidEmail(42));
});

// sanitize ----------------------------------------------------------------

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

// nextStateAfter ----------------------------------------------------------

test('nextStateAfter: cannot start without a task', () => {
  const r = pure.nextStateAfter('start', false, false);
  assert(!r.ok);
});

test('nextStateAfter: cannot start twice', () => {
  const r = pure.nextStateAfter('start', true, true);
  assert(!r.ok);
});

test('nextStateAfter: start OK when idle with active task', () => {
  const r = pure.nextStateAfter('start', true, false);
  assert(r.ok);
});

test('nextStateAfter: cannot pause when nothing is running', () => {
  const r = pure.nextStateAfter('pause', true, false);
  assert(!r.ok);
});

test('nextStateAfter: pause OK when active session', () => {
  const r = pure.nextStateAfter('pause', true, true);
  assert(r.ok);
});

test('nextStateAfter: resume is like start', () => {
  assert(pure.nextStateAfter('resume', true, false).ok);
  assert(!pure.nextStateAfter('resume', true, true).ok);
});

test('nextStateAfter: finish OK whether running or not (as long as task exists)', () => {
  assert(pure.nextStateAfter('finish', true, true).ok);
  assert(pure.nextStateAfter('finish', true, false).ok);
  assert(!pure.nextStateAfter('finish', false, false).ok);
});

test('nextStateAfter: unknown action rejected', () => {
  assert(!pure.nextStateAfter('explode', true, false).ok);
});

// Scenario: cross-day session accounting -----------------------------------

test('scenario: overnight gap is NOT counted', () => {
  // Yesterday 23:00 to 23:30 then today 09:00 to 09:10. Must be 40 min, not ~34 h.
  const yesterday23 = new Date('2026-01-15T23:00:00Z').getTime();
  const yesterday2330 = new Date('2026-01-15T23:30:00Z').getTime();
  const today09 = new Date('2026-01-16T09:00:00Z').getTime();
  const today0910 = new Date('2026-01-16T09:10:00Z').getTime();
  const sessions = [
    { status: 'paused', startTime: yesterday23, endTime: yesterday2330, durationMs: 30 * 60 * 1000 },
    { status: 'paused', startTime: today09, endTime: today0910, durationMs: 10 * 60 * 1000 }
  ];
  const total = pure.sumSessionMs(sessions, Date.now());
  assertEq(total, 40 * 60 * 1000);
});

test('scenario: report overlap for an active session clamped to range end', () => {
  // Session started inside range, still active; now is after range end.
  const from = new Date('2026-01-15T00:00:00Z').getTime();
  const to = new Date('2026-01-15T23:59:59.999Z').getTime();
  const start = new Date('2026-01-15T22:00:00Z').getTime();
  const now = new Date('2026-01-16T05:00:00Z').getTime(); // 7h past range end
  const r = pure.overlapMs(start, null, from, to, now);
  assertNear(r, 2 * 3600 * 1000, 1000, 'overlap limited to 2h within range');
});

// -------------------------------------------------------------------------

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
if (failures.length) {
  process.exit(1);
}
