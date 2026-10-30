// Generic row-level sheet access.
// Rows are read/written as plain objects keyed by header names.
// Every write passes user-controlled strings through `cellSafe` (defined in
// pure.gs) which prefixes a leading `'` on values that would otherwise be
// evaluated as a spreadsheet formula.

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
  if (!sheet) throw new Error('Sheet not found: ' + sheetName + ' (run setupSheets_()).');
  demo_checkRowCap_(sheetName, sheet);
  var row = headers.map(function (h) {
    var v = obj[h];
    if (v === undefined || v === null) return '';
    return cellSafe(v);
  });
  sheet.appendRow(row);
}

// Updates the row whose `idField` equals `idValue`. Returns true on success.
// Throws when the sheet or row is missing — the previous silent return had
// callers happily report success when nothing was persisted (audit F-05).
function updateRow_(sheetName, idField, idValue, updates, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('No rows in ' + sheetName + ' to update.');
  var idCol = headers.indexOf(idField) + 1;
  if (idCol <= 0) throw new Error('Unknown id field: ' + idField);
  var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  var rowIdx = -1;
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === idValue) { rowIdx = i; break; }
  }
  if (rowIdx < 0) throw new Error('Row with ' + idField + '=' + idValue + ' not found in ' + sheetName + '.');
  var rowNum = rowIdx + 2;
  Object.keys(updates).forEach(function (k) {
    var col = headers.indexOf(k) + 1;
    if (col > 0) {
      sheet.getRange(rowNum, col).setValue(cellSafe(updates[k]));
    }
  });
  return true;
}

// Delete the row whose `idField` equals `idValue`. Used for atomic rollback
// in employees_create_. Returns true if a row was deleted, false otherwise.
function deleteRow_(sheetName, idField, idValue, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return false;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var idCol = headers.indexOf(idField) + 1;
  if (idCol <= 0) return false;
  var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === idValue) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}
