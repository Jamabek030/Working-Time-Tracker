// Projects, task comments and the task activity (audit) log.
//
// Comments and activity rows are append-only: nothing in the application edits
// or deletes them, so the history of a task is preserved. Author identity is
// never taken from the client: employee comments use the employee resolved from
// the workspace token on the server; manager comments are labelled by role only
// (the demo Manager has no individual identity).

function projects_list_(ctx) {
  ctx = ctx || getContext_();
  if (!ctx.sheets.PROJECTS) return [];
  return readAll_(ctx.sheets.PROJECTS).filter(function (r) { return r.id; }).map(function (r) {
    return {
      id: String(r.id), name: String(r.name || ''), description: String(r.description || ''),
      status: String(r.status || 'active'), createdAt: toIso_(r.createdAt)
    };
  });
}

function projects_findById_(id, ctx) {
  if (!id) return null;
  var all = projects_list_(ctx);
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

function projects_create_(data, ctx) {
  ctx = ctx || getContext_();
  var name = sanitize(data && data.name);
  var description = sanitize(data && data.description);
  if (!name) throw UserError('Project name is required.');
  validateLength(name, FIELD_LIMITS.projectName, 'Project name');
  validateLength(description, FIELD_LIMITS.description, 'Description');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var lower = name.toLowerCase();
    projects_list_(ctx).forEach(function (p) {
      if (p.name.toLowerCase() === lower) throw UserError('A project with this name already exists.');
    });
    var project = { id: uuid_(), name: name, description: description, status: 'active', createdAt: nowIso_() };
    appendRow_(ctx.sheets.PROJECTS, project, DEFAULT_CONFIG.HEADERS.PROJECTS);
    return project;
  } finally {
    lock.releaseLock();
  }
}

// ---- comments -------------------------------------------------------------------

function comments_list_(ctx) {
  ctx = ctx || getContext_();
  if (!ctx.sheets.COMMENTS) return [];
  return readAll_(ctx.sheets.COMMENTS).filter(function (r) { return r.id; }).map(function (r) {
    return {
      id: String(r.id), taskId: String(r.taskId || ''), authorType: String(r.authorType || ''),
      authorId: String(r.authorId || ''), authorName: String(r.authorName || ''),
      text: String(r.text || ''), createdAt: toIso_(r.createdAt)
    };
  }).sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0); });
}

function comments_forTask_(taskId, ctx) {
  return comments_list_(ctx).filter(function (c) { return c.taskId === taskId; });
}

// author: { type: 'manager' | 'employee', id, name }. The task must already have
// been authorized by the caller.
function comments_add_(task, author, text, ctx) {
  ctx = ctx || getContext_();
  var clean = sanitize(text);
  if (!clean) throw UserError('Comment text is required.');
  validateLength(clean, FIELD_LIMITS.comment, 'Comment');
  var comment = {
    id: uuid_(), taskId: task.id, authorType: author.type === 'employee' ? 'employee' : 'manager',
    authorId: author.type === 'employee' ? author.id : '', authorName: author.type === 'employee' ? author.name : '',
    text: clean, createdAt: nowIso_()
  };
  appendRow_(ctx.sheets.COMMENTS, comment, DEFAULT_CONFIG.HEADERS.COMMENTS);
  activity_log_(ctx, task.id, author, 'commented', '');
  return comment;
}

// ---- activity log ----------------------------------------------------------------

// Best effort by design: an audit-log problem (for example the row cap) must
// never undo or block the operation it describes.
function activity_log_(ctx, taskId, actor, action, detail) {
  try {
    if (!ctx.sheets.ACTIVITY) return;
    appendRow_(ctx.sheets.ACTIVITY, {
      id: uuid_(), taskId: taskId, at: nowIso_(), actorType: (actor && actor.type) || 'system',
      actorId: (actor && actor.id) || '', action: action, detail: sanitize(detail).slice(0, 200)
    }, DEFAULT_CONFIG.HEADERS.ACTIVITY);
  } catch (err) {
    try { console.error('activity log failed: ' + (err && err.message ? err.message : String(err))); } catch (_) {}
  }
}

function activity_list_(ctx) {
  ctx = ctx || getContext_();
  if (!ctx.sheets.ACTIVITY) return [];
  return readAll_(ctx.sheets.ACTIVITY).filter(function (r) { return r.id; }).map(function (r) {
    return {
      id: String(r.id), taskId: String(r.taskId || ''), at: toIso_(r.at), actorType: String(r.actorType || ''),
      actorId: String(r.actorId || ''), action: String(r.action || ''), detail: String(r.detail || '')
    };
  }).sort(function (a, b) { return a.at < b.at ? -1 : (a.at > b.at ? 1 : 0); });
}

function activity_forTask_(taskId, ctx) {
  return activity_list_(ctx).filter(function (a) { return a.taskId === taskId; });
}
