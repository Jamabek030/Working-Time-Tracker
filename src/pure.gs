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
    throw new Error(fieldLabel + ' is too long (max ' + limit + ' characters).');
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
    throw new Error('Date must be in YYYY-MM-DD format.');
  }
  var parts = s.split('-');
  var y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    throw new Error('Date components out of range.');
  }
  var ms = Date.UTC(y, m - 1, d,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0);
  var dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error('Invalid calendar date.');
  }
  return dt;
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
    FIELD_LIMITS: FIELD_LIMITS
  };
}
