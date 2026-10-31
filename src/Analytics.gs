// Dashboard metrics and CSV export. Both reuse the reporting logic so the
// numbers always agree with the Reports tab: tracked time is the overlap of each
// session interval with the UTC day range (pauses and gaps are never inside a
// session interval), and an unfinished session is counted up to "now" exactly
// as reports_generate_ does. Task counts come from the same derived statuses the
// Tasks page shows, so the status buckets always add up to the number of tasks.

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
  var views = tasks_views_(ctx);
  var tasksByEmp = {}, sessionsByEmp = {}, taskById = {};
  tasks.forEach(function (t) {
    taskById[t.id] = t;
    (tasksByEmp[t.employeeId] = tasksByEmp[t.employeeId] || []).push(t);
  });
  sessions.forEach(function (s) { (sessionsByEmp[s.employeeId] = sessionsByEmp[s.employeeId] || []).push(s); });
  var projectNames = {};
  projects_list_(ctx).forEach(function (p) { projectNames[p.id] = p.name; });

  var counts = countByStatus(views.map(function (v) { return v.displayStatus; }));
  var metrics = {
    totalEmployees: employees.length, working: 0, paused: 0, idle: 0,
    activeTasks: 0, completedTasks: 0, trackedMs: 0,
    totalTasks: views.length, tasksByStatus: counts, overdueTasks: 0
  };
  views.forEach(function (v) { if (v.overdue) metrics.overdueTasks++; });

  var counted = [];
  var byEmployee = [];
  var workload = [];
  var projectMs = {};
  employees.forEach(function (e) {
    var mySessions = sessionsByEmp[e.id] || [];
    var myTasks = tasksByEmp[e.id] || [];
    var state = classifyWorkState(myTasks, mySessions);
    metrics[state === 'working' ? 'working' : (state === 'paused' ? 'paused' : 'idle')]++;
    var open = 0, inProgress = 0;
    myTasks.forEach(function (t) {
      if (t.status === 'active') { metrics.activeTasks++; open++; }
      else if (t.status === 'completed') metrics.completedTasks++;
    });
    var ms = 0;
    mySessions.forEach(function (s) {
      var o = overlapMs(s.startTime, s.endTime, fromMs, toMs, nowMs);
      if (o <= 0) return;
      ms += o;
      var t = taskById[s.taskId];
      var key = t && t.projectId ? t.projectId : '';
      projectMs[key] = (projectMs[key] || 0) + o;
    });
    metrics.trackedMs += ms;
    counted = counted.concat(mySessions);
    var name = employees_fullName_(e);
    if (ms > 0) byEmployee.push({ employeeId: e.id, name: name, ms: ms });
    workload.push({ employeeId: e.id, name: name, openTasks: open, state: state, ms: ms });
  });
  byEmployee.sort(function (a, b) { return b.ms - a.ms; });
  workload.sort(function (a, b) { return (b.openTasks - a.openTasks) || (b.ms - a.ms); });

  var byProject = Object.keys(projectMs).map(function (k) {
    return { projectId: k, name: k ? (projectNames[k] || '') : '', ms: projectMs[k] };
  }).sort(function (a, b) { return b.ms - a.ms; });

  var titles = {};
  tasks.forEach(function (t) { titles[t.id] = t.title; });
  var empNames = {};
  employees.forEach(function (e) { empNames[e.id] = employees_fullName_(e); });
  var recentActivity = activity_list_(ctx).slice(-8).reverse().map(function (a) {
    return { taskId: a.taskId, taskTitle: titles[a.taskId] || '', at: a.at, actorType: a.actorType,
      actorName: a.actorType === 'employee' ? (empNames[a.actorId] || '') : '', action: a.action, detail: a.detail };
  });
  var recentComments = comments_list_(ctx).slice(-5).reverse().map(function (c) {
    return { taskId: c.taskId, taskTitle: titles[c.taskId] || '', authorType: c.authorType, authorName: c.authorName, text: c.text, createdAt: c.createdAt };
  });

  return {
    from: fromStr, to: toStr, timezone: 'UTC',
    metrics: metrics,
    daily: dailyBreakdown(counted, fromMs, toMs, nowMs),
    byEmployee: byEmployee,
    byProject: byProject,
    workload: workload,
    recentActivity: recentActivity,
    recentComments: recentComments
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
