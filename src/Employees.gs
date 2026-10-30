// Employee domain operations.
// Writes that span more than one sheet (create, assignTask, rotateToken) run
// inside a LockService critical section so concurrent requests cannot
// interleave; employees_create additionally rolls back the Employees row if
// the dependent initial Tasks row cannot be inserted (audit F-02/F-03).

function employees_list(ctx) {
  ctx = ctx || getContext_();
  var rows = readAll_(ctx.sheets.EMPLOYEES);
  return rows.filter(function (r) { return r.id; }).map(function (r) {
    return {
      id: String(r.id),
      lastName: String(r.lastName || ''),
      firstName: String(r.firstName || ''),
      middleName: String(r.middleName || ''),
      email: String(r.email || ''),
      workspaceToken: String(r.workspaceToken || ''),
      createdAt: toIso_(r.createdAt),
      active: !(r.active === false || r.active === 'FALSE' || r.active === 'false')
    };
  });
}

function employees_findById(id, ctx) {
  if (!id) return null;
  var all = employees_list(ctx);
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

function employees_findByToken(token, ctx) {
  if (!token) return null;
  var all = employees_list(ctx);
  for (var i = 0; i < all.length; i++) if (all[i].workspaceToken === token) return all[i];
  return null;
}

function employees_create(data, ctx) {
  ctx = ctx || getContext_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var lastName = sanitize(data && data.lastName);
    var firstName = sanitize(data && data.firstName);
    var middleName = sanitize(data && data.middleName);
    var email = sanitize(data && data.email).toLowerCase();
    var initialTask = sanitize(data && data.initialTask);

    if (!lastName) throw UserError('Last name is required.');
    if (!firstName) throw UserError('First name is required.');
    if (!isValidEmail(email)) throw UserError('A valid email address is required.');
    if (!initialTask) throw UserError('An initial task is required.');

    validateLength(lastName, FIELD_LIMITS.lastName, 'Last name');
    validateLength(firstName, FIELD_LIMITS.firstName, 'First name');
    validateLength(middleName, FIELD_LIMITS.middleName, 'Middle name');
    validateLength(email, FIELD_LIMITS.email, 'Email');
    validateLength(initialTask, FIELD_LIMITS.taskTitle, 'Initial task');

    // Duplicate-email check and the pair of inserts share the lock, so no
    // concurrent request can slip between the check and the write.
    var existing = employees_list(ctx);
    for (var i = 0; i < existing.length; i++) {
      if ((existing[i].email || '').toLowerCase() === email) {
        throw UserError('An employee with this email already exists.');
      }
    }

    var employee = {
      id: uuid_(),
      lastName: lastName,
      firstName: firstName,
      middleName: middleName,
      email: email,
      workspaceToken: token_(),
      createdAt: nowIso_(),
      active: true
    };
    appendRow_(ctx.sheets.EMPLOYEES, employee, DEFAULT_CONFIG.HEADERS.EMPLOYEES);
    try {
      tasks_create({ employeeId: employee.id, title: initialTask }, ctx);
    } catch (taskErr) {
      // Compensating delete so a retry can succeed and the duplicate-email
      // check does not block the user forever.
      try {
        deleteRow_(ctx.sheets.EMPLOYEES, 'id', employee.id, DEFAULT_CONFIG.HEADERS.EMPLOYEES);
      } catch (rollbackErr) {
        try { console.error('employees_create rollback failed: ' + rollbackErr.message); } catch (_) {}
      }
      throw taskErr;
    }
    return employee;
  } finally {
    lock.releaseLock();
  }
}

// Policy: when a task is changed while a session is active, the active
// session is auto-closed (status 'paused') so its elapsed time stays
// attached to the original task; the original task is marked 'replaced' and
// a new 'active' task is created. Historical sessions are never retargeted.
function employees_assignTask(employeeId, title, ctx) {
  ctx = ctx || getContext_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var employee = employees_findById(employeeId, ctx);
    if (!employee) throw UserError('Employee not found.');
    var cleanTitle = sanitize(title);
    if (!cleanTitle) throw UserError('Task title is required.');
    validateLength(cleanTitle, FIELD_LIMITS.taskTitle, 'Task title');

    var active = sessions_findActive(employeeId, ctx);
    if (active) {
      closeSession_(active, 'paused', ctx);
    }
    var currentTask = tasks_getActive(employeeId, ctx);
    if (currentTask) {
      tasks_updateStatus(currentTask.id, 'replaced', ctx);
    }
    return tasks_create({ employeeId: employeeId, title: cleanTitle }, ctx);
  } finally {
    lock.releaseLock();
  }
}

// Rotate the workspace token so an exposed personal link stops working. The
// employee's identity, tasks and sessions are preserved; only the token
// changes. The caller receives the new token so a fresh link can be shared.
function employees_rotateToken(employeeId, ctx) {
  ctx = ctx || getContext_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var employee = employees_findById(employeeId, ctx);
    if (!employee) throw UserError('Employee not found.');
    var newToken = token_();
    updateRow_(ctx.sheets.EMPLOYEES, 'id', employeeId, { workspaceToken: newToken }, DEFAULT_CONFIG.HEADERS.EMPLOYEES);
    return { employeeId: employeeId, workspaceToken: newToken };
  } finally {
    lock.releaseLock();
  }
}

function employees_fullName(e) {
  return [e.lastName, e.firstName, e.middleName].filter(function (x) { return x; }).join(' ');
}
