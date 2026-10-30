# Working-Time Tracker

A web application for tracking employees' working time, in Russian and English.
Backend: Google Apps Script. Persistence: Google Sheets. Frontend: plain HTML,
CSS and vanilla JavaScript served by `HtmlService`.

> **This repository ships a public demonstration build.** It is a demonstration
> with fictional data, **not** a production employee-management system. Anyone
> with the URL is a manager and shares one dataset. See
> [Public demonstration](#public-demonstration) and [Security model](#security-model).

## Contents

- [Features](#features)
- [Time-tracking rules enforced](#time-tracking-rules-enforced)
- [Public demonstration](#public-demonstration) — URL, workflows, configuration, deployment
- [Email invitations](#email-invitations)
- [Languages](#languages-russian-and-english)
- [Dashboard, analytics, CSV export, search](#dashboard-analytics-csv-export-search)
- [Security model](#security-model)
- [Demo data: reset and cleanup](#demo-data-reset-and-cleanup)
- [Architecture](#architecture-and-data-flow)
- [Prerequisites and local setup](#prerequisites-and-local-setup)
- [Running the tests](#running-the-tests) — results by environment
- [Live verification](#live-verification-of-the-deployed-url)
- [Known limitations](#known-limitations)
- [AI tools and models used](#ai-tools-and-models-used)
- [Defects found and fixed](#defects-found-and-fixed)
- [Files](#files)

## Features

**Manager console** (the base URL; no sign-in; language selector in the header)

- **Dashboard:** total employees, employees working now, on pause, active and
  completed tasks, tracked time for the selected period, a per-day chart (with a
  table equivalent) and tracked time per employee. All figures are computed from
  the stored sessions with the same rules as the reports.
- **Employees:** create an employee (last/first/middle name, email, initial task,
  optional invitation email); search by name or email and filter by work status
  (working / on pause / not started) without extra server requests; per-employee
  *Details* with the copyable workspace link, invitation status with
  *send / retry*, rotate link, assign a new task, and the full task history with
  the sessions and time of every task.
- **Reports:** date-range report per employee (optionally for one employee),
  sessions in range, tasks created in range, clear empty state, and
  **Export CSV** of exactly the selected report.

**Employee workspace** (`<base URL>?page=employee&token=<token>`, opened from the
employee's Details or from the invitation email): current task, **Start / Pause /
Resume / Finish**, live elapsed time restored from the server after a refresh,
full session history, language selector. It cannot open the Manager console.

## Time-tracking rules enforced

- Elapsed time comes from timestamps stored on the server, not a browser counter.
- A pause closes the session with a frozen `durationMs`; resuming opens a new
  session row, so every interval is auditable.
- Pauses, overnight gaps and browser downtime are never counted (they are not
  inside any session interval).
- Starting while a session is running is rejected: never two active sessions per employee.
- All critical writes run under `LockService.getScriptLock()`.
- Employee creation is atomic (rolled back if the initial task cannot be saved);
  a failed invitation never rolls the employee back.
- Assigning a task closes a running session as `paused` against the old task,
  marks that task `replaced` and opens a new one; history is never retargeted or deleted.
- Dates are UTC calendar days everywhere (reports, dashboard, chart, CSV, and all
  displayed timestamps carry `UTC`).

## Public demonstration

> **Public Manager URL** (deployment `AKfycbzV_EGldUPBy51pOdbVu8Y99O42QVJnsmSKtoqx234oI4qHcuvefSj1FmzAlpqG-jyXWA`, currently **version 4**):
>
> https://script.google.com/macros/s/AKfycbzV_EGldUPBy51pOdbVu8Y99O42QVJnsmSKtoqx234oI4qHcuvefSj1FmzAlpqG-jyXWA/exec

It opens the Manager with no Google sign-in. Google adds its own banner
("created by another user, not by Google") to every Apps Script web app; the app
cannot remove it. All reviewers share one dataset, so other reviewers' records
will be visible and any record can be changed by anyone.

### Workflows

*Manager:* **Employees → Add employee** (fictional data) → the employee appears in
the list → **Details** → copy or open the workspace link (works independently of
email) → optionally **Send invitation** → assign tasks → watch **Dashboard** and
**Reports** → **Export CSV**.

*Employee:* open the link → **Start** → **Pause** → **Resume** → **Finish task**.
Refreshing the page keeps the running timer.

### Configuration of the demonstration

| Aspect | Setting |
| --- | --- |
| Web app | One Apps Script web app, *Execute as: Me*, *Access: Anyone* (anonymous). |
| Data | One dedicated Google Sheet (`Working Time Tracker — Test Env`): `Employees`, `Tasks`, `WorkSessions`, `Invitations`. |
| Isolation | The sheet is pinned by the `SPREADSHEET_ID` Script Property (set by the owner, never by a client). The app **refuses to start** unless the sheet's title contains *test* or *demo*. |
| Email | Invitations via `MailApp`, capped and logged — see [Email invitations](#email-invitations). |
| Write caps | 100 employees, 500 tasks, 3000 sessions, 1000 invitation log rows. |
| OAuth scopes | `spreadsheets`, `script.send_mail` (send-only), `script.scriptapp` (to learn the web-app URL). |

### Redeploying / updating safely

```bash
npm test                                     # all local suites must pass
bash ./scripts/setup-apps-script.sh          # push src/ to the dedicated project (Git Bash on Windows)
clasp create-version "description"           # immutable version
clasp create-deployment -V <n> -d "probe"    # optional: throw-away URL to test the version first
clasp update-deployment <deploymentId> -V <n> # point the public deployment at it (same URL)
SHEET_ID=<demo sheet id> node tests/live/accept.js <exec url>   # live acceptance run
clasp undeploy <probe deployment id>         # remove the throw-away deployment
```

Never point `.clasp.json` or `SPREADSHEET_ID` at another spreadsheet, and never
run `enableOpenAccess()` (the demo build does not use it).
Version history: 1 initial demo · 2 ru/en, dashboard, CSV, invitations · 3 language kept in the URL · **4 responsive tables (current)**.

## Email invitations

When a manager creates an employee with *Send an invitation email* ticked (or
presses *Send / Retry invitation* in Details), the app sends **one plain-text
email** to the entered address containing the employee's own workspace link, in
the language selected by the manager (Russian or English). The employee record is
saved first and is never rolled back by a delivery problem.

What the Manager shows (each state is localized): *Accepted for delivery* ·
*Failed* (retry available) · *Not authorized* (owner has not approved the mail
permission) · *Skipped (example address)* · *Daily limit reached* · *Recipient
limit reached* · *Disabled* · *Not requested*. "Accepted for delivery" means
Google's mail service accepted the message; it is **not** a delivery receipt.

Safeguards, because the web app runs as its owner and anyone can type any address:

- Reserved/documentation addresses (`example.com/.org/.net` and subdomains, `.test`, `.invalid`, `.localhost`, `.example`) are never mailed. All sample data uses them.
- Global cap **20 invitations/day** and **2 per recipient/day** (`DEMO_CONFIG.EMAIL`), checked and reserved under the script lock before sending.
- Fixed text; only the first name (≤ 60 chars) and the task title (≤ 120 chars) are user text, flattened to a single line (no header/line injection) and sent as plain text (no HTML).
- Every attempt is logged in the `Invitations` sheet as a hashed recipient + status + sanitized error text — never the link or token.
- Kill switch: Script Property `EMAIL_DISABLED=true` stops all sending immediately (or set `DEMO_CONFIG.EMAIL.ENABLED = false` and redeploy).
- Only `MailApp` is used (send-only); no Gmail/Drive scope, no external email provider.

**Delivery has not been tested against a real mailbox.** The mail permission is
approved for this deployment (the capability probe `MailApp.getRemainingDailyQuota()`
returned a remaining quota of 100 from the deployed app, and the Manager shows
"Invitation emails are available"), and the whole send path — link, language,
caps, retry, failure handling — is covered by tests that replace the mail
service with a recording double. No test sent a message to a real address,
because no test address was authorized. To check real delivery, create an
employee with **your own** address in the demo with the option ticked and look
for the message (spam folder included).

## Languages (Russian and English)

A selector in the header of the Manager and of the employee workspace.
Everything is translated: navigation, forms, buttons, tables, status badges,
dashboard, reports, CSV headers and status names, success/validation/server
messages, the confirm dialog, the invitation email and the date labels.
Employee names, email addresses and task titles are user data and are never translated.

- **Resolution order:** the user's saved choice → the `?lang=` of the opened link → the browser language → English.
- **Persistence:** saved in the browser (`localStorage`) and mirrored in the page URL (`?lang=`), so it survives reloads even where storage is blocked.
- **One implementation:** `src/i18n.gs` holds both dictionaries, the resolution rule, the server error-code table and the email/CSV texts; the pages receive them through the template. Server errors travel as `@@code@@{params}@@English` and are translated in the browser, so business logic is not duplicated per language.
- **Coverage is tested:** same keys and placeholders in both languages, every key the HTML/JS uses exists, every server `UserError` has a translation, no hard-coded visible text, and the live run checks that no English interface text remains in Russian mode.

## Dashboard, analytics, CSV export, search

- **Dashboard totals agree with the reports:** both use the same session-overlap rule (`overlapMs`); the per-day buckets partition the period exactly, so the daily values always sum to the report total (tested in Node, in the simulation, and live).
- **Unfinished sessions** count up to "now" as in reports; paused/finished ones use their frozen duration; pauses and gaps are not counted. A zero-length session contributes nothing.
- **Work status** per employee: *working* (a timer is running), *on pause* (the active task's latest closed session ended as paused), *not started* otherwise.
- **CSV:** built on the server from the same report rows, filtered by the selected dates and employee; columns: employee, email, task, date, start, end (all **UTC**), duration `hh:mm:ss` and seconds, status (localized). UTF-8 with BOM and CRLF lines so Excel opens Cyrillic correctly; every text cell is quoted, and any cell whose first meaningful character is `= + - @ |` (also after whitespace/zero-width characters or a tab/CR) is prefixed with `'`. If the browser blocks the download, a text box with the CSV appears.
- **Search/filter:** done in the browser on the already loaded list (name parts and email, case-insensitive, Cyrillic included; all words must match); no request is sent while typing.
- Periods are limited to 366 days.

## Security model

The app has **no login by design**: the Manager URL is public and shared. The web
app executes as its owner, so what an anonymous caller can do is exactly what the
public code allows. The audit therefore covers every function an anonymous caller
can reach. Key fact: `google.script.run` can call **every top-level function whose
name does not end in `_`**.

**Public surface (enforced by `tests/surface.test.js`):** `doGet`; 16 `api_*`
functions (each wrapped in `safeApi_` and gated by `requireOpenAccess_`, none
takes a sheet/spreadsheet/context argument); the side-effect-free helpers in
`pure.gs`/`i18n.gs` (no service calls); and five owner-only functions
(`runTests`, `resetDemoData`, `cleanupTestArtifacts`, `enableOpenAccess`,
`disableOpenAccess`) that refuse unless the owner has armed **that function** by
adding Script Property `ADMIN_MODE=<function name>`; the check-and-consume is
atomic under the script lock and happens before the operation starts.
The other 120 functions end in `_` and are not exposed to the client (verified
live by calling 21 of them from the deployed page: none is callable).

| ID | Finding | Resolution |
| --- | --- | --- |
| F-19 | Every non-underscore function callable by anonymous visitors; the old access gate was bypassable | Internals renamed with a trailing `_`; public surface pinned by a test |
| F-20 | Anonymous visitors could make the owner mail arbitrary addresses | Email now sits behind reserved-domain skip, daily/recipient caps, kill switch, plain-text fixed template, send-only scope (see above) |
| F-21 | Public admin functions (`runTests`, `enableOpenAccess`, …; `setSpreadsheetId` removed) | `adminOnly_` with function-bound, lock-protected, consume-before-run arming |
| F-22 | Anonymous growth of the spreadsheet | Row caps on all four app sheets |
| F-23 | Owner scope `spreadsheets` is broader than one workbook | Mitigated: one pinned id, never client-supplied, title check fails closed, no function returns the id (checked live) |
| F-24 | Validation errors shown as "server error" | `UserError` + translated codes |
| F-25 | `doGet` touched the sheet before the access check and echoed setup errors | Access first; fixed message |
| F-26 | Client built HTML from data (escaped, but a sink) | All DOM is built with `textContent`; a test bans `innerHTML`/`insertAdjacentHTML`/`eval` in client code; live check: a name containing `<img onerror>` is shown as text and never runs |
| F-27 | CSV export is a formula-injection vector | `csvCell` neutralisation incl. whitespace/zero-width/tab/CR variants; live check on the downloaded file |
| F-28 | Invitation log could hold secrets | Only hashed recipient, status and a sanitized, link/token-stripped error text are stored; tests assert the token never appears |

**Manager vs employee boundary.** An employee link carries a 40-hex (160-bit)
random token that identifies **one workspace**. Possession of the link grants that
workspace — it is not proof of who the person is, and it can be rotated. The
workspace page renders no Manager UI, employee APIs accept only a token (an
employee id is refused), and manager APIs take employee ids (a token is refused);
both verified live. **However, because the demo's Manager APIs are
unauthenticated, any anonymous visitor — including someone holding an employee
link — can call them directly.** The workspace does not *grant* Manager access,
but nothing in this demo *prevents* it. A real deployment must add authentication.

Shared-data risks (all accepted for a demo): anyone can read or change every
record, including every workspace link; anonymous traffic consumes the owner's
Apps Script and mail quotas; the app runs with the owner's permissions.

## Demo data: reset and cleanup

Both are owner-only (function-bound `ADMIN_MODE`, see above), act only on the
pinned demo spreadsheet, refuse if its title does not contain *test*/*demo*, and
are never exposed to visitors. There is no automatic reset (it would wipe
reviewers' data).

- **`resetDemoData`** — clears and re-seeds exactly `Employees`, `Tasks`, `WorkSessions`, `Invitations` with two fictional employees (`@example.com`). *Destructive for all demo data.*
- **`cleanupTestArtifacts`** — removes **only** the fictional records created by this project's own acceptance runs: emails matching `demo.verifier.<digits>@example.com` or exactly `inj.verifier@example.com`, plus their tasks, sessions and invitation rows. Every other employee is untouched (tested, including near-miss addresses).

To run one: Project Settings → Script properties → add `ADMIN_MODE` = the function's
name → select the function in the editor → Run → read the log.

**Origin of the repeated `Verifier Demo Q` records and the formula-looking
`=HYPERLINK(...)` record:** they were created by `tests/live/accept.js` and its
predecessor, the project's own live acceptance runs against the deployed demo (one
`Verifier Demo Q` employee per run; `inj.verifier@example.com` was the
formula-injection check). Both are displayed as plain text; nothing is executed.
They have **not** been removed because removal requires the owner to arm
`cleanupTestArtifacts`. The record *Иванов Иван Иванович* is **not** from these
tests (it was entered by someone using the public demo) and was left untouched.

## Architecture and data flow

```
Browser (manager.html / employee.html + i18n_js.html)
  |  google.script.run.<api_*>(args)           (only api_* is callable; see Security model)
  v
Code.gs  (doGet, api_*, safeApi_ -> coded errors, access gate)
  |
  v
Employees_ / Tasks_ / Sessions_ / Reports_ / Analytics.gs (dashboard, CSV) / Email.gs / Demo.gs
  |  read/write via
  v
Repository.gs  (generic row CRUD + cellSafe formula escaping + demo row caps)
  v
Google Sheets: Employees / Tasks / WorkSessions / Invitations
```

Pure helpers (`pure.gs`, `i18n.gs`) contain the testable logic: `overlapMs`,
`sumSessionMs`, `classifyWorkState`, `dailyBreakdown`, `buildReportCsv`/`csvCell`,
`filterEmployees`, `isReservedTestEmail`, `sanitizeMailText`, `resolveLanguage`,
`errorCodeFor`, `buildInvitationEmail`, … They run in Node unchanged.

**Data model.** `Employees`: `id | lastName | firstName | middleName | email |
workspaceToken | createdAt | active`. `Tasks`: `id | employeeId | title | status |
createdAt | completedAt` (`active | completed | replaced`). `WorkSessions`: `id |
employeeId | taskId | startTime | endTime | durationMs | status` (`active | paused |
completed`). `Invitations`: `id | employeeId | emailHash | at | status | detail`.

**Input handling.** Strings written to cells go through `cellSafe`; length limits
(names 100, email 320, task 500) are enforced server-side; dates must be strict
`YYYY-MM-DD`; validation failures are `UserError`s shown in the user's language;
any other error becomes a generic message and is logged server-side only.

## Prerequisites and local setup

- Node.js 18+ (exercised with Node 24); Google Chrome only for `tests/live`.
- A Google account, a dedicated **test** spreadsheet whose title contains "test" or "demo", and `npm install -g @google/clasp`; enable the Apps Script API at https://script.google.com/home/usersettings and run `clasp login`.
- On Windows run the script from **Git Bash**:

```bash
SHEET_ID=<id of your test spreadsheet> bash ./scripts/setup-apps-script.sh
```

It creates (first run) or refreshes the container-bound project and pushes
`src/*.gs`, `src/*.html` and the manifest (staged **after** `clasp create`, which
would otherwise overwrite it). It never deploys and never calls `enableOpenAccess()`.
For a standalone project add Script Property `SPREADSHEET_ID` in Project Settings.

## Running the tests

```bash
npm test                      # runs the five Node suites below
node tests/pure.test.js       # also individually: analytics, i18n, surface, gas-sim
```

| Suite | What it covers |
| --- | --- |
| `tests/pure.test.js` | overlap maths, duration summing, state transitions, validation, strict dates, `cellSafe`, `UserError`, demo helpers |
| `tests/analytics.test.js` | work-state classification, daily breakdown (partition property), CSV escaping and formula neutralisation, invitation helpers, employee search/filter |
| `tests/i18n.test.js` | dictionary parity/coverage, language precedence and persistence (the real client runtime runs in a vm with a DOM stub), error codes, invitation/CSV texts, no hard-coded visible text |
| `tests/surface.test.js` | static guards: public function allowlist, `api_*` gating, admin guards, mail confined to `Email.gs` behind its safeguards, no HTML sinks in client code, manifest scopes |
| `tests/gas-sim.test.js` | runs the **real** `src/*.gs` (including every `runTests` test) against an in-memory **simulation** of Sheets/Properties/Lock/MailApp: invitations (success, failure, retry, no permission, limits, kill switch, injection), dashboard vs report, CSV, cleanup, access boundaries |
| `tests/live/accept.js` | end-to-end run against a deployed URL in a fresh signed-out Chrome (not part of `npm test`) |

**Apps Script integration suite** (`runTests`, 38 tests, writes only to `Test_*`
sheets; the mail service is replaced by a test double, so it never sends mail):
Project Settings → Script properties → `ADMIN_MODE` = `runTests` → run `runTests`
→ View → Logs (expect `38/38 passed`).

### Test results (actual, by environment)

| Environment | Suite | Result |
| --- | --- | --- |
| Local Node | `pure.test.js` | **55/55** |
| Local Node | `analytics.test.js` | **26/26** |
| Local Node | `i18n.test.js` | **26/26** |
| Local Node | `surface.test.js` | **20/20** |
| Local Node, in-memory **simulation** (not Apps Script) | `gas-sim.test.js` (its simulated `runTests` ran all 38 integration tests) | **35/35** |
| Real Apps Script editor | `runTests`, earlier 28-test suite | **28/28** — reported by the project owner before this change set |
| Real Apps Script editor | `runTests`, current 38-test suite | **Not run.** It needs the owner to arm `ADMIN_MODE=runTests`; the simulation is not a substitute |
| Deployed app (v4), signed-out headless Chrome | `tests/live/accept.js` | **64/64** on the final run (details below) |

## Live verification of the deployed URL

`tests/live/accept.js` drives a fresh, signed-out Chrome profile over the
DevTools protocol against the public URL (final run on the updated public
deployment, version 4): **64/64 checks passed**. Earlier runs against a
throw-away deployment of the same code failed only on mistakes in the script
itself (e.g. a `<textarea>` normalising CRLF, targeting the wrong workspace frame)
and one real defect (below); no result was edited to pass.

| Area | What was executed |
| --- | --- |
| Access | Manager opens with no sign-in; demo banner; first visit follows the browser language |
| Languages | Switch to Russian: header, navigation and forms translated; no English interface text on any of the three tabs; switch back; the choice survives a reload; the workspace takes the link's language and switches too |
| Employees | Create (invitation skipped for the example address, in Russian); duplicate email refused in Russian and in English; over-long name message; hostile name (`<img onerror>`, `=SUM(…)`) shown as text and never executed |
| Search/filter | Case-insensitive email search, multi-word search, empty result message, status filter, **no extra network request** while typing |
| Details/invitations | Copyable workspace link; invitation state and retry button; retry for a reserved address reports exactly that; second task assigned, first kept as `replaced` |
| Employee workspace | Opens anonymously; no Manager UI; Start → time increases → refresh keeps it → Pause freezes it → Resume adds a new session row → duplicate start refused → Finish (confirm dialog) |
| Dashboard | "Working now" rose 0 → 1 while the timer ran; "On pause" after pausing; total equals the report total; daily buckets and per-employee rows sum to it; chart has one column per day; empty and invalid periods show clear messages |
| Reports/CSV | Report totals; employee filter; CSV has BOM, Russian headers, one line per session, formula-looking name and task neutralised; the downloaded file equals the server's CSV; filtered CSV only contains that employee; empty range gives a clear message |
| Layout | No horizontal overflow on desktop (1280), tablet (768) and mobile (390) on all tabs; tab list has ARIA roles/selection; language selector is labelled |
| Security | 21 internal functions not callable from the client; the five owner-only functions refuse anonymous calls ("not armed"); spreadsheet id appears in no page/frame/API response; no workspace token in list/report/dashboard/app-info; employee id refused as token and token refused as employee id; no stack traces or file names in errors |

**Not verified:** a real email delivery (see above); behaviour in Safari/Firefox or
on a physical phone; visual layout beyond the three emulated widths and the
screenshots reviewed; behaviour under concurrent anonymous load or quota
exhaustion; a raw HTTP client calling private functions without the page's
`google.script.run` (relies on Google's documented rule for names ending in `_`);
keyboard-only use beyond the ARIA/tab checks.

## Known limitations

- **No authentication; shared data.** Anyone with the URL can read and change everything, including every workspace link, and can call the Manager APIs directly (also with an employee link in hand).
- **Runs as the owner.** Scopes `spreadsheets`, `script.send_mail`, `script.scriptapp`; a future code defect would run with them. Use a dedicated Google account for a public demo.
- **Mail is a spam-relay risk by nature.** Anonymous visitors choose the recipient. Caps (20/day, 2 per recipient) and the kill switch bound it, but up to 20 mails a day can still go from the owner's account to addresses chosen by strangers. Disable email (`EMAIL_DISABLED=true`) if that is unacceptable.
- **Quotas.** Anonymous traffic and mail consume the owner's Apps Script/Gmail quotas.
- **Arming window.** Between adding `ADMIN_MODE=<function>` and running it, a visitor could call that same function first (only that one, only on demo data).
- **Times are UTC**, not the viewer's zone. No pagination (sized for the row caps). No audit trail of who changed what. Workspace links are bearer tokens (rotatable).
- **Existing test records** from this project's acceptance runs remain until the owner runs `cleanupTestArtifacts`.

## AI tools and models used

Based on the repository's own records (git history):

- **Claude Code with Claude Opus 4.7** — `Co-Authored-By` trailer (and `Claude-Session` link) on commits `36a4cff` (initial application), `f46809d` (security and data-integrity remediation), `b2a2ed3` (README) and `0d737a7` (setup script).
- **Claude Code with Claude Sonnet 5.5** — `Co-Authored-By` trailer on the later commits (setup-script fixes, public-demo hardening and deployment, and this change set).
- No other AI tools are recorded; chat transcripts of the earlier sessions are not in the repository.

### Representative prompts

Earlier prompts are those documented previously in this README; the later ones are
taken from the work sessions that produced this change set. Anything not listed
is **not available** in the repository.

- "Design the Google Sheets data model for an employee time tracker where pause creates an auditable interval and resume opens a new one." — fixed the session-row shape so durations never need retroactive edits.
- "Add a `LockService.getScriptLock()` wrapper around start/pause/resume/finish so two concurrent requests cannot create a duplicate active session." — made "one active session per employee" an invariant.
- "Write a cellSafe(value) that prefixes a leading apostrophe…" — closed the spreadsheet formula-injection hole (reused for the CSV export).
- "Prepare Working-Time-Tracker for public, unauthenticated demonstration … review every publicly callable server-side function … do not call `enableOpenAccess()`" — drove the public-surface audit (F-19…F-25), demo mode, reset and `surface.test.js`.
- "Complete, deploy and verify … Do not silently remove the email restriction … do not claim email works unless delivery was authorized and tested" — drove the live deployment and the signed-out acceptance run.
- "Upgrade for assessment: email invitations, complete Russian and English localization, professional UI redesign, dashboard, time analytics, CSV export, search and filtering, demo-data safety, security review, tests, deploy" — drove this change set (Analytics.gs, i18n.gs, Email.gs, the redesigned pages, the new test suites).

## Defects found and fixed

Evidence = an actual test or an observed command result.

1. **`sumSessionMs` misclassified closed rows** and returned 0 — Node test `sums closed durations` (`Expected 0 === 6000`); fixed.
2. **Unreachable duration fallback** (`Number('')` is `0`) — Node test `falls back to endpoints when durationMs missing`; fixed.
3. **`setup-apps-script.sh` login check failed on clasp 3.4.1** (`clasp login --status` removed; observed `error: unknown option '--status'`) — fixed with `clasp show-authorized-user` (`b44f304`).
4. **`setup-apps-script.sh` lost the manifest on first run** (`clasp create` overwrote it with the default) — found by cloning the remote project and diffing; fixed (`b44f304`).
5. **Public-surface exposure F-19…F-25** — found by code audit and later confirmed absent live.
6. **Validation errors shown as "server error"** — fixed; covered by Node and integration tests.
7. **Horizontal overflow of the Employees table at tablet width (768 px)** — found by the live acceptance run (`overflow 179px`); fixed in version 4 by switching tables to stacked cards up to 880 px; re-verified live (no overflow at 1280/768/390 on all tabs).
8. **Test-data pollution of the shared demo** — caused by this project's own live acceptance runs; mitigated by labelling every record with an exactly-matchable fictional address and providing the narrowly-scoped, owner-armed `cleanupTestArtifacts`.

## Files

```
appsscript.json         Manifest (scopes: spreadsheets, script.send_mail, script.scriptapp; web app: anyone, run as owner)
scripts/setup-apps-script.sh   clasp create/push (Git Bash on Windows)
src/
  Code.gs        doGet, api_*, safeApi_ (coded errors), access gate
  Config.gs      DEFAULT_CONFIG, DEMO_CONFIG (limits, email caps), spreadsheet lookup
  Analytics.gs   dashboard metrics and CSV export
  Email.gs       invitations: capability probe, caps, log, test-double hook
  Demo.gs        adminOnly_, demo checks, sample data, resetDemoData, cleanupTestArtifacts
  Employees.gs, Tasks.gs, Sessions.gs, Reports.gs, Repository.gs, Setup.gs, Utils.gs
  pure.gs        pure logic (also loaded by Node tests)
  i18n.gs        dictionaries (ru/en), language rule, error codes, email/CSV texts
  Tests.gs       Apps Script integration tests (runTests, owner-armed)
  manager.html, manager_js.html, employee.html, employee_js.html, i18n_js.html, styles.html
tests/
  pure.test.js, analytics.test.js, i18n.test.js, surface.test.js, gas-sim.test.js, run.js
  gas-sim.js, load-pure.js, load-i18n.js     helpers
  live/accept.js, live/shots.js, live/cdp.js  signed-out browser acceptance + screenshots (dependency-free)
package.json     `npm test`
```
