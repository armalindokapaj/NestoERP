# Timesheets & Work Logs (PRD #42)

`/timesheets` is where people record how their working time is spent — on
projects, tasks and internal work — and submit it week by week for approval.
It is time accounting, not payroll, not attendance and not surveillance:
attendance says someone was at work, a work log says what the time went into,
and nothing here scores anybody.

```
WorkLog (minutes, one day, one piece of work)
   ↓ grouped by member and week
Timesheet (DRAFT → SUBMITTED → APPROVED | RETURNED | REJECTED)
   ↓ submission writes a TimesheetApproval cycle + one ApprovalStep
Approvals Center (provider `timesheets`)  →  approve / return / reject
   ↓
approved hours in project reporting
```

## Where things live

| Concern | Location |
| --- | --- |
| Time arithmetic, duration parsing, labels | `lib/modules/timesheets/timesheet.time.ts` |
| Types, schemas | `lib/modules/timesheets/timesheet.{types,schema}.ts` |
| Who may read what | `lib/modules/timesheets/timesheet.permissions.ts` |
| Company rules | `lib/modules/timesheets/timesheet.settings.ts`, `/timesheets/settings` |
| Approver resolution and assignment | `lib/modules/timesheets/timesheet.approvers.ts` |
| Entries, grid cells, copying | `lib/modules/timesheets/timesheet.worklogs.ts` |
| Reading a week | `lib/modules/timesheets/timesheet.service.ts` |
| Submit, approve, return, reject, reopen | `lib/modules/timesheets/timesheet.submission.ts` |
| Team week, project summary | `lib/modules/timesheets/timesheet.reports.ts` |
| Deadline, reminders (job `timesheets.reminders`), calendar provider | `lib/modules/timesheets/timesheet.deadline.ts` |
| Approvals provider | `lib/modules/approvals/providers/timesheets.provider.ts` |
| API | `app/api/timesheets/**`, `app/api/worklogs/[workLogId]` |
| UI | `app/(nesto)/timesheets/**`, `components/timesheets/*` |

## Data

- **Timesheet** — one per company, member and week start
  (`@@unique([companyId, memberId, periodStart])`). Created lazily by the first
  entry of a week, or by the reminder job for someone who logged nothing.
  Carries its status, the approver it was submitted to, who decided and when,
  the last decision note, `submissionVersion` (one per submission) and
  `version` (optimistic concurrency for submit and decide).
- **WorkLog** — whole `minutes` (5–1,440) on one `workDate`, a `workType`
  (project work, internal, admin, training, travel, support, other), an
  optional project and task, a description, `billable` and `overtimeFlag`.
  Minutes are the only unit anywhere; hours are a display decision.
- **TimesheetApproval** — one row per submission, in the cycle shape every
  module's approvals share, with one **ApprovalStep** naming the approver and
  `approverPermission: "timesheet.approve"`.
- **TimesheetSettings** — week start (Monday), standard day and week (8 h,
  40 h), duration step (15 min, enforced or not), backdating (14 days), an
  optional submission deadline (weekday + local time), whether descriptions are
  required, whether members set billable.
- **TimesheetApproverAssignment** — the one designated approver per member.

Business dates (`periodStart`, `periodEnd`, `workDate`) are stored at midday
UTC and read in the company's time zone.

## Rules for an entry

Checked on the server for every create, update, cell edit and copy, and again
for every entry at submission:

| Rule | Code |
| --- | --- |
| Not a future day | `TIMESHEET_INVALID_DATE` |
| Within the backdating window — unless the week was returned or rejected | `TIMESHEET_BACKDATE_LIMIT` |
| 5 minutes to 24 hours; on the step if enforced | `TIMESHEET_INVALID_DURATION`, `TIMESHEET_INCREMENT` |
| Project work names a project | `TIMESHEET_PROJECT_REQUIRED` |
| The project is one the member can open, and not archived | `TIMESHEET_PROJECT_NOT_ALLOWED`, `TIMESHEET_PROJECT_ARCHIVED` |
| The task is one the member can open, on that project, and not archived | `TIMESHEET_TASK_NOT_ALLOWED`, `TIMESHEET_TASK_PROJECT_MISMATCH`, `TIMESHEET_TASK_ARCHIVED` |
| A day holds at most 24 hours | `TIMESHEET_DAILY_LIMIT` |
| The week is editable (draft, returned, rejected) | `TIMESHEET_LOCKED`, `TIMESHEET_ALREADY_APPROVED` |

Nothing takes a member id from the browser: every "my" endpoint acts for the
signed-in member. Billable defaults to the work type (project work is
billable); a member sets it only when the company allows it, an approver always.

## The week screen

- **Desktop:** a grid of rows (project · task · work type) by day. A cell saves
  when you leave it (Tab moves on, Enter saves, Escape reverts), setting that
  row's total for the day: zero removes the entry, one entry is updated, none
  creates one. A cell backed by several entries opens them instead of merging.
  Add a row, pick one of the recent rows, or copy last week's rows with or
  without their hours. "Log time" opens the detailed entry.
- **Phone:** a card per day with its entries, "Log time" on each day and on a
  sticky bar with the week total and Submit.
- The summary shows total, expected (the standard week less approved leave on
  working days), billable, non-billable, overtime above the standard week, and
  where the time went. Warnings: a day over 12 hours, attendance an hour or
  more above what was logged, missing descriptions the company requires.
  Attendance is compared, never turned into entries.
- A week below the expected hours asks before it is submitted
  (`TIMESHEET_BELOW_EXPECTED` unless acknowledged).

## Approval

**Approver resolution** (at submission, on the server): the member's assigned
approver, else their department manager — who must be an active member of the
company, hold `timesheet.approve`, and not be the member. Nobody →
`TIMESHEET_NO_APPROVER`.

**Submit** (`POST /api/timesheets/:id/submit` with `expectedVersion`) moves the
week to `SUBMITTED`, increments `submissionVersion`, writes a pending
`TimesheetApproval` and its step, notifies the approver
(`TIMESHEET_SUBMITTED`), resolves the member's missing and returned attention,
and audits — in one transaction. The entries are then read-only.

**Decide** through the Approvals Center
(`POST /api/approvals/timesheets/:approvalId/{approve|return|reject}`). Only
the step's approver, or someone they delegated approvals to, decides; never the
member (`TIMESHEET_SELF_APPROVAL_BLOCKED`). Return and reject need a reason. The
decision settles the step and the cycle, moves the week, resolves attention,
notifies the member (`TIMESHEET_APPROVED` / `RETURNED` / `REJECTED`) and
audits, in one transaction. A returned or rejected week is edited and submitted
again as a new cycle; the history keeps every cycle.

A one-step chain reads as a plain decision in the Center: no "step 1 of 1", a
single decision line with its note in the history.

**Changing an approver** (`PUT /api/timesheets/approvers`,
`timesheet.settings.manage`) moves any week already waiting, with its pending
step, to the new approver, audits `APPROVAL_REASSIGNED` and tells them.

**Reopen** (`POST /api/timesheets/:id/reopen`, `timesheet.reopen`, a note, never
your own week) sends an approved week back to its member as returned. The
reopening is on the week's history and in the audit.

## Who sees what

| Reader | Reads |
| --- | --- |
| Everyone with Timesheets | Their own weeks |
| An approver | Weeks submitted to them, weeks of people assigned to them, and — while a delegation lasts — submitted weeks of whoever delegated to them |
| Team readers (`timesheet.team.view`) | Company scope: everyone; department scope: their department; project scope: people on projects they manage |
| Project readers (`timesheet.project.view` + the project) | Hours on projects they can open; descriptions only if they are also team readers |

Anyone else gets "not found". Approved leave shows its type to the member and
only "Leave" to anyone else; attendance appears to readers with HR attendance
access.

| Role | Level | Notes |
| --- | --- | --- |
| Owner | Manage, company | Reopen, settings |
| HR | Manage, company | Reopen, settings |
| CEO / Director | Contribute, company | + project hours, approve, return, reject |
| Group IT, Architect, Engineer, Legal, Sales, Procurement, Inventory, QA/QC, HSE | Contribute, self | Log and submit own time |
| Finance | Contribute, self | + project hours (no descriptions) |
| Project Manager | Approve, project | Team and project views for the projects they run |
| Viewer | None | |

## Reporting

`/timesheets/team` lists one row per person for a week — status (including
"not started"), total, billable, overtime, how long it has waited, approver —
waiting weeks first. Roles without timesheets are not listed.

`/timesheets/projects` (and `GET /api/timesheets/projects[/:projectId]`)
aggregates in the database: totals, by project, person, task and week, and the
latest 200 entries. **Approved weeks only by default** (`include=all` for
everything logged); filters for dates (up to a year), person, task and billable.

## Deadline, reminders and attention

Only when the company sets a submission deadline. A week is due on the first
configured weekday from its fifth day: "Friday 17:00" is that week's Friday,
"Monday 12:00" the Monday after it.

- **Calendar** (provider `timesheets`, category Personal): the member's own
  deadlines, marked overdue when missed. Nothing else from timesheets is on
  the calendar.
- **Reminder** (job `timesheets.reminders`, hourly): from 24 hours before a
  deadline to 3 days after it, each member with Timesheets whose week is not
  submitted gets `TIMESHEET_REMINDER` — once per week per person.
- **Attention:**

| Condition | Who | Until |
| --- | --- | --- |
| `TIMESHEET_NOT_SUBMITTED` | The member, for the latest week past its deadline still in draft | Submitted |
| `TIMESHEET_RETURNED` | The member, for a returned or rejected week | Submitted again |
| `PENDING_APPROVAL` | The week's approver | Decided |
| `TIMESHEET_APPROVAL_OVERDUE` | The approver, when a week has waited more than 3 days | Decided |

## Also connected

- **Record registry:** `timesheet` (`/timesheets/:id`), with a discussion for
  the approver and member; no documents. Work logs are not records.
- **Dashboard:** `myTimesheet` (Project Manager, Architect, Engineer) — this
  week against the expected hours and the two weeks before.
- **Search:** work logs are not indexed.

## Seed

Approvers for every Company A role that keeps time. The Engineer's week three
back approved, two back returned with a question, last week waiting for the
Project Manager; a QA/QC week waiting too; the Architect's last two weeks
approved. Current weeks are empty. No deadline is set.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/timesheets` | Durations, weeks, totals and rows, deadlines, role permissions |
| `tests/api/timesheets` | Entries and every refusal, cells, copying, submission and lock, Approvals Center queues and decisions, self-approval, reassignment, reopen, reading access, team and project reporting, leave and attendance, calendar, reminders, attention, notifications |
| `tests/e2e/modules/timesheets.spec.ts` | Engineer's week; return, correction, resubmission, approval; project manager's project view |
| `tests/e2e/responsive/timesheets-mobile.spec.ts` | Quick log and submit on a phone |
| `tests/perf/timesheets.perf.test.ts` | 500 members × 52 weeks × 10 entries (`NESTO_PERF=1`) |

Measured on the development database with 260,000 work logs: My Timesheet
P50 5 ms / P95 11 ms; team week P95 36 ms; project month and quarter P95 118 ms
(targets 250/800 ms, 1.2 s, 1.2 s).
