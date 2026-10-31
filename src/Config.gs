// Configuration: default sheet names and headers.
// Headers are the canonical column order; rows written to the sheet follow this order.

var DEFAULT_CONFIG = {
  SHEETS: {
    EMPLOYEES: 'Employees',
    TASKS: 'Tasks',
    SESSIONS: 'WorkSessions',
    INVITES: 'Invitations',
    PROJECTS: 'Projects',
    COMMENTS: 'TaskComments',
    ACTIVITY: 'TaskActivity'
  },
  HEADERS: {
    EMPLOYEES: ['id', 'lastName', 'firstName', 'middleName', 'email', 'workspaceToken', 'createdAt', 'active'],
    // The last five columns were added later; ensureSheet_ appends them to an existing Tasks sheet.
    TASKS: ['id', 'employeeId', 'title', 'status', 'createdAt', 'completedAt', 'projectId', 'priority', 'dueDate', 'description', 'assignedAt'],
    SESSIONS: ['id', 'employeeId', 'taskId', 'startTime', 'endTime', 'durationMs', 'status'],
    INVITES: ['id', 'employeeId', 'emailHash', 'at', 'status', 'detail'],
    PROJECTS: ['id', 'name', 'description', 'status', 'createdAt'],
    COMMENTS: ['id', 'taskId', 'authorType', 'authorId', 'authorName', 'text', 'createdAt'],
    ACTIVITY: ['id', 'taskId', 'at', 'actorType', 'actorId', 'action', 'detail']
  }
};

// Public-demonstration switch. When ENABLED the app (a) only serves while the
// bound spreadsheet's title contains the word "test" or "demo" (fails closed
// on any other workbook), (b) sends invitation email only within the EMAIL
// limits below (reserved example addresses are never mailed), (c) caps how
// many rows an anonymous audience can write. See Demo.gs and the README "Public demonstration"
// section. Set ENABLED to false for a non-demo deployment (which then falls
// back to the ACCESS_MODE gate).
var DEMO_CONFIG = {
  ENABLED: true,
  LIMITS: { EMPLOYEES: 100, TASKS: 500, SESSIONS: 3000, INVITES: 1000, PROJECTS: 50, COMMENTS: 1500, ACTIVITY: 6000 },
  // Invitation email. Because anonymous visitors can type any address, sending
  // is capped globally and per recipient per UTC day. ENABLED=false (or Script
  // Property EMAIL_DISABLED=true) turns sending off entirely.
  EMAIL: { ENABLED: true, DAILY_LIMIT: 20, PER_RECIPIENT_DAILY: 2 }
};

function getContext_(overrides) {
  var ctx = {
    sheets: {
      EMPLOYEES: DEFAULT_CONFIG.SHEETS.EMPLOYEES,
      TASKS: DEFAULT_CONFIG.SHEETS.TASKS,
      SESSIONS: DEFAULT_CONFIG.SHEETS.SESSIONS,
      INVITES: DEFAULT_CONFIG.SHEETS.INVITES,
      PROJECTS: DEFAULT_CONFIG.SHEETS.PROJECTS,
      COMMENTS: DEFAULT_CONFIG.SHEETS.COMMENTS,
      ACTIVITY: DEFAULT_CONFIG.SHEETS.ACTIVITY
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

var spreadsheetMemo_ = null;

// One Apps Script execution handles one request, so remembering the handle for
// the rest of that execution saves a SpreadsheetApp.openById per sheet read.
function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    if (spreadsheetMemo_ && spreadsheetMemo_.id === id) return spreadsheetMemo_.ss;
    var opened = SpreadsheetApp.openById(id);
    spreadsheetMemo_ = { id: id, ss: opened };
    return opened;
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    props.setProperty('SPREADSHEET_ID', active.getId());
    return active;
  }
  throw new Error(
    'No spreadsheet configured. Either (a) deploy the script bound to a Google Sheet, ' +
    'or (b) add the Script Property SPREADSHEET_ID in Project Settings.'
  );
}

function getConfiguredSpreadsheetId_() {
  return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
}
