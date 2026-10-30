# Working-Time Tracker

A small, functional web application for tracking employees' working time.
Backend: Google Apps Script. Persistence: Google Sheets. Frontend: plain
HTML, CSS, and vanilla JavaScript served by `HtmlService`.

> **This repository is configured as a public demonstration build.** It is a
> demonstration environment with fictional data, **not** a production
> employee-management system. See [Public demonstration](#public-demonstration).

## Contents

- [Features](#features)
- [Time-tracking rules enforced](#time-tracking-rules-enforced)
- [Public demonstration](#public-demonstration) — URL, configuration, security audit, reset
- [Architecture and data flow](#architecture-and-data-flow)
- [Prerequisites and local setup](#prerequisites-and-local-setup)
- [Running the tests](#running-the-tests)
- [Known limitations](#known-limitations)
- [AI tools and models used](#ai-tools-and-models-used)
- [Defects found and fixed](#defects-found-and-fixed)
- [Files](#files)

## Features

**Manager console** (the base web-app URL; no sign-in)

- View the list of employees with their accumulated time and timer status.
- Create an employee with last/first/middle name, email and an initial task.
  In the demonstration build **no email is sent** (see below).
- Inspect an employee's **Details**: tasks, work sessions, current timer,
  total recorded time, the personal workspace link, **Copy workspace link**
  and **Rotate workspace token** (immediately invalidates the old link).
- Assign a new task to an employee without deleting historical records.
- Generate a report for a date range: per-employee working time, the
  sessions inside the range, and tasks whose creation date falls in it.
  An empty range returns a clear "No activity in the selected period."
- (Demo only) **Load fictional sample data** when the demo has no employees.

**Employee workspace** (`<base URL>?page=employee&token=<token>`, opened from
an employee's Details)

- View the assigned task; **Start**, **Pause**, **Resume**, **Finish**.
- Live elapsed time, restored from the server after a refresh or reopen.
- Full history of work sessions.

## Time-tracking rules enforced

- Elapsed time is computed from timestamps persisted on the server, not from
  a client-side counter. Closing the browser cannot make the timer drift.
- A paused session is closed with a frozen `durationMs`. Resuming creates a
  new session row; every interval is auditable.
- Pauses, overnight gaps and browser downtime are never counted because they
  are not inside any session interval.
- Starting a session while one is running is rejected; the sheet never
  contains two active sessions for the same employee.
- All critical writes take `LockService.getScriptLock()`.
- Employee creation is atomic: if the initial-task insert fails, the
  Employees row is rolled back.
- Assigning a task while a session is running closes that session as
  `paused` against the original task; the old task becomes `replaced`;
  historical sessions are never retargeted or deleted.

## Public demonstration

### Public URL

> **Public Manager URL (deployment `AKfycbzV_EGldUPBy51pOdbVu8Y99O42QVJnsmSKtoqx234oI4qHcuvefSj1FmzAlpqG-jyXWA`, version 1):**
>
> https://script.google.com/macros/s/AKfycbzV_EGldUPBy51pOdbVu8Y99O42QVJnsmSKtoqx234oI4qHcuvefSj1FmzAlpqG-jyXWA/exec

It opens the Manager directly with no Google sign-in. Google shows its
standard banner "This application was created by another user, not by
Google" at the top of every Apps Script web app; that is not under the app's
control. Everyone who opens the URL shares **one** dataset.

Verified on 2026-10-30 with a fresh, signed-out Chrome profile driven over the
DevTools protocol (`tests/live/accept.js`, see [Live verification](#live-verification-of-the-deployed-url)).

### How the employee workflow works in the demo

Email is disabled, so no invitation is sent. Instead:

1. In the Manager, add an employee (fictional name, `@example.com` email,
   initial task) — **Employees → Add employee**.
2. Click **Details** on the new row. The **Workspace link** is shown and can
   be copied (**Copy workspace link**) or opened.
3. Open that link: the employee workspace shows the task and **Start / Pause
   / Resume / Finish**, the elapsed timer and the history.
4. Back in the Manager, **Details** shows tasks and sessions, and **Reports**
   totals them for a date range.

The link is a bearer token: whoever holds it can use that workspace, and it
says nothing about who the person really is. In a production setup the same
link would be emailed (see Known limitations), and **Rotate workspace token**
revokes a leaked link.

### Redeploying / updating the demo safely

```bash
npm test                                    # all local suites must pass
bash ./scripts/setup-apps-script.sh         # pushes src/ to the dedicated test project
clasp create-deployment --description "..." # new immutable version + new /exec URL
# or, to keep the same URL: clasp update-deployment <deploymentId> (see `clasp redeploy --help`)
SHEET_ID=<demo sheet id> node tests/live/accept.js <exec url>   # live acceptance run
```

Never point `.clasp.json` or `SPREADSHEET_ID` at any other spreadsheet. To
restore the known initial data run `resetDemoData` (below). Do **not** run
`enableOpenAccess()`: the demo build does not use it.

### What the demonstration environment is

| Aspect | Setting |
| --- | --- |
| Web app | One Apps Script web app, *Execute as: Me*, *Access: Anyone* (anonymous). No Google sign-in; opens directly on the Manager page. |
| Data | One dedicated Google Sheet (`Working Time Tracker — Test Env`) with `Employees`, `Tasks`, `WorkSessions`. Fictional data only. |
| Isolation | The sheet is pinned by the `SPREADSHEET_ID` Script Property (set by the owner, never by a client). The app **refuses to start** unless that sheet's title contains the word *test* or *demo* (`DEMO_CONFIG` + `isDemoEnvironmentName`). |
| Email | Hard-disabled: no code path sends mail in demo mode, and the `script.send_mail` OAuth scope was removed from the manifest. |
| Write caps | 100 employees, 500 tasks, 3000 sessions (`DEMO_CONFIG.LIMITS`). Beyond that the UI says "Demo limit reached…". |
| OAuth scopes | `spreadsheets`, `script.scriptapp` (only to learn the web-app URL). |
| Persistence | Everything lives in the sheet; refreshes and reopening the URL keep all data. |

### Security audit of the public surface

The app has no login by design. Because the web app *executes as its owner*,
whatever an anonymous visitor can call runs with the owner's permissions.
The audit therefore enumerated everything an anonymous caller can reach.

**Key finding.** `google.script.run` can call **every top-level function
whose name does not end in `_`**, not only the `api_*` functions the UI uses.
The earlier `ACCESS_MODE` gate protected only `api_*`; a visitor could open
the browser console and call, for example, `employees_list()` (returns every
employee's email and workspace token), `email_sendInvitation(...)` (send mail
to any address as the owner), `setSpreadsheetId(...)` (point the app at a
different spreadsheet of the owner), `enableOpenAccess()` or `runTests()`.

| ID | Risk | Fix |
| --- | --- | --- |
| F-19 | Every non-underscore function publicly callable; the access gate was bypassable | About 50 internal functions (including the integration-test functions) renamed with a trailing `_` (private). The only public functions are now `doGet`, 12 `api_*` functions, the side-effect-free helpers in `pure.gs`, and four owner-only admin functions. `tests/surface.test.js` fails if a new public function appears, an `api_*` loses `safeApi_`/`requireOpenAccess_`, an admin function loses its guard, or the client calls anything but `api_*`. |
| F-20 | `api_createEmployee` mailed an arbitrary, client-supplied address as the owner (spam relay) | Mail is skipped in demo mode, `email_sendInvitation_` throws before `MailApp` in demo mode, and the `script.send_mail` scope is removed from `appsscript.json`. |
| F-21 | Public admin functions (`runTests`, `enableOpenAccess`, `disableOpenAccess`, `resetDemoData`; `setSpreadsheetId` was **removed**, it could not even be run with an argument from the editor and was only attack surface) | Each begins with `adminOnly_('<its own name>')`, which refuses unless the owner added Script Property `ADMIN_MODE=<that function's name>`. The check and the deletion of the property happen atomically under the script lock, before the operation starts, so a failed run does not stay armed and two callers cannot both consume it. Arming one function cannot unlock another. Visitors cannot create Script Properties. `getAccessMode`/`getConfiguredSpreadsheetId` made private (the latter leaked the sheet id). For a standalone project set Script Property `SPREADSHEET_ID` in Project Settings. |
| F-25 | `doGet` created sheets in whatever spreadsheet was bound **before** checking the demo guard, and echoed raw setup error text to visitors | Access check now runs first; setup failures are logged and visitors see a fixed message. |
| F-22 | Anonymous audience could fill the spreadsheet | Row caps in `appendRow_` for the three app sheets (demo only). |
| F-23 | Running as the owner with the `spreadsheets` scope is broader than one workbook | Mitigated in code, not removed: the only spreadsheet ever opened is the pinned id; no client-supplied sheet/ctx/id reaches a service call (checked by the surface test); the title check fails closed. The narrower `spreadsheets.currentonly` scope was **not adopted** because it was not verified to work with `openById` in a web-app context. |
| F-24 | Validation failures (over-long fields, bad report dates) were shown as a generic "server error" | `validateLength` and `parseYmdStrictUtc` now throw `UserError`, so the message is shown verbatim. |

Other properties reviewed and left unchanged: cell formula injection is
neutralized by `cellSafe` at the write boundary; HTML output is escaped on the
client (`esc`) and server (`escapeHtml_`, `jsonForScript_`); non-user errors
are replaced by a generic message by `safeApi_` and logged server-side only;
no credential, token or key exists in client assets or the repository (the
OAuth tokens live in `~/.clasprc.json`, outside the repo).

### Reset procedure

`resetDemoData()` restores the known initial state. It:

- operates on exactly `Employees`, `Tasks`, `WorkSessions` of the pinned
  spreadsheet (it clears their data rows, never deletes a sheet, and never
  touches any other sheet or spreadsheet);
- refuses unless the spreadsheet title contains *test* or *demo*;
- re-seeds two fictional employees (`@example.com` addresses) with task
  history and past sessions, so reports have content immediately;
- is **not** callable by visitors: it requires the owner to add Script Property
  `ADMIN_MODE=resetDemoData` first (Project Settings → Script properties),
  and consumes it.

Steps: add `ADMIN_MODE` = `resetDemoData` → select `resetDemoData` → Run → check the log
line `resetDemoData: restored 2 employees, 4 tasks, 8 sessions.`

Visitors have a separate, **non-destructive** helper: on an empty demo the
Manager page offers *Load fictional sample data* (`api_loadDemoSample`), which
only appends and refuses if any employee exists.

There is deliberately no scheduled auto-reset, because it would wipe a
reviewer's data and contradict the persistence requirement.

### Architecture decision: why Apps Script is kept

A separately hosted app with a dedicated database was considered and **not**
adopted: the audit found the exposure was in the *callable surface*, which is
fixable in place without changing the data model, UI or hosting. Remaining
exposure (owner-executed anonymous web app; Apps Script quotas) is documented
under [Known limitations](#known-limitations). If those limits are
unacceptable, the escape hatch is a hosted app + managed database; that
would be a separate, documented migration.

### Live verification of the deployed URL

`tests/live/accept.js` drives a fresh, signed-out headless Chrome profile over
the DevTools protocol (no extension, no cookies, no Google session) against the
deployed `/exec` URL and prints PASS/FAIL per check. Final run on 2026-10-30:
**29/30 checks passed**; the one failure (F8) was only because that check uses
a fixed email that an earlier run of the same script had already created
("An employee with this email already exists"). F8 passed on the previous run
(27/30 then, with the other three failures being wrong expectations in the
script that were corrected, not app defects).

| Scenario | Result |
| --- | --- |
| A Manager opens at the URL with no Google sign-in (final page is the app, not `accounts.google.com`); demo banner shown | **PASS** (A1, A2) |
| B Create a fictional employee, it appears in the list, initial task shown in Details, copyable employee workspace link present, second task assigned and first kept as `replaced` history | **PASS** (B1–B5) |
| C Employee workspace opens anonymously; Start; elapsed time increases; Pause stops it (identical readings 3.5 s apart); Resume adds a new session row; a second start is rejected ("A session is already running."); Finish ends the task | **PASS** (C1–C9) |
| D Refresh while a timer runs restores the running timer (7 s → 14–17 s, not reset); reopening the URL keeps the employee | **PASS** (D1, D2) |
| E Manager Details list both tasks and the paused + completed sessions; report totals the sessions; an empty range (2000-01-01..02) shows "No activity in the selected period." | **PASS** (E1–E3) |
| F1 20 internal functions (`employees_list_`, `email_sendInvitation_`, `setupSheets_`, `getSpreadsheet_`, `setSpreadsheetId`, …) are **not exposed** by `google.script.run` to the client | **PASS** |
| F2 `runTests`, `resetDemoData`, `enableOpenAccess`, `disableOpenAccess` called anonymously are refused ("not armed") | **PASS** |
| F3 spreadsheet id appears in no page, frame or API response | **PASS** |
| F4 employee list carries no workspace token; F5 odd identifiers refused with a plain message; F6/F7 an employee id used as a token is refused ("Invalid workspace link") for state and for starting a timer | **PASS** |
| F8 formula-looking input (`=HYPERLINK(...)`) stored as text and returned unchanged | **PASS** on the earlier run; the final run could not repeat it (duplicate email, see above) |
| F9 over-long name shows "Last name is too long (max 100 characters)." | **PASS** |
| Email | No invitation is sent: the UI reports "Demo mode: no email is sent", the code path is guarded, and the `send_mail` scope is not in the manifest. **No mail delivery was ever attempted or tested.** |

**Not verified:** behaviour in Safari/Firefox or on a physical phone; behaviour
under concurrent anonymous load or quota exhaustion; the Google "created by
another user" banner in other locales; that an unauthenticated raw HTTP client
(not using the page's `google.script.run`) is refused for private functions
(this relies on Google's documented behaviour that names ending in `_` are
private). Test artifacts left in the shared demo data: several fictional
`Verifier Demo Q` employees (`demo.verifier.<timestamp>@example.com`) and one
`inj.verifier@example.com` formula-text employee. They are harmless and are
removed by `resetDemoData` (owner-armed).

## Architecture and data flow

```
Browser (manager.html / employee.html)
  |  google.script.run.<api_*>(args)   (only api_* is callable; see F-19)
  v
Code.gs  (doGet, api_*, safeApi_, access gate, jsonForScript_)
  |  service layer (writes under LockService; UserError for safe messages)
  v
Employees_ / Tasks_ / Sessions_ / Reports_ / Demo (all *_ private functions)
  |  read/write via
  v
Repository.gs  (generic row CRUD + cellSafe formula escaping + demo row caps)
  |
  v
Google Sheets: Employees / Tasks / WorkSessions
```

Pure, side-effect-free helpers live in `src/pure.gs` (`overlapMs`,
`sumSessionMs`, `isValidEmail`, `sanitize`, `nextStateAfter`, `cellSafe`,
`validateLength`, `parseYmdStrictUtc`, `UserError`, `isDemoEnvironmentName`,
`checkRowLimit`, `buildDemoSample`, `FIELD_LIMITS`) and are tested from
Node.js. They perform no service calls, so exposing them is harmless.

### Data model (Google Sheets)

Three sheets are created automatically on first load. Rows carry stable
UUIDs; row numbers are never identifiers.

**Employees** `id | lastName | firstName | middleName | email | workspaceToken | createdAt | active`

**Tasks** `id | employeeId | title | status | createdAt | completedAt`
(`status` ∈ `active | completed | replaced`)

**WorkSessions** `id | employeeId | taskId | startTime | endTime | durationMs | status`
(`status` ∈ `active | paused | completed`; `durationMs` frozen when closed)

`ensureSheet_` refuses to rewrite a blank header row when data rows exist.

### Input handling

- Strings written to cells pass through `cellSafe` (prefix `'` for `=`, `+`,
  `-`, `@`, `|`).
- Length limits (server-side): names 100, email 320, task title 500.
- Report dates must be strict `YYYY-MM-DD` valid calendar dates, interpreted
  at UTC day boundaries (`timeZone` is `Etc/UTC`).
- Validation errors are `UserError`s and reach the UI verbatim; anything else
  is replaced by "A server error occurred…".

## Prerequisites and local setup

- Node.js 18+ (the Node tests; the repo was exercised with Node 24).
- A Google account, a dedicated **test** spreadsheet whose title contains
  "test" or "demo", and `@google/clasp`:
  ```bash
  npm install -g @google/clasp
  ```
- Enable the Apps Script API at https://script.google.com/home/usersettings
  and run `clasp login`.
- On Windows run the script from **Git Bash** (it is a `.sh` file).

Create (first run) or refresh the Apps Script project and upload every
`src/*.gs` / `src/*.html` plus the manifest:

```bash
SHEET_ID=<id of your test spreadsheet> bash ./scripts/setup-apps-script.sh
```

Later runs can omit `SHEET_ID` (`.clasp.json`, gitignored, remembers the
project). The script never deploys, never calls `enableOpenAccess()`, never
sends email. It stages `appsscript.json` **after** `clasp create` (which would
otherwise overwrite it with the default manifest).

Manual fallback: files in `src/` map 1-to-1 to files in the Apps Script
project; paste `appsscript.json` into the manifest.

The container-bound project learns its spreadsheet from the container. For a
standalone project, add Script Property `SPREADSHEET_ID` in Project
Settings (there is deliberately no callable function that sets it).

## Running the tests

**Node (no Google credentials):**

```bash
npm test          # same as: node tests/run.js
```

Runs `tests/pure.test.js` (55 cases: overlap maths, duration summing,
state transitions, validation, strict dates, `cellSafe`, `UserError`, demo
helpers, and the demo sample's invariants) and `tests/surface.test.js`
(17 cases: every `.gs` file parses; the public function allowlist; `api_*`
gating; owner-only guards bound to their own name and consumed atomically
under the lock; no function can set a spreadsheet id or Script Property;
no callable non-declaration globals; `doGet` checks access before touching
the sheet and never echoes error text; ids/URLs only read where intended;
client only calls `api_*`; the single `MailApp` call is behind the demo
hard stop; the manifest has no mail scope).

**Apps Script integration suite** (needs a real spreadsheet):
Script Properties → add `ADMIN_MODE=runTests` → select `runTests` → Run → View →
Logs. 28 tests, writing only to `Test_Employees`, `Test_Tasks`,
`Test_WorkSessions` (plus short-lived `Test_Canary`/`Test_BlankHeaders`).
`runTests` is owner-armed because it is publicly callable.

What it covers: the 20 original tests (employee + link, assign task, start/
pause/resume, midnight crossing, summing, state restore, duplicate timer,
task change preserves history, range filter, empty report, input
validation, pause with no session, formula injection, `updateRow_` throws,
`closeSession_` rejects bad start, token rotation, length limits, strict
dates, duration fallback, header-overwrite refusal) plus 8 added for the
demo: reset touches only the target sheets; sample loads only into an empty
demo; sample report totals equal stored session durations and an empty range
is empty; a task change keeps all history; email is hard-disabled; admin
functions refuse while disarmed or armed for a different function; arming
is consumed on use; validation messages are user-safe.

### Test results (exact counts)

| Suite | Result | Where it was run |
| --- | --- | --- |
| Node `tests/pure.test.js` | **55/55 passed** | this repository, locally |
| Node `tests/surface.test.js` | **17/17 passed** | this repository, locally |
| Node `tests/gas-sim.test.js` — the real `src/*.gs` (including all 28 `runTests` tests) run against an in-memory **simulation** of Sheets/Properties/Lock | **22/22 passed**; the simulated `runTests` reported 28/28 | this repository, locally. **A simulation, not Apps Script**: no real quotas, lock contention, Sheets coercion or `google.script.run` rules |
| Apps Script integration `runTests`, current 28 tests | **28/28 passed** — reported by the project owner after running it in the real editor (armed with `ADMIN_MODE=runTests`). **Not executed by the AI**; the log was not shown to the AI. | owner's Apps Script editor |
| Live acceptance `tests/live/accept.js` against the deployed `/exec` URL (signed-out headless Chrome) | **29/30 checks passed** (see above) | this machine, against the real deployment |

Earlier 20/20 and the simulation are not substitutes for the real run; the real run is the 28/28 line.

## Known limitations

- **No authentication, by design.** Anyone with the URL is a manager and can
  read, change or delete everything in the demo sheet, including every
  workspace token. Use fictional data only.
- **Runs as the owner.** The deployment executes with the owner's permissions
  (scopes `spreadsheets`, `script.scriptapp`). Isolation relies on the code
  pinning one spreadsheet and exposing a tiny audited surface; a future code
  defect would run with those permissions. Do not deploy this under an
  account whose other spreadsheets matter if that residual risk is
  unacceptable — use a dedicated Google account for the demo.
- **Quotas.** Anonymous traffic consumes the owner's Apps Script quotas; a
  heavy visitor can exhaust them and make the demo unavailable.
- **Admin arming is one-shot but not authenticated.** Between the owner adding
  `ADMIN_MODE=<function>` and running it, a visitor could in principle call
  that same function first (only that one: the value is bound to it). The effect is what the owner wanted to run anyway, and
  only against the pinned demo data.
- **Workspace links are bearer tokens** (rotatable in Details).
- **No pagination**; sized for the row caps above.
- **UTC day boundaries** in reports.
- **No audit trail of who changed what.**
- **Non-demo use.** Set `DEMO_CONFIG.ENABLED = false` to fall back to the
  `ACCESS_MODE` gate (arm `ADMIN_MODE`, run `enableOpenAccess`) and re-add the
  `script.send_mail` scope to the manifest to restore invitation emails.
  That configuration is **not** what this demo ships and was not retested.

## AI tools and models used

Based on the repository's own records (git history and earlier README text):

- **Claude Code with Claude Opus 4.7** — recorded in the `Co-Authored-By`
  trailer of commits `36a4cff` (initial application), `f46809d` (security
  and data-integrity remediation), `b2a2ed3` (README) and `0d737a7` (setup
  script); those commits also carry a `Claude-Session` link.
- **Claude Code with Claude Sonnet 5.5** — recorded in the trailer of commit
  `b44f304` (setup-script fixes); also used for the public-demo audit and
  changes described in this README (those changes are uncommitted until the
  owner commits them).
- No other AI tools are recorded. Chat transcripts of the earlier sessions are
  not part of the repository.

### Representative prompts

Earlier prompts are the ones documented previously in this README; the
Sonnet 5.5 prompts are taken from this work session. Anything not listed here
is **not available** in the repository.

- "Design the Google Sheets data model for an employee time tracker where
  pause creates an auditable interval and resume opens a new one." — fixed
  the session-row shape so durations never need retroactive edits.
- "Write a Google Apps Script `doGet` that serves two HTML templates (manager
  and employee)…" — one deployment, one base URL, readable error page.
- "Add a `LockService.getScriptLock()` wrapper around start/pause/resume/
  finish so two concurrent requests cannot create a duplicate active
  session." — made "one active session per employee" an invariant.
- "Write Node tests for an `overlapMs(...)` function…" — validated report
  maths outside Apps Script.
- "Write a cellSafe(value) that prefixes a leading apostrophe…" — closed the
  spreadsheet formula-injection hole.
- "Return a JSON-safe literal for injection inside <script>…" — safe
  templating of the workspace token.
- "Continue the existing project locally on this Windows computer … run the
  existing setup script with `SHEET_ID` … report actual test results."
  — drove the clasp setup, which exposed the two setup-script defects below.
- "Prepare Working-Time-Tracker for public, unauthenticated demonstration …
  review every publicly callable server-side function … do not call
  `enableOpenAccess()` … propose an isolated alternative only if the
  architecture cannot be made safe." — drove the audit F-19…F-24, the demo
  mode, the reset procedure and `tests/surface.test.js`.

## Defects found and fixed

Evidence = an actual test or an observed command result.

1. **`sumSessionMs` misclassified closed rows** (`status === 'active' ||
   !s.endTime`) and returned 0; found by the Node test `sums closed
   durations` (`Expected 0 === 6000`); fixed by testing only
   `status === 'active'`.
2. **Unreachable duration fallback**: `Number('')` is `0`, so a missing
   `durationMs` never fell back to the timestamps; found by the Node test
   `falls back to endpoints when durationMs missing`; fixed by checking the raw
   value first. (Suite then 45/45.)
3. **`setup-apps-script.sh` login check failed on clasp 3.4.1** because
   `clasp login --status` no longer exists; observed as
   `error: unknown option '--status'`; fixed with `clasp show-authorized-user`
   (commit `b44f304`).
4. **`setup-apps-script.sh` lost the manifest on first run**: `clasp create`
   overwrites the staged `src/appsscript.json` with the default, so the first
   push uploaded `America/New_York` and no scopes/webapp block; found by
   cloning the remote project and diffing; fixed by staging after `create`
   (commit `b44f304`).
5. **Public-surface exposure (F-19…F-23)** found by code audit — see the
   table above; guarded by `tests/surface.test.js`.
6. **Validation errors shown as "server error" (F-24)**: found by reading
   `safeApi_` against `validateLength`/`parseYmdStrictUtc`; fixed and covered
   by Node tests (`failure is a user-safe error`, `every rejection is
   user-safe`) and the integration test
   `test_validationMessagesAreUserSafe_`.

The live acceptance run against the deployment found no application defect. Three of its checks first failed because of wrong expectations in the script itself (error text carries an `Error:` prefix; the browser rejects a function-valued argument before it reaches the server); those expectations were corrected, not the app.

## Files

```
appsscript.json         Manifest (scopes: spreadsheets, script.scriptapp; web app: anyone, run as owner)
scripts/
  setup-apps-script.sh  clasp create/push (run with Git Bash on Windows)
src/
  Code.gs               doGet, api_*, access gate, safeApi_, jsonForScript_
  Config.gs             DEFAULT_CONFIG, DEMO_CONFIG, spreadsheet lookup
  Demo.gs               adminOnly_, demo environment check, row caps, sample data, resetDemoData
  Email.gs              Invitation email (hard-disabled in the demo build)
  Employees.gs          Create (atomic, locked), assignTask, rotateToken
  Reports.gs            Date-range report (UTC boundaries, strict parse)
  Repository.gs         Row CRUD + cellSafe + throwing updateRow_ + demo row caps
  Sessions.gs           start / pause / resume / finish
  Setup.gs              Idempotent, locked sheet creation
  Tasks.gs              Task CRUD
  Tests.gs              Integration tests (runTests, owner-armed)
  Utils.gs              UUIDs, token_, ISO helpers
  pure.gs               Pure helpers (also loaded by the Node tests)
  manager.html, manager_js.html, employee.html, employee_js.html, styles.html
tests/
  pure.test.js          Node tests for src/pure.gs (55 cases)
  surface.test.js       Node static guards for the public surface (17 cases)
  gas-sim.js            In-memory simulation of the Apps Script services used
  gas-sim.test.js       Runs the real .gs files (incl. runTests) against the simulation (22 cases)
  load-pure.js, run.js  Loader and entry point
  live/cdp.js           Dependency-free DevTools-protocol driver (fresh signed-out Chrome)
  live/accept.js        Live acceptance run against a deployed /exec URL (needs SHEET_ID env + the URL)
package.json            `npm test`
```
