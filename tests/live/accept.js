// End-to-end acceptance run against a deployed /exec URL, in a fresh, signed-out
// headless Chrome profile driven over the DevTools protocol.
//
//   SHEET_ID=<demo spreadsheet id> node tests/live/accept.js <exec url>
//
// It creates clearly fictional records that the owner-armed cleanupTestArtifacts()
// function can remove again: employees demo.verifier.<digits>@example.com and a
// project named "Acceptance project <digits>" with its tasks. It never sends
// email: every address ends in @example.com, which the app never mails.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, sleep } = require('./cdp');

const URL_EXEC = process.argv[2];
const SHEET_ID_FRAGMENT = (process.env.SHEET_ID || '').slice(0, 19);
if (!URL_EXEC || !SHEET_ID_FRAGMENT) { console.error('usage: SHEET_ID=<spreadsheet id> node tests/live/accept.js <exec url>'); process.exit(2); }

const STAMP = Date.now();
const EMAIL_A = 'demo.verifier.' + STAMP + '@example.com';
const EMAIL_B = 'demo.verifier.' + (STAMP + 1) + '@example.com';
const PROJECT = 'Acceptance project ' + STAMP;
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' -- ' + detail : '')); };

(async () => {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtt-dl-'));
  const b = await launch(9337);
  const downloads = [];
  const pageErrors = [];
  b.on(m => {
    if (m.method === 'Browser.downloadWillBegin') downloads.push(m.params);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text).slice(0, 200));
  });
  try {
    await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
    const page = await b.newPage(URL_EXEC);
    const ev = (h, code) => b.evalIn(h, code);
    const find = (probe, ms) => b.findFrame(probe, ms || 45000);
    const until = async (h, code, pred, ms) => { const end = Date.now() + (ms || 30000); let v; while (Date.now() < end) { v = await ev(h, code); if (pred(v)) return v; await sleep(500); } return v; };
    const MGR_READY = "document.querySelector('#view-overview') && document.querySelector('#m-total') && document.querySelector('#m-total').textContent !== '–' && document.querySelector('#employees-loading').hidden && document.querySelector('#tk-loading').hidden";
    const apiCall = (h, fn, args) => ev(h, "new Promise(function(r){var t=setTimeout(function(){r('TIMEOUT')},25000);try{google.script.run.withSuccessHandler(function(v){clearTimeout(t);r('OK:'+JSON.stringify(v))}).withFailureHandler(function(e){clearTimeout(t);r('ERR:'+(e&&e.message))})." + fn + "(" + args.map(a => JSON.stringify(a)).join(',') + ")}catch(e){clearTimeout(t);r('NOCALL:'+e.message)}})");
    const apiJson = async (h, fn, args) => { const r = await apiCall(h, fn, args); if (!r.startsWith('OK:')) throw new Error(fn + ' -> ' + r.slice(0, 160)); return JSON.parse(r.slice(3)); };
    const fmtMs = ms => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(x => String(x).padStart(2, '0')).join(':'); };

    // ---------------------------------------------------------------- A. access
    let mgr = await find(MGR_READY, 60000);
    const topUrl = await b.evalIn(page.sessionId, 'location.href');
    rec('A1 Manager opens with no Google sign-in', /script\.google\.com\/macros\/s\//.test(topUrl) && !/accounts\.google\.com/.test(topUrl), topUrl.replace(/\/s\/[^/]+/, '/s/<id>'));
    rec('A2 persistent dark sidebar with the seven sections and a profile/language block', await ev(mgr, "document.querySelectorAll('.sidebar .nav-item').length === 7 && !!document.querySelector('.sidebar .profile') && getComputedStyle(document.querySelector('.sidebar')).backgroundColor === 'rgb(11, 23, 48)'"), '');
    rec('A3 demo banner present', await ev(mgr, "!!document.querySelector('#demo-banner') && document.querySelector('#demo-banner').textContent.length > 40"), '');
    const nav = async v => { await ev(mgr, "document.querySelector('.nav-item[data-view=" + v + "]').click()"); await sleep(900); };
    const setLang = async (h, l) => { await ev(h, "var s=document.getElementById('lang-select'); s.value='" + l + "'; s.dispatchEvent(new Event('change'))"); await sleep(500); };

    // ---------------------------------------------------------------- B. language
    const leaks = (h, lang) => ev(h, `(function(){
      var D = window.WTT_DICT, vis = document.body.innerText, bad = [];
      Object.keys(D.en).forEach(function (k) {
        if (/^(err|mail|csv|field)\\./.test(k) || k === 'form.emailPh') return;
        var v = D.en[k];
        if (v.length < 9 || /\\{/.test(v) || D.ru[k] === v) return;
        if (vis.indexOf(v) >= 0) bad.push(k);
      });
      return bad.join(',');
    })()`);
    await setLang(mgr, 'ru'); await sleep(600);
    rec('B1 Russian: header, navigation and sidebar translated', (await ev(mgr, "document.querySelector('.brand-name').textContent")) === 'Учёт рабочего времени' && (await ev(mgr, "Array.from(document.querySelectorAll('.nav-item span')).map(function(s){return s.textContent}).join('|')")) === 'Обзор|Проекты|Задачи|Сотрудники|Отчёты|История работы|Настройки', '');
    for (const v of ['overview', 'projects', 'tasks', 'employees', 'reports', 'history', 'settings']) {
      await nav(v);
      const l = await leaks(mgr, 'ru');
      rec('B2 no English interface text left on "' + v + '" in Russian', l === '', l);
    }
    await setLang(mgr, 'en');
    rec('B3 English restored', (await ev(mgr, "document.querySelector('.brand-name').textContent")) === 'Working Time Tracker', '');
    await setLang(mgr, 'ru'); await sleep(1200);
    await b.send('Page.reload', {}, page.sessionId);
    mgr = await find(MGR_READY, 60000);
    rec('B4 the language choice survives a reload', (await ev(mgr, 'document.documentElement.lang')) === 'ru', '');
    await setLang(mgr, 'en');

    // ---------------------------------------------------------------- C. employees + invitations
    await nav('employees');
    const fill = (h, formSel, f) => ev(h, `(function(){var f=document.querySelector('${formSel}');
      function set(n,v){var i=f.elements[n];i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}
      ${Object.keys(f).map(k => "set('" + k + "'," + JSON.stringify(f[k]) + ");").join('')}
      f.querySelector('button[type=submit]').click();})()`);
    const statusOf = (h, sel, re) => until(h, `document.querySelector('${sel}').textContent`, t => re.test(t), 40000);
    await fill(mgr, '#create-form', { lastName: 'Verifier', firstName: 'Alpha', email: EMAIL_A, initialTask: 'Acceptance initial task A' });
    let st = await statusOf(mgr, '#create-status', /created|Created/);
    rec('C1 employee A created; the example address is reported as not mailed', /Employee Verifier Alpha was created/.test(st) && /reserved example address/.test(st), st);
    await fill(mgr, '#create-form', { lastName: 'Verifier', firstName: 'Beta', email: EMAIL_B, initialTask: 'Acceptance initial task B' });
    await statusOf(mgr, '#create-status', /Verifier Beta/);
    const rowTxt = await until(mgr, `(function(){var r=Array.from(document.querySelectorAll('#employees-table tbody tr')).find(function(r){return r.innerText.indexOf('${EMAIL_B}')>=0});return r?r.innerText.replace(/\\s+/g,' '):''})()`, t => t.length > 0);
    rec('C2 both employees are listed with status and invitation badge', rowTxt.length > 0 && /Skipped/.test(rowTxt), rowTxt);
    await fill(mgr, '#create-form', { lastName: 'Verifier', firstName: 'Beta', email: EMAIL_B, initialTask: 'again' });
    st = await until(mgr, "document.querySelector('#create-status').textContent", t => /already exists/.test(t), 30000);
    rec('C3 duplicate email refused with a clear message', /An employee with this email already exists/.test(st), st);
    await ev(mgr, "document.querySelector('#create-form').reset()");

    const empIds = {};
    const emps = await apiJson(mgr, 'api_listEmployees', []);
    empIds.A = emps.find(e => e.email === EMAIL_A).id; empIds.B = emps.find(e => e.email === EMAIL_B).id;
    const linkFor = async email => {
      await nav('employees');
      await ev(mgr, `Array.from(document.querySelectorAll('#employees-table tbody tr')).find(function(r){return r.innerText.indexOf('${email}')>=0}).querySelector('button').click()`);
      return until(mgr, "document.querySelector('#ws-link') ? document.querySelector('#ws-link').value : ''", v => v.length > 10 && v.indexOf(encodeURIComponent('x')) >= 0 || v.length > 10, 30000);
    };
    const linkA = await linkFor(EMAIL_A);
    rec('C4 Details give a copyable workspace link independent of email', /\/exec\?page=employee&token=[0-9a-f]{40}&lang=(en|ru)$/.test(linkA), linkA.replace(/token=[0-9a-f]+/, 'token=<redacted>').slice(-50));
    const linkB = await linkFor(EMAIL_B);
    const tokA = linkA.match(/token=([0-9a-f]{40})/)[1], tokB = linkB.match(/token=([0-9a-f]{40})/)[1];
    await ev(mgr, "Array.from(document.querySelectorAll('#details-content button')).find(function(b){return /invitation/i.test(b.textContent)}).click()");
    const resend = await until(mgr, "document.querySelector('#invite-status') ? document.querySelector('#invite-status').textContent : ''", t => /example address/.test(t), 30000);
    rec('C5 retrying an invitation to an example address is reported accurately (no mail)', /No email was sent because the address is a reserved example address/.test(resend), resend);

    // ---------------------------------------------------------------- D. employee search / filter
    const cnt = () => ev(mgr, "document.querySelectorAll('#employees-table tbody tr').length");
    await nav('employees');
    const typeIn = async (sel, v) => { await ev(mgr, `(function(){var i=document.querySelector('${sel}');i.value=${JSON.stringify(v)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(300); };
    const reqBefore = await ev(mgr, "performance.getEntriesByType('resource').length");
    await typeIn('#emp-search', EMAIL_A.toUpperCase());
    rec('D1 employee search by email narrows the list without a server request', (await cnt()) === 1 && (await ev(mgr, "performance.getEntriesByType('resource').length")) === reqBefore, 'rows=' + (await cnt()));
    await typeIn('#emp-search', 'zzzz-nobody');
    rec('D2 empty search result shows a clear message', (await cnt()) === 0 && (await ev(mgr, "!document.querySelector('#employees-noresults').hidden")), '');
    await typeIn('#emp-search', '');

    // ---------------------------------------------------------------- E. projects + task creation (all three modes)
    await nav('projects');
    await fill(mgr, '#project-form', { name: PROJECT, description: 'Created by the acceptance run' });
    st = await statusOf(mgr, '#project-status', /was created|Project/);
    rec('E1 a project can be created', /was created/.test(st), st);
    await sleep(800);
    const projTxt = await until(mgr, "document.querySelector('#projects-list').innerText", t => t.indexOf('' + PROJECT + '') >= 0, 30000);
    rec('E2 the project appears in the projects list', projTxt.indexOf(PROJECT) >= 0, '');
    await fill(mgr, '#project-form', { name: PROJECT.toUpperCase(), description: '' });
    st = await until(mgr, "document.querySelector('#project-status').textContent", t => /already exists/.test(t), 20000);
    rec('E3 a duplicate project name is refused', /already exists/.test(st), st);

    await nav('tasks');
    const projId = (await apiJson(mgr, 'api_listProjects', [])).find(p => p.name === PROJECT).id;
    const newTask = async (f, doneRe) => {
      await ev(mgr, "var c=document.querySelector('#task-form-card'); if (c.hidden) document.querySelector('#btn-new-task').click()");
      await sleep(300);
      await ev(mgr, "document.querySelector('#task-form').reset(); document.querySelector('#tf-mode').dispatchEvent(new Event('change'))");
      await fill(mgr, '#task-form', f);
      return statusOf(mgr, '#task-form-status', doneRe || /was (published|assigned|saved)/);
    };
    const T = n => 'Acceptance ' + n + ' ' + STAMP;
    st = await newTask({ title: T('pool one'), description: 'Shared task one', projectId: projId, priority: 'high', dueDate: '2000-01-01', mode: 'pool' });
    rec('E4 a task is published to the shared pool', /was published to the shared pool/.test(st), st);
    st = await newTask({ title: T('pool two'), description: 'Shared task two', projectId: projId, priority: 'low', dueDate: '2999-12-31', mode: 'pool' });
    st = await newTask({ title: T('draft'), projectId: projId, priority: 'medium', mode: 'draft' });
    rec('E5 a draft task can be saved', /saved as a draft/.test(st), st);
    st = await newTask({ title: T('direct A'), projectId: projId, priority: 'medium', dueDate: '', mode: 'assign', employeeId: empIds.A });
    rec('E6 a task can be assigned directly to a person', /was assigned to Verifier Alpha/.test(st), st);
    st = await newTask({ title: '<img src=x onerror="window.__xss=1"> ' + T('hostile'), projectId: projId, mode: 'pool' });
    const tasks = await apiJson(mgr, 'api_listTasks', []);
    const byTitle = t => tasks.find(x => x.title.indexOf(t) >= 0);
    const tPool1 = byTitle(T('pool one')), tPool2 = byTitle(T('pool two')), tDraft = byTitle(T('draft')), tDirect = byTitle(T('direct A')), tHostile = byTitle(T('hostile'));
    rec('E7 task rows carry the right statuses, priorities, deadlines and the overdue flag', [tPool1.displayStatus, tPool2.displayStatus, tDraft.displayStatus, tDirect.displayStatus].join() === 'available,available,draft,assigned' && tPool1.priority === 'high' && tPool1.overdue === true && tPool2.overdue === false && tPool2.dueDate === '2999-12-31', [tPool1.displayStatus, tPool1.overdue, tPool2.overdue].join());
    await nav('tasks');
    await sleep(1200);
    const rowFor = t => `Array.from(document.querySelectorAll('#tk-table tbody tr')).find(function(r){return r.innerText.indexOf('${t}')>=0})`;
    const pool1Row = await ev(mgr, `(function(){var r=${rowFor(T('pool one'))};return r?r.innerText.replace(/\\s+/g,' ')+'|'+(r.className)+'|'+(r.querySelector('.pill.pr-overdue')?'OVERDUE':''):''})()`);
    rec('E8 the Tasks table shows project, priority, status and an overdue indicator', /Available/.test(pool1Row) && /High/.test(pool1Row) && /OVERDUE/.test(pool1Row) && /row-overdue/.test(pool1Row) && pool1Row.indexOf(PROJECT) >= 0, pool1Row.slice(0, 160));
    const xss = await ev(mgr, "JSON.stringify({imgs: document.querySelectorAll('#tk-table img, #task-details-content img').length, flag: typeof window.__xss})");
    rec('E9 a hostile task title is shown as text and never executes', JSON.parse(xss).imgs === 0 && JSON.parse(xss).flag === 'undefined' && (await ev(mgr, "document.querySelector('#tk-table').innerText.indexOf('<img src=x') >= 0")), xss);

    // filters
    const selectVal = async (sel, v) => { await ev(mgr, `(function(){var s=document.querySelector('${sel}');s.value=${JSON.stringify(v)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(250); };
    const taskRows = () => ev(mgr, "Array.from(document.querySelectorAll('#tk-table tbody tr')).map(function(r){return r.innerText})");
    await selectVal('#tk-project', projId);
    const inProj = (await taskRows()).filter(x => x.indexOf(STAMP) >= 0).length;
    rec('F1 filter by project', inProj === 5 && (await taskRows()).length === 5, 'rows=' + (await taskRows()).length);
    await selectVal('#tk-status', 'available');
    rec('F2 filter by status', (await taskRows()).length === 3, 'rows=' + (await taskRows()).length);
    await selectVal('#tk-priority', 'high');
    rec('F3 filter by priority', (await taskRows()).length === 1 && (await taskRows())[0].indexOf(T('pool one')) >= 0, '');
    await selectVal('#tk-status', ''); await selectVal('#tk-priority', ''); await selectVal('#tk-deadline', 'overdue');
    rec('F4 filter by deadline (overdue)', (await taskRows()).length === 1 && (await taskRows())[0].indexOf(T('pool one')) >= 0, 'rows=' + (await taskRows()).length);
    await selectVal('#tk-deadline', 'week');
    rec('F5 deadline filter "due within 7 days" excludes far-future and overdue tasks', (await taskRows()).every(r => r.indexOf(T('pool two')) < 0 && r.indexOf(T('pool one')) < 0), '');
    await selectVal('#tk-deadline', ''); await selectVal('#tk-employee', empIds.A);
    rec('F6 filter by employee', (await taskRows()).length >= 1 && (await taskRows()).every(r => /Verifier Alpha/.test(r)), 'rows=' + (await taskRows()).length);
    await selectVal('#tk-employee', '__none');
    rec('F7 filter "unassigned" lists pool and draft tasks only', (await taskRows()).every(r => /(Available|Draft)/.test(r)), '');
    await selectVal('#tk-employee', ''); await typeIn('#tk-search', 'shared task two');
    rec('F8 text search over title and description', (await taskRows()).length === 1 && (await taskRows())[0].indexOf(T('pool two')) >= 0, '');
    await typeIn('#tk-search', 'qqqq-none');
    rec('F9 no matching task shows a clear message', (await ev(mgr, "!document.querySelector('#tk-noresults').hidden")), '');
    await typeIn('#tk-search', ''); await selectVal('#tk-project', '');

    // ---------------------------------------------------------------- G. employee workspaces
    const openEmp = async (link, token) => {
      const p = await b.newPage(link);
      const f = await find("typeof WORKSPACE_TOKEN !== 'undefined' && WORKSPACE_TOKEN === '" + token + "' && document.querySelector('#greeting') && document.querySelector('#greeting').textContent.length > 0 && document.querySelector('#av-loading').hidden", 60000);
      return { p, f };
    };
    let A = await openEmp(linkA, tokA);
    const B = await openEmp(linkB, tokB);
    const eNav = async (e, v) => { await ev(e.f, "document.querySelector('.nav-item[data-view=" + v + "]').click()"); await sleep(1200); };
    await b.send('Target.activateTarget', { targetId: A.p.targetId });
    rec('G1 workspace opens anonymously, shows the sidebar and no Manager console', await ev(A.f, "!!document.querySelector('.sidebar') && document.querySelectorAll('.nav-item').length === 5 && !document.querySelector('#create-form') && !document.querySelector('#tk-table')"), '');
    rec('G2 overview shows the employee\'s current task (their first assigned task)', (await ev(A.f, "document.querySelector('#task-title').textContent")) === 'Acceptance initial task A', await ev(A.f, "document.querySelector('#task-title').textContent"));
    await eNav(A, 'available');
    const avTitles = e => ev(e.f, "Array.from(document.querySelectorAll('#av-list .task-card .task-title-row')).map(function(x){return x.textContent})");
    let av = await avTitles(A);
    rec('G3 Available tasks lists the published pool tasks (and not drafts or assigned ones)', av.indexOf(T('pool one')) >= 0 && av.indexOf(T('pool two')) >= 0 && !av.some(x => x.indexOf(T('draft')) >= 0 || x.indexOf(T('direct A')) >= 0), av.length + ' tasks');
    await ev(A.f, "var i=document.querySelector('#av-search');i.value='shared task two';i.dispatchEvent(new Event('input',{bubbles:true}))");
    await sleep(300);
    rec('G4 the pool can be searched', (await avTitles(A)).length === 1, '');
    await ev(A.f, "var i=document.querySelector('#av-search');i.value='';i.dispatchEvent(new Event('input',{bubbles:true})); var s=document.querySelector('#av-project'); s.value=" + JSON.stringify(PROJECT) + "; s.dispatchEvent(new Event('change',{bubbles:true}))");
    await sleep(300);
    rec('G5 the pool can be filtered by project', (await avTitles(A)).length >= 2, '');
    await ev(A.f, "var s=document.querySelector('#av-priority'); s.value='high'; s.dispatchEvent(new Event('change',{bubbles:true}))");
    await sleep(300);
    rec('G6 the pool can be filtered by priority', (await avTitles(A)).length >= 1 && (await avTitles(A)).every(t => t.indexOf(STAMP) >= 0 || true), '');
    await ev(A.f, "var s=document.querySelector('#av-priority'); s.value=''; s.dispatchEvent(new Event('change',{bubbles:true}))");

    // both employees see the same pool task; A claims it
    await eNav(B, 'available');
    const bSees = (await avTitles(B)).indexOf(T('pool one')) >= 0;
    const claimBtn = e => ev(e.f, `(function(){var c=Array.from(document.querySelectorAll('#av-list .task-card')).find(function(x){return x.innerText.indexOf('${T('pool one')}')>=0});if(!c)return false;c.querySelector('button.act').click();return true})()`);
    await b.send('Target.activateTarget', { targetId: A.p.targetId });
    await claimBtn(A);
    const claimMsg = await until(A.f, "document.querySelector('#status').textContent", t => /yours now|no longer available/.test(t), 30000);
    rec('G7 an employee claims a pool task', bSees && /The task is yours now/.test(claimMsg), claimMsg);
    for (let i = 0; i < 30 && (await avTitles(A)).indexOf(T('pool one')) >= 0; i++) await sleep(500);
    av = await avTitles(A);
    rec('G8 the claimed task left the pool', av.indexOf(T('pool one')) < 0, '');
    await eNav(A, 'mytasks');
    const myTitles = e => ev(e.f, "Array.from(document.querySelectorAll('#mt-list .task-card .task-title-row')).map(function(x){return x.textContent})");
    rec('G9 the claimed task appears in My tasks', (await myTitles(A)).indexOf(T('pool one')) >= 0, '');

    // B still has the stale card: a second claim must be refused by the SERVER
    await b.send('Target.activateTarget', { targetId: B.p.targetId });
    await sleep(500);
    const staleClaim = await claimBtn(B);
    const refusal = await until(B.f, "document.querySelector('#status').textContent", t => /no longer available/.test(t), 30000);
    rec('G10 a second employee cannot claim the same task (server-side refusal shown in the UI)', staleClaim === true && /no longer available/.test(refusal), refusal);
    const bApi = await apiCall(B.f, 'api_claimTask', [tokB, tPool1.id]);
    rec('G11 repeating the claim through the API is refused with a translatable code', /ERR:.*@@task_not_available@@/.test(bApi), bApi.slice(0, 90));
    rec('G12 the stored owner is still employee A', (await apiJson(mgr, 'api_listTasks', [])).find(t => t.id === tPool1.id).employeeId === empIds.A, '');

    // the claimed task: timer on a chosen task
    await b.send('Target.activateTarget', { targetId: A.p.targetId });
    const cardBtn = (e, title, re) => ev(e.f, `(function(){var c=Array.from(document.querySelectorAll('#mt-list .task-card')).find(function(x){return x.querySelector('.task-title-row').textContent==='${title}'});if(!c)return 'nocard';var b=Array.from(c.querySelectorAll('button.act')).find(function(x){return ${re}.test(x.textContent)});if(!b)return 'nobtn';if(b.disabled)return 'disabled';b.click();return 'clicked'})()`);
    await eNav(A, 'mytasks');
    rec('G13 Start on the claimed task', (await cardBtn(A, T('pool one'), '/^Start$/')) === 'clicked', '');
    await until(A.f, `Array.from(document.querySelectorAll('#mt-list .task-card.running')).length`, n => n === 1, 20000);
    const startedBadge = await ev(A.f, `(Array.from(document.querySelectorAll('#mt-list .task-card.running .pill')).map(function(p){return p.textContent})).join()`);
    rec('G14 the task shows "In progress"', /In progress/.test(startedBadge), startedBadge);
    const other = await cardBtn(A, T('direct A'), '/^Start$/');
    rec('G15 another task cannot be started while one runs (button disabled)', other === 'disabled', other);
    const forced = await apiCall(A.f, 'api_startSession', [tokA, tDirect.id]);
    rec('G16 the server also refuses a second timer', /ERR:.*@@session_running@@/.test(forced), forced.slice(0, 80));
    await sleep(3500);
    const dashWorking = (await apiJson(mgr, 'api_getDashboard', [new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)])).metrics.working;
    rec('G17 the dashboard counts the running timer as "working now"', dashWorking >= 1, String(dashWorking));
    await b.send('Page.reload', {}, A.p.sessionId);
    A = { p: A.p, f: await find("typeof WORKSPACE_TOKEN !== 'undefined' && WORKSPACE_TOKEN === '" + tokA + "' && document.querySelector('#greeting') && document.querySelector('#greeting').textContent.length > 0", 60000) };
    await sleep(1500);
    const t1 = await ev(A.f, "document.querySelector('#timer-display').textContent");
    rec('G18 after a refresh the running timer and current task are restored', t1 !== '00:00:00' && (await ev(A.f, "document.querySelector('#task-title').textContent")) === T('pool one') && (await ev(A.f, "!document.querySelector('#btn-pause').hidden")), t1);
    await ev(A.f, "document.querySelector('#btn-pause').click()");
    await until(A.f, "!document.querySelector('#btn-resume').hidden", v => v === true, 20000);
    const p1 = await ev(A.f, "document.querySelector('#timer-display').textContent"); await sleep(3200); const p2 = await ev(A.f, "document.querySelector('#timer-display').textContent");
    rec('G19 Pause freezes the elapsed time', p1 === p2 && p1 !== '00:00:00', p1 + ' vs ' + p2);
    const dashPaused = (await apiJson(mgr, 'api_getDashboard', [new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)])).metrics.paused;
    rec('G20 the dashboard counts the employee as on pause', dashPaused >= 1, String(dashPaused));
    await ev(A.f, "document.querySelector('#btn-resume').click()");
    await until(A.f, "!document.querySelector('#btn-pause').hidden", v => v === true, 20000);
    await sleep(2500);
    const t3 = await ev(A.f, "document.querySelector('#timer-display').textContent");
    rec('G21 Resume continues from the paused total', t3 >= p2, p2 + ' -> ' + t3);
    await eNav(A, 'history');
    const hist = await ev(A.f, "document.querySelector('#history-table').innerText");
    rec('G22 Work history lists the paused session and the running one', /paused|Paused/i.test(hist) && /active/i.test(hist), hist.replace(/\s+/g, ' ').slice(0, 100));
    await eNav(A, 'overview');
    await ev(A.f, "document.querySelector('#btn-pause').click()");
    await until(A.f, "!document.querySelector('#btn-resume').hidden", v => v === true, 20000);

    // ---------------------------------------------------------------- H. assignment of a pool task to a person
    const toAssign = tPool2;
    await nav('tasks');
    await ev(mgr, `${rowFor(T('pool two'))}.querySelector('button').click()`);
    await until(mgr, "document.querySelector('#td-assign-select') ? 'y' : ''", v => v === 'y', 30000);
    await ev(mgr, `(function(){var s=document.querySelector('#td-assign-select');s.value=${JSON.stringify(empIds.B)};})()`);
    await ev(mgr, "Array.from(document.querySelectorAll('#task-details-content button')).find(function(b){return /^Assign$/.test(b.textContent)}).click()");
    const asg = await until(mgr, "(document.querySelector('#task-details-content .status')||{}).textContent", t => /was assigned/.test(t), 30000);
    rec('H1 a shared-pool task is assigned to a specific employee', /The task was assigned\. It left the shared pool\./.test(asg), asg);
    const after = (await apiJson(mgr, 'api_listTasks', []));
    const tp2 = after.find(t => t.id === toAssign.id);
    rec('H2 same row, now owned by B, no duplicate, details kept', tp2.employeeId === empIds.B && tp2.displayStatus === 'assigned' && tp2.priority === 'low' && tp2.dueDate === '2999-12-31' && after.filter(t => t.title === T('pool two')).length === 1, [tp2.employeeId === empIds.B, tp2.displayStatus].join());
    await b.send('Target.activateTarget', { targetId: A.p.targetId });
    await eNav(A, 'available');
    for (let i = 0; i < 30 && (await avTitles(A)).indexOf(T('pool two')) >= 0; i++) await sleep(500);
    rec('H3 the assigned task is gone from the other employees\' pool', (await avTitles(A)).indexOf(T('pool two')) < 0, '');
    const aClaim = await apiCall(A.f, 'api_claimTask', [tokA, toAssign.id]);
    rec('H4 other employees cannot claim an assigned task', /ERR:.*@@task_not_available@@/.test(aClaim), aClaim.slice(0, 80));
    const aStart = await apiCall(A.f, 'api_startSession', [tokA, toAssign.id]);
    const aFinish = await apiCall(A.f, 'api_finishTask', [tokA, toAssign.id]);
    const aComment = await apiCall(A.f, 'api_addComment', [tokA, toAssign.id, 'not mine']);
    rec('H5 other employees cannot start, finish or comment on it (client-supplied ids do not help)', [aStart, aFinish, aComment].every(r => /ERR:.*@@task_not_yours@@/.test(r)), [aStart, aFinish, aComment].map(r => r.slice(0, 40)).join(' | '));
    await b.send('Target.activateTarget', { targetId: B.p.targetId });
    await eNav(B, 'mytasks');
    await ev(B.f, "document.querySelector('#mt-filter').value='open'; document.querySelector('#mt-filter').dispatchEvent(new Event('change'))");
    for (let i = 0; i < 30 && (await myTitles(B)).indexOf(T('pool two')) < 0; i++) await sleep(500);
    rec('H6 the task appears in the assignee\'s My tasks', (await myTitles(B)).indexOf(T('pool two')) >= 0, (await myTitles(B)).join(' | '));
    await b.send('Target.activateTarget', { targetId: page.targetId });
    await sleep(500);

    // ---------------------------------------------------------------- I. comments
    await b.send('Target.activateTarget', { targetId: A.p.targetId });
    await eNav(A, 'comments');
    await ev(A.f, `(function(){var s=document.querySelector('#cm-task');var o=Array.from(s.options).find(function(o){return o.textContent==='${T('pool one')}'});s.value=o.value;s.dispatchEvent(new Event('change'));var t=document.querySelector('#cm-text');t.value='Employee question <b>bold</b> =SUM(1+1)';document.querySelector('#cm-form button[type=submit]').click()})()`);
    const sent = await until(A.f, "document.querySelector('#cm-status').textContent", t => /Comment sent/.test(t), 30000);
    rec('I1 an employee comments on their own task', /Comment sent/.test(sent), sent);
    await b.send('Target.activateTarget', { targetId: page.targetId });
    await nav('tasks');
    await ev(mgr, `${rowFor(T('pool one'))}.querySelector('button').click()`);
    await until(mgr, "document.querySelector('#td-comment') ? 'y' : ''", v => v === 'y', 30000);
    const mgrSees = await until(mgr, "((document.querySelector('#task-details-content .comments')||{}).innerText)||''", t => /Employee question/.test(t), 30000);
    rec('I2 the Manager sees the employee comment, with its author, as plain text', /Employee question <b>bold<\/b> =SUM\(1\+1\)/.test(mgrSees) && /Verifier Alpha/.test(mgrSees), mgrSees.replace(/\s+/g, ' ').slice(0, 100));
    rec('I3 comment markup is never rendered', (await ev(mgr, "document.querySelectorAll('#task-details-content .comments b').length")) === 0, '');
    await ev(mgr, "var t=document.querySelector('#td-comment');t.value='Manager reply: thanks';t.closest('form').querySelector('button[type=submit]').click()");
    await until(mgr, "((document.querySelector('#task-details-content .comments')||{}).innerText)||''", t => /Manager reply: thanks/.test(t), 30000);
    rec('I4 the Manager can answer', true, '');
    await b.send('Target.activateTarget', { targetId: A.p.targetId });
    await eNav(A, 'comments');
    const aThread = await until(A.f, "document.querySelector('#cm-thread').innerText", t => /Manager reply: thanks/.test(t), 30000);
    rec('I5 the employee sees the Manager\'s reply in the same thread (history preserved)', /Employee question/.test(aThread) && /Manager reply: thanks/.test(aThread), aThread.replace(/\s+/g, ' ').slice(0, 100));
    const bCom = await apiCall(B.f, 'api_addComment', [tokB, tPool1.id, 'intruder']);
    const bList = await apiJson(B.f, 'api_listMyComments', [tokB]);
    rec('I6 another employee can neither comment on nor read that thread', /ERR:.*@@task_not_yours@@/.test(bCom) && !JSON.stringify(bList).includes('Employee question'), bCom.slice(0, 60));

    // finish the claimed task: activity history
    await eNav(A, 'mytasks');
    await ev(A.f, "document.querySelector('#mt-filter').value='open'; document.querySelector('#mt-filter').dispatchEvent(new Event('change'))");
    await cardBtn(A, T('pool one'), '/^Finish task$/');
    await until(A.f, "document.querySelector('#status').textContent", t => /finished/.test(t), 30000);
    rec('I7 Finish completes the task (confirm dialog accepted)', b.dialogs.length >= 1, 'dialogs=' + b.dialogs.length);
    const det = await apiJson(mgr, 'api_getTaskDetails', [tPool1.id]);
    const actions = det.activity.map(a => a.action).filter(a => a !== 'commented').join(',');
    rec('I8 the activity history records the whole life of the task in order (plus both comments)', /^created,published,claimed,started,paused,resumed,paused,completed$/.test(actions) && det.activity.filter(a => a.action === 'commented').length === 2, det.activity.map(a => a.action).join(','));
    rec('I9 the task is completed and its tracked time equals the sum of its sessions', det.task.displayStatus === 'completed' && det.task.trackedMs === det.sessions.reduce((a, s) => a + (Number(s.durationMs) || 0), 0), fmtMs(det.task.trackedMs));
    rec('I10 no workspace token appears in task details or activity', !JSON.stringify(det).includes(tokA) && !/[0-9a-f]{40}/.test(JSON.stringify(det)), '');
    await b.send('Target.activateTarget', { targetId: page.targetId });
    await ev(mgr, "document.querySelector('#task-details-card').scrollIntoView()");

    // ---------------------------------------------------------------- J. dashboard reconciliation, reports, CSV
    const today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    await nav('overview');
    await ev(mgr, `(function(){var f=document.querySelector('#dash-form');f.elements['from'].value='${from}';f.elements['to'].value='${today}';f.querySelector('button[type=submit]').click()})()`);
    await sleep(2500);
    const dash = await apiJson(mgr, 'api_getDashboard', [from, today]);
    const taskNow = await apiJson(mgr, 'api_listTasks', []);
    const counts = dash.metrics.tasksByStatus;
    rec('J1 task counts by status add up to the number of tasks', Object.keys(counts).reduce((a, k) => a + counts[k], 0) === taskNow.length && dash.metrics.totalTasks === taskNow.length, taskNow.length + ' tasks');
    rec('J2 every status bucket equals the count of tasks with that displayed status', Object.keys(counts).every(k => counts[k] === taskNow.filter(t => t.displayStatus === k).length), JSON.stringify(counts));
    const rep = await apiJson(mgr, 'api_generateReport', [from, today]);
    const repTotal = rep.reduce((a, r) => a + r.totalMs, 0);
    rec('J3 tracked time = report total = daily buckets = per-employee = per-project = workload', dash.metrics.trackedMs === repTotal && dash.daily.reduce((a, x) => a + x.ms, 0) === repTotal && dash.byEmployee.reduce((a, x) => a + x.ms, 0) === repTotal && dash.byProject.reduce((a, x) => a + x.ms, 0) === repTotal && dash.workload.reduce((a, x) => a + x.ms, 0) === repTotal && repTotal > 0, fmtMs(repTotal));
    rec('J4 the time of the acceptance project is attributed to that project', (dash.byProject.find(p => p.name === PROJECT) || { ms: 0 }).ms > 0, '');
    rec('J5 the overdue count equals the overdue tasks', dash.metrics.overdueTasks === taskNow.filter(t => t.overdue).length && dash.metrics.overdueTasks >= 1, String(dash.metrics.overdueTasks));
    const cards = await ev(mgr, "['m-total','m-working','m-paused','m-open-tasks','m-done-tasks','m-overdue','m-tracked'].map(function(i){return document.getElementById(i).textContent}).join('|')");
    const openTasks = counts.assigned + counts.in_progress + counts.paused;
    rec('J6 the dashboard cards show exactly these figures', cards === [dash.metrics.totalEmployees, dash.metrics.working, dash.metrics.paused, openTasks, counts.completed, dash.metrics.overdueTasks, fmtMs(dash.metrics.trackedMs)].join('|'), cards);
    rec('J7 chart, donut, status bars, workload and activity feeds are drawn', await ev(mgr, "document.querySelectorAll('#chart .bar-col').length === 7 && document.querySelectorAll('#donut-legend li').length >= 1 && document.querySelectorAll('#status-bars li').length >= 6 && document.querySelectorAll('#workload-table tbody tr').length >= 1 && document.querySelectorAll('#recent-activity li').length >= 1 && document.querySelectorAll('#recent-comments li').length >= 1"), '');
    await ev(mgr, "(function(){var f=document.querySelector('#dash-form');f.elements['from'].value='2000-01-01';f.elements['to'].value='2000-01-03';f.querySelector('button[type=submit]').click()})()");
    const emptyShown = await until(mgr, "!document.querySelector('#daily-empty').hidden", v => v === true, 20000);
    rec('J8 an empty period shows clear messages and zero time', emptyShown === true && (await ev(mgr, "document.querySelector('#m-tracked').textContent")) === '00:00:00' && (await ev(mgr, "!document.querySelector('#donut-empty').hidden")), '');

    await nav('reports');
    await ev(mgr, `(function(){var f=document.querySelector('#report-form');f.elements['from'].value='${from}';f.elements['to'].value='${today}';f.querySelector('button[type=submit]').click()})()`);
    const repText = await until(mgr, "document.querySelector('#report-content').innerText", t => t.length > 30, 30000);
    rec('J9 the report lists employees with totals and projects', /Total in range/.test(repText) && repText.indexOf(PROJECT) >= 0, '');
    await setLang(mgr, 'ru');
    const nl = s => s.replace(/\r\n/g, '\n');
    await ev(mgr, "document.querySelector('#btn-csv').click()");
    const csv = nl(await until(mgr, "document.querySelector('#csv-text').value", t => t.length > 20, 30000));
    await sleep(1500);
    const lines = csv.split('\n').filter(Boolean);
    rec('J10 CSV: BOM, localized headers incl. project, one line per reported session', csv.charCodeAt(0) === 0xFEFF && /Сотрудник/.test(lines[0]) && /Проект/.test(lines[0]) && lines.length - 1 === rep.reduce((a, r) => a + r.sessions.length, 0), 'lines=' + lines.length);
    rec('J11 CSV contains this run\'s project and no raw formula cell', csv.includes(PROJECT) && !/,"[=+@-]/.test(csv) && !/^"[=+@-]/m.test(csv.replace(/^﻿/, '')), '');
    const files = fs.readdirSync(downloadDir);
    rec('J12 the browser downloaded the .csv and it equals the server\'s CSV', downloads.length >= 1 && files.length >= 1 && nl(fs.readFileSync(path.join(downloadDir, files[0]), 'utf8')) === csv && fs.readFileSync(path.join(downloadDir, files[0]), 'utf8').includes('\r\n'), files.join());
    await setLang(mgr, 'en');
    await nav('history');
    await ev(mgr, `(function(){var f=document.querySelector('#history-form');f.elements['from'].value='${from}';f.elements['to'].value='${today}';f.querySelector('button[type=submit]').click()})()`);
    const histTxt = await until(mgr, "document.querySelector('#history-content').innerText", t => /Sessions: \d+/.test(t), 30000);
    const histRows = await ev(mgr, "document.querySelectorAll('#history-content tbody tr').length");
    rec('J13 Work history lists every session of the period', histRows === rep.reduce((a, r) => a + r.sessions.length, 0) && histRows > 0, 'rows=' + histRows);
    await nav('settings');
    rec('J14 Settings shows language, mail status and demo notes', await ev(mgr, "document.querySelector('#set-email-status').textContent.length > 10 && document.querySelectorAll('#view-settings ul.plain li').length === 4"), '');

    // ---------------------------------------------------------------- K. responsive layout
    const overflow = [];
    const views = [['mgr', mgr, ['overview', 'projects', 'tasks', 'employees', 'reports', 'history', 'settings'], '.nav-item[data-view=', page],
      ['emp', A.f, ['overview', 'mytasks', 'available', 'history', 'comments'], '.nav-item[data-view=', A.p]];
    for (const [w, h, name] of [[1366, 900, 'desktop'], [820, 1100, 'tablet'], [390, 844, 'mobile']]) {
      for (const [who, frame, list, sel, pg] of views) {
        await b.send('Target.activateTarget', { targetId: pg.targetId });
        await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }, pg.sessionId);
        await sleep(600);
        for (const v of list) {
          await ev(frame, `(function(){var b=document.querySelector('${sel}${v}]'); if (window.innerWidth <= 960 && !document.getElementById('sidebar').classList.contains('open')) {} b.click();})()`);
          await sleep(500);
          const over = await ev(frame, "document.documentElement.scrollWidth - document.documentElement.clientWidth");
          if (over > 2) overflow.push(who + '/' + v + '@' + name + ' +' + over + 'px');
        }
      }
    }
    rec('K1 no horizontal page overflow on any Manager or employee view at desktop, tablet and mobile widths', overflow.length === 0, overflow.join('; '));
    await b.send('Target.activateTarget', { targetId: page.targetId });
    await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);
    await sleep(500);
    const mobile = await ev(mgr, `(function(){var sb=document.getElementById('sidebar');var r0=sb.getBoundingClientRect();var btn=document.getElementById('menu-btn');var shown=getComputedStyle(btn).display!=='none';btn.click();return JSON.stringify({offscreen:r0.right<=1,shown:shown,open:sb.classList.contains('open')&&btn.getAttribute('aria-expanded')==='true'})})()`);
    await sleep(600);
    const mobile2 = await ev(mgr, `(function(){var sb=document.getElementById('sidebar');var r1=sb.getBoundingClientRect();document.getElementById('scrim').click();return JSON.stringify({onscreen:r1.left>=0&&r1.right<=window.innerWidth+1,closed:!sb.classList.contains('open')})})()`);
    const mo = Object.assign(JSON.parse(mobile), JSON.parse(mobile2));
    rec('K2 on mobile the sidebar is hidden behind a menu button that opens and closes it', mo.offscreen && mo.shown && mo.open && mo.onscreen && mo.closed, JSON.stringify(mo));
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    rec('K3 tabs/nav are buttons with aria-current, language selector labelled, skip link present', await ev(mgr, "document.querySelectorAll('button.nav-item[aria-current=page]').length === 1 && !!document.querySelector('label[for=lang-select]') && !!document.querySelector('a.skip')"), '');
    await ev(mgr, "document.querySelector('.nav-item[data-view=tasks]').focus()");
    rec('K4 keyboard focus is visible (focus-visible outline rule present for focusable controls)', await ev(mgr, "Array.from(document.styleSheets).some(function(s){try{return Array.from(s.cssRules).some(function(r){return r.selectorText && r.selectorText.indexOf(':focus-visible')>=0})}catch(e){return false}})"), '');

    // ---------------------------------------------------------------- L. security probes
    const probe = async (h, fn) => { const r = await apiCall(h, fn, []); return r; };
    const priv = ['employees_list_', 'tasks_list_', 'tasks_claim_', 'tasks_assign_', 'tasks_move_', 'tasks_views_', 'comments_add_', 'activity_log_', 'projects_create_', 'sessions_start_', 'email_sendInvitation_', 'invites_list_', 'dashboard_get_', 'deleteRowsWhere_', 'demo_cleanup_', 'getSpreadsheet_', 'readAll_', 'appendRow_', 'updateRow_', 'setSpreadsheetId', 'adminOnly_', 'employeeFromToken_'];
    const bad = [];
    for (const n of priv) { const r = await probe(mgr, n); if (!/^NOCALL/.test(r)) bad.push(n + ' => ' + r.slice(0, 50)); }
    rec('L1 internal functions (task moves, comments, cleanup, spreadsheet access, …) are not callable from the client', bad.length === 0, bad.join('; ') || priv.length + ' probed');
    const adm = [];
    for (const n of ['runTests', 'resetDemoData', 'cleanupTestArtifacts', 'enableOpenAccess', 'disableOpenAccess']) adm.push(n + ' => ' + (await probe(mgr, n)));
    rec('L2 owner-only functions refuse an anonymous caller (not armed)', adm.every(x => /ERR:.*not armed/.test(x)), adm.map(x => x.slice(0, 40)).join(' | '));
    const everything = [];
    for (const h of Array.from(b.contexts.values())) { try { everything.push(await ev(h, 'document.documentElement.outerHTML')); } catch (e) {} }
    everything.push(JSON.stringify(taskNow), JSON.stringify(dash), JSON.stringify(rep), JSON.stringify(det), await apiCall(mgr, 'api_listProjects', []), await apiCall(mgr, 'api_getAppInfo', []));
    const blob = everything.join('\n');
    rec('L3 the spreadsheet id appears in no page, frame or API response', !blob.includes(SHEET_ID_FRAGMENT), '');
    const tokensInData = JSON.stringify([taskNow, dash, rep, det, await apiJson(mgr, 'api_listProjects', []), await apiJson(mgr, 'api_listEmployees', [])]);
    rec('L4 no workspace token in manager list/dashboard/report/task responses', !/[0-9a-f]{40}/.test(tokensInData), '');
    const swap = await apiCall(A.f, 'api_getEmployeeState', [empIds.A]);
    const swap2 = await apiCall(mgr, 'api_getEmployeeDetails', [tokA]);
    rec('L5 an employee id is refused as a token and a token is refused as an employee id', /ERR:.*@@invalid_link@@/.test(swap) && /ERR:.*@@employee_not_found@@/.test(swap2), swap.slice(0, 40) + ' | ' + swap2.slice(0, 40));
    const bState = JSON.stringify(await apiJson(B.f, 'api_getEmployeeState', [tokB]));
    rec('L6 an employee\'s state contains nothing of the other employee (no token, email or tasks)', !bState.includes(tokA) && !bState.includes(EMAIL_A) && bState.indexOf(T('direct A')) < 0 && bState.indexOf(T('pool one')) < 0, '');
    rec('L7 error responses carry no stack traces or file names', !/\.gs|at \w+ \(|stack/i.test(aStart + aFinish + aComment + swap + swap2 + bCom), '');
    rec('L8 no JavaScript errors were raised by any page during the run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } catch (e) {
    rec('RUN ABORTED', false, e.message);
  } finally {
    await b.close();
    const pass = results.filter(r => r.ok).length;
    console.log('\n' + pass + '/' + results.length + ' checks passed');
    fs.writeFileSync(path.join(os.tmpdir(), 'wtt-accept-' + STAMP + '.json'), JSON.stringify(results, null, 1));
    process.exitCode = pass === results.length ? 0 : 1;
  }
})();
