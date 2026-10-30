# Working-Time Tracker

A small, functional web application for tracking employees' working time.
Backend: Google Apps Script. Persistence: Google Sheets. Frontend: plain
HTML, CSS, and vanilla JavaScript served by `HtmlService`.

## Features

**Manager console** (served at the base web-app URL once an administrator
has unlocked access — see "Access gate" below)

- View the list of employees with their accumulated time and timer status.
  (Workspace tokens are no longer returned in the list — see Details.)
- Create an employee with last/first/middle name, email, and an initial
  task. Saving an employee sends an invitation email containing their
  personal workspace link. Email success/failure is reported honestly.
- Inspect an employee's Details: tasks, work sessions, current timer, total
  recorded time, workspace URL, and buttons to **Copy workspace link** and
  **Rotate workspace token** (immediately invalidates the old link).
- Assign a new task to an employee (or change their current task) without
  deleting their historical time records.
- Generate a report for a date range showing per-employee working time and
  "tasks whose creation date falls in the selected period".

**Employee workspace** (served at `<base URL>?page=employee&token=<token>`)

- A permanent personal link.
- View the currently assigned task.
- Start a work session; pause (elapsed time stops accruing); resume later,
  including on another day; finish the task.
- See the full history of work sessions and accumulated time for the
  active task.

## Time-tracking rules enforced

- Elapsed time is computed from timestamps persisted on the server, not
  from a client-side counter. Closing the browser cannot make the timer
  drift.
- A paused session is closed with a frozen `durationMs`. Resuming creates a
  new session row; every interval is auditable.
- Overnight gaps, pauses, and browser downtime are never counted because
  they are not inside any session interval.
- Starting a session when one is already running is rejected; the sheet
  never contains two active sessions for the same employee.
- All critical writes (start, pause, resume, finish, assign-task, create,
  rotate token, setupSheets) take `LockService.getScriptLock()`.
- Employee creation is atomic: if the initial-task insert fails, the
  Employees row is rolled back so a retry can succeed.
- Changing a task while a session is running auto-closes the session with
  status `paused` against the original task. The old task is marked
  `replaced`; historical sessions are never retargeted.

## Access gate (security)

The deployed `/exec` URL is a public endpoint (Apps Script's web-app
"Anyone with the link" setting is the only workable choice because
employees reach their workspaces anonymously). **There is no login.**
Anyone who has the `/exec` URL and the deployment is unlocked can create
employees, change tasks, read reports, and inspect every employee's
workspace token.

To make that posture explicit and prevent an accidentally public rollout
the script starts in **LOCKED** mode. `doGet` returns an "unconfigured"
page and every `api_*` call throws until an administrator does the
following, once:

1. Open the Apps Script editor.
2. From the function dropdown, pick `enableOpenAccess`.
3. Click **Run** and approve the OAuth scopes if prompted.

Running `enableOpenAccess()` sets the Script Property `ACCESS_MODE = OPEN`.
To re-lock the deployment, run `disableOpenAccess()` from the same editor.

### Decisions required from the Product Owner

- Confirm that the manager console is intentionally shared without
  authentication, OR replace this gate with a proper login (e.g. a
  Managers sheet checked against `Session.getActiveUser().getEmail()` plus
  deployment "Execute as: User accessing the web app"). Until that is
  decided, the gate above is the safest compatible default.
- Confirm the project `timeZone` in `appsscript.json` (default `Etc/UTC`).
  Report date boundaries use that timezone — see "Reports and dates".

## Architecture and data flow

```
Browser (manager.html / employee.html)
  |  google.script.run.<api_*>(args)   <-- throws if ACCESS_MODE != OPEN
  v
Code.gs  (doGet, api_*, safeApi_, access gate, jsonForScript_)
  |  service layer (all writes under LockService; UserError for safe msgs)
  v
Employees.gs / Tasks.gs / Sessions.gs / Reports.gs / Email.gs
  |  read/write via
  v
Repository.gs  (generic row CRUD + cellSafe formula escaping)
  |
  v
Google Sheets: Employees / Tasks / WorkSessions
```

Pure, side-effect-free helpers live in `src/pure.gs` (`overlapMs`,
`sumSessionMs`, `sumSessionMsWithDiagnostics`, `isValidEmail`, `sanitize`,
`nextStateAfter`, `cellSafe`, `validateLength`, `parseYmdStrictUtc`,
`UserError`, `FIELD_LIMITS`) and are tested from Node.js.

### Data model (Google Sheets)

Three sheets are created automatically on first load. Rows carry stable
UUIDs; row numbers are never used as identifiers.

**Employees** `id | lastName | firstName | middleName | email | workspaceToken | createdAt | active`

**Tasks** `id | employeeId | title | status | createdAt | completedAt`

- `status` ∈ `active | completed | replaced`

**WorkSessions** `id | employeeId | taskId | startTime | endTime | durationMs | status`

- `status` ∈ `active | paused | completed`
- For `active` rows, `endTime` and `durationMs` are empty.
- `durationMs` is frozen when the row is closed; historical rows stay
  stable even if clocks drift.

Headers are added automatically on first run via `setupSheets()`. Repeat
runs do not duplicate headers, do not reset data, and `ensureSheet_` now
**refuses** to rewrite a blank header row when data rows already exist
below it (prevents column realignment against existing data).

### Spreadsheet formula protection

Every string value written to a cell goes through `cellSafe()` in
`src/pure.gs`. If the first non-whitespace/BOM/control character of a
string is `=`, `+`, `-`, `@`, or `|`, a single apostrophe is prefixed
(Google Sheets' text sentinel). Numbers, Dates, booleans, UUIDs, ISO
timestamps and ordinary names pass through unchanged. On read-back from
Sheets the apostrophe is stripped, so the application sees the user's
original string. See `src/Tests.gs → test_formulaInjectionNeutralized`.

### Access-safe API responses

- `api_listEmployees` returns name/email/totals/status only — **no token,
  no workspace URL**.
- `api_getEmployeeDetails` returns the workspace URL and (via its UI) the
  Rotate button that revokes the current link.
- `api_rotateWorkspaceToken(employeeId)` generates a new token under the
  lock, returning the new workspace URL. The old link stops working
  immediately.
- Server-side errors sent to the browser are sanitized by `safeApi_` in
  `Code.gs`: messages marked `userSafe` pass through; anything else is
  logged full server-side and surfaced as "A server error occurred. Check
  the Apps Script execution log."

### Field length limits (`src/pure.gs → FIELD_LIMITS`)

- `firstName`, `lastName`, `middleName`: 100 characters
- `email`: 320 characters (RFC 5321 practical cap)
- `taskTitle` (initial task and later assignments): 500 characters

Enforced server-side. Client-side `maxlength` attributes mirror these.

### Reports and dates

- Report `from` / `to` must match `^\d{4}-\d{2}-\d{2}$` and be a valid
  calendar date; impossible dates like `2024-02-30` are rejected.
- Boundaries are built at UTC day start / end (`00:00:00.000Z` and
  `23:59:59.999Z`) because the project's `timeZone` is `Etc/UTC`. If you
  change `timeZone` in `appsscript.json`, update `parseYmdStrictUtc` to
  match or document the intentional mismatch.
- An "empty report" (no sessions and no tasks created in range) is
  returned as `[]`; the UI shows an empty-state message.

## Prerequisites

- A Google account.
- (Optional for local test runs) Node.js 18 or newer.

## Setting up the Google Sheet

**Path A — container-bound (simplest).** Create a Google Sheet,
Extensions → Apps Script. The Apps Script project is bound to the sheet.
On first unlocked request the three data sheets are created automatically.

**Path B — standalone script.** Create the sheet separately, copy its ID,
and from the Apps Script editor run
`setSpreadsheetId("YOUR_SHEET_ID")` once.

## Installing the code

Files in `src/` map 1-to-1 to files inside the Apps Script project.

| File in `src/`     | Apps Script name     | Type                                   |
|---------------------|----------------------|----------------------------------------|
| `appsscript.json`   | `appsscript.json`    | Manifest (enable in Project Settings)  |
| `Code.gs`           | `Code`               | Script                                 |
| `Config.gs`         | `Config`             | Script                                 |
| `Email.gs`          | `Email`              | Script                                 |
| `Employees.gs`      | `Employees`          | Script                                 |
| `Reports.gs`        | `Reports`            | Script                                 |
| `Repository.gs`     | `Repository`         | Script                                 |
| `Sessions.gs`       | `Sessions`           | Script                                 |
| `Setup.gs`          | `Setup`              | Script                                 |
| `Tasks.gs`          | `Tasks`              | Script                                 |
| `Tests.gs`          | `Tests`              | Script                                 |
| `Utils.gs`          | `Utils`              | Script                                 |
| `pure.gs`           | `pure`               | Script                                 |
| `manager.html`      | `manager`            | HTML                                   |
| `manager_js.html`   | `manager_js`         | HTML                                   |
| `employee.html`     | `employee`           | HTML                                   |
| `employee_js.html`  | `employee_js`        | HTML                                   |
| `styles.html`       | `styles`             | HTML                                   |

To enable the manifest in the editor: Project Settings → tick "Show
`appsscript.json` manifest file in editor" → paste the contents.

## Deploying as a web app

1. Deploy → New deployment → Type: **Web app**.
2. Execute as: **Me (the deploying user)**.
3. Who has access: **Anyone with the link** (required so employee links
   open anonymously).
4. Approve the OAuth scopes on first deploy.
5. **The deployment starts in LOCKED mode.** Run `enableOpenAccess` from
   the Apps Script editor before sharing the URL with managers. Verify by
   loading the `/exec` URL yourself and confirming the manager console
   renders.

## Required OAuth scopes

Declared in `appsscript.json`:

- `https://www.googleapis.com/auth/spreadsheets` — read/write sheets.
- `https://www.googleapis.com/auth/script.send_mail` — send invitations
  via `MailApp.sendEmail`.
- `https://www.googleapis.com/auth/script.scriptapp` — read the web-app
  URL for inclusion in emails and the manager console.

The previously requested `userinfo.email` scope was removed (not used by
any code path).

## Running the automated tests

**Node tests of pure logic** — run locally, no Google credentials:

```bash
node tests/run.js
# or
npm test
```

Covers overlap maths, duration summing (including fallback to timestamp
difference when `durationMs` is missing), state transitions, email
validation, length limits, strict date parsing, `cellSafe` formula
protection, the `UserError` marker, and the overnight-crossing scenario.

**Apps Script integration tests** — must run inside Apps Script after
installing the code and (if standalone) binding a spreadsheet. From the
editor select `runTests` and click **Run**; results are logged to
Logger / Executions.

The integration suite writes to dedicated `Test_Employees`, `Test_Tasks`,
`Test_WorkSessions` sheets, and uses a one-off `Test_BlankHeaders` sheet
that is deleted at the end of its test. Production data is never
touched.

### What the Apps Script integration suite covers

1. Create an employee and generate a personal workspace link.
2. Assign a new task; old task marked `replaced`.
3. Start → pause → resume: pause closes with frozen duration; resume opens
   a new session row; starting a second time while one is active throws.
4. Pre-midnight and post-midnight sessions: gap between them (crossing
   midnight) is not counted.
5. Total across multiple sessions is the sum of recorded intervals.
6. Fresh read restores the active session and task.
7. Starting a timer twice is rejected.
8. Changing a task while a session is running preserves the original
   task's elapsed time and leaves the new task at zero.
9. Report filters correctly for a date range.
10. Empty report returns `[]`.
11. Invalid inputs rejected.
12. Pausing with no active session rejected.
13. **F-01**: Formula injection stored under a leading apostrophe; read-back
    returns the user's string unchanged.
14. **F-05**: `updateRow_` throws when the id does not exist.
15. **F-13**: `closeSession_` throws when `startTime` cannot be parsed.
16. **F-10**: Token rotation changes the token, invalidates the old link,
    and the new link resolves.
17. **F-14**: Server-side length limits enforced.
18. **F-07**: Report date parsing rejects impossible/non-ISO inputs.
19. **F-12**: `sumSessionMs` falls back to timestamp delta when
    `durationMs` is missing but endpoints are valid.
20. **F-17**: `ensureSheet_` refuses to rewrite a blank header above data.

### Verified in THIS environment

- `node tests/run.js` — **45/45 passed** (final run against the current
  tree; see the "Tests run" section below).
- `node --check` on every `src/*.gs` file (copied to `.js` to satisfy
  Node's extension check) — all parse cleanly.

### NOT verified in this environment

The Apps Script integration suite in `src/Tests.gs` has NOT been executed
by the AI — Apps Script services (`SpreadsheetApp`, `MailApp`,
`LockService`, `HtmlService`, `ScriptApp`) are only available in Google
Apps Script runtime. It is unit-test-style code that will exercise the
service and repository layers directly; execution requires a real
spreadsheet. Treat the following behaviors as unverified until a human
runs `runTests` and `enableOpenAccess` once end-to-end:

- Email delivery via `MailApp`.
- Live `LockService` contention under concurrent requests.
- The templating of the inline workspace token via `jsonForScript_` in a
  real browser.
- First-request `setupSheets` behavior on a brand-new spreadsheet.
- The actual OAuth consent screen with the trimmed scope set.

## Manual test scenarios (require deployment)

- Deploy, run `enableOpenAccess`, open Manager, add an employee with your
  own email, confirm the invitation email arrives, open the link in a
  private window, start a timer, close the window for a minute, reopen
  the link, verify elapsed time jumped forward.
- Pause and reopen later: elapsed time must not have grown while paused.
- Pre-midnight start, resume next morning: total equals the two intervals
  only.
- Manager assigns a new task while employee has an active timer; reload
  the employee's page: active task updated, old session preserved under
  the original task.
- Rotate workspace token from Details → old link now shows "Invalid
  workspace link", new link works.
- Generate a report for a one-week period with no activity → empty-state
  message, no error.
- Attempt to create an employee named `=HYPERLINK("http://evil","x")` →
  the Sheets cell shows the literal formula text, Sheets does not evaluate
  it, and the manager UI's name column also shows the literal text.

## Known limitations

- **No authentication.** The manager console is unauthenticated. The
  LOCKED-by-default access gate prevents accidental public access; the
  decision to run `enableOpenAccess()` is the Product Owner's and is
  reversible via `disableOpenAccess()`.
- **Personal workspace links are bearer tokens.** Anyone with the link
  can act as the employee. The token can be rotated from Details.
- **Email delivery is reported but not retried.** On failure the manager
  sees "Email delivery FAILED: …" and can copy the workspace link
  manually; the employee row stays saved.
- **No pagination.** Suitable for dozens of employees.
- **UTC day boundaries.** Reports use UTC day boundaries; a manager in a
  different timezone will see slight edge-of-day differences. Change
  `timeZone` in `appsscript.json` (and `parseYmdStrictUtc` in step with
  it) if a different timezone is required.
- **No who-changed-what audit metadata.** Task changes are preserved but
  not attributed; this build has no identity for the acting manager.

## AI tools and models used

- **Claude Code / Claude Opus 4.7** drafted the application and the
  remediations in two coordinated passes. The author ran the Node tests
  locally and performed static syntax checks on all `.gs` files. The
  Apps Script integration tests have not been executed by the AI.

### Example prompts used during development

Each prompt is followed by why it was used.

- "Design the Google Sheets data model for an employee time tracker where
  pause creates an auditable interval and resume opens a new one."
  — Used to settle the fundamental shape of a session row before writing
  any code, so that pause/resume semantics would never require editing an
  existing row's duration retroactively.
- "Write a Google Apps Script `doGet` that serves two HTML templates
  (manager and employee), where the employee template needs a token query
  parameter and shows a readable error page when the token is unknown."
  — Used to lock down the entry-point routing early, so the manager and
  the employee workspaces share one web-app deployment and one base URL.
- "Add a `LockService.getScriptLock()` wrapper around start/pause/resume/
  finish so two concurrent requests cannot create a duplicate active
  session." — Used to make the invariant "at most one active session per
  employee" testable from the start, rather than retrofitting locks after
  a race was observed.
- "Write Node tests for an `overlapMs(sessionStart, sessionEnd,
  rangeFrom, rangeTo, nowMs)` function returning the overlap of a session
  with a date range in ms, treating a null sessionEnd as nowMs."
  — Used to validate the report maths outside Google Apps Script so bugs
  in overlap handling and overnight gaps could be caught locally.
- "Write a cellSafe(value) that prefixes a leading apostrophe to any
  string whose first non-whitespace/control character is `=`, `+`, `-`,
  `@`, or `|`, and passes numbers, dates and booleans through."
  — Used because an audit flagged that Google Sheets would evaluate a
  name like `=HYPERLINK(...)` as a formula when a manager opens the
  spreadsheet, so untrusted text had to be neutralized at the write
  boundary.
- "Return a JSON-safe literal for injection inside <script>, with angle
  brackets, ampersands and U+2028/9 escaped." — Used to inject the
  per-employee workspace token into the HTML template without relying on
  the token's current character set, so a later change in token
  generation cannot break the escaping.

### Errors found during development

- The initial `sumSessionMs` had the condition
  `if (s.status === 'active' || !s.endTime)`. In practice this
  misclassified every row whose test fixture omitted `endTime` — including
  paused rows that correctly had a `durationMs` — causing `sumSessionMs`
  to return 0 instead of the sum. The Node test
  `sumSessionMs: sums closed durations` surfaced it on the first run
  (`Expected 0 === 6000`). Tightening to `s.status === 'active'` only
  moved the suite from 24/27 to 27/27.
- During the remediation pass the fallback branch in
  `sumSessionMsWithDiagnostics` was unreachable because `Number('')` is
  `0`, which satisfied the "usable number" check. The new
  `sumSessionMs: falls back to endpoints when durationMs missing` Node
  test caught it. Fix: check that the raw value is not empty/null before
  coercing, and only use the coerced number if it is finite and
  non-negative. 45/45 passing after the fix.

(If more defects surface during real deployment they will be appended
here honestly rather than invented.)

## How core scenarios were checked

The scenarios below map 1-to-1 to the original mandatory requirements.
"Node" = exercised by `node tests/run.js` in this environment (45/45
passing on commit `f46809d`). "Apps Script" = covered by a test in
`src/Tests.gs` whose code was reviewed but which requires a Google
Apps Script project to execute. "Manual" = can only be observed in a
deployed app.

- **Adding an employee.** Apps Script: `test_createEmployeeAndLink`
  (employee row + initial task row + workspace token). Node:
  `isValidEmail` and `FIELD_LIMITS` tests gate the inputs.
- **Starting a task with a description.** Apps Script:
  `test_createEmployeeAndLink` (initial task gets the description) and
  `test_assignTask` (replacement task carries a new description).
- **Starting a timer.** Apps Script: `test_startPauseResume` creates a
  session with status `active`; `test_noDuplicateActiveTimer` proves a
  second start throws rather than creating a parallel timer.
- **Stopping / finishing a timer.** Apps Script: `test_startPauseResume`
  (pause closes the row with a frozen duration) and the
  `sessions_finish` branch covered by the task-completion assertions.
- **Restarting a timer (pause → resume).** Apps Script:
  `test_startPauseResume` asserts that resume creates a NEW session row
  (so history is auditable) and that the second row's id differs from
  the first. The second session's duration is independent of the first
  — the sum is additive, not re-based.
- **Persistence after a restart.** Apps Script: `test_reloadRestoresState`
  simulates a fresh read with no in-memory state and verifies the
  active session and task are still found. Node:
  `sumSessionMs: active session uses now - start` proves that the
  elapsed-time calculation is derived from stored timestamps, so a
  server or browser restart cannot lose or duplicate time.
- **Timer across midnight.** Node: `scenario: pre-midnight +
  post-midnight sessions, gap excluded` uses fixtures that straddle
  00:00 UTC and asserts that only the two session intervals (10 min
  total) are counted — the gap crossing midnight is excluded. Apps
  Script: `test_crossDayNoOvernight` runs the same scenario against
  Sheets.
- **Reporting records and totals for a selected period.** Apps Script:
  `test_reportFiltersByRange` creates a today session and a 10-days-ago
  session, requests a yesterday→today report, and asserts the response
  contains only the in-range interval. Node: `overlapMs: partial
  overlap left/right` validates the arithmetic.
- **Empty report behavior.** Apps Script: `test_emptyReport` requests
  today→today on an empty data set and asserts the response is `[]`.
  The manager UI then shows "No activity in the selected period."
  rather than an error (see `src/manager_js.html`'s empty-state
  branch).
- **Duplicate employee email handling.** Apps Script:
  `test_invalidInputsRejected` includes the duplicate-email case and
  asserts the second create throws. The check is race-safe because
  dedup and insert share a `LockService` critical section.
- **Clear, truthful error messages.** Service functions throw
  `UserError(message)` for user-facing failures ("A session is already
  running.", "An employee with this email already exists.", "Date must
  be in YYYY-MM-DD format.", etc.). The API boundary (`safeApi_` in
  `src/Code.gs`) forwards these messages verbatim and replaces any
  other error with "A server error occurred. Check the Apps Script
  execution log." so internal details never leak. Email delivery is
  never silently claimed successful — `api_createEmployee` returns
  `{emailSent: false, emailError: ...}` on failure and the UI surfaces
  it explicitly.

The scenarios marked "Apps Script" have not been executed by the AI
in this environment; they require installing the project into a
Google Apps Script bound/standalone script and selecting `runTests`
in the editor. The Node scenarios were run on commit `f46809d`.

## Files

```
appsscript.json         Apps Script manifest
src/
  Code.gs               doGet, api_*, access gate, safeApi_, jsonForScript_
  Config.gs             Spreadsheet lookup, sheet-name constants, setSpreadsheetId
  Email.gs              Invitation email
  Employees.gs          Create (atomic, locked), assignTask, rotateToken
  Reports.gs            Date-range report (UTC boundaries, strict parse)
  Repository.gs         Row CRUD + cellSafe escaping + throwing updateRow_
  Sessions.gs           start / pause / resume / finish; closeSession_ throws on bad start
  Setup.gs              Idempotent + locked + safe sheet creation
  Tasks.gs              Task CRUD
  Tests.gs              Integration tests, runnable from the editor
  Utils.gs              UUIDs, token_, ISO helpers
  pure.gs               Pure helpers (also exported for Node tests)
  manager.html          Manager console markup
  manager_js.html       Manager console script
  employee.html         Employee workspace markup
  employee_js.html      Employee workspace script
  styles.html           Shared CSS
tests/
  pure.test.js          Node tests for src/pure.gs (45 cases)
  load-pure.js          Loads pure.gs as a CommonJS module
  run.js                Entry point
package.json            `npm test` runs the Node suite
```
