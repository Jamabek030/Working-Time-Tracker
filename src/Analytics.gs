// Dashboard metrics and CSV export. Both reuse the reporting logic so the
// numbers always agree with the Reports tab: tracked time is the overlap of each
// session interval with the UTC day range (pauses and gaps are never inside a
// session interval), and an unfinished session is counted up to "now" exactly
// as reports_generate_ does.

var DASHBOARD_MAX_DAYS = 366;

function parseRange_(fromStr, toStr) {
  var from = parseYmdStrictUtc(fromStr, false);
  var to = parseYmdStrictUtc(toStr, true);
  if (from > to) throw UserError('From date must be on or before To date.');
  if ((to.getTime() - from.getTime()) / 86400000 > DASHBOARD_MAX_DAYS) {
    throw UserError('Date range is too long (max ' + DASHBOARD_MAX_DAYS + ' days).');
  }
  return { from: from, to: to };
}

function dashboard_get_(fromStr, toStr, ctx) {
  ctx = ctx || getContext_();
  var range = parseRange_(fromStr, toStr);
  var fromMs = range.from.getTime(), toMs = range.to.getTime();
  var nowMs = Date.now();

  var employees = employees_list_(ctx);
  var tasks = tasks_list_(ctx);
  var sessions = sessions_list_(ctx);
  var tasksByEmp = {}, sessionsByEmp = {};
  tasks.forEach(function (t) { (tasksByEmp[t.employeeId] = tasksByEmp[t.employeeId] || []).push(t); });
  sessions.forEach(function (s) { (sessionsByEmp[s.employeeId] = sessionsByEmp[s.employeeId] || []).push(s); });

  var metrics = { totalEmployees: employees.length, working: 0, paused: 0, idle: 0, activeTasks: 0, completedTasks: 0, trackedMs: 0 };
  var counted = [];
  var byEmployee = [];
  employees.forEach(function (e) {
    var mySessions = sessionsByEmp[e.id] || [];
    var myTasks = tasksByEmp[e.id] || [];
    var state = classifyWorkState(myTasks, mySessions);
    metrics[state === 'working' ? 'working' : (state === 'paused' ? 'paused' : 'idle')]++;
    myTasks.forEach(function (t) {
      if (t.status === 'active') metrics.activeTasks++;
      else if (t.status === 'completed') metrics.completedTasks++;
    });
    var ms = 0;
    mySessions.forEach(function (s) { ms += overlapMs(s.startTime, s.endTime, fromMs, toMs, nowMs); });
    metrics.trackedMs += ms;
    counted = counted.concat(mySessions);
    if (ms > 0) byEmployee.push({ employeeId: e.id, name: employees_fullName_(e), ms: ms });
  });
  byEmployee.sort(function (a, b) { return b.ms - a.ms; });

  return {
    from: fromStr, to: toStr, timezone: 'UTC',
    metrics: metrics,
    daily: dailyBreakdown(counted, fromMs, toMs, nowMs),
    byEmployee: byEmployee
  };
}

// CSV of the report for the range, optionally limited to one employee.
function reports_csv_(fromStr, toStr, employeeId, lang, ctx) {
  ctx = ctx || getContext_();
  var rows = reports_generate_(fromStr, toStr, ctx);
  var id = (typeof employeeId === 'string' && employeeId.length <= 64) ? employeeId : '';
  if (id) rows = rows.filter(function (r) { return r.employeeId === id; });
  var count = 0;
  rows.forEach(function (r) { count += r.sessions.length; });
  return {
    filename: 'working-time-report_' + fromStr + '_' + toStr + '.csv',
    csv: buildReportCsv(rows, csvLabelsFor(lang)),
    rows: count
  };
}
