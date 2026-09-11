# Retention runbook

Per PRD #33 §66-§77, §111.

## What is and is not purged

Core business records and audit events are **never** automatically deleted in
V0.1 (PRD #33 §49, §52). What expires is operational debris.

Policies live in `lib/core/retention/retention-policy.registry.ts`. A policy
with `retentionDays: null` and `deleteMode: "NONE"` is a deliberate decision,
not an oversight.

## Running it

Always dry run first (PRD #33 §74):

```
pnpm retention:dry-run
```

The dry run reports candidate counts and mutates nothing. Review the counts
before running for real — a policy change that suddenly proposes deleting far
more than usual is the signal this exists to give you.

## Guarantees

- Batched, never one giant transaction (PRD #33 §71, §72)
- Idempotent: a rerun after a crash is safe
- Company-safe: one company's cleanup never touches another (PRD #33 §191)
- Legal-hold aware hook in place for a future hold model (PRD #33 §75)
