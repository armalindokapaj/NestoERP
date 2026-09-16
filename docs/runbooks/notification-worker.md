# Notification worker runbook

Per PRD #38 §79-§82, §96, §174, PRD #51 §21, §36-§39, §206. The general worker
runbook, including the alert sections this page expands on, is
`docs/worker-operations.md`.

## What it does

Producers write events to `notification_event_outbox` inside their own
transactions. The worker (`pnpm worker` running the `notifications.dispatch`
job, or `pnpm notifications:dispatch` once — the same job, through the same
lease) claims due events, resolves recipients from the event registry,
re-checks each recipient's access to the record, applies preferences, writes
notifications and sends eligible emails.

Claiming is a lease: `FOR UPDATE SKIP LOCKED`, status `PROCESSING`,
`leaseExpiresAt` five minutes out, and the attempt counted at claim. Only the
lease holder settles a row. Two workers never process the same event; a worker
that dies leaves leases that expire and are claimed again — until the event's
fifth attempt, when it is failed as `LEASE_EXPIRED` instead. Notifications carry
a unique `(companyId, recipientMemberId, dedupeKey)`, so a retried event writes
nothing twice.

A failed attempt goes back to `PENDING` with a jittered backoff (30 s, 2 min,
8 min, 32 min), or straight to `FAILED` on a permanent error. Every failed
attempt is a row in `job_failures`. Events for a suspended company are settled
without delivery, and not delivered after reactivation. With `MAIL_DELIVERY=disabled` notifications are written and no
email is attempted.

## Health signals

- `worker_heartbeats` row `notifications.dispatch`: `lastSuccessAt`,
  `lastFailureAt`, `lastErrorCode`, `lastError`, `lastProcessed`
- `/api/health/ready` reports `workers: unhealthy` when no `notifications`
  worker is alive or dispatch has failed or gone stale, and
  `workers: not_running` when no worker process is alive at all
- `pnpm worker --status` prints every job's state and the outbox counts
- Metrics: `worker_job_healthy{job="notifications.dispatch"}`,
  `worker_job_failed`, `worker_job_failures_last_hour`
- Metrics: `notification_outbox_due`, `notification_oldest_due_age_seconds`,
  `notification_outbox_pending`, `notification_oldest_pending_age_seconds`,
  `notification_outbox_failed`

Alerts (`ops/alerts/workers.yml`): `NotificationOutboxBacklog` when an event has
been due for more than five minutes, `NotificationOutboxFailedEvents` when failed
events wait for an operator.

## Outbox backlog

```sql
SELECT status, count(*), min("createdAt") FROM notification_event_outbox GROUP BY status;
```

1. Is the worker running? Check the heartbeat and the process manager.
2. Is it failing? `lastErrorCode` on the heartbeat and on the rows, and
   `pnpm worker --failures --job=notifications.dispatch`.
3. Is it slow? `lastDurationMs` and `lastProcessed`. Raise the batch size
   (`NOTIFICATION_BATCH_SIZE`, up to 1000). A second worker does not help: the
   dispatch job runs on one worker at a time, so another replica is failover
   only.

## Worker down

Start it (see `docs/worker-operations.md`). Nothing is lost: events wait in the outbox. Events that became due
while it was down are processed oldest first.

## Duplicate notifications

Should be impossible (unique dedupe key). If seen, check whether two different
events were produced for one business change — that is a producer bug, not a
worker bug. Find them with:

```sql
SELECT "eventType", "entityId", count(*) FROM notification_event_outbox
WHERE "createdAt" > now() AT TIME ZONE 'UTC' - interval '1 hour' GROUP BY 1, 2 HAVING count(*) > 1;
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
pnpm worker --retry-failed --operator=<your name>
pnpm worker --retry-failed --operator=<your name> --event=COMMENT_MENTIONED
pnpm worker --retry-failed --operator=<your name> --company=<companyId> --id=<eventId>
```

Retry resets attempts and makes the events due immediately. Their failure
history stays in `job_failures`, marked with who retried it and when. When not
to retry, and poison events: `docs/worker-operations.md#failed-outbox-events`.
