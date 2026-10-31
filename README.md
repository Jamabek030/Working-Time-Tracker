# Working-Time Tracker

A web application for tracking employees' working time and distributing tasks, in
Russian and English. Backend: Google Apps Script. Persistence: Google Sheets.
Frontend: plain HTML, CSS and vanilla JavaScript served by `HtmlService`.

> **Scope.** This build runs against a dedicated assessment spreadsheet that
> holds a fictional IT-company dataset (see [Assessment dataset](#assessment-dataset)).
> The application screens carry no notices about this; the facts are documented
> here instead. It is **not** a production employee-management system: the
> Manager URL is unauthenticated and every visitor shares one dataset. See
> [Security model](#security-model) and [Known limitations](#known-limitations).

## Contents

- [Features](#features)
- [Tasks: shared pool, assignment, states](#tasks-shared-pool-assignment-states)
- [Time-tracking rules enforced](#time-tracking-rules-enforced)
- [Assessment deployment](#assessment-deployment) — URL, workflows, configuration, deployment
- [Assessment dataset](#assessment-dataset) — the company scenario, the 20 pool tasks, seeding
- [Email invitations](#email-invitations)
- [Languages](#languages-russian-and-english)
- [Dashboard, analytics, CSV export, search](#dashboard-analytics-csv-export-search)
- [Security model](#security-model)
- [Data seeding, reset and cleanup](#data-seeding-reset-and-cleanup)
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
- **Settings:** language, mail status, time-zone note.

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

## Assessment deployment

> **Public Manager URL** (deployment `AKfycbzV_EGldUPBy51pOdbVu8Y99O42QVJnsmSKtoqx234oI4qHcuvefSj1FmzAlpqG-jyXWA`, currently **version 8**):
>
> https://script.google.com/macros/s/AKfycbzV_EGldUPBy51pOdbVu8Y99O42QVJnsmSKtoqx234oI4qHcuvefSj1FmzAlpqG-jyXWA/exec

It opens the Manager with no Google sign-in (Google adds its own "created by
another user" banner; the app cannot remove it). All reviewers share one dataset.

### Employee access flow

1. Manager: **Employees → Add employee**, or use one of the ten existing employees.
2. Manager: **Employees → Details** shows the **workspace link**: copy it or open it
   (it works independently of email). *Send invitation* mails it to a real address.
3. Employee: open the link → **Overview / My tasks / Available tasks / Work history / Comments**.
4. Employee: **Available tasks → Take task** (or the Manager assigns one) → **My tasks → Start**.

### Suggested walkthrough

*Manager:* Projects → create a project → Tasks → New task → "Publish to the shared
pool" → Employees → Details → open the workspace link. *Employee:* Available tasks
→ Take task → My tasks → Start / Pause / Finish → Comments. *Manager:* Tasks →
Details of that task → activity history, comment thread, reply → Overview.

### Configuration

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
Versions: 1 first deployment · 2 ru/en, dashboard, CSV, invitations · 3 language in the URL ·
4 responsive tables · 5–6 sidebar UI, projects, shared task pool, comments · 7
faster list refresh · **8 neutral screens (no notices), company dataset and seeding (current)**.

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
`doGet`; 29 `api_*` functions (each wrapped in `safeApi_` and gated by
`requireOpenAccess_`; none takes a sheet, spreadsheet or context argument);
side-effect-free helpers in `pure.gs`/`i18n.gs`/`dataset.gs`; and six owner-only functions
(`runTests`, `resetDemoData`, `seedAssessmentData`, `cleanupTestArtifacts`, `enableOpenAccess`,
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
**However, this build's Manager APIs are unauthenticated: any anonymous visitor —
including someone holding an employee link — can call them directly.** The
workspace does not *grant* Manager access, but nothing in this build *prevents*
it. A real deployment needs authentication.

Shared-data risks (accepted for this assessment build): anyone can read or change every record,
including every workspace link; anonymous traffic consumes the owner's Apps
Script and mail quotas; the app runs with the owner's permissions.

## Assessment dataset

Generated by `src/dataset.gs` (`buildAssessmentDataset`, a pure function with fixed ids `asm-…`
and only the workspace tokens random), relative to the moment it runs, so the
history always ends yesterday. Everything is fictional; every address is on the
reserved `example.com` domain and no e-mail is sent when it is loaded.

| Table | Rows | Content |
| --- | --- | --- |
| Employees | **10** | distinct Russian full names, `name.surname@example.com`; the last one joined six days earlier |
| Projects | **5** | software development; testing and audit; administration and infrastructure; support; data, reporting and automation |
| Tasks | **48** | **20 in the shared pool (available)**, 2 drafts, 4 assigned and not started (2 overdue), 8 started and paused, 14 completed; low / medium / high priorities and due dates; 6 were taken from the pool by employees, the rest assigned by the Manager |
| Work sessions | **62** | five weeks of weekday work blocks, 09:00–19:15 UTC, never overlapping, none running; 127 h 50 min in total |
| Comments | 12 | manager and employee, plain text |
| Activity | 236 | created → published/assigned/claimed → started/paused/resumed → completed, ordered per task |

### The 20 pool tasks

| # | Task | Project | Priority |
| --- | --- | --- | --- |
| 1 | Разработать систему управления клиентами | Разработка программного обеспечения | high |
| 2 | Создать сервис онлайн-записи на приём | Разработка программного обеспечения | high |
| 3 | Доработать приложение управления сотрудниками | Разработка программного обеспечения | medium |
| 4 | Разработать мобильное приложение для заявок на обслуживание | Разработка программного обеспечения | medium |
| 5 | Реализовать систему уведомлений | Разработка программного обеспечения | medium |
| 6 | Провести аудит платёжного приложения FinFlow | Тестирование и аудит продуктов | high |
| 7 | Протестировать новую версию портала сотрудников WorkSpace | Тестирование и аудит продуктов | high |
| 8 | Проверить безопасность веб-приложения ClientHub | Тестирование и аудит продуктов | high |
| 9 | Подготовить отчёт о тестировании интернет-магазина ShopPilot | Тестирование и аудит продуктов | medium |
| 10 | Провести аудит производительности системы аналитики ReportPro | Тестирование и аудит продуктов | medium |
| 11 | Настроить новую среду Windows Server | Администрирование и инфраструктура | high |
| 12 | Настроить учётные записи сотрудников и права доступа | Администрирование и инфраструктура | medium |
| 13 | Установить и настроить внутреннее программное обеспечение компании | Администрирование и инфраструктура | medium |
| 14 | Настроить резервное копирование файлов компании | Администрирование и инфраструктура | high |
| 15 | Подготовить сервер разработки для нового проекта | Администрирование и инфраструктура | medium |
| 16 | Выяснить причину медленной работы компьютера сотрудника | Сопровождение и техническая поддержка | low |
| 17 | Обновить программы, используемые командой дизайна | Сопровождение и техническая поддержка | low |
| 18 | Устранить проблему с доступом во внутренний портал | Сопровождение и техническая поддержка | high |
| 19 | Подготовить управленческий отчёт для отдела продаж | Данные, отчётность и автоматизация | medium |
| 20 | Автоматизировать еженедельный отчёт о статусе проектов | Данные, отчётность и автоматизация | medium |

Each description ends with an expected result ("Ожидаемый результат: …"). The
Windows Server task asks to confirm the exact supported release and licensing
requirements before starting. Employees can take any of them from *Available
tasks*; the Manager can assign any of them from the task details.

## Data seeding, reset and cleanup

All three are owner-only (function-bound `ADMIN_MODE`), act only on the pinned
spreadsheet, refuse unless its title contains *test*/*demo*, and are never
exposed to visitors. There is no automatic reset.

- **`seedAssessmentData`** — *non-destructive and idempotent*: appends only the dataset rows whose fixed id (or, for employees, e-mail) is missing; running it again adds nothing; existing rows are never modified or removed (tested, including an unrelated record and a colliding e-mail).
- **`resetDemoData`** — *destructive*: clears the rows of `Employees`, `Tasks`, `WorkSessions`, `Invitations`, `Projects`, `TaskComments`, `TaskActivity` and loads the dataset. Never deletes a sheet or touches another sheet.
- **`cleanupTestArtifacts`** — removes **only** this project's own acceptance records: employees with e-mail `demo.verifier.<digits>@example.com` or exactly `inj.verifier@example.com`, and projects named `Acceptance project <digits>`, with their tasks, sessions, comments, activity and invitation rows (tested, including near-miss names).

To run one: Project Settings → Script properties → add `ADMIN_MODE` = the function's
name → select it in the editor → Run → read the log.

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
npm test                      # runs the eight Node suites below
node tests/pure.test.js       # also individually: analytics, tasks, i18n, dataset, wording, surface, gas-sim
```

| Suite | What it covers |
| --- | --- |
| `tests/pure.test.js` | overlap maths, duration summing, validation, strict dates, `cellSafe`, `UserError`, storage-limit message |
| `tests/analytics.test.js` | work-state classification, daily breakdown, CSV escaping and formula neutralisation, invitation helpers, employee search/filter |
| `tests/tasks.test.js` | the transition table (every move, no invalid one, two claims → exactly one wins), displayed status, overdue, priorities, task filters |
| `tests/i18n.test.js` | dictionary parity/coverage, language precedence and persistence (the real client runtime in a vm with a DOM stub), error codes, no hard-coded visible text |
| `tests/dataset.test.js` | the generated company dataset: exact counts, 10 distinct `example.com` employees, 20 distinct Russian pool tasks, referential integrity, status/owner consistency, non-overlapping weekday sessions, activity story, determinism, columns match the sheet headers |
| `tests/wording.test.js` | no demonstration wording in either dictionary, either page, the client scripts, the server error pages, the dataset or the invitation e-mail; removed keys are gone |
| `tests/surface.test.js` | public-function allowlist, `api_*` gating, admin guards, **employee APIs take only a token and authenticate first**, task moves re-read the row under the lock, pages call only their own APIs, no HTML sinks in client code, responsive/ARIA structure, manifest scopes |
| `tests/gas-sim.test.js` | runs the **real** `src/*.gs` (including every `runTests` test) against an in-memory **simulation** of Sheets/Properties/Lock/Cache/MailApp: seeding (idempotent, keeps unrelated rows), the 20-task pool (claim once, manager assignment), per-employee token isolation, timers, dashboard reconciliation, CSV, migration, cleanup, caps, invitations |
| `tests/live/accept.js` | **write-phase** end-to-end run against a deployed URL in a fresh signed-out Chrome: create employees/projects/tasks, claim, race, assign, timers, comments, reports, CSV, responsive, security probes (not part of `npm test`) |
| `tests/live/accept-data.js` | **read-only** run against the seeded dataset: exact counts, every employee link, pool in the Employee UI, filters, reports/CSV/date boundaries, validation states, responsive, security (not part of `npm test`) |

**Apps Script integration suite** (`runTests`, writes only to `Test_*` sheets; the
mail service is replaced by a test double): Project Settings → Script properties →
`ADMIN_MODE` = `runTests` → run `runTests` → View → Logs (expect `N/N passed`).

### Test results (actual, by environment)

| Environment | Suite | Result |
| --- | --- | --- |
| Local Node | pure / analytics / tasks / i18n / dataset / wording / surface | **50 / 26 / 16 / 26 / 17 / 6 / 25** passed |
| Local Node, in-memory **simulation** (not Apps Script) | `gas-sim.test.js` (including its simulated `runTests`) | **60/60** |
| Deployed app (v8), signed-out headless Chrome | `tests/live/accept.js` (write phase) | **110/110** |
| Deployed app, seeded data | `tests/live/accept-data.js` (read phase) | **pending** (needs the owner to run `resetDemoData`) |
| Real Apps Script editor | `runTests` | **pending** (needs the owner to arm `ADMIN_MODE=runTests`; the simulation is not a substitute) |

## Live verification of the deployed URL

Both drivers use a fresh, signed-out Chrome profile over the DevTools protocol
against the public URL; nothing is mocked. `docs/live-write-phase-v8.log` is the
output of the final write-phase run. Earlier runs of the same script failed only
on mistakes in the script itself (reading a list before the server answered, a
fixed sleep shorter than a slow server response, a stale card that the page's own
60-second refresh had already removed, a data row of an earlier run matching the
wording scan) — no result was edited to pass; each was fixed by waiting for the
real condition or scoping the check, and the application was not changed for any of them.

| Area | What was executed |
| --- | --- |
| Access, layout | Manager opens with no sign-in; dark persistent sidebar with seven sections and a profile/language block; no banner, notice or footer about a demonstration |
| Languages | Russian: brand, navigation, no English interface text on any of the seven views; switch back; the choice survives a reload; no demonstration wording on any view in either language |
| Employees | Create two (invitation skipped for reserved-domain addresses, in the selected language); duplicate refused; search without a network request; empty result message; link, retry |
| Projects, tasks | Create a project (duplicate refused); tasks as pool / draft / direct assignment; statuses, priorities, overdue indicator; hostile title shown as text; filters by project, status, priority, employee, deadline and text |
| Shared pool | Employee sees the published tasks; search, project and priority filters; **Take task**; the task leaves the pool; a **second employee with a stale card is refused by the server** and via the API (`task_not_available`) |
| Assignment | Manager assigns a pool task: same row, details kept, gone from other pools, in the assignee's *My tasks*; others cannot claim, start, finish or comment on it |
| Timer | Start on the claimed task; another task's Start disabled and refused by the server; dashboard "working now"; refresh restores the timer; Pause freezes it; Resume continues; history; Finish |
| Comments | Employee comment kept as text; Manager sees author and replies; employee sees the reply; a third party can neither read nor write that thread |
| Dashboard, reports, CSV | Counts by status equal the rows; tracked time = report = daily = per-employee = per-project = workload; cards show exactly these numbers; CSV (BOM, Russian headers incl. project, one line per session, no raw formula) downloaded and equal to the server's text |
| Responsive | No horizontal overflow on any Manager or employee view at 1366, 820 and 390 px; mobile menu opens and closes; `aria-current`, labelled selector, skip link, focus-visible rule |
| Security | Internal functions not callable; owner-only functions refuse (`not armed`); spreadsheet id and workspace tokens absent from every page, frame and response; id/token not interchangeable; no stack traces; no JavaScript error on any page |

The read-only run over the seeded dataset is **pending** the owner loading it.

**Not verified:** a real email delivery; Safari/Firefox or a physical phone;
visual fidelity beyond the three emulated widths; concurrent anonymous load or
quota exhaustion; a true *simultaneous* double-claim (the live test uses a stale
second client; the lock behaviour under parallel executions is by design of
`LockService`, not measured); a raw HTTP client calling private functions without
the page's `google.script.run`.

## Known limitations

- **No authentication; shared data.** Anyone with the URL can read and change everything, including every workspace link, and can call the Manager APIs directly (also with an employee link in hand).
- **Runs as the owner.** Scopes `spreadsheets`, `script.send_mail`, `script.scriptapp`.
- **Mail is a spam-relay risk by nature.** Caps (20/day, 2 per recipient) and the kill switch bound it; set `EMAIL_DISABLED=true` if that is unacceptable.
- **Quotas.** Anonymous traffic and mail consume the owner's quotas; each request reads whole sheets (sized for the row caps), so responses take a few seconds.
- **Arming window.** Between adding `ADMIN_MODE=<function>` and running it, a visitor could call that same function first.
- **Reassigning an owned task is not supported** (an assigned task can only be finished); a manager cannot close a task for an employee; priorities are low/medium/high.
- **Times are UTC**; no pagination; the activity log is best effort; the Manager has no individual identity (comments are labelled "Manager").
- **Google's own banner.** Apps Script web apps served to other users show a Google-owned strip ("This application was created by another user"); it is outside the app and cannot be removed from code.
- **Seeded data is loaded by the owner.** The generated dataset is written by `seedAssessmentData`/`resetDemoData`, which the owner must arm in the editor; the automation cannot do that.

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
  Code.gs        doGet, 29 api_*, safeApi_ (coded errors), access gate
  Config.gs      DEFAULT_CONFIG, DEMO_CONFIG (limits, email caps), spreadsheet lookup (memoised)
  Tasks.gs       task rows, transitions (claim/assign/publish/…), decorated views
  Projects.gs    projects, comments, activity log
  Sessions.gs    timers per task; Employees.gs, Reports.gs, Repository.gs, Setup.gs (migration, cached check), Utils.gs
  Analytics.gs   dashboard and CSV export
  Email.gs       invitations: capability probe, caps, log, test-double hook
  Demo.gs        adminOnly_, environment checks, assessment_seed_, seedAssessmentData, resetDemoData, cleanupTestArtifacts
  dataset.gs     deterministic, idempotent company dataset builder (pure; also loaded by Node tests)
  pure.gs        pure logic (also loaded by Node tests)
  i18n.gs        dictionaries (ru/en), language rule, error codes, email/CSV texts
  Tests.gs       Apps Script integration tests (runTests, owner-armed)
  manager.html, manager_js.html, employee.html, employee_js.html, common_js.html, i18n_js.html, styles.html
tests/
  pure, analytics, tasks, i18n, dataset, wording, surface, gas-sim (+ gas-sim.js, load-pure.js, load-i18n.js), run.js
  live/accept.js (write workflows), live/accept-data.js (read-only, seeded data), live/shots.js, live/cdp.js   signed-out browser acceptance + screenshots (dependency-free)
package.json     `npm test`
```
