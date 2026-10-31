// Integrity of the generated company dataset (src/dataset.gs): the numbers the
// assessment relies on, referential consistency, a believable work calendar,
// determinism, and the absence of demonstration wording in the visible text.
const { loadAll } = require('./load-i18n');
const g = loadAll();

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + (msg || '')); }
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Expected ' + JSON.stringify(a) + ' to equal ' + JSON.stringify(b) + (msg ? ' - ' + msg : ''));
}

const NOW = Date.UTC(2026, 9, 31, 14, 30);
const TODAY = '2026-10-31';
function build(now) { let n = 0; return g.buildAssessmentDataset(now || NOW, () => 'tok' + (++n)); }
const d = build();
const POOL = d.tasks.filter(t => t.status === 'available');

test('dataset: exact counts of every table', () => {
  assertEq(d.employees.length, 10);
  assertEq(d.projects.length, 5);
  assertEq(d.tasks.length, 48);
  assertEq(d.sessions.length, 62);
  assertEq(d.comments.length, 12);
  assertEq(d.tasks.filter(t => t.status === 'draft').length, 2);
  assertEq(d.tasks.filter(t => t.status === 'completed').length, 14);
  assertEq(d.tasks.filter(t => t.status === 'active').length, 12);
});
test('dataset: ten distinct employees with example.com addresses and distinct tokens', () => {
  assertEq(new Set(d.employees.map(e => e.email.toLowerCase())).size, 10);
  assertEq(new Set(d.employees.map(e => [e.lastName, e.firstName, e.middleName].join(' '))).size, 10);
  assertEq(new Set(d.employees.map(e => e.workspaceToken)).size, 10);
  d.employees.forEach(e => {
    assert(/^[a-z]+\.[a-z]+@example\.com$/.test(e.email), e.email);
    assert(/^[Ѐ-ӿ]+$/.test(e.lastName) && /^[Ѐ-ӿ]+$/.test(e.firstName) && /^[Ѐ-ӿ]+$/.test(e.middleName), 'Russian full name');
    assertEq(e.active, true);
  });
});
test('dataset: generated records are distinguishable by their asm- ids and ids are unique', () => {
  ['projects', 'employees', 'tasks', 'sessions', 'comments', 'activity'].forEach(k => {
    d[k].forEach(r => assert(/^asm-[a-z]+-\d+$/.test(r.id), k + ' ' + r.id));
    assertEq(new Set(d[k].map(r => r.id)).size, d[k].length, k + ' ids unique');
  });
});
test('dataset: exactly 20 distinct Russian pool tasks, all available, unassigned and linked to a project', () => {
  assertEq(POOL.length, 20);
  assertEq(new Set(POOL.map(t => t.title)).size, 20, 'titles unique');
  const proj = new Set(d.projects.map(p => p.id));
  POOL.forEach(t => {
    assertEq(t.employeeId, '', t.title);
    assertEq(t.assignedAt, '', t.title);
    assert(proj.has(t.projectId), 'project of ' + t.title);
    assert(['low', 'medium', 'high'].indexOf(t.priority) >= 0, t.priority);
    assert(/[Ѐ-ӿ]/.test(t.title) && /[Ѐ-ӿ]/.test(t.description), 'Russian text');
    assert(/Ожидаемый результат:/.test(t.description), 'completion criterion: ' + t.title);
    assert(t.description.length <= 2000 && t.title.length <= 200);
    assert(!/[_]|\.(?:js|gs|html|csv)\b|\b(?:api|table|sheet)\b/i.test(t.title + ' ' + t.description), 'no internal labels: ' + t.title);
  });
  ['high', 'medium', 'low'].forEach(p => assert(POOL.some(t => t.priority === p), 'priority mix ' + p));
});
test('dataset: the 20 requested pool titles are present', () => {
  const want = ['систему управления клиентами', 'онлайн-запис', 'управления сотрудниками', 'мобильное приложение', 'уведомлени',
    'FinFlow', 'WorkSpace', 'ClientHub', 'ShopPilot', 'ReportPro', 'Windows Server', 'учётные записи', 'внутреннее программное', 'резервное копирование',
    'сервер разработки', 'медленной работы', 'командой дизайна', 'внутренний портал', 'отдела продаж', 'еженедельн'];
  const all = POOL.map(t => t.title).join('\n');
  want.forEach(w => assert(all.toLowerCase().indexOf(w.toLowerCase()) >= 0, 'no pool task mentions ' + w));
});
test('dataset: every project has tasks and every owned task has an employee, draft/available tasks have none', () => {
  const emp = new Set(d.employees.map(e => e.id));
  d.projects.forEach(p => assert(d.tasks.some(t => t.projectId === p.id), 'empty project ' + p.name));
  d.tasks.forEach(t => {
    if (t.status === 'draft' || t.status === 'available') assertEq(t.employeeId, '', t.title);
    else assert(emp.has(t.employeeId), 'owner of ' + t.title);
    assert(g.isValidPriority(t.priority), t.priority);
    g.normalizeDueDate(t.dueDate);
  });
});
test('dataset: scenario covers assigned, claimed-from-pool, paused, not started, completed and overdue tasks', () => {
  const claimed = new Set(d.activity.filter(a => a.action === 'claimed').map(a => a.taskId));
  const assigned = new Set(d.activity.filter(a => a.action === 'assigned').map(a => a.taskId));
  assert(claimed.size >= 3 && assigned.size >= 10, 'claimed ' + claimed.size + ' assigned ' + assigned.size);
  const withSessions = new Set(d.sessions.map(x => x.taskId));
  const active = d.tasks.filter(t => t.status === 'active');
  assert(active.some(t => withSessions.has(t.id)) && active.some(t => !withSessions.has(t.id)), 'paused and not-started tasks');
  assertEq(d.tasks.filter(t => g.isOverdue(t, TODAY)).length, 2);
});
test('dataset: every session, comment and activity row points at existing parents', () => {
  const emp = new Set(d.employees.map(e => e.id)), task = new Map(d.tasks.map(t => [t.id, t]));
  d.sessions.forEach(x => {
    assert(task.has(x.taskId) && emp.has(x.employeeId), 'parents of ' + x.id);
    assertEq(task.get(x.taskId).employeeId, x.employeeId, 'session by the task owner ' + x.id);
  });
  d.comments.forEach(c => { assert(task.has(c.taskId), 'comment task'); if (c.authorType === 'employee') assert(emp.has(c.authorId), 'comment author'); });
  d.activity.forEach(a => assert(task.has(a.taskId), 'activity task'));
});
test('dataset: sessions are finished weekday work blocks that never overlap and equal end minus start', () => {
  const by = {};
  d.sessions.forEach(x => {
    assertEq(x.durationMs, new Date(x.endTime) - new Date(x.startTime), x.id);
    assert(x.durationMs >= 15 * 60000 && x.durationMs <= 4.5 * 3600000, 'plausible length ' + x.id);
    assert(x.status === 'paused' || x.status === 'completed', 'no running session: ' + x.status);
    const s = new Date(x.startTime), e = new Date(x.endTime);
    assert(s.getUTCDay() % 6 !== 0, 'weekend ' + x.startTime);
    assertEq(s.toISOString().slice(0, 10), e.toISOString().slice(0, 10), 'one day ' + x.id);
    const sh = s.getUTCHours() + s.getUTCMinutes() / 60, eh = e.getUTCHours() + e.getUTCMinutes() / 60;
    assert(sh >= 8.99 && eh <= 19.51, 'working hours ' + x.startTime + ' ' + x.endTime);
    assert(Date.parse(x.endTime) < NOW, 'in the past');
    (by[x.employeeId] = by[x.employeeId] || []).push(x);
  });
  Object.keys(by).forEach(id => {
    const l = by[id].sort((a, b) => a.startTime < b.startTime ? -1 : 1);
    for (let i = 1; i < l.length; i++) assert(l[i].startTime >= l[i - 1].endTime, 'overlap for ' + id);
  });
});
test('dataset: sessions never start before their task was assigned or claimed', () => {
  const task = new Map(d.tasks.map(t => [t.id, t]));
  d.sessions.forEach(x => {
    const t = task.get(x.taskId);
    assert(t.assignedAt && x.startTime >= t.assignedAt, 'session before assignment ' + x.id);
    if (t.status === 'completed') assert(t.completedAt && t.completedAt >= x.endTime, 'completed before last session ' + t.title);
  });
});
test('dataset: completed tasks end with a completed session, the others with a paused one', () => {
  d.tasks.filter(t => t.status === 'completed' || (t.status === 'active' && d.sessions.some(x => x.taskId === t.id))).forEach(t => {
    const l = d.sessions.filter(x => x.taskId === t.id).sort((a, b) => a.startTime < b.startTime ? -1 : 1);
    assertEq(l[l.length - 1].status, t.status === 'completed' ? 'completed' : 'paused', t.title);
    l.slice(0, -1).forEach(x => assertEq(x.status, 'paused', 'earlier sessions are paused: ' + t.title));
  });
});
test('dataset: the activity log tells a consistent story for every task', () => {
  const known = ['created', 'published', 'assigned', 'claimed', 'started', 'resumed', 'paused', 'completed', 'commented'];
  d.tasks.forEach(t => {
    const log = d.activity.filter(a => a.taskId === t.id).sort((a, b) => a.at < b.at ? -1 : 1);
    assertEq(log[0].action, 'created', t.title);
    log.forEach(a => assert(known.indexOf(a.action) >= 0, a.action));
    assertEq(log.filter(a => a.action === 'created').length, 1, t.title);
  });
});
test('dataset: times are never in the future and employees joined before their first work', () => {
  const stamps = [].concat(d.tasks.map(t => t.createdAt), d.comments.map(c => c.createdAt), d.activity.map(a => a.at), d.employees.map(e => e.createdAt));
  stamps.forEach(s => assert(Date.parse(s) <= NOW, 'future stamp ' + s));
  d.sessions.forEach(x => {
    const e = d.employees.find(q => q.id === x.employeeId);
    assert(e.createdAt <= x.startTime, 'session before the employee joined ' + x.id);
  });
});
test('dataset: text survives the formula-injection guard unchanged and has no markup', () => {
  d.tasks.forEach(t => { assertEq(g.cellSafe(t.title), t.title); assertEq(g.cellSafe(t.description), t.description); assert(!/[<>]/.test(t.title + t.description)); });
  d.comments.forEach(c => { assertEq(g.cellSafe(c.text), c.text); assert(c.text.length <= 1000); });
  d.employees.forEach(e => assertEq(g.cellSafe(e.lastName + e.email), e.lastName + e.email));
});
test('dataset: report math over the sessions equals the sum of their durations', () => {
  const total = d.sessions.reduce((a, x) => a + x.durationMs, 0);
  const via = d.sessions.reduce((a, x) => a + g.overlapMs(x.startTime, x.endTime, Date.UTC(2000, 0, 1), Date.UTC(2100, 0, 1), NOW), 0);
  assertEq(via, total);
  assertEq(d.sessions.reduce((a, x) => a + g.overlapMs(x.startTime, x.endTime, Date.UTC(2000, 0, 1), Date.UTC(2000, 0, 2), NOW), 0), 0);
});
test('dataset: deterministic - the same moment gives the same rows apart from tokens; a later moment shifts the calendar', () => {
  const strip = x => JSON.stringify(x, (k, v) => k === 'workspaceToken' ? undefined : v);
  assertEq(strip(build()), strip(build()));
  const later = build(NOW + 7 * 86400000);
  assert(strip(later) !== strip(d));
  assertEq(later.sessions.length, d.sessions.length);
  assertEq(later.tasks.filter(t => t.status === 'available').length, 20);
});
test('dataset: every table is covered by the sheet headers (no invented columns)', () => {
  const fs = require('fs'), path = require('path');
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'src', 'Config.gs'), 'utf8');
  const map = { projects: 'PROJECTS', employees: 'EMPLOYEES', tasks: 'TASKS', sessions: 'SESSIONS', comments: 'COMMENTS', activity: 'ACTIVITY' };
  Object.keys(map).forEach(k => {
    const m = cfg.match(new RegExp(map[k] + ':\\s*\\[([^\\]]*)\\]'));
    assert(m, 'headers for ' + k);
    const headers = m[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
    Object.keys(d[k][0]).forEach(col => assert(headers.indexOf(col) >= 0, k + ' has no column ' + col));
  });
});

let passed = 0;
const failures = [];
for (const t of tests) {
  try { t.fn(); passed++; console.log('  OK   ' + t.name); }
  catch (err) { failures.push(t.name); console.log('  FAIL ' + t.name + ' -- ' + err.message); }
}
console.log('\n' + passed + '/' + tests.length + ' passed (dataset)');
if (failures.length) process.exitCode = 1;
