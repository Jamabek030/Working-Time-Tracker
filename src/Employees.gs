// Employee domain operations.

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
  var lastName = sanitize(data && data.lastName);
  var firstName = sanitize(data && data.firstName);
  var middleName = sanitize(data && data.middleName);
  var email = sanitize(data && data.email).toLowerCase();
  var initialTask = sanitize(data && data.initialTask);

  if (!lastName) throw new Error('Last name is required.');
  if (!firstName) throw new Error('First name is required.');
  if (!isValidEmail(email)) throw new Error('A valid email address is required.');
  if (!initialTask) throw new Error('An initial task is required.');

  var existing = employees_list(ctx);
  for (var i = 0; i < existing.length; i++) {
    if ((existing[i].email || '').toLowerCase() === email) {
      throw new Error('An employee with this email already exists.');
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
  tasks_create({ employeeId: employee.id, title: initialTask }, ctx);
  return employee;
}

// Policy: when a task is changed while a session is active, the active session
// is auto-closed (status 'paused') so its elapsed time stays attached to the
// original task; the original task is marked 'replaced' and a new 'active'
// task is created. Historical sessions are never retargeted.
function employees_assignTask(employeeId, title, ctx) {
  ctx = ctx || getContext_();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var employee = employees_findById(employeeId, ctx);
    if (!employee) throw new Error('Employee not found.');
    var cleanTitle = sanitize(title);
    if (!cleanTitle) throw new Error('Task title is required.');

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

function employees_fullName(e) {
  return [e.lastName, e.firstName, e.middleName].filter(function (x) { return x; }).join(' ');
}
