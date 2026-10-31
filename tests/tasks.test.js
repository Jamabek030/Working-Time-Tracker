// Pure logic of the task model: states and transitions, overdue, filtering and the
// integrity of the fictional sample data.
const { loadPure } = require('./load-pure');
const pure = loadPure();

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + (msg || '')); }
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Expected ' + JSON.stringify(a) + ' to equal ' + JSON.stringify(b) + (msg ? ' - ' + msg : ''));
}

// ---- transitions -------------------------------------------------------------------

test('transitions: the complete table', () => {
  assertEq(pure.TASK_TRANSITIONS, {
    draft: { publish: 'available', assign: 'active' },
    available: { unpublish: 'draft', claim: 'active', assign: 'active' },
    active: { complete: 'completed' },
    completed: {},
    replaced: {}
  });
});
test('transitions: every valid move and no invalid one', () => {
  const statuses = ['draft', 'available', 'active', 'completed', 'replaced'];
  const actions = ['publish', 'unpublish', 'claim', 'assign', 'complete'];
  let valid = 0;
  statuses.forEach(s => actions.forEach(a => {
    const next = pure.nextTaskStatus(s, a);
    const expected = pure.TASK_TRANSITIONS[s][a];
    assertEq(next, expected === undefined ? null : expected, s + ' + ' + a);
    if (next) valid++;
  }));
  assertEq(valid, 6);
});
test('transitions: a claimed or assigned task can never be claimed or assigned again; finished is final', () => {
  assertEq(pure.nextTaskStatus('active', 'claim'), null);
  assertEq(pure.nextTaskStatus('active', 'assign'), null);
  assertEq(pure.nextTaskStatus('active', 'unpublish'), null);
  ['publish', 'unpublish', 'claim', 'assign', 'complete'].forEach(a => assertEq(pure.nextTaskStatus('completed', a), null, a));
  assertEq(pure.nextTaskStatus('nonsense', 'claim'), null);
  assertEq(pure.nextTaskStatus('available', 'toString'), null, 'prototype names are not actions');
  assertEq(pure.nextTaskStatus('constructor', 'claim'), null);
});
test('transitions: two claims in a row - exactly one succeeds', () => {
  let status = 'available';
  const attempt = () => { const n = pure.nextTaskStatus(status, 'claim'); if (n) status = n; return !!n; };
  assertEq([attempt(), attempt()], [true, false]);
});

// ---- displayed status ------------------------------------------------------------------

const ses = (status, start) => ({ status, startTime: start });
test('deriveTaskStatus: stored statuses other than active pass through', () => {
  ['draft', 'available', 'completed', 'replaced'].forEach(s => assertEq(pure.deriveTaskStatus({ status: s }, [ses('active', 'x')]), s));
});
test('deriveTaskStatus: assigned -> in_progress -> paused -> in_progress', () => {
  const t = { status: 'active' };
  assertEq(pure.deriveTaskStatus(t, []), 'assigned');
  assertEq(pure.deriveTaskStatus(t, [ses('active', '2026-01-01T10:00:00Z')]), 'in_progress');
  assertEq(pure.deriveTaskStatus(t, [ses('paused', '2026-01-01T10:00:00Z')]), 'paused');
  assertEq(pure.deriveTaskStatus(t, [ses('paused', '2026-01-01T10:00:00Z'), ses('active', '2026-01-01T11:00:00Z')]), 'in_progress');
});
test('deriveTaskStatus: judged by the latest session regardless of input order', () => {
  const t = { status: 'active' };
  assertEq(pure.deriveTaskStatus(t, [ses('paused', '2026-01-01T12:00:00Z'), ses('paused', '2026-01-01T09:00:00Z')]), 'paused');
  assertEq(pure.deriveTaskStatus(t, undefined), 'assigned');
});

// ---- deadlines and priorities --------------------------------------------------------------

test('isOverdue: only unfinished tasks with a past deadline', () => {
  const today = '2026-10-31';
  assertEq(pure.isOverdue({ dueDate: '2026-10-30', status: 'active' }, today), true);
  assertEq(pure.isOverdue({ dueDate: '2026-10-30', status: 'available' }, today), true);
  assertEq(pure.isOverdue({ dueDate: '2026-10-31', status: 'active' }, today), false, 'due today is not overdue yet');
  assertEq(pure.isOverdue({ dueDate: '2026-11-01', status: 'active' }, today), false);
  assertEq(pure.isOverdue({ dueDate: '2026-10-30', status: 'completed' }, today), false);
  assertEq(pure.isOverdue({ dueDate: '2026-10-30', status: 'replaced' }, today), false);
  assertEq(pure.isOverdue({ dueDate: '', status: 'active' }, today), false);
  assertEq(pure.isOverdue(null, today), false);
});
test('normalizeDueDate: empty or a strict calendar date, nothing else', () => {
  assertEq(pure.normalizeDueDate(''), '');
  assertEq(pure.normalizeDueDate(undefined), '');
  assertEq(pure.normalizeDueDate(' 2026-12-31 '), '2026-12-31');
  ['2026-02-30', '2026-13-01', '31.12.2026', 'tomorrow', '2026-1-1'].forEach(v => {
    const e = (() => { try { pure.normalizeDueDate(v); } catch (x) { return x; } return null; })();
    assert(e && e.userSafe === true, v + ' must be refused with a user-safe error');
  });
});
test('priorities: three levels, unknown values fall back to medium for display and are invalid for input', () => {
  assertEq(pure.TASK_PRIORITIES, ['low', 'medium', 'high']);
  assertEq(pure.normalizePriority('HIGH'), 'high');
  assertEq(pure.normalizePriority(''), 'medium');
  assertEq(pure.normalizePriority('urgent'), 'medium');
  assertEq(pure.isValidPriority('high'), true);
  assertEq(pure.isValidPriority('urgent'), false);
  assertEq(pure.isValidPriority(''), false);
});
test('countByStatus: counts every known status, ignores unknown ones', () => {
  assertEq(pure.countByStatus(['draft', 'assigned', 'assigned', 'completed', 'weird']), { draft: 1, available: 0, assigned: 2, in_progress: 0, paused: 0, completed: 1, replaced: 0 });
});

// ---- task filter ------------------------------------------------------------------------------------

const T = [
  { id: '1', title: 'Fix login', description: 'OAuth redirect', projectId: 'p1', projectName: 'Backend', employeeId: 'e1', employeeName: 'Rivera Alex', priority: 'high', displayStatus: 'in_progress', dueDate: '2026-10-30', overdue: true },
  { id: '2', title: 'Write docs', description: '', projectId: 'p2', projectName: 'Docs', employeeId: '', employeeName: '', priority: 'low', displayStatus: 'available', dueDate: '2026-11-03', overdue: false },
  { id: '3', title: 'Review чек-лист', description: 'onboarding', projectId: '', projectName: '', employeeId: 'e2', employeeName: 'Nguyen Sam', priority: 'medium', displayStatus: 'paused', dueDate: '', overdue: false }
];
const ids = l => l.map(x => x.id).join(',');
const base = { today: '2026-10-31', weekEnd: '2026-11-07' };
test('filterTasks: no filters returns everything without mutating the input', () => {
  const before = JSON.stringify(T);
  assertEq(ids(pure.filterTasks(T, base)), '1,2,3');
  assertEq(ids(pure.filterTasks(T)), '1,2,3');
  assertEq(JSON.stringify(T), before);
});
test('filterTasks: by project, status, priority and employee', () => {
  assertEq(ids(pure.filterTasks(T, Object.assign({ projectId: 'p1' }, base))), '1');
  assertEq(ids(pure.filterTasks(T, Object.assign({ projectId: '__none' }, base))), '3');
  assertEq(ids(pure.filterTasks(T, Object.assign({ status: 'available' }, base))), '2');
  assertEq(ids(pure.filterTasks(T, Object.assign({ priority: 'medium' }, base))), '3');
  assertEq(ids(pure.filterTasks(T, Object.assign({ employeeId: 'e2' }, base))), '3');
  assertEq(ids(pure.filterTasks(T, Object.assign({ employeeId: '__none' }, base))), '2');
});
test('filterTasks: deadline filters (overdue, due within a week, none)', () => {
  assertEq(ids(pure.filterTasks(T, Object.assign({ deadline: 'overdue' }, base))), '1');
  assertEq(ids(pure.filterTasks(T, Object.assign({ deadline: 'week' }, base))), '2');
  assertEq(ids(pure.filterTasks(T, Object.assign({ deadline: 'none' }, base))), '3');
});
test('filterTasks: text search over title, description, project and employee; Cyrillic and combined filters', () => {
  assertEq(ids(pure.filterTasks(T, Object.assign({ q: 'OAUTH' }, base))), '1');
  assertEq(ids(pure.filterTasks(T, Object.assign({ q: 'nguyen' }, base))), '3');
  assertEq(ids(pure.filterTasks(T, Object.assign({ q: 'ЧЕК-ЛИСТ' }, base))), '3');
  assertEq(ids(pure.filterTasks(T, Object.assign({ q: 'docs write' }, base))), '2');
  assertEq(ids(pure.filterTasks(T, Object.assign({ q: 'docs', status: 'paused' }, base))), '');
  assertEq(pure.filterTasks(T, Object.assign({ q: 'zzz' }, base)), []);
});
test('filterTasks: source is self-contained (shipped to the browser as text)', () => {
  const fn = require('vm').runInNewContext('(' + pure.filterTasks.toString() + ')', {});
  assertEq(fn(T, { q: 'docs' }).length, 1);
});

// ---- sample data integrity ----------------------------------------------------------------------------

function sample() { let n = 0; return pure.buildDemoSample(Date.UTC(2026, 9, 31, 12), () => 'id' + (++n), () => 'tok' + (++n)); }
test('sample: every task, session, comment and activity row points at an existing parent', () => {
  const s = sample();
  const emp = new Set(s.employees.map(e => e.id)), proj = new Set(s.projects.map(p => p.id)), task = new Set(s.tasks.map(t => t.id));
  s.tasks.forEach(t => { if (t.employeeId) assert(emp.has(t.employeeId), 'task employee'); if (t.projectId) assert(proj.has(t.projectId), 'task project'); });
  s.sessions.forEach(x => { assert(task.has(x.taskId) && emp.has(x.employeeId), 'session parents'); });
  s.comments.forEach(c => { assert(task.has(c.taskId), 'comment task'); if (c.authorType === 'employee') assert(emp.has(c.authorId), 'comment author'); });
  s.activity.forEach(a => assert(task.has(a.taskId), 'activity task'));
});
test('sample: statuses and owners are consistent with the transition rules', () => {
  const s = sample();
  s.tasks.forEach(t => {
    assert(['draft', 'available', 'active', 'completed', 'replaced'].indexOf(t.status) >= 0, t.status);
    if (t.status === 'draft' || t.status === 'available') assertEq(t.employeeId, '', 'unowned tasks have no employee: ' + t.title);
    else assert(t.employeeId, 'owned tasks have an employee: ' + t.title);
    assert(pure.isValidPriority(t.priority), t.priority);
    pure.normalizeDueDate(t.dueDate);
  });
  const statuses = s.tasks.map(t => t.status);
  ['draft', 'available', 'active', 'completed'].forEach(k => assert(statuses.indexOf(k) >= 0, 'sample has a ' + k + ' task'));
});
test('sample: shows an overdue task and tasks with and without deadlines', () => {
  const s = sample();
  const today = '2026-10-31';
  assertEq(s.tasks.filter(t => pure.isOverdue(t, today)).length, 1);
  assert(s.tasks.some(t => !t.dueDate) && s.tasks.some(t => t.dueDate > today));
});
test('sample: comments are plain text, from both sides, and survive the formula guard unchanged', () => {
  const s = sample();
  assert(s.comments.some(c => c.authorType === 'manager') && s.comments.some(c => c.authorType === 'employee'));
  s.comments.forEach(c => assertEq(pure.cellSafe(c.text), c.text));
});
test('sample: the activity log tells a consistent story (created before assigned/published before started)', () => {
  const s = sample();
  const order = { created: 0, published: 1, assigned: 1, claimed: 1, started: 2, paused: 3, completed: 3 };
  s.tasks.forEach(t => {
    const log = s.activity.filter(a => a.taskId === t.id).sort((a, b) => a.at < b.at ? -1 : 1);
    assertEq(log[0].action, 'created', t.title);
    log.forEach(a => assert(order[a.action] !== undefined, 'known action ' + a.action));
  });
});

let passed = 0;
const failures = [];
for (const t of tests) {
  try { t.fn(); passed++; console.log('  OK   ' + t.name); }
  catch (err) { failures.push(t.name); console.log('  FAIL ' + t.name + ' -- ' + err.message); }
}
console.log('\n' + passed + '/' + tests.length + ' passed (tasks)');
if (failures.length) process.exitCode = 1;
