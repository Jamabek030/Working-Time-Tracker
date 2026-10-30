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
  taskTitle: 500
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
// durationMs == end - start, exactly one active task per employee, only
// reserved example.com addresses). Every timestamp is a whole past day
// relative to `nowMs`, so no session is ever "running".
function buildDemoSample(nowMs, newId, newToken) {
  var DAY = 86400000;
  var midnight = nowMs - (nowMs % DAY);
  function at(daysAgo, hour, minute) {
    return new Date(midnight - daysAgo * DAY + (hour * 60 + minute) * 60000).toISOString();
  }
  var employees = [], tasks = [], sessions = [];
  function addEmployee(last, first, middle, email, createdDaysAgo) {
    var e = { id: newId(), lastName: last, firstName: first, middleName: middle, email: email,
      workspaceToken: newToken(), createdAt: at(createdDaysAgo, 8, 0), active: true };
    employees.push(e);
    return e;
  }
  function addTask(emp, title, status, createdAt, completedAt) {
    var t = { id: newId(), employeeId: emp.id, title: title, status: status, createdAt: createdAt, completedAt: completedAt || '' };
    tasks.push(t);
    return t;
  }
  function addSession(emp, task, start, end, status) {
    sessions.push({ id: newId(), employeeId: emp.id, taskId: task.id, startTime: start, endTime: end,
      durationMs: new Date(end).getTime() - new Date(start).getTime(), status: status });
  }

  var alex = addEmployee('Rivera', 'Alex', '', 'alex.rivera@example.com', 6);
  var a1 = addTask(alex, 'Draft onboarding checklist', 'replaced', at(6, 8, 0), at(4, 17, 0));
  addSession(alex, a1, at(6, 9, 0), at(6, 10, 30), 'paused');
  addSession(alex, a1, at(5, 9, 15), at(5, 11, 45), 'paused');
  addSession(alex, a1, at(4, 13, 0), at(4, 13, 40), 'paused');
  var a2 = addTask(alex, 'Review test plan', 'active', at(4, 17, 0), '');
  addSession(alex, a2, at(3, 10, 0), at(3, 12, 0), 'paused');
  addSession(alex, a2, at(1, 14, 0), at(1, 15, 30), 'paused');

  var sam = addEmployee('Nguyen', 'Sam', 'Q', 'sam.nguyen@example.com', 8);
  var b1 = addTask(sam, 'Prototype report filters', 'completed', at(8, 8, 0), at(7, 10, 0));
  addSession(sam, b1, at(8, 9, 0), at(8, 11, 0), 'paused');
  addSession(sam, b1, at(7, 9, 0), at(7, 10, 0), 'completed');
  var b2 = addTask(sam, 'Write demo walkthrough', 'active', at(7, 10, 30), '');
  addSession(sam, b2, at(2, 11, 0), at(2, 11, 45), 'paused');

  return { employees: employees, tasks: tasks, sessions: sessions };
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
    FIELD_LIMITS: FIELD_LIMITS
  };
}
