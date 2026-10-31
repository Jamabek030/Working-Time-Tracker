// Pure, dependency-free helpers.
// Testable in Node.js (see tests/pure.test.js) and executed verbatim inside Google Apps Script.

// --- time -----------------------------------------------------------------

function overlapMs(sessionStart, sessionEnd, rangeFrom, rangeTo, nowMs) {
  var start = toMs_(sessionStart);
  var end = sessionEnd ? toMs_(sessionEnd) : nowMs;
  var from = toMs_(rangeFrom);
  var to = toMs_(rangeTo);
  if (start === null || end === null || from === null || to === null) return 0;
  if (end < start) return 0;
  var a = start > from ? start : from;
  var b = end < to ? end : to;
  var diff = b - a;
  return diff > 0 ? diff : 0;
}

// Returns { totalMs, warnings } so callers can surface rows that could not be
// counted. `warnings` is an array of { sessionId, reason } entries. Fallback
// policy for closed rows: if `durationMs` is unusable but startTime/endTime
// are both valid and consistent, derive the duration from the timestamps; if
// nothing is recoverable, skip the row and record a warning.
function sumSessionMsWithDiagnostics(sessions, nowMs) {
  var total = 0;
  var warnings = [];
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    if (s.status === 'active') {
      var startActive = toMs_(s.startTime);
      if (startActive === null) {
        warnings.push({ sessionId: s.id, reason: 'active row has unparseable startTime' });
        continue;
      }
      var delta = nowMs - startActive;
      total += delta > 0 ? delta : 0;
      continue;
    }
    var raw = s.durationMs;
    if (raw !== '' && raw !== null && raw !== undefined) {
      var d = Number(raw);
      if (isFinite(d) && d >= 0) {
        total += d;
        continue;
      }
    }
    // Fallback: compute from endpoints.
    var sMs = toMs_(s.startTime);
    var eMs = toMs_(s.endTime);
    if (sMs !== null && eMs !== null && eMs >= sMs) {
      total += eMs - sMs;
      warnings.push({ sessionId: s.id, reason: 'durationMs missing/invalid; computed from timestamps' });
      continue;
    }
    warnings.push({ sessionId: s.id, reason: 'closed row has no recoverable duration' });
  }
  return { totalMs: total, warnings: warnings };
}

function sumSessionMs(sessions, nowMs) {
  return sumSessionMsWithDiagnostics(sessions, nowMs).totalMs;
}

// --- validation -----------------------------------------------------------

function isValidEmail(s) {
  if (typeof s !== 'string') return false;
  // RFC 5321 practical cap. The regex is intentionally conservative.
  if (s.length > FIELD_LIMITS.email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function sanitize(s) {
  if (s === undefined || s === null) return '';
  return String(s).trim();
}

// Length budget per user-controlled text field (characters, after trim).
// Values match common schema sizes and are safely below Sheets' 50k/cell cap.
var FIELD_LIMITS = {
  firstName: 100,
  lastName: 100,
  middleName: 100,
  email: 320,
  taskTitle: 500,
  description: 2000,
  comment: 1000,
  projectName: 100
};

function validateLength(value, limit, fieldLabel) {
  if (typeof value !== 'string') return;
  if (value.length > limit) {
    throw UserError(fieldLabel + ' is too long (max ' + limit + ' characters).');
  }
}

// --- state transitions ----------------------------------------------------

function nextStateAfter(action, hasActiveTask, hasActiveSession) {
  if (!hasActiveTask) return { ok: false, error: 'No active task.' };
  if (action === 'start' || action === 'resume') {
    if (hasActiveSession) return { ok: false, error: 'A session is already running.' };
    return { ok: true };
  }
  if (action === 'pause') {
    if (!hasActiveSession) return { ok: false, error: 'No active session to pause.' };
    return { ok: true };
  }
  if (action === 'finish') {
    return { ok: true };
  }
  return { ok: false, error: 'Unknown action.' };
}

// --- spreadsheet cell safety ---------------------------------------------
// Google Sheets evaluates a cell as a formula when its string value begins
// with `=`, `+`, `-`, `@`, or `|`. Attackers can inject functions like
// IMPORTDATA/IMPORTXML/HYPERLINK to exfiltrate data or redirect the viewer.
// cellSafe prepends a single apostrophe (Sheets' text sentinel) to any string
// whose first non-whitespace/control character is a formula trigger. Numbers,
// Dates, booleans, null and undefined are returned untouched so numeric
// values, timestamps and IDs stay typed as themselves.
function cellSafe(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  if (value === '') return '';
  // Trim leading whitespace, BOM and C0 controls when deciding whether the
  // first "real" character is a formula trigger. We do NOT mutate the
  // returned string in that case — only prefix it, so the leading whitespace
  // the user typed is still preserved.
  var head = value.replace(/^[\s\u0000-\u001F​‌‍‎‏﻿]+/, '');
  if (head.length === 0) return value;
  var ch = head.charAt(0);
  if (ch === '=' || ch === '+' || ch === '-' || ch === '@' || ch === '|') {
    return "'" + value;
  }
  return value;
}

// --- date parsing (reports) ----------------------------------------------
// Strict YYYY-MM-DD. Interpreted as a UTC calendar day; endOfDay=true picks
// the inclusive end-of-day. Rejects impossible dates like 2024-02-30.
function parseYmdStrictUtc(s, endOfDay) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw UserError('Date must be in YYYY-MM-DD format.');
  }
  var parts = s.split('-');
  var y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    throw UserError('Date components out of range.');
  }
  var ms = Date.UTC(y, m - 1, d,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0);
  var dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw UserError('Invalid calendar date.');
  }
  return dt;
}

// --- demo environment helpers ------------------------------------------------
// The public demonstration only ever serves a spreadsheet that identifies
// itself as a test/demo one by name. A production workbook (whose title does
// not contain the word "test" or "demo") therefore fails closed.
function isDemoEnvironmentName(name) {
  return typeof name === 'string' && /\b(test|demo)\b/i.test(name);
}

// Caps how much an anonymous audience can write into the demo spreadsheet.
function checkRowLimit(currentRows, limit, label) {
  if (limit > 0 && currentRows >= limit) {
    throw UserError('Demo limit reached: at most ' + limit + ' ' + label +
      ' can be stored. Ask the maintainer to reset the demo data.');
  }
}

// Fictional sample dataset for the public demonstration. Pure: ids and tokens
// are injected so Node can test the invariants (no overlapping sessions,
// durationMs == end - start, exactly one active task per sample employee, only
// reserved example.com addresses, every task/comment/activity row points at an
// existing parent). Every session lies on a whole past day relative to `nowMs`,
// so no session is ever "running"; due dates are relative to today so the
// overdue indicator can be seen.
function buildDemoSample(nowMs, newId, newToken) {
  var DAY = 86400000;
  var midnight = nowMs - (nowMs % DAY);
  function at(daysAgo, hour, minute) {
    return new Date(midnight - daysAgo * DAY + (hour * 60 + minute) * 60000).toISOString();
  }
  function ymd(daysFromToday) { return ymdUtc(midnight + daysFromToday * DAY); }
  var projects = [], employees = [], tasks = [], sessions = [], comments = [], activity = [];

  function addProject(name, description, createdDaysAgo) {
    var p = { id: newId(), name: name, description: description, status: 'active', createdAt: at(createdDaysAgo, 8, 0) };
    projects.push(p);
    return p;
  }
  function addEmployee(last, first, middle, email, createdDaysAgo) {
    var e = { id: newId(), lastName: last, firstName: first, middleName: middle, email: email,
      workspaceToken: newToken(), createdAt: at(createdDaysAgo, 8, 0), active: true };
    employees.push(e);
    return e;
  }
  function logActivity(task, when, actorType, actorId, action, detail) {
    activity.push({ id: newId(), taskId: task.id, at: when, actorType: actorType, actorId: actorId || '', action: action, detail: detail || '' });
  }
  function addTask(emp, project, title, status, createdAt, completedAt, o) {
    o = o || {};
    var t = { id: newId(), employeeId: emp ? emp.id : '', title: title, status: status, createdAt: createdAt,
      completedAt: completedAt || '', projectId: project ? project.id : '', priority: o.priority || 'medium',
      dueDate: o.due || '', description: o.description || '', assignedAt: emp ? createdAt : '' };
    tasks.push(t);
    logActivity(t, createdAt, 'manager', '', 'created', t.priority);
    if (status === 'available') logActivity(t, createdAt, 'manager', '', 'published', '');
    if (emp) logActivity(t, createdAt, 'manager', '', 'assigned', emp.firstName + ' ' + emp.lastName);
    if (status === 'completed') logActivity(t, completedAt, 'employee', emp.id, 'completed', '');
    return t;
  }
  function addSession(emp, task, start, end, status) {
    sessions.push({ id: newId(), employeeId: emp.id, taskId: task.id, startTime: start, endTime: end,
      durationMs: new Date(end).getTime() - new Date(start).getTime(), status: status });
    logActivity(task, start, 'employee', emp.id, 'started', '');
    logActivity(task, end, 'employee', emp.id, status === 'completed' ? 'completed' : 'paused', '');
  }
  function addComment(task, authorType, emp, text, when) {
    comments.push({ id: newId(), taskId: task.id, authorType: authorType, authorId: emp ? emp.id : '',
      authorName: emp ? emp.firstName + ' ' + emp.lastName : '', text: text, createdAt: when });
  }

  var backend = addProject('Backend', 'API and database work', 9);
  var frontend = addProject('Frontend', 'Web interface', 9);
  var qa = addProject('QA', 'Testing and quality', 9);

  var alex = addEmployee('Rivera', 'Alex', '', 'alex.rivera@example.com', 6);
  var a1 = addTask(alex, frontend, 'Draft onboarding checklist', 'replaced', at(6, 8, 0), at(4, 17, 0), { priority: 'medium' });
  addSession(alex, a1, at(6, 9, 0), at(6, 10, 30), 'paused');
  addSession(alex, a1, at(5, 9, 15), at(5, 11, 45), 'paused');
  addSession(alex, a1, at(4, 13, 0), at(4, 13, 40), 'paused');
  var a2 = addTask(alex, qa, 'Review test plan', 'active', at(4, 17, 0), '', { priority: 'high', due: ymd(2), description: 'Check coverage of the timer scenarios and note gaps.' });
  addSession(alex, a2, at(3, 10, 0), at(3, 12, 0), 'paused');
  addSession(alex, a2, at(1, 14, 0), at(1, 15, 30), 'paused');
  addComment(a2, 'manager', null, 'Please attach the test results when you finish.', at(2, 10, 0));
  addComment(a2, 'employee', alex, 'Will do. The second pass is planned for Friday.', at(2, 11, 30));

  var sam = addEmployee('Nguyen', 'Sam', 'Q', 'sam.nguyen@example.com', 8);
  var b1 = addTask(sam, frontend, 'Prototype report filters', 'completed', at(8, 8, 0), at(7, 10, 0), { priority: 'medium', due: ymd(-6) });
  addSession(sam, b1, at(8, 9, 0), at(8, 11, 0), 'paused');
  addSession(sam, b1, at(7, 9, 0), at(7, 10, 0), 'completed');
  var b2 = addTask(sam, frontend, 'Write demo walkthrough', 'active', at(7, 10, 30), '', { priority: 'medium', due: ymd(-1), description: 'Short step-by-step script for reviewers.' });
  addSession(sam, b2, at(2, 11, 0), at(2, 11, 45), 'paused');
  addComment(b2, 'employee', sam, 'Waiting for the walkthrough script to be approved.', at(1, 9, 0));

  addTask(null, backend, 'Optimize database queries', 'available', at(3, 9, 0), '', { priority: 'high', due: ymd(5), description: 'Profile the slowest report queries and propose indexes.' });
  addTask(null, backend, 'Write unit tests for the new API methods', 'available', at(3, 9, 5), '', { priority: 'medium', due: ymd(3), description: 'Cover validation and error paths.' });
  addTask(null, frontend, 'Prepare the design presentation', 'available', at(2, 15, 0), '', { priority: 'low', description: 'Slides for the next interface review.' });
  addTask(null, qa, 'Review email templates', 'draft', at(1, 16, 0), '', { priority: 'medium', due: ymd(7) });

  return { projects: projects, employees: employees, tasks: tasks, sessions: sessions, comments: comments, activity: activity };
}

// --- work state, analytics, CSV, invitations (all pure) ----------------------

// 'working' = a timer is running; 'paused' = the active task's latest closed
// session ended as paused; otherwise 'idle'.
function classifyWorkState(tasks, sessions) {
  tasks = tasks || [];
  sessions = sessions || [];
  for (var i = 0; i < sessions.length; i++) if (sessions[i].status === 'active') return 'working';
  var activeTask = null;
  for (var j = 0; j < tasks.length; j++) if (tasks[j].status === 'active') { activeTask = tasks[j]; break; }
  if (!activeTask) return 'idle';
  var mine = sessions.filter(function (s) { return s.taskId === activeTask.id; });
  if (!mine.length) return 'idle';
  mine.sort(function (a, b) { return a.startTime < b.startTime ? -1 : (a.startTime > b.startTime ? 1 : 0); });
  return mine[mine.length - 1].status === 'paused' ? 'paused' : 'idle';
}

function ymdUtc(ms) {
  var d = new Date(ms);
  var m = d.getUTCMonth() + 1, day = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

// Per-UTC-day tracked time inside [fromMs, toMs]. The windows partition the
// range exactly, so the daily values always sum to the same total that
// overlapMs() gives for the whole range (and therefore to the report total).
function dailyBreakdown(sessions, fromMs, toMs, nowMs) {
  var DAY = 86400000;
  var out = [];
  for (var start = fromMs; start <= toMs; start += DAY) {
    var end = Math.min(start + DAY, toMs);
    var total = 0;
    for (var i = 0; i < sessions.length; i++) {
      total += overlapMs(sessions[i].startTime, sessions[i].endTime, start, end, nowMs);
    }
    out.push({ date: ymdUtc(start), ms: total });
  }
  return out;
}

// One CSV cell. Strings are always quoted, quotes doubled, control characters
// removed, and a leading apostrophe is added when the first meaningful
// character could make a spreadsheet evaluate the cell as a formula. Numbers
// are written as-is (they are produced by the application, never by users).
// First meaningful character (after whitespace / zero-width / BOM) that makes a spreadsheet
// treat a cell as a formula.
var CSV_FORMULA_LEAD_ = new RegExp('^[\\s' + String.fromCharCode(0x200B) + '-' + String.fromCharCode(0x200F) +
  String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + String.fromCharCode(0xFEFF) + ']*[=+\\-@|]');

function csvCell(value) {
  if (typeof value === 'number' && isFinite(value)) return String(value);
  var s = (value === null || value === undefined) ? '' : String(value);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (CSV_FORMULA_LEAD_.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function fmtUtcStamp_(iso) {
  var ms = toMs_(iso);
  if (ms === null) return '';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function fmtHms_(ms) {
  ms = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  var h = Math.floor(ms / 3600), m = Math.floor((ms % 3600) / 60), s = ms % 60;
  return [h, m, s].map(function (x) { return (x < 10 ? '0' : '') + x; }).join(':');
}

// rows: output of reports_generate_ (optionally filtered). labels: localized
// column names and status names. All times are UTC. A UTF-8 BOM is prepended so
// Excel opens Cyrillic text correctly.
function buildReportCsv(rows, labels) {
  labels = labels || {};
  var head = [labels.employee || 'Employee', labels.email || 'Email', labels.project || 'Project', labels.task || 'Task',
    labels.date || 'Date (UTC)', labels.start || 'Start (UTC)', labels.end || 'End (UTC)',
    labels.durationHms || 'Duration (hh:mm:ss)', labels.durationSec || 'Duration (seconds)', labels.status || 'Status'];
  var lines = [head.map(csvCell).join(',')];
  (rows || []).forEach(function (r) {
    (r.sessions || []).forEach(function (s) {
      var statusName = (labels.statuses && labels.statuses[s.status]) || s.status;
      lines.push([
        r.name, r.email, s.projectName || '', s.taskTitle,
        fmtUtcStamp_(s.startTime).slice(0, 10), fmtUtcStamp_(s.startTime), fmtUtcStamp_(s.endTime),
        fmtHms_(s.overlapMs), Math.round(s.overlapMs / 1000), statusName
      ].map(csvCell).join(','));
    });
  });
  return String.fromCharCode(0xFEFF) + lines.join('\r\n') + '\r\n';
}

// Reserved/documentation domains never receive real mail (RFC 2606 / 6761).
function isReservedTestEmail(email) {
  if (typeof email !== 'string') return false;
  var at = email.lastIndexOf('@');
  if (at < 0) return false;
  var d = email.slice(at + 1).toLowerCase();
  var reservedDomains = ['example.com', 'example.org', 'example.net'];
  for (var i = 0; i < reservedDomains.length; i++) {
    if (d === reservedDomains[i] || d.slice(-(reservedDomains[i].length + 1)) === '.' + reservedDomains[i]) return true;
  }
  var tld = d.slice(d.lastIndexOf('.') + 1);
  return tld === 'test' || tld === 'example' || tld === 'invalid' || tld === 'localhost' || d.indexOf('.') < 0;
}

// Plain-text-only mail: control characters (CR/LF/NUL/U+2028...) are replaced
// by spaces so user-controlled text cannot inject lines, and the length is capped.
function sanitizeMailText(s, maxLen) {
  var t = (s === null || s === undefined ? '' : String(s))
    .replace(/[\x00-\x1F\x7F]+/g, ' ')
    .split(String.fromCharCode(0x2028)).join(' ').split(String.fromCharCode(0x2029)).join(' ')
    .replace(/\s+/g, ' ').trim();
  maxLen = maxLen || 100;
  return t.length > maxLen ? t.slice(0, maxLen - 1) + String.fromCharCode(0x2026) : t;
}

// Non-cryptographic 64-bit-ish digest used only to count invitations per
// recipient without writing the address a second time.
function shortHash(str) {
  var a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  str = String(str === null || str === undefined ? '' : str).toLowerCase();
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    a ^= c; a = (a + ((a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24))) >>> 0;
    b ^= c; b = (Math.imul ? Math.imul(b, 0x01000193) : (b * 16777619)) >>> 0;
  }
  var hex = function (n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); };
  return hex(a) + hex(b);
}

// Records created by the project's own acceptance runs (see tests/live). Only
// these exact fictional addresses are ever eligible for cleanup.
function isTestArtifactEmail(email) {
  if (typeof email !== 'string') return false;
  var e = email.toLowerCase();
  return /^demo\.verifier\.\d+@example\.com$/.test(e) || e === 'inj.verifier@example.com';
}

// Employee search + status filter, run in the browser on the already loaded
// list (no server request). Self-contained: the page receives this function's
// source text (see manager.html), so there is one implementation, tested in Node.
function filterEmployees(list, query, state) {
  var parts = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (list || []).filter(function (e) {
    if (state && state !== 'all' && e.workState !== state) return false;
    if (!parts.length) return true;
    var hay = [e.lastName, e.firstName, e.middleName, e.email].join(' ').toLowerCase();
    return parts.every(function (p) { return hay.indexOf(p) >= 0; });
  });
}

// --- task model: priorities, due dates, states and transitions (pure) ------------

var TASK_PRIORITIES = ['low', 'medium', 'high'];

function normalizePriority(p) {
  var v = String(p === null || p === undefined ? '' : p).toLowerCase();
  return TASK_PRIORITIES.indexOf(v) >= 0 ? v : 'medium';
}

function isValidPriority(p) {
  return TASK_PRIORITIES.indexOf(String(p)) >= 0;
}

// Stored statuses: draft (unpublished backlog), available (shared pool),
// active (owned by an employee, not finished), completed, replaced (legacy).
// Displayed statuses add the work state of an owned task: assigned (nothing
// recorded yet), in_progress (a timer is running) or paused.
var TASK_TRANSITIONS = {
  draft: { publish: 'available', assign: 'active' },
  available: { unpublish: 'draft', claim: 'active', assign: 'active' },
  active: { complete: 'completed' },
  completed: {},
  replaced: {}
};

// The status after `action`, or null when the action is not allowed.
function nextTaskStatus(status, action) {
  var row = TASK_TRANSITIONS[status];
  if (!row || !Object.prototype.hasOwnProperty.call(row, action)) return null;
  return row[action];
}

// sessions: the sessions of this task only.
function deriveTaskStatus(task, sessions) {
  if (task.status !== 'active') return task.status;
  sessions = sessions || [];
  var latest = null;
  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].status === 'active') return 'in_progress';
    if (!latest || sessions[i].startTime > latest.startTime) latest = sessions[i];
  }
  if (latest && latest.status === 'paused') return 'paused';
  return 'assigned';
}

// A task is overdue when it has a due date before today (UTC) and is not finished.
function isOverdue(task, todayYmd) {
  if (!task || !task.dueDate || !todayYmd) return false;
  if (task.status === 'completed' || task.status === 'replaced') return false;
  return String(task.dueDate) < String(todayYmd);
}

// Accepts '' (no deadline) or a strict YYYY-MM-DD calendar date.
function normalizeDueDate(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return '';
  parseYmdStrictUtc(s, false);
  return s;
}

// Reduces an (id, status) list into counts so totals can be reconciled.
function countByStatus(statuses) {
  var out = { draft: 0, available: 0, assigned: 0, in_progress: 0, paused: 0, completed: 0, replaced: 0 };
  statuses.forEach(function (s) { if (out[s] !== undefined) out[s]++; });
  return out;
}

// Task search + filters for the Manager's Tasks page, run in the browser on the
// loaded list. Self-contained (shipped to the page as source text, like
// filterEmployees). f: { q, projectId ('__none' = no project), status (displayed
// status), priority, employeeId ('__none' = unassigned), deadline ('overdue' |
// 'week' | 'none'), today (YYYY-MM-DD), weekEnd (YYYY-MM-DD) }.
function filterTasks(list, f) {
  f = f || {};
  var parts = String(f.q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (list || []).filter(function (t) {
    if (f.projectId && (f.projectId === '__none' ? t.projectId : t.projectId !== f.projectId)) return false;
    if (f.status && t.displayStatus !== f.status) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.employeeId && (f.employeeId === '__none' ? t.employeeId : t.employeeId !== f.employeeId)) return false;
    if (f.deadline === 'overdue' && !t.overdue) return false;
    if (f.deadline === 'none' && t.dueDate) return false;
    if (f.deadline === 'week' && !(t.dueDate && t.dueDate >= f.today && t.dueDate <= f.weekEnd)) return false;
    if (!parts.length) return true;
    var hay = [t.title, t.description, t.projectName, t.employeeName].join(' ').toLowerCase();
    return parts.every(function (p) { return hay.indexOf(p) >= 0; });
  });
}

function isTestArtifactProjectName(name) {
  return typeof name === 'string' && /^acceptance project \d{10,}$/i.test(name.trim());
}

// --- error marker ---------------------------------------------------------
// Services throw UserError for messages that are safe to surface verbatim in
// the UI (e.g. "A session is already running."). Unmarked errors are treated
// as internal and sanitized at the api_* boundary (see safeApi_ in Code.gs).
function UserError(message) {
  var err = new Error(message);
  err.userSafe = true;
  return err;
}

// --- internal -------------------------------------------------------------

function toMs_(x) {
  if (x === null || x === undefined || x === '') return null;
  if (typeof x === 'number') return x;
  if (x instanceof Date) return x.getTime();
  var d = new Date(x);
  var t = d.getTime();
  return isNaN(t) ? null : t;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    overlapMs: overlapMs,
    sumSessionMs: sumSessionMs,
    sumSessionMsWithDiagnostics: sumSessionMsWithDiagnostics,
    isValidEmail: isValidEmail,
    sanitize: sanitize,
    nextStateAfter: nextStateAfter,
    cellSafe: cellSafe,
    validateLength: validateLength,
    parseYmdStrictUtc: parseYmdStrictUtc,
    UserError: UserError,
    isDemoEnvironmentName: isDemoEnvironmentName,
    checkRowLimit: checkRowLimit,
    buildDemoSample: buildDemoSample,
    TASK_PRIORITIES: TASK_PRIORITIES,
    TASK_TRANSITIONS: TASK_TRANSITIONS,
    normalizePriority: normalizePriority,
    isValidPriority: isValidPriority,
    nextTaskStatus: nextTaskStatus,
    deriveTaskStatus: deriveTaskStatus,
    isOverdue: isOverdue,
    normalizeDueDate: normalizeDueDate,
    countByStatus: countByStatus,
    classifyWorkState: classifyWorkState,
    filterEmployees: filterEmployees,
    filterTasks: filterTasks,
    ymdUtc: ymdUtc,
    dailyBreakdown: dailyBreakdown,
    csvCell: csvCell,
    buildReportCsv: buildReportCsv,
    isReservedTestEmail: isReservedTestEmail,
    sanitizeMailText: sanitizeMailText,
    shortHash: shortHash,
    isTestArtifactEmail: isTestArtifactEmail,
    isTestArtifactProjectName: isTestArtifactProjectName,
    FIELD_LIMITS: FIELD_LIMITS
  };
}
