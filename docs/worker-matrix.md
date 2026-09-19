# Worker matrix

Every background job NESTO runs (PRD #51 §231, §287). Generated from
`lib/core/jobs/job.registry.ts` by `pnpm verify:workers --write`; CI fails when
this file and the registry disagree, so edit the registry, not this page.

How the columns are enforced, and what to do when a job misbehaves: `docs/workers.md`
and `docs/worker-operations.md`.

| Job | Owner | Trigger | Schedule | Company scope | Idempotency key | Retry | Timeout | Criticality | Alert |
|---|---|---|---|---|---|---|---|---|---|
| `notifications.dispatch` | core/notifications | OUTBOX | every 10 s, `notifications` group | per work item's company; suspended skipped | outbox event id; each notification unique on company + recipient + event dedupe key | 5 attempts, 15 s doubling to 5 min | 5 min (lease 2 min, extended while running) | CRITICAL | `WorkerCriticalJobFailed`, `WorkerCriticalJobStale`, `NotificationOutboxBacklog`, `NotificationOutboxFailedEvents` (page) |
| `calendar.reminders` | calendar | SCHEDULED | every 1 min, `notifications` group | per company; suspended skipped | reminder id + occurrence start (unique delivery row) | 5 attempts, 15 s doubling to 5 min | 5 min (lease 2 min, extended while running) | HIGH | `WorkerCriticalJobFailed`, `WorkerCriticalJobStale` (page) |
| `notifications.due` | core/notifications | SCHEDULED | every 1 h, `scheduled` group | per company; suspended skipped | TASK_OVERDUE | CONTRACT_OBLIGATION_DUE + companyId + record id + due date | 4 attempts, 1 min doubling to 30 min | 15 min (lease 2 min, extended while running) | NORMAL | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `attention.reconcile` | core/notifications | RECONCILIATION | every 5 min, `scheduled` group | per company; suspended skipped | condition + record + episode + recipient (unique active item) | 5 attempts, 15 s doubling to 5 min | 15 min (lease 2 min, extended while running) | HIGH | `WorkerCriticalJobFailed`, `WorkerCriticalJobStale` (page) |
| `approvals.overdue` | approvals | SCHEDULED | every 1 h, `scheduled` group | per company; suspended skipped | APPROVAL_OVERDUE + companyId + approval step + company-local day | 4 attempts, 1 min doubling to 30 min | 15 min (lease 2 min, extended while running) | NORMAL | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `announcements.schedule` | announcements | SCHEDULED | every 1 min, `scheduled` group | per company; suspended skipped | announcement id + transition, guarded on the status and version read | 5 attempts, 15 s doubling to 5 min | 5 min (lease 2 min, extended while running) | HIGH | `WorkerCriticalJobFailed`, `WorkerCriticalJobStale` (page) |
| `announcements.reminders` | announcements | SCHEDULED | every 1 h, `scheduled` group | per company; suspended skipped | ANNOUNCEMENT_REMINDER + companyId + announcement id + round | 4 attempts, 1 min doubling to 30 min | 15 min (lease 2 min, extended while running) | NORMAL | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `timesheets.reminders` | timesheets | SCHEDULED | every 1 h, `scheduled` group | per company; suspended skipped | TIMESHEET_REMINDER + companyId + member + period start | 4 attempts, 1 min doubling to 30 min | 15 min (lease 2 min, extended while running) | NORMAL | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `dailylogs.missing` | daily-logs | SCHEDULED | every 1 h, `scheduled` group | per company; suspended skipped | DAILY_LOG_MISSING + companyId + project + work date | 4 attempts, 1 min doubling to 30 min | 15 min (lease 2 min, extended while running) | NORMAL | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `planning.milestones` | project-planning | SCHEDULED | every 1 h, `scheduled` group | per company; suspended skipped | MILESTONE_DUE_SOON | MILESTONE_OVERDUE + companyId + milestone + target date | 4 attempts, 1 min doubling to 30 min | 15 min (lease 2 min, extended while running) | NORMAL | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `engineering.reminders` | engineering | SCHEDULED | every 1 h, `scheduled` group | per company; suspended skipped | RFI_OVERDUE | RFI_DUE_SOON | SUBMITTAL_* + companyId + record + due date | 4 attempts, 1 min doubling to 30 min | 15 min (lease 2 min, extended while running) | NORMAL | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `contractors.compliance` | contractors | SCHEDULED | every 1 day, `scheduled` group | per company; suspended skipped | CONTRACTOR_COMPLIANCE_EXPIRING | _EXPIRED + companyId + item + expiry date | 3 attempts, 5 min doubling to 2 h | 30 min (lease 2 min, extended while running) | NORMAL | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `hr.credential-expiry` | hr | SCHEDULED | every 1 day, `scheduled` group | per company; suspended skipped | EMPLOYEE_DOCUMENT_* | QUALIFICATION_* + companyId + record + window (90/60/30/7/EXPIRED) + expiry date | 3 attempts, 5 min doubling to 2 h | 30 min (lease 2 min, extended while running) | NORMAL | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `sales.unit-reservations` | sales | SCHEDULED | every 5 min, `scheduled` group | per company; suspended skipped | UNIT_RESERVATION_EXPIRED + companyId + reservation | UNIT_RESERVATION_EXPIRING + companyId + reservation + expiry | 5 attempts, 15 s doubling to 5 min | 15 min (lease 2 min, extended while running) | NORMAL | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `hr.employment-changes` | hr | SCHEDULED | every 1 h, `scheduled` group | per company; suspended skipped | EMPLOYMENT_CHANGE + companyId + scheduled change (SCHEDULED → APPLIED commits with the change) | 5 attempts, 15 s doubling to 5 min | 30 min (lease 10 min, extended while running) | NORMAL | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `finance.unit-installments` | finance | SCHEDULED | every 1 h, `scheduled` group | per company; suspended skipped | UNIT_INSTALLMENT_OVERDUE + companyId + installment | UNIT_INSTALLMENT_DUE_SOON + companyId + installment + due date | 5 attempts, 15 s doubling to 5 min | 30 min (lease 10 min, extended while running) | NORMAL | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `meetings.series` | meetings | SCHEDULED | every 6 h, `scheduled` group | per company; suspended skipped | series + occurrence index (unique meeting row) | 4 attempts, 1 min doubling to 30 min | 30 min (lease 2 min, extended while running) | NORMAL | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `project-3d.process-models` | project-3d | OUTBOX | every 10 s, `documents` group | per work item's company; suspended included | model version id; PROCESSING is the durable queue and the runtime key is deterministic | 5 attempts, 15 s doubling to 5 min | 30 min (lease 15 min, extended while running) | HIGH | `WorkerCriticalJobFailed`, `WorkerCriticalJobStale` (page) |
| `documents.scan` | documents | OUTBOX | every 15 s, `documents` group | per work item's company; suspended included | document or document version id, claimed on the scan columns as read (status, scanStartedAt, scanAttempts) | 5 attempts, 15 s doubling to 5 min | 10 min (lease 2 min, extended while running) | CRITICAL | `WorkerCriticalJobFailed`, `WorkerCriticalJobStale`, `ScanQueueStuck`, `ScanFilesFailed`, `ScanClaimsAbandoned`, `ScanQuarantineOwed` (page) |
| `storage.cleanup` | documents | SCHEDULED | every 15 min, `documents` group | per work item's company; suspended included | upload session storage key, re-checked against finalized documents before deletion | 4 attempts, 1 min doubling to 30 min | 20 min (lease 2 min, extended while running) | HIGH | `WorkerCriticalJobFailed`, `WorkerCriticalJobStale` (page) |
| `storage.orphans` | documents | RECONCILIATION | every 1 day, `documents` group | per work item's company; suspended included | read-only; nothing to deduplicate | 3 attempts, 5 min doubling to 2 h | 45 min (lease 2 min, extended while running) | LOW | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `storage.usage` | documents | MANUAL | manual, `documents` | per company; suspended included | company; a recompute from source, so a second run writes the same numbers | 3 attempts, 5 min doubling to 2 h | 30 min (lease 2 min, extended while running) | LOW | `WorkerJobFailed` (ticket) |
| `recentwork.prune` | productivity | SCHEDULED | every 1 day, `scheduled` group | per company; suspended included | member's recent list; deleting what is already gone deletes nothing | 3 attempts, 5 min doubling to 2 h | 30 min (lease 2 min, extended while running) | LOW | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `retention.run` | core/retention | SCHEDULED | every 1 day, `scheduled` group | platform (no company data) | policy + cutoff; rows already deleted are not candidates | 3 attempts, 5 min doubling to 2 h | 1 h (lease 2 min, extended while running) | LOW | `WorkerJobFailed`, `WorkerJobStale` (ticket) |
| `security.throttle-purge` | core/security | SCHEDULED | every 1 h, `scheduled` group | platform (no company data) | bucket key; a closed window is deleted once | 4 attempts, 1 min doubling to 30 min | 5 min (lease 2 min, extended while running) | LOW | `WorkerJobFailed`, `WorkerJobStale` (ticket) |

## Each job

### `notifications.dispatch`

Drains the notification outbox: resolves each event's entitled recipients, writes in-app notifications, sends eligible email.

- **Missed runs:** Events wait in the outbox and drain oldest first.
- **Stale after:** 10 min without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=notifications.dispatch`.
- **Contract tests:** `tests/api/jobs/notifications.dispatch.test.ts` — idempotency, failure, company isolation, suspended company, concurrency.

### `calendar.reminders`

Fires due calendar event and meeting reminders, once per occurrence, into the outbox.

- **Missed runs:** Reminders that fell due in the last six hours still fire, unless what they are about started more than 15 minutes ago; older ones are dropped, not sent late.
- **Stale after:** 10 min without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=calendar.reminders` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/calendar.reminders.test.ts` — idempotency, failure, company isolation, suspended company, concurrency.

### `notifications.due`

Enqueues overdue-task and contract-obligation-due events for dates crossed since the last success.

- **Missed runs:** Covers every date crossed since the last success.
- **Stale after:** 3 h without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=notifications.due` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/notifications.due.test.ts` — idempotency, failure, company isolation, suspended company.

### `attention.reconcile`

Makes attention items agree with what is true: raises, refreshes and resolves them.

- **Missed runs:** Nothing to catch up: each run recomputes the desired state.
- **Stale after:** 30 min without a success.
- **Dry run:** supported — `pnpm worker --run=attention.reconcile --dry-run`.
- **Manual run:** `pnpm worker --run=attention.reconcile` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/attention.reconcile.test.ts` — idempotency, failure, company isolation, suspended company, concurrency.

### `approvals.overdue`

Reminds approvers of approvals past due, once a day per approval step.

- **Missed runs:** A missed day is not replayed; the next run reminds again while the approval is still overdue.
- **Stale after:** 3 h without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=approvals.overdue` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/approvals.overdue.test.ts` — idempotency, failure, company isolation, suspended company.

### `announcements.schedule`

Publishes scheduled announcements when due and expires published ones, each once.

- **Missed runs:** Publishes past-due schedules that have not expired; a schedule already past its expiry returns to draft, audited.
- **Stale after:** 10 min without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=announcements.schedule` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/announcements.schedule.test.ts` — idempotency, failure, company isolation, suspended company, concurrency.

### `announcements.reminders`

Reminds members who have not acknowledged an announcement, once per reminder round.

- **Missed runs:** Skipped rounds are not replayed; one reminder goes out for the current round.
- **Stale after:** 3 h without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=announcements.reminders` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/announcements.reminders.test.ts` — idempotency, failure, company isolation, suspended company.

### `timesheets.reminders`

Reminds members whose week is not submitted as the company's deadline approaches.

- **Missed runs:** Only inside the deadline window; past it, attention covers the missing week.
- **Stale after:** 3 h without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=timesheets.reminders` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/timesheets.reminders.test.ts` — idempotency, failure, company isolation, suspended company.

### `dailylogs.missing`

Reminds a project's people when its last working day has no daily log.

- **Missed runs:** Only the last working day is checked; earlier gaps are attention, not reminders.
- **Stale after:** 3 h without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=dailylogs.missing` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/dailylogs.missing.test.ts` — idempotency, failure, company isolation, suspended company.

### `planning.milestones`

Due-soon and overdue milestone reminders, once per milestone per target date.

- **Missed runs:** Recomputed each run; a missed due-soon window still gets its overdue reminder.
- **Stale after:** 3 h without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=planning.milestones` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/planning.milestones.test.ts` — idempotency, failure, company isolation, suspended company.

### `engineering.reminders`

RFI and submittal review due-soon and overdue reminders, once per due date.

- **Missed runs:** Recomputed each run; a missed due-soon window still gets its overdue reminder.
- **Stale after:** 3 h without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=engineering.reminders` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/engineering.reminders.test.ts` — idempotency, failure, company isolation, suspended company.

### `contractors.compliance`

Moves compliance items to EXPIRING and EXPIRED and tells the people responsible, once per expiry date.

- **Missed runs:** An item already past its expiry goes straight to EXPIRED.
- **Stale after:** 49 h without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=contractors.compliance` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/contractors.compliance.test.ts` — idempotency, failure, company isolation, suspended company.

### `hr.credential-expiry`

Reminds about employee documents and qualifications 90, 60, 30 and 7 days before they expire and once after, and marks verified ones EXPIRED.

- **Missed runs:** Recomputed each run: a missed window is replaced by the one the date is in now; a date already past goes straight to EXPIRED.
- **Stale after:** 49 h without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=hr.credential-expiry` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/hr.credential-expiry.test.ts` — idempotency, failure, company isolation, suspended company.

### `sales.unit-reservations`

Expires unit reservations past their date, returning the unit to For Sale, and warns the salesperson a day before.

- **Missed runs:** Every reservation already past its expiry is expired on the next run; a warning is not sent for one that has already expired.
- **Stale after:** 30 min without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=sales.unit-reservations` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/sales.unit-reservations.test.ts` — idempotency, failure, company isolation, suspended company.

### `hr.employment-changes`

Applies scheduled employment changes — promotions, transfers, manager, location, type, status and endings — on their effective date, once each; a change that can no longer apply is marked failed and its requester told.

- **Missed runs:** Every change already past its effective date is applied on the next run, once, dated its own effective date; one a later change has overtaken is marked failed.
- **Stale after:** 3 h without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=hr.employment-changes` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/hr.employment-changes.test.ts` — idempotency, failure, company isolation, suspended company.

### `finance.unit-installments`

Announces unit sale installments falling due within seven days, and those past due, once each; audits a unit becoming Overdue.

- **Missed runs:** Every installment already past due is announced on the next run; one due within the week is announced once for its due date.
- **Stale after:** 3 h without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=finance.unit-installments` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/finance.unit-installments.test.ts` — idempotency, failure, company isolation, suspended company.

### `meetings.series`

Tops recurring meeting series up to their rolling horizon.

- **Missed runs:** Fills every missing occurrence up to the horizon, never one already past.
- **Stale after:** 25 h without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=meetings.series` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/meetings.series.test.ts` — idempotency, failure, company isolation, suspended company.

### `project-3d.process-models`

Validates queued private GLB source objects and writes separate optimized runtime objects for ready model versions.

- **Missed runs:** Every version left in PROCESSING is retried from its immutable source object.
- **Stale after:** 30 min without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=project-3d.process-models`.
- **Contract tests:** `tests/api/jobs/project-3d.process-models.test.ts` — idempotency, failure, company isolation, suspended company, concurrency.

### `documents.scan`

Scans files waiting on the malware scanner, recovers scans a crashed worker abandoned, promotes clean versions (never over a newer one), and fails a file the scanner cannot give a verdict on after its attempts.

- **Missed runs:** The scan queue is the status column: waiting files wait.
- **Stale after:** 15 min without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=documents.scan`.
- **Requires:** a configured scanner; without one the job is not run.
- **Contract tests:** `tests/api/jobs/documents.scan.test.ts` — idempotency, failure, company isolation, suspended company, concurrency.

### `storage.cleanup`

Expires abandoned upload sessions and removes their never-completed objects after the grace period.

- **Missed runs:** Time-based: anything past its grace period is found on the next run.
- **Stale after:** 2 h without a success.
- **Dry run:** supported — `pnpm worker --run=storage.cleanup --dry-run`.
- **Manual run:** `pnpm worker --run=storage.cleanup`.
- **Contract tests:** `tests/api/jobs/storage.cleanup.test.ts` — idempotency, failure, company isolation, suspended company, concurrency.

### `storage.orphans`

Reports documents and document versions whose object is missing from storage. Read-only: an orphan is a restore incident.

- **Missed runs:** Nothing to catch up: each run checks the current state.
- **Stale after:** 49 h without a success.
- **Dry run:** supported — `pnpm worker --run=storage.orphans --dry-run`.
- **Manual run:** `pnpm worker --run=storage.orphans`.
- **Contract tests:** `tests/api/jobs/storage.orphans.test.ts` — idempotency, failure, company isolation, suspended company.

### `storage.usage`

Rebuilds each company's storage usage projection from its documents.

- **Missed runs:** Manual only.
- **Stale after:** not applicable (manual) without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=storage.usage` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/storage.usage.test.ts` — idempotency, failure, company isolation, suspended company.

### `recentwork.prune`

Drops recent-work entries past the company's retention and past the hundred newest per member.

- **Missed runs:** Time-based: the next run removes everything past the cutoff.
- **Stale after:** 49 h without a success.
- **Dry run:** supported — `pnpm worker --run=recentwork.prune --dry-run`.
- **Manual run:** `pnpm worker --run=recentwork.prune` (add `--company=<id>` for one company).
- **Contract tests:** `tests/api/jobs/recentwork.prune.test.ts` — idempotency, failure, company isolation, suspended company.

### `retention.run`

Applies retention policies to operational debris, in batches. Dry run unless WORKER_RETENTION_APPLY=true.

- **Missed runs:** Time-based: the next run removes everything past the cutoff.
- **Stale after:** 49 h without a success.
- **Dry run:** supported — `pnpm worker --run=retention.run --dry-run`.
- **Manual run:** `pnpm worker --run=retention.run`.
- **Contract tests:** `tests/api/jobs/retention.run.test.ts` — idempotency, failure.

### `security.throttle-purge`

Removes rate-limit buckets whose window has closed, by the database's clock.

- **Missed runs:** Time-based.
- **Stale after:** 3 h without a success.
- **Dry run:** not supported.
- **Manual run:** `pnpm worker --run=security.throttle-purge`.
- **Contract tests:** `tests/api/jobs/security.throttle-purge.test.ts` — idempotency, failure.
