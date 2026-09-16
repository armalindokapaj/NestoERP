# Workers

How NESTO runs background work, and the rules every job keeps (PRD #38 §93-§97,
PRD #51). What each job is and does: `docs/worker-matrix.md`. What to do when one
misbehaves: `docs/worker-operations.md`.

## One way to run background work

Everything NESTO does in the background is a **job** in the registry,
`lib/core/jobs/job.registry.ts`, run by the **worker** — `pnpm worker`
(`scripts/worker.ts`), a long-running process started from the same artifact and
environment as the web tier (§208, §210).

- Web instances never run jobs. They scale with traffic, and a job must not
  multiply with them (PRD #38 §94).
- No HTTP endpoint starts a job (§216-§218). CI fails if anything under `app/`
  imports the runner.
- The older single-purpose commands — `pnpm notifications:dispatch`,
  `pnpm retention:dry-run`, `pnpm storage:maintenance` — are the same jobs run
  once through the same lease (`lib/core/jobs/job.manual.ts`), not a second
  implementation.

Jobs are split into three **groups** so a slow or broken dependency in one
cannot starve the others:

| Group | Jobs | Why apart |
|---|---|---|
| `notifications` | outbox dispatch, calendar reminders | seconds matter; nothing else should queue in front |
| `documents` | malware scan, upload cleanup, orphan report, usage recount | depends on object storage and the scanner |
| `scheduled` | everything periodic: attention, reminders, retention, purges | minutes to days; tolerant of a slow neighbour |

## The registry

Each job declares, and CI checks (`pnpm verify:workers`, §106-§108, §198):

| Field | Meaning |
|---|---|
| `key` | `<area>.<name>`, unique. Used in logs, metrics, heartbeats, failures and `--run`. |
| `owner` | The domain directory whose service the job calls (`lib/modules/<owner>` or `lib/core/<name>`). The handler is one call into it (§3, §131). |
| `trigger` | `SCHEDULED` (every interval), `OUTBOX` (drains durable work items), `RECONCILIATION` (recomputes current truth), `MANUAL` (only on an operator's word). |
| `intervalSeconds`, `staleAfterSeconds` | When it is next due after a success, and how long without one before health calls it stale. |
| `leaseSeconds`, `timeoutSeconds` | How long a claim lives between extensions, and the most a run may take. |
| `retry` | `maxAttempts`, `initialDelaySeconds`, `maxDelaySeconds`. |
| `companyScope` | `COMPANY` (walks companies one at a time), `RECORD` (each work item carries its company), `PLATFORM` (no company data). |
| `suspendedCompanies` | `SKIPPED` or `INCLUDED` — housekeeping such as cleanup runs for suspended companies; nothing that tells people something does. |
| `idempotencyKey`, `catchUp` | What makes a run's effect one effect, and what happens to runs that were missed. |
| `criticality` | `CRITICAL`, `HIGH`, `NORMAL`, `LOW` — which alerts page (§118). |
| `requires` | A capability the job cannot run without (`scanner`). Without it the job is not run and health reports it `disabled` (§214). |
| `dryRun` | Whether `--dry-run` is supported. |

A deployment can switch jobs off with `WORKER_DISABLED_JOBS=key,key`. An unknown
key refuses startup, so a typo never leaves a job silently running.

## A run

`lib/core/jobs/job.runner.ts`.

1. **Claim.** One statement against the job's `worker_heartbeats` row: insert it,
   or take it over when it is due and no live lease is held. Two workers, or an
   old and a new release overlapping in a deploy, cannot both run a job (§23-§27).
   A claim that takes over an expired lease is recorded as a `LEASE_EXPIRED`
   failure — the previous holder died mid-run.
2. **Run.** The handler gets a `JobContext` (`now`, `lastSuccessAt`, `signal`,
   `dryRun`, `companyIds`, `correlationId`, `workerId`) and runs inside a request
   context that carries the job key, worker and correlation id to every log line,
   outbox event and audit row it writes (§12-§14).
3. **Extend.** Every third of the lease the worker extends it. A worker that finds
   its lease gone stops the job (`LEASE_EXPIRED`) rather than finishing alongside
   the new holder.
4. **Bound.** The signal aborts at the job's timeout (`TIMEOUT`), on shutdown
   (`ABORTED`) or on a lost lease. Abort asks; it cannot force. A handler that has
   not returned a few seconds after being asked is **abandoned**: the failure is
   recorded and its lease is left to expire instead of being released under code
   that may still be writing.
5. **Settle.** Only while the lease is still held: counts, duration, the last
   error's code and safe message, consecutive failures and when it is next due —
   on the heartbeat row. Every failure is also a row in `job_failures`.

Dates in raw SQL come from the database's clock in UTC (`DB_NOW`,
`lib/database/clock.ts`): the columns hold UTC without a zone, and a server in any
other timezone would otherwise make jobs due early and leases hours long.

### Retries

| Situation | Next attempt |
|---|---|
| Failure *n* < `maxAttempts` | `initialDelay × 2^(n−1)`, capped at `maxDelay`, ±20% jitter so recovering workers do not stampede (§31-§33) |
| `maxAttempts` failures in a row | Health reports `failed` and alerts fire; the job tries again after `max(interval, maxDelay)` so a fixed cause recovers on its own |
| Shutdown stopped the run cleanly | Not a failure: the lease is released and the job is due at once for whichever worker is still running |

Errors are classified in `lib/core/jobs/job.errors.ts` (§28-§30):

- **Retryable** — `TIMEOUT`, `ABORTED`, `LEASE_EXPIRED`, `DATABASE_UNAVAILABLE`,
  `DATABASE_CONFLICT`, `NETWORK`, `STORAGE_UNAVAILABLE`, `PARTIAL_FAILURE`,
  `UNSUPPORTED_PAYLOAD`, `UNKNOWN`.
- **Permanent** — `VALIDATION`, `STATE_CONFLICT`, `NOT_ELIGIBLE`, `CONFIGURATION`.

A scheduled job retries either kind on its schedule — the world may change — but
an outbox event with a permanent error fails at once rather than spending its
attempts. Messages are safe to store: never a query's arguments, a payload or a
stack.

`PARTIAL_FAILURE` is what a job throws when some companies or items failed and the
rest succeeded: every other unit still gets its effect, and the run is recorded as
failing so somebody looks.

## What every job guarantees

**Company scope (§10, §11, §144).** A `COMPANY` job walks companies through
`forEachCompany` (`lib/core/jobs/system-context.ts`): one company at a time,
`ACTIVE` companies only unless the job declares suspended companies `INCLUDED`,
only companies with the job's module switched on, each in its own context, and a
company that throws does not stop the others. `--company` narrows the walk; it
never widens it. No job updates "all records matching a status" across companies.

**System actor (§12, §13).** Audit rows written by a job name `SYSTEM` and the job
(`System (announcements.schedule)`), and carry the run's correlation id.

**Owners do the work (§3, §131, §199).** A handler calls its owner's service. The
handlers file and the worker command contain no query and no write; CI checks.
State changes go through the owning domain's guarded write or state machine,
binding the state read in the `where`, exactly as a person's change would.

**Idempotency (§15-§19).** Running a job twice, or two workers running it at once,
produces one effect. The mechanism is one of:

- a unique constraint on the effect itself (a notification's dedupe key, a
  reminder delivery row, a generated meeting's occurrence);
- a guarded transition that only the first writer wins;
- the idempotency ledger, `job_idempotency_keys` (`claimIdempotencyKey`): a row
  keyed by company, job and effect inserted in the same transaction as the effect,
  which acts only if it inserted. It replaces "count the outbox rows first" checks,
  which raced and forgot everything the outbox purge removed.

The ledger outlives the 365-day notification purge, so a condition that stays true
for months is not announced again.

**Bounded work (§133-§138).** No `take: N` that silently drops the rest: jobs walk
their work in small batches by a stable cursor, and check `jobStopRequested()`
between batches so shutdown and timeouts take effect mid-job.

**One bad item does not block the rest (§34, §36).** Items are isolated, logged by
id (never content) and counted; the run ends with `PARTIAL_FAILURE`. An outbox
event that keeps failing reaches `FAILED` after its attempts, and a worker killed
while holding one does not bring it back forever: at its maximum attempts it is
failed as `LEASE_EXPIRED`.

**Time (§48, §159).** Where a *day* matters — a reminder "once a day", a missing
daily log — it is the company's day in the company's timezone. Otherwise the
database clock.

**Dry run (§165, §166).** Jobs that delete or reconcile accept `dryRun`: they count
what they would do and write nothing, including when the job is next due.

## The outbox

`notifications.dispatch` (`lib/core/notifications/notification.dispatch.ts`)
drains `notification_event_outbox`:

- **Claim** a batch with `FOR UPDATE SKIP LOCKED`: `PROCESSING`, a five-minute
  lease, and the attempt counted at claim time — a worker that dies still spends
  the attempt.
- **Deliver** each event in the request context of its correlation id. Recipients
  are resolved and re-checked against the record; notifications are unique on
  company + recipient + dedupe key, so a redelivered event writes nothing twice.
- **Settle.** `PROCESSED`; or back to `PENDING` with a jittered backoff (30 s × 4ⁿ,
  capped at an hour); or `FAILED` on a permanent error or the fifth attempt, with
  the failure kept in `job_failures`.
- Events for a suspended company are settled without delivery, and are not
  delivered after it is reactivated: a notification weeks late is noise, and
  attention items are recomputed from what is true by then.
- An event whose `schemaVersion` is newer than this release understands is left
  for the newer release (`UNSUPPORTED_PAYLOAD`, retryable) — the overlap in a
  rolling deploy.
- On shutdown, or when the lease is close to running out, unstarted events go back
  to `PENDING` without spending their attempt.

**In-app notifications never depend on email (§212, §215).** With
`MAIL_DELIVERY=disabled` a deployment needs no mail provider; the dispatcher writes
notifications and skips email, and anything else that would mail records the
message as `SUPPRESSED`.

## Shutdown and deploys

On `SIGTERM` or `SIGINT` the worker stops claiming, aborts the job in hand, and
marks its process `STOPPING` (§57, §58). A job that stops cleanly releases its
lease; one that does not within `WORKER_SHUTDOWN_TIMEOUT_SECONDS` (default 30) is
abandoned and the process exits — its lease expires and another worker takes the
job over. A second signal exits at once.

A rolling deploy is safe with no coordination: the old and the new worker contend
for the same leases, so each job runs on one of them at a time, and the outbox's
schema version keeps an old worker from mishandling an event only the new release
understands. Deploy workers after migrations, like the web tier.

## Health, metrics, alerts

Everything is in the database, read by the database's clock, so every web
instance and every worker gives the same answer (§110-§124).

- **Process heartbeats** — `worker_processes`: each worker registers, beats every
  15 s, and is live while its last beat is under 60 s old.
- **Job heartbeats** — `worker_heartbeats`: one row per job; state is `ok`,
  `stale`, `failing`, `failed`, `never_run`, `disabled` or `manual`.
- **Tier health** — `UNHEALTHY` when a group holding a `CRITICAL` job has no live
  worker, or a `CRITICAL` job is failed, stale or has never run; `DEGRADED` for
  anything less; otherwise `HEALTHY`. `/api/health/ready` reports it as one word
  (`ok`, `degraded`, `unhealthy`, `not_running`); workers never take a web
  instance out of rotation.
- **Metrics** — `/api/internal/metrics` (`lib/core/jobs/job.metrics.ts`,
  `lib/core/observability/operational-gauges.ts`), labelled by `job`,
  `criticality` and `group` only, never by company.
- **Alerts** — `ops/alerts/workers.yml`. CI fails if an alert reads a metric the
  exporter no longer writes.
- **Logs** — structured, one `worker.job.started` and one `worker.job.completed`
  or `worker.job.failed` per run with job, run id, worker, correlation id, attempt,
  duration and outcome.

## Adding a job

1. Put the work in the owning domain's service: company-scoped through
   `forEachCompany`, batched by cursor, idempotent, items isolated, `dryRun` if it
   deletes or reconciles.
2. Add the handler to `lib/core/jobs/job.handlers.ts` — one call.
3. Add the definition to `JOBS`.
4. Write `tests/api/jobs/<key>.test.ts` with a top-level `describe("<key>")` and
   the nested describes CI requires (`tests/api/jobs/job-harness.ts`):
   `idempotency` and `failure` always; `company isolation` and `suspended company`
   unless the job is `PLATFORM`; `concurrency` for `CRITICAL`, `HIGH` and `OUTBOX`
   jobs.
5. `pnpm verify:workers --write` to regenerate `docs/worker-matrix.md`, and add a
   section for the job to `docs/worker-operations.md`.

## CI

| Step | Checks |
|---|---|
| `pnpm verify:workers` | registry validity, owners, contract tests present with the required describes, handlers only call owners, no route starts a job, alerts read real metrics, the matrix is current |
| `pnpm worker --validate` | the registry against the handlers, and the worker environment |
| `pnpm test:workers` | the runner (leases, crash takeover, timeouts, retries, dry runs, company scoping, shutdown, deploy overlap, process heartbeats) and every job's contract tests, against the real database |
| `pnpm test:architecture` | the same gates from the test runner |
