# Construction Daily Logs (PRD #43)

A daily log is a project's canonical record of one site day: the weather and
site condition, who was on site, the work done, equipment, deliveries,
visitors, delays, instructions, the QA/QC and HSE records of the day, photos
and documents, and the follow-up tasks it raised. It is written during the day,
submitted, reviewed by the project's reviewer and locked as the official
record. It is evidence, never a replacement for the modules around it.

```
Daily Log      = daily site evidence
Tasks          = executable work         (linked, created through TaskService, never completed here)
QA/QC · HSE    = quality and safety truth (referenced through integration links, never changed)
Procurement    = order and receipt truth  (a delivery links its PO / goods receipt, never receives goods)
Inventory      = stock truth              (a delivery links an inventory receipt, never posts stock)
Timesheets     = time allocation truth    (headcount on site is not attendance or time)
```

## Where things live

| Concern | Location |
| --- | --- |
| Types, schemas, time helpers | `lib/modules/daily-logs/daily-log.{types,schema,time}.ts` |
| Access and section grants | `lib/modules/daily-logs/daily-log.permissions.ts` |
| Company and project rules | `lib/modules/daily-logs/daily-log.settings.ts`, `/daily-logs/settings`, `PUT /api/projects/:id/daily-log-settings` |
| Create, read, list, top-level fields | `lib/modules/daily-logs/daily-log.service.ts` |
| Section entries | `lib/modules/daily-logs/daily-log.entries.ts` |
| Tasks, QA/QC and HSE links, evidence metadata, pickers | `lib/modules/daily-logs/daily-log.links.ts` |
| Submit, review, return, lock, void, corrections | `lib/modules/daily-logs/daily-log.review.ts` |
| Reports, Site Today, missing logs and reminders (job `dailylogs.missing`) | `lib/modules/daily-logs/daily-log.reports.ts` |
| Photo location stripping | `lib/modules/daily-logs/daily-log.exif.ts` |
| API | `app/api/daily-logs/**`, `app/api/projects/[projectId]/daily-logs/**` |
| UI | `app/(nesto)/projects/[projectId]/daily-logs/**`, `app/(nesto)/daily-logs/**`, `components/daily-logs/*` |

## Data

- **DailyLog** — `@@unique([companyId, projectId, workDate])`: one canonical
  log per project per day. `workDate` is the project's calendar day in the
  company's zone, stored at midday UTC. Status `DRAFT → SUBMITTED → REVIEWED →
  LOCKED`, with `CORRECTION_REQUIRED` and `VOID`. Who created, submitted,
  reviewed, locked, returned and voided it and when; the reviewer resolved at
  submission; return and void reasons; summary, notes, weather summary, site
  condition; `lateEntry`; `submissionCount`; `version` for concurrency.
- **Sections** — `DailyLogWeatherEntry`, `DailyLogWorkforceEntry`,
  `DailyLogWorkActivity`, `DailyLogEquipmentEntry`, `DailyLogDeliveryEntry`,
  `DailyLogVisitorEntry`, `DailyLogDelayEntry`, `DailyLogInstructionEntry`: one
  row per entry, edited one at a time.
- **DailyLogTaskLink** — a task on the log's project and why it is linked.
- **QA/QC and HSE links** — `IntegrationLink` rows (`integrationType
  DAILY_LOG_RECORD`, mode `REFERENCE`, source `daily_log`), cancelled rather
  than deleted on unlink.
- **DailyLogDocumentLink** — category, caption, time taken and order of a
  document uploaded against the log. The file is a normal Document with the log
  as its parent.
- **DailyLogCorrection** — an official correction appended to a locked log.
- **DailyLogSettings** (company) — logs required (off), backdating (7 days),
  reviewer required (on). **ProjectDailyLogSettings** — required on this
  project, a named reviewer, the site's working days.

## Rules

| Rule | Code |
| --- | --- |
| Not a future day; within the backdating window | `DAILY_LOG_FUTURE_DATE`, `DAILY_LOG_BACKDATE_LIMIT` |
| A day that already has a log answers with that log (also under a race) | — |
| A started-after-the-day log is marked late | `lateEntry` |
| The log is still being written (draft or correction required) | `DAILY_LOG_NOT_EDITABLE`, `DAILY_LOG_LOCKED`, `DAILY_LOG_VOID` |
| The writer holds the section's grant | `DAILY_LOG_SECTION_FORBIDDEN` |
| Headcount ≥ 1, progress 0–100, departure after arrival, delay end after start | schema |
| A delay with both times takes its duration from them | derived |
| Supplier, order, receipt, task and member of this company; order, receipt and task on this project | `DAILY_LOG_*_INVALID`, `*_PROJECT_MISMATCH` |
| A delivery on another day than the log's is flagged | `outsideWorkDate` |
| Someone changed the entry or the log since it was opened | `DAILY_LOG_ENTRY_CHANGED`, `DAILY_LOG_STALE` (409) |
| Submission needs a work activity, workforce entry or file, and a reviewer other than the submitter (when required) | `DAILY_LOG_INCOMPLETE`, `DAILY_LOG_NO_REVIEWER` |
| Nobody reviews or returns a log they submitted | `DAILY_LOG_SELF_REVIEW_BLOCKED` |
| Return and void need a reason | `DAILY_LOG_REASON_REQUIRED` |
| Corrections only on a locked log, never editing it | `DAILY_LOG_NOT_LOCKED` |
| Files are added only while the log is being written | registry `filesClosed` |

**Reviewer resolution:** the project's named reviewer, else its project manager
— an active member who can review daily logs, can open the log, and is not the
submitter. Anyone else holding `daily_log.review` on the project may also
review it.

## Access

A log is reached only through its project: the reader must be able to open the
project (projects module + `project.view` + project scope) and hold
`daily_log.view`. Anybody else gets "not found".

| Role | Level | Can |
| --- | --- | --- |
| Owner | Manage, company | Everything, including company settings |
| Project Manager | Manage, project | Write, review, return, lock, void, correct; their project's rules |
| Engineer | Contribute, assigned | Start, write every section, submit |
| CEO / Director | View, company | Read |
| Architect | View, assigned | Read; work activities and instructions |
| Procurement | View, company | Read; deliveries |
| Inventory | View, company | Read |
| QA/QC | View, project | Read; link QA/QC records |
| HSE | View, project | Read; link HSE records |
| Viewer | View, assigned | Read |
| Group IT, HR, Finance, Legal, Sales | None | — |

Linked records show their label only to readers who can open them; others see
"QA/QC record", "HSE record" or "HSE incident recorded". Tasks, orders and
receipts the reader cannot open are named as such, never by title.

## Workspace

Header with the day, status, late and corrected badges, save indicator, `+ Add`,
lifecycle actions, print and void. Summary cards (workforce, activities,
deliveries, delays, QA/QC · HSE, photos). A sticky section rail on desktop;
collapsible sections and a sticky `Add` / `Submit log` bar on a phone. Each
section lists its entries and opens one short form to add or edit an entry
(a dialog on desktop, a bottom sheet on a phone). The overview fields save on
blur. Issues that would stop submission are listed before submitting. Photos
load as lazy thumbnails with a large preview; JPEG uploads have EXIF, XMP and
IPTC removed in the browser before they are sent. Locked logs show their
official corrections beside the record. `/projects/:id/daily-logs/:logId/print`
is the print layout.

`/daily-logs` lists logs across projects, `/daily-logs/review` the reviewer's
queue, `/daily-logs/reports` the reporting, `/daily-logs/settings` the company
rules. Each project has a **Daily Logs** tab with "Start today's log".

## Notifications, attention and jobs

| Event | To |
| --- | --- |
| `DAILY_LOG_SUBMITTED` | The reviewer |
| `DAILY_LOG_RETURNED`, `DAILY_LOG_REVIEWED`, `DAILY_LOG_LOCKED` | Author, submitter and activity authors |
| `DAILY_LOG_CORRECTION_ADDED` | Contributors and the reviewer |
| `DAILY_LOG_MISSING_REMINDER` (job `dailylogs.missing`, hourly, once per project per day) | Project manager and project members who can create logs |

| Attention | Who | Until |
| --- | --- | --- |
| `DAILY_LOG_MISSING` (entity: the project) | Project manager | A log exists for the last working day |
| `DAILY_LOG_AWAITING_REVIEW` | The reviewer (never the submitter) | Reviewed or returned |
| `DAILY_LOG_RETURNED` | Author and submitter | Resubmitted |

A missing log is counted only for an **active** project that requires logs, on
its working days (the project's, else the company's), between its start and end
dates, and never for today.

## Also connected

- **Record registry** `daily_log` — documents (upload needs `daily_log.edit`)
  and discussion; author, submitter and reviewer follow it.
- **Search** — project, date and summary of logs the reader can open.
- **Dashboard** — `siteToday` (Project Manager, Architect, Engineer): the
  latest log on each active project.
- **Reporting** — logs, submitted or locked, missing, average headcount, headcount
  by trade, deliveries, activities, delays by category and impact with minutes,
  QA/QC and HSE links, photos, by project.
- **Calendar** — no deadline is configured in V0.1, so daily logs add nothing
  to the calendar.

## Seed

Riverside Residences requires logs and has three: three days back locked with a
correction, two days back submitted to the Project Manager, yesterday a draft;
with workforce, activities against tasks, equipment, a delivery against its PO
and goods receipt, a visitor, a weather delay, an instruction that raised a
task, a quality inspection and a toolbox talk linked, and site photos.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/daily-logs` | Role grants, EXIF stripping, working days, labels, entry validation |
| `tests/api/daily-logs` | One log per day and races, future and backdate, project and company isolation, sections and derived totals, cross-company and cross-project links, section grants, QA/QC and HSE links and HSE privacy, tasks through TaskService, submit/return/review/lock/void, locked immutability and corrections, missing-log attention and reminders, review attention, reporting, search |
| `tests/e2e/modules/daily-logs.spec.ts` | Engineer's day; PM notification, return, resubmission, review, lock; locked correction; cross-project refusal |
| `tests/e2e/responsive/daily-logs-mobile.spec.ts` | Field entry and submission on a phone |
| `tests/perf/daily-logs.perf.test.ts` | 100 projects × 365 logs (`NESTO_PERF=1`) |
