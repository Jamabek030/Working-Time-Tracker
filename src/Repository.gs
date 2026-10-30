// Generic row-level sheet access.
// Rows are read/written as plain objects keyed by header names.

function readAll_(sheetName) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values.map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function appendRow_(sheetName, obj, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName + ' (run setupSheets()).');
  var row = headers.map(function (h) {
    var v = obj[h];
    return v === undefined || v === null ? '' : v;
  });
  sheet.appendRow(row);
}

function updateRow_(sheetName, idField, idValue, updates, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return false;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var idCol = headers.indexOf(idField) + 1;
  if (idCol <= 0) throw new Error('Unknown id field: ' + idField);
  var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  var rowIdx = -1;
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === idValue) { rowIdx = i; break; }
  }
  if (rowIdx < 0) return false;
  var rowNum = rowIdx + 2;
  var keys = Object.keys(updates);
  keys.forEach(function (k) {
    var col = headers.indexOf(k) + 1;
    if (col > 0) {
      sheet.getRange(rowNum, col).setValue(updates[k]);
    }
  });
  return true;
}
