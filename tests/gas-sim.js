// A minimal in-memory simulation of the Apps Script services this project uses
// (SpreadsheetApp, PropertiesService, LockService, Utilities, Logger, MailApp,
// HtmlService, ScriptApp). It loads the REAL src/*.gs files into a vm context so
// the production code paths run unmodified.
//
// This is a SIMULATION. It is not Google Apps Script: it does not model quotas,
// real lock contention between executions, Sheets type coercion (except the
// leading-apostrophe text sentinel), or google.script.run privacy rules. Results
// from it are labelled "simulated" everywhere and never replace running
// `runTests` in the real project.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const srcDir = path.join(__dirname, '..', 'src');

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = (this.sheet.rows[this.r - 1 + i] || [])[this.c - 1 + j];
        row.push(v === undefined || v === null ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => this.sheet._set(this.r + i, this.c + j, v))); return this; }
  setValue(v) { this.sheet._set(this.r, this.c, v); return this; }
  clearContent() {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet._set(this.r + i, this.c + j, '');
    return this;
  }
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  // Sheets treats a leading apostrophe as a text sentinel and does not store it.
  _set(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c - 1) row.push('');
    row[c - 1] = (typeof v === 'string' && v.charAt(0) === "'") ? v.slice(1) : (v === null || v === undefined ? '' : v);
  }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some(x => x !== '' && x !== undefined)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.rows.forEach(r => { for (let j = (r || []).length - 1; j >= 0; j--) if (r[j] !== '' && r[j] !== undefined) { max = Math.max(max, j + 1); break; } });
    return max;
  }
  getRange(r, c, nr, nc) { return new FakeRange(this, r, c, nr || 1, nc || 1); }
  appendRow(arr) { const r = this.getLastRow() + 1; arr.forEach((v, j) => this._set(r, j + 1, v)); }
  deleteRow(i) { this.rows.splice(i - 1, 1); }
  setFrozenRows() {}
}

class FakeSpreadsheet {
  constructor(name, id) { this.name = name; this.id = id; this.sheets = new Map(); }
  getName() { return this.name; }
  getId() { return this.id; }
  getSheetByName(n) { return this.sheets.get(n) || null; }
  insertSheet(n) {
    if (this.sheets.has(n)) throw new Error('A sheet with the name "' + n + '" already exists.');
    const s = new FakeSheet(n); this.sheets.set(n, s); return s;
  }
  deleteSheet(s) { this.sheets.delete(s.name); }
}

function createEnv(opts) {
  opts = opts || {};
  const ss = new FakeSpreadsheet(opts.title || 'Working Time Tracker — Test Env', 'SIM-PINNED-ID');
  const other = new FakeSpreadsheet('Payroll 2026 (unrelated)', 'SIM-OTHER-ID');
  const props = new Map();
  if (opts.pin !== false) props.set('SPREADSHEET_ID', ss.id);
  const log = { logger: [], mail: [], errors: [], opened: [], propWrites: [], lockEvents: [] };
  const cacheStore = new Map();
  let lockHeld = false;
  let externalLock = false; // simulates another execution holding the script lock

  const sandbox = {
    console: { error: m => log.errors.push(String(m)), log() {} },
    Logger: { log: m => log.logger.push(String(m)) },
    Utilities: { getUuid: () => crypto.randomUUID() },
    MailApp: {
      // The simulated mail service only records messages; nothing is ever sent.
      sendEmail: m => {
        if (opts.mailFails) throw new Error('Service invoked too many times for one day: email.');
        log.mail.push(m);
      },
      getRemainingDailyQuota: () => {
        if (opts.noMailScope) throw new Error('You do not have permission to call MailApp.getRemainingDailyQuota. Required permissions: https://www.googleapis.com/auth/script.send_mail');
        return 100 - log.mail.length;
      }
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/SIM/exec' }) },
    SpreadsheetApp: {
      openById: id => { log.opened.push(id); if (id === ss.id) return ss; if (id === other.id) return other; throw new Error('No item with the given ID could be found.'); },
      getActiveSpreadsheet: () => (opts.noActive ? null : ss)
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { log.propWrites.push(k); props.set(k, String(v)); },
        deleteProperty: k => { props.delete(k); }
      })
    },
    CacheService: { getScriptCache: () => ({ get: k => (cacheStore.has(k) ? cacheStore.get(k) : null), put: (k, v) => { cacheStore.set(k, String(v)); } }) },
    LockService: {
      getScriptLock: () => {
        let mine = false;
        return {
          waitLock() {
            if (lockHeld || externalLock) throw new Error('Lock timeout: another process is holding the lock.');
            lockHeld = true; mine = true; log.lockEvents.push('acquire');
          },
          tryLock() {
            if (lockHeld || externalLock) return false;
            lockHeld = true; mine = true; log.lockEvents.push('acquire'); return true;
          },
          releaseLock() { if (mine) { lockHeld = false; mine = false; log.lockEvents.push('release'); } }
        };
      }
    },
    HtmlService: {
      createHtmlOutput: html => ({ kind: 'html', html }),
      createTemplateFromFile: name => ({
        kind: 'template', name,
        evaluate() { return { kind: 'evaluated', name, setTitle() { return this; }, addMetaTag() { return this; } }; }
      }),
      createHtmlOutputFromFile: () => ({ getContent: () => '' })
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.gs'));
  // Config first (Tests.gs reads DEFAULT_CONFIG at load time), then the rest.
  files.sort((a, b) => (a === 'Config.gs' ? -1 : b === 'Config.gs' ? 1 : a.localeCompare(b)));
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), sandbox, { filename: f }));

  return {
    ctx: sandbox, ss, other, props, log,
    arm: v => props.set('ADMIN_MODE', v),
    holdLockExternally: on => { externalLock = on; },
    isLockHeld: () => lockHeld,
    cacheStore: cacheStore,
    run: code => vm.runInContext(code, sandbox)
  };
}

module.exports = { createEnv };
