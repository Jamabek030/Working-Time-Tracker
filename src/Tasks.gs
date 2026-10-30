// Task domain operations.

function tasks_list(ctx) {
  ctx = ctx || getContext_();
  var rows = readAll_(ctx.sheets.TASKS);
  return rows.filter(function (r) { return r.id; }).map(function (r) {
    return {
      id: String(r.id),
      employeeId: String(r.employeeId || ''),
      title: String(r.title || ''),
      status: String(r.status || ''),
      createdAt: toIso_(r.createdAt),
      completedAt: toIso_(r.completedAt)
    };
  });
}

function tasks_forEmployee(employeeId, ctx) {
  return tasks_list(ctx).filter(function (t) { return t.employeeId === employeeId; });
}

function tasks_getActive(employeeId, ctx) {
  var all = tasks_forEmployee(employeeId, ctx);
  for (var i = 0; i < all.length; i++) if (all[i].status === 'active') return all[i];
  return null;
}

function tasks_findById(taskId, ctx) {
  var all = tasks_list(ctx);
  for (var i = 0; i < all.length; i++) if (all[i].id === taskId) return all[i];
  return null;
}

function tasks_create(data, ctx) {
  ctx = ctx || getContext_();
  var employeeId = sanitize(data && data.employeeId);
  var title = sanitize(data && data.title);
  if (!employeeId) throw UserError('Employee is required.');
  if (!title) throw UserError('Task title is required.');
  validateLength(title, FIELD_LIMITS.taskTitle, 'Task title');
  var task = {
    id: uuid_(),
    employeeId: employeeId,
    title: title,
    status: 'active',
    createdAt: nowIso_(),
    completedAt: ''
  };
  appendRow_(ctx.sheets.TASKS, task, DEFAULT_CONFIG.HEADERS.TASKS);
  return task;
}

function tasks_updateStatus(taskId, status, ctx) {
  ctx = ctx || getContext_();
  var updates = { status: status };
  if (status === 'completed' || status === 'replaced') {
    updates.completedAt = nowIso_();
  }
  updateRow_(ctx.sheets.TASKS, 'id', taskId, updates, DEFAULT_CONFIG.HEADERS.TASKS);
}
