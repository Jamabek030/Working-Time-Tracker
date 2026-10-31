// Sheet initialization. Idempotent and safe under concurrent cold starts
// (audit F-06, F-17).
//
// * Takes LockService so two first-callers do not both try to insert the
//   same sheet.
// * Re-fetches the sheet after insertSheet in case another thread raced us.
// * Refuses to rewrite the header row when the sheet already contains data
//   below a blank/corrupt header — the operator must fix such a sheet by
//   hand; silently rewriting the header could realign unrelated columns.

// Verifying eight sheets costs several seconds, and every request used to do it.
// A short-lived cache entry (per set of sheet names) records that it was just
// done; the access check always runs before this, so the cache never bypasses it.
var SETUP_CACHE_SECONDS_ = 120;

function setupCacheKey_(ctx) {
  return 'wtt.setup.1.' + Object.keys(ctx.sheets).sort().map(function (k) { return ctx.sheets[k]; }).join('|');
}

function setupSheets_(ctx) {
  ctx = ctx || getContext_();
  var cache = null, key = setupCacheKey_(ctx);
  try {
    cache = CacheService.getScriptCache();
    if (cache.get(key) === '1') return 'OK';
  } catch (e) { cache = null; }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = getSpreadsheet_();
    ensureSheet_(ss, ctx.sheets.EMPLOYEES, DEFAULT_CONFIG.HEADERS.EMPLOYEES);
    ensureSheet_(ss, ctx.sheets.TASKS, DEFAULT_CONFIG.HEADERS.TASKS);
    ensureSheet_(ss, ctx.sheets.SESSIONS, DEFAULT_CONFIG.HEADERS.SESSIONS);
    ['INVITES', 'PROJECTS', 'COMMENTS', 'ACTIVITY'].forEach(function (k) {
      if (ctx.sheets[k]) ensureSheet_(ss, ctx.sheets[k], DEFAULT_CONFIG.HEADERS[k]);
    });
    try { if (cache) cache.put(key, '1', SETUP_CACHE_SECONDS_); } catch (e) { /* the cache is an optimisation only */ }
    return 'OK';
  } finally {
    lock.releaseLock();
  }
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    try {
      sheet = ss.insertSheet(name);
    } catch (err) {
      // Another concurrent initializer may have created it; try again.
      sheet = ss.getSheetByName(name);
      if (!sheet) throw err;
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var hasData = lastRow >= 2;

  if (lastCol < 1) {
    // Totally empty sheet; safe to write headers.
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  var firstRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var isBlank = firstRow.every(function (c) { return c === '' || c === null; });

  if (isBlank && hasData) {
    throw new Error(
      'Sheet "' + name + '" has blank headers but contains data rows. ' +
      'Refusing to auto-rewrite headers because that could realign columns against ' +
      'the existing data. Please restore the header row manually.'
    );
  }
  if (isBlank && !hasData) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Add columns introduced by later versions (appended to the right in the
  // canonical order). Existing columns and rows are never moved or rewritten.
  var present = firstRow.map(String);
  var nextCol = lastCol;
  headers.forEach(function (h) {
    if (present.indexOf(h) < 0) {
      nextCol++;
      sheet.getRange(1, nextCol).setValue(h);
    }
  });

  // Headers are present and sheet has at least some data. We do not alter
  // existing headers because the operator may have added columns of their
  // own; the application reads/writes rows by header name, so extra columns
  // are harmless.
  return sheet;
}
