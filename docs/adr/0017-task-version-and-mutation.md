# ADR 0017: Tasks change through one locked, versioned mutation

**Status:** accepted, 26 September 2026
**Context:** AUD-02 Task Reliability ("AUD-02" below; §-numbers are its own),
after PRD #11 (Tasks), PRD #48 (transactions) and PRD #49 (state machines,
[state-machines.md](../state-machines.md)).

## Context

Every write to an existing task read it, checked it, and then wrote by `id`
alone:
- the edit compared an optional `versionUpdatedAt` with that read;
- Start, Block, Complete, Reopen, Archive and Restore checked the status they
  read.

Postgres takes no lock on a plain read, so two saves could both pass and the
second overwrote the first. The activity, notifications and meeting sync then
described the stale read: its title, its assignee, its status. The edit form
was optional about its stamp, so a client that sent none was never checked.
Other writers — seeds, repair SQL, and `ON DELETE SET NULL` on the project and
assignee — changed tasks with nothing a browser could notice.

## Decisions

1. **`Task.version`, an integer from 1** (migration
   `20260926140000_task_version_aud_02`, additive). It is the concurrency
   authority. `updatedAt` stays for display and sorting.

2. **A trigger as the safety net for every other writer.** `tasks_version_guard`
   is a `BEFORE UPDATE` trigger:
   - An update that changes a protected column without changing `version` gets
     `version + 1`. The protected columns are content, project, assignee,
     schedule, priority, status, the archive and blocked fields, the source
     link and the company.
   - An update that changes `version` may only add one, so a reset or a jump is
     refused.
   - An update that changes nothing protected keeps the version, which is what
     a seed rerun does.
   - Postgres refuses the overflow; the service refuses it one step earlier.

   This is the first trigger in the repository. It is here because the
   alternative is a list of writers someone has to keep complete: a future
   repair script or referential action would silently reopen the lost-update
   hole. Prisma ignores triggers, so `migrate diff` reports no drift.

   *Rejected:*
   - Changing the project and assignee foreign keys to `RESTRICT`: it changes
     deletion behaviour elsewhere for a guarantee the trigger gives anyway.
   - Relying on the writer inventory alone.

3. **One mutation path, `mutateTask`** (`lib/modules/tasks/task.mutation.ts`).
   It takes a command union: `edit`, `start`, `block`, `complete`, `reopen`,
   `archive`, `restore`. Every route, server action and other module goes
   through it with the version its person reviewed. Inside one
   `runInTransaction`:
   1. `lock_timeout` is set to 3 s.
   2. The actor's `company_members` row is read `FOR SHARE` and must be
      active.
   3. The `tasks` row is read `FOR UPDATE`.
   4. The task is re-read through the actor's scope, with the same client.
   5. The version is compared.
   6. The command is checked against the locked state, and the project and
      assignee against the transaction's view (share-locked).
   7. The write is `updateMany` where `id`, `companyId`, the version and the
      locked status match, with `version: { increment: 1 }`.
   8. Activity, notification events, the linked meeting action and the new
      assignee's subscription are written with the same client.

   A failure anywhere rolls the version back with the rest.

   *Rejected:* a compare-and-swap without the lock. It protects the write, but
   not the validations and side effects computed before it.

4. **Lock order.** The actor's membership → the task → the destination
   project → the assignee's membership → their project membership → the
   linked meeting action → the collaboration thread and subscriptions.
   - A membership or project revocation takes write locks on the same rows.
     If it committed first, the task command reads after it and refuses. If it
     arrives second, it waits for the command's commit.
   - Different tasks never wait for each other: nothing broader than a row is
     locked.

5. **The contract** (§6). `expectedVersion` is required on every command. The
   business code travels in `details.code`, as throughout the API:

   | Situation | Response |
   | --- | --- |
   | Version missing | 428 `PRECONDITION_REQUIRED` / `TASK_VERSION_REQUIRED` |
   | Version malformed | 422 with an `expectedVersion` field error |
   | Version stale | 409 `TASK_VERSION_CONFLICT` |
   | State wrong at the current version | 409 `TASK_STATE_CONFLICT` |
   | Transient failure after two retries | 503 `TEMPORARILY_UNAVAILABLE` / `TASK_RETRYABLE_FAILURE` |

   Access refusals (401/403/404) come before all of these, and a request
   without a version for a task the caller cannot see is 404, not 428.
   `versionUpdatedAt` is no longer read.

   Responses are `{ data, meta: { taskId, changed, version, updatedAt } }`.
   Archive and Restore answered 204 before; they now answer 200 with the same
   body, because the client needs the version.

6. **The task machine** (`task.machine.ts`, registered). It declares the six
   commands and the edit form's own `return_to_todo`. `canTransitionTaskStatus`
   and the edit form's statuses are derived from its non-archive rows, so no
   second table is kept. Tasks apply transitions through `mutateTask`, not
   `applyTransition`, because a task command locks, versions and validates
   relations in one place.

7. **Stakeholders are subscribed inside the transaction.** The collaboration
   door `subscribeStakeholdersIn(tx, …)` answers "can this member read the
   task" from the transaction's own view, through the registry's `find`, which
   now accepts the client. The member contexts are built before the
   transaction, so no transaction holds a second pool connection.

   Creating a task does the same. The meetings, HSE and QA/QC hand-offs no
   longer subscribe after their commit.

8. **The assignment notification's dedupe identity is the version**
   (`assignmentVersion: "v<version>"`), not a wall-clock string. A redelivered
   event is one notification.

9. **Conflict recovery is in the browser, explicit, and only in memory**
   (`TaskEditForm`, §7):
   - On a conflict: **Review latest** or **Keep editing**.
   - The review compares only the fields the person changed. A field the other
     change did not touch is preselected.
   - **Apply** reloads the form with the latest task, the chosen changes and the
     latest version. The person then saves it.
   - An archived task offers only Restore. A task out of sight shows nothing.
   - A thrown request is reported as unconfirmed and is never resent.

## Consequences

- Nothing can save over a change its author did not see. That covers
  concurrent saves, a double click, a replay after a lost response, and a
  repair script run meanwhile.
- A same-version save that changes nothing answers `changed: false` and writes
  nothing.
- Old clients and scripts that send no version are refused with 428. There is
  no optional fallback (§6).
- Task rows leave the blind and unreadable state-write baselines, and the
  meeting sync's status write is guarded on the status it read.
- Rollback:
  - Keep the column (§9).
  - The trigger may stay under old code: it only adds increments nobody
    reads.
  - Rolling back the code reopens the lost updates, so mutations should be
    paused or a guarded release restored instead.
