// Task domain operations.
//
// A task row moves through the stored statuses draft -> available -> active ->
// completed (see TASK_TRANSITIONS in pure.gs); 'replaced' is kept only for rows
// written by the older single-task model. Every move that changes ownership or
// status runs under the script lock and re-reads the row inside the lock, so two
// requests can never both succeed (for example two employees claiming the same
// pool task). The same row is updated in place: assigning a pool task never
// creates a second task and never loses recorded work.

function dueYmd_(v) {
  if (!v) return '';
  if (v instanceof Date) return ymdUtc(v.getTime());
  return String(v).slice(0, 10);
}

function tasks_list_(ctx) {
  ctx = ctx || getContext_();
  var rows = readAll_(ctx.sheets.TASKS);
  return rows.filter(function (r) { return r.id; }).map(function (r) {
    return {
      id: String(r.id),
      employeeId: String(r.employeeId || ''),
      title: String(r.title || ''),
      status: String(r.status || ''),
      createdAt: toIso_(r.createdAt),
      completedAt: toIso_(r.completedAt),
      projectId: String(r.projectId || ''),
      priority: normalizePriority(r.priority),
      dueDate: dueYmd_(r.dueDate),
      description: String(r.description || ''),
      assignedAt: toIso_(r.assignedAt)
    };
  });
}

function tasks_forEmployee_(employeeId, ctx) {
  return tasks_list_(ctx).filter(function (t) { return t.employeeId === employeeId; });
}

function tasks_getActive_(employeeId, ctx) {
  var all = tasks_forEmployee_(employeeId, ctx);
  for (var i = 0; i < all.length; i++) if (all[i].status === 'active') return all[i];
  return null;
}

// The task the employee is "on": the task of their most recent session while it
// is still active, otherwise their first active task.
function tasks_currentFor_(employeeId, ctx) {
  var active = tasks_forEmployee_(employeeId, ctx).filter(function (t) { return t.status === 'active'; });
  if (!active.length) return null;
  var byId = {};
  active.forEach(function (t) { byId[t.id] = t; });
  var latest = null;
  sessions_forEmployee_(employeeId, ctx).forEach(function (s) {
    if (byId[s.taskId] && (!latest || s.startTime > latest.startTime)) latest = s;
  });
  return latest ? byId[latest.taskId] : active[0];
}

function tasks_findById_(taskId, ctx) {
  var all = tasks_list_(ctx);
  for (var i = 0; i < all.length; i++) if (all[i].id === taskId) return all[i];
  return null;
}

// Creates a task row. Legacy callers pass { employeeId, title } and get an
// active task for that employee. New callers also pass status ('draft',
// 'available' or 'active'), projectId, priority, dueDate and description.
function tasks_create_(data, ctx) {
  ctx = ctx || getContext_();
  var employeeId = sanitize(data && data.employeeId);
  var title = sanitize(data && data.title);
  var status = (data && data.status) || 'active';
  if (status === 'active' && !employeeId) throw UserError('Employee is required.');
  if (!title) throw UserError('Task title is required.');
  validateLength(title, FIELD_LIMITS.taskTitle, 'Task title');
  var description = sanitize(data && data.description);
  validateLength(description, FIELD_LIMITS.description, 'Description');
  var projectId = sanitize(data && data.projectId);
  if (projectId && !projects_findById_(projectId, ctx)) throw UserError('Project not found.');
  var priority = 'medium';
  if (data && data.priority !== undefined && data.priority !== null && data.priority !== '') {
    if (!isValidPriority(data.priority)) throw UserError('Invalid priority.');
    priority = data.priority;
  }
  var dueDate = normalizeDueDate(data && data.dueDate);
  var task = {
    id: uuid_(),
    employeeId: status === 'active' ? employeeId : '',
    title: title,
    status: status,
    createdAt: nowIso_(),
    completedAt: '',
    projectId: projectId,
    priority: priority,
    dueDate: dueDate,
    description: description,
    assignedAt: status === 'active' ? nowIso_() : ''
  };
  appendRow_(ctx.sheets.TASKS, task, DEFAULT_CONFIG.HEADERS.TASKS);
  return task;
}

function tasks_updateStatus_(taskId, status, ctx) {
  ctx = ctx || getContext_();
  var updates = { status: status };
  if (status === 'completed' || status === 'replaced') {
    updates.completedAt = nowIso_();
  }
  updateRow_(ctx.sheets.TASKS, 'id', taskId, updates, DEFAULT_CONFIG.HEADERS.TASKS);
}

// ---- managed transitions --------------------------------------------------------------

var MANAGER_ACTOR_ = { type: 'manager', id: '' };

function employeeActor_(employee) {
  return { type: 'employee', id: employee.id, name: employees_fullName_(employee) };
}

// Runs `action` on the task inside the script lock, using the row as it is NOW.
// `updates` lists the fields to write; the status is written last so a reader
// that does not take the lock never sees the new status with the old owner.
function tasks_move_(taskId, action, ctx, buildUpdates) {
  ctx = ctx || getContext_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var task = tasks_findById_(taskId, ctx);
    if (!task) throw UserError('Task not found.');
    var next = nextTaskStatus(task.status, action);
    if (!next) {
      throw UserError(action === 'claim'
        ? 'This task is no longer available.'
        : 'This action is not allowed for the task in its current state.');
    }
    var updates = buildUpdates ? buildUpdates(task) : {};
    updates.status = next;
    updateRow_(ctx.sheets.TASKS, 'id', taskId, updates, DEFAULT_CONFIG.HEADERS.TASKS);
    return tasks_findById_(taskId, ctx);
  } finally {
    lock.releaseLock();
  }
}

function tasks_publish_(taskId, actor, ctx) {
  ctx = ctx || getContext_();
  var t = tasks_move_(taskId, 'publish', ctx);
  activity_log_(ctx, taskId, actor || MANAGER_ACTOR_, 'published', '');
  return t;
}

function tasks_unpublish_(taskId, actor, ctx) {
  ctx = ctx || getContext_();
  var t = tasks_move_(taskId, 'unpublish', ctx);
  activity_log_(ctx, taskId, actor || MANAGER_ACTOR_, 'unpublished', '');
  return t;
}

// An employee takes a pool task. Only the employee resolved from the token on the
// server can be the owner; the client never supplies the employee id.
function tasks_claim_(taskId, employee, ctx) {
  ctx = ctx || getContext_();
  var t = tasks_move_(taskId, 'claim', ctx, function () {
    return { employeeId: employee.id, assignedAt: nowIso_() };
  });
  activity_log_(ctx, taskId, employeeActor_(employee), 'claimed', '');
  return t;
}

// The manager gives a draft or pool task to one employee: the same row leaves the
// pool and becomes that employee's active task in one locked step.
function tasks_assign_(taskId, employeeId, actor, ctx) {
  ctx = ctx || getContext_();
  var employee = employees_findById_(employeeId, ctx);
  if (!employee) throw UserError('Employee not found.');
  var t = tasks_move_(taskId, 'assign', ctx, function () {
    return { employeeId: employee.id, assignedAt: nowIso_() };
  });
  activity_log_(ctx, taskId, actor || MANAGER_ACTOR_, 'assigned', employees_fullName_(employee));
  return t;
}

// Priority and deadline can be changed until the task is finished.
function tasks_update_(taskId, data, actor, ctx) {
  ctx = ctx || getContext_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var task = tasks_findById_(taskId, ctx);
    if (!task) throw UserError('Task not found.');
    if (task.status === 'completed' || task.status === 'replaced') {
      throw UserError('This action is not allowed for the task in its current state.');
    }
    var updates = {}, notes = [];
    if (data && data.priority !== undefined && data.priority !== null && data.priority !== '') {
      if (!isValidPriority(data.priority)) throw UserError('Invalid priority.');
      if (data.priority !== task.priority) { updates.priority = data.priority; notes.push('priority=' + data.priority); }
    }
    if (data && data.dueDate !== undefined) {
      var due = normalizeDueDate(data.dueDate);
      if (due !== task.dueDate) { updates.dueDate = due; notes.push('due=' + (due || 'none')); }
    }
    if (Object.keys(updates).length) {
      updateRow_(ctx.sheets.TASKS, 'id', taskId, updates, DEFAULT_CONFIG.HEADERS.TASKS);
      activity_log_(ctx, taskId, actor || MANAGER_ACTOR_, 'updated', notes.join('; '));
    }
    return tasks_findById_(taskId, ctx);
  } finally {
    lock.releaseLock();
  }
}

// A task the employee owns, or an error. Ownership is decided only by the row.
function tasks_requireOwned_(taskId, employeeId, ctx) {
  var task = taskId ? tasks_findById_(String(taskId), ctx) : null;
  if (!task) throw UserError('Task not found.');
  if (task.employeeId !== employeeId) throw UserError('This task is not assigned to you.');
  return task;
}

// ---- read models --------------------------------------------------------------------------

// Tasks decorated for the UI: project and assignee names, the displayed status,
// tracked time and the overdue flag. `keep(task)` limits what is decorated.
function tasks_views_(ctx, keep) {
  ctx = ctx || getContext_();
  var nowMs = Date.now();
  var today = ymdUtc(nowMs);
  var projects = {}, employees = {}, byTask = {};
  projects_list_(ctx).forEach(function (p) { projects[p.id] = p; });
  employees_list_(ctx).forEach(function (e) { employees[e.id] = e; });
  sessions_list_(ctx).forEach(function (s) { (byTask[s.taskId] = byTask[s.taskId] || []).push(s); });
  return tasks_list_(ctx).filter(function (t) { return !keep || keep(t); }).map(function (t) {
    var ss = byTask[t.id] || [];
    var p = projects[t.projectId];
    var e = employees[t.employeeId];
    return {
      id: t.id, title: t.title, description: t.description,
      projectId: t.projectId, projectName: p ? p.name : '',
      priority: t.priority, dueDate: t.dueDate, overdue: isOverdue(t, today),
      status: t.status, displayStatus: deriveTaskStatus(t, ss),
      employeeId: t.employeeId, employeeName: e ? employees_fullName_(e) : '',
      trackedMs: sumSessionMs(ss, nowMs),
      createdAt: t.createdAt, assignedAt: t.assignedAt, completedAt: t.completedAt
    };
  });
}
