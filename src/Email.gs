// Invitation email.
//
// Delivery uses MailApp (scope script.send_mail), the narrowest Apps Script
// mail capability: it can only send, it cannot read the mailbox. The message is
// plain text with fixed wording; the only user-controlled parts are the
// employee's first name and task title, both sanitized and length-capped, and
// the recipient. Because the web app runs as its owner and is anonymous, mail is
// protected by:
//   * reserved example/test domains are never mailed,
//   * a global daily cap and a per-recipient daily cap (DEMO_CONFIG.EMAIL),
//   * every attempt is logged in the Invitations sheet (hashed recipient, status,
//     sanitized error text; never the workspace link or token),
//   * a kill switch: Script Property EMAIL_DISABLED=true stops all sending,
//   * the capability is probed with MailApp.getRemainingDailyQuota(), so a
//     deployment whose owner has not approved the mail scope reports
//     "not authorized" instead of failing.
// An accepted message is NOT proof of delivery; the UI says so.

// Test double hook. Production code never assigns it; tests (Node simulation and
// Tests.gs) set it so no real message is ever sent from an automated test.
var mailSender_ = null;

// True only while runTests runs (set and cleared by runTests). In that window a
// delivery without the test double is refused instead of reaching MailApp, so a
// test that forgets the double fails loudly rather than mailing someone.
var mailBlockedForTests_ = false;

function email_deliver_(msg) {
  if (mailSender_) { mailSender_(msg); return; }
  if (mailBlockedForTests_) throw new Error('Real mail refused: tests must install the mailSender_ test double.');
  MailApp.sendEmail(msg);
}

function email_enabled_() {
  if (!DEMO_CONFIG.EMAIL.ENABLED) return false;
  return PropertiesService.getScriptProperties().getProperty('EMAIL_DISABLED') !== 'true';
}

function email_capability_() {
  if (!email_enabled_()) return { enabled: false, available: false, remaining: 0 };
  if (mailSender_) return { enabled: true, available: true, remaining: DEMO_CONFIG.EMAIL.DAILY_LIMIT };
  if (mailBlockedForTests_) return { enabled: true, available: false, remaining: 0 };
  try {
    return { enabled: true, available: true, remaining: MailApp.getRemainingDailyQuota() };
  } catch (err) {
    return { enabled: true, available: false, remaining: 0 };
  }
}

function email_safeDetail_(err) {
  var m = (err && err.message) ? err.message : String(err);
  // Never persist anything that looks like a token or a link.
  m = m.replace(/https?:\/\/\S+/g, '[link]').replace(/[0-9a-fA-F]{24,}/g, '[redacted]');
  return sanitizeMailText(m, 120);
}

function invites_log_(ctx, employeeId, email, status, detail) {
  var id = uuid_();
  appendRow_(ctx.sheets.INVITES, {
    id: id, employeeId: employeeId, emailHash: shortHash(email), at: nowIso_(), status: status, detail: detail || ''
  }, DEFAULT_CONFIG.HEADERS.INVITES);
  return id;
}

function invites_set_(ctx, id, status, detail) {
  updateRow_(ctx.sheets.INVITES, 'id', id, { status: status, detail: detail || '' }, DEFAULT_CONFIG.HEADERS.INVITES);
}

function invites_list_(ctx) {
  ctx = ctx || getContext_();
  if (!ctx.sheets.INVITES) return [];
  return readAll_(ctx.sheets.INVITES).filter(function (r) { return r.id; }).map(function (r) {
    return { id: String(r.id), employeeId: String(r.employeeId || ''), emailHash: String(r.emailHash || ''),
      at: toIso_(r.at), status: String(r.status || ''), detail: String(r.detail || '') };
  });
}

// Latest invitation record per employee, as shown in the Manager. A row still
// 'pending' means a send never finished, which is reported as failed.
function invites_latestByEmployee_(ctx) {
  var out = {};
  invites_list_(ctx).forEach(function (r) {
    out[r.employeeId] = { status: r.status === 'pending' ? 'failed' : r.status, at: r.at };
  });
  return out;
}

// Attempts to invite one employee. Never throws for delivery problems: the
// returned status is what the Manager shows. The employee record is never
// touched here, so a failed send cannot lose it.
function email_sendInvitation_(employee, initialTaskTitle, lang, ctx) {
  ctx = ctx || getContext_();
  var cfg = DEMO_CONFIG.EMAIL;
  if (!email_enabled_()) return { status: 'disabled', at: nowIso_() };
  var email = String(employee.email || '').toLowerCase();
  if (isReservedTestEmail(email)) {
    invites_log_(ctx, employee.id, email, 'skipped_reserved', '');
    return { status: 'skipped_reserved', at: nowIso_() };
  }
  var cap = email_capability_();
  if (!cap.available) {
    invites_log_(ctx, employee.id, email, 'unavailable', 'mail scope not approved');
    return { status: 'unavailable', at: nowIso_() };
  }

  // Count today's attempts and reserve a row under one lock, so two concurrent
  // requests cannot both slip under the cap.
  var logId = null, blocked = null;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var today = nowIso_().slice(0, 10);
    var hash = shortHash(email);
    var global = 0, perRecipient = 0;
    invites_list_(ctx).forEach(function (r) {
      if (r.at.slice(0, 10) !== today) return;
      if (r.status !== 'sent' && r.status !== 'failed' && r.status !== 'pending') return;
      global++;
      if (r.emailHash === hash) perRecipient++;
    });
    if (global >= cfg.DAILY_LIMIT) blocked = 'limit_global';
    else if (perRecipient >= cfg.PER_RECIPIENT_DAILY) blocked = 'limit_recipient';
    else logId = invites_log_(ctx, employee.id, email, 'pending', '');
  } catch (err) {
    // e.g. the Invitations sheet is at its row cap: fail closed, never send.
    blocked = 'limit_global';
  } finally {
    lock.releaseLock();
  }
  if (blocked) {
    try { invites_log_(ctx, employee.id, email, blocked, ''); } catch (e) { /* log full: nothing more to record */ }
    return { status: blocked, at: nowIso_() };
  }

  var msg = buildInvitationEmail(lang, {
    firstName: employee.firstName,
    taskTitle: initialTaskTitle,
    url: employeeWorkspaceUrl_(employee.workspaceToken, normalizeLang(lang))
  });
  try {
    email_deliver_({ to: employee.email, subject: msg.subject, body: msg.body, name: translate(normalizeLang(lang), 'app.title'), noReply: true });
    invites_set_(ctx, logId, 'sent', '');
    return { status: 'sent', at: nowIso_() };
  } catch (err) {
    var detail = email_safeDetail_(err);
    try { console.error('invitation send failed: ' + detail); } catch (_) {}
    try { invites_set_(ctx, logId, 'failed', detail); } catch (e) { /* the status is still returned to the caller */ }
    return { status: 'failed', at: nowIso_() };
  }
}
