// The Manager and Employee screens must carry no demonstration messaging: no
// banners, footers, notices or settings text about a demo, fictional data or a
// shared/test environment. Scans every user-visible string: both dictionaries,
// both HTML pages, the client scripts, the server error pages and the dataset.
const fs = require('fs');
const path = require('path');
const { loadAll } = require('./load-i18n');
const g = loadAll();

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + (msg || '')); }

const srcDir = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(srcDir, f), 'utf8').replace(/\r\n/g, '\n');

const FORBIDDEN = /demo|демо|fictional|вымышлен|sample data|образцов|примерные данные|test environment|testing environment|тестовая среда|тестовое окружение|anyone with the (link|url)|любой[^.]{0,20}ссыл|dummy|playground|reset the data/i;

test('dictionaries: no demonstration wording in any visible string (en and ru)', () => {
  ['en', 'ru'].forEach(lang => Object.keys(g.I18N[lang]).forEach(k => {
    assert(!FORBIDDEN.test(g.I18N[lang][k]), lang + ' ' + k + ': ' + g.I18N[lang][k]);
  }));
});
test('dictionaries: the removed notice, banner and footer keys are gone', () => {
  ['demo.banner', 'footer.note', 'ws.notice', 'emp.loadSample', 'set.demo', 'set.demo1', 'err.sample_not_demo', 'err.sample_not_empty'].forEach(k => {
    assert(!(k in g.I18N.en) && !(k in g.I18N.ru), k);
  });
});
test('pages: the HTML and client scripts carry no demonstration markup or wording', () => {
  ['manager.html', 'employee.html', 'manager_js.html', 'employee_js.html', 'common_js.html', 'i18n_js.html', 'styles.html'].forEach(f => {
    const text = read(f);
    assert(!FORBIDDEN.test(text.replace(/^\s*\/\/.*$/gm, '')), f + ' mentions: ' + (text.match(FORBIDDEN) || [])[0]);
    assert(!/demoMode|WTT_DEMO|demo-banner|btn-sample|class="banner"/.test(text), f + ' still has demo markup');
  });
});
test('pages: the server error pages and API texts are neutral', () => {
  const code = read('Code.gs').replace(/^\s*\/\/.*$/gm, '');
  const strings = (code.match(/htmlError_\([^)]*\)/g) || []).concat(code.match(/UserError\('[^']*'\)/g) || []);
  strings.forEach(s => assert(!FORBIDDEN.test(s), s));
});
test('dataset: the generated texts carry no demonstration wording', () => {
  const d = g.buildAssessmentDataset(Date.UTC(2026, 9, 31, 14, 30), () => 'tok');
  const text = [].concat(d.projects.map(p => p.name + ' ' + p.description), d.tasks.map(t => t.title + ' ' + t.description), d.comments.map(c => c.text),
    d.employees.map(e => e.lastName + ' ' + e.firstName)).join('\n');
  assert(!FORBIDDEN.test(text), (text.match(FORBIDDEN) || [])[0]);
});
test('invitation email: neutral text in both languages', () => {
  ['en', 'ru'].forEach(lang => {
    const m = g.buildInvitationEmail(lang, { firstName: 'Анна', taskTitle: 'Задача', url: 'https://example.com/x' });
    assert(!FORBIDDEN.test(m.subject + '\n' + m.body + '\n' + (m.htmlBody || '')), lang);
  });
});

let passed = 0;
const failures = [];
for (const t of tests) {
  try { t.fn(); passed++; console.log('  OK   ' + t.name); }
  catch (err) { failures.push(t.name); console.log('  FAIL ' + t.name + ' -- ' + err.message); }
}
console.log('\n' + passed + '/' + tests.length + ' passed (wording)');
if (failures.length) process.exitCode = 1;
