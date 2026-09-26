# Task mutations: version, locking and conflict recovery (AUD-02)

Built from **AUD-02 Task Reliability** (`NESTO_V0.1_PRD_AUD-02_Task_Reliability`,
cited as "AUD-02 §n"). The decisions are in
[ADR 0017](adr/0017-task-version-and-mutation.md).

Every change to an existing task names the version its person reviewed. It
commits only against that version, increments it once, and writes its
history, notifications, meeting sync and subscriptions in the same
transaction. Two people cannot silently overwrite the same task.

```
route / server action / other module
  → module, permission (403)            → version present? (404 if out of scope, else 428) and well-formed (422)
  → command fields (422)
  → runInTransaction("tasks.<command>")  ┐ lock_timeout 3s
      actor membership FOR SHARE         │ (inactive → 403)
      task row FOR UPDATE, scoped re-read│ (out of scope → 404)
      version = expected?                │ (no → 409 TASK_VERSION_CONFLICT)
      command legal from locked state?   │ (no → 409 TASK_STATE_CONFLICT)
      project, assignee (FOR SHARE)      │ (invalid → 422)
      unchanged? → changed:false, stop   │
      updateMany where id+company+version+status, version+1
      activity, outbox, meeting action, subscription (same tx)
                                         ┘ transient ×2 retries, then 503 TASK_RETRYABLE_FAILURE
  → read back through the actor's scope → { data, meta } or { data: null, meta, redirectTo: "/tasks" }
  → revalidate the same views for every transport
```

## Where things live

| Concern | Location |
| --- | --- |
| The column and the trigger | `prisma/schema.prisma` `Task.version`; migration `20260926140000_task_version_aud_02` (`tasks_version_guard`) |
| The commands and their rules | `lib/modules/tasks/task.machine.ts` (registered in `lib/core/state/registry.ts`); `task.status.ts` derives the edit moves |
| The one mutation path | `lib/modules/tasks/task.mutation.ts` — `mutateTask`, `readExpectedVersion`, `TaskMutationMeta` |
| Service entry points | `updateTask`, `startTask`, `blockTask`, `completeTask`, `reopenTask`, `archiveTask`, `restoreTask` in `task.service.ts`; all take `{ expectedVersion, … }` |
| Routes | `app/api/tasks/[taskId]/route.ts` (PATCH) and `…/{start,block,complete,reopen,archive,restore}/route.ts`; shared edges in `task.http.ts` |
| Server actions | `lib/actions/tasks.ts`: `updateTaskAction`, `taskCommandAction`, `taskReviewSnapshotAction` |
| Invalidation | `task.invalidate.ts` (`revalidateTaskViews`), for routes and actions alike |
| Stakeholders in the transaction | `subscribeStakeholdersIn` in `lib/core/collaboration/collaboration.service.ts` |
| Linked meeting action | `syncActionFromTask` in `lib/modules/meetings/meeting.task-sync.ts` |
| Pages | `components/tasks/task-edit-form.tsx` (conflict review), `task-actions.tsx`, `task-form.tsx`; `components/forms/record-form.tsx` (`onFailure` → handled, `onSuccess`, `UNCONFIRMED_RESULT`) |
| Metric | `task_mutation_ms{command,outcome}` in `lib/core/observability/metrics.ts` |

## Writer inventory (AUD-02 §2, §9)

| Writer | What it writes | How it is guarded now |
| --- | --- | --- |
| `task.service.ts` `writeTask` — `createTask`, `createTaskFromContext`, `createTaskFromContextIn` | A new row | Starts at version 1. Creator and assignee are subscribed and the assignment is enqueued (`v1`) in the same transaction |
| `task.mutation.ts` `mutateTask` | Every change to an existing task | Locked, versioned, guarded `updateMany` |
| Other modules | Meetings (`convertActionToTask`, `createActionItem`), HSE, QA/QC, Contracts, Daily logs, Planning, Engineering, Contractors, Work packages, Sales, Procurement and Inventory (via `/tasks/new?parent`) | They create through the doors above and change nothing afterwards. Meetings, HSE and QA/QC no longer subscribe after their commit |
| Seeds | `prisma/seed/business.ts`, `sales.ts`, `contracts.ts` and `armaar/operations.ts` use create-only upserts. The corrections in `armaar/tasks.ts` (`updateMany` on title and blocked fields) | The trigger bumps the version for a correction that changes something. A rerun that changes nothing keeps it |
| Referential actions | `Task.project` and `Task.assignee` `ON DELETE SET NULL` | The trigger bumps the version. No production code deletes projects or members |
| Raw SQL | None at runtime. Migration `20260919090000_workforce_e04` backfilled `entityId` once | The trigger covers any future repair |
| Tests and e2e helpers | Direct creates and updates of fixtures | The trigger versions them like any other writer |

A writer that tries to reset or jump the version is refused by the trigger.

## The contract (AUD-02 §3, §6)

**Request.** Every command body carries `expectedVersion`, a positive integer.
It may be a number, or a string of digits from a form.
- PATCH: the task's editable fields, plus `expectedVersion`.
- Start, Complete, Archive and Restore: `{ expectedVersion }`.
- Block: `{ expectedVersion, reason }`. The reason is trimmed and must be
  3–1 000 characters.
- Reopen: `{ expectedVersion, status? }`, where `status` is `TODO` (the
  default) or `IN_PROGRESS`.

A client cannot write:
- `version`;
- `companyId`, `createdByMemberId`, `completedAt`;
- the archive or blocked fields.

`versionUpdatedAt` is ignored. A request that carries only it is refused with
428.

**Response.**

```ts
{ data: TaskDetailDTO | null;          // null when the actor can no longer read the task
  meta: { taskId; changed; version; updatedAt };   // the version this command produced
  redirectTo?: "/tasks" }
```

Archive and Restore now answer this body with 200. Before AUD-02 they
answered 204.

**Refusals**, in this order:

| Order | Condition | Answer |
| --- | --- | --- |
| 1 | Not signed in; wrong workspace; module off; no permission | 401 / 409 `WORKSPACE_COMPANY_REQUIRED` / 403 |
| 2 | No version for a task the caller cannot see | 404 |
| 3 | No version | 428 `PRECONDITION_REQUIRED`, `details.code = "TASK_VERSION_REQUIRED"` |
| 4 | Malformed version (0, negative, fraction, text, > 2³¹−1) | 422 with `details.expectedVersion` |
| 5 | Invalid command fields (block reason, reopen target) | 422 with the field |
| 6 | Actor's membership revoked since the session was read | 403 `MEMBERSHIP_INACTIVE` |
| 7 | Task out of scope | 404 |
| 8 | Version is not the task's | 409 `CONFLICT`, `details.code = "TASK_VERSION_CONFLICT"` |
| 9 | Command not legal from the current state: a repeat, an archived task, a restore of a live one | 409 `CONFLICT`, `details.code = "TASK_STATE_CONFLICT"` |
| 10 | Edit rules: status move, BLOCKED without the command, project, assignee | 422 / 403 as before |
| 11 | Deadlock or serialisation after two retries; a lock wait over 3 s; a transaction timeout | 503 `TEMPORARILY_UNAVAILABLE`, `details.code = "TASK_RETRYABLE_FAILURE"` |

A conflict discloses nothing about the current task. The client reads a fresh
snapshot through its own scope.

Server actions return the same information as
`{ ok: false, code, error, fieldErrors? }`, where `code` is the business code
when there is one. A success is `{ ok: true, meta, redirectTo? }`.
`updateTaskAction` redirects to the task on success.

## Lifecycle (AUD-02 §5)

The moves are the task machine's. Everything is decided on the locked row:

| Command | From | Effect |
| --- | --- | --- |
| `start` | TODO, BLOCKED | IN_PROGRESS; blocked fields cleared |
| `block` | TODO, IN_PROGRESS | BLOCKED; reason, `blockedAt` and `blockedByMemberId` set by the server |
| `complete` | TODO, IN_PROGRESS, BLOCKED | COMPLETED; `completedAt` set by the server; blocked fields cleared; overdue attention resolved |
| `reopen` | COMPLETED | TODO or IN_PROGRESS; `completedAt` cleared |
| `archive` | any live status | ARCHIVED; `preArchiveStatus` is the locked status; completion and blocked fields kept |
| `restore` | archived | `preArchiveStatus`, or TODO for a legacy row without one. An invalid remembered status is refused (`TASK_STATE_CONFLICT`, `INVALID_PRE_ARCHIVE_STATUS`) |
| edit | live | The fields. A status move follows the edit moves (`start`, `complete`, `reopen`, `return_to_todo`) and needs `task.status.update`, plus `task.complete` or `task.reopen`. BLOCKED only through `block`. A completed task keeps its `completedAt`. A date given as a day keeps its stored time while the day is unchanged |

An edit that changes nothing at the current version answers `changed: false`.
It writes nothing and does not advance the version. The same edit from a stale
version is still a conflict.

## Side effects (AUD-02 §8)

All of these are in the transaction, from the locked "before" and the written
"after":

- **Activity.** `TASK_UPDATED` lists the changed field names, never their
  content, with `version: { from, to }`. `TASK_STATUS_CHANGED`,
  `TASK_ASSIGNED` / `TASK_UNASSIGNED` and `TASK_PROJECT_CHANGED` each carry
  their from/to. Each dedicated command writes its own entry.
- **Outbox.**
  - The status events carry the committed title, assignee and project.
  - `TASK_ASSIGNED` carries `assignmentVersion: "v<version>"`, the dispatcher's
    dedupe identity.
  - Delivery happens after the commit, through the worker. A failed delivery
    retries without touching the task.
- **Meeting action.**
  - Status and assignee changes, and Restore, move the linked action.
  - Archive leaves it where it was.
  - The action's status write is guarded on the status just read; a change in
    between fails the whole command.
- **Subscription.** A new assignee who can read the task — asked of the
  transaction's own view — is subscribed in the same commit.

After the commit, both transports refresh the same views:
- `/tasks` (layout) and `/tasks/:id`;
- `/dashboard`;
- the old and new project;
- the linked meeting;
- the parent record's page.

## Conflict recovery (AUD-02 §7)

**The edit form** (`TaskEditForm`) saves against the version the page
rendered.

- **On a conflict** it shows "This task changed while you were editing. Your
  changes have not been saved.", keeps the draft in the form, and moves focus
  to the message.
  - **Keep editing** closes the message. The next save conflicts again.
  - **Review latest** reads the task through the person's scope and lists only
    the fields they changed, **Latest** beside **Yours**. A field the other
    change did not touch is preselected; a field both changed starts
    unticked.
  - **Apply to the latest version** reloads the form with the latest task, the
    ticked changes and the latest version. The person then saves it.
- **An archived task** offers only **Restore task**, which then asks for a
  fresh review. **A task out of sight** shows nothing but **Go to tasks**.
- **A request that threw** (the connection dropped) shows "We couldn't confirm
  whether this change was saved. Check the latest task before trying again."
  The draft is kept and nothing is resent.
- **Access lost by the save itself** ("Saved. You no longer have access to
  this task.") goes to `/tasks`.

**The action buttons** send the version the page shows. On a conflict they
refresh the page to the latest state and ask again. They never re-send.

**The reason dialog** stays open, with the typed reason, until the server
confirms. A refusal is shown inside it. Reopening it after a refusal keeps the
reason and uses the version then shown.

The draft lives in component memory only, so it never follows the person to
another user or workspace. Leave-page protection is AUD-03's.

## Migration and rollback (AUD-02 §9)

1. Deploy the migration: the column (default 1) and the trigger. It is
   additive and needs no backfill.
2. Deploy the code. The contract is enforced from that release on; there is no
   optional-version window.

   On Vercel the build runs `migrate deploy` (`scripts/vercel-build.sh`) first,
   while the previous deployment still serves. That overlap is safe:
   - the previous deployment's writes are versioned by the trigger, so no new
     client can save over them;
   - once the new deployment takes the alias, no old writer remains.
3. Rollback:
   - Keep the column.
   - The trigger can stay under old code: it only adds increments nobody
     reads.
   - Rolling back the code re-opens lost updates, so pause task mutations or
     restore a guarded release instead.
   - To remove the trigger:
     `DROP TRIGGER "tasks_version_guard" ON "tasks"; DROP FUNCTION "tasks_version_guard"();`

## Tests and commands

Every command runs against a real PostgreSQL lane, never the dev server's
database.

| What | Command | Notes |
| --- | --- | --- |
| TR-01–TR-08, TR-10–TR-20, TR-23, TR-24 (service, concurrency, rollback, delivery, meeting) | `npx vitest run tests/api/tasks/task-reliability.test.ts` | Races use a row-lock barrier. A second connection holds the task's lock until `pg_blocking_pids` shows every command queued behind it. Faults are injected by temporary triggers. `aud02_…` fixtures |
| TR-09, TR-21 (every command route, and the server actions) | `npx vitest run tests/api/tasks/task-commands-http.test.ts` | The session resolver is replaced by `security/harness/actor`. `next/cache` and `next/navigation` are recorded |
| Existing task rules | `npx vitest run tests/unit/tasks tests/api/tasks` | |
| TR-17, TR-18, TR-22 (browser) | `NEXT_DIST_DIR=.next-e2e next build` → `next start -p 3170` → `E2E_BASE_URL=http://localhost:3170 npx playwright test tests/e2e/modules/task-reliability.spec.ts` (`AUD02_SHOTS=<dir>` saves the widths) | The Owner changes the task from a second browser context through the API |
