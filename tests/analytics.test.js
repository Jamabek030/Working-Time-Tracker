// Pure logic added for the dashboard, analytics, CSV export and invitations.
const { loadPure } = require('./load-pure');
const pure = loadPure();

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + (msg || '')); }
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Expected ' + JSON.stringify(a) + ' to equal ' + JSON.stringify(b) + (msg ? ' - ' + msg : ''));
}

const H = 3600000, DAY = 86400000;
const iso = ms => new Date(ms).toISOString();

// classifyWorkState -------------------------------------------------------------

const task = (id, status) => ({ id, status });
const sess = (taskId, start, status) => ({ taskId, startTime: iso(start), status });

test('classifyWorkState: running timer is working', () => {
  assertEq(pure.classifyWorkState([task('t', 'active')], [sess('t', 0, 'active')]), 'working');
});
test('classifyWorkState: latest closed session paused -> paused', () => {
  assertEq(pure.classifyWorkState([task('t', 'active')], [sess('t', 0, 'paused'), sess('t', H, 'paused')]), 'paused');
});
test('classifyWorkState: no sessions, no task, finished task -> idle', () => {
  assertEq(pure.classifyWorkState([task('t', 'active')], []), 'idle');
  assertEq(pure.classifyWorkState([], []), 'idle');
  assertEq(pure.classifyWorkState([task('t', 'completed')], [sess('t', 0, 'completed')]), 'idle');
});
test('classifyWorkState: a new task after a pause starts as idle (history is of the old task)', () => {
  assertEq(pure.classifyWorkState([task('old', 'replaced'), task('new', 'active')], [sess('old', 0, 'paused')]), 'idle');
});
test('classifyWorkState: uses the latest session regardless of input order', () => {
  assertEq(pure.classifyWorkState([task('t', 'active')], [sess('t', H, 'paused'), sess('t', 0, 'completed')]), 'paused');
});

// dailyBreakdown ------------------------------------------------------------------

const rangeFrom = Date.UTC(2026, 0, 1), rangeTo = Date.UTC(2026, 0, 5, 23, 59, 59, 999);
const reportTotal = sessions => sessions.reduce((a, s) => a + pure.overlapMs(s.startTime, s.endTime, rangeFrom, rangeTo, Date.UTC(2026, 0, 6)), 0);

test('dailyBreakdown: one bucket per UTC day, labelled', () => {
  const d = pure.dailyBreakdown([], rangeFrom, rangeTo, 0);
  assertEq(d.map(x => x.date), ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']);
  assertEq(d.every(x => x.ms === 0), true);
});
test('dailyBreakdown: a session across midnight is split exactly; the pause gap is not counted', () => {
  const s = [
    { startTime: iso(Date.UTC(2026, 0, 1, 22)), endTime: iso(Date.UTC(2026, 0, 2, 1)) },
    { startTime: iso(Date.UTC(2026, 0, 2, 9)), endTime: iso(Date.UTC(2026, 0, 2, 10)) }
  ];
  const d = pure.dailyBreakdown(s, rangeFrom, rangeTo, 0);
  assertEq(d[0].ms, 2 * H);
  assertEq(d[1].ms, 2 * H);
  assertEq(d.reduce((a, x) => a + x.ms, 0), 4 * H);
});
test('dailyBreakdown: buckets always sum to exactly the report total (partition property)', () => {
  const s = [
    { startTime: iso(Date.UTC(2026, 0, 1, 23, 59, 59, 999)), endTime: iso(Date.UTC(2026, 0, 2, 0, 0, 0, 1)) },
    { startTime: iso(Date.UTC(2025, 11, 31, 20)), endTime: iso(Date.UTC(2026, 0, 1, 3)) },
    { startTime: iso(Date.UTC(2026, 0, 5, 20)), endTime: iso(Date.UTC(2026, 0, 6, 8)) },
    { startTime: iso(Date.UTC(2026, 0, 3, 12)), endTime: iso(Date.UTC(2026, 0, 3, 12)) }
  ];
  const d = pure.dailyBreakdown(s, rangeFrom, rangeTo, Date.UTC(2026, 0, 7));
  assertEq(d.reduce((a, x) => a + x.ms, 0), reportTotal(s));
});
test('dailyBreakdown: an unfinished session counts up to "now" like the report', () => {
  const now = Date.UTC(2026, 0, 2, 12);
  const s = [{ startTime: iso(Date.UTC(2026, 0, 2, 10)), endTime: '' }];
  const d = pure.dailyBreakdown(s, rangeFrom, rangeTo, now);
  assertEq(d[1].ms, 2 * H);
  assertEq(d.reduce((a, x) => a + x.ms, 0), 2 * H);
});
test('dailyBreakdown: single-day range', () => {
  const d = pure.dailyBreakdown([{ startTime: iso(Date.UTC(2026, 0, 1, 1)), endTime: iso(Date.UTC(2026, 0, 1, 2)) }], rangeFrom, Date.UTC(2026, 0, 1, 23, 59, 59, 999), 0);
  assertEq(d.length, 1);
  assertEq(d[0].ms, H);
});

// CSV -----------------------------------------------------------------------------

test('csvCell: quotes, doubles quotes, keeps numbers numeric', () => {
  assertEq(pure.csvCell('plain'), '"plain"');
  assertEq(pure.csvCell('say "hi"'), '"say ""hi"""');
  assertEq(pure.csvCell('a,b\nc'), '"a,b\nc"');
  assertEq(pure.csvCell(42), '42');
  assertEq(pure.csvCell(null), '""');
  assertEq(pure.csvCell(undefined), '""');
});
test('csvCell: neutralises every formula trigger, including after whitespace and invisible characters', () => {
  ['=SUM(A1)', '+1', '-1+2', '@cmd', '|calc', '  =x', '\t=x', '\r=x', String.fromCharCode(0x200B) + '=x', String.fromCharCode(0xFEFF) + '+x'].forEach(v => {
    const out = pure.csvCell(v);
    assert(out.startsWith('"\''), JSON.stringify(v) + ' -> ' + out);
  });
});
test('csvCell: cyrillic and ordinary text are untouched; control characters are dropped', () => {
  assertEq(pure.csvCell('Иванов Пётр'), '"Иванов Пётр"');
  assertEq(pure.csvCell('a' + String.fromCharCode(0) + 'b' + String.fromCharCode(7)), '"ab"');
  assertEq(pure.csvCell('Mid=dle'), '"Mid=dle"');
});

const labels = { statuses: { paused: 'пауза' }, employee: 'Сотрудник' };
const rows = [{
  employeeId: 'e1', name: '=cmd|x', email: 'a@b.co',
  sessions: [
    { taskTitle: '+task', startTime: '2026-01-02T09:00:00.000Z', endTime: '2026-01-02T10:30:15.000Z', status: 'paused', overlapMs: 5415000 },
    { taskTitle: 'Open', startTime: '2026-01-03T09:00:00.000Z', endTime: '', status: 'active', overlapMs: 1000 }
  ]
}];
test('buildReportCsv: BOM, CRLF, header, one line per session, UTC columns', () => {
  const csv = pure.buildReportCsv(rows, labels);
  assertEq(csv.charCodeAt(0), 0xFEFF);
  const lines = csv.split('\r\n');
  assertEq(lines.length, 4);
  assertEq(lines[3], '');
  assert(lines[0].includes('"Сотрудник"') && lines[0].includes('"Date (UTC)"'), lines[0]);
  assertEq(lines[1].split(',').length, 9);
  assert(lines[1].includes('"2026-01-02"') && lines[1].includes('"2026-01-02 09:00:00"') && lines[1].includes('"2026-01-02 10:30:15"'), lines[1]);
  assert(lines[1].includes('"01:30:15"') && lines[1].includes(',5415,'), lines[1]);
  assert(lines[1].includes('"пауза"'), 'status localized');
  assert(lines[2].includes('"2026-01-03 09:00:00","","00:00:01",1,"active"'), lines[2]);
});
test('buildReportCsv: formula-looking employee and task text is neutralised', () => {
  const csv = pure.buildReportCsv(rows, labels);
  assert(csv.includes('"\'=cmd|x"') && csv.includes('"\'+task"'), csv);
  assertEq(csv.includes(',"=cmd'), false);
});
test('buildReportCsv: empty report is a valid header-only file', () => {
  const csv = pure.buildReportCsv([], {});
  assertEq(csv.split('\r\n').filter(Boolean).length, 1);
  assertEq(pure.buildReportCsv([{ name: 'x', email: 'y', sessions: [] }], {}).split('\r\n').filter(Boolean).length, 1);
});
test('buildReportCsv: duration column equals the in-range overlap, so it matches the report', () => {
  const csv = pure.buildReportCsv(rows, labels);
  const total = csv.split('\r\n').slice(1, 3).map(l => Number(l.split(',')[7])).reduce((a, b) => a + b, 0);
  assertEq(total, Math.round((5415000 + 1000) / 1000));
});

// invitations helpers ---------------------------------------------------------------

test('isReservedTestEmail: documentation/test domains are reserved, real ones are not', () => {
  ['a@example.com', 'a@EXAMPLE.org', 'a@sub.example.net', 'a@x.test', 'a@x.invalid', 'a@host.localhost', 'a@x.example', 'a@nodot'].forEach(e => assertEq(pure.isReservedTestEmail(e), true, e));
  ['a@gmail.com', 'a@corp-demo.io', 'a@notexample.com', 'a@example.com.evil.io', 'a@myexample.com'].forEach(e => assertEq(pure.isReservedTestEmail(e), false, e));
  assertEq(pure.isReservedTestEmail(undefined), false);
  assertEq(pure.isReservedTestEmail('no-at-sign'), false);
});
test('sanitizeMailText: no control characters or line breaks, capped length, trimmed', () => {
  assertEq(pure.sanitizeMailText('Bob\r\nBcc: x@y.z'), 'Bob Bcc: x@y.z');
  assertEq(pure.sanitizeMailText('a' + String.fromCharCode(0x2028) + 'b'), 'a b');
  assertEq(pure.sanitizeMailText('  x  '), 'x');
  const long = pure.sanitizeMailText('y'.repeat(500), 20);
  assertEq(long.length, 20);
  assertEq(pure.sanitizeMailText(null), '');
});
test('shortHash: stable, case-insensitive, distinguishes addresses, never contains the address', () => {
  assertEq(pure.shortHash('A@B.co'), pure.shortHash('a@b.co'));
  assert(pure.shortHash('a@b.co') !== pure.shortHash('a@b.cc'));
  assertEq(pure.shortHash('a@b.co').length, 16);
  assert(!pure.shortHash('alice@corp.io').includes('alice'));
});
test('isTestArtifactEmail: only the exact acceptance-run patterns', () => {
  ['demo.verifier.1730000000000@example.com', 'DEMO.VERIFIER.1@EXAMPLE.COM', 'inj.verifier@example.com'].forEach(e => assertEq(pure.isTestArtifactEmail(e), true, e));
  ['demo.verifier@example.com', 'demo.verifier.x@example.com', 'demo.verifier.12@example.org', 'xdemo.verifier.1@example.com', 'inj.verifier@corp.io', 'real@example.com', ''].forEach(e => assertEq(pure.isTestArtifactEmail(e), false, e));
});

// employee search / filter ------------------------------------------------------------

const people = [
  { id: '1', lastName: 'Иванов', firstName: 'Пётр', middleName: 'Сергеевич', email: 'petr@corp-demo.io', workState: 'working' },
  { id: '2', lastName: 'Rivera', firstName: 'Alex', middleName: '', email: 'alex.rivera@example.com', workState: 'paused' },
  { id: '3', lastName: 'Nguyen', firstName: 'Sam', middleName: 'Q', email: 'sam@example.com', workState: 'idle' }
];
const ids = l => l.map(x => x.id).join(',');

test('filterEmployees: no query and "all" returns everyone, input is not mutated', () => {
  const before = JSON.stringify(people);
  assertEq(ids(pure.filterEmployees(people, '', 'all')), '1,2,3');
  assertEq(ids(pure.filterEmployees(people, '   ', undefined)), '1,2,3');
  assertEq(JSON.stringify(people), before);
});
test('filterEmployees: matches name parts and email, case-insensitively, including Cyrillic', () => {
  assertEq(ids(pure.filterEmployees(people, 'RIVERA', 'all')), '2');
  assertEq(ids(pure.filterEmployees(people, 'иванов', 'all')), '1');
  assertEq(ids(pure.filterEmployees(people, 'ПЁТР', 'all')), '1');
  assertEq(ids(pure.filterEmployees(people, 'corp-demo', 'all')), '1');
  assertEq(ids(pure.filterEmployees(people, 'example.com', 'all')), '2,3');
  assertEq(ids(pure.filterEmployees(people, 'сергеевич', 'all')), '1');
});
test('filterEmployees: several words must all match (any order)', () => {
  assertEq(ids(pure.filterEmployees(people, 'alex rivera', 'all')), '2');
  assertEq(ids(pure.filterEmployees(people, 'rivera alex', 'all')), '2');
  assertEq(ids(pure.filterEmployees(people, 'alex sam', 'all')), '');
});
test('filterEmployees: status filter, alone and combined with search; empty result is an empty list', () => {
  assertEq(ids(pure.filterEmployees(people, '', 'working')), '1');
  assertEq(ids(pure.filterEmployees(people, '', 'paused')), '2');
  assertEq(ids(pure.filterEmployees(people, 'example', 'idle')), '3');
  assertEq(ids(pure.filterEmployees(people, 'example', 'working')), '');
  assertEq(pure.filterEmployees(people, 'zzz', 'all'), []);
  assertEq(pure.filterEmployees(null, 'x', 'all'), []);
});
test('filterEmployees: source is self-contained (shipped to the browser as text)', () => {
  const fn = require('vm').runInNewContext('(' + pure.filterEmployees.toString() + ')', {});
  assertEq(fn(people, 'sam', 'all').length, 1);
});

let passed = 0;
const failures = [];
for (const t of tests) {
  try { t.fn(); passed++; console.log('  OK   ' + t.name); }
  catch (err) { failures.push(t.name); console.log('  FAIL ' + t.name + ' -- ' + err.message); }
}
console.log('\n' + passed + '/' + tests.length + ' passed (analytics)');
if (failures.length) process.exitCode = 1;
