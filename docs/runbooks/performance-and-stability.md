# Performance and stability runbook

Per AUD-07 §5, §7, §8 (PS-09, PS-10, PS-13..PS-19, PS-21). This page covers
latency, errors, database pressure, the failure and recovery contract the
browser follows, worker limits, and rollback. For how workers operate day to day,
see `docs/worker-operations.md` and `notification-worker.md`. Deployment and
rollback mechanics are in `deployment.md` and `release-rollback.md`.

Nothing here says an alert is live. The checked-in alert rules are the ones in
`ops/alerts/workers.yml`. The thresholds under
[Signals and thresholds](#signals-and-thresholds) are proposals for the
monitoring setup; each one names the metric or log event it reads.

## Deadlines: every layer, innermost first

The rule is that an inner layer finishes, or returns a controlled error, before
the layer outside it gives up. The browser's deadline is the outermost one a
person sees. Everything the server does for an interactive request must fit
inside it.

| Layer | Setting | Value | Where | Status |
|---|---|---|---|---|
| Postgres lock wait, inside a transaction | `lock_timeout`, local to the transaction | 80% of the transaction's timeout (4 s by default) | `lib/core/transactions/transaction.ts` `boundWaits` | **Added in AUD-07.** Before this, a statement queued behind another connection's row lock waited until that lock was released, measured at 60 s. Prisma's own timeout does not interrupt a statement that is already running. |
| Postgres statement, inside a transaction | `statement_timeout`, local to the transaction | the transaction's timeout (5 s by default) | same | **Added in AUD-07** |
| Interactive transaction | Prisma `timeout` | 5 s default (`TRANSACTION_DEADLINE_MS`) | same | Some callers set longer ones: tasks 10 s, finance register 15 s, meetings and approvals 30 s, planning templates 30 s and 60 s, integrity jobs 300 s. The browser deadline covers the first three of these. The 30 s and 60 s ones run past the 10 s read deadline: see [Open items](#open-items). |
| Waiting for a pooled connection (transaction) | Prisma `maxWait` | 2 s default (`TRANSACTION_MAX_WAIT_MS`) | same | Tested (PS-17) |
| Waiting for a pooled connection (plain query) | `pool_timeout` in the URL | Prisma default of 10 s locally; **30 s on Vercel** | `lib/database/prisma.ts` | **Inverted:** 30 s is longer than the 10 s browser deadline. See [Open items](#open-items). |
| Pool size | `connection_limit` | 20 on Vercel, `cpus*2+1` locally | `lib/database/prisma.ts` | |
| Postgres server-wide statement timeout | none configured by the app | – | Supabase role defaults | Transactions are now bounded by `boundWaits`. Plain queries outside a transaction are not bounded. |
| Server route | Vercel function `maxDuration` | not set in `vercel.json` (`regions: ["fra1"]` only), so the platform default applies | `vercel.json` | Confirm the project's default in the Vercel dashboard. The repository does not say what it is. |
| Server-side storage calls (S3 or Supabase) | none: `fetch` with no signal | undici's default of 300 s for headers and body | `lib/core/storage/providers/s3.provider.ts` | **Unbounded in practice.** See [Open items](#open-items). |
| Mail provider | `timeoutMs` | 10 s; mail-service backoff of 250 ms and then 1 s | `lib/mail/providers.ts`, `lib/mail/mail.service.ts` | Runs only in the worker, never inside a request transaction |
| CSV export | `maxDurationMs` | 30 s, which returns `EXPORT_TIMEOUT` | `lib/core/export/exporter.ts` | Explicit long operation |
| Browser, interactive read (GET) | `READ_DEADLINE_MS` | **10 s, retry included** | `lib/client/api-request.ts` | **Added in AUD-07** for every module helper and the calendar |
| Browser, write | `WRITE_DEADLINE_MS` | 30 s. After that the outcome is *unknown*, never *failed*. | same | **Added in AUD-07** |
| Browser, uploads | per-file queue; status polled every 2 s, then every 10 s after 90 s | `components/documents/upload-client.ts` | Own progress and limits, unchanged |
| Worker job | `timeoutSeconds` for each job | see [Worker limits](#worker-limits) | `lib/core/jobs/job.registry.ts` | The run is aborted and recorded as `TIMEOUT` |
| Worker shutdown | `WORKER_SHUTDOWN_TIMEOUT_SECONDS` | 30 s default, 5 to 600 | `lib/core/jobs/worker.env.ts` | |

### Per-operation deadlines

| Operation | What the person waits for, at most | What happens at the deadline |
|---|---|---|
| Read a list, record, search or options (GET) | 10 s in total, one automatic retry included | Loading stops, the query and filters stay, and an inline **Try again** appears |
| Save, decide or delete (POST, PATCH, PUT, DELETE) | 30 s | The outcome is **unknown**: the draft is kept, the page says *"We couldn't confirm whether this saved. Check the record before trying again."*, and nothing is replayed |
| Transaction on the server | 5 s by default (4 s of it waiting on locks), plus up to 2 s to get a connection | Rolled back by Postgres or Prisma. The caller gets a contention error that `isContention()` recognises. |
| Export | 30 s | `EXPORT_TIMEOUT`, with the limit stated |
| Upload | per file | The failure is shown per file, and the file can be retried alone |
| Worker job run | the job's `timeoutSeconds` | Aborted, recorded as `TIMEOUT`, retried under the job's policy |

## Failure and recovery contract (browser)

All seven module helpers go through `lib/client/api-request.ts`: engineering
and contractors, approvals, timesheets, daily logs, planning, announcements
(which also serves the projects portfolio) and meetings. The calendar's range
read goes through it too. The contract, tested in
`tests/unit/client/aud07-api-request.test.ts`:

| Failure | Behaviour |
|---|---|
| A read times out, the network is lost, or the server answers 5xx or 408 | At most **one** automatic retry, after a jittered 200–600 ms pause, and only when at least 1 s of the deadline is left. After that the failure is thrown: pending state ends and the caller shows its inline Retry. A timeout uses up the deadline, so it is never retried automatically. |
| 429 on a read | The retry honours `Retry-After`, in seconds or as an HTTP date, when it fits in the deadline. Otherwise there is no retry, and the message says *"Try again in N seconds"*. `retryAfterSeconds` is on the failure. |
| 400, 401, 403, 404, 409, 410, 422 or 428 | Never retried. The module's own validation, sign-in, permission, not-found or conflict handling takes over. The AUD-02 and AUD-03 conflict review is unchanged. |
| The application refuses a write, or rolls it back (an envelope with 4xx or 5xx) | The outcome is definite: `refused`, `invalid`, `conflict` or `failed` (AUD-03's `outcomeOf`). The draft is kept. No success is shown. |
| A write times out, the network is lost, or a gateway returns a bare 5xx (no NESTO envelope) | `UNCONFIRMED`, and `apiFailureOutcome()` returns `unknown`. The draft is kept. The write is **never** replayed automatically. Approvals keep the attempt's idempotency key, so the person's retry cannot record the decision twice. |
| The change commits but the read-back fails | The page reports it as saved and retries only the read, through `router.refresh()`. The business write is never retried. This applies to daily-log entries, timesheet saves and announcement steps. |
| The search, filter, tab or record changes while a read is in flight | The older read is aborted and its answer ignored (`lib/client/latest-request.ts`). An aborted read throws `ABORTED`, and callers drop it without an error or an unhandled rejection. This applies to the approvals list, detail and "Load more", the delegation candidate search, the projects portfolio's "Load more" (dropped when the search changes), a milestone drawer switched to another milestone, and the calendar range. Existing guards stay as they were: announcements "Load more" (AUD-08), timesheet task options, engineering links and RFI reference options, and the global and people search. |
| An optional widget fails | Its own catch keeps the rest of the page. Examples are announcement metrics, workforce suggestions and planning copy choices. Shell-slot containment and its 1.5 s timing (PS-09) are measured by the lead's benchmark. |

Server-side, the transaction helper now fails bounded under contention. That
behaviour is tested in `tests/api/jobs/aud07-contention.test.ts` (PS-17):

- A transaction blocked on a held row lock ends in a controlled error within
  its deadline. This holds for raw SQL and for typed ORM writes alike.
  Neither write survives, and nothing is left queued behind the lock.
- With the pool exhausted, a new transaction is refused within `maxWait`
  instead of queueing forever. The pool then recovers.

## Worker limits

These values are read from `lib/core/jobs/job.registry.ts`. Every job is
`SINGLETON`, which means one worker at a time through its lease. A failed run
is retried with an exponential backoff between the first and the maximum delay
shown, with jitter.

| Job | Group | Trigger | Criticality | Attempts (backoff) | Lease | Deadline |
|---|---|---|---|---|---|---|
| `notifications.dispatch` | notifications | OUTBOX | CRITICAL | 5 (15 s → 5 min) | 120 s | 300 s |
| `calendar.reminders` | notifications | SCHEDULED | HIGH | 5 (15 s → 5 min) | 120 s | 300 s |
| `notifications.due` | scheduled | SCHEDULED | NORMAL | 4 (1 min → 30 min) | 120 s | 900 s |
| `attention.reconcile` | scheduled | RECONCILIATION | HIGH | 5 (15 s → 5 min) | 120 s | 900 s |
| `approvals.overdue` | scheduled | SCHEDULED | NORMAL | 4 (1 min → 30 min) | 120 s | 900 s |
| `announcements.schedule` | scheduled | SCHEDULED | HIGH | 5 (15 s → 5 min) | 120 s | 300 s |
| `announcements.reminders`, `timesheets.reminders`, `dailylogs.missing`, `planning.milestones`, `engineering.reminders` | scheduled | SCHEDULED | NORMAL | 4 (1 min → 30 min) | 120 s | 900 s |
| `contractors.compliance`, `hr.credential-expiry` | scheduled | SCHEDULED | NORMAL | 3 (5 min → 2 h) | 120 s | 1800 s |
| `sales.unit-reservations` | scheduled | SCHEDULED | NORMAL | 5 (15 s → 5 min) | 120 s | 900 s |
| `hr.employment-changes`, `finance.unit-installments` | scheduled | SCHEDULED | NORMAL | 5 (15 s → 5 min) | 600 s | 1800 s |
| `meetings.series` | scheduled | SCHEDULED | NORMAL | 4 (1 min → 30 min) | 120 s | 1800 s |
| `project-3d.process-models` | documents | OUTBOX | HIGH | 5 (15 s → 5 min) | 900 s | 1800 s |
| `documents.scan` | documents | OUTBOX | CRITICAL | 5 (15 s → 5 min) | 120 s | 600 s |
| `storage.cleanup` | documents | SCHEDULED | HIGH | 4 (1 min → 30 min) | 120 s | 1200 s |
| `storage.orphans` | documents | RECONCILIATION | LOW | 3 (5 min → 2 h) | 120 s | 2700 s |
| `storage.usage` | documents | MANUAL | LOW | 3 (5 min → 2 h) | 120 s | 1800 s |
| `recentwork.prune`, `productivity.stale-references` | scheduled | SCHEDULED | LOW | 3 (5 min → 2 h) | 120 s | 1800 s |
| `retention.run` | scheduled | SCHEDULED | LOW | 3 (5 min → 2 h) | 120 s | 3600 s |
| `security.throttle-purge` | scheduled | SCHEDULED | LOW | 4 (1 min → 30 min) | 120 s | 300 s |

Some items have their own limits, separate from the run's:

- **Notification outbox event:** `MAX_ATTEMPTS` is 5. The backoff is 30 s,
  2 min, 8 min and 32 min, capped at 1 h, ±20%. Then the event is `FAILED`, kept
  with its history in `job_failures`, and can be retried by an operator
  (`retryFailedNotificationEvents`, `pnpm worker --failures`).
- **Scanned file:** `MAX_SCAN_ATTEMPTS` is 12 and `SCAN_LEASE_MS` is 15 min
  (`lib/modules/documents/storage/scan.service.ts`).

What the tests prove (PS-18). All of these pass on an isolated database:

- `tests/api/jobs/aud07-worker-stability.test.ts` covers the whole path:
  - The event exists exactly when the business transaction committed.
  - A crash between delivery and settling still delivers once.
  - A worker that died holding a batch loses none of it: after the lease,
    another worker takes it over, and the takeover is recorded as
    `LEASE_EXPIRED`.
  - A poison event stops at 5 attempts, stays visible with 5 failure rows,
    and an operator's retry delivers it once, with its history kept.
- `notifications.dispatch.test.ts`, `documents.scan.test.ts` and
  `runner.test.ts` each prove one rule: dedup, concurrency, lease takeover,
  timeout, backoff, poison, and shutdown handing back the claim.

## Signals and thresholds

The metrics endpoint is `/api/internal/metrics`. It accepts only a bearer
token, and does not exist at all without `METRICS_TOKEN`. Host logs and
function durations are read through authorised Vercel access only.

| Signal | Source | Proposed threshold |
|---|---|---|
| Interactive latency | `navigation_duration_ms{stage="primary"}`, `panel_ready_ms`, `web_vital{metric="INP"}` (histograms, so p95 is available) | p95 above the PRD §4 budget for 15 minutes |
| Server errors | `api.unhandled_error` log events; Vercel 5xx rate | more than 1% of requests for 10 minutes, or a step change after a deploy |
| Contention | `transaction_failure_total{operation}`, `transaction_retry_total{operation}`, `conflict_total` | failures rising for one operation, or retries more than 5% of successes |
| Pool pressure | `transaction.failed` warnings where `isContention()` is true (P2024, P2028, 55P03, 57014) | any sustained rate |
| Worker backlog | `notification_outbox_due`, `notification_oldest_due_age_seconds`, `scan_queue_age_seconds` | already in `ops/alerts/workers.yml` (`NotificationOutboxBacklog`, `ScanQueueStuck`) |
| Poison work | `notification_outbox_failed`, `scan_failed_last_hour` | already in `ops/alerts/workers.yml` |

## Playbooks

### Latency rises and stays high

1. Scope it:
   - Is it one route or all routes? Use `navigation_duration_ms` by `route`,
     and the Vercel function durations.
   - Did it start with a deploy? Compare against the deployment time.
2. If it is one route, reproduce the route's read on a disposable database with
   the perf statement counter (`NESTO_PERF_SQL_COUNT=1`, agent K's tooling in
   `docs/perf/`). Look for per-row query growth (PS-05) and for query plans that
   got worse.
3. If it is all routes, check the database first: active connections, locks
   (`pg_blocking_pids`), long transactions (`pg_stat_activity` ordered by
   `xact_start`). Then check pool pressure, below.
4. Never "fix" latency by caching across requests. A cross-request cache needs
   a key, a scope, a lifetime, invalidation, and a revocation test (PRD §6).

### Error rate rises

1. Group `api.unhandled_error` by route and error code. The browser shows only
   the code and a reference. The full error is in the log, and it is redacted
   (see [Redaction](#redaction-rules)).
2. Reads recover by themselves: each read is retried at most once, and after
   that the person gets Retry. There is no retry storm to shut down.
3. Writes are never replayed by the browser. If the failures are gateway
   timeouts, people see an *unknown* outcome, and the fix is on the server.
   Check that the operation committed by looking up the record. Do not ask
   people to "just retry" a create.

### The pool is exhausted, or the database is contended

Symptoms:

- `transaction_failure_total` rising, and the log shows
  `P2024`/`P2028` (the pool or a transaction deadline) or `55P03`/`57014`
  (a lock or statement timeout)
- `pg_stat_activity` shows many sessions `idle in transaction`, or many
  sessions waiting on locks

Steps:

1. Find the blocker:

   ```sql
   SELECT pid, pg_blocking_pids(pid), state, now() - xact_start AS age, left(query, 80)
   FROM pg_stat_activity WHERE datname = current_database() ORDER BY xact_start;
   ```

2. A long holder is usually a job or an integrity check running a transaction
   with a long timeout: `company-integrity` and `workflow-consistency` allow
   300 s. Let it finish, or cancel it with `pg_cancel_backend(pid)`.
   `pg_terminate_backend` is for a session that ignores the cancel.
3. Interactive transactions are bounded: 4 s of lock wait and 5 s of statements
   by default. The error they end with is contention, not a hang, so
   requests stay responsive while you work.
4. Do not raise `connection_limit` above what the Supabase pooler allows.
   Scaling functions multiplies each instance's pool.

### The backlog grows

See `docs/worker-operations.md`. In short:

1. `pnpm worker --status` shows whether a worker is alive and which job is
   failing.
2. Pending work is durable, so a restart loses nothing. Leases expire (the
   outbox after 120 s) and the next worker takes the work over.
3. Poison events stop at their maximum attempts, and `pnpm worker --failures`
   lists them. Fix the cause, then retry them as the operator. Do not reset
   `attemptCount` by hand.

### A deployment fails, or you roll back

Follow `release-rollback.md`. AUD-07 adds these rules:

1. **The rollback floor.** Never roll the application back past a commit that
   fixed a known permission or concurrency defect. The previous artifact would
   bring the defect back. The current floor:
   - `0c3aa0f7`: AUD-06 server authorisation and demo roles, AUD-12 §5
     database safeguards
   - `b9538fbc`: AUD-10 cross-module workflow reliability, one pending
     approval per record
   - `88770e88`: AUD-02 task versioning and trigger, AUD-03 unsaved work
   - `594dc58c`: AUD-01 finance settlement in the database

   Below the floor, forward-fix instead.
2. **The schema moves forward only.** Migrations after these commits add
   constraints and triggers that older code may not satisfy. Check
   `release-rollback.md` §"Decide first" before redeploying an older
   artifact.
3. **Committed business data is never rolled back by a code rollback.** Workers
   that ran under the new version keep their effects. Outbox events and
   notifications are deduplicated, so a worker from the old version that picks
   up the same events does not deliver them twice.
4. **After the deploy or rollback,** compare the signals above with the hour
   before. Use authorised environment access only, and attach what you
   compared to the release record.

## Redaction rules

These apply to telemetry, logs, metrics, error references and this runbook's
evidence (PS-21):

- **Metric labels** come from closed sets: module, route template, operation
  and outcome. They never contain IDs, names, company IDs or query text.
  Histogram label values outside the allowed sets are dropped
  (`lib/core/observability/metrics.ts`). Transaction metrics carry only the
  operation name, such as `procurement.order.approve`.
- **Logs** go through `lib/core/observability/redaction.ts`. It masks
  passwords, tokens, cookies, authorisation headers, signed URLs, secrets and
  keys.
- **Prisma logging** is `error` only (`warn` too in development). Query
  logging, which would include SQL bindings, is off. The opt-in perf
  statement counter reads only the statement's kind and duration, never its
  parameters. Contention logs carry only the operation, the attempt, the
  duration and the correlation ID.
- **Error references** shown to a person contain a code and a reference only.
  They never contain a stack, SQL, a credential, or a record's name.
- **Browser failures** from `lib/client/api-request.ts` carry the server's
  envelope message, the status and the code. They never carry request bodies
  or headers.
- **Worker failures** keep the message truncated to 500 characters in
  `job_failures`. Mail runs with `MAIL_DELIVERY=disabled`, or into a test sink,
  in every test and benchmark.
- **Evidence** attached to a benchmark or an incident uses demo identities and
  disposable databases. Never attach `DATABASE_URL`, tokens, or production
  query parameters.

## Open items

These are outside this change, and each has a proposed owner:

- `pool_timeout` is 30 s on Vercel (`lib/database/prisma.ts`), which is longer
  than the 10 s client read deadline. The proposal is 8 s, so that a pool wait
  fails inside the read deadline and the person's Retry happens after the
  server has given up, not while it still holds the request.
- Server-side storage `fetch` calls have no deadline
  (`lib/core/storage/providers/s3.provider.ts`). The proposal is
  `AbortSignal.timeout(...)` on each call: 10 s for HEAD and DELETE, and a
  deadline for GET and PUT that scales with the object's size.
- Contention errors reach the API as a 500 `INTERNAL_ERROR`, because
  `lib/api/failure.ts` does not classify them. The proposal is to map
  `isContention(error)` to `TEMPORARILY_UNAVAILABLE` (503, "Nothing was saved;
  try again."). Reads would then be retried once, and writes would read as a
  definite *failed*, which is true: the transaction rolled back.
- Interactive transactions whose timeout is longer than the read deadline:
  meetings (`TX` is 30 s), approvals (30 s at `approvals.service.ts:442`) and
  planning templates (30 s and 60 s). These are writes, so the browser waits
  up to 30 s and then reports *unknown*. The proposal is to review whether they
  need more than 10 s.
- No alert rules exist yet for latency, errors or contention. The table above
  is the proposal for `ops/alerts/`.
