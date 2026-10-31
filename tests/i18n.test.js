// Localization tests: dictionary parity and coverage, language rules, the
// client runtime (run for real in a vm with a small DOM stub), server error
// codes and the invitation texts.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadAll } = require('./load-i18n');

const srcDir = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(srcDir, f), 'utf8').replace(/\r\n/g, '\n');
const g = loadAll();
const { I18N } = g;

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + (msg || '')); }
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Expected ' + JSON.stringify(a) + ' to equal ' + JSON.stringify(b) + (msg ? ' - ' + msg : ''));
}

const en = I18N.en, ru = I18N.ru;
const placeholders = s => (s.match(/\{(\w+)\}/g) || []).sort();
const SAME_ALLOWED = ['form.emailPh']; // an address example is language-neutral

// --- dictionaries ---------------------------------------------------------------

test('both languages define exactly the same keys', () => {
  const a = Object.keys(en).sort(), b = Object.keys(ru).sort();
  assertEq(a.filter(k => !(k in ru)), [], 'missing in ru');
  assertEq(b.filter(k => !(k in en)), [], 'missing in en');
  assert(a.length > 150, 'dictionary is substantial: ' + a.length);
});
test('no empty values and identical placeholders in both languages', () => {
  Object.keys(en).forEach(k => {
    assert(en[k].trim() && ru[k].trim(), 'empty ' + k);
    assertEq(placeholders(en[k]), placeholders(ru[k]), 'placeholders of ' + k);
  });
});
test('Russian is really translated: Cyrillic everywhere except language-neutral keys', () => {
  Object.keys(en).forEach(k => {
    if (SAME_ALLOWED.indexOf(k) >= 0) return;
    assert(/[Ѐ-ӿ]/.test(ru[k]), 'no Cyrillic in ru ' + k + ': ' + ru[k]);
    assert(ru[k] !== en[k], 'ru equals en for ' + k);
  });
});
test('English values contain no Cyrillic', () => {
  Object.keys(en).forEach(k => assert(!/[Ѐ-ӿ]/.test(en[k]), k));
});

// --- every key the UI asks for exists ---------------------------------------------

function usedKeys() {
  const keys = new Set();
  ['manager.html', 'employee.html'].forEach(f => {
    const html = read(f);
    (html.match(/data-(?:i18n|i18n-ph|i18n-title|i18n-aria|title-key)="[^"]+"/g) || []).forEach(a => keys.add(a.replace(/^[^=]+="/, '').replace(/"$/, '')));
  });
  ['manager_js.html', 'employee_js.html', 'i18n_js.html'].forEach(f => {
    const js = read(f);
    (js.match(/\b(?:T|WTT\.t)\('[A-Za-z0-9_.]+'/g) || []).forEach(a => keys.add(a.replace(/^[^']+'/, '').replace(/'$/, '')));
    (js.match(/action\('api_\w+', '[A-Za-z0-9_.]+'\)/g) || []).forEach(a => keys.add(a.replace(/^.*, '/, '').replace(/'\)$/, '')));
  });
  return Array.from(keys).filter(k => !/\.$/.test(k));
}

test('every static key used by the HTML and client scripts exists in both languages', () => {
  const used = usedKeys();
  assert(used.length > 100, 'found keys: ' + used.length);
  used.forEach(k => { assert(k in en, 'missing in en: ' + k); assert(k in ru, 'missing in ru: ' + k); });
});

const INVITE_STATUSES = ['sent', 'failed', 'unavailable', 'skipped_reserved', 'limit_global', 'limit_recipient', 'disabled', 'not_requested'];
test('dynamic key families are fully covered (work states, session statuses, invitation statuses, fields)', () => {
  ['all', 'working', 'paused', 'idle'].forEach(s => assert(('state.' + s) in ru));
  ['active', 'paused', 'completed', 'replaced'].forEach(s => assert(('status.' + s) in ru));
  INVITE_STATUSES.concat(['none']).forEach(s => { assert(('invite.' + s) in ru, 'invite.' + s); assert(('invite.result.' + s) in ru, 'invite.result.' + s); });
  ['lastName', 'firstName', 'middleName', 'email', 'initialTask', 'taskTitle'].forEach(f => assert(('field.' + f) in ru, 'field.' + f));
});
test('every invitation status the server can produce has a translation', () => {
  const src = read('Email.gs') + read('Code.gs');
  const produced = new Set();
  (src.match(/status: '([a-z_]+)'/g) || []).forEach(m => produced.add(m.replace(/^status: '/, '').replace(/'$/, '')));
  (src.match(/blocked = '([a-z_]+)'/g) || []).forEach(m => produced.add(m.replace(/^blocked = '/, '').replace(/'$/, '')));
  ['failed', 'sent', 'unavailable', 'skipped_reserved', 'not_requested', 'disabled', 'limit_global', 'limit_recipient'].forEach(s => assert(produced.has(s), 'server never produces ' + s));
  produced.forEach(s => { if (s === 'pending') return; assert(('invite.' + s) in en, 'untranslated status ' + s); });
});

// --- server error messages ----------------------------------------------------------

test('every UserError message literal in the server code maps to a translatable code', () => {
  const msgs = [];
  ['Code.gs', 'Employees.gs', 'Sessions.gs', 'Tasks.gs', 'Reports.gs', 'Demo.gs', 'Analytics.gs', 'pure.gs', 'Email.gs'].forEach(f => {
    const re = /UserError\(\s*('([^'\\]|\\.)*'|"([^"\\]|\\.)*")\s*(\+[^)]*)?\)/g;
    let m;
    while ((m = re.exec(read(f)))) msgs.push({ f, text: m[1].slice(1, -1), dynamic: !!m[4] });
  });
  assert(msgs.length >= 20, 'found ' + msgs.length);
  msgs.forEach(({ f, text, dynamic }) => {
    if (dynamic) text = text.replace(/ \(max $/, ' (max 366 days).').replace(/^Demo limit reached: at most $/, 'Demo limit reached: at most 5 x can be stored. ');
    const c = g.errorCodeFor(dynamic && /^Date range/.test(text) ? 'Date range is too long (max 366 days).' : text);
    assert(c, f + ': no code for message: ' + text);
    assert(('err.' + c.code) in en && ('err.' + c.code) in ru, 'no translation for err.' + c.code);
  });
});
test('dynamic messages map to codes with parameters', () => {
  assertEq(g.errorCodeFor('Last name is too long (max 100 characters).'), { code: 'too_long', params: { field: 'lastName', limit: '100' } });
  assertEq(g.errorCodeFor('Task title is too long (max 500 characters).').params.field, 'taskTitle');
  assertEq(g.errorCodeFor('Demo limit reached: at most 100 Employees can be stored. Ask the maintainer to reset the demo data.').params, { limit: '100', what: 'Employees' });
  assertEq(g.errorCodeFor('Date range is too long (max 366 days).').params, { limit: '366' });
  assertEq(g.errorCodeFor('totally unknown'), null);
});
test('errorEncode keeps the English fallback and only encodes known messages', () => {
  assertEq(g.errorEncode('Employee not found.'), '@@employee_not_found@@{}@@Employee not found.');
  assertEq(g.errorEncode('something odd'), 'something odd');
  assert(g.errorEncode('A server error occurred. Check the Apps Script execution log.').startsWith('@@server_error@@'));
});

// --- language rules -----------------------------------------------------------------

test('resolveLanguage: stored choice > link parameter > browser language > English', () => {
  const r = g.resolveLanguage;
  assertEq(r({ stored: 'ru', param: 'en', browser: 'en-US' }), 'ru');
  assertEq(r({ stored: null, param: 'ru', browser: 'en-US' }), 'ru');
  assertEq(r({ param: null, browser: 'ru-RU' }), 'ru');
  assertEq(r({ browser: 'de-DE' }), 'en');
  assertEq(r({}), 'en');
  assertEq(r(), 'en');
  assertEq(r({ stored: 'fr', param: 'xx', browser: 'RU' }), 'ru', 'unsupported values are skipped');
  assertEq(r({ stored: '<script>', param: 'EN' }), 'en');
});
test('resolveLanguage source is self-contained (it is shipped to the browser as text)', () => {
  const fn = vm.runInNewContext('(' + g.resolveLanguage.toString() + ')', {});
  assertEq(fn({ browser: 'ru' }), 'ru');
});
test('translate: parameters, English fallback for a missing key, key echo for unknown keys', () => {
  assertEq(g.translate('ru', 'emp.count', { shown: 2, total: 5 }), 'Показано 2 из 5');
  assertEq(g.translate('en', 'emp.count', { shown: 2, total: 5 }), 'Showing 2 of 5');
  assertEq(g.translate('xx', 'emp.count', { shown: 1, total: 1 }), 'Showing 1 of 1');
  assertEq(g.translate('ru', 'no.such.key'), 'no.such.key');
});

// --- the real client runtime, executed in a vm with a DOM stub ---------------------------

function makeBrowser(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.stored ? { 'wtt.lang': opts.stored } : {});
  const written = [];
  const nodes = [];
  const mkNode = (attrs, text) => { const n = { attrs: Object.assign({}, attrs), textContent: text || '', setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; } }; nodes.push(n); return n; };
  const label = mkNode({ 'data-i18n': 'ws.start' }, 'Start');
  const field = mkNode({ 'data-i18n-ph': 'emp.searchPh' });
  let selectHandler = null;
  const select = { value: 'en', addEventListener(ev, fn) { if (ev === 'change') selectHandler = fn; } };
  const body = { getAttribute: k => (k === 'data-title-key' ? 'app.title' : null) };
  const document = {
    documentElement: { lang: '' }, body, title: '',
    getElementById: id => (id === 'lang-select' ? select : null),
    querySelectorAll: sel => {
      if (sel === '[data-i18n]') return [label];
      if (sel === '[data-i18n-ph]') return [field];
      return [];
    }
  };
  const win = {
    WTT_DICT: I18N, WTT_RESOLVE_LANG: g.resolveLanguage, document,
    localStorage: opts.noStorage
      ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
      : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; written.push(v); } }
  };
  const sandbox = { window: win, document, navigator: { languages: opts.languages || [], language: (opts.languages || [])[0] } };
  win.window = win;
  vm.createContext(sandbox);
  const src = read('i18n_js.html').replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
  vm.runInContext(src, sandbox);
  return { WTT: win.WTT, store, written, document, label, field, select, change: v => { select.value = v; selectHandler(); } };
}

test('client: first visit with a Russian browser opens in Russian; English browser opens in English', () => {
  assertEq(makeBrowser({ languages: ['ru-RU'] }).WTT.init() || 'ok', 'ok');
  let b = makeBrowser({ languages: ['ru-RU'] }); b.WTT.init(null);
  assertEq([b.WTT.lang(), b.label.textContent, b.document.documentElement.lang], ['ru', 'Старт', 'ru']);
  b = makeBrowser({ languages: ['en-US'] }); b.WTT.init(null);
  assertEq([b.WTT.lang(), b.label.textContent], ['en', 'Start']);
  b = makeBrowser({ languages: ['de'] }); b.WTT.init(null);
  assertEq(b.WTT.lang(), 'en', 'fallback language is English');
  assertEq(b.document.title, 'Working Time Tracker');
});
test('client: choosing a language switches every labelled node and persists the choice', () => {
  const b = makeBrowser({ languages: ['en'] }); b.WTT.init(null);
  b.change('ru');
  assertEq([b.WTT.lang(), b.label.textContent, b.field.attrs.placeholder, b.written], ['ru', 'Старт', 'Начните вводить…', ['ru']]);
  assertEq(b.store['wtt.lang'], 'ru');
  assertEq(b.document.title, 'Учёт рабочего времени');
  b.change('en');
  assertEq([b.label.textContent, b.store['wtt.lang']], ['Start', 'en']);
});
test('client: a stored choice wins on the next visit; the link parameter is used when nothing is stored', () => {
  let b = makeBrowser({ stored: 'ru', languages: ['en'] }); b.WTT.init('en');
  assertEq(b.WTT.lang(), 'ru');
  b = makeBrowser({ languages: ['en'] }); b.WTT.init('ru');
  assertEq(b.WTT.lang(), 'ru');
  assertEq(b.written, [], 'merely opening a link does not overwrite the saved preference');
});
test('client: blocked storage does not break language switching', () => {
  const b = makeBrowser({ noStorage: true, languages: ['ru'] }); b.WTT.init(null);
  assertEq(b.WTT.lang(), 'ru');
  b.change('en');
  assertEq(b.label.textContent, 'Start');
});
test('client: onChange listeners fire so dynamic content is re-rendered in the new language', () => {
  const b = makeBrowser({ languages: ['en'] }); b.WTT.init(null);
  const seen = [];
  b.WTT.onChange(l => seen.push(l));
  b.change('ru'); b.change('en');
  assertEq(seen, ['ru', 'en']);
});
test('client: t() interpolates parameters in both languages and falls back to English', () => {
  const b = makeBrowser({ languages: ['ru'] }); b.WTT.init(null);
  assertEq(b.WTT.t('form.created', { name: 'Иванов Пётр' }), 'Сотрудник Иванов Пётр создан.');
  b.change('en');
  assertEq(b.WTT.t('form.created', { name: 'Ann Doe' }), 'Employee Ann Doe was created.');
  assertEq(b.WTT.t('unknown.key'), 'unknown.key');
});
test('client: server error codes are shown in the selected language, names are left alone', () => {
  const b = makeBrowser({ languages: ['ru'] }); b.WTT.init(null);
  const enc = g.errorEncode('Last name is too long (max 100 characters).');
  assertEq(b.WTT.errorText(new Error('Error: ' + enc)), 'Поле «Фамилия» слишком длинное (максимум 100 символов).');
  b.change('en');
  assertEq(b.WTT.errorText(new Error(enc)), 'Last name is too long (max 100 characters).');
  assertEq(b.WTT.errorText(new Error('Error: Employee not found.')), 'Employee not found.', 'uncoded text is passed through without the Error: prefix');
  assertEq(b.WTT.errorText(new Error(g.errorEncode('Employee not found.'))), 'Employee not found.');
  b.change('ru');
  assertEq(b.WTT.errorText(new Error(g.errorEncode('A session is already running.'))), 'Сессия уже идёт.');
});
test('client: durations and UTC timestamps do not depend on the viewer\'s time zone or language', () => {
  const b = makeBrowser({ languages: ['en'] }); b.WTT.init(null);
  assertEq(b.WTT.fmtMs(3725000), '01:02:05');
  assertEq(b.WTT.fmtMs(-5), '00:00:00');
  const s = b.WTT.fmtDateTime('2026-01-02T23:30:15Z');
  assert(/23:30:15/.test(s) && /UTC$/.test(s), s);
  assertEq(b.WTT.fmtDateTime(''), '—');
  b.change('ru');
  assert(/23:30:15/.test(b.WTT.fmtDateTime('2026-01-02T23:30:15Z')));
});

// --- no hard-coded visible text in the pages -------------------------------------------

test('every visible text node in the HTML pages is translatable', () => {
  ['manager.html', 'employee.html'].forEach(f => {
    let html = read(f).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
    const re = /<(\w+)([^>]*)>([^<]*)<\/\1>/g;
    let m;
    while ((m = re.exec(html))) {
      const [, tag, attrs, text] = m;
      if (!/[A-Za-zЀ-ӿ]/.test(text)) continue;
      if (tag === 'option' && /^(Русский|English)$/.test(text.trim())) continue;
      if (tag === 'title' || /aria-hidden="true"/.test(attrs) || /id="view-title"/.test(attrs)) continue;
      assert(/data-i18n=/.test(attrs), f + ': untranslated <' + tag + '> text "' + text.trim() + '"');
    }
    (html.match(/<input[^>]*placeholder="[^"]*"[^>]*>/g) || []).forEach(inp => assert(/data-i18n-ph=/.test(inp) || /name@example\.com/.test(inp), f + ': placeholder without data-i18n-ph: ' + inp));
  });
});
test('client scripts contain no hard-coded user-facing English strings in DOM text sinks', () => {
  ['manager_js.html', 'employee_js.html'].forEach(f => {
    const src = read(f);
    const bad = [];
    (src.match(/(?:text|textContent|placeholder)\s*[:=]\s*'[^']*[A-Za-z]{3,}[^']*'/g) || []).forEach(m => bad.push(m));
    assertEq(bad.filter(b => !/\.(?:className|type)/.test(b)), [], f + ' has literal text: ' + bad.join(' | '));
  });
});

// --- invitation text -----------------------------------------------------------------------

test('invitation emails: English and Russian, plain text, correct link, sanitized user text', () => {
  const data = { firstName: 'Bob\r\nBcc: x@y.z', taskTitle: 'Plan the sprint', url: 'https://script.google.com/macros/s/ID/exec?page=employee&token=TOK&lang=ru' };
  const ruMail = g.buildInvitationEmail('ru', data);
  const enMail = g.buildInvitationEmail('en', data);
  assertEq(ruMail.subject, 'Ваше рабочее место в «Учёт рабочего времени»'.replace('«Учёт рабочего времени»', '«Учёте рабочего времени»'));
  assert(/Здравствуйте, Bob Bcc: x@y\.z!/.test(ruMail.body), ruMail.body);
  assert(enMail.body.startsWith('Hello Bob Bcc: x@y.z,'), enMail.body);
  [ruMail, enMail].forEach(m => {
    assert(m.body.includes('token=TOK&lang=ru'), 'link intact');
    assert(!/\n(Bcc|Subject):/i.test(m.body) && m.subject.indexOf('\n') < 0, 'no injected lines');
    assert(!/<[a-z]/i.test(m.body), 'no HTML');
    assert(/Plan the sprint/.test(m.body), 'line separators flattened');
  });
  assertEq(g.buildInvitationEmail('de', data).subject, enMail.subject, 'unknown language falls back to English');
});
test('invitation emails: very long names and tasks are capped', () => {
  const m = g.buildInvitationEmail('en', { firstName: 'N'.repeat(500), taskTitle: 'T'.repeat(5000), url: 'u' });
  assert(m.body.length < 1200, 'body length ' + m.body.length);
});
test('CSV headers exist in both languages and statuses are translated', () => {
  const r = g.csvLabelsFor('ru'), e = g.csvLabelsFor('en');
  assertEq(r.employee, 'Сотрудник');
  assertEq(e.employee, 'Employee');
  assertEq(r.statuses.completed, 'завершено');
  assertEq(Object.keys(r).sort(), Object.keys(e).sort());
});

let passed = 0;
const failures = [];
for (const t of tests) {
  try { t.fn(); passed++; console.log('  OK   ' + t.name); }
  catch (err) { failures.push(t.name); console.log('  FAIL ' + t.name + ' -- ' + err.message); }
}
console.log('\n' + passed + '/' + tests.length + ' passed (i18n)');
if (failures.length) process.exitCode = 1;
