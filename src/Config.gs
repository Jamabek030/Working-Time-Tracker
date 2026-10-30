// Configuration: default sheet names and headers.
// Headers are the canonical column order; rows written to the sheet follow this order.

var DEFAULT_CONFIG = {
  SHEETS: {
    EMPLOYEES: 'Employees',
    TASKS: 'Tasks',
    SESSIONS: 'WorkSessions'
  },
  HEADERS: {
    EMPLOYEES: ['id', 'lastName', 'firstName', 'middleName', 'email', 'workspaceToken', 'createdAt', 'active'],
    TASKS: ['id', 'employeeId', 'title', 'status', 'createdAt', 'completedAt'],
    SESSIONS: ['id', 'employeeId', 'taskId', 'startTime', 'endTime', 'durationMs', 'status']
  }
};

function getContext_(overrides) {
  var ctx = {
    sheets: {
      EMPLOYEES: DEFAULT_CONFIG.SHEETS.EMPLOYEES,
      TASKS: DEFAULT_CONFIG.SHEETS.TASKS,
      SESSIONS: DEFAULT_CONFIG.SHEETS.SESSIONS
    },
    headers: DEFAULT_CONFIG.HEADERS
  };
  if (overrides && overrides.sheets) {
    for (var k in overrides.sheets) {
      ctx.sheets[k] = overrides.sheets[k];
    }
  }
  return ctx;
}

function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    return SpreadsheetApp.openById(id);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    props.setProperty('SPREADSHEET_ID', active.getId());
    return active;
  }
  throw new Error(
    'No spreadsheet configured. Either (a) deploy the script bound to a Google Sheet, ' +
    'or (b) create a spreadsheet and run setSpreadsheetId("YOUR_SHEET_ID") once from the editor.'
  );
}

function setSpreadsheetId(id) {
  if (!id || typeof id !== 'string') throw new Error('setSpreadsheetId requires a spreadsheet ID string.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', id);
  return 'SPREADSHEET_ID set to ' + id;
}

function getConfiguredSpreadsheetId() {
  return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
}
