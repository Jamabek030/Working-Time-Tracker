// Sheet initialization. Idempotent: safe to call on every request.

function setupSheets(ctx) {
  ctx = ctx || getContext_();
  var ss = getSpreadsheet_();
  ensureSheet_(ss, ctx.sheets.EMPLOYEES, DEFAULT_CONFIG.HEADERS.EMPLOYEES);
  ensureSheet_(ss, ctx.sheets.TASKS, DEFAULT_CONFIG.HEADERS.TASKS);
  ensureSheet_(ss, ctx.sheets.SESSIONS, DEFAULT_CONFIG.HEADERS.SESSIONS);
  return 'OK';
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  var firstRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var isBlank = firstRow.every(function (c) { return c === '' || c === null; });
  if (isBlank) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
