# Working-Time Tracker

A web application for tracking employees' working time and distributing tasks, in
Russian and English. Backend: Google Apps Script. Persistence: Google Sheets.
Frontend: plain HTML, CSS and vanilla JavaScript served by `HtmlService`.

> **This repository ships a public demonstration build.** It is a demonstration
> with fictional data, **not** a production employee-management system. Anyone
> with the URL is a manager and shares one dataset. See
> [Public demonstration](#public-demonstration) and [Security model](#security-model).

## Contents

- [Features](#features)
- [Tasks: shared pool, assignment, states](#tasks-shared-pool-assignment-states)
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

Both interfaces use a persistent dark sidebar (icons, active state, profile and
language selector) with a light content area, cards, tables and status badges;
on tablets and phones the sidebar becomes a menu opened from the top bar. Focus
outlines, ARIA state and a skip link are provided. The layout follows the
supplied WorkTrack reference for structure and hierarchy only; no text or data
was taken from it.

**Manager console** (the base URL; no sign-in)

- **Overview:** employees, working now, on pause, open / completed / overdue
  tasks, tracked time for the chosen period, a per-day chart, time by project,
  tasks by status, employee workload, recent activity and recent comments.
- **Projects:** create projects; see each project's tasks by status and tracked time.
- **Tasks:** create a task as a *draft*, *publish it to the shared pool* or
  *assign it to a person*; publish / take back a pool task; assign a pool or
  draft task to a specific employee; change priority and deadline; search and
  filter by project, status, priority, employee and deadline; per-task details
  with sessions, the audit history and the comment thread with a reply box.
- **Employees:** create an employee (optionally with an invitation email),
  search/filter, details with the copyable workspace link, invitation status
  with send/retry, link rotation and the person's tasks.
- **Reports:** date-range report (optionally for one employee) and **CSV export**.
- **Work history:** every session of a period, filterable by employee and project.
- **Settings:** language, mail status, notes about the demonstration.

**Employee workspace** (`<base URL>?page=employee&token=<token>`)

- **Overview:** current task with timer and Start / Pause / Resume / Finish,
  today's time, tasks, recent comments.
- **My tasks:** every task the employee owns, with status, priority, deadline,
  tracked time, per-task timer buttons and a shortcut to the comments.
- **Available tasks:** the shared pool with search and project/priority filters
  and a **Take task** button.
- **Work history** and **Comments** (a thread per task shared with the Manager).

## Tasks: shared pool, assignment, states

A task row carries a project, priority (low / medium / high), an optional
deadline (UTC date) and a description. Stored statuses and the only allowed
moves (`TASK_TRANSITIONS` in `src/pure.gs`, enforced by `tasks_move_`):

| From | Action | To | Who |
| --- | --- | --- | --- |
| draft | publish | available | Manager |
| draft | assign | active | Manager |
| available | unpublish | draft | Manager |
| available | claim | active | the employee (identity from the token) |
| available | assign | active | Manager |
| active | complete | completed | the owner (Finish) |
| completed, replaced | — | — | final |

The *displayed* status of an owned task adds the work state computed from its
sessions: **assigned** (nothing recorded), **in progress** (a timer runs),
**paused** (latest session ended as paused), then **completed**.

- **Claiming and assigning** run under the script lock and re-read the row inside
  the lock, so two requests can never both succeed: the second employee gets
  "This task is no longer available" from the server (not just a hidden button).
- **Assigning a pool task** updates the same row (no copy), so it leaves the pool
  and appears in the person's *My tasks* in one step; priority, deadline and any
  recorded work are kept. An owned task cannot be re-assigned or claimed.
- **Timers:** one running timer per employee; each task keeps its own time.
  Finishing a task does not stop the timer of another task.
- **Audit history:** created, published, unpublished, assigned, claimed, started,
  paused, resumed, completed, updated and commented events are appended to the
  `TaskActivity` sheet (best effort: a log problem never blocks the operation).
- **Comments** are append-only, owned by the task's employee or the Manager, and
  shown as plain text.

## Time-tracking rules enforced

- Elapsed time comes from timestamps stored on the server, not a browser counter.
- A pause closes the session with a frozen `durationMs`; resuming opens a new session row.
- Pauses, overnight gaps and browser downtime are never counted (they are not inside a session interval).
- Never two running timers for one employee; all critical writes run under `LockService.getScriptLock()`.
- Employee creation is atomic; a failed invitation never rolls the employee back.
- Dates are UTC calendar days everywhere (reports, dashboard, chart, CSV, task deadlines and every displayed timestamp, which carries `UTC`).

## Public demonstration

> **Public Manager URL** (deployment `AKfycbzV_EGldUPBy51pOdbVu8Y99O42QVJnsmSKtoqx234oI4qHcuvefSj1FmzAlpqG-jyXWA`, currently **version 7**):
>
> https://script.google.com/macros/s/AKfycbzV_EGldUPBy51pOdbVu8Y99O42QVJnsmSKtoqx234oI4qHcuvefSj1FmzAlpqG-jyXWA/exec

It opens the Manager with no Google sign-in (Google adds its own "created by
another user" banner; the app cannot remove it). All reviewers share one dataset.

### Employee access flow

1. Manager: **Employees → Add employee** (fictional data), or use an existing one.
2. Manager: **Employees → Details** shows the **workspace link**: copy it or open it
   (it works independently of email). *Send invitation* mails it to a real address.
3. Employee: open the link → **Overview / My tasks / Available tasks / Work history / Comments**.
4. Employee: **Available tasks → Take task** (or the Manager assigns one) → **My tasks → Start**.

### Suggested demo path

*Manager:* Projects → create a project → Tasks → New task → "Publish to the shared
pool" → Employees → Details → open the workspace link. *Employee:* Available tasks
→ Take task → My tasks → Start / Pause / Finish → Comments. *Manager:* Tasks →
Details of that task → activity history, comment thread, reply → Overview.

### Configuration of the demonstration

| Aspect | Setting |
| --- | --- |
| Web app | One Apps Script web app, *Execute as: Me*, *Access: Anyone* (anonymous). |
| Data | One dedicated Google Sheet (`Working Time Tracker — Test Env`): `Employees`, `Tasks`, `WorkSessions`, `Projects`, `TaskComments`, `TaskActivity`, `Invitations`. |
| Isolation | The sheet is pinned by the `SPREADSHEET_ID` Script Property (owner-set, never client-set). The app **refuses to start** unless the sheet's title contains *test* or *demo*. |
| Email | Invitations via `MailApp`, capped and logged — see [Email invitations](#email-invitations). |
| Write caps | 100 employees, 500 tasks, 3000 sessions, 50 projects, 1500 comments, 6000 activity rows, 1000 invitation rows. |
| OAuth scopes | `spreadsheets`, `script.send_mail` (send-only), `script.scriptapp`. |

An existing `Tasks` sheet from an earlier version is upgraded in place: the five
new columns are appended to the right on the next request; rows are untouched.
The sheet check is cached for 120 s and the spreadsheet handle is reused per
request to keep responses fast.

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

Never point `.clasp.json` or `SPREADSHEET_ID` at another spreadsheet and never
run `enableOpenAccess()` (the demo build does not use it).
Versions: 1 demo · 2 ru/en, dashboard, CSV, invitations · 3 language in the URL ·
4 responsive tables · 5–6 sidebar UI, projects, shared task pool, comments · **7
faster list refresh and fixes (current)**.

## Email invitations

When a manager creates an employee with *Send an invitation email* ticked (or
presses *Send / Retry invitation* in Details), the app sends **one plain-text
email** to the entered address containing the employee's own workspace link, in
the language selected by the manager. The employee record is saved first and is
never rolled back by a delivery problem. This feature is unchanged by the task
work; assigning or claiming tasks sends no email.

What the Manager shows (each state is localized): *Accepted for delivery* ·
*Failed* (retry available) · *Not authorized* · *Skipped (example address)* ·
*Daily limit reached* · *Recipient limit reached* · *Disabled* · *Not requested*.
"Accepted for delivery" means Google's mail service accepted the message; it is
**not** a delivery receipt.

Safeguards, because the web app runs as its owner and anyone can type any address:

- Reserved/documentation addresses (`example.com/.org/.net` and subdomains, `.test`, `.invalid`, `.localhost`, `.example`) are never mailed. All sample data and all test data use them.
- Global cap **20 invitations/day** and **2 per recipient/day** (`DEMO_CONFIG.EMAIL`), checked and reserved under the script lock before sending.
- Fixed text; only the first name (≤ 60 chars) and the task title (≤ 120 chars) are user text, flattened to one line and sent as plain text.
- Every attempt is logged in `Invitations` as a hashed recipient + status + sanitized error text — never the link or token.
- **Kill switch:** Script Property `EMAIL_DISABLED=true` stops all sending immediately (or set `DEMO_CONFIG.EMAIL.ENABLED = false` and redeploy).
- Only `MailApp` (send-only); no Gmail/Drive scope, no external provider.

**Real delivery has not been tested.** The mail permission is approved for this
deployment (the capability probe `MailApp.getRemainingDailyQuota()` returned 100
and the Manager shows "Invitation emails are available"), and the send path —
link, language, caps, retry, failure handling — is covered by tests that replace
the mail service with a recording double. No test sent a message to a real
address because none was authorized. To check delivery, create an employee with
**your own** address in the demo with the option ticked and look for the message
(spam folder included).

## Languages (Russian and English)

A selector in the sidebar of both interfaces (and in Settings). Everything is
translated: navigation, forms, buttons, tables, statuses and priorities, the
dashboard, projects, tasks, comments, the activity history, reports, CSV headers
and statuses, validation and server messages, the confirm dialogs, the
invitation email and date labels. Employee names, emails, project names, task
titles, descriptions and comments are user data and are never translated.

- **Resolution order:** saved choice → `?lang=` of the opened link → browser language → English.
- **Persistence:** `localStorage` plus the page URL (`?lang=`), so it survives reloads even if storage is blocked.
- **One implementation:** `src/i18n.gs` holds both dictionaries (334 keys each), the resolution rule, the server error-code table and the email/CSV texts; pages receive them through the template. Server errors travel as `@@code@@{params}@@English` and are translated in the browser.
- **Coverage is tested:** identical keys and placeholders, every key the HTML/JS uses exists, every server `UserError` has a translation, no hard-coded visible text, and the live run checks that no English interface text remains on any of the seven Manager views in Russian.

## Dashboard, analytics, CSV export, search

- **Everything is computed from stored rows** and reconciles: task counts by status add up to the number of tasks; per-day buckets, per-employee, per-project and workload times all add up to the report total (tested in Node, in the simulation and live).
- **Unfinished sessions** count up to "now" as in reports; pauses and gaps are not counted.
- **Work status** per employee: *working* (a timer runs), *on pause* (the latest closed session of an active task ended as paused), *not started* otherwise.
- **CSV:** built on the server from the same report rows, filtered by dates and employee; columns: employee, email, **project**, task, date, start, end (**UTC**), duration `hh:mm:ss` and seconds, status (localized). UTF-8 BOM and CRLF so Excel opens Cyrillic; every text cell quoted; any cell beginning (also after whitespace/zero-width/tab/CR) with `= + - @ |` is prefixed with `'`.
- **Search/filter** of employees and tasks runs in the browser on the loaded lists; no request while typing. Periods are limited to 366 days.

## Security model

The app has **no login by design**: the Manager URL is public and shared. It
executes as its owner, so what an anonymous caller can do is exactly what the
public code allows. `google.script.run` can call **every top-level function whose
name does not end in `_`**, so the surface is pinned by `tests/surface.test.js`:
`doGet`; 30 `api_*` functions (each wrapped in `safeApi_` and gated by
`requireOpenAccess_`; none takes a sheet, spreadsheet or context argument);
side-effect-free helpers in `pure.gs`/`i18n.gs`; and five owner-only functions
(`runTests`, `resetDemoData`, `cleanupTestArtifacts`, `enableOpenAccess`,
`disableOpenAccess`) that refuse unless the owner armed **that function** with
Script Property `ADMIN_MODE=<function name>` (checked and consumed atomically under
the lock before the operation runs). All other functions end in `_` and are not
exposed (verified live by calling 22 of them from the deployed page).

| ID | Finding | Resolution |
| --- | --- | --- |
| F-19…F-25 | Public-surface exposure, admin functions, doGet ordering | Private `_` functions, function-bound arming, access check first (earlier work) |
| F-20, F-28 | Anonymous visitors could make the owner mail arbitrary addresses; log secrets | Caps, reserved-domain skip, kill switch, send-only scope, hashed log (see Email) |
| F-26, F-27 | HTML sinks in the client; CSV formula injection | All DOM via `textContent` (test bans `innerHTML` etc.); `csvCell` neutralisation, checked on the downloaded file |
| F-29 | **Task ownership**: an employee could try to start, finish, comment on or claim another employee's task by guessing ids | Every employee API takes only the token and resolves the employee on the server (test: no employee-id parameter, authenticate before data access); ownership is decided by the stored row (`tasks_requireOwned_`); verified live with foreign task ids → `task_not_yours` |
| F-30 | **Claim races**: two employees taking the same pool task | `tasks_move_` re-reads the row inside the script lock and checks `TASK_TRANSITIONS`; status written last; second claim refused server-side (live, with a stale card in the second workspace) |
| F-31 | Manager ids and employee tokens being interchangeable | Employee APIs refuse an employee id as a token; manager APIs refuse a token as an id (live) |
| F-32 | New responses leaking tokens or the spreadsheet id | Tests scan manager and employee responses for 40-hex tokens, the spreadsheet id and the other employee's data |
| F-33 | Unbounded growth through the new sheets | Row caps on projects, comments and the activity log |

**Manager vs employee boundary.** A workspace link carries a 40-hex (160-bit)
random token identifying **one workspace**. Possession grants that workspace; it
is not proof of who the person is, and it can be rotated. The workspace page
renders no Manager UI and employee APIs act only on that employee's records.
**However, the demo's Manager APIs are unauthenticated: any anonymous visitor —
including someone holding an employee link — can call them directly.** The
workspace does not *grant* Manager access, but nothing in this demo *prevents*
it. A real deployment needs authentication.

Shared-data risks (accepted for a demo): anyone can read or change every record,
including every workspace link; anonymous traffic consumes the owner's Apps
Script and mail quotas; the app runs with the owner's permissions.

## Demo data: reset and cleanup

Both are owner-only (function-bound `ADMIN_MODE`), act only on the pinned demo
spreadsheet, refuse unless its title contains *test*/*demo*, and are never
exposed to visitors. There is no automatic reset.

- **`resetDemoData`** — clears and re-seeds `Employees`, `Tasks`, `WorkSessions`, `Invitations`, `Projects`, `TaskComments`, `TaskActivity` with 3 projects, 2 employees, 8 tasks (a completed one, a replaced one, two in the employees' hands, three in the shared pool, one draft; one overdue), 8 sessions, comments and an activity history. *Destructive for all demo data.*
- **`cleanupTestArtifacts`** — removes **only** this project's own acceptance records: employees with email `demo.verifier.<digits>@example.com` or exactly `inj.verifier@example.com`, and projects named `Acceptance project <digits>`, together with their tasks, sessions, comments, activity and invitation rows. Everything else is untouched (tested, including near-miss names).

To run one: Project Settings → Script properties → add `ADMIN_MODE` = the function's
name → select it in the editor → Run → read the log.

**Origin of the repeated `Verifier Demo Q` records and the formula-looking
`=HYPERLINK(...)` / `@cmd` records:** they come from this project's own live
acceptance runs (`tests/live/accept.js` and its predecessors), which create one
fictional employee (and, now, one project with its tasks) per run. They are shown
as plain text and nothing executes. The newest runs' records follow the cleanup
patterns above; the *older* `Verifier Demo Q` rows use the same email pattern. They
have **not** been removed because removal needs the owner to arm
`cleanupTestArtifacts`. The record *Иванов Иван Иванович* was **not** created by the
tests (someone entered it in the public demo) and was left untouched.

## Architecture and data flow

```
Browser (manager.html / employee.html + i18n_js.html + common_js.html)
  |  google.script.run.<api_*>(args)           (only api_* is callable; see Security model)
  v
Code.gs  (doGet, api_*, safeApi_ -> coded errors, access gate)
  |
  v
Employees_ / Tasks (claim/assign/move) / Sessions_ / Reports_ / Projects (projects, comments, activity)
Analytics (dashboard, CSV) / Email / Demo
  |  read/write via
  v
Repository.gs  (generic row CRUD + cellSafe formula escaping + demo row caps)
  v
Google Sheets
```

Pure helpers (`pure.gs`, `i18n.gs`) hold the testable logic: `overlapMs`,
`sumSessionMs`, `classifyWorkState`, `deriveTaskStatus`, `nextTaskStatus`,
`isOverdue`, `dailyBreakdown`, `buildReportCsv`/`csvCell`, `filterEmployees`,
`filterTasks`, `isReservedTestEmail`, `resolveLanguage`, `errorCodeFor`, … They run
in Node unchanged.

**Data model.** `Employees`: `id | lastName | firstName | middleName | email |
workspaceToken | createdAt | active`. `Tasks`: `id | employeeId | title | status |
createdAt | completedAt | projectId | priority | dueDate | description |
assignedAt`. `WorkSessions`: `id | employeeId | taskId | startTime | endTime |
durationMs | status`. `Projects`: `id | name | description | status | createdAt`.
`TaskComments`: `id | taskId | authorType | authorId | authorName | text |
createdAt`. `TaskActivity`: `id | taskId | at | actorType | actorId | action |
detail`. `Invitations`: `id | employeeId | emailHash | at | status | detail`.

**Input handling.** Strings written to cells go through `cellSafe`; limits
(names 100, email 320, task 500, description 2000, comment 1000, project 100) are
server-side; dates must be strict `YYYY-MM-DD`; validation failures are
`UserError`s shown in the user's language; other errors become a generic message
and are logged server-side only.

## Prerequisites and local setup

- Node.js 18+ (exercised with Node 24); Google Chrome only for `tests/live`.
- A Google account, a dedicated **test** spreadsheet whose title contains "test" or "demo", and `npm install -g @google/clasp`; enable the Apps Script API at https://script.google.com/home/usersettings and run `clasp login`.
- On Windows run the script from **Git Bash**:

```bash
SHEET_ID=<id of your test spreadsheet> bash ./scripts/setup-apps-script.sh
```

It creates (first run) or refreshes the container-bound project and pushes
`src/*.gs`, `src/*.html` and the manifest (staged **after** `clasp create`). It
never deploys and never calls `enableOpenAccess()`. For a standalone project add
Script Property `SPREADSHEET_ID` in Project Settings.

## Running the tests

```bash
npm test                      # runs the six Node suites below
node tests/pure.test.js       # also individually: analytics, tasks, i18n, surface, gas-sim
```

| Suite | What it covers |
| --- | --- |
| `tests/pure.test.js` | overlap maths, duration summing, validation, strict dates, `cellSafe`, `UserError`, demo helpers |
| `tests/analytics.test.js` | work-state classification, daily breakdown, CSV escaping and formula neutralisation, invitation helpers, employee search/filter |
| `tests/tasks.test.js` | the transition table (every move, no invalid one, two claims → exactly one wins), displayed status, overdue, priorities, task filters, sample-data integrity |
| `tests/i18n.test.js` | dictionary parity/coverage, language precedence and persistence (the real client runtime in a vm with a DOM stub), error codes, no hard-coded visible text |
| `tests/surface.test.js` | public-function allowlist, `api_*` gating, admin guards, **employee APIs take only a token and authenticate first**, task moves re-read the row under the lock, pages call only their own APIs, no HTML sinks in client code, responsive/ARIA structure, manifest scopes |
| `tests/gas-sim.test.js` | runs the **real** `src/*.gs` (including all 51 `runTests` tests) against an in-memory **simulation** of Sheets/Properties/Lock/Cache/MailApp: pool lifecycle, claim races, assignment, foreign-id attacks, timers across tasks, comments, activity log, dashboard reconciliation, CSV, legacy-sheet migration, cleanup, caps, invitations |
| `tests/live/accept.js` | end-to-end run against a deployed URL in a fresh signed-out Chrome (not part of `npm test`) |

**Apps Script integration suite** (`runTests`, 51 tests, writes only to `Test_*`
sheets; the mail service is replaced by a test double): Project Settings → Script
properties → `ADMIN_MODE` = `runTests` → run `runTests` → View → Logs (expect
`51/51 passed`).

### Test results (actual, by environment)

| Environment | Suite | Result |
| --- | --- | --- |
| Local Node | `pure.test.js` | **55/55** |
| Local Node | `analytics.test.js` | **26/26** |
| Local Node | `tasks.test.js` | **21/21** |
| Local Node | `i18n.test.js` | **26/26** |
| Local Node | `surface.test.js` | **25/25** |
| Local Node, in-memory **simulation** (not Apps Script) | `gas-sim.test.js` (its simulated `runTests` ran all 51 integration tests) | **55/55** |
| Real Apps Script editor | `runTests`, earlier 28-test suite | **28/28** — reported by the project owner before this change set |
| Real Apps Script editor | `runTests`, current 51-test suite | **Not run.** It needs the owner to arm `ADMIN_MODE=runTests` in a signed-in editor, which the automation cannot do; the simulation is not a substitute |
| Deployed app (v7), signed-out headless Chrome | `tests/live/accept.js` | **102/102** on the final run against the public URL |

Total local Node checks: **208** (55 + 26 + 21 + 26 + 25 + 55).

## Live verification of the deployed URL

`tests/live/accept.js` drives a fresh, signed-out Chrome profile over the
DevTools protocol against the public URL (final run on the public deployment,
version 7): **102/102 checks passed**. Earlier runs against a throw-away
deployment failed only on mistakes in the script itself (reading a list before
the server answered, an animation measured too early, a truncated string
compared, a wrong expectation of which task is "current", an activity pattern
that ignored interleaved comments) — no result was edited to pass; the app issues that the screenshots and
timings exposed are listed under *Defects found and fixed*.

| Area | What was executed |
| --- | --- |
| Access, layout | Manager opens with no sign-in; dark persistent sidebar with seven sections and a profile/language block; demo banner |
| Languages | Russian: brand, all seven navigation labels, no English interface text on any of the seven views; switch back; the choice survives a reload |
| Employees | Create two (invitation skipped for example addresses, in the selected language); duplicate refused; search without a network request; empty result message; link, retry |
| Projects, tasks | Create a project (duplicate refused); create tasks as pool / draft / direct assignment; statuses, priorities, the overdue flag and indicator in the table; hostile title shown as text and never executes; filters by project, status, priority, employee, deadline and text search; empty result |
| Shared pool | Employee sees the published tasks (not drafts or assigned ones); search, project and priority filters; **Take task**; the task leaves the pool; appears in *My tasks*; a **second employee with a stale card is refused by the server** and via the API (`task_not_available`); the stored owner is unchanged |
| Assignment | Manager assigns a pool task to employee B: same row, details kept, no duplicate, gone from A's pool, in B's *My tasks*; A cannot claim it, nor start, finish or comment on it with its id |
| Timer | Start on the claimed task; badge "In progress"; another task's Start is disabled and the server also refuses; the dashboard counts "working now"; a refresh restores the timer; Pause freezes it, dashboard "on pause"; Resume continues; history shows both sessions; Finish (confirm) completes |
| Comments | Employee comments (markup/formula text kept as text); Manager sees author and text and replies; employee sees the reply; a third party can neither read nor write that thread |
| Activity | The task's history is `created, published, claimed, started, paused, resumed, paused, completed` plus both comments, with no workspace token |
| Dashboard | Task counts by status equal the task rows and the displayed statuses; tracked time = report total = daily = per-employee = per-project = workload; the project's time is attributed; overdue count; cards show exactly these numbers; chart/donut/status bars/workload/feeds drawn; empty period message |
| Reports, history, CSV | Report totals with projects; CSV (BOM, Russian headers incl. project, one line per session, no raw formula cell) downloaded and equal to the server's text; Work history lists every session; Settings page |
| Responsive | No horizontal overflow on any of the 7 Manager and 5 employee views at 1366, 820 and 390 px; on mobile the sidebar is hidden behind an accessible menu button that opens and closes it; nav items are buttons with `aria-current`; labelled language selector; skip link; focus-visible rule |
| Security | 22 internal functions (task moves, comments, cleanup, spreadsheet access, …) not callable; the five owner-only functions refuse (`not armed`); the spreadsheet id appears in no page/frame/API response; no workspace token in any manager or employee response; id/token not interchangeable; no stack traces; **no JavaScript error on any page** |

**Not verified:** a real email delivery; Safari/Firefox or a physical phone; visual
fidelity beyond the three emulated widths and the screenshots reviewed;
concurrent anonymous load or quota exhaustion; a true *simultaneous* double-claim
(the live test uses a stale second client, the lock behaviour under real
parallel executions is by design of `LockService`, not measured); a raw HTTP
client calling private functions without the page's `google.script.run`; keyboard-only
use beyond the ARIA/focus checks.

## Known limitations

- **No authentication; shared data.** Anyone with the URL can read and change everything, including every workspace link, and can call the Manager APIs directly (also with an employee link in hand).
- **Runs as the owner.** Scopes `spreadsheets`, `script.send_mail`, `script.scriptapp`.
- **Mail is a spam-relay risk by nature.** Caps (20/day, 2 per recipient) and the kill switch bound it; set `EMAIL_DISABLED=true` if that is unacceptable.
- **Quotas.** Anonymous traffic and mail consume the owner's quotas; each request reads whole sheets (sized for the row caps), so responses take a few seconds.
- **Arming window.** Between adding `ADMIN_MODE=<function>` and running it, a visitor could call that same function first.
- **Reassigning an owned task is not supported** (an assigned task can only be finished); a manager cannot close a task for an employee; priorities are low/medium/high.
- **Times are UTC**; no pagination; the activity log is best effort; the Manager has no individual identity (comments are labelled "Manager").
- **Existing test records** from this project's acceptance runs remain until the owner runs `cleanupTestArtifacts`; the pool is empty until a manager publishes tasks or the owner runs `resetDemoData`.

## AI tools and models used

Based on the repository's own records (git history):

- **Claude Code with Claude Opus 4.7** — `Co-Authored-By` trailer (and `Claude-Session` link) on `36a4cff`, `f46809d`, `b2a2ed3`, `0d737a7`.
- **Claude Code with Claude Sonnet 5.5** — `Co-Authored-By` trailer on the later commits (setup fixes, public-demo hardening and deployment, invitations/localization/dashboard, and this change set).
- No other AI tools are recorded; chat transcripts are not in the repository.

### Representative prompts

Earlier prompts are those documented previously; the later ones come from the
work sessions that produced this change set. Anything not listed is **not available**.

- "Design the Google Sheets data model for an employee time tracker where pause creates an auditable interval and resume opens a new one."
- "Add a `LockService.getScriptLock()` wrapper around start/pause/resume/finish so two concurrent requests cannot create a duplicate active session." — the same pattern now protects claiming and assignment.
- "Write a cellSafe(value) that prefixes a leading apostrophe…" — reused for CSV.
- "Prepare Working-Time-Tracker for public, unauthenticated demonstration … review every publicly callable server-side function."
- "Upgrade for assessment: email invitations, Russian/English localization, redesign, dashboard, CSV, search, demo-data safety, tests, deploy."
- "Work in the existing repository … treat the attached four-screen WorkTrack mockup as the visual reference … shared task pool, individual assignment, employee comments, bilingual UI, tests, deploy the verified version" — drove this change set (sidebar UI, `Projects.gs`, task moves, `common_js.html`, `tasks.test.js`, the new live acceptance run).

## Defects found and fixed

Evidence = an actual test, screenshot or observed result.

1. `sumSessionMs` misclassified closed rows; unreachable duration fallback (Node tests, earlier work).
2. `setup-apps-script.sh`: clasp 3.x login check and manifest overwritten by `clasp create` (earlier work).
3. Public-surface exposure F-19…F-25 and the validation-error message (earlier work).
4. Employees table overflowing at tablet width (live run, earlier version) — fixed by stacked tables.
5. **Hidden buttons were visible** (found in a screenshot of the new employee overview: Start, Pause, Resume and Finish all showed at once): the global `button { display: inline-block }` rule overrode the `hidden` attribute. Fixed with `[hidden] { display: none !important }`; the live run now asserts the real states.
6. **Slow list refresh** (found by timing the live run): after creating an employee the list took ~12 s and the form stayed disabled, because every request re-verified eight sheets and the page reloaded three unrelated lists in sequence. Fixed: spreadsheet handle reused per request, sheet check cached for 120 s (never bypassing the access check), the form re-enabled immediately and only the affected list reloaded.
7. **Task table headers broke mid-word at desktop width** (screenshot) — fixed with nowrap headers/buttons.
8. Test-data pollution of the shared demo by this project's own acceptance runs — mitigated by exactly-matchable fictional names and the owner-armed `cleanupTestArtifacts`, now also covering acceptance projects and their tasks, comments and activity.

## Files

```
appsscript.json         Manifest (scopes: spreadsheets, script.send_mail, script.scriptapp; web app: anyone, run as owner)
scripts/setup-apps-script.sh   clasp create/push (Git Bash on Windows)
src/
  Code.gs        doGet, 30 api_*, safeApi_ (coded errors), access gate
  Config.gs      DEFAULT_CONFIG, DEMO_CONFIG (limits, email caps), spreadsheet lookup (memoised)
  Tasks.gs       task rows, transitions (claim/assign/publish/…), decorated views
  Projects.gs    projects, comments, activity log
  Sessions.gs    timers per task; Employees.gs, Reports.gs, Repository.gs, Setup.gs (migration, cached check), Utils.gs
  Analytics.gs   dashboard and CSV export
  Email.gs       invitations: capability probe, caps, log, test-double hook
  Demo.gs        adminOnly_, demo checks, sample data, resetDemoData, cleanupTestArtifacts
  pure.gs        pure logic (also loaded by Node tests)
  i18n.gs        dictionaries (ru/en), language rule, error codes, email/CSV texts
  Tests.gs       Apps Script integration tests (runTests, owner-armed)
  manager.html, manager_js.html, employee.html, employee_js.html, common_js.html, i18n_js.html, styles.html
tests/
  pure, analytics, tasks, i18n, surface, gas-sim (+ gas-sim.js, load-pure.js, load-i18n.js), run.js
  live/accept.js, live/shots.js, live/cdp.js   signed-out browser acceptance + screenshots (dependency-free)
package.json     `npm test`
```
