// Takes screenshots of the deployed Manager / workspace at several viewport
// sizes and in both languages (fresh signed-out Chrome profile).
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
  try {
    const page = await b.newPage(URL_EXEC);
    const mgr = await b.findFrame("document.querySelector('#create-form') && document.querySelector('#m-total') && document.querySelector('#m-total').textContent !== '–'", 60000);
    const shot = async (name, w, h) => {
      await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }, page.sessionId);
      await sleep(900);
      const r = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page.sessionId);
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
      console.log('saved', name);
    };
    const tab = async t => { await b.evalIn(mgr, "document.querySelector('[data-tab=" + t + "]').click()"); await sleep(1200); };
    const lang = async l => { await b.evalIn(mgr, "var s=document.getElementById('lang-select'); s.value='" + l + "'; s.dispatchEvent(new Event('change'))"); await sleep(600); };

    await lang('ru'); await tab('dashboard');
    await shot('desktop-dashboard-ru', 1280, 900);
    await lang('en'); await tab('employees');
    await shot('desktop-employees-en', 1280, 1000);
    await b.evalIn(mgr, "var r=document.querySelector('#employees-table tbody tr'); if (r) r.querySelector('button').click()");
    await sleep(2500);
    await b.evalIn(mgr, "document.querySelector('#details-card').scrollIntoView()");
    await shot('desktop-details-en', 1280, 1000);
    await lang('ru'); await tab('reports');
    await b.evalIn(mgr, "document.querySelector('#report-form button[type=submit]').click()");
    await sleep(3000);
    await shot('tablet-reports-ru', 768, 1000);
    await tab('employees');
    await shot('mobile-employees-ru', 390, 844);
    await tab('dashboard');
    await shot('mobile-dashboard-ru', 390, 844);
  } finally { await b.close(); }
})();
