# Retention runbook

Per PRD #33 §66-§77, §111, PRD #51 §227-§230.

## What is and is not purged

Core business records and audit events are **never** automatically deleted in
V0.1 (PRD #33 §49, §52). What expires is operational debris.

Policies live in `lib/core/retention/retention-policy.registry.ts`. A policy
with `retentionDays: null` and `deleteMode: "NONE"` is a deliberate decision,
not an oversight.

| Policy | Removed after |
|---|---|
| `sessions.expired` | 1 day |
| `password-reset-tokens.used` | 3 days |
| `company-invites.expired` | 30 days |
| `notifications.read` | 365 days |
| `attention.resolved` | 180 days |
| `integration-attempts.completed` | 90 days |
| `notification-outbox.processed` | 30 days |
| `notification-outbox.failed` | 180 days — long enough to investigate and retry |
| `job-failures` | 180 days |
| `job-idempotency-keys` | 400 days — longer than read notifications live, so a condition true for months is not announced again |
| `worker-processes.stopped` | 7 days after the last heartbeat |
| `mail-deliveries.settled` | 180 days |
| `rate-limit-buckets.expired` | 1 day |
| `audit-events`, `business-records` | never |

## Running it

The `retention.run` job runs daily on the `scheduled` worker. It **deletes only
where `WORKER_RETENTION_APPLY=true`** is set on that worker; otherwise every run
is a dry run that logs what it would remove (`worker.job.completed`, `policies`).

Always dry run first (PRD #33 §74):

```
pnpm retention:dry-run
```

The dry run reports candidate counts per policy and mutates nothing. Review the
counts before turning deletion on — a policy change that suddenly proposes
deleting far more than usual is the signal this exists to give you. Then either
set `WORKER_RETENTION_APPLY=true` and restart the scheduled worker, or delete once
by hand:

```
tsx scripts/retention.ts --apply --confirm=DELETE [--environment=production]
```

Both go through the job's lease, so a manual run never overlaps the scheduled one.

## Guarantees

- Batched: each policy deletes at most its `batchSize` rows per statement, never
  one giant transaction (PRD #33 §71, §72). Shutdown and the job's timeout stop it
  between batches, and the next run continues.
- Idempotent: a rerun after a crash is safe; a row that changed after it was
  chosen is judged as it is now.
- One failing policy does not stop the others; the run is then recorded as
  failing (`PARTIAL_FAILURE`) and the policy logged as `retention.run.item_failed`.
- Company-safe: one company's cleanup never touches another (PRD #33 §191)
- Legal-hold aware hook in place for a future hold model (PRD #33 §75)
