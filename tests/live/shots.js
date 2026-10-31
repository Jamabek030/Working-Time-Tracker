// Takes screenshots of the deployed Manager and employee workspace at several
// viewport sizes and in both languages (fresh signed-out Chrome profile) and
// reports any JavaScript errors the pages raised.
// usage: node tests/live/shots.js <exec url> <output dir>
const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');
const URL_EXEC = process.argv[2];
const OUT = process.argv[3];
if (!URL_EXEC || !OUT) { console.error('usage: node tests/live/shots.js <exec url> <output dir>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await launch(9336);
  const errors = [];
  b.on(m => {
    if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + JSON.stringify(m.params.args.map(a => a.value || a.description)).slice(0, 300));
  });
  try {
    const page = await b.newPage(URL_EXEC);
    const mgr = await b.findFrame("document.querySelector('#view-overview') && document.querySelector('#m-total') && document.querySelector('#m-total').textContent !== '–' && document.querySelector('#employees-loading').hidden", 60000);
    const shot = async (name, w, h, sess) => {
      sess = sess || page;
      await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }, sess.sessionId);
      await sleep(900);
      const r = await b.send('Page.captureScreenshot', { format: 'png' }, sess.sessionId);
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
      console.log('saved', name);
    };
    const view = async v => { await b.evalIn(mgr, "document.querySelector('.nav-item[data-view=" + v + "]').click()"); await sleep(1800); };
    const lang = async l => { await b.evalIn(mgr, "var s=document.getElementById('lang-select'); s.value='" + l + "'; s.dispatchEvent(new Event('change'))"); await sleep(600); };

    await lang('ru'); await view('overview');
    await shot('m-overview-ru-desktop', 1366, 1000);
    await view('tasks');
    await shot('m-tasks-ru-desktop', 1366, 900);
    await b.evalIn(mgr, "var r=document.querySelector('#tk-table tbody tr'); if (r) r.querySelector('button').click()");
    await sleep(2500);
    await b.evalIn(mgr, "document.querySelector('#task-details-card').scrollIntoView()");
    await shot('m-task-details-ru-desktop', 1366, 1000);
    await lang('en'); await view('projects');
    await shot('m-projects-en-desktop', 1366, 800);
    await view('employees');
    await shot('m-employees-en-tablet', 820, 1100);
    await view('overview');
    await shot('m-overview-en-mobile', 390, 900);
    await view('tasks');
    await shot('m-tasks-en-mobile', 390, 900);

    // employee workspace: open the first employee's link from Details
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    await view('employees');
    await b.evalIn(mgr, "document.querySelector('#employees-table tbody tr button').click()");
    const link = await (async () => { for (let i = 0; i < 40; i++) { const v = await b.evalIn(mgr, "document.querySelector('#ws-link') ? document.querySelector('#ws-link').value : ''"); if (v) return v; await sleep(600); } return ''; })();
    if (link) {
      const emp = await b.newPage(link + '&lang=ru');
      const ef = await b.findFrame("typeof WORKSPACE_TOKEN !== 'undefined' && document.querySelector('#greeting') && document.querySelector('#greeting').textContent.length > 0", 60000);
      await shot('e-overview-ru-desktop', 1366, 900, emp);
      await b.evalIn(ef, "document.querySelector('.nav-item[data-view=available]').click()"); await sleep(2500);
      await shot('e-available-ru-desktop', 1366, 900, emp);
      await b.evalIn(ef, "document.querySelector('.nav-item[data-view=mytasks]').click()"); await sleep(1500);
      await shot('e-mytasks-ru-mobile', 390, 900, emp);
      await b.evalIn(ef, "document.querySelector('.nav-item[data-view=comments]').click()"); await sleep(1500);
      await shot('e-comments-ru-desktop', 1100, 800, emp);
    }
  } finally {
    await b.close();
    console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  }
})();
