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
  'api_listEmployees', 'api_createEmployee', 'api_loadDemoSample', 'api_getEmployeeDetails',
  'api_assignTask', 'api_rotateWorkspaceToken', 'api_generateReport', 'api_getEmployeeState',
  'api_startSession', 'api_pauseSession', 'api_resumeSession', 'api_finishTask'
];
const OWNER_ONLY = ['runTests', 'resetDemoData', 'enableOpenAccess', 'disableOpenAccess'];
const PURE = Object.keys(fns).filter(n => fns[n].file === 'pure.gs' && !n.endsWith('_'));

test('surface: every .gs file parses', () => {
  gsFiles.forEach(f => new vm.Script(read(f), { filename: f }));
});

test('surface: public functions are exactly doGet + api_* + owner-only + pure helpers', () => {
  const allowed = ['doGet'].concat(API, OWNER_ONLY, PURE).sort();
  assertEq(publicNames.slice().sort(), allowed);
});

test('surface: pure.gs performs no service calls (so its public helpers are inert)', () => {
  const pure = read('pure.gs');
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
    'Tests.gs': ['test_adminFunctionsRefuseWhenNotArmed_', 'test_adminArmingIsConsumedOnUse_']
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

test('surface: the only MailApp call is in email_sendInvitation_, behind the demo hard stop', () => {
  const hits = [];
  gsFiles.forEach(f => {
    read(f).split('\n').forEach((l, i) => { if (/MailApp|GmailApp/.test(l) && !l.trim().startsWith('//')) hits.push(f + ':' + (i + 1)); });
  });
  assertEq(hits.length, 1);
  assert(/^Email\.gs/.test(hits[0]), 'MailApp only in Email.gs');
  const body = fns.email_sendInvitation_.body;
  assert(body.indexOf('DEMO_CONFIG.ENABLED') < body.indexOf('MailApp.sendEmail'), 'demo guard precedes MailApp.sendEmail');
});

test('surface: api_createEmployee never mails in demo mode', () => {
  const body = fns.api_createEmployee.body;
  assert(/emailSkipped = DEMO_CONFIG\.ENABLED/.test(body) && /if \(!emailSkipped\)/.test(body), 'mail is conditional on !emailSkipped');
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

test('manifest: no mail or unrelated OAuth scopes, nothing broader than needed', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'appsscript.json'), 'utf8'));
  assertEq(manifest.oauthScopes.slice().sort(), [
    'https://www.googleapis.com/auth/script.scriptapp',
    'https://www.googleapis.com/auth/spreadsheets'
  ]);
  assertEq(manifest.webapp.executeAs, 'USER_DEPLOYING');
});

test('config: demo build is enabled with finite row caps', () => {
  const cfg = read('Config.gs');
  assert(/ENABLED:\s*true/.test(cfg), 'DEMO_CONFIG.ENABLED is true');
  ['EMPLOYEES', 'TASKS', 'SESSIONS'].forEach(k => assert(new RegExp(k + ':\\s*[1-9]\\d*').test(cfg.slice(cfg.indexOf('LIMITS'))), 'cap for ' + k));
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
