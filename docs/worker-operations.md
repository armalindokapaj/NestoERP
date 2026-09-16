# Worker operations

Running NESTO's workers in staging and production, and what to do when an alert
fires (PRD #51 §203-§211, §256-§258). How the worker works: `docs/workers.md`.
Every job's schedule, owner, retry policy and alerts: `docs/worker-matrix.md`.

Every command below runs on a worker host (or anywhere with the worker's
environment and database access). Access to that shell is the authority to run,
retry and disable jobs (§40); manual retries also record the operator's name.

## Starting the worker

The production mechanism is long-running worker processes, one command, from the
same artifact and environment as the web tier (§207, §208, §210):

```
pnpm worker --group=notifications
pnpm worker --group=documents
pnpm worker --group=scheduled
```

Three processes keep a slow scanner or a long retention run from delaying
notifications. A small deployment may run a single `pnpm worker` (every group).
Either shape is safe with any number of replicas — each job runs on one worker at a
time — but replicas beyond one per group add failover, not throughput: every job
is a singleton.

Run them under a process manager that restarts on exit and sends `SIGTERM` to stop,
with a grace period longer than `WORKER_SHUTDOWN_TIMEOUT_SECONDS` (default 30 s).
The container healthcheck is:

```
pnpm worker --health --group=<the process's groups>
```

It exits 0 while a live worker on this host runs those groups.

**Startup refuses** (exit 1, each problem printed) when the registry is invalid,
`WORKER_DISABLED_JOBS` names an unknown job, a batch size or the shutdown timeout
is out of range, the database is unreachable, or — for a process that runs a
documents job — object storage is unreachable (§54, §211). Mail configuration is
not required: `MAIL_DELIVERY=disabled` runs in-app notifications only (§212).
Check a configuration without starting anything:

```
pnpm worker --validate
```

**A platform that only offers cron** can run one pass per invocation:

```
pnpm worker --once --group=notifications      # every minute
pnpm worker --once --group=scheduled          # every minute
pnpm worker --once --group=documents          # every minute
```

A pass runs only the jobs that are due, so a minute's cron is enough for every
schedule. Overlapping invocations are safe. The cost: between invocations there is
no live worker, so health reports the groups as unworkered, and notifications wait
up to a minute. Prefer long-running processes where the platform allows them.

**Deploys.** Migrate, deploy the web tier, then roll the workers. Old and new
workers may overlap; see `docs/workers.md#shutdown-and-deploys`.

## Reading health

```
pnpm worker --status
```

prints the tier's state and why, every live worker process (version, groups, last
beat, the job it is running), every job's state, the outbox counts and the failed
attempts in the last hour.

| Job state | Meaning | Do |
|---|---|---|
| `ok` | Succeeded within its expected interval | nothing |
| `failing` | Last run failed; retries still in hand | watch; read the failure history if it persists |
| `failed` | Failed its maximum attempts in a row | [A job is failing](#a-job-is-failing) |
| `stale` | No success for longer than `staleAfter` | [A job is stale](#a-job-is-stale) |
| `never_run` | No success recorded on this database | a new deployment, or no worker for its group |
| `disabled` | `WORKER_DISABLED_JOBS`, or a missing capability (no scanner) | expected |
| `manual` | Runs only when asked | expected |

The tier is **UNHEALTHY** when a group holding a `CRITICAL` job has no live worker,
or a `CRITICAL` job is failed, stale or has never run; **DEGRADED** when anything
else is off. `/api/health/ready` gives the same answer in one word — `ok`,
`degraded`, `unhealthy`, or `not_running` when no worker process is alive at all.
It never takes a web instance out of rotation.

Metrics on `/api/internal/metrics` (bearer `METRICS_TOKEN`):

| Metric | Labels |
|---|---|
| `worker_health_status` (0 healthy, 1 degraded, 2 unhealthy) | — |
| `worker_processes_live`, `worker_heartbeat_age_seconds` | `group` |
| `worker_job_healthy`, `worker_job_failed`, `worker_job_active`, `worker_job_consecutive_failures`, `worker_last_success_age_seconds`, `worker_job_duration_seconds` | `job`, `criticality` |
| `worker_job_started_total`, `worker_job_completed_total`, `worker_job_failed_total`, `worker_job_retried_total`, `worker_job_timeouts_total` | `job`, `criticality` |
| `worker_job_failures_last_hour`, `worker_job_lease_expiries_last_hour` | `job`, `criticality` |
| `notification_outbox_pending`, `notification_outbox_due`, `notification_outbox_failed`, `notification_oldest_pending_age_seconds`, `notification_oldest_due_age_seconds` | — |
| `scan_queue_size`, `scan_queue_age_seconds`, `scan_retrying`, `scan_claims_abandoned`, `scan_failed_last_hour`, `scan_quarantine_owed` (documents and versions) | — |

Alert rules: `ops/alerts/workers.yml`. `critical` pages; `warning` opens a ticket.

## No worker is running

*Alert: `WorkerGroupDown` — no worker process for a group has beaten in five
minutes.*

1. `pnpm worker --status` — which groups have no process?
2. Check the process manager: crashed and not restarting, never deployed, or scaled
   to zero?
3. Read the last lines the process logged. A refused startup prints each problem
   (`✗ …`); fix the configuration, then start it.
4. Nothing is lost while workers are down: outbox events wait, scans stay pending,
   reminders fire within their catch-up window (see each job's *Missed runs* in the
   matrix). When the worker returns, due work drains oldest first.

## A job is failing

*Alerts: `WorkerCriticalJobFailed` (page), `WorkerJobFailed` (ticket) — a job failed
its maximum attempts in a row.*

**Inspect.**

```
pnpm worker --status                              # its state, consecutive failures, last error code
pnpm worker --failures --job=<key> --limit=20     # each attempt: when, code, message, company, worker
```

Logs: search for `worker.job.failed` and `worker.job.failed_permanently` with the
job, or by the `correlationId` from a failure row — every log line, outbox event and
audit row the run wrote carries it.

**Read the code.**

| Code | Usually | Retry? |
|---|---|---|
| `DATABASE_UNAVAILABLE`, `NETWORK`, `STORAGE_UNAVAILABLE` | a dependency is down | fix the dependency; the job recovers by itself |
| `TIMEOUT` | the run needs longer than its timeout: a large backlog or a slow dependency | see whether it is progressing (`lastProcessed`); escalate if it never finishes |
| `LEASE_EXPIRED` | the worker died mid-run | [Workers keep dying mid-run](#workers-keep-dying-mid-run) |
| `PARTIAL_FAILURE` | some companies or items failed; the rest succeeded | find which in the logs (`<job>.item_failed`, `worker.job.company_failed`) |
| `DATABASE_CONFLICT` | contention with people's writes | recovers by itself; escalate if constant |
| `VALIDATION`, `STATE_CONFLICT`, `NOT_ELIGIBLE` | a record the job cannot handle | **do not retry** until the record or the code is fixed |
| `CONFIGURATION` | missing or wrong setting | fix the setting, restart |
| `UNKNOWN` | unclassified | escalate with the correlation id |

**Retry.** A failed job tries again on its own after `max(interval, maxDelay)`. To
run it now once the cause is fixed:

```
pnpm worker --run=<key>
pnpm worker --run=<key> --company=<companyId>     # COMPANY-scoped jobs: one company
```

A manual run takes the job's lease — it never runs alongside a worker holding the
job — and is recorded like any other run. If another worker holds it, the command
says so; wait and try again.

**When not to retry.** A permanent code on the same record every time: retrying
changes nothing and fills the failure history. A job that deletes (`retention.run`,
`storage.cleanup`) failing with an unexplained code: run it with `--dry-run` first
and read the counts.

**Escalate** to the owning domain's engineers (the matrix's *Owner*) when the code
is `UNKNOWN`, when a permanent failure is not explained by the data, when a
`TIMEOUT` persists with a normal backlog, or when a `CRITICAL` job has been failed
for more than an hour.

**Switch a job off** while its cause is fixed — only a job whose absence is safe
for the time being, never `notifications.dispatch`:

```
WORKER_DISABLED_JOBS=storage.orphans      # then restart the workers
```

## A job is stale

*Alerts: `WorkerCriticalJobStale` (page), `WorkerJobStale` (ticket) — no success
within the job's `staleAfter`.*

A stale job has not failed; it has not *succeeded*. In order of likelihood:

1. No worker runs its group — [No worker is running](#no-worker-is-running).
2. It is running and has not finished: `pnpm worker --status` shows `running`. If
   `worker_job_active` stays 1 far longer than the job's timeout, the worker holding
   it is stuck; restart that process. Its lease expires within two minutes and
   another worker takes the job over.
3. It has been switched off by accident: `disabled` in `--status`.
4. The worker is starved: another job in the same group is taking all its time. Look
   at `worker_job_duration_seconds` for the group's jobs; split groups across
   processes.

## Reading the failure history

*Alert: `WorkerHighFailureRate` — more than 20 failed attempts in an hour.*

`job_failures` keeps every failed attempt — scheduled runs and outbox events alike —
for 180 days, including after a retry succeeds. Nothing in it is a payload.

```
pnpm worker --failures --job=<key>
pnpm worker --failures --company=<companyId>
```

```sql
SELECT "jobKey", "errorCode", count(*), min("failedAt"), max("failedAt")
FROM job_failures WHERE "failedAt" > now() - interval '1 day'
GROUP BY 1, 2 ORDER BY 3 DESC;
```

Many failures across jobs with one code is a dependency. Many failures in one job for
one company is that company's data. Many attempts of one outbox event is a poison
event — see [Failed outbox events](#failed-outbox-events).

## Workers keep dying mid-run

*Alert: `WorkerRepeatedLeaseExpiry` — a job was taken over from a dead worker three
times in an hour.*

A lease expires when the worker holding it stopped beating without finishing:

- **Out of memory** — the process manager's logs show the kill. Raise the memory
  limit, or lower `NOTIFICATION_BATCH_SIZE` / `SCAN_BATCH_SIZE`.
- **Deploys without a grace period** — the platform kills before
  `WORKER_SHUTDOWN_TIMEOUT_SECONDS`. Lengthen the grace period.
- **A crash loop** — the same job each time: its failure rows' correlation ids lead
  to the last log lines before the process died.

Work is not lost or duplicated: the job's effects are idempotent and the next worker
takes it over. An outbox event whose worker dies at its fifth attempt is failed as
`LEASE_EXPIRED` instead of being claimed forever.

## The outbox is backing up

*Alert: `NotificationOutboxBacklog` — an event has been due for more than five
minutes.*

```
pnpm worker --status          # is notifications.dispatch ok and running?
```

```sql
SELECT status, count(*), min("createdAt"), max("attemptCount")
FROM notification_event_outbox GROUP BY status;

-- due now, oldest first
SELECT id, "eventType", "companyId", "attemptCount", "lastErrorCode", "createdAt"
FROM notification_event_outbox
WHERE status = 'PENDING' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now() AT TIME ZONE 'UTC')
ORDER BY "createdAt" LIMIT 20;
```

1. **No dispatcher** — no live `notifications` worker. Start one.
2. **Failing** — `lastErrorCode` on the heartbeat and on the rows. A dependency code
   recovers by itself once the dependency does.
3. **Slow** — `worker_job_duration_seconds{job="notifications.dispatch"}` near its
   ten-second interval and every batch full. Raise `NOTIFICATION_BATCH_SIZE` (up to
   1000). A second `notifications` worker adds failover, not speed — the dispatch job
   runs on one worker at a time.
4. **Mail is slow** — email is sent inline after the notification is written. If the
   mail provider is timing out, set `MAIL_DELIVERY=disabled` to keep in-app
   notifications flowing, and follow `docs/runbooks/mail-delivery.md`.

Rows `PROCESSING` past their `leaseExpiresAt` are claimed again on the next pass; if
they stay, no dispatcher is running.

## Failed outbox events

*Alert: `NotificationOutboxFailedEvents` — events have failed and wait for an
operator.*

An event is `FAILED` after five attempts, or at once on a permanent error. Nobody
has been told about it. Failed events are kept for 180 days, then removed by
retention.

**Inspect.**

```sql
SELECT "eventType", "lastErrorCode", count(*), min("failedAt"), max("failedAt")
FROM notification_event_outbox WHERE status = 'FAILED' GROUP BY 1, 2;
```

```
pnpm worker --failures --job=notifications.dispatch --limit=50
```

**Poison events.** One event that fails every time (`VALIDATION`,
`UNSUPPORTED_PAYLOAD` that no release reads, a record that no longer exists) does
not block anything: the dispatcher settles it and moves on. Leave it failed; if it
matters, escalate to the domain that produced it — the event type names it.

**Retry** once the cause is fixed. The operator's name is required and recorded
against each failure row; the history is kept, the attempts start again:

```
pnpm worker --retry-failed --operator=<your name> --event=COMMENT_MENTIONED
pnpm worker --retry-failed --operator=<your name> --company=<companyId>
pnpm worker --retry-failed --operator=<your name> --id=<eventId>,<eventId>
pnpm worker --retry-failed --operator=<your name>        # every failed event
```

A retried event cannot notify anybody twice: notifications are unique per recipient
and event. **Do not retry** events older than people would still want to hear about
— a week-old "starting in 15 minutes" reminder is noise; leave it.

## Files wait for their scan

*Alerts: `ScanQueueStuck` (page) — an uploaded file has waited more than fifteen
minutes for its malware verdict; `ScanClaimsAbandoned` (ticket) — scans keep being
claimed and never finished; `ScanFilesFailed` (ticket) — files were failed after
every attempt.* See also `docs/runbooks/document-scanning.md`.

1. `pnpm worker --status` — is `documents.scan` `ok` and a `documents` worker live?
   `disabled` means no scanner is configured on this worker while the web tier has
   one: the two environments disagree.
2. `pnpm worker --failures --job=documents.scan` — `NETWORK` or
   `STORAGE_UNAVAILABLE` points at clamd or the bucket.
3. `scan_retrying` climbing means the scanner answers but gives no verdict (`ERROR`):
   files retry a minute later, doubling up to six hours.
4. A scan whose worker or upload request died is taken back after 15 minutes. If
   `scan_claims_abandoned` stays above zero, something keeps dying mid-scan —
   [Workers keep dying mid-run](#workers-keep-dying-mid-run).
5. After 12 attempts (about 20 hours) a file is `FAILED` with `FILE_SCAN_FAILED`:
   never made available unscanned, and its uploader is told to upload it again.
   After an outage that long, tell the affected companies
   (`docs/runbooks/document-scanning.md#scanner-outage`).

## Manual runs and dry runs

```
pnpm worker --run=<key>                               # now, through the lease
pnpm worker --run=<key> --company=<id>,<id>           # COMPANY-scoped jobs only
pnpm worker --run=<key> --dry-run                     # jobs that support it: counts, no writes
```

Dry runs print counts only, never records (§166), and do not move the job's
schedule. Supported by `attention.reconcile`, `storage.cleanup`, `storage.orphans`,
`recentwork.prune` and `retention.run`.

The older commands are the same jobs run once:

| Command | Runs |
|---|---|
| `pnpm notifications:dispatch [--limit=N]` | `notifications.dispatch`, one batch |
| `pnpm retention:dry-run` | `retention.run --dry-run` |
| `tsx scripts/retention.ts --apply --confirm=DELETE [--environment=production]` | `retention.run`, deleting, once |
| `pnpm storage:maintenance` / `storage:maintenance:apply` | `documents.scan`, `storage.cleanup` (dry run unless applied), `storage.orphans`, `storage.usage` |

`storage.usage` is manual only: run it after restoring documents from backup, or
when a company's quota display disagrees with its files.

## Job by job

What each job depends on and how it recovers. Schedules, retry policies and alerts
are in the matrix.

| Job | Depends on | When it fails | Recovery |
|---|---|---|---|
| `notifications.dispatch` | database; mail provider for email only | events retry with backoff, then `FAILED` | fix cause; `--retry-failed` |
| `calendar.reminders` | database | reminders due in the last six hours still fire on the next success, unless the event started more than 15 minutes ago | automatic |
| `notifications.due` | database | dates crossed since the last success are covered on the next success | automatic |
| `attention.reconcile` | database | attention items are out of date until the next success | automatic; `--run` to hurry |
| `approvals.overdue` | database | reminders go out on the next success, once per step per day | automatic |
| `announcements.schedule` | database | scheduled announcements publish late, once; while a company has announcements switched off they wait | automatic; `--run` to hurry |
| `announcements.reminders` | database | reminders go out on the next success, once per round | automatic |
| `timesheets.reminders` | database | reminders go out on the next success, once per member per period | automatic |
| `dailylogs.missing` | database | missing-log notices go out on the next success, once per project per day | automatic |
| `planning.milestones` | database | due-soon and overdue notices go out once per milestone per target date | automatic |
| `engineering.reminders` | database | RFI and submittal notices go out once per record per due date | automatic |
| `contractors.compliance` | database | expiring and expired moves happen on the next success, notified once per expiry date | automatic; `--run` to hurry after a missed day |
| `meetings.series` | database | recurring meetings are generated on the next success, never twice | automatic |
| `documents.scan` | database, object storage, scanner | files stay pending; a claim whose worker died is taken back after 15 min; a file with no verdict after 12 attempts becomes `FAILED`; a version never replaces a newer one | fix the scanner or bucket; failed files are uploaded again |
| `storage.cleanup` | database, object storage | abandoned uploads wait; a placeholder still referenced is marked failed, not deleted | automatic; `--dry-run` before a manual apply |
| `storage.orphans` | database, object storage (refuses to run when storage is unhealthy) | the report is late | automatic; an orphan it finds is a restore incident (`docs/runbooks/database-restore.md`) |
| `storage.usage` | database | quota display stays as it was | `--run` again |
| `recentwork.prune` | database | recent lists grow a day longer | automatic |
| `retention.run` | database | debris is kept a day longer; deletes only with `WORKER_RETENTION_APPLY=true` | automatic; see `docs/runbooks/retention.md` |
| `security.throttle-purge` | database | expired rate-limit rows are kept an hour longer; live lockouts are unaffected | automatic |
