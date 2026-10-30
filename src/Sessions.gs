// Work session (timer) operations. Each session row is one audited interval:
// start -> end, with a frozen durationMs once closed. Pause closes the
// interval; resume opens a fresh one. closeSession_ throws when it is asked
// to close a row whose startTime cannot be parsed, so a corrupt row does not
// turn into a plausible-looking zero-duration record (audit F-13).

function sessions_list_(ctx) {
  ctx = ctx || getContext_();
  var rows = readAll_(ctx.sheets.SESSIONS);
  return rows.filter(function (r) { return r.id; }).map(function (r) {
    return {
      id: String(r.id),
      employeeId: String(r.employeeId || ''),
      taskId: String(r.taskId || ''),
      startTime: toIso_(r.startTime),
      endTime: toIso_(r.endTime),
      durationMs: r.durationMs === '' || r.durationMs === null || r.durationMs === undefined ? '' : Number(r.durationMs),
      status: String(r.status || '')
    };
  });
}

function sessions_forEmployee_(employeeId, ctx) {
  return sessions_list_(ctx).filter(function (s) { return s.employeeId === employeeId; });
}

function sessions_forTask_(taskId, ctx) {
  return sessions_list_(ctx).filter(function (s) { return s.taskId === taskId; });
}

function sessions_findActive_(employeeId, ctx) {
  var all = sessions_forEmployee_(employeeId, ctx);
  for (var i = 0; i < all.length; i++) if (all[i].status === 'active') return all[i];
  return null;
}

function sessions_start_(employeeId, ctx) {
  ctx = ctx || getContext_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var task = tasks_getActive_(employeeId, ctx);
    if (!task) throw UserError('No active task assigned.');
    var active = sessions_findActive_(employeeId, ctx);
    if (active) throw UserError('A session is already running.');
    var session = {
      id: uuid_(),
      employeeId: employeeId,
      taskId: task.id,
      startTime: nowIso_(),
      endTime: '',
      durationMs: '',
      status: 'active'
    };
    appendRow_(ctx.sheets.SESSIONS, session, DEFAULT_CONFIG.HEADERS.SESSIONS);
    return session;
  } finally {
    lock.releaseLock();
  }
}

function sessions_pause_(employeeId, ctx) {
  ctx = ctx || getContext_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var active = sessions_findActive_(employeeId, ctx);
    if (!active) throw UserError('No active session to pause.');
    return closeSession_(active, 'paused', ctx);
  } finally {
    lock.releaseLock();
  }
}

function sessions_resume_(employeeId, ctx) {
  // Same transition as start, but called via a different button on the UI.
  return sessions_start_(employeeId, ctx);
}

function sessions_finish_(employeeId, ctx) {
  ctx = ctx || getContext_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var task = tasks_getActive_(employeeId, ctx);
    if (!task) throw UserError('No active task to finish.');
    var active = sessions_findActive_(employeeId, ctx);
    if (active) closeSession_(active, 'completed', ctx);
    tasks_updateStatus_(task.id, 'completed', ctx);
    return { finishedTaskId: task.id };
  } finally {
    lock.releaseLock();
  }
}

function closeSession_(session, status, ctx) {
  ctx = ctx || getContext_();
  var startDate = parseIso_(session.startTime);
  if (!startDate) {
    throw new Error('Cannot close session ' + session.id + ': startTime is not a valid timestamp.');
  }
  var endDate = new Date();
  var endMs = endDate.getTime();
  var startMs = startDate.getTime();
  if (endMs < startMs) {
    throw new Error('Cannot close session ' + session.id + ': end time precedes start time.');
  }
  var durationMs = endMs - startMs;
  var updates = {
    endTime: endDate.toISOString(),
    durationMs: durationMs,
    status: status
  };
  updateRow_(ctx.sheets.SESSIONS, 'id', session.id, updates, DEFAULT_CONFIG.HEADERS.SESSIONS);
  return {
    id: session.id,
    employeeId: session.employeeId,
    taskId: session.taskId,
    startTime: session.startTime,
    endTime: updates.endTime,
    durationMs: durationMs,
    status: status
  };
}

function sessions_totalForTask_(taskId, ctx) {
  return sumSessionMs(sessions_forTask_(taskId, ctx), Date.now());
}

function sessions_totalForEmployee_(employeeId, ctx) {
  return sumSessionMs(sessions_forEmployee_(employeeId, ctx), Date.now());
}
