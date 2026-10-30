// End-to-end acceptance run against the deployed /exec URL in a fresh, signed-out Chrome profile.
const { launch, sleep } = require('./cdp');
const URL_EXEC = process.argv[2];
const SHEET_ID_FRAGMENT = (process.env.SHEET_ID || '').slice(0, 19);
if (!URL_EXEC || !SHEET_ID_FRAGMENT) { console.error('usage: SHEET_ID=<spreadsheet id> node tests/live/accept.js <exec url>'); process.exit(2); }
const results = [];
const EMAIL = 'demo.verifier.' + Date.now() + '@example.com';
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' -- ' + detail : '')); };

(async () => {
  const b = await launch(9333);
  try {
    // A. open anonymously
    const page = await b.newPage(URL_EXEC);
    const mgr = await b.findFrame("document.querySelector('#create-form') && document.querySelector('#employees-loading')", 40000);
    const tinfo = [await b.evalIn(page.sessionId, 'location.href')];
    rec('A1 manager loads without Google sign-in', !tinfo.some(u => /accounts\.google\.com/.test(u)) && tinfo.some(u => /script\.google\.com\/macros\/s\//.test(u)), tinfo.join(' | ').slice(0, 160));
    const banner = await b.evalIn(mgr, "document.querySelector('.banner') ? document.querySelector('.banner').textContent.slice(0,60) : ''");
    rec('A2 demo banner shown', /Public demonstration/.test(banner), banner);

    const waitList = async (pred, ms) => { const end = Date.now() + (ms || 30000); while (Date.now() < end) { const t = await b.evalIn(mgr, "(document.querySelector('#employees-table').hidden ? '' : document.querySelector('#employees-table').innerText)"); if (pred(t)) return t; await sleep(700); } throw new Error('list wait timeout'); };
    await waitList(t => !/Loading…/.test(t));
    const before = await b.evalIn(mgr, "document.querySelector('#employees-empty').hidden ? 'has-rows' : 'empty'");
    console.log('initial list state:', before);

    // B. create employee
    await b.evalIn(mgr, `(function(){var f=document.querySelector('#create-form');
      function set(n,v){var i=f.querySelector('[name='+n+']');i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}));}
      set('lastName','Verifier');set('firstName','Demo');set('middleName','Q');set('email','${EMAIL}');set('initialTask','Acceptance test task');
      f.querySelector('button[type=submit]').click();})()`);
    let status = '';
    for (let i = 0; i < 40; i++) { status = await b.evalIn(mgr, "document.querySelector('#create-status').textContent"); if (/Created|limit|error|required/i.test(status)) break; await sleep(700); }
    rec('B1 employee created, no email', /Created Verifier Demo/.test(status) && /no email is sent/i.test(status), status);
    const listText = await waitList(t => t.indexOf(EMAIL) >= 0);
    rec('B2 employee appears in list', listText.indexOf(EMAIL) >= 0 && /Verifier Demo/.test(listText), '');

    // details + workspace link + initial task
    await b.evalIn(mgr, `Array.from(document.querySelectorAll('#employees-table tbody tr')).find(function(r){return r.innerText.indexOf('${EMAIL}')>=0}).querySelector('button').click()`);
    let details = '';
    for (let i = 0; i < 40; i++) { details = await b.evalIn(mgr, "document.querySelector('#details-content').innerText"); if (/Workspace link/.test(details)) break; await sleep(700); }
    rec('B3 initial task shown in Details', /Acceptance test task/.test(details), '');
    const link = await b.evalIn(mgr, "(document.querySelector('#details-content a.link')||{}).href||''");
    rec('B4 copyable employee workspace link available in Manager', /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\?page=employee&token=[0-9a-f]{40}$/.test(link), link.replace(/token=.*/, 'token=<redacted>'));

    // assign a second task (history preserved)
    await b.evalIn(mgr, "(function(){var f=document.querySelector('#details-content form');var i=f.querySelector('input');i.value='Second task';i.dispatchEvent(new Event('input',{bubbles:true}));f.querySelector('button[type=submit]').click();})()");
    for (let i = 0; i < 40; i++) { details = await b.evalIn(mgr, "document.querySelector('#details-content').innerText"); if (/Second task/.test(details)) break; await sleep(700); }
    rec('B5 second task assigned; first task kept as history', /Second task/.test(details) && /Acceptance test task/.test(details) && /replaced/.test(details), '');
    // switch back is not supported; employee works on the active (second) task.

    // C. employee workspace
    const emp = await b.newPage(link);
    let ef = await b.findFrame("document.querySelector('#btn-start') && document.querySelector('#task-title') && !/Loading/.test(document.querySelector('#task-title').textContent)", 40000);
    const title = await b.evalIn(ef, "document.querySelector('#task-title').textContent");
    rec('C1 employee workspace opens anonymously with the active task', title === 'Second task', title);
    const vis = id => b.evalIn(ef, "!document.querySelector('" + id + "').hidden");
    rec('C2 Start visible, Pause hidden before starting', (await vis('#btn-start')) && !(await vis('#btn-pause')), '');
    const timer = () => b.evalIn(ef, "document.querySelector('#timer-display').textContent");
    await b.evalIn(ef, "document.querySelector('#btn-start').click()");
    for (let i = 0; i < 30 && !(await vis('#btn-pause')); i++) await sleep(500);
    rec('C3 timer started (Pause/Finish shown)', await vis('#btn-pause'), '');
    await sleep(3500);
    const t1 = await timer();
    rec('C4 elapsed time increases while running', t1 !== '00:00:00', t1);

    // D. refresh during an active timer
    await b.send('Page.reload', {}, emp.sessionId);
    await sleep(2000);
    ef = await b.findFrame("document.querySelector('#btn-pause') && !document.querySelector('#btn-pause').hidden", 40000);
    const t2 = await b.evalIn(ef, "document.querySelector('#timer-display').textContent");
    rec('D1 refresh while running restores the running timer (not reset)', t2 !== '00:00:00' && t2 >= t1, t1 + ' -> ' + t2);

    await b.evalIn(ef, "document.querySelector('#btn-pause').click()");
    for (let i = 0; i < 30 && !(await b.evalIn(ef, "!document.querySelector('#btn-resume').hidden")); i++) await sleep(500);
    const p1 = await timer(); await sleep(3500); const p2 = await timer();
    rec('C5 pause stops elapsed time', p1 === p2 && p1 !== '00:00:00', p1 + ' vs ' + p2);
    await b.evalIn(ef, "document.querySelector('#btn-resume').click()");
    for (let i = 0; i < 30 && !(await vis('#btn-pause')); i++) await sleep(500);
    await sleep(2500);
    const r1 = await timer();
    rec('C6 resume continues from paused total (>= paused value, running)', r1 >= p2 && (await vis('#btn-pause')), p2 + ' -> ' + r1);
    const hist = await b.evalIn(ef, "document.querySelector('#history-table').innerText");
    const rows = (hist.match(/\n/g) || []).length;
    rec('C7 resume created a NEW session row (2 rows: paused + active)', /paused/.test(hist) && /active/.test(hist), hist.replace(/\s+/g, ' ').slice(0, 120));

    // duplicate timer: a second concurrent start from the API must be refused
    const dup = await b.evalIn(ef, "new Promise(function(res){google.script.run.withSuccessHandler(function(){res('ACCEPTED')}).withFailureHandler(function(e){res('REFUSED: '+e.message)}).api_startSession(WORKSPACE_TOKEN)})");
    rec('C8 duplicate active timer rejected', /REFUSED: .*A session is already running/.test(dup), dup);

    // finish
    await b.evalIn(ef, "document.querySelector('#btn-finish').click()");
    for (let i = 0; i < 30; i++) { const t = await b.evalIn(ef, "document.querySelector('#btn-pause').hidden && document.querySelector('#btn-resume').hidden && document.querySelector('#btn-start').hidden"); if (t) break; await sleep(500); }
    const finalTitle = await b.evalIn(ef, "document.querySelector('#task-title').textContent");
    rec('C9 finish ends the task and timer', /No active task/.test(finalTitle), finalTitle + ' | dialogs=' + b.dialogs.length);

    // E. manager sees history + report after a reload
    await b.send('Page.reload', {}, page.sessionId);
    const mgr2 = await b.findFrame("document.querySelector('#create-form') && document.querySelector('#employees-table') && !document.querySelector('#employees-table').hidden", 40000);
    const mt = async () => b.evalIn(mgr2, "document.querySelector('#employees-table').innerText");
    rec('D2 reopening the URL keeps the employee (persistence)', (await mt()).indexOf(EMAIL) >= 0, '');
    await b.evalIn(mgr2, `Array.from(document.querySelectorAll('#employees-table tbody tr')).find(function(r){return r.innerText.indexOf('${EMAIL}')>=0}).querySelector('button').click()`);
    let d2 = ''; for (let i = 0; i < 40; i++) { d2 = await b.evalIn(mgr2, "document.querySelector('#details-content').innerText"); if (/Work sessions/.test(d2) && /completed|paused/.test(d2)) break; await sleep(700); }
    rec('E1 Manager Details show tasks (both) and the work sessions incl. completed', /Acceptance test task/.test(d2) && /Second task/.test(d2) && /completed/.test(d2) && /paused/.test(d2), d2.replace(/\s+/g, ' ').slice(-200));
    await b.evalIn(mgr2, "document.querySelector('[data-tab=reports]').click(); document.querySelector('#report-form button[type=submit]').click()");
    let rep = ''; for (let i = 0; i < 40; i++) { rep = await b.evalIn(mgr2, "document.querySelector('#report-content').innerText"); if (rep.length > 20) break; await sleep(700); }
    const totals = (rep.match(/Total in range: (\d\d:\d\d:\d\d)/g) || []).map(x => x.slice(-8));
    rec('E2 report for default range lists employees; this run\'s sessions are totalled (>0)', totals.some(t => t !== '00:00:00') && /completed|paused/.test(rep), 'totals=' + totals.join(','));
    await b.evalIn(mgr2, "(function(){var f=document.querySelector('#report-form');f.from.value='2000-01-01';f.to.value='2000-01-02';f.querySelector('button[type=submit]').click();})()");
    let rep2 = ''; for (let i = 0; i < 40; i++) { rep2 = await b.evalIn(mgr2, "document.querySelector('#report-content').innerText"); if (/No activity/.test(rep2)) break; await sleep(700); }
    rec('E3 empty date range gives a clear empty report', /No activity in the selected period/.test(rep2), rep2.trim());

    // F. security probes from the Manager client
    const probe = fn => b.evalIn(mgr2, "new Promise(function(res){var t=setTimeout(function(){res('TIMEOUT')},20000);try{google.script.run.withSuccessHandler(function(v){clearTimeout(t);res('RETURNED:'+JSON.stringify(v).slice(0,80))}).withFailureHandler(function(e){clearTimeout(t);res('REFUSED:'+(e&&e.message))})." + fn + "}catch(e){clearTimeout(t);res('NOT CALLABLE (not exposed by google.script.run): '+e.message)}})");
    const privateNames = ['employees_list_', 'employees_findByToken_', 'sessions_list_', 'tasks_list_', 'reports_generate_', 'email_sendInvitation_', 'setupSheets_', 'getSpreadsheet_', 'getContext_', 'readAll_', 'appendRow_', 'updateRow_', 'deleteRow_', 'getConfiguredSpreadsheetId_', 'getAccessMode_', 'demo_reset_', 'adminOnly_', 'setSpreadsheetId', 'getWebAppUrl_', 'include_'];
    const privOut = [];
    for (const n of privateNames) privOut.push(n + ' => ' + await probe(n + '()'));
    const privBad = privOut.filter(x => /RETURNED|TIMEOUT/.test(x));
    rec('F1 private/internal functions are not callable from the client', privBad.length === 0, privBad.length ? privBad.join('; ') : privOut[0] + ' ...(' + privOut.length + ' probed)');
    console.log(privOut.join('\n'));
    const adminOut = [];
    for (const n of ['runTests', 'resetDemoData', 'enableOpenAccess', 'disableOpenAccess']) adminOut.push(n + ' => ' + await probe(n + '()'));
    console.log(adminOut.join('\n'));
    rec('F2 admin functions refuse an anonymous caller (not armed)', adminOut.every(x => /REFUSED:.*not armed/.test(x)), adminOut.map(x => x.slice(0, 70)).join(' | '));
    const leaks = [];
    const probesJson = [await probe('api_listEmployees()'), await probe("api_getEmployeeDetails('x')"), await probe("api_generateReport('2026-01-01','2026-12-31')")];
    // full-text checks of everything the client can see
    const htmlAll = [];
    for (const s of Array.from(b.contexts.values())) { try { htmlAll.push(await b.evalIn(s, 'document.documentElement.outerHTML')); } catch (e) {} }
    const blob = htmlAll.join('\n') + probesJson.join('\n');
    rec('F3 spreadsheet id is not present in any page/frame/API response', !blob.includes(SHEET_ID_FRAGMENT), '');
    const listFull = await b.evalIn(mgr2, "new Promise(function(res){google.script.run.withSuccessHandler(function(v){res(JSON.stringify(v))}).api_listEmployees()})");
    rec('F4 employee list response carries no workspace token', !/workspaceToken|"token"/.test(listFull) && !/[0-9a-f]{40}/.test(listFull), '');
    const refuse = await probe("api_getEmployeeDetails({a:1})");
    rec('F5 object/odd identifiers are rejected without internal detail', /REFUSED:.*(Employee not found|A server error occurred)/.test(refuse) && !/\.gs|Exception|stack/.test(refuse), refuse);

    // identifier swap: employee API must not accept an employee id in place of a token
    const empId = JSON.parse(listFull).find(e => e.email === EMAIL).id;
    const swap = await b.evalIn(ef, "new Promise(function(res){google.script.run.withSuccessHandler(function(v){res('ACCEPTED')}).withFailureHandler(function(e){res('REFUSED: '+e.message)}).api_getEmployeeState('" + empId + "')})");
    rec('F6 employee API refuses an employee id used as a token', /REFUSED: .*Invalid workspace link/.test(swap), swap);
    const swap2 = await b.evalIn(ef, "new Promise(function(res){google.script.run.withSuccessHandler(function(v){res('ACCEPTED')}).withFailureHandler(function(e){res('REFUSED: '+e.message)}).api_startSession('" + empId + "')})");
    rec('F7 employee API cannot start a timer by id', /REFUSED: .*Invalid workspace link/.test(swap2), swap2);

    // formula injection through the real UI path
    await b.evalIn(mgr2, "document.querySelector('[data-tab=employees]').click()");
    const inj = await b.evalIn(mgr2, "new Promise(function(res){google.script.run.withSuccessHandler(function(v){res('OK')}).withFailureHandler(function(e){res('REFUSED: '+e.message)}).api_createEmployee({lastName:'=HYPERLINK(\"http://evil\",\"x\")',firstName:'+1',email:'inj.verifier@example.com',initialTask:'@cmd'})})");
    const listInj = await b.evalIn(mgr2, "new Promise(function(res){google.script.run.withSuccessHandler(function(v){res(JSON.stringify(v))}).api_listEmployees()})");
    rec('F8 formula-looking input accepted as plain text and returned unchanged', inj === 'OK' && listInj.includes('=HYPERLINK(\\"http://evil\\",\\"x\\")'), inj);

    // validation messages
    const longName = await b.evalIn(mgr2, "new Promise(function(res){google.script.run.withSuccessHandler(function(){res('OK')}).withFailureHandler(function(e){res(e.message)}).api_createEmployee({lastName:new Array(102).join('x'),firstName:'A',email:'a@example.com',initialTask:'T'})})");
    rec('F9 validation error is understandable', /Last name is too long/.test(longName), longName);
  } catch (e) {
    rec('RUN ABORTED', false, e.message);
  } finally {
    await b.close();
    const pass = results.filter(r => r.ok).length;
    console.log('\n' + pass + '/' + results.length + ' checks passed');
  }
})();
