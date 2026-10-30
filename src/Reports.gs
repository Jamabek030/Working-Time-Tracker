// Date-range reports.
//
// Dates are parsed strictly in YYYY-MM-DD against a UTC calendar (audit
// F-07): the project's own timeZone in appsscript.json is Etc/UTC, so UTC
// boundaries are the only timezone this build should intermix. If a
// future operator changes the project timezone, this parse must be
// updated in lockstep.
//
// Session overlap for a report is the intersection of each session's own
// start→end interval with the requested range. Pauses and overnight gaps
// are not inside any session interval, so they are not counted.

function reports_generate(fromDateStr, toDateStr, ctx) {
  ctx = ctx || getContext_();
  var from = parseYmdStrictUtc(fromDateStr, false);
  var to = parseYmdStrictUtc(toDateStr, true);
  if (from > to) throw UserError('From date must be on or before To date.');

  var employees = employees_list(ctx);
  var tasks = tasks_list(ctx);
  var sessions = sessions_list(ctx);
  var nowMs = Date.now();
  var fromMs = from.getTime();
  var toMs = to.getTime();

  // Group sessions by employee once so per-employee building is linear.
  var sessionsByEmp = {};
  var tasksByEmp = {};
  sessions.forEach(function (s) {
    (sessionsByEmp[s.employeeId] = sessionsByEmp[s.employeeId] || []).push(s);
  });
  tasks.forEach(function (t) {
    (tasksByEmp[t.employeeId] = tasksByEmp[t.employeeId] || []).push(t);
  });

  var rows = employees.map(function (emp) {
    var empTasks = tasksByEmp[emp.id] || [];
    var empSessions = sessionsByEmp[emp.id] || [];
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

    // Tasks whose createdAt falls inside the requested range — labelled
    // "created in range" in the UI. This is distinct from "tasks the
    // employee worked on in range", which is captured by the sessions
    // array above (audit F-09).
    var tasksCreatedInRange = empTasks.filter(function (t) {
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
      tasksCreatedInRange: tasksCreatedInRange
    };
  });

  return rows.filter(function (r) { return r.sessions.length > 0 || r.tasksCreatedInRange.length > 0; });
}

function findTask_(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
