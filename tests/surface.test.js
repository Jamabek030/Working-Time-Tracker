// Static guards for the publicly callable surface of the Apps Script project.
//
// google.script.run can invoke every top-level function whose name does not
// end in "_". These tests fail if a new public function appears, if an api_*
// function forgets its access gate, or if an owner-only function loses its
// adminOnly_ guard. They parse the source text only; nothing is executed.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcDir = path.join(__dirname, '..', 'src');
const gsFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.gs'));
const read = f => fs.readFileSync(path.join(srcDir, f), 'utf8').replace(/\r\n/g, '\n');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + (msg || '')); }
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error('Expected ' + JSON.stringify(a) + ' to equal ' + JSON.stringify(b) + (msg ? ' - ' + msg : ''));
  }
}

// name -> { file, body } for every top-level `function name(...) {` declaration.
function topLevelFunctions() {
  const out = {};
  for (const f of gsFiles) {
    const src = read(f);
    const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
    let m;
    while ((m = re.exec(src))) {
      const start = m.index;
      // Body ends at the next top-level declaration or end of file.
      const next = src.slice(re.lastIndex).search(/^(function|var)\s/m);
      const end = next < 0 ? src.length : re.lastIndex + next;
      out[m[1]] = { file: f, body: src.slice(start, end) };
    }
  }
  return out;
}

const fns = topLevelFunctions();
const publicNames = Object.keys(fns).filter(n => !n.endsWith('_'));

const API = [
  'api_listEmployees', 'api_createEmployee', 'api_getEmployeeDetails',
  'api_assignTask', 'api_rotateWorkspaceToken', 'api_generateReport', 'api_getEmployeeState',
  'api_startSession', 'api_pauseSession', 'api_resumeSession', 'api_finishTask',
  'api_resendInvitation', 'api_getAppInfo', 'api_getDashboard', 'api_exportReportCsv',
  'api_listProjects', 'api_createProject', 'api_listTasks', 'api_createTask', 'api_publishTask', 'api_unpublishTask',
  'api_assignTaskToEmployee', 'api_updateTask', 'api_getTaskDetails', 'api_addManagerComment',
  'api_listAvailableTasks', 'api_claimTask', 'api_listMyComments', 'api_addComment'
];
const OWNER_ONLY = ['runTests', 'resetDemoData', 'seedAssessmentData', 'cleanupTestArtifacts', 'enableOpenAccess', 'disableOpenAccess'];
const PURE = Object.keys(fns).filter(n => (fns[n].file === 'pure.gs' || fns[n].file === 'i18n.gs' || fns[n].file === 'dataset.gs') && !n.endsWith('_'));

test('surface: every .gs file parses', () => {
  gsFiles.forEach(f => new vm.Script(read(f), { filename: f }));
});

test('surface: public functions are exactly doGet + api_* + owner-only + pure helpers', () => {
  const allowed = ['doGet'].concat(API, OWNER_ONLY, PURE).sort();
  assertEq(publicNames.slice().sort(), allowed);
});

test('surface: pure.gs performs no service calls (so its public helpers are inert)', () => {
  const pure = read('pure.gs') + '\n' + read('i18n.gs');
  const forbidden = /\b(SpreadsheetApp|PropertiesService|MailApp|GmailApp|DriveApp|UrlFetchApp|ScriptApp|LockService|CacheService|HtmlService|Session)\b\s*\./;
  assert(!forbidden.test(pure.replace(/\/\/.*$/gm, '')), 'pure.gs must not call Apps Script services');
});

test('surface: every api_* function is wrapped in safeApi_ and gated by requireOpenAccess_', () => {
  API.forEach(n => {
    assert(fns[n], n + ' exists');
    assert(/return safeApi_\(/.test(fns[n].body), n + ' uses safeApi_');
    assert(/requireOpenAccess_\(\);/.test(fns[n].body), n + ' calls requireOpenAccess_');
  });
});

test('surface: api_* functions never accept a spreadsheet, sheet or context argument', () => {
  API.forEach(n => {
    const params = fns[n].body.match(/^function\s+\w+\(([^)]*)\)/)[1];
    assert(!/ctx|sheet|spreadsheet|ssId|range\w*Name/i.test(params), n + '(' + params + ') exposes an internal handle');
  });
});

test('surface: owner-only functions call adminOnly_ before doing anything else', () => {
  OWNER_ONLY.forEach(n => {
    assert(fns[n], n + ' exists');
    const first = fns[n].body.split('\n').slice(1).find(l => l.trim() && !l.trim().startsWith('//'));
    assert(/^\s*adminOnly_\('/.test(first), n + ' must start with adminOnly_(...), found: ' + first);
  });
});

test('surface: each admin function arms only itself (label bound to ADMIN_MODE value)', () => {
  OWNER_ONLY.forEach(n => {
    const m = fns[n].body.match(/adminOnly_\('([^']+)'\)/);
    assert(m && m[1] === n, n + ' passes its own name to adminOnly_, found ' + (m && m[1]));
  });
  assert(/getProperty\('ADMIN_MODE'\) !== label/.test(fns.adminOnly_.body), 'value compared to the label');
});

test('surface: admin arming is checked and consumed atomically under the script lock', () => {
  const b = fns.adminOnly_.body;
  assert(/LockService\.getScriptLock\(\)/.test(b) && /tryLock\(/.test(b), 'takes the script lock');
  assert(/deleteProperty\('ADMIN_MODE'\)/.test(b), 'consumes the property');
  assert(b.indexOf('getProperty') < b.indexOf('deleteProperty'), 'check precedes consume');
  assert(/finally\s*\{[^}]*releaseLock/.test(b), 'lock released in finally');
});

test('surface: no public function lets a caller set the spreadsheet id or a Script Property', () => {
  assert(!fns.setSpreadsheetId, 'setSpreadsheetId removed');
  const allowedWriters = {
    'Code.gs': ['enableOpenAccess', 'disableOpenAccess'],
    'Config.gs': ['getSpreadsheet_'],
    'Tests.gs': ['test_adminFunctionsRefuseWhenNotArmed_', 'test_adminArmingIsConsumedOnUse_', 'test_emailKillSwitchStopsAllSending_']
  };
  Object.keys(fns).forEach(n => {
    if (!/setProperty\(|setProperties\(/.test(fns[n].body.replace(/\/\/.*$/gm, ''))) return;
    const ok = (allowedWriters[fns[n].file] || []).indexOf(n) >= 0;
    assert(ok, n + ' in ' + fns[n].file + ' writes a Script Property');
  });
  ['enableOpenAccess', 'disableOpenAccess'].forEach(n => assert(/adminOnly_/.test(fns[n].body), n + ' guarded'));
  assert(/setProperty\('SPREADSHEET_ID', active\.getId\(\)\)/.test(fns.getSpreadsheet_.body), 'only the container id is ever stored');
});

test('surface: no non-declaration globals (var f = function, arrow) that could be callable', () => {
  gsFiles.forEach(f => {
    read(f).split('\n').forEach((l, i) => {
      assert(!/^(var|let|const)\s+[A-Za-z0-9_$]+\s*=\s*(function\b|\([^)]*\)\s*=>|[A-Za-z0-9_$]+\s*=>)/.test(l), f + ':' + (i + 1) + ' ' + l);
      assert(!/^[A-Za-z0-9_$.]+\s*=\s*function\b/.test(l), f + ':' + (i + 1) + ' ' + l);
    });
  });
});

test('surface: doGet checks access before touching the spreadsheet and never echoes error text', () => {
  const b = fns.doGet.body;
  assert(b.indexOf('access_isOpen_()') >= 0 && b.indexOf('access_isOpen_()') < b.indexOf('setupSheets_()'), 'access check precedes setupSheets_');
  assert(!/htmlError_\([^)]*err\.message/.test(b), 'err.message is not shown to visitors');
});

test('surface: spreadsheet ids and URLs are only read where intended', () => {
  gsFiles.filter(f => f !== 'Tests.gs').forEach(f => {
    read(f).split('\n').forEach((l, i) => {
      if (l.trim().startsWith('//')) return;
      if (/getConfiguredSpreadsheetId_|\.getId\(\)|getUrl\(\)/.test(l)) {
        const ok = (f === 'Config.gs') || (f === 'Code.gs' && /ScriptApp\.getService\(\)\.getUrl\(\)/.test(l));
        assert(ok, 'unexpected id/url access at ' + f + ':' + (i + 1) + ': ' + l.trim());
      }
    });
  });
});

test('surface: MailApp is only touched in Email.gs, sendEmail only inside email_deliver_', () => {
  const hits = [];
  gsFiles.forEach(f => {
    read(f).split('\n').forEach((l, i) => { if (/MailApp|GmailApp/.test(l) && !l.trim().startsWith('//')) hits.push(f + ':' + (i + 1) + ' ' + l.trim()); });
  });
  hits.forEach(h => assert(/^Email\.gs/.test(h), 'MailApp outside Email.gs: ' + h));
  assert(!hits.some(h => /GmailApp/.test(h)), 'GmailApp (mailbox access) is never used');
  const send = hits.filter(h => /sendEmail/.test(h));
  assertEq(send.length, 1, 'exactly one sendEmail call');
  assert(/MailApp\.sendEmail\(msg\)/.test(fns.email_deliver_.body), 'sendEmail lives in email_deliver_');
  const quota = hits.filter(h => /getRemainingDailyQuota/.test(h));
  assertEq(quota.length, 1);
});

test('surface: every send passes the kill switch, the reserved-domain rule, the capability probe and the caps first', () => {
  const body = fns.email_sendInvitation_.body;
  const order = ['email_enabled_()', 'isReservedTestEmail(', 'email_capability_()', 'DAILY_LIMIT', 'PER_RECIPIENT_DAILY', 'email_deliver_('].map(k => body.indexOf(k));
  order.forEach((i, n) => assert(i >= 0, 'missing step ' + n));
  for (let i = 1; i < order.length; i++) assert(order[i] > order[i - 1], 'step ' + i + ' out of order');
  assert(/LockService\.getScriptLock\(\)/.test(body), 'cap check and reservation run under the script lock');
  assert(/function email_deliver_[\s\S]*mailSender_/.test(read('Email.gs')), 'test double hook exists');
  gsFiles.filter(f => f !== 'Tests.gs').forEach(f => assert(!/mailSender_\s*=/.test(read(f).replace(/var mailSender_ = null;/, '')), f + ' must not assign mailSender_'));
});

test('surface: the employee exists before any invitation is attempted, and a failed invitation cannot undo it', () => {
  const body = fns.api_createEmployee.body;
  assert(body.indexOf('employees_create_(') >= 0 && body.indexOf('employees_create_(') < body.indexOf('email_sendInvitation_('), 'create precedes invite');
  assert(/catch \(err\)/.test(body.slice(body.indexOf('email_sendInvitation_('))), 'invite errors are caught');
  assert(!/deleteRow_|deleteRowsWhere_/.test(body), 'no rollback of the employee on invitation failure');
});

test('surface: invitation log never receives the token or the plain address', () => {
  const body = fns.email_sendInvitation_.body + fns.invites_log_.body;
  assert(!/workspaceToken/.test(fns.invites_log_.body), 'log writer does not touch the token');
  assert(/shortHash\(email\)/.test(fns.invites_log_.body), 'recipient is hashed');
  assert(/email_safeDetail_\(err\)/.test(fns.email_sendInvitation_.body), 'error text is sanitized before it is stored');
  assert(body.length > 0);
});

test('surface: client code never builds HTML from data', () => {
  ['manager_js.html', 'employee_js.html', 'i18n_js.html'].forEach(f => {
    const src = fs.readFileSync(path.join(srcDir, f), 'utf8');
    assert(!/insertAdjacentHTML|document\.write|outerHTML\s*=|\beval\(|new Function\(/.test(src), f + ' uses an HTML/code sink');
    const sinks = src.match(/\.innerHTML\s*=[^;]*/g) || [];
    assertEq(sinks.length, 0, f + ' assigns innerHTML: ' + sinks.join(' | '));
  });
});

test('surface: client code only calls api_* functions', () => {
  const html = fs.readdirSync(srcDir).filter(f => f.endsWith('.html')).map(f => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');
  const called = new Set();
  const re = /call\('([A-Za-z0-9_]+)'/g;
  let m;
  while ((m = re.exec(html))) called.add(m[1]);
  assert(called.size > 0, 'client calls found');
  called.forEach(n => assert(API.indexOf(n) >= 0, 'client calls unknown server function ' + n));
});

test('manifest: only spreadsheets, scriptapp and the send-only mail scope (no Gmail, Drive or others)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'appsscript.json'), 'utf8'));
  assertEq(manifest.oauthScopes.slice().sort(), [
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/script.send_mail',
    'https://www.googleapis.com/auth/spreadsheets'
  ]);
  assertEq(manifest.webapp.executeAs, 'USER_DEPLOYING');
});

test('config: demo build is enabled with finite row caps', () => {
  const cfg = read('Config.gs');
  assert(/ENABLED:\s*true/.test(cfg), 'DEMO_CONFIG.ENABLED is true');
  ['EMPLOYEES', 'TASKS', 'SESSIONS', 'INVITES'].forEach(k => assert(new RegExp(k + ':\\s*[1-9]\\d*').test(cfg.slice(cfg.indexOf('LIMITS'))), 'cap for ' + k));
  assert(/DAILY_LIMIT:\s*[1-9]\d*/.test(cfg) && /PER_RECIPIENT_DAILY:\s*[1-9]\d*/.test(cfg), 'finite email caps');
});

const EMPLOYEE_API = ['api_getEmployeeState', 'api_listAvailableTasks', 'api_claimTask', 'api_startSession', 'api_pauseSession',
  'api_resumeSession', 'api_finishTask', 'api_listMyComments', 'api_addComment'];

test('access: every employee API resolves the employee from the token first and takes no employee id', () => {
  EMPLOYEE_API.forEach(n => {
    const b = fns[n].body;
    const params = b.match(/^function\s+\w+\(([^)]*)\)/)[1].split(',').map(x => x.trim());
    assertEq(params[0], 'token', n + ' first parameter');
    assert(!params.some(p => /employee/i.test(p)), n + ' must not accept an employee id: ' + params.join());
    assert(/employeeFromToken_\(token\)/.test(b), n + ' resolves the token');
    assert(b.indexOf('employeeFromToken_(token)') < b.search(/tasks_|sessions_|comments_|projects_/), n + ' authenticates before touching data');
  });
});

test('access: task ownership is decided by the stored row (tasks_requireOwned_) for every employee write on a task', () => {
  assert(/tasks_requireOwned_\(/.test(fns.api_addComment.body), 'comments');
  assert(/tasks_requireOwned_\(/.test(fns.sessions_start_.body) && /tasks_requireOwned_\(/.test(fns.sessions_finish_.body), 'timer');
  assert(/employee\.id/.test(fns.tasks_claim_.body) && !/employeeId/.test(fns.api_claimTask.body), 'claim uses the resolved employee');
  assert(/LockService\.getScriptLock\(\)/.test(fns.tasks_move_.body) && /tasks_findById_\(taskId, ctx\)/.test(fns.tasks_move_.body), 'task moves re-read the row inside the lock');
  assert(fns.tasks_move_.body.indexOf('nextTaskStatus') > fns.tasks_move_.body.indexOf('tasks_findById_'), 'the transition is checked against the fresh row');
  ['tasks_claim_', 'tasks_assign_', 'tasks_publish_', 'tasks_unpublish_'].forEach(n => assert(/tasks_move_\(/.test(fns[n].body), n + ' goes through tasks_move_'));
  assert(fns.tasks_move_.body.indexOf('updates.status = next') > fns.tasks_move_.body.indexOf('buildUpdates'), 'status is written last');
});

test('access: pages call only the APIs that belong to them', () => {
  const read2 = f => fs.readFileSync(path.join(srcDir, f), 'utf8');
  const names = src => Array.from(new Set((src.match(/'(api_\w+)'/g) || []).map(x => x.slice(1, -1))));
  const emp = names(read2('employee_js.html'));
  const mgr = names(read2('manager_js.html'));
  assert(emp.length >= 8 && mgr.length >= 19, 'found calls');
  emp.forEach(n => assert(EMPLOYEE_API.indexOf(n) >= 0, 'employee page calls ' + n));
  mgr.forEach(n => assert(API.indexOf(n) >= 0 && EMPLOYEE_API.indexOf(n) < 0, 'manager page calls ' + n));
  assert(!/employeeId/.test(read2('employee_js.html')), 'employee page never handles an employee id');
});

test('access: the employee page template renders no manager markup or manager data', () => {
  const html = fs.readFileSync(path.join(srcDir, 'employee.html'), 'utf8');
  assert(!/manager_js|create-form|api_list(Employees|Tasks|Projects)|api_getDashboard/.test(html), 'no manager bits in employee.html');
  assert(/workspaceTokenJs/.test(html), 'token comes from the server-resolved employee');
  const doget = fns.doGet.body;
  assert(/createTemplateFromFile\('employee'\)/.test(doget) && /employees_findByToken_\(token\)/.test(doget), 'the employee page is served only for a valid token');
});

test('layout: sidebar layout is responsive, keyboard-visible and has a mobile menu', () => {
  const css = fs.readFileSync(path.join(srcDir, 'styles.html'), 'utf8');
  ['@media (max-width: 960px)', '@media (max-width: 700px)', '@media (max-width: 1100px)', ':focus-visible', 'prefers-reduced-motion', '.sidebar', '.scrim', 'table.stack td::before'].forEach(k => assert(css.indexOf(k) >= 0, 'css has ' + k));
  assert(/\.sidebar\s*\{[^}]*background:\s*var\(--nav-bg\)/.test(css), 'dark persistent sidebar');
  ['manager.html', 'employee.html'].forEach(f => {
    const html = fs.readFileSync(path.join(srcDir, f), 'utf8');
    assert(/id="menu-btn"[^>]*aria-expanded="false"[^>]*aria-controls="sidebar"|id="menu-btn"[^>]*aria-controls="sidebar"[^>]*aria-expanded="false"/.test(html), f + ' menu button is accessible');
    assert(/<meta name="viewport"/.test(html) && /<a class="skip"/.test(html), f + ' viewport + skip link');
    assert(/<label for="lang-select"/.test(html), f + ' language select is labelled');
    assert((html.match(/class="nav-item/g) || []).length >= 5, f + ' navigation items');
    assert(!/<(div|span) class="nav-item/.test(html), f + ' navigation items are real buttons');
  });
});

let passed = 0;
const failures = [];
for (const t of tests) {
  try {
    t.fn();
    passed++;
    console.log('  OK   ' + t.name);
  } catch (err) {
    failures.push(t.name);
    console.log('  FAIL ' + t.name + ' -- ' + err.message);
  }
}
console.log('\n' + passed + '/' + tests.length + ' passed (surface)');
if (failures.length) process.exitCode = 1;
