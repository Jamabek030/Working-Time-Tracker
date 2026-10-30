// End-to-end acceptance run against a deployed /exec URL, in a fresh, signed-out
// headless Chrome profile driven over the DevTools protocol.
//
//   SHEET_ID=<demo spreadsheet id> node tests/live/accept.js <exec url>
//
// It creates a few clearly fictional records (demo.verifier.<digits>@example.com)
// that the owner-armed cleanupTestArtifacts() function can remove again. It never
// sends email: every address it uses ends in @example.com, which the app never mails.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, sleep } = require('./cdp');

const URL_EXEC = process.argv[2];
const SHEET_ID_FRAGMENT = (process.env.SHEET_ID || '').slice(0, 19);
if (!URL_EXEC || !SHEET_ID_FRAGMENT) { console.error('usage: SHEET_ID=<spreadsheet id> node tests/live/accept.js <exec url>'); process.exit(2); }

const STAMP = Date.now();
const EMAIL = 'demo.verifier.' + STAMP + '@example.com';
const EMAIL2 = 'demo.verifier.' + (STAMP + 1) + '@example.com';
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' -- ' + detail : '')); };

(async () => {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtt-dl-'));
  const b = await launch(9337);
  const downloads = [];
  b.on(m => { if (m.method === 'Browser.downloadWillBegin') downloads.push(m.params); });
  try {
    await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
    const page = await b.newPage(URL_EXEC);
    const find = (probe, ms) => b.findFrame(probe, ms || 45000);
    const ev = (h, code) => b.evalIn(h, code);
    const until = async (h, code, pred, ms) => { const end = Date.now() + (ms || 30000); let v; while (Date.now() < end) { v = await ev(h, code); if (pred(v)) return v; await sleep(600); } return v; };
    const MGR_READY = "document.querySelector('#create-form') && document.querySelector('#m-total') && document.querySelector('#m-total').textContent !== '\u2013' && document.querySelector('#employees-loading').hidden";

    // ---- A. anonymous access ---------------------------------------------------
    let mgr = await find(MGR_READY);
    const topUrl = await b.evalIn(page.sessionId, 'location.href');
    rec('A1 Manager opens with no Google sign-in', /script\.google\.com\/macros\/s\//.test(topUrl) && !/accounts\.google\.com/.test(topUrl), topUrl.replace(/\/s\/[^/]+/, '/s/<id>'));
    const lang0 = await ev(mgr, 'document.documentElement.lang');
    rec('A2 first visit follows the browser language (ru or en, never blank)', lang0 === 'ru' || lang0 === 'en', lang0);
    rec('A3 demo banner present', await ev(mgr, "!!document.querySelector('#demo-banner') && document.querySelector('#demo-banner').textContent.length > 40"), '');

    // ---- B. localization ---------------------------------------------------------
    const setLang = async (h, l) => { await ev(h, "var s=document.getElementById('lang-select'); s.value='" + l + "'; s.dispatchEvent(new Event('change'))"); await sleep(500); };
    const leaks = async (h, lang) => ev(h, `(function(){
      var other = '${lang}' === 'ru' ? 'en' : 'ru';
      var D = window.WTT_DICT, vis = document.body.innerText;
      var bad = [];
      Object.keys(D.en).forEach(function (k) {
        if (/^(err|mail|csv|field)\\./.test(k) || k === 'form.emailPh') return;
        var v = D.en[k];
        if (v.length < 9 || /\\{/.test(v)) return;
        if (D.ru[k] === v) return;
        if (vis.indexOf(v) >= 0) bad.push(k);
      });
      return bad.join(',');
    })()`);
    await setLang(mgr, 'ru');
    await sleep(800);
    const ruTitle = await ev(mgr, "document.querySelector('h1').textContent");
    rec('B1 switching to Russian translates the header, navigation and forms', ruTitle === 'Учёт рабочего времени' && (await ev(mgr, "document.querySelector('#tabbtn-employees').textContent")) === 'Сотрудники' && (await ev(mgr, "document.documentElement.lang")) === 'ru', ruTitle);
    for (const t of ['dashboard', 'employees', 'reports']) {
      await ev(mgr, "document.querySelector('[data-tab=" + t + "]').click()");
      await sleep(900);
      const l = await leaks(mgr, 'ru');
      rec('B2 no English interface text left on the ' + t + ' tab in Russian', l === '', l);
    }
    await setLang(mgr, 'en');
    rec('B3 switching back to English', (await ev(mgr, "document.querySelector('h1').textContent")) === 'Working Time Tracker', '');
    // persistence: choose Russian, reload, expect Russian again
    await setLang(mgr, 'ru');
    await sleep(1500);
    await b.send('Page.reload', {}, page.sessionId);
    mgr = await find(MGR_READY);
    const afterReload = await ev(mgr, 'document.documentElement.lang');
    const pageUrl = await b.evalIn(page.sessionId, 'location.href');
    rec('B5 language choice survives a reload', afterReload === 'ru', 'lang=' + afterReload + ' url=' + pageUrl.replace(/\/s\/[^/]+/, '/s/<id>').slice(-40));

    // ---- C. create employees, invitations, errors in the selected language ----------
    await ev(mgr, "document.querySelector('[data-tab=employees]').click()");
    await sleep(500);
    const fill = (h, f) => ev(h, `(function(){var f=document.querySelector('#create-form');
      function set(n,v){var i=f.querySelector('[name='+n+']');i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}));}
      ${Object.keys(f).map(k => "set('" + k + "'," + JSON.stringify(f[k]) + ");").join('')}
      f.querySelector('button[type=submit]').click();})()`);
    const statusText = h => until(h, "document.querySelector('#create-status').textContent", t => /Сотрудник|Employee|Укажите|required|already|существует|длинн|long/i.test(t), 40000);

    await fill(mgr, { lastName: 'Verifier', firstName: 'Demo', middleName: 'Q', email: EMAIL, initialTask: 'Acceptance test task' });
    let st = await statusText(mgr);
    rec('C1 employee created; Russian result text names the skipped example address (no mail attempted)', /Сотрудник Verifier Demo создан/.test(st) && /адрес/.test(st) && /не отправлено/i.test(st), st);
    let row = await until(mgr, `(function(){var r=Array.from(document.querySelectorAll('#employees-table tbody tr')).find(function(r){return r.innerText.indexOf('${EMAIL}')>=0});return r?r.innerText.replace(/\\s+/g,' '):''})()`, t => t.length > 0);
    rec('C2 employee appears in the list with an invitation badge', row.length > 0 && /Пропущено/.test(row), row);
    await fill(mgr, { lastName: 'Verifier', firstName: 'Demo', middleName: 'Q', email: EMAIL, initialTask: 'again' });
    await sleep(1500);
    st = await until(mgr, "document.querySelector('#create-status').textContent", t => /существует|already/.test(t), 30000);
    rec('C3 duplicate email is refused with a Russian message', /Сотрудник с такой электронной почтой уже существует\./.test(st), st);
    await setLang(mgr, 'en');
    await fill(mgr, { lastName: 'Verifier', firstName: 'Demo', middleName: 'Q', email: EMAIL, initialTask: 'again' });
    await sleep(1500);
    st = await until(mgr, "document.querySelector('#create-status').textContent", t => /already exists/.test(t), 30000);
    rec('C4 the same refusal is shown in English after switching language', /An employee with this email already exists\./.test(st), st);
    await fill(mgr, { lastName: 'x'.repeat(101), firstName: 'A', email: 'long.' + STAMP + '@example.com', initialTask: 'T' });
    st = await until(mgr, "document.querySelector('#create-status').textContent", t => /too long|слишком/.test(t), 30000);
    rec('C5 over-long field gives an understandable validation message', /Last name is too long \(max 100 characters\)/.test(st), st);
    await setLang(mgr, 'ru');

    // XSS + formula employee (also used for the CSV check)
    await fill(mgr, { lastName: '=SUM(1+1)', firstName: '<img src=x onerror="window.__xss=1">', email: EMAIL2, initialTask: '+task <b>bold</b>' });
    await until(mgr, `document.querySelector('#employees-table').innerText.indexOf('${EMAIL2}')>=0 ? 'y' : ''`, t => t === 'y');
    const xss = await ev(mgr, "JSON.stringify({img: document.querySelectorAll('#employees-table img, #details-content img').length, flag: typeof window.__xss, text: document.querySelector('#employees-table').innerText.indexOf('<img src=x') >= 0})");
    rec('C6 hostile name is shown as text and never executes', JSON.parse(xss).img === 0 && JSON.parse(xss).flag === 'undefined' && JSON.parse(xss).text === true, xss);

    // ---- D. search + filter -----------------------------------------------------------
    const cnt = () => ev(mgr, "document.querySelectorAll('#employees-table tbody tr').length");
    const total = await cnt();
    const typeSearch = async v => { await ev(mgr, `(function(){var i=document.querySelector('#emp-search');i.value=${JSON.stringify(v)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(300); };
    await typeSearch(EMAIL.toUpperCase());
    rec('D1 search by email (case-insensitive) narrows to one employee without a server call', (await cnt()) === 1, 'rows=' + (await cnt()) + ' of ' + total);
    await typeSearch('verifier demo');
    rec('D2 search by several name parts', (await cnt()) >= 1, String(await cnt()));
    await typeSearch('zzzz-no-such-person');
    rec('D3 empty result shows a clear message', (await cnt()) === 0 && (await ev(mgr, "!document.querySelector('#employees-noresults').hidden")), '');
    await typeSearch('');
    await ev(mgr, "var s=document.querySelector('#emp-filter'); s.value='working'; s.dispatchEvent(new Event('change'))");
    await sleep(300);
    const workingRows = await cnt();
    await ev(mgr, "var s=document.querySelector('#emp-filter'); s.value='idle'; s.dispatchEvent(new Event('change'))");
    await sleep(300);
    const idleRows = await cnt();
    rec('D4 status filter works (idle >= created employees, working none)', idleRows >= 2 && workingRows === 0, 'working=' + workingRows + ' idle=' + idleRows);
    await ev(mgr, "var s=document.querySelector('#emp-filter'); s.value='all'; s.dispatchEvent(new Event('change'))");
    const reqBefore = await ev(mgr, "performance.getEntriesByType('resource').length");
    await typeSearch('demo'); await typeSearch('');
    rec('D5 searching causes no extra network requests', (await ev(mgr, "performance.getEntriesByType('resource').length")) === reqBefore, '');

    // ---- E. details, workspace link, resend, assign task ----------------------------------
    await setLang(mgr, 'en');
    const openDetails = async email => {
      await ev(mgr, `Array.from(document.querySelectorAll('#employees-table tbody tr')).find(function(r){return r.innerText.indexOf('${email}')>=0}).querySelector('button').click()`);
      return until(mgr, "document.querySelector('#ws-link') ? document.querySelector('#ws-link').value : ''", v => v.length > 10, 30000);
    };
    const link = await openDetails(EMAIL);
    rec('E1 Details show a copyable workspace link, independent of email', /\/exec\?page=employee&token=[0-9a-f]{40}&lang=(en|ru)$/.test(link), link.replace(/token=[0-9a-f]+/, 'token=<redacted>').slice(-60));
    const dText = await ev(mgr, "document.querySelector('#details-content').innerText");
    rec('E2 Details show the invitation state and a send/retry button', /Skipped \(example address\)/.test(dText) && /Send invitation|Retry invitation|Send invitation again/.test(dText), '');
    await ev(mgr, "Array.from(document.querySelectorAll('#details-content button')).find(function(b){return /invitation/i.test(b.textContent)}).click()");
    const resend = await until(mgr, "document.querySelector('#invite-status') ? document.querySelector('#invite-status').textContent : ''", t => /example address/.test(t), 30000);
    rec('E3 resend reports an accurate result for a reserved address (no mail)', /No email was sent because the address is a reserved example address/.test(resend), resend);
    await ev(mgr, "(function(){var f=document.querySelector('#details-content form.assign');var i=f.querySelector('input');i.value='Second task';i.dispatchEvent(new Event('input',{bubbles:true}));f.querySelector('button[type=submit]').click();})()");
    const d2 = await until(mgr, "document.querySelector('#details-content').innerText", t => /Second task/.test(t) && /Acceptance test task/.test(t), 30000);
    rec('E4 second task assigned; first task kept in the history as replaced', /Second task/.test(d2) && /Acceptance test task/.test(d2) && /replaced/.test(d2), '');

    // ---- F. employee workspace ----------------------------------------------------------------
    const emp = await b.newPage(link);
    let ef = await find("document.querySelector('#btn-start') && document.querySelector('#task-title') && !/Loading|Загрузка/.test(document.querySelector('#task-title').textContent)");
    const wsTitle = await ev(ef, "document.querySelector('#task-title').textContent");
    rec('F1 workspace opens anonymously with the active task', wsTitle === 'Second task', wsTitle);
    rec('F2 workspace carries the language from the link', (await ev(ef, 'document.documentElement.lang')) === (/lang=ru/.test(link) ? 'ru' : 'en'), '');
    rec('F3 workspace page has no Manager console', await ev(ef, "!document.querySelector('#create-form') && !document.querySelector('#employees-table') && !document.querySelector('[data-tab]')"), '');
    const vis = id => ev(ef, "!document.querySelector('" + id + "').hidden");
    const timer = () => ev(ef, "document.querySelector('#timer-display').textContent");
    const dashBefore = await ev(mgr, "new Promise(function(r){google.script.run.withSuccessHandler(function(v){r(v.metrics.working)}).api_getDashboard('" + new Date().toISOString().slice(0, 10) + "','" + new Date().toISOString().slice(0, 10) + "')})");
    await ev(ef, "document.querySelector('#btn-start').click()");
    for (let i = 0; i < 30 && !(await vis('#btn-pause')); i++) await sleep(500);
    rec('F4 Start runs the timer', await vis('#btn-pause'), '');
    await sleep(3500);
    const t1 = await timer();
    rec('F5 elapsed time increases', t1 !== '00:00:00', t1);
    const dashDuring = await ev(mgr, "new Promise(function(r){google.script.run.withSuccessHandler(function(v){r(v.metrics.working)}).api_getDashboard('" + new Date().toISOString().slice(0, 10) + "','" + new Date().toISOString().slice(0, 10) + "')})");
    rec('F6 dashboard "working now" counts the running timer', dashDuring === dashBefore + 1, dashBefore + ' -> ' + dashDuring);
    await b.send('Page.reload', {}, emp.sessionId);
    ef = await find("document.querySelector('#btn-pause') && !document.querySelector('#btn-pause').hidden", 45000);
    const t2 = await timer();
    rec('F7 refresh while running restores the running timer', t2 >= t1 && t2 !== '00:00:00', t1 + ' -> ' + t2);
    await ev(ef, "document.querySelector('#btn-pause').click()");
    for (let i = 0; i < 30 && !(await vis('#btn-resume')); i++) await sleep(500);
    const p1 = await timer(); await sleep(3500); const p2 = await timer();
    rec('F8 Pause stops elapsed time', p1 === p2 && p1 !== '00:00:00', p1 + ' vs ' + p2);
    const dashPaused = await ev(mgr, "new Promise(function(r){google.script.run.withSuccessHandler(function(v){r(v.metrics.paused)}).api_getDashboard('" + new Date().toISOString().slice(0, 10) + "','" + new Date().toISOString().slice(0, 10) + "')})");
    rec('F9 dashboard shows employees on pause', dashPaused >= 1, String(dashPaused));
    await ev(ef, "document.querySelector('#btn-resume').click()");
    for (let i = 0; i < 30 && !(await vis('#btn-pause')); i++) await sleep(500);
    await sleep(2500);
    const hist = await ev(ef, "document.querySelector('#history-table').innerText");
    rec('F10 Resume adds a new session row (paused + active)', /paused/.test(hist) && /active/.test(hist), hist.replace(/\s+/g, ' ').slice(0, 100));
    const dup = await ev(ef, "new Promise(function(res){google.script.run.withSuccessHandler(function(){res('ACCEPTED')}).withFailureHandler(function(e){res('REFUSED: '+e.message)}).api_startSession(WORKSPACE_TOKEN)})");
    rec('F11 duplicate active timer rejected', /REFUSED: .*A session is already running/.test(dup), dup);
    await setLang(ef, 'ru');
    rec('F12 workspace switches language', (await ev(ef, "document.querySelector('#btn-pause').textContent")) === 'Пауза', '');
    await ev(ef, "document.querySelector('#btn-finish').click()");
    for (let i = 0; i < 30; i++) { if (await ev(ef, "document.querySelector('#btn-pause').hidden && document.querySelector('#btn-resume').hidden && document.querySelector('#btn-start').hidden")) break; await sleep(500); }
    rec('F13 Finish ends the task (confirm dialog accepted)', /Нет активной задачи/.test(await ev(ef, "document.querySelector('#task-title').textContent")) && b.dialogs.length >= 1, '');

    // a session on the hostile employee, so the CSV has formula-looking cells
    const link2 = await openDetails(EMAIL2);
    const emp2 = await b.newPage(link2);
    const token2 = link2.match(/token=([0-9a-f]{40})/)[1];
    const ef2 = await find("typeof WORKSPACE_TOKEN !== 'undefined' && WORKSPACE_TOKEN === '" + token2 + "' && document.querySelector('#btn-start') && !/Loading|Загрузка/.test(document.querySelector('#task-title').textContent)");
    await ev(ef2, "document.querySelector('#btn-start').click()");
    for (let i = 0; i < 30 && !(await ev(ef2, "!document.querySelector('#btn-pause').hidden")); i++) await sleep(500);
    await sleep(2500);
    await ev(ef2, "document.querySelector('#btn-pause').click()");
    for (let i = 0; i < 30 && !(await ev(ef2, "!document.querySelector('#btn-resume').hidden")); i++) await sleep(500);

    // ---- G. dashboard, analytics, reports, CSV -----------------------------------------------
    // Close the workspace tabs and bring the Manager tab to the front: background
    // tabs are throttled by the browser and would make the next steps flaky.
    await b.send('Target.closeTarget', { targetId: emp.targetId });
    await b.send('Target.closeTarget', { targetId: emp2.targetId });
    await b.send('Target.activateTarget', { targetId: page.targetId });
    await sleep(500);
    await b.send('Page.reload', {}, page.sessionId);
    mgr = await find(MGR_READY);
    const today = new Date().toISOString().slice(0, 10);
    const api = (h, fn, args) => ev(h, "new Promise(function(r){google.script.run.withSuccessHandler(function(v){r(JSON.stringify(v))}).withFailureHandler(function(e){r('ERR '+e.message)})." + fn + "(" + args.map(a => JSON.stringify(a)).join(',') + ")})");
    const from = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const dash = JSON.parse(await api(mgr, 'api_getDashboard', [from, today]));
    const rep = JSON.parse(await api(mgr, 'api_generateReport', [from, today]));
    const repTotal = rep.reduce((a, r) => a + r.totalMs, 0);
    rec('G1 dashboard total equals the report total for the same period', dash.metrics.trackedMs === repTotal && repTotal > 0, dash.metrics.trackedMs + ' vs ' + repTotal);
    rec('G2 daily buckets and by-employee rows add up to the same total', dash.daily.reduce((a, x) => a + x.ms, 0) === repTotal && dash.byEmployee.reduce((a, x) => a + x.ms, 0) === repTotal && dash.daily.length === 7, 'days=' + dash.daily.length);
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    await sleep(500);
    const shown = await until(mgr, "document.querySelector('#m-tracked').textContent", t => t !== '\u2013' && t !== '', 15000);
    const fmt = ms => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(x => String(x).padStart(2, '0')).join(':'); };
    const employeesApi = JSON.parse(await api(mgr, 'api_listEmployees', []));
    const periodText = await ev(mgr, "document.querySelector('#m-total').textContent + '|' + document.querySelector('#m-active-tasks').textContent");
    rec('G3 dashboard cards show the real figures (employees, active tasks, tracked time)', periodText.split('|')[0] === String(employeesApi.length) && /^\d\d:\d\d:\d\d$/.test(shown), periodText + ' tracked=' + shown + ' (api ' + fmt(dash.metrics.trackedMs) + ')');
    const bars = await ev(mgr, "document.querySelectorAll('#chart .bar-col').length");
    rec('G4 chart draws one column per day of the period', bars === 7, String(bars));
    await ev(mgr, "(function(){var f=document.querySelector('#dash-form');f.from.value='2000-01-01';f.to.value='2000-01-03';f.querySelector('button[type=submit]').click();})()");
    const emptyShown = await until(mgr, "!document.querySelector('#daily-empty').hidden", v => v === true, 20000);
    rec('G5 an empty period shows a clear message and zero totals', emptyShown === true && (await ev(mgr, "document.querySelector('#m-tracked').textContent")) === '00:00:00', '');
    await ev(mgr, "(function(){var f=document.querySelector('#dash-form');f.from.value='2026-03-01';f.to.value='2026-01-01';f.querySelector('button[type=submit]').click();})()");
    const badRange = await until(mgr, "document.querySelector('#dash-status').textContent", t => t.length > 3 && !/Loading|Загрузка/.test(t), 20000);
    rec('G6 an invalid period is reported in the selected language', /From date must be on or before|Дата «С»/.test(badRange), badRange);

    await ev(mgr, "document.querySelector('[data-tab=reports]').click()");
    await ev(mgr, "(function(){var f=document.querySelector('#report-form');f.from.value='" + from + "';f.to.value='" + today + "';f.querySelector('button[type=submit]').click();})()");
    const repText = await until(mgr, "document.querySelector('#report-content').innerText", t => t.length > 30, 30000);
    rec('G7 report lists employees with totals', /Total in range|Итого за период/.test(repText), '');
    const csvBtnEnabled = await ev(mgr, '!document.querySelector("#btn-csv").disabled');
    rec('G8 Export CSV is enabled once a report exists', csvBtnEnabled, '');
    await setLang(mgr, 'ru');
    await ev(mgr, "document.querySelector('#btn-csv').click()");
    // A <textarea> normalises CRLF to LF, so compare line-ending-insensitively.
    const nl = s => s.replace(/\r\n/g, '\n');
    const csv = nl(await until(mgr, "document.querySelector('#csv-text').value", t => t.length > 20, 30000));
    await sleep(1500);
    const lines = csv.split('\n').filter(Boolean);
    rec('G9 CSV has a UTF-8 BOM, Russian headers and one line per reported session', csv.charCodeAt(0) === 0xFEFF && /Сотрудник/.test(lines[0]) && lines.length - 1 === rep.reduce((a, r) => a + r.sessions.length, 0), 'lines=' + lines.length);
    rec('G10 formula-looking name and task are neutralised in the CSV', csv.includes('"\'=SUM(1+1)') && csv.includes('\'+task'), '');
    rec('G11 no raw formula cell and no markup executed in the CSV text', !/,"[=+@-]/.test(csv) && !/^"[=+@-]/m.test(csv.replace(/^\uFEFF/, '')), '');
    const files = fs.readdirSync(downloadDir);
    rec('G12 the browser downloaded the .csv file', downloads.length >= 1 && files.some(f => /\.csv$/.test(f)), 'downloads=' + downloads.length + ' files=' + files.join(','));
    if (files.length) {
      const fileText = fs.readFileSync(path.join(downloadDir, files[0]), 'utf8');
      rec('G13 the downloaded file equals the CSV the server produced (CRLF lines, BOM)', nl(fileText) === csv && fileText.includes('\r\n') && fileText.charCodeAt(0) === 0xFEFF, files[0]);
    }
    const emp2Id = JSON.parse(await api(mgr, 'api_listEmployees', [])).find(e => e.email === EMAIL2).id;
    await ev(mgr, "var s=document.querySelector('#report-employee'); s.value=" + JSON.stringify(emp2Id) + "; s.dispatchEvent(new Event('change'))");
    await sleep(500);
    const filtered = await ev(mgr, "document.querySelector('#report-content').innerText");
    rec('G14 employee filter narrows the on-screen report', /SUM/.test(filtered) && !/Verifier Demo/.test(filtered), '');
    await ev(mgr, "document.querySelector('#btn-csv').click()");
    const csv2 = nl(await until(mgr, "document.querySelector('#csv-text').value", t => nl(t) !== csv && t.length > 20, 30000));
    const lines2 = csv2.split('\n').filter(Boolean);
    rec('G15 CSV respects the employee filter (only that employee\'s sessions)', lines2.length - 1 >= 1 && lines2.slice(1).every(l => l.includes('SUM(1+1)')) && lines2.length < lines.length, 'lines=' + lines2.length + ' of ' + lines.length);
    await ev(mgr, "(function(){var f=document.querySelector('#report-form');f.from.value='2000-01-01';f.to.value='2000-01-02';f.querySelector('button[type=submit]').click();})()");
    const emptyRep = await until(mgr, "document.querySelector('#report-content').innerText", t => /нет|No activity/.test(t), 20000);
    rec('G16 empty report range is clear', /активности нет/.test(emptyRep), emptyRep.trim());

    // ---- H. responsive layout --------------------------------------------------------------------
    for (const [w, h, name] of [[1280, 900, 'desktop'], [768, 1000, 'tablet'], [390, 844, 'mobile']]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }, page.sessionId);
      await sleep(700);
      for (const t of ['dashboard', 'employees', 'reports']) {
        await ev(mgr, "document.querySelector('[data-tab=" + t + "]').click()");
        await sleep(500);
        const over = await ev(mgr, "document.documentElement.scrollWidth - document.documentElement.clientWidth");
        if (over > 2) rec('H1 no horizontal overflow on ' + name + '/' + t, false, 'overflow ' + over + 'px');
      }
    }
    rec('H1 no horizontal page overflow on desktop, tablet and mobile (all tabs)', !results.some(r => /^H1 no horizontal overflow/.test(r.name)), '');
    rec('H2 tab list is exposed with ARIA roles and selection state', await ev(mgr, "document.querySelectorAll('[role=tab]').length === 3 && document.querySelectorAll('[role=tab][aria-selected=true]').length === 1 && !!document.querySelector('label[for=lang-select]')"), '');

    // ---- I. security probes ----------------------------------------------------------------------------
    const probe = (h, fn) => ev(h, "new Promise(function(res){var t=setTimeout(function(){res('TIMEOUT')},20000);try{google.script.run.withSuccessHandler(function(v){clearTimeout(t);res('RETURNED:'+JSON.stringify(v).slice(0,80))}).withFailureHandler(function(e){clearTimeout(t);res('REFUSED:'+(e&&e.message))})." + fn + "}catch(e){clearTimeout(t);res('NOT CALLABLE: '+e.message)}})");
    const priv = ['employees_list_', 'employees_findByToken_', 'sessions_list_', 'tasks_list_', 'reports_generate_', 'email_sendInvitation_', 'email_deliver_', 'email_capability_', 'invites_list_', 'dashboard_get_', 'reports_csv_', 'demo_cleanup_', 'deleteRowsWhere_', 'setupSheets_', 'getSpreadsheet_', 'readAll_', 'appendRow_', 'setSpreadsheetId', 'getConfiguredSpreadsheetId_', 'adminOnly_', 'include_'];
    const out = [];
    for (const n of priv) out.push(n + ' => ' + await probe(mgr, n + '()'));
    rec('I1 internal functions (incl. email, cleanup, delete helpers) are not callable from the client', out.every(x => /NOT CALLABLE/.test(x)), out.filter(x => !/NOT CALLABLE/.test(x)).join('; ') || (priv.length + ' probed'));
    const adm = [];
    for (const n of ['runTests', 'resetDemoData', 'cleanupTestArtifacts', 'enableOpenAccess', 'disableOpenAccess']) adm.push(n + ' => ' + await probe(mgr, n + '()'));
    rec('I2 owner-only functions refuse an anonymous caller (not armed)', adm.every(x => /REFUSED:.*not armed/.test(x)), adm.map(x => x.slice(0, 50)).join(' | '));
    const everything = [];
    for (const h of Array.from(b.contexts.values())) { try { everything.push(await ev(h, 'document.documentElement.outerHTML')); } catch (e) {} }
    const infoJson = await api(mgr, 'api_getAppInfo', []);
    everything.push(infoJson, await api(mgr, 'api_listEmployees', []), await api(mgr, 'api_generateReport', [from, today]), JSON.stringify(dash));
    const blob = everything.join('\n');
    rec('I3 the spreadsheet id appears in no page, frame or API response', !blob.includes(SHEET_ID_FRAGMENT), '');
    rec('I4 no workspace token in the list, report, dashboard or app-info responses', !/[0-9a-f]{40}/.test((await api(mgr, 'api_listEmployees', [])) + JSON.stringify(rep) + JSON.stringify(dash) + infoJson), '');
    const idOfEmp = employeesApi.find(e => e.email === EMAIL).id;
    const emp3 = await b.newPage(link);
    const ef3 = await find("typeof WORKSPACE_TOKEN !== 'undefined' && WORKSPACE_TOKEN === '" + link.match(/token=([0-9a-f]{40})/)[1] + "' && document.querySelector('#btn-start')");
    const swap1 = await probe(ef3, "api_getEmployeeState('" + idOfEmp + "')");
    const swap2 = await probe(ef3, "api_startSession('" + idOfEmp + "')");
    rec('I5 employee APIs refuse an employee id used as a token', /REFUSED:.*Invalid workspace link|REFUSED:.*@@invalid_link@@|REFUSED:.*Недействительная/.test(swap1) && /REFUSED:/.test(swap2) && !/RETURNED/.test(swap1 + swap2), swap1.slice(0, 60));
    const tokenAsId = await probe(mgr, "api_getEmployeeDetails('" + link.match(/token=([0-9a-f]{40})/)[1] + "')");
    rec('I6 manager APIs refuse a workspace token used as an employee id', /REFUSED:/.test(tokenAsId) && !/RETURNED/.test(tokenAsId), tokenAsId.slice(0, 70));
    const unk = await probe(mgr, "api_resendInvitation('no-such-id','en')");
    rec('I7 invitation retry for an unknown employee is refused', /REFUSED:/.test(unk), unk.slice(0, 70));
    rec('I8 server errors carry no stack traces or file names', !/\.gs|at \w+ \(|stack/i.test(unk + tokenAsId + swap1), '');
    const info = JSON.parse(infoJson);
    rec('I9 app info reports the real mail capability and nothing else', Object.keys(info).sort().join() === 'demo,email' && Object.keys(info.email).sort().join() === 'available,enabled,remaining' && typeof info.email.available === 'boolean' && typeof info.email.enabled === 'boolean' && Number.isInteger(info.email.remaining), infoJson);
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
