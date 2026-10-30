// Pure, dependency-free helpers.
// Testable in Node.js (see tests/pure.test.js) and executed verbatim inside Google Apps Script.

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

function sumSessionMs(sessions, nowMs) {
  var total = 0;
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    if (s.status === 'active') {
      var start = toMs_(s.startTime);
      if (start === null) continue;
      var delta = nowMs - start;
      total += delta > 0 ? delta : 0;
    } else {
      var d = Number(s.durationMs);
      if (isFinite(d) && d > 0) total += d;
    }
  }
  return total;
}

function isValidEmail(s) {
  if (typeof s !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function sanitize(s) {
  if (s === undefined || s === null) return '';
  return String(s).trim();
}

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

function toMs_(x) {
  if (x === null || x === undefined || x === '') return null;
  if (typeof x === 'number') return x;
  if (x instanceof Date) return x.getTime();
  var d = new Date(x);
  var t = d.getTime();
  return isNaN(t) ? null : t;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { overlapMs: overlapMs, sumSessionMs: sumSessionMs, isValidEmail: isValidEmail, sanitize: sanitize, nextStateAfter: nextStateAfter };
}
