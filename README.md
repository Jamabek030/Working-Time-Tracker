# Working-Time Tracker

A small web application for tracking employees' working time and handing out
tasks, in **Russian and English**. Managers create projects and tasks, publish
tasks to a shared pool or assign them to people, and read reports; employees
open a personal link, take or receive a task and run a timer on it
(start / pause / resume / finish).

- **Source code:** https://github.com/Jamabek030/Working-Time-Tracker (branch `claude/sharp-planck-6en0ks`, the repository's only branch)
- **Working demo (optional, version 8):** https://script.google.com/macros/s/AKfycbzV_EGldUPBy51pOdbVu8Y99O42QVJnsmSKtoqx234oI4qHcuvefSj1FmzAlpqG-jyXWA/exec

> ## Read this first: not for real employee data
> This is an **assessment build**, not a production system.
> - **The demo has no login.** Anyone who has the URL is a Manager and can read and change *everything*, including every employee's workspace link. An employee link does not grant Manager access, but nothing in the demo prevents a visitor from calling the Manager functions directly.
> - The demo data are **fictional** (10 invented employees on the reserved `example.com` domain, invented projects and tasks).
> - Do **not** enter real people's data. A real deployment would need authentication, which this project does not have.
> - Google shows its own "created by another user" strip above any Apps Script web app; the app cannot remove it.

## Contents

1. [Project overview](#1-project-overview)
2. [Features and user roles](#2-features-and-user-roles)
3. [Technology stack and architecture](#3-technology-stack-and-architecture)
4. [Prerequisites and setup](#4-prerequisites-and-setup)
5. [How to run and access the application](#5-how-to-run-and-access-the-application)
6. [Main user workflows](#6-main-user-workflows)
7. [AI-assisted development: tools and models](#7-ai-assisted-development-tools-and-models)
8. [Representative AI prompts and their outcomes](#8-representative-ai-prompts-and-their-outcomes)
9. [Bugs discovered and fixes implemented](#9-bugs-discovered-and-fixes-implemented)
10. [Testing strategy and results](#10-testing-strategy-and-results)
11. [Required scenario checks](#11-required-scenario-checks)
12. [Known limitations and security considerations](#12-known-limitations-and-security-considerations)
13. [Repository and demo links](#13-repository-and-demo-links)
14. [Appendix: reference details](#14-appendix-reference-details)

How to read the evidence: every test result is labelled with the **environment**
that produced it - Node.js, an in-memory *simulation* of Apps Script, the *real*
Apps Script editor, or the deployed app driven by a scripted browser. A
simulation is **not** the real Apps Script runtime. Where something was not
verified, this document says so.

---

## 1. Project overview

| | |
| --- | --- |
| Purpose | Record working time per task, distribute tasks, report hours. |
| Users | A **Manager** (one shared console) and **Employees** (one personal link each). |
| Languages | Russian and English, switchable in both interfaces (325 dictionary keys each). |
| Backend | Google Apps Script (V8) web app, run as its owner. |
| Storage | One Google Sheet (seven tabs). |
| Frontend | Plain HTML, CSS and vanilla JavaScript served by `HtmlService`; no framework, no build step. |
| Demo data | A generated fictional IT company: 10 employees, 5 projects, 48 tasks (20 in the shared pool), 62 work sessions, 12 comments, 236 activity rows. |

## 2. Features and user roles

**Manager console** (the base URL; no sign-in)

- **Overview:** employees, working now, on pause, open / completed / overdue tasks, tracked time for a chosen period (opens on the last 14 days), a per-day chart, time by project, tasks by status, employee workload, recent activity and comments.
- **Projects:** create projects; see each project's tasks by status and tracked time.
- **Tasks:** create a task as a *draft*, *publish it to the shared pool* or *assign it to a person*; take a pool task back; assign a pool or draft task to a specific employee; change priority and deadline; search and filter by project, status, priority, employee and deadline; per-task details with sessions, audit history and the comment thread (with a reply box).
- **Employees:** create an employee (optionally with an invitation e-mail), search/filter, see status, copy the personal workspace link, send/retry the invitation, replace (rotate) a link.
- **Reports:** date-range report, optionally for one employee, and **CSV export**.
- **Work history:** every work session of a period, filterable by employee and project.
- **Settings:** language, mail status, time-zone note (all times are UTC).

**Employee workspace** (`<base URL>?page=employee&token=<personal token>`)

- **Overview:** current task with the timer and Start / Pause / Resume / Finish, today's time, open tasks, recent comments.
- **My tasks:** every task the employee owns, with status, priority, deadline, tracked time and per-task timer buttons.
- **Available tasks:** the shared pool with search, project/priority filters and a **Take task** button.
- **Work history** and **Comments** (one thread per task, shared with the Manager).

An employee can only see and act on their own tasks; the server decides ownership from the stored row, never from ids sent by the browser.

## 3. Technology stack and architecture

| Layer | Technology |
| --- | --- |
| Runtime | Google Apps Script, V8, time zone UTC (`appsscript.json`) |
| Persistence | Google Sheets via `SpreadsheetApp` |
| Concurrency | `LockService.getScriptLock()` around every critical write |
| E-mail | `MailApp` (send-only scope), capped and logged |
| UI | `HtmlService` templates, vanilla JS, `google.script.run` |
| Deployment tool | `clasp` 3.x (Apps Script CLI) |
| Tests | Node.js (24 used here), a small in-memory Apps Script simulator, an Apps Script integration suite, a dependency-free Chrome DevTools driver |

```
Browser (manager.html / employee.html + common_js + i18n_js)
  |  google.script.run.<api_*>(args)          (only api_* is meant to be called)
  v
Code.gs   doGet, 29 api_* functions, safeApi_ (coded errors), access gate
  v
Employees / Tasks (claim, assign, transitions) / Sessions (timer) / Reports / Projects (projects, comments, activity)
Analytics (dashboard, CSV) / Email / Demo (owner-only seeding, reset, cleanup)
  v
Repository.gs   row CRUD, formula-safe writes (cellSafe), batch append, row caps
  v
Google Sheets
```

Pure logic (`pure.gs`, `i18n.gs`, `dataset.gs`) makes no service calls and is loaded unchanged by the Node tests. Columns of the seven tabs are listed in [the appendix](#data-model).

**Time-tracking rules enforced**

- Elapsed time comes from timestamps stored on the server, not a browser counter.
- A pause closes the session with a frozen `durationMs`; resuming opens a **new** session row. Time between sessions (pauses, overnight, browser closed) is never counted.
- Never two running timers for one employee.
- Dates are UTC calendar days everywhere (reports, dashboard, CSV, deadlines).

## 4. Prerequisites and setup

You can **either** just open the demo URL (nothing to install) **or** deploy your own copy.

**To deploy your own copy** you need: a Google account; Node.js 18+; `npm install -g @google/clasp`; the Apps Script API switched on at https://script.google.com/home/usersettings; and a **dedicated test spreadsheet whose title contains "test" or "demo"** (the app refuses to start on any other spreadsheet, so it cannot be pointed at real data by accident).

```bash
clasp login                                   # once; on a headless machine: clasp login --no-localhost
SHEET_ID=<id of your test spreadsheet> bash ./scripts/setup-apps-script.sh   # Git Bash on Windows
```

The script creates (first run) or refreshes a project bound to that sheet and pushes `src/*`. It never deploys, never sends e-mail and never changes access. Then, in the Apps Script editor:

1. **Deploy -> New deployment -> Web app** (the manifest already sets *Execute as: Me* and *Access: Anyone*). Copy the `/exec` URL.
2. **Optional - load the demo data.** Project Settings -> Script properties -> add `ADMIN_MODE` = `seedAssessmentData` -> select `seedAssessmentData` in the editor -> Run. It appends only what is missing; running it again adds nothing. The property is consumed on use, so every owner-only function needs it set again.
3. **Optional - run the integration tests:** `ADMIN_MODE` = `runTests` -> run `runTests` -> read the log (expect `N/N passed`). It writes only to `Test_*` sheets.

Updating a deployment later: `clasp push`, `clasp create-version "text"`, `clasp update-deployment <deploymentId> -V <n>` (keeps the same URL).

## 5. How to run and access the application

- **Manager:** open the base URL. No sign-in.
- **Employee:** Manager -> **Employees -> Details** shows that person's workspace link (copy or open it). It works on its own; e-mail is optional. Each link contains a random 160-bit token; anyone holding the link can use that workspace, and *Replace link* cancels the old one.
- **Language:** selector at the bottom of the sidebar (also in Settings); the choice is kept in the browser and in the URL.
- **Run the checks locally (no Google account needed):**

```bash
npm test                        # all Node suites + the simulated Apps Script suite
node tests/dataset.test.js      # or any single suite
```

## 6. Main user workflows

**Manager**
1. *Projects -> create a project.*
2. *Tasks -> New task:* choose *draft*, *publish to the shared pool* or *assign to a person*; set priority and deadline.
3. *Employees -> Add employee* (sending the e-mail is optional), then open *Details* for the link.
4. To hand a pool task to someone: *Tasks -> Details -> Assign*.
5. Read the *Overview* and the *Reports* page, download the CSV; read comments on a task and reply.

**Employee**
1. Open the personal link.
2. *Available tasks -> Take task* (or the Manager assigns one).
3. *My tasks -> Start*.
4. **Pause** stops the clock; **Resume** restarts it (a new work interval is opened); **Finish** completes the task (asks for confirmation).
5. *Comments* to write to the Manager; *Work history* for past sessions.

**Task life** (`TASK_TRANSITIONS`, enforced on the server): draft -> published (available) -> claimed or assigned (active) -> completed. A taken task cannot be taken again ("This task is no longer available"); a finished task cannot be restarted; an employee has at most one running timer.

---

## 7. AI-assisted development: tools and models

Only tools and models that the repository itself evidences are named.

| Tool / model | Evidence | What it did |
| --- | --- | --- |
| **Claude Code** with **Claude Opus 4.7** | `Co-Authored-By: Claude Opus 4.7` trailer and a `Claude-Session` link on commits `36a4cff`, `f46809d`, `b2a2ed3`, `0d737a7` | Drafted the first application, the audit remediations F-01...F-18, the early README and the first setup script. |
| **Claude Code** with **Claude Sonnet 5.5** | `Co-Authored-By: Claude Sonnet 5.5` trailer on commits `b44f304`, `e6c7db9`, `5ef9c27`, `92604a1`, `89ef218`, `68d48ea`, `5582845`, `a95d592`, `acf3277`, `e33b8a0`, `ec12261` and the later commits of this documentation task | Setup fixes, security hardening, deployment, invitations / localization / dashboard, the redesign with the shared task pool, the assessment dataset, the test-failure diagnoses, and this document. |

Check it yourself: `git log --format='%h %b' | grep -i co-authored`.

**Division of work.** The Product Owner (repository owner) gave the task briefs, approved or declined actions, set the owner-only Script Properties, and **ran the real Apps Script test suite in the editor** (the logs in section 10 are theirs, pasted into the AI session and saved in `docs/`). The AI wrote code and the Node/simulated tests and ran them on the owner's machine and, under the owner's explicit instructions, used `clasp` to push code and create or update the web-app deployment (see the messages of commits `5ef9c27`, `89ef218`, `68d48ea` and `clasp list-versions`).

**What is *not* claimed.** No AI model independently ran the real Apps Script suite, sent a real e-mail, or tested in Safari, Firefox or on a phone. No other AI tool is evidenced. The chat transcripts are not stored in the repository, so the prompts below are either *recorded* (as written in the repository's history) or *reconstructed* (abbreviated from the task briefs of the work sessions), labelled as such.

## 8. Representative AI prompts and their outcomes

**A. Recorded in the repository** - listed in the README of commit `b2a2ed3`, written by Claude Opus 4.7 as "example prompts used during development"; these are not verbatim transcripts.

| # | Prompt (as recorded) | Outcome | How it was validated |
| --- | --- | --- | --- |
| A1 | "Design the Google Sheets data model for an employee time tracker where pause creates an auditable interval and resume opens a new one." | The `WorkSessions` model: one row per work interval, a frozen `durationMs`, resume = new row, so a past duration is never edited. | `test_startPauseResume_` (resume creates a new row), `test_sumAcrossSessions_`. |
| A2 | "Add a `LockService.getScriptLock()` wrapper around start/pause/resume/finish so two concurrent requests cannot create a duplicate active session." | The "at most one running timer" invariant; the same pattern later guards claiming and assigning. | `test_noDuplicateActiveTimer_`; simulated one-timer and double-claim tests. Truly parallel executions were **not** measured. |
| A3 | "Write Node tests for an `overlapMs(sessionStart, sessionEnd, rangeFrom, rangeTo, nowMs)` function returning the overlap of a session with a date range in ms, treating a null sessionEnd as nowMs." | The pure overlap function behind every report, dashboard and CSV total. | `tests/pure.test.js`, `tests/analytics.test.js`. |
| A4 | "Write a `cellSafe(value)` that prefixes a leading apostrophe to any string whose first non-whitespace/control character is `=`, `+`, `-`, `@`, or `\|` ..." | Spreadsheet formula-injection protection at the single write boundary (defect D1). | Node tests; `test_formulaInjectionNeutralized_`; a downloaded CSV checked in the live run. |

**B. Reconstructed** - abbreviated task briefs given to Claude Code (Sonnet 5.5) in the later sessions. The wording is shortened; intent and constraints are faithful to the briefs.

| # | Brief (reconstructed) | Outcome | How it was validated |
| --- | --- | --- | --- |
| B1 | "Review every publicly callable server function, make the app safe to expose with no sign-in, add isolation and tests; do not deploy until reviewed." | Underscore-private internals, function-bound `ADMIN_MODE` arming, access check before any sheet work, row caps, sheet-title guard (D6); `tests/surface.test.js`. | The surface test pins the exact public functions; later probed from the deployed page. |
| B2 | "Upgrade for assessment: safe invitation e-mail, complete ru/en localization, dashboard, CSV, search, demo-data safety; no real mail in tests." | `Email.gs` (caps, kill switch, hashed log, reserved domains), `i18n.gs`, `Analytics.gs` (D7). | i18n tests (dictionary parity, no hard-coded text); mail tests use a test double. |
| B3 | "Redesign to match the reference mock-up; add projects, a shared task pool, individual assignment, employee comments, claiming enforced on the server." | `Tasks.gs` transitions, `Projects.gs`, sidebar UI; claim/assign under the lock (D9). | `tests/tasks.test.js`, simulated and live duplicate-claim checks. |
| B4 | "Final assessment readiness: remove all demonstration messaging, generate a coherent fictional IT-company dataset (10 employees, projects, tasks, sessions) and 20 realistic Russian pool tasks, verify end to end, do not weaken tests." | `src/dataset.gs`, `assessment_seed_`, neutral UI (D13); `tests/dataset.test.js`, `tests/wording.test.js`. | Node + simulated + live read/write runs (section 10). |
| B5 | "Diagnose the real `runTests` failure `Document ... is missing`: find the real cause, do not suppress it, do not reset the dataset." | Measured the spreadsheet-service calls (14,873 vs 5,409), batched the seeding (D14). | Five regression tests; real re-run 53/53. |
| B6 | "A passing run logged `invitation send failed: ... email`; prove whether a real e-mail was attempted." | Traced to a test double that throws on purpose; marked it SIMULATED and added a guard that refuses real mail during `runTests` (D15). | Regression tests; real re-run shows the marked line. |

## 9. Bugs discovered and fixes implemented

IDs `F-nn` are the audit findings recorded in the commit messages. A "root cause" is stated only where it was established; D8, D12 and D15 are tooling, layout and test-clarity problems rather than application-logic defects, and D14 is explained below.

| ID | Observed behaviour / risk | Root cause | Fix | Where | Verification |
| --- | --- | --- | --- | --- | --- |
| D1 (F-01) | A name such as `=HYPERLINK(...)` typed into a form would be *evaluated* when someone opens the spreadsheet. | Untrusted text was written to cells unescaped. | `cellSafe` at the write boundary prefixes `'` (also after whitespace / control characters); CSV cells use the same rule. | `f46809d`; `pure.gs`, `Repository.gs` | Node tests, `test_formulaInjectionNeutralized_`, live CSV check. |
| D2 (F-02, F-03) | Creating an employee could leave a half-created record; two simultaneous creates could both pass the duplicate-e-mail check. | Several writes outside one lock. | Employee, first task and duplicate check share one lock, with a compensating delete. | `f46809d`; `Employees.gs` | Integration tests; duplicate e-mail refused in the live run. |
| D3 (F-12, F-13) | A session row with a missing or invalid duration gave a silent zero or a wrong total. | Totals trusted `durationMs` blindly. | Fall back to `endTime - startTime` and surface warnings; refuse to close a session whose start cannot be parsed. | `f46809d`; `pure.gs`, `Sessions.gs` | `test_sumSessionMsFallsBackToTimestamps_`, `test_closeSessionRejectsBadStart_`. |
| D4 (F-07, F-16) | Lenient date strings could shift report ranges; the cross-day test did not really straddle midnight. | Non-strict parsing; weak fixtures. | Strict `YYYY-MM-DD` with calendar validation and UTC day bounds; fixtures before and after 00:00 UTC. | `f46809d` | `test_strictDateParsing_`, `test_crossDayNoOvernight_`. (The second half was a *test* defect.) |
| D5 (F-17) | A sheet whose header row had been blanked could be rewritten over existing data. | `ensureSheet_` rewrote headers unconditionally. | Refuses when data rows exist below a blank header. | `f46809d`; `Setup.gs` | `test_ensureSheetRefusesToOverwriteDataWithBlankHeaders_`. |
| D6 (F-19...F-25) | **Every top-level function is callable from any browser** through `google.script.run`, including internals and admin helpers. | Apps Script exposes all functions whose names do not end in `_`. | Internals renamed with a trailing `_`; owner-only functions require `ADMIN_MODE=<own name>`, checked and consumed under the lock; access checked before any sheet is created. | `e6c7db9` | `tests/surface.test.js` pins the public list; the live runs call internal and owner-only functions and get "not callable" / "not armed". |
| D7 | Anonymous visitors could make the owner's account mail arbitrary addresses (found in the audit; not exploited). | By design a public page runs as its owner. | Reserved domains never mailed; 20/day and 2-per-recipient caps reserved under the lock; hashed log; `EMAIL_DISABLED` kill switch; send-only scope. | `92604a1` (+ `e6c7db9`); `Email.gs` | Automated mail tests use a test double. On 2026-10-31, the owner separately verified one real invitation end to end: employee creation, invitation email, opening the emailed workspace link, and confirming the employee workflow. Broad delivery reliability remains untested. |
| D8 | `setup-apps-script.sh` always reported "not logged in", and the first push lost the manifest scopes. | clasp 3.x removed `login --status`; `clasp create` overwrites `src/appsscript.json`. | Use `clasp show-authorized-user`; stage the manifest after `create`. | `b44f304`; `scripts/setup-apps-script.sh` | Re-run of the script. |
| D9 (F-29...F-31) | Design review: an employee could try to start, finish, comment on or claim another employee's task by guessing ids; two employees could take the same pool task. | Ownership and claims were not yet decided on the server. | Employee APIs take only the token; ownership is read from the stored row; a claim re-reads the row inside the lock and checks the transition table. | `89ef218`; `Tasks.gs`, `Code.gs` | `test_claimTaskOnlyOnce_`, `test_employeeCannotUseAnotherEmployeesTask_`; simulated and live stale-card claim (`task_not_available`). |
| D10 | In the new employee screen *Start, Pause, Resume and Finish* all showed at once. | A global `button { display: inline-block }` overrode the `hidden` attribute. | `[hidden] { display: none !important }`. | `89ef218`; `styles.html` | Found in a screenshot; the live run now asserts which buttons are visible. |
| D11 | Creating an employee took about 12 s and the form stayed disabled. | Every request re-verified eight sheets; three lists reloaded in sequence. | Spreadsheet handle reused per request, sheet check cached for 120 s (never bypassing the access check), only the affected list reloaded. | `89ef218`; `Config.gs`, `Setup.gs` | Timed in the live run. |
| D12 | Table headers broke mid-word; the employees table overflowed on a tablet. | CSS. | Stacked tables on narrow screens, `nowrap` headers. | `92604a1`; `styles.html` | Live overflow check at 1366 / 820 / 390 px. |
| D13 | Visible demonstration banner, footers and notices on the working screens. | Requirement change for the assessment. | Removed from both interfaces and from error and e-mail texts; real operational messages kept. | `68d48ea` | `tests/wording.test.js` (dictionaries, pages, scripts, dataset, e-mail) and a live scan in both languages. |
| D14 | **The first real `runTests` run died after about 5 minutes** with `Exception: Document "<id>" is missing (possibly deleted, or you don't have access)` at `Tests.gs:112` (`sheet.getLastRow()` in `resetTestSheets_`). | **Not a configuration error:** one property, one `openById`, no hard-coded id, and the same id had just been used by `resetDemoData`. What was measured in the simulator: seeding wrote 373 rows with one `appendRow` each, 1,513 spreadsheet calls per seed and nine seeds per suite, so the suite made **14,873** calls against **5,409** for the previous version. The harness also guarded only the test body and logged only at the end. *Google's own reason for returning that message under such load cannot be observed from outside the real runtime.* | `appendRows_` (one cap check and one `setValues` per sheet): a seed is now **51** calls, the suite **5,021**. Each test, including its reset, is guarded and logged immediately; a 300 s budget reports unstarted tests as `NOT RUN` failures. | `acf3277`; `Repository.gs`, `Demo.gs`, `Tests.gs` | Five regression tests (call budget, batch-cap atomicity, failure attribution, time budget) that fail on the old code; real re-run **53/53**. |
| D15 | A passing real run logged `Error invitation send failed: Service invoked too many times for one day: email.`, which looks like a real quota error. | Not an application defect: the failure-path test's mail double **throws that text on purpose** and the production code logs every failed send. `MailApp.sendEmail` is reached only when no double is installed, and every invitation call in `Tests.gs` runs inside the double, so **no real e-mail was attempted**. | The simulated message is marked `SIMULATED (test double)` and announced in the log; `runTests` sets `mailBlockedForTests_`, so a delivery without the double is refused. | `e33b8a0`; `Email.gs`, `Tests.gs` | Regression tests (only the SIMULATED line appears; the block is on during and off after the run, also after failures) and a static test; the real re-run shows the marked line. |

**Mistakes in the test scripts themselves** (not in the application; no result was edited to pass, each was fixed by waiting for the real condition or by scoping the check): reading a list before the server answered; a fixed sleep shorter than a slow server response; a stale card that the page's own 60-second refresh had already removed; a wording scan that matched old test records; a wrong field name for report sessions; waiting on a progress message instead of the final one. The very first live run missed one check because it reused a fixed e-mail (`5ef9c27`).

---

## 10. Testing strategy and results

Three kinds of automated checks, deliberately separated, plus scripted browser runs against the deployed app. The figures below are automated results; screenshots were also inspected during development (D10 was found that way). **Automated tests did not send real e-mail.** Separately, on 2026-10-31, the owner manually completed an end-to-end workflow with a real invitation email and employee link; this manual check is described below and is not included in the automated test counts.

### 10.1 Node.js suites - `npm test` (local, no Google services)

| Suite | Result | Covers |
| --- | --- | --- |
| `tests/pure.test.js` | **50/50** | overlap maths, duration summing, validation, strict dates, `cellSafe`, `UserError`, storage-limit message |
| `tests/analytics.test.js` | **26/26** | work-state classification, daily breakdown, CSV escaping and formula neutralisation (**including the empty CSV**), invitation helpers, search/filter |
| `tests/tasks.test.js` | **16/16** | the transition table (every move, no invalid one, two claims -> exactly one wins), displayed status, overdue, priorities, filters |
| `tests/i18n.test.js` | **26/26** | dictionary parity and coverage, language precedence, the real client runtime in a `vm`, error codes, no hard-coded visible text |
| `tests/dataset.test.js` | **17/17** | the generated dataset: exact counts, 10 distinct `example.com` employees, 20 distinct Russian pool tasks, referential integrity, non-overlapping weekday sessions, determinism |
| `tests/wording.test.js` | **6/6** | no demonstration wording anywhere visible |
| `tests/surface.test.js` | **26/26** | public-function allow-list, access gates, employee APIs take only a token, no HTML sinks in client code, mail test double always installed, manifest scopes |

Total **167** Node checks, all passing.

### 10.2 Simulated Apps Script - `tests/gas-sim.test.js` (**not** the real runtime)

**71/71 passed.** It executes the *real* `src/*.gs` files against an in-memory imitation of Sheets, Properties, Lock, Cache, Logger and MailApp. It checks the code's logic and its use of those services; it cannot show that Google's services behave the same. It also runs the whole integration suite below in simulation (53/53).

### 10.3 Real Apps Script - `runTests` in the editor (53 tests, run by the owner)

| Run | Result | Evidence |
| --- | --- | --- |
| Earlier 28-test suite | 28/28 | reported by the project owner to the AI session; no log is stored in the repository |
| First run of the current suite | **failed** (`Document ... is missing`) | owner's report; fixed as D14 |
| Second run (before the D15 change) | 53/53 in 254 s | owner's report; its log contained the then-unmarked simulated line |
| **Latest run** | **53/53 passed in 262 s** | `docs/real-runTests-2026-10-31.log` (the owner's full log, verbatim) |

In the latest log the only error-level line is the intentional `invitation send failed: SIMULATED (test double): ...`, announced by a `NOTE:` line. The AI did not execute this suite. It writes only to `Test_*` sheets and uses the mail test double.

### 10.4 Deployed app (version 8) driven by a signed-out headless Chrome (DevTools protocol)

| Driver | Result | What it did |
| --- | --- | --- |
| `tests/live/accept.js` (write phase) | **110/110** (`docs/live-write-phase-v8.log`) | created employees, projects and tasks, claimed a pool task, refused a second claim, assigned, ran timers, comments, reports, CSV, responsive widths, security probes. Run **before** the dataset was loaded; its test records were then removed by the owner's reset. |
| `tests/live/accept-data.js` (read-only) | **91/91** (`docs/live-read-phase-seeded-v8.log`) | exact counts, every one of the 10 employee links, the 20 pool tasks in the Employee UI, filters, reports, CSV, date boundaries, the **empty Reports screen**, validation states, responsive widths, security probes. |

These ran against the deployed URL with nothing mocked. They do **not** cover other browsers, a physical phone, concurrent load or real e-mail delivery.

> The figures are for the code at commit `ec12261`, plus a later commit that added two simulated tests (timer restart, empty report) and one live check (empty Reports screen). That commit changed test files only, so the real Apps Script result of 53 tests is unaffected and still holds.

## 11. Required scenario checks

"Real" means the owner-run Apps Script suite (53 tests).

**Manual end-to-end check by the project owner (2026-10-31; separate from automated test counts).** The owner created a new employee, sent the invitation by e-mail, opened the employee workspace from the received link, assigned work, posted an employee comment, then returned to the Manager console and confirmed the comment was visible and the employee's work activity was reflected there. This verifies that specific manager-to-employee-to-manager flow in one real session; it does not establish broad e-mail deliverability or concurrency behavior.

| Scenario | Node | Simulated | **Real Apps Script** | Deployed app | Status |
| --- | --- | --- | --- | --- | --- |
| **Start, stop (pause) and restart (resume) the timer** | `nextStateAfter` rules | `timer on a chosen task...`; **new:** `restarting the timer three times opens three sessions...` | `test_startPauseResume_` (resume opens a new row; a second pause is refused), `test_reloadRestoresState_` | `accept.js` G13-G22: start, pause freezes the time, resume continues, a refresh restores the timer, finish | **Verified** |
| Only one running timer; restart refused while one runs or after Finish | - | `finishing one task leaves...`; **new:** `the stopped time between restarts is never counted, and a restart is refused...` | `test_noDuplicateActiveTimer_`, `test_oneTimerPerEmployeeAcrossSeveralTasks_`, `test_pauseWithNoActiveSessionRejected_` | G15, G16 (second timer refused by the UI and the server) | **Verified** |
| **Correct duration across several sessions** | overlap and sum tests | `tracked time stays on the right task and equals the sum of its sessions`; **new:** three sessions of 5, 10 and 15 min equal the task, report, dashboard and CSV totals | `test_sumAcrossSessions_`, `test_crossDayNoOvernight_` (the overnight gap is excluded) | G21, I9, J3 (task = sum of sessions = report = dashboard) | **Verified** |
| **Empty report (no applicable records)** | `buildReportCsv: empty report is a valid header-only file` | `CSV export ... empty range`; **new:** `an empty report is a clean, empty answer in every way it can occur` (no work yet, a period before the work, an employee without sessions, CSV header only, invalid or reversed ranges refused) | `test_emptyReport_` (no data), `test_assessmentReportsMatchSessions_` (empty range) | `accept-data.js` H1b: the Reports screen shows "В выбранном периоде активности нет." for a past period and for today; also the empty dashboard (J8) and empty history (H9) | **Verified** |
| Claim a pool task; **duplicate claim refused** | two claims -> exactly one wins | pool lifecycle and claim races | `test_claimTaskOnlyOnce_`, `test_cannotClaimDraftOrCompletedOrAssignedTasks_` | G7-G12: a second employee with a stale card is refused by the server (`task_not_available`) and by the API; the owner is unchanged | **Verified** (a truly *simultaneous* double claim was not measured) |
| Manager assigns a shared task | transition table | assigning keeps one row | `test_assignPoolTaskToEmployeeKeepsOneRow_` | H1-H6 | **Verified** |
| **Comments and Manager visibility** | - | comments are owned, append-only; a third party is refused | `test_commentsAreOwnedAppendOnlyAndVisibleToTheManager_` | I1-I6: an employee comment reaches the Manager as text with its author, the Manager's reply reaches the employee, another employee is refused | **Verified** |
| Error and boundary conditions | strict dates, length limits, `UserError` | invalid dates, over-long range, foreign ids refused | `test_invalidInputsRejected_`, `test_lengthLimitsEnforced_`, `test_strictDateParsing_`, `test_validationMessagesAreUserSafe_` | read run: invalid and duplicate e-mail, reversed / over-long / invalid ranges, foreign ids and guessed tokens refused | **Verified** |
| Each employee's link opens the right workspace; no cross-employee access | - | per-token isolation | `test_employeeCannotUseAnotherEmployeesTask_` | read run D1, F1, F2: all 10 links | **Verified** |
| Russian / English everywhere | dictionary tests | - | - | no English text left on any view in Russian; the choice survives a reload | **Verified** (automated) |
| Real invitation email and employee link | - | Mail tests use a test double | - | Owner manually created an employee, sent the invitation, opened the workspace link from the received email, and verified the employee workflow | **Manually verified once**; repeatability across recipients/providers and delivery reliability are not established |
| Two truly simultaneous requests; other browsers; a phone | - | - | - | - | **Not verified** |

**Manual steps for the remaining unverified items.** *Simultaneous claim:* open two employee links and click *Take task* on the same card at the same moment; expect one success and one "no longer available". *Other devices:* open the demo URL in the browser or on the phone of interest. For e-mail, one real end-to-end invitation has been verified by the owner; broader delivery testing across recipients and mail providers remains outstanding.

**What passing tests do not prove.** They show that these workflows behave as specified in the environments named. They do not show that the app is safe for real data (section 12) or that mail is delivered.

---

## 12. Known limitations and security considerations

- **No authentication; shared data.** Anyone with the URL can read and change everything, including every workspace link, and can call the Manager functions directly (also while holding only an employee link). **Not suitable for real employee data or production use.**
- **Runs as the owner.** Anonymous traffic consumes the owner's Apps Script quotas; the scopes are `spreadsheets`, `script.send_mail` and `script.scriptapp`.
- **E-mail is a spam-relay risk by nature.** Mitigated by caps (20 per day, 2 per recipient), reserved-domain skipping, a hashed log and the `EMAIL_DISABLED=true` kill switch. The owner manually verified one real invitation end to end on 2026-10-31; delivery reliability across multiple recipients/providers and spam-folder behavior have not been established.
- **Arming window.** Between adding `ADMIN_MODE=<function>` and running that function, a visitor could in principle call the same function first (the property is function-bound and consumed on use).
- **Seeded data is loaded by the owner**; the automation cannot arm the property. `resetDemoData` is destructive for all app sheets; `seedAssessmentData` is not.
- **Google's own banner** above the app cannot be removed from code.
- **Product limits:** an owned task cannot be re-assigned and a Manager cannot close a task for an employee; priorities are low/medium/high; times are UTC; no pagination; the activity log is best effort; the Manager has no personal identity (comments say "Manager"); each request reads whole sheets (sized for the row caps), so a response takes a few seconds.
- **Not verified:** delivery reliability across multiple recipients/providers, Safari/Firefox/phones, concurrent load or quota exhaustion, a truly simultaneous double claim, a raw HTTP client calling private functions outside the page.
- **Repository hygiene.** `.clasp.json` and credentials are git-ignored. The logs in `docs/` were scanned and contain no tokens or spreadsheet ids. The spreadsheet id of the test sheet appears in older commits (in a comment of the setup script, now replaced by a placeholder); it is not a credential, but that sheet must not be shared publicly.

## 13. Repository and demo links

- Source: https://github.com/Jamabek030/Working-Time-Tracker (branch `claude/sharp-planck-6en0ks`)
- Demo (Apps Script web app, deployment version 8; the URL returned HTTP 200 when this document was prepared on 2026-10-31): https://script.google.com/macros/s/AKfycbzV_EGldUPBy51pOdbVu8Y99O42QVJnsmSKtoqx234oI4qHcuvefSj1FmzAlpqG-jyXWA/exec
- Evidence files: `docs/real-runTests-2026-10-31.log`, `docs/live-write-phase-v8.log`, `docs/live-read-phase-seeded-v8.log`

---

## 14. Appendix: reference details

### Data model
`Employees`: `id | lastName | firstName | middleName | email | workspaceToken | createdAt | active`. `Tasks`: `id | employeeId | title | status | createdAt | completedAt | projectId | priority | dueDate | description | assignedAt`. `WorkSessions`: `id | employeeId | taskId | startTime | endTime | durationMs | status`. `Projects`: `id | name | description | status | createdAt`. `TaskComments`: `id | taskId | authorType | authorId | authorName | text | createdAt`. `TaskActivity`: `id | taskId | at | actorType | actorId | action | detail`. `Invitations`: `id | employeeId | emailHash | at | status | detail`.

### Task states
| From | Action | To | Who |
| --- | --- | --- | --- |
| draft | publish / assign | available / active | Manager |
| available | unpublish | draft | Manager |
| available | claim | active | the employee (identity from the token) |
| available | assign | active | Manager |
| active | complete | completed | the owner (Finish) |
| completed, replaced | - | - | final |

The displayed status of an owned task also reflects the timer: *assigned* (nothing recorded), *in progress* (a timer runs), *paused*, then *completed*. Claiming and assigning re-read the row inside the lock, so two requests can never both succeed.

### Assessment dataset
Generated by `src/dataset.gs` (`buildAssessmentDataset`; fixed ids `asm-...`, only the workspace tokens are random), relative to the moment it runs. Employees: 10 (Russian names, `name.surname@example.com`). Projects: 5. Tasks: 48 = **20 in the shared pool**, 2 drafts, 4 assigned and not started (2 overdue), 8 paused, 14 completed. Sessions: 62 weekday work blocks, non-overlapping, 127 h 50 min in total. Comments 12, activity 236.

| # | Pool task | Project | Priority |
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

### Owner-only functions (each needs `ADMIN_MODE=<function name>`, consumed on use)
- `seedAssessmentData` - non-destructive and idempotent: appends only the dataset rows whose fixed id (or, for employees, e-mail) is missing.
- `resetDemoData` - **destructive**: clears the app sheets and loads the dataset; never deletes a sheet or touches another sheet.
- `cleanupTestArtifacts` - removes only this project's own acceptance records (employees `demo.verifier.<digits>@example.com` / `inj.verifier@example.com`, projects `Acceptance project <digits>` with their tasks, sessions, comments, activity, invitations).
- `runTests` - the 53-test integration suite; writes only `Test_*` sheets.
- `enableOpenAccess`, `disableOpenAccess` - not used by this build (access is decided by the spreadsheet-title guard).

### E-mail invitations
One plain-text message with the employee's own workspace link, in the Manager's language. The employee record is saved first and is never rolled back by a delivery problem. "Accepted for delivery" means Google's mail service accepted it, not that it arrived. Safeguards: reserved domains (`example.com/.org/.net`, `.test`, `.invalid`, `.localhost`, `.example`) are never mailed; 20 per day and 2 per recipient are reserved under the lock; fixed text with only the first name (up to 60 characters) and the task title (up to 120) as plain text; each attempt is logged as a hashed recipient plus status; `EMAIL_DISABLED=true` stops all sending; `MailApp` only. Tests never reach `MailApp`: a test double is installed, and while `runTests` runs a real send is refused.

### Languages, dashboard, CSV
Both dictionaries (325 keys) live in `src/i18n.gs` with the language rule (saved choice, then `?lang=`, then browser language, then English) and the server error-code table; server errors travel as `@@code@@{params}@@English` and are translated in the browser. Dashboard figures are computed from stored rows and reconcile (status buckets sum to the task count; daily, per-employee, per-project and workload times sum to the report total). CSV is built on the server from the report rows with a UTF-8 BOM and CRLF, every text cell quoted, and any cell starting with `= + - @ |` prefixed with `'`; periods are limited to 366 days.

### Files
```
appsscript.json         manifest (V8, UTC, web app: anyone, run as owner, 3 OAuth scopes)
scripts/setup-apps-script.sh   clasp create/push (Git Bash on Windows)
src/    Code.gs (doGet, 29 api_*), Config.gs, Tasks.gs, Projects.gs, Sessions.gs, Employees.gs, Reports.gs,
        Analytics.gs, Email.gs, Demo.gs, Repository.gs, Setup.gs, Utils.gs, Tests.gs,
        pure.gs, i18n.gs, dataset.gs, manager.html, employee.html, *_js.html, styles.html
tests/  pure, analytics, tasks, i18n, dataset, wording, surface, gas-sim (+ gas-sim.js, load-*.js), run.js
        live/accept.js, live/accept-data.js, live/shots.js, live/cdp.js
docs/   the three evidence logs
package.json            npm test
```
