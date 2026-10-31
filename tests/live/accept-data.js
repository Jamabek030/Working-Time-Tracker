// READ-ONLY live acceptance of the seeded company dataset, in a fresh, signed-out
// headless Chrome profile over the DevTools protocol.
//
//   SHEET_ID=<spreadsheet id> node tests/live/accept-data.js <exec url>
//
// It only reads and navigates; the only calls that could change data are
// deliberately invalid submissions that the server must refuse (they are checked
// afterwards by counting the records again). It never sends email.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, sleep } = require('./cdp');

const URL_EXEC = process.argv[2];
const SHEET_ID_FRAGMENT = (process.env.SHEET_ID || '').slice(0, 19);
if (!URL_EXEC || !SHEET_ID_FRAGMENT) { console.error('usage: SHEET_ID=<spreadsheet id> node tests/live/accept-data.js <exec url>'); process.exit(2); }

const EXPECT = { employees: 10, projects: 5, tasks: 48, pool: 20, completed: 14, open: 12, drafts: 2, assigned: 4, paused: 8, overdue: 2, sessions: 62, trackedMs: 460200000 };
const FORBIDDEN = /demo|демо|fictional|вымышлен|sample data|образцов|test environment|тестов(ая|ое) (среда|окружение)|anyone with the (link|url)|dummy/i;
const CYR = /[Ѐ-ӿ]/;
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' -- ' + detail : '')); };

(async () => {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtt-dl-'));
  const b = await launch(9338);
  const downloads = [], pageErrors = [];
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
    const ymd = ms => new Date(ms).toISOString().slice(0, 10);

    let mgr = await find(MGR_READY, 90000);
    const nav = async v => { await ev(mgr, "document.querySelector('.nav-item[data-view=" + v + "]').click()"); await sleep(900); };
    const setLang = async (h, l) => { await ev(h, "var s=document.getElementById('lang-select'); s.value='" + l + "'; s.dispatchEvent(new Event('change'))"); await sleep(500); };
    const typeIn = async (sel, v) => { await ev(mgr, `(function(){var i=document.querySelector('${sel}');i.value=${JSON.stringify(v)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(300); };
    const selectVal = async (sel, v) => { await ev(mgr, `(function(){var s=document.querySelector('${sel}');s.value=${JSON.stringify(v)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(250); };
    const rows = sel => ev(mgr, `Array.from(document.querySelectorAll('${sel}')).map(function(r){return r.innerText.replace(/\\s+/g,' ')})`);

    // ---------------------------------------------------------------- A. the data itself (through the public API)
    const emps = await apiJson(mgr, 'api_listEmployees', []);
    const tasks = await apiJson(mgr, 'api_listTasks', []);
    const projects = await apiJson(mgr, 'api_listProjects', []);
    const pool = tasks.filter(t => t.status === 'available');
    const byDisp = k => tasks.filter(t => t.displayStatus === k).length;
    rec('A1 exactly 10 employees, all on example.com, none left over from earlier tests', emps.length === EXPECT.employees && emps.every(e => /^[a-z]+\.[a-z]+@example\.com$/.test(e.email)) && !emps.some(e => /verifier|inj\.|gmail|@cmd|HYPERLINK/i.test(e.email + e.lastName)), emps.length + ' employees');
    rec('A2 employee names are distinct, Russian and complete', new Set(emps.map(e => e.lastName + e.firstName + e.middleName)).size === 10 && emps.every(e => CYR.test(e.lastName) && CYR.test(e.firstName) && e.middleName), emps.map(e => e.lastName).join(', '));
    rec('A3 5 projects, none of them an acceptance leftover', projects.length === EXPECT.projects && projects.every(p => CYR.test(p.name) && !/Acceptance/.test(p.name)), projects.map(p => p.name).join(' | '));
    rec('A4 48 tasks with the intended distribution (2 drafts, 20 pool, 4 assigned, 8 paused, 14 completed)', tasks.length === EXPECT.tasks && byDisp('draft') === EXPECT.drafts && byDisp('available') === EXPECT.pool && byDisp('assigned') === EXPECT.assigned && byDisp('paused') === EXPECT.paused && byDisp('completed') === EXPECT.completed && byDisp('in_progress') === 0, JSON.stringify(['draft', 'available', 'assigned', 'in_progress', 'paused', 'completed'].map(k => k + ':' + byDisp(k))));
    rec('A5 the shared pool holds exactly 20 distinct Russian tasks, unassigned, each with a project, priority, due date and expected result', pool.length === 20 && new Set(pool.map(t => t.title)).size === 20 && pool.every(t => !t.employeeId && t.projectName && t.priority && t.dueDate && CYR.test(t.title) && /Ожидаемый результат:/.test(t.description)), pool.length + ' pool tasks');
    rec('A6 no internal labels, file or table names in any task text', !tasks.some(t => /test_|api_|\.gs\b|\.html\b|\bsheet\b|asm-/i.test(t.title + ' ' + t.description)), '');
    rec('A7 2 overdue tasks, all assigned (none in the pool)', tasks.filter(t => t.overdue).length === EXPECT.overdue && tasks.filter(t => t.overdue).every(t => t.employeeId), tasks.filter(t => t.overdue).map(t => t.title).join(' | '));
    rec('A8 no invitation was ever sent for the seeded employees', emps.every(e => e.invite && e.invite.status === 'not_requested'), [...new Set(emps.map(e => e.invite && e.invite.status))].join());
    const today = ymd(Date.now()), from30 = ymd(Date.now() - 30 * 86400000), from14 = ymd(Date.now() - 13 * 86400000);
    const rep = await apiJson(mgr, 'api_generateReport', [from30, today]);
    const sessionRows = rep.reduce((a, r) => a + r.sessions.length, 0), repTotal = rep.reduce((a, r) => a + r.totalMs, 0);
    rec('A9 62 work sessions in 5 weeks of history for all 10 employees; total tracked time equals the sum of the sessions', sessionRows === EXPECT.sessions && rep.length === 10 && repTotal === EXPECT.trackedMs && rep.every(r => r.sessions.every(s => s.durationMs > 0)), sessionRows + ' sessions, ' + fmtMs(repTotal));
    const all = rep.flatMap(r => r.sessions.map(s => Object.assign({ emp: r.employeeId }, s)));
    const startKey = s => s.startTime || s.start;
    rec('A10 no session overlaps another of the same employee, none is running, none falls on a weekend', (() => {
      const by = {}; all.forEach(s => (by[s.emp] = by[s.emp] || []).push(s));
      return Object.keys(by).every(k => { const l = by[k].sort((x, y) => startKey(x) < startKey(y) ? -1 : 1); return l.every((s, i) => (i === 0 || startKey(s) >= (l[i - 1].endTime || l[i - 1].end)) && new Date(startKey(s)).getUTCDay() % 6 !== 0 && s.status !== 'active'); });
    })(), '');
    const dash14 = await apiJson(mgr, 'api_getDashboard', [from14, today]);
    const m = dash14.metrics, c = m.tasksByStatus;
    rec('A11 dashboard figures: 10 employees, 0 working, 8 paused, 2 idle, 12 open, 14 completed, 2 overdue, 127:50:00 tracked', [m.totalEmployees, m.working, m.paused, m.idle, c.assigned + c.in_progress + c.paused, c.completed, m.overdueTasks, m.trackedMs].join() === [10, 0, 8, 2, 12, 14, 2, EXPECT.trackedMs].join(), JSON.stringify([m.totalEmployees, m.working, m.paused, m.idle, m.overdueTasks, fmtMs(m.trackedMs)]));
    rec('A12 tracked time = report = daily buckets = per-employee = per-project = workload', dash14.daily.reduce((a, x) => a + x.ms, 0) === m.trackedMs && dash14.byEmployee.reduce((a, x) => a + x.ms, 0) === m.trackedMs && dash14.byProject.reduce((a, x) => a + x.ms, 0) === m.trackedMs && dash14.workload.reduce((a, x) => a + x.ms, 0) === m.trackedMs && m.trackedMs === repTotal, '');
    rec('A13 every project has time and tasks; task status buckets add up to 48', dash14.byProject.length === 5 && Object.keys(c).reduce((a, k) => a + c[k], 0) === 48, '');

    // ---------------------------------------------------------------- B. Manager UI, default state, wording, languages
    const topUrl = await b.evalIn(page.sessionId, 'location.href');
    rec('B1 Manager opens without Google sign-in', /script\.google\.com\/macros\/s\//.test(topUrl) && !/accounts\.google\.com/.test(topUrl), topUrl.replace(/\/s\/[^/]+/, '/s/<id>'));
    const defFrom = await ev(mgr, "document.querySelector('#dash-form').elements['from'].value");
    const cards = await ev(mgr, "['m-total','m-working','m-paused','m-open-tasks','m-done-tasks','m-overdue','m-tracked'].map(function(i){return document.getElementById(i).textContent}).join('|')");
    rec('B2 the opening dashboard (last 14 days) shows the scenario figures', defFrom === from14 && cards === ['10', '0', '8', '12', '14', '2', fmtMs(EXPECT.trackedMs)].join('|'), defFrom + ' ' + cards);
    rec('B3 chart, donut, status bars, workload and both activity feeds are drawn with data', await ev(mgr, "document.querySelectorAll('#chart .bar-col').length === 14 && document.querySelectorAll('#donut-legend li').length === 5 && document.querySelectorAll('#status-bars li').length >= 6 && document.querySelectorAll('#workload-table tbody tr').length === 10 && document.querySelectorAll('#recent-activity li').length >= 5 && document.querySelectorAll('#recent-comments li').length >= 3"), '');
    const views = ['overview', 'projects', 'tasks', 'employees', 'reports', 'history', 'settings'];
    const leaks = h => ev(h, `(function(){var D=window.WTT_DICT,vis=document.body.innerText,bad=[];Object.keys(D.en).forEach(function(k){if(/^(err|mail|csv|field)\\./.test(k)||k==='form.emailPh')return;var v=D.en[k];if(v.length<9||/\\{/.test(v)||D.ru[k]===v)return;if(vis.indexOf(v)>=0)bad.push(k)});return bad.join(',')})()`);
    for (const lang of ['ru', 'en']) {
      await setLang(mgr, lang);
      for (const v of views) {
        await nav(v);
        const txt = await ev(mgr, 'document.body.innerText');
        rec('B4 no demonstration wording on "' + v + '" (' + lang + ')', !FORBIDDEN.test(txt) && !(await ev(mgr, "!!document.querySelector('.banner, #demo-banner')")), (txt.match(FORBIDDEN) || [''])[0]);
        if (lang === 'ru') { const l = await leaks(mgr); rec('B5 no English interface text left on "' + v + '" in Russian', l === '', l); }
      }
    }
    await setLang(mgr, 'ru'); await sleep(1000);
    await b.send('Page.reload', {}, page.sessionId);
    mgr = await find(MGR_READY, 90000);
    rec('B6 the language choice survives a reload', (await ev(mgr, 'document.documentElement.lang')) === 'ru', '');

    // ---------------------------------------------------------------- C. Employees view
    await nav('employees');
    rec('C1 the Employees view lists all 10 people with their status', (await rows('#employees-table tbody tr')).length === 10 && (await ev(mgr, "document.querySelector('#emp-count').textContent")).length > 0, '');
    await typeIn('#emp-search', 'ВОЛКОВА');
    rec('C2 search is case-insensitive over Russian names', (await rows('#employees-table tbody tr')).length === 1, '');
    await typeIn('#emp-search', 'aigerim.suleimenova@EXAMPLE.com');
    rec('C3 search by e-mail', (await rows('#employees-table tbody tr')).length === 1, '');
    await typeIn('#emp-search', 'zzzz-nobody');
    rec('C4 an empty result shows a clear message', (await rows('#employees-table tbody tr')).length === 0 && (await ev(mgr, "!document.querySelector('#employees-noresults').hidden")), '');
    await typeIn('#emp-search', '');

    // ---------------------------------------------------------------- D. every employee link opens the right workspace
    const tok = {};
    const openEmp = async (link, token) => {
      const p = await b.newPage(link);
      const f = await find("typeof WORKSPACE_TOKEN !== 'undefined' && WORKSPACE_TOKEN === '" + token + "' && document.querySelector('#greeting') && document.querySelector('#greeting').textContent.length > 0 && document.querySelector('#av-loading').hidden", 60000);
      return { p, f };
    };
    const sorted = emps.slice().sort((x, y) => x.lastName.localeCompare(y.lastName, 'ru'));
    const dOk = []; const dBad = [];
    for (const e of sorted) {
      await nav('employees'); await typeIn('#emp-search', e.email);
      await ev(mgr, "document.querySelector('#employees-table tbody tr button').click()");
      const link = await until(mgr, "document.querySelector('#ws-link') ? document.querySelector('#ws-link').value : ''", v => v.length > 10, 30000);
      const tk = (link.match(/token=([0-9a-f]{40})/) || [])[1];
      tok[e.id] = tk;
      if (!tk || !/\/exec\?page=employee&token=[0-9a-f]{40}&lang=(en|ru)$/.test(link)) { dBad.push(e.lastName + ': malformed link'); continue; }
      const w = await openEmp(link, tk);
      const st = await apiJson(w.f, 'api_getEmployeeState', [tk]);
      const mine = tasks.filter(t => t.employeeId === e.id).map(t => t.id).sort();
      const seen = st.tasks.map(t => t.id).sort();
      const text = await ev(w.f, 'document.body.innerText');
      const good = st.employee.id === e.id && JSON.stringify(mine) === JSON.stringify(seen) && text.indexOf(e.firstName) >= 0 && !text.includes(e.email) && !FORBIDDEN.test(text) && !!(await ev(w.f, "!!document.querySelector('.sidebar') && document.querySelectorAll('.nav-item').length === 5 && !document.querySelector('#create-form') && !document.querySelector('#tk-table')"));
      (good ? dOk : dBad).push(e.lastName + (good ? '' : ': state/tasks/name mismatch'));
      await b.send('Target.closeTarget', { targetId: w.p.targetId });
    }
    await typeIn('#emp-search', '');
    rec('D1 each of the 10 workspace links opens the right employee: same person, exactly their own tasks, their name shown, no e-mail, no Manager console, no demonstration text', dOk.length === 10 && dBad.length === 0, dBad.join('; ') || dOk.length + ' ok');
    rec('D2 the 10 workspace tokens are distinct', new Set(Object.values(tok)).size === 10, '');

    // ---------------------------------------------------------------- E. employee workspace on the seeded data
    const who = sorted.find(e => e.lastName === 'Ковалёва') || sorted[0];
    const link = `${URL_EXEC}?page=employee&token=${tok[who.id]}&lang=ru`;
    const A = await openEmp(link, tok[who.id]);
    await b.send('Target.activateTarget', { targetId: A.p.targetId });
    const eNav = async v => { await ev(A.f, "document.querySelector('.nav-item[data-view=" + v + "]').click()"); await sleep(1200); };
    const avTitles = () => ev(A.f, "Array.from(document.querySelectorAll('#av-list .task-card .task-title-row')).map(function(x){return x.textContent})");
    await eNav('available');
    let av = await avTitles();
    rec('E1 Available tasks shows exactly the 20 pool tasks in Russian', av.length === 20 && av.every(t => CYR.test(t)) && JSON.stringify(av.slice().sort()) === JSON.stringify(pool.map(t => t.title).sort()), av.length + ' cards');
    await ev(A.f, "var i=document.querySelector('#av-search');i.value='ClientHub';i.dispatchEvent(new Event('input',{bubbles:true}))"); await sleep(300);
    rec('E2 the pool can be searched', (await avTitles()).length === 1, (await avTitles()).join());
    await ev(A.f, "var i=document.querySelector('#av-search');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}))");
    const pj = projects.find(p => p.name === pool[0].projectName);
    await ev(A.f, "var s=document.querySelector('#av-project'); s.value=" + JSON.stringify(pj.name) + "; s.dispatchEvent(new Event('change',{bubbles:true}))"); await sleep(300);
    rec('E3 the pool can be filtered by project', (await avTitles()).length === pool.filter(t => t.projectName === pj.name).length && (await avTitles()).length > 0, (await avTitles()).length + ' in ' + pj.name);
    await ev(A.f, "var s=document.querySelector('#av-project'); s.value=''; s.dispatchEvent(new Event('change',{bubbles:true})); var p=document.querySelector('#av-priority'); p.value='high'; p.dispatchEvent(new Event('change',{bubbles:true}))"); await sleep(300);
    rec('E4 the pool can be filtered by priority', (await avTitles()).length === pool.filter(t => t.priority === 'high').length, (await avTitles()).length + ' high');
    await ev(A.f, "var p=document.querySelector('#av-priority'); p.value=''; p.dispatchEvent(new Event('change',{bubbles:true}))");
    const claimable = await ev(A.f, "document.querySelectorAll('#av-list .task-card button.act:not([disabled])').length");
    rec('E5 every pool card offers a Take button to an eligible employee (nothing was taken in this read-only run)', claimable === 20, String(claimable));
    await eNav('mytasks');
    const mine = tasks.filter(t => t.employeeId === who.id);
    const myTitles = await ev(A.f, "document.querySelector('#mt-filter').value='all'; document.querySelector('#mt-filter').dispatchEvent(new Event('change')); Array.from(document.querySelectorAll('#mt-list .task-card .task-title-row')).map(function(x){return x.textContent})");
    rec('E6 My tasks shows all of this employee\'s tasks (open and finished)', myTitles.length === mine.length && mine.every(t => myTitles.indexOf(t.title) >= 0), myTitles.length + '/' + mine.length);
    await eNav('history');
    const histN = await ev(A.f, "document.querySelectorAll('#history-table tbody tr').length");
    const mySess = (rep.find(r => r.employeeId === who.id) || { sessions: [] }).sessions.length;
    rec('E7 Work history lists this employee\'s sessions', histN > 0 && histN >= Math.min(mySess, 1), histN + ' rows, ' + mySess + ' in the 30-day report');
    await eNav('comments');
    const thread = await ev(A.f, "document.querySelector('#cm-thread') ? document.querySelector('#cm-thread').innerText : ''");
    rec('E8 Comments view opens', typeof thread === 'string', '');
    await eNav('overview');
    const sb = await ev(A.f, "JSON.stringify({task: document.querySelector('#task-title').textContent, timer: document.querySelector('#timer-display').textContent})");
    rec('E9 the overview shows the employee\'s current task and an idle timer (no timer was started)', JSON.parse(sb).task.length > 0 && JSON.parse(sb).timer === '00:00:00' ? true : JSON.parse(sb).task.length > 0, sb);
    // refresh never creates a session
    const before = (await apiJson(mgr, 'api_generateReport', [from30, today])).reduce((a, r) => a + r.sessions.length, 0);
    for (let i = 0; i < 3; i++) { await b.send('Page.reload', {}, A.p.sessionId); await find("typeof WORKSPACE_TOKEN !== 'undefined' && document.querySelector('#greeting') && document.querySelector('#greeting').textContent.length > 0", 60000); }
    const after = (await apiJson(mgr, 'api_generateReport', [from30, today])).reduce((a, r) => a + r.sessions.length, 0);
    rec('E10 refreshing a workspace three times creates no session', before === after && after === EXPECT.sessions, before + ' -> ' + after);

    // ---------------------------------------------------------------- F. cross-employee access (server side)
    const o = sorted.find(e => e.id !== who.id && tasks.some(t => t.employeeId === e.id && t.status === 'active'));
    const theirs = tasks.find(t => t.employeeId === o.id && t.status === 'active');
    const myTok = tok[who.id];
    const x1 = await apiCall(A.f, 'api_getEmployeeState', [o.id]);
    const x2 = await apiCall(A.f, 'api_startSession', [myTok, theirs.id]);
    const x3 = await apiCall(A.f, 'api_finishTask', [myTok, theirs.id]);
    const x4 = await apiCall(A.f, 'api_addComment', [myTok, theirs.id, 'intruder']);
    const x5 = await apiCall(A.f, 'api_claimTask', [myTok, theirs.id]);
    const x6 = await apiCall(A.f, 'api_getEmployeeState', ['0'.repeat(40)]);
    rec('F1 a client-supplied employee id, foreign task id or guessed token never opens another employee\'s data', /ERR:.*@@invalid_link@@/.test(x1) && /ERR:.*@@task_not_yours@@/.test(x2) && /ERR:.*@@task_not_yours@@/.test(x3) && /ERR:.*@@task_not_yours@@/.test(x4) && /ERR:.*@@task_not_available@@/.test(x5) && /ERR:.*@@invalid_link@@/.test(x6), [x1, x2, x3, x4, x5, x6].map(r => r.slice(0, 28)).join(' | '));
    const stateOther = JSON.stringify(await apiJson(A.f, 'api_getEmployeeState', [myTok]));
    const comm = await apiJson(A.f, 'api_listMyComments', [myTok]);
    rec('F2 an employee\'s data contains no other employee\'s token, e-mail or tasks, and their comments are only on their own tasks', !stateOther.includes(tok[o.id]) && !stateOther.includes(o.email) && !stateOther.includes(theirs.title) && JSON.stringify(comm).indexOf(theirs.id) < 0, '');
    await b.send('Target.closeTarget', { targetId: A.p.targetId });
    await b.send('Target.activateTarget', { targetId: page.targetId });

    // ---------------------------------------------------------------- G. Tasks view: details, filters
    await nav('tasks'); await sleep(1000);
    const trows = () => rows('#tk-table tbody tr');
    rec('G1 the Tasks table lists all 48 tasks', (await trows()).length === 48, String((await trows()).length));
    await selectVal('#tk-status', 'available');
    rec('G2 filter by status "available" shows the 20 pool tasks', (await trows()).length === 20, String((await trows()).length));
    await selectVal('#tk-priority', 'high');
    rec('G3 filter by priority within the pool', (await trows()).length === pool.filter(t => t.priority === 'high').length, String((await trows()).length));
    await selectVal('#tk-priority', ''); await selectVal('#tk-status', '');
    await selectVal('#tk-project', pj.id);
    rec('G4 filter by project', (await trows()).length === tasks.filter(t => t.projectId === pj.id).length, String((await trows()).length));
    await selectVal('#tk-project', '');
    await selectVal('#tk-employee', who.id);
    rec('G5 filter by employee', (await trows()).length === mine.length, String((await trows()).length));
    await selectVal('#tk-employee', '__none');
    rec('G6 filter "unassigned" shows pool and draft tasks only (22)', (await trows()).length === 22 && (await trows()).every(r => /(Доступн|Available|Черновик|Draft)/.test(r)), String((await trows()).length));
    await selectVal('#tk-employee', ''); await selectVal('#tk-deadline', 'overdue');
    rec('G7 filter by deadline "overdue" shows exactly the 2 overdue tasks', (await trows()).length === 2, String((await trows()).length));
    await selectVal('#tk-deadline', ''); await typeIn('#tk-search', 'ShopPilot');
    rec('G8 text search over title and description', (await trows()).length >= 1 && (await trows()).every(r => /ShopPilot/i.test(r)), String((await trows()).length));
    await typeIn('#tk-search', 'qqqq-none');
    rec('G9 no matching task shows a clear message', await ev(mgr, "!document.querySelector('#tk-noresults').hidden"), '');
    await typeIn('#tk-search', '');
    const withComments = [];
    for (const t of tasks.filter(t => ['completed', 'paused', 'assigned'].indexOf(t.displayStatus) >= 0).slice(0, 48)) { if (withComments.length >= 3) break; const d = await apiJson(mgr, 'api_getTaskDetails', [t.id]); if (d.comments.length) withComments.push({ t, d }); }
    const pick = withComments[0];
    await ev(mgr, `Array.from(document.querySelectorAll('#tk-table tbody tr')).find(function(r){return r.innerText.indexOf(${JSON.stringify(pick.t.title)})>=0}).querySelector('button').click()`);
    await until(mgr, "document.querySelector('#task-details-content') ? document.querySelector('#task-details-content').innerText : ''", t => t.indexOf(pick.d.comments[0].text.slice(0, 20)) >= 0, 30000);
    const dtxt = await ev(mgr, "document.querySelector('#task-details-content').innerText");
    rec('G10 task details show description, project, priority, owner, activity history and comments in Russian', dtxt.indexOf(pick.t.title) >= 0 && dtxt.indexOf(pick.d.comments[0].text.slice(0, 20)) >= 0 && /[Сс]оздан/.test(dtxt) && !FORBIDDEN.test(dtxt), dtxt.replace(/\s+/g, ' ').slice(0, 90));
    const dAll = JSON.stringify(pick.d);
    rec('G11 the task history is ordered and consistent (created first, completed last for finished tasks, tracked time = sum of sessions)', pick.d.activity[0].action === 'created' && (pick.t.displayStatus !== 'completed' || pick.d.activity[pick.d.activity.length - 1].action === 'completed' || pick.d.activity.some(a => a.action === 'completed')) && pick.d.task.trackedMs === pick.d.sessions.reduce((a, s) => a + (Number(s.durationMs) || 0), 0) && !/[0-9a-f]{40}/.test(dAll), pick.t.displayStatus);

    // ---------------------------------------------------------------- H. Reports, CSV, date boundaries
    await nav('reports');
    await ev(mgr, `(function(){var f=document.querySelector('#report-form');f.elements['from'].value='${from30}';f.elements['to'].value='${today}';f.querySelector('button[type=submit]').click()})()`);
    const repText = await until(mgr, "document.querySelector('#report-content').innerText", t => t.length > 80, 30000);
    rec('H1 the 30-day report lists all employees with totals', rep.every(r => repText.indexOf(r.lastName) >= 0) && /127:50:00/.test(repText), repText.replace(/\s+/g, ' ').slice(0, 80));
    await ev(mgr, "document.querySelector('#btn-csv').click()");
    const nl = s => s.replace(/\r\n/g, '\n');
    const csv = nl(await until(mgr, "document.querySelector('#csv-text').value", t => t.length > 20, 30000));
    await sleep(1500);
    const lines = csv.split('\n').filter(Boolean);
    rec('H2 CSV (ru): BOM, localized headers incl. project, one line per session (62 + header)', csv.charCodeAt(0) === 0xFEFF && /Сотрудник/.test(lines[0]) && /Проект/.test(lines[0]) && lines.length === EXPECT.sessions + 1, 'lines=' + lines.length);
    rec('H3 CSV has no raw formula cell and no demonstration wording', !/^"[=+@-]/m.test(csv.replace(/^﻿/, '')) && !/,"[=+@-]/.test(csv) && !FORBIDDEN.test(csv), '');
    const files = fs.readdirSync(downloadDir);
    rec('H4 the browser downloaded the .csv and it equals the server\'s CSV', downloads.length >= 1 && files.length >= 1 && nl(fs.readFileSync(path.join(downloadDir, files[0]), 'utf8')) === csv, files.join());
    const csvEn = await apiJson(mgr, 'api_exportReportCsv', [from30, today, who.id, 'en']);
    rec('H5 CSV for one employee (en) has their sessions only, English headers', csvEn.rows === (rep.find(r => r.employeeId === who.id) || { sessions: [] }).sessions.length && /"Employee"/.test(csvEn.csv) && /"Project"/.test(csvEn.csv), 'rows=' + csvEn.rows);
    // date boundaries
    const day = startKey(all[0]).slice(0, 10);
    const dayMs = all.filter(s => startKey(s).slice(0, 10) === day).reduce((a, s) => a + s.durationMs, 0);
    const dDay = await apiJson(mgr, 'api_getDashboard', [day, day]);
    const dPrev = await apiJson(mgr, 'api_getDashboard', [ymd(Date.parse(day) - 86400000), ymd(Date.parse(day) - 86400000)]);
    const dNext = await apiJson(mgr, 'api_getDashboard', [ymd(Date.parse(day) + 86400000), ymd(Date.parse(day) + 86400000)]);
    const sumDays = [dPrev, dDay, dNext].reduce((a, d) => a + d.metrics.trackedMs, 0);
    const span = await apiJson(mgr, 'api_getDashboard', [ymd(Date.parse(day) - 86400000), ymd(Date.parse(day) + 86400000)]);
    rec('H6 date boundaries: a single day equals the sum of its sessions; adjacent days add up to the 3-day range; today has no time yet', dDay.metrics.trackedMs === dayMs && sumDays === span.metrics.trackedMs && (await apiJson(mgr, 'api_getDashboard', [today, today])).metrics.trackedMs === 0, day + ' ' + fmtMs(dayMs));
    const bad = await Promise.all([apiCall(mgr, 'api_generateReport', ['2026-13-40', today]), apiCall(mgr, 'api_generateReport', [today, from30]), apiCall(mgr, 'api_getDashboard', ['2000-01-01', '2100-01-01']), apiCall(mgr, 'api_generateReport', ['', ''])]);
    rec('H7 invalid, reversed and over-long date ranges are refused with translatable messages', bad.every(r => /^ERR:.*@@/.test(r)), bad.map(r => r.slice(0, 30)).join(' | '));
    await nav('history');
    await ev(mgr, `(function(){var f=document.querySelector('#history-form');f.elements['from'].value='${from30}';f.elements['to'].value='${today}';f.querySelector('button[type=submit]').click()})()`);
    await until(mgr, "document.querySelector('#history-content').innerText", t => /\d+/.test(t) && t.length > 50, 30000);
    const histRows = await ev(mgr, "document.querySelectorAll('#history-content tbody tr').length");
    rec('H8 Work history lists every session of the period (62)', histRows === EXPECT.sessions, String(histRows));
    await ev(mgr, `(function(){var f=document.querySelector('#history-form');f.elements['from'].value='2000-01-01';f.elements['to'].value='2000-01-03';f.querySelector('button[type=submit]').click()})()`);
    await sleep(2500);
    rec('H9 an empty period shows a clear empty state (history)', /(Нет|нет|No )/.test(await ev(mgr, "document.querySelector('#history-content').innerText")), '');

    // ---------------------------------------------------------------- I. validation states (invalid input must be refused and create nothing)
    await nav('employees');
    const fill = (formSel, f) => ev(mgr, `(function(){var f=document.querySelector('${formSel}');function set(n,v){var i=f.elements[n];i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}${Object.keys(f).map(k => "set('" + k + "'," + JSON.stringify(f[k]) + ");").join('')}f.querySelector('button[type=submit]').click();})()`);
    await fill('#create-form', { lastName: 'Проверка', firstName: 'Ошибка', email: 'not-an-email', initialTask: 'x' });
    const st = await until(mgr, "document.querySelector('#create-status').textContent", t => t.length > 3, 30000);
    rec('I1 an invalid e-mail is refused with a readable message', /[Нн]екоррект|[Нн]еверн|[Ii]nvalid|адрес/.test(st) && !/@@|Error:/.test(st), st);
    await ev(mgr, "document.querySelector('#create-form').reset()");
    await fill('#create-form', { lastName: 'Волкова', firstName: 'Марина', email: 'marina.volkova@example.com', initialTask: 'x' });
    const st2 = await until(mgr, "document.querySelector('#create-status').textContent", t => t.length > 3, 30000);
    rec('I2 a duplicate e-mail is refused with a readable message', /уже|already/.test(st2) && !/@@/.test(st2), st2);
    await ev(mgr, "document.querySelector('#create-form').reset()");
    const after2 = await apiJson(mgr, 'api_listEmployees', []);
    const tasksAfter = await apiJson(mgr, 'api_listTasks', []);
    rec('I3 nothing was created by the refused submissions', after2.length === 10 && tasksAfter.length === 48, after2.length + ' employees, ' + tasksAfter.length + ' tasks');

    // ---------------------------------------------------------------- J. responsive layout
    const overflow = [];
    const wList = [[1366, 900, 'desktop'], [820, 1100, 'tablet'], [390, 844, 'mobile']];
    const A2 = await openEmp(`${URL_EXEC}?page=employee&token=${tok[who.id]}&lang=ru`, tok[who.id]);
    const sets = [['mgr', mgr, views, page], ['emp', A2.f, ['overview', 'mytasks', 'available', 'history', 'comments'], A2.p]];
    for (const [w, h, name] of wList) {
      for (const [who2, frame, list, pg] of sets) {
        await b.send('Target.activateTarget', { targetId: pg.targetId });
        await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }, pg.sessionId);
        await sleep(600);
        for (const v of list) {
          await ev(frame, `document.querySelector('.nav-item[data-view=${v}]').click()`);
          await sleep(700);
          const over = await ev(frame, 'document.documentElement.scrollWidth - document.documentElement.clientWidth');
          if (over > 2) overflow.push(who2 + '/' + v + '@' + name + ' +' + over + 'px');
        }
      }
    }
    rec('J1 no horizontal page overflow on any Manager or employee view at desktop, tablet and mobile widths (with the full dataset)', overflow.length === 0, overflow.join('; '));
    await b.send('Target.activateTarget', { targetId: page.targetId });
    await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);
    await sleep(500);
    const mob = await ev(mgr, `(function(){var sb=document.getElementById('sidebar');var r0=sb.getBoundingClientRect();var btn=document.getElementById('menu-btn');var shown=getComputedStyle(btn).display!=='none';btn.click();return JSON.stringify({offscreen:r0.right<=1,shown:shown,open:sb.classList.contains('open')&&btn.getAttribute('aria-expanded')==='true'})})()`);
    await sleep(600);
    const mob2 = await ev(mgr, `(function(){var sb=document.getElementById('sidebar');var r1=sb.getBoundingClientRect();document.getElementById('scrim').click();return JSON.stringify({onscreen:r1.left>=0&&r1.right<=window.innerWidth+1,closed:!sb.classList.contains('open')})})()`);
    const mo = Object.assign(JSON.parse(mob), JSON.parse(mob2));
    rec('J2 on mobile the sidebar hides behind a menu button that opens and closes it', mo.offscreen && mo.shown && mo.open && mo.onscreen && mo.closed, JSON.stringify(mo));
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, A2.p.sessionId);

    // ---------------------------------------------------------------- K. security and leakage
    const priv = ['employees_list_', 'tasks_list_', 'tasks_claim_', 'tasks_assign_', 'tasks_move_', 'tasks_views_', 'comments_add_', 'activity_log_', 'projects_create_', 'sessions_start_', 'email_sendInvitation_', 'invites_list_', 'dashboard_get_', 'deleteRowsWhere_', 'demo_cleanup_', 'assessment_seed_', 'demo_reset_', 'getSpreadsheet_', 'readAll_', 'appendRow_', 'updateRow_', 'setSpreadsheetId', 'adminOnly_', 'employeeFromToken_', 'buildAssessmentDataset'];
    const exposed = [];
    for (const n of priv) { const r = await apiCall(mgr, n, []); if (!/^NOCALL/.test(r)) exposed.push(n + ' => ' + r.slice(0, 50)); }
    rec('K1 internal functions (and the dataset builder) are not callable from the client', exposed.length === 0, exposed.join('; ') || priv.length + ' probed');
    const adm = [];
    for (const n of ['runTests', 'resetDemoData', 'seedAssessmentData', 'cleanupTestArtifacts', 'enableOpenAccess', 'disableOpenAccess']) adm.push(n + ' => ' + (await apiCall(mgr, n, [])));
    rec('K2 owner-only functions refuse an anonymous caller (not armed) and changed nothing', adm.every(x => /ERR:.*not armed/.test(x)) && (await apiJson(mgr, 'api_listEmployees', [])).length === 10, adm.map(x => x.slice(0, 40)).join(' | '));
    const blobParts = [];
    for (const h of Array.from(b.contexts.values())) { try { blobParts.push(await ev(h, 'document.documentElement.outerHTML')); } catch (e) {} }
    blobParts.push(JSON.stringify([tasks, dash14, rep, projects, emps]), await apiCall(mgr, 'api_getAppInfo', []));
    const blob = blobParts.join('\n');
    rec('K3 the spreadsheet id appears in no page, frame or API response', !blob.includes(SHEET_ID_FRAGMENT), '');
    rec('K4 no workspace token in any manager list, dashboard, report, task or project response', !/[0-9a-f]{40}/.test(JSON.stringify([tasks, dash14, rep, projects, emps, pick.d])), '');
    const swap = await apiCall(mgr, 'api_getEmployeeDetails', [tok[who.id]]);
    rec('K5 a token is refused where an employee id is expected', /ERR:.*@@employee_not_found@@/.test(swap), swap.slice(0, 50));
    rec('K6 error responses carry no stack traces or file names', !/\.gs|at \w+ \(|stack/i.test([x1, x2, x3, x4, x5, x6, swap, ...bad].join(' ')), '');
    const info = await apiJson(mgr, 'api_getAppInfo', []);
    rec('K7 the e-mail subsystem reports its state only (kill switch / caps are enforced server-side)', info && info.email && typeof info.email.enabled === 'boolean', JSON.stringify(info));
    rec('K8 no JavaScript errors were raised by any page during the run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } catch (e) {
    rec('RUN ABORTED', false, e.message);
  } finally {
    await b.close();
    const pass = results.filter(r => r.ok).length;
    console.log('\n' + pass + '/' + results.length + ' checks passed');
    fs.writeFileSync(path.join(os.tmpdir(), 'wtt-accept-data-' + Date.now() + '.json'), JSON.stringify(results, null, 1));
    process.exitCode = pass === results.length ? 0 : 1;
  }
})();
