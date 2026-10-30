# Working-Time Tracker

A small, functional web application for tracking employees' working time. The
backend is a Google Apps Script web app; data is persisted in Google Sheets.
The UI is plain HTML, CSS, and vanilla JavaScript served by `HtmlService`.

## Features

**Manager workspace** (served at the base web-app URL)

- View the list of employees with their accumulated time and timer status.
- Create an employee with last/first/middle name, email, and an initial task.
  Saving an employee automatically sends them an invitation email containing
  their personal workspace link.
- Inspect an employee's details: tasks, work sessions, current timer, total
  recorded time, and their personal workspace URL.
- Assign a new task to an employee (or change their current task) without
  deleting their historical time records.
- Generate a report for a date range showing per-employee recorded working
  time and task history.

**Employee workspace** (served at `<base URL>?page=employee&token=<token>`)

- A permanent personal link.
- View the currently assigned task.
- Start a work session; pause it (elapsed time stops accruing); resume it
  later, including on another day; finish the task when complete.
- See the full history of work sessions and accumulated time for the active
  task.

**Time-tracking rules enforced**

- Elapsed time is calculated from timestamps persisted on the server, not from
  a client-side counter. Closing the browser or losing the connection cannot
  make the timer drift.
- A paused session is closed. Resuming creates a brand-new session row, so
  every interval is audit-able.
- Overnight gaps, pauses, and browser downtime are never counted, because they
  are not inside any session interval.
- Starting a session when one is already running is rejected; the sheet never
  contains two active sessions for the same employee.
- Critical writes (start, pause, resume, finish, assign-task) take a
  `LockService.getScriptLock()` so concurrent requests cannot corrupt state.
- When a manager changes an employee's task while a session is running, the
  active session is auto-closed with status `paused` so its elapsed time
  stays attached to the original task. The old task is marked `replaced`;
  historical sessions are never retargeted.

## Architecture and data flow

```
Browser (manager.html / employee.html)
  |  google.script.run.<api_*>(args)
  v
Code.gs  (doGet, api_* HTTP-facing entry points)
  |  calls into service modules
  v
Employees.gs / Tasks.gs / Sessions.gs / Reports.gs / Email.gs
  |  read/write via
  v
Repository.gs  (generic sheet CRUD)
  |
  v
Google Sheets: Employees / Tasks / WorkSessions
```

Pure, side-effect-free helpers (`overlapMs`, `sumSessionMs`, `isValidEmail`,
`sanitize`, `nextStateAfter`) live in `src/pure.gs` and are tested from
Node.js (`tests/pure.test.js`). Everything that touches `SpreadsheetApp` or
`MailApp` lives in a separate file so the pure logic remains testable
outside Google.

### Data model (Google Sheets)

Three sheets are created automatically on first load. Rows carry stable
UUIDs; row numbers are never used as identifiers.

**Employees** &nbsp;&nbsp; `id | lastName | firstName | middleName | email | workspaceToken | createdAt | active`

- `id` — UUID.
- `workspaceToken` — 40-character hex string used in the personal URL.
- `createdAt` — ISO-8601 UTC.
- `active` — boolean; `true` for all employees in this build.

**Tasks** &nbsp;&nbsp; `id | employeeId | title | status | createdAt | completedAt`

- `status` — one of `active`, `completed`, `replaced`.

**WorkSessions** &nbsp;&nbsp; `id | employeeId | taskId | startTime | endTime | durationMs | status`

- Each row is one audit-able interval. `status` is `active`, `paused`, or
  `completed`. For `active` rows, `endTime` and `durationMs` are empty.
- `durationMs` is written once the session is closed, so historical rows
  stay stable even if clocks drift later.

Headers are added automatically on first run via `setupSheets()`; subsequent
runs do not duplicate headers or clear data.

## Prerequisites

- A Google account.
- (Optional for local test runs) Node.js 18 or newer.

## Setting up the Google Sheet

Pick one of these two paths.

**Path A — container-bound (simplest).**

1. Create a new Google Sheet (name is up to you, e.g. "Working Time Tracker").
2. In that sheet, Extensions → Apps Script. An empty Apps Script project
   opens, already bound to this sheet.
3. Install the code (next section). On first request to the web app the
   three sheets (`Employees`, `Tasks`, `WorkSessions`) will be created with
   their headers.

**Path B — standalone script.**

1. Go to [script.google.com](https://script.google.com/) → New project.
2. Create a Google Sheet separately and copy its ID (the part of its URL
   between `/d/` and `/edit`).
3. Install the code (next section).
4. In the Apps Script editor, from the function selector pick
   `setSpreadsheetId`, paste the ID in the parameter line (or temporarily
   edit the function body) and run it once. This stores the ID in Script
   Properties.

## Installing the code

The code in `src/` maps 1-to-1 to files inside the Apps Script project.

**With clasp (recommended if you already use it).**

```bash
npm install -g @google/clasp
clasp login
clasp clone <scriptId>   # or clasp create --type webapp
# copy files into the local clasp project, keeping `.gs` and `.html`
# extensions as they are
clasp push
```

**Manually.** In the Apps Script editor, click the `+` next to "Files" and
add each file with these settings:

| File in `src/`     | Apps Script name     | Type           |
|---------------------|----------------------|----------------|
| `appsscript.json`   | `appsscript.json`    | Manifest (enable in Project Settings) |
| `Code.gs`           | `Code`               | Script         |
| `Config.gs`         | `Config`             | Script         |
| `Email.gs`          | `Email`              | Script         |
| `Employees.gs`      | `Employees`          | Script         |
| `Reports.gs`        | `Reports`            | Script         |
| `Repository.gs`     | `Repository`         | Script         |
| `Sessions.gs`       | `Sessions`           | Script         |
| `Setup.gs`          | `Setup`              | Script         |
| `Tasks.gs`          | `Tasks`              | Script         |
| `Tests.gs`          | `Tests`              | Script         |
| `Utils.gs`          | `Utils`              | Script         |
| `pure.gs`           | `pure`               | Script         |
| `manager.html`      | `manager`            | HTML           |
| `manager_js.html`   | `manager_js`         | HTML           |
| `employee.html`     | `employee`           | HTML           |
| `employee_js.html`  | `employee_js`        | HTML           |
| `styles.html`       | `styles`             | HTML           |

To enable the manifest in the editor: Project Settings → tick "Show
`appsscript.json` manifest file in editor" → paste the contents.

## Deploying as a web app

1. In the Apps Script editor: Deploy → New deployment → Type: **Web app**.
2. Execute as: **Me (the deploying user)**.
3. Who has access: **Anyone with the link** (required so an employee's
   emailed link opens in any browser without a Google sign-in).
4. Click **Deploy**. Approve the OAuth consent on first deploy. The
   deployment URL (ends in `/exec`) is the manager entry point and the base
   for every employee's personal link.

## Required permissions

The manifest requests these scopes (`appsscript.json`):

- `https://www.googleapis.com/auth/spreadsheets` — read/write the data
  sheets.
- `https://www.googleapis.com/auth/script.send_mail` — send invitation
  emails as the deploying user via `MailApp.sendEmail`.
- `https://www.googleapis.com/auth/script.scriptapp` — read the web-app URL
  for inclusion in invitation emails and the manager console.
- `https://www.googleapis.com/auth/userinfo.email` — needed by Apps Script
  when "Who has access" is Anyone with the link.

Email delivery uses `MailApp.sendEmail`. Consumer Google accounts have a
daily quota of about 100 recipients; Workspace accounts have higher quotas.
There is no SMTP configuration — the sending address is the account that
deployed the script.

## Creating the first manager workspace

There is no account creation step. After deployment, open the `/exec` URL
in a browser; the Manager console loads directly. The console is the
"manager workspace".

> **Important limitation.** This console is **not** protected by
> authentication. Anyone who has the `/exec` URL can create employees,
> change tasks, and read reports. Share the URL only with managers and
> treat it like a secret. This project intentionally does not implement
> login — see "Known limitations" below.

## How employee invitations work

Clicking **Create & send invitation** in the manager console:

1. Validates the fields on the server (`employees_create`).
2. Inserts a new row in the `Employees` sheet with a freshly generated
   `workspaceToken`.
3. Creates the initial task row.
4. Calls `MailApp.sendEmail` with a plain-text email that includes the
   employee's name, their initial task, their personal workspace link
   (`<base URL>?page=employee&token=<token>`), and short instructions for
   Start/Pause/Resume/Finish.

If `MailApp.sendEmail` fails (quota, missing scope approval, network
error), the UI displays a red error ("Email delivery FAILED: …") rather
than silently claiming success. The employee row is still saved, so you
can copy the workspace URL from the Details view and send it manually.

## Running the automated tests

Two independent test suites exist.

**Node tests of pure logic** — run locally, no Google credentials.

```bash
node tests/run.js
# or
npm test
```

Covers `overlapMs`, `sumSessionMs`, `isValidEmail`, `sanitize`,
`nextStateAfter`, plus two end-to-end scenario checks (overnight gap not
counted; active session clamped to report range). 27 cases.

**Apps Script integration tests** — run inside Apps Script after installing
the code.

1. In the Apps Script editor, select the function `runTests` from the
   dropdown.
2. Click Run. On first run, approve the OAuth scope request.
3. Open View → Logs (`Ctrl+Enter`). Each test prints `OK <name>` or
   `FAIL <name> -- <reason>`, followed by a summary line.

The integration tests write to dedicated `Test_Employees`, `Test_Tasks`,
and `Test_WorkSessions` sheets, which are created once and whose rows are
cleared between tests. Production data in `Employees`, `Tasks`,
`WorkSessions` is never touched.

Covered scenarios (one function per `test_*` in `src/Tests.gs`):

1. Create an employee and generate a personal workspace link.
2. Assign a new task; old task is marked `replaced` and still visible.
3. Start → pause → resume: pause closes the session with a stored
   duration; resume creates a new session row; starting a second time
   while one is active is rejected.
4. Session that spans midnight: overnight gap is **not** counted.
5. Total across multiple sessions is the sum of recorded intervals.
6. Fresh read after a start restores the active session and task.
7. Starting a timer twice is rejected and never produces two active rows.
8. Changing a task while a session is running preserves the historical
   duration against the original task; the new task starts at zero.
9. Report filters correctly for a date range (today-only session is
   counted; a 10-days-ago session is excluded).
10. Empty report returns `[]`, not an error.
11. Invalid inputs (missing fields, malformed email, duplicate email,
    inverted date range) are all rejected.
12. Pausing with no active session is rejected.

## Manual test scenarios

Some aspects can only be checked in a live Apps Script deployment:

- Deploy as a web app, open the Manager URL, create an employee with your
  own email, confirm the invitation email arrives, open the link in a
  private window, start a timer, close the window for a minute, reopen
  the link, verify elapsed time jumped forward by about one minute (proof
  that the timer runs on server-persisted timestamps).
- Pause from the employee workspace, wait a minute, reopen later: elapsed
  time must not have grown while paused.
- Pause late in the evening, resume the next morning: total must equal
  the two intervals only, excluding the overnight gap.
- As a manager, assign a new task while the employee has an active timer;
  reload the employee's page and confirm the active task changed and the
  old session is still visible under its original task.
- Generate a report for a one-week range that contains no activity;
  confirm the UI shows an empty-state message rather than an error.

## Known limitations

- **No authentication on the manager workspace.** Anyone with the `/exec`
  URL can use the console. The task brief explicitly accepts this; do not
  claim this URL is "protected".
- **Personal workspace links are not strong authentication.** Possession
  of the token grants access. If a token leaks, open the sheet and remove
  the row (there is no in-UI revoke in this build).
- **Email delivery is not reliable in the sense that the script never
  retries.** If the first send fails, the error is reported to the
  manager; they can copy the workspace URL from the Details view.
- **No per-employee login.** Several employees in one browser profile
  would share whichever link was last visited.
- **Timezones.** All timestamps are stored in UTC (`toISOString`); the UI
  displays them with the viewer's local timezone (`toLocaleString`).
  Report date inputs are interpreted in the server's project timezone
  (set in `appsscript.json`, default `Etc/UTC`). Managers in a different
  timezone from the configured one may see off-by-one-day edges; this is
  acceptable for the assessment and is documented, not hidden.
- **No pagination.** The employee list is a single table; it suits dozens
  of employees but not thousands.
- **Audit trail of task changes is implicit.** We mark the previous task
  `replaced`. There is no who/why metadata because there is no manager
  identity.

## AI tools and models used

- **Claude Code / Claude Opus 4.7** was used to draft the full application
  in one pass, including the pure-logic unit tests. The author reviewed
  and ran the Node tests locally (see "Running the automated tests").
- The Apps Script integration tests have **not** been executed by the
  AI; they must be run manually after installation.

### Example prompts used during development

- "Design the Google Sheets data model for an employee time tracker where
  pause creates an auditable interval and resume opens a new one. Give me
  the columns per sheet and the state transitions."
- "Write a Google Apps Script `doGet` that serves two HTML templates:
  manager (default) and employee (requires a `token` query parameter).
  Return a readable error page when the token is unknown."
- "Add a `LockService.getScriptLock()` wrapper around start/pause/resume/
  finish so two concurrent requests cannot create a duplicate active
  session. Fail fast on timeout."
- "Write Node tests for an `overlapMs(sessionStart, sessionEnd, rangeFrom,
  rangeTo, nowMs)` function that returns the overlap of a session interval
  with a date range in milliseconds, treating a null `sessionEnd` as
  `nowMs`."

### Errors found during development

- The first draft of `sumSessionMs` had the condition
  `if (s.status === 'active' || !s.endTime)`. The intent was to be lenient
  about active rows that had not yet persisted an `endTime`. In practice
  this misclassified every row in which the test data omitted `endTime` —
  including paused rows that correctly had a `durationMs` — causing
  `sumSessionMs` to return 0 instead of the sum. The Node test
  `sumSessionMs: sums closed durations` surfaced it on the first run with
  "Expected 0 === 6000". The fix tightened the condition to
  `s.status === 'active'` only; the three failing tests then passed, with
  the full suite moving from 24/27 to 27/27.

(No other defects were caught before this write-up; if more surface during
deployment, they will be appended here honestly rather than invented.)

## Files

```
appsscript.json         Apps Script manifest
src/
  Code.gs               doGet, api_* entry points, HTML templating
  Config.gs             Spreadsheet lookup, sheet-name constants
  Email.gs              Invitation email
  Employees.gs          Employee CRUD + assignTask policy
  Reports.gs            Date-range report
  Repository.gs         Generic row-level sheet CRUD
  Sessions.gs           start / pause / resume / finish (LockService)
  Setup.gs              Idempotent sheet creation
  Tasks.gs              Task CRUD
  Tests.gs              Integration tests, runnable from the editor
  Utils.gs              UUIDs, tokens, ISO helpers
  pure.gs               Pure helpers (also tested from Node)
  manager.html          Manager console markup
  manager_js.html       Manager console script
  employee.html         Employee workspace markup
  employee_js.html      Employee workspace script
  styles.html           Shared CSS
tests/
  pure.test.js          Node tests for src/pure.gs
  load-pure.js          Loads pure.gs as a CommonJS module
  run.js                Entry point
package.json            `npm test` runs the Node suite
```
