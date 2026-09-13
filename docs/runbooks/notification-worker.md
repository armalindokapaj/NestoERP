# Notification worker runbook

Per PRD #38 §79-§82, §96, §174.

## What it does

Producers write events to `notification_event_outbox` inside their own
transactions. The worker (`pnpm worker` running the `notifications.dispatch`
job, or `pnpm notifications:dispatch` once) claims due events, resolves
recipients from the event registry, re-checks each recipient's access to the
record, applies preferences, writes notifications and sends eligible emails.

Claiming is a lease: `FOR UPDATE SKIP LOCKED`, status `PROCESSING`,
`leaseExpiresAt` two minutes out. Only the lease holder settles a row. Two
workers never process the same event; a worker that dies leaves leases that
expire and are claimed again. Notifications carry a unique
`(companyId, recipientMemberId, dedupeKey)`, so a retried event writes nothing
twice.

## Health signals

- `worker_heartbeats` row `notifications.dispatch`: `lastSuccessAt`,
  `lastFailureAt`, `lastError`, `lastProcessed`
- `/api/health/ready` reports `workers: degraded` when any job is failing or its
  last success is older than its threshold, and `workers: not_running` when no
  job has ever succeeded (the worker was never started against this database)
- `pnpm worker --status` prints every job's state and the outbox counts
- Metrics: `worker_last_success_age_seconds{job}`, `worker_job_healthy{job}`
- Metrics: `notification_outbox_pending`, `notification_oldest_pending_age_seconds`,
  `notification_outbox_failed`, `notification_dispatch_failure_count`

Alert when the oldest pending event is older than 5 minutes, or failures exceed
successes over 15 minutes.

## Outbox backlog

```sql
SELECT status, count(*), min("createdAt") FROM notification_event_outbox GROUP BY status;
```

1. Is the worker running? Check the heartbeat and the process manager.
2. Is it failing? `lastError` on the heartbeat, and `lastError` on FAILED rows.
3. Is it slow? `lastDurationMs` and `lastProcessed`. Raise the batch size
   (`NOTIFICATION_BATCH_SIZE`) or run a second worker — leases make that safe.

## Worker down

Start it (see `docs/runbooks/workers.md`). Nothing is lost: events wait in the outbox. Events that became due
while it was down are processed oldest first.

## Duplicate notifications

Should be impossible (unique dedupe key). If seen, check whether two different
events were produced for one business change — that is a producer bug, not a
worker bug. Find them with:

```sql
SELECT "eventType", "entityId", count(*) FROM notification_event_outbox
WHERE "createdAt" > now() - interval '1 hour' GROUP BY 1, 2 HAVING count(*) > 1;
```

## Stuck lease

A `PROCESSING` row whose `leaseExpiresAt` has passed is claimed again on the next
run automatically. If rows stay `PROCESSING` far past their lease, the worker is
not running at all.

## Failed deep links

A notification link is `/notifications/:id/open`. It re-reads the record now;
"no longer available" is the correct answer when access changed. If every link
fails, check the record registry definition for that type.

## Manual retry

After fixing the cause of FAILED events:

```
pnpm worker --retry-failed
pnpm worker --retry-failed --event=COMMENT_MENTIONED
```

Retry resets attempts and makes them due immediately.
