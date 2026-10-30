// Date-range reports. The reported duration for each session is the overlap of
// its interval with the requested range; pauses and overnight gaps are
// automatically excluded because they are not inside any session interval.

function reports_generate(fromDateStr, toDateStr, ctx) {
  ctx = ctx || getContext_();
  var from = parseDateInput_(fromDateStr, false);
  var to = parseDateInput_(toDateStr, true);
  if (!from || !to) throw new Error('A valid date range is required.');
  if (from > to) throw new Error('From date must be on or before To date.');

  var employees = employees_list(ctx);
  var tasks = tasks_list(ctx);
  var sessions = sessions_list(ctx);
  var nowMs = Date.now();
  var fromMs = from.getTime();
  var toMs = to.getTime();

  var rows = employees.map(function (emp) {
    var empTasks = tasks.filter(function (t) { return t.employeeId === emp.id; });
    var empSessions = sessions.filter(function (s) { return s.employeeId === emp.id; });
    var totalMs = 0;
    var sessionsInRange = [];
    empSessions.forEach(function (s) {
      var overlap = overlapMs(s.startTime, s.endTime, fromMs, toMs, nowMs);
      if (overlap <= 0) return;
      totalMs += overlap;
      var task = findTask_(empTasks, s.taskId);
      sessionsInRange.push({
        sessionId: s.id,
        taskId: s.taskId,
        taskTitle: task ? task.title : '(unknown task)',
        startTime: s.startTime,
        endTime: s.endTime,
        status: s.status,
        overlapMs: overlap
      });
    });
    sessionsInRange.sort(function (a, b) { return a.startTime < b.startTime ? -1 : 1; });
    var tasksInRange = empTasks.filter(function (t) {
      var created = parseIso_(t.createdAt);
      return created && created.getTime() >= fromMs && created.getTime() <= toMs;
    }).map(function (t) {
      return { id: t.id, title: t.title, status: t.status, createdAt: t.createdAt, completedAt: t.completedAt };
    });
    return {
      employeeId: emp.id,
      name: employees_fullName(emp),
      email: emp.email,
      totalMs: totalMs,
      sessions: sessionsInRange,
      tasks: tasksInRange
    };
  });

  return rows.filter(function (r) { return r.sessions.length > 0 || r.tasks.length > 0; });
}

function findTask_(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function parseDateInput_(s, endOfDay) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    var parts = s.split('-');
    var y = Number(parts[0]), m = Number(parts[1]) - 1, d = Number(parts[2]);
    return new Date(y, m, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  }
  var dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}
