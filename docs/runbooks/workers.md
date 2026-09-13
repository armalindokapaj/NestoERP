# Workers & scheduler runbook

Per PRD #38 §79, §93-§97, §104, §105.

Everything NESTO does in the background runs through one entry point,
`scripts/worker.ts` (`pnpm worker`). Web instances never run scheduled work:
they scale with traffic, and a job must not multiply with them (§94, §95).

## Jobs

| Job | Group | Due every | What it does |
|---|---|---|---|
| `notifications.dispatch` | notifications | 10 s | Drains the notification outbox (leased batches), writes notifications, sends eligible email |
| `documents.scan` | documents | 15 s | Scans files waiting on the malware scanner; no-op when `STORAGE_SCANNER=none` |
| `storage.cleanup` | documents | 15 min | Expires abandoned upload sessions and removes their never-completed objects |
| `storage.orphans` | documents | daily | Reports available documents whose object is missing (read-only — an orphan is a restore incident) |
| `attention.reconcile` | scheduled | 5 min | Makes attention items agree with what is true: creates, refreshes, resolves |
| `notifications.due` | scheduled | hourly | Enqueues `TASK_OVERDUE` and `CONTRACT_OBLIGATION_DUE` for dates crossed since the last success |
| `retention.run` | scheduled | daily | Retention policies. Dry run unless `WORKER_RETENTION_APPLY=true` |
| `security.throttle-purge` | scheduled | hourly | Removes expired rate-limit buckets |

The schedule lives in `lib/core/jobs/job.registry.ts`; what each job does lives in
`lib/core/jobs/job.handlers.ts`. Every job is idempotent.

## Deploying

Recommended (§94): three long-running processes from the same artifact as the web
tier, each with the same environment as the web tier.

```
pnpm worker --group=notifications
pnpm worker --group=documents
pnpm worker --group=scheduled
```

A small deployment may run one `pnpm worker` (all groups). Either shape is safe
with more than one replica: before a job runs, the worker claims a lease on its
`worker_heartbeats` row in a single statement, so a job runs on one worker at a
time (§96). A worker that dies mid-run leaves a lease that expires on its own
(`leaseExpiresAt`), and the next worker takes over.

A platform that only offers cron can run a single pass instead:

```
pnpm worker --once                     # every due job, then exit
pnpm worker --once --group=scheduled
pnpm worker --once --job=attention.reconcile
```

Workers stop cleanly on `SIGTERM`: the job in hand finishes, then the process exits.
Deploy workers after migrations, like the web tier (`deployment.md`).

## Health

- `pnpm worker --status` — every job's state (`ok`, `stale`, `failing`, `never_run`),
  last success, and the notification outbox counts.
- `/api/health/ready` → `workers: ok | degraded | not_running | unknown`. Workers never
  take a web instance out of rotation; this is for dashboards and alerts.
- `/api/internal/metrics` (bearer `METRICS_TOKEN`): `worker_last_success_age_seconds{job}`,
  `worker_job_healthy{job}`, `notification_outbox_pending`,
  `notification_oldest_pending_age_seconds`, `scan_queue_size`, `scan_queue_age_seconds`.

```sql
SELECT job, "lastSuccessAt", "lastFailureAt", "lastError", "lastDurationMs",
       "lastProcessed", runs, failures, "leaseOwner", "leaseExpiresAt", "nextRunAt"
FROM worker_heartbeats ORDER BY job;
```

Suggested alerts: any `worker_job_healthy == 0` for 15 minutes;
`notification_oldest_pending_age_seconds > 300`; `scan_queue_age_seconds > 900`.

## A job is failing

1. Read `lastError` on its heartbeat row (message only — never a stack or payload).
2. A failing job retries after its interval (at least a minute); it does not spin.
3. Fix the cause. To run it now instead of waiting: clear `nextRunAt` and run once.

```sql
UPDATE worker_heartbeats SET "nextRunAt" = NULL WHERE job = 'attention.reconcile';
```
```
pnpm worker --once --job=attention.reconcile
```

## A job is stuck "running"

`leaseOwner` is set and `leaseExpiresAt` is in the future, but nothing is happening.
If the owning process is gone, wait for the lease to expire — the next worker takes
over. If it must run now, clear the lease; it is safe because the job is idempotent.

```sql
UPDATE worker_heartbeats SET "leaseOwner" = NULL, "leaseExpiresAt" = NULL WHERE job = '…';
```

## Retention

`retention.run` deletes only with `WORKER_RETENTION_APPLY=true` set on the
scheduled worker. Turn it on in production only after `retention.md` has been
followed and a dry run has been reviewed.

## Notification failures

See `notification-worker.md`. Failed outbox events are retried with
`pnpm worker --retry-failed [--event=TYPE]`.
