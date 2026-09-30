import { Prisma, type TaskPriority, type TaskStatus } from "@prisma/client";

import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere, buildTaskScopeWhere } from "@/lib/access/scope";
import type { Permission } from "@/config/permissions";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { subscribeStakeholdersIn } from "@/lib/core/collaboration/collaboration.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { logger } from "@/lib/core/observability/logger";
import { observeHistogram } from "@/lib/core/observability/metrics";
import { recordDefinition } from "@/lib/core/records/record.registry";
import { permissionsOf, targetsOf, transitionFor } from "@/lib/core/state/machine";
import { isTransient, runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { syncActionFromTask } from "@/lib/modules/meetings/meeting.task-sync";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { taskMachine, type TaskAction } from "./task.machine";
import { canTransitionTaskStatus, isTaskArchived, REOPEN_STATUSES } from "./task.status";

/**
 * The one way an existing task changes (AUD-02 §3, §4).
 *
 * Every edit, status command, archive and restore — from the API, a server
 * action, or another module — comes through `mutateTask` with the version its
 * person reviewed. Inside one short transaction it:
 *
 *   1. re-checks the actor's membership (`FOR SHARE`) and locks the task row
 *      (`FOR UPDATE`), then re-reads the task through the actor's scope;
 *   2. refuses a version that is not the locked one (TASK_VERSION_CONFLICT);
 *   3. validates the command against the locked state (TASK_STATE_CONFLICT)
 *      and the project and assignee against the transaction's own view;
 *   4. writes with `id`, `companyId`, the expected version and the locked
 *      status in the `where`, incrementing the version once;
 *   5. writes the activity, the notification events, the linked meeting
 *      action (status, owner, due date and its completion history — AUD-10
 *      §5) and the new assignee's subscription with the same client, so a
 *      failure in any of them rolls the version back too.
 *
 * Lock order, everywhere a task is changed: the actor's `company_members` row
 * → the `tasks` row → the destination `projects` row → the assignee's
 * `company_members` row → their `project_members` row → the linked
 * `meeting_action_items` row → the collaboration thread and subscriptions. A
 * membership or project revocation takes the same rows' write locks, so it
 * either commits first — and this transaction, reading after it, refuses — or
 * waits for this one to commit and then applies to the task as it now is.
 *
 * Nothing here reads the latest version to stand in for a missing one, and
 * nothing retries a business conflict: the person's intent is out of date and
 * repeating it would overwrite somebody's change. Transient database failures
 * are retried at most twice by `runInTransaction`, each attempt re-reading
 * everything; after that the answer is TASK_RETRYABLE_FAILURE.
 */

const MODULE = "tasks" as const;
const ENTITY = "Task";
const RECORD = "task";

/** Postgres `integer`: a version is refused at its limit rather than wrapped (AUD-02 §3). */
export const TASK_VERSION_MAX = 2_147_483_647;

/**
 * An edit's fields (AUD-09 §4, FV-05): `undefined` keeps the saved value,
 * `null` clears it, a value replaces it. Only the fields the request named
 * can change.
 */
export type TaskEditFields = {
  title?: string;
  description?: string | null;
  projectId?: string | null;
  assigneeMemberId?: string | null;
  status?: string;
  priority?: string;
  startDate?: Date | null;
  dueDate?: Date | null;
};

export type TaskCommand =
  | { kind: "edit"; fields: TaskEditFields }
  | { kind: "start" }
  /** Take an unassigned task: the actor becomes its assignee (MOB-06 §21-§23). */
  | { kind: "claim" }
  | { kind: "block"; reason: string }
  | { kind: "complete" }
  | { kind: "reopen"; target: TaskStatus }
  | { kind: "archive" }
  | { kind: "restore" };

export type TaskCommandKind = TaskCommand["kind"];

/** What every successful task command answers (AUD-02 §6). */
export type TaskMutationMeta = {
  taskId: string;
  changed: boolean;
  /** The version this command committed — or, unchanged, the one it found. Never a later one. */
  version: number;
  updatedAt: string;
};

/** The pages the change touched, for the transports to refresh (AUD-02 §8). */
export type TaskMutationEffects = {
  projectIds: string[];
  meetingIds: string[];
  parentHref: string | null;
};

export type TaskMutationResult = { meta: TaskMutationMeta; effects: TaskMutationEffects };

export const TASK_ERROR = {
  VERSION_REQUIRED: "TASK_VERSION_REQUIRED",
  VERSION_CONFLICT: "TASK_VERSION_CONFLICT",
  STATE_CONFLICT: "TASK_STATE_CONFLICT",
  RETRYABLE: "TASK_RETRYABLE_FAILURE",
} as const;

/* -------------------------------------------------------------------------- */
/* The precondition                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The version a request names, or why it names none.
 *
 * Missing is 428: the client was built before the contract, or lost the value,
 * and should reload. Anything present but not a positive integer in range —
 * zero, a fraction, a negative, text, a number too large — is 422. A
 * well-formed version that is simply not the current one is a conflict, found
 * under the lock.
 */
export function readExpectedVersion(raw: unknown): { ok: true; version: number } | { ok: false; error: AccessError } {
  if (raw === undefined || raw === null || raw === "") {
    return {
      ok: false,
      error: new AccessError("PRECONDITION_REQUIRED", "Reload this task before changing it: the request did not say which version you reviewed.", {
        code: TASK_ERROR.VERSION_REQUIRED,
      }),
    };
  }
  const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,10}$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > TASK_VERSION_MAX) {
    const message = "The task version must be a whole number of at least 1.";
    return { ok: false, error: new AccessError("VALIDATION_ERROR", message, { expectedVersion: [message] }) };
  }
  return { ok: true, version: value };
}

/* -------------------------------------------------------------------------- */
/* The command                                                                 */
/* -------------------------------------------------------------------------- */

/** The permission a command needs before anything is read (the edit form's own status checks come later). */
function commandPermission(command: TaskCommand): Permission {
  if (command.kind === "edit") return "task.update";
  // Claiming is taking unassigned work, not editing it: the status permission
  // is the one an assignee needs to work the task anyway.
  if (command.kind === "claim") return "task.status.update";
  const transition = transitionFor(taskMachine, command.kind);
  if (!transition) throw new Error(`task machine has no "${command.kind}"`);
  return permissionsOf(transition)[0];
}

/** The command's own fields, checked before anything is locked (AUD-02 §5). */
function validateCommandInput(command: TaskCommand): TaskCommand {
  if (command.kind === "block") {
    const reason = (command.reason ?? "").trim();
    if (reason.length < 3) throw new AccessError("VALIDATION_ERROR", "Say why the task is blocked.", { reason: ["Say why the task is blocked."] });
    if (reason.length > 1000) {
      throw new AccessError("VALIDATION_ERROR", "Keep the reason under 1,000 characters.", { reason: ["Keep the reason under 1,000 characters."] });
    }
    return { kind: "block", reason };
  }
  if (command.kind === "reopen" && !REOPEN_STATUSES.includes(command.target)) {
    throw new AccessError("VALIDATION_ERROR", "A task can only reopen as To Do or In Progress.", { status: ["Choose To Do or In Progress."] });
  }
  return command;
}

export type MutateTaskOptions = {
  /** The clock for server-set timestamps (completion, block, archive); tests freeze it. */
  now?: () => Date;
};

export async function mutateTask(
  context: UserContext,
  taskId: string,
  rawExpectedVersion: unknown,
  requested: TaskCommand,
  options: MutateTaskOptions = {},
): Promise<TaskMutationResult> {
  const started = Date.now();
  let outcome: TaskOutcome = "failure";
  try {
    // Access first: a refusal is never outranked by a conflict or a
    // precondition (AUD-02 §6).
    assertModule(context, MODULE);
    assertPermission(context, commandPermission(requested));

    // Then the precondition, before the command's own fields: a request that
    // names no version is answered "reload", whatever else it lacks.
    const expected = readExpectedVersion(rawExpectedVersion);
    if (!expected.ok) {
      // Somebody who may not see the task learns nothing about it, not even
      // that their request was missing a version for it.
      if (!(await taskInScope(context, taskId))) throw new AccessError("NOT_FOUND");
      throw expected.error;
    }
    const command = validateCommandInput(requested);

    // Who the new assignee is, read before the transaction: their context
    // does not change with the task, and reading it inside would hold a
    // second connection while this one waits.
    const candidates =
      command.kind === "edit" && command.fields.assigneeMemberId
        ? await buildMemberContexts(context.companyId, [command.fields.assigneeMemberId])
        : command.kind === "claim"
          ? await buildMemberContexts(context.companyId, [context.membershipId])
          : new Map<string, UserContext>();

    const result = await runInTransaction(
      `tasks.${command.kind}`,
      (tx) => apply(tx, context, taskId, expected.version, command, candidates, options.now ?? (() => new Date())),
      { attempts: 3, timeout: 10_000, maxWait: 5_000 },
    ).catch(translateTransactionError);

    outcome = result.meta.changed ? "committed" : "unchanged";
    return result;
  } catch (error) {
    outcome = outcomeOf(error);
    throw error;
  } finally {
    observeHistogram("task_mutation_ms", { command: requested.kind, outcome }, Date.now() - started);
  }
}

type TaskOutcome =
  | "committed"
  | "unchanged"
  | "version_conflict"
  | "state_conflict"
  | "version_required"
  | "refused"
  | "retryable"
  | "failure";

function outcomeOf(error: unknown): TaskOutcome {
  if (!(error instanceof AccessError)) return "failure";
  const code = (error.details as { code?: string } | undefined)?.code;
  if (code === TASK_ERROR.VERSION_CONFLICT) return "version_conflict";
  if (code === TASK_ERROR.STATE_CONFLICT) return "state_conflict";
  if (code === TASK_ERROR.VERSION_REQUIRED) return "version_required";
  if (code === TASK_ERROR.RETRYABLE) return "retryable";
  return "refused";
}

/**
 * A transaction that failed without committing: deadlock or serialisation
 * after the retries, a lock wait past `lock_timeout`, or the transaction's own
 * timeout. Nothing was written, so "try again" is true — but only the person
 * may decide to, against the task as it is now.
 */
function translateTransactionError(error: unknown): never {
  if (error instanceof AccessError) throw error;
  const retryable =
    isTransient(error) ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2028" || (error.meta as { code?: string } | undefined)?.code === "55P03"));
  if (retryable) {
    logger.warn("tasks.mutation.retryable", { reason: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "unknown" });
    throw new AccessError("TEMPORARILY_UNAVAILABLE", "This task is busy with another change. Nothing was saved; try again.", {
      code: TASK_ERROR.RETRYABLE,
    });
  }
  throw error;
}

/* -------------------------------------------------------------------------- */
/* Inside the transaction                                                      */
/* -------------------------------------------------------------------------- */

const LOCKED_SELECT = {
  id: true,
  companyId: true,
  version: true,
  title: true,
  description: true,
  projectId: true,
  assigneeMemberId: true,
  createdByMemberId: true,
  status: true,
  preArchiveStatus: true,
  priority: true,
  startDate: true,
  dueDate: true,
  completedAt: true,
  blockedAt: true,
  blockedReason: true,
  blockedByMemberId: true,
  archivedAt: true,
  archivedBy: true,
  entityType: true,
  entityId: true,
  updatedAt: true,
} satisfies Prisma.TaskSelect;

type LockedTask = Prisma.TaskGetPayload<{ select: typeof LOCKED_SELECT }>;
type Tx = Prisma.TransactionClient;

async function apply(
  tx: Tx,
  context: UserContext,
  taskId: string,
  expectedVersion: number,
  command: TaskCommand,
  candidates: ReadonlyMap<string, UserContext>,
  now: () => Date,
): Promise<TaskMutationResult> {
  // A command waiting behind another on the same task gives up after a few
  // seconds and says "try again", rather than holding a connection.
  await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;

  // 1. The actor, as of now. A revocation committed after the session was
  //    read is honoured here, and one arriving later waits for this commit.
  const actor = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT "status" FROM "company_members" WHERE "id" = ${context.membershipId} AND "companyId" = ${context.companyId} FOR SHARE`;
  if (actor[0]?.status !== "ACTIVE") throw new AccessError("MEMBERSHIP_INACTIVE");

  // 2. The task row, locked; then the task through the actor's scope, read on
  //    the locked row. Out of scope is "not found", before any version talk.
  const lockedRow = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "tasks" WHERE "id" = ${taskId} AND "companyId" = ${context.companyId} FOR UPDATE`;
  if (lockedRow.length === 0) throw new AccessError("NOT_FOUND");
  const locked = await tx.task.findFirst({
    where: { AND: [buildTaskScopeWhere(context), { id: taskId }] },
    select: LOCKED_SELECT,
  });
  if (!locked) throw new AccessError("NOT_FOUND");

  // 2b. A claim loses to an earlier claim whatever version it names: the
  //     person is told who won, not that the task "changed" (MOB-06 §23).
  if (command.kind === "claim" && locked.assigneeMemberId && locked.assigneeMemberId !== context.membershipId) {
    throw stateConflict(CLAIMED_BY_ANOTHER, { reason: "CLAIMED" });
  }

  // 3. The version the person reviewed. Nothing of the current task is
  //    disclosed here: the client asks for a fresh snapshot, through scope.
  if (locked.version !== expectedVersion) {
    throw new AccessError("CONFLICT", "This task changed since you opened it. Your change has not been saved.", {
      code: TASK_ERROR.VERSION_CONFLICT,
    });
  }
  if (locked.version >= TASK_VERSION_MAX) {
    throw new AccessError("CONFLICT", "This task cannot take more changes.", { code: TASK_ERROR.STATE_CONFLICT, reason: "VERSION_EXHAUSTED" });
  }

  const plan =
    command.kind === "edit"
      ? await planEdit(tx, context, locked, command.fields, now)
      : command.kind === "claim"
        ? planClaim(context, locked)
        : planCommand(context, locked, command, now);

  if (!plan) {
    // Genuinely unchanged, at the current version: no write, no history, no
    // notification — and no new version (AUD-02 §3).
    return {
      meta: { taskId, changed: false, version: locked.version, updatedAt: locked.updatedAt.toISOString() },
      effects: { projectIds: [], meetingIds: [], parentHref: null },
    };
  }

  // 4. The guarded write: the version and state the decision was based on.
  const written = await tx.task.updateMany({
    where: { id: taskId, companyId: context.companyId, version: expectedVersion, status: locked.status },
    data: { ...plan.data, updatedBy: context.userId, version: { increment: 1 } },
  });
  if (written.count !== 1) {
    // Unreachable while the row lock holds; kept so a change to the locking
    // above fails closed rather than writing blind.
    throw new AccessError("CONFLICT", "This task changed since you opened it. Your change has not been saved.", {
      code: TASK_ERROR.VERSION_CONFLICT,
    });
  }
  const committed = await tx.task.findFirstOrThrow({ where: { id: taskId, companyId: context.companyId }, select: { version: true, updatedAt: true } });

  // 5. Everything that describes the change, with the locked "before" and the
  //    written "after", in the same transaction.
  const after = { ...locked, ...plan.after };
  const version = { from: locked.version, to: committed.version };
  await plan.record(tx, { before: locked, after, version });

  const meetingIds: string[] = [];
  if (plan.syncMeeting) {
    const synced = await syncActionFromTask(tx, {
      actor: context,
      taskId,
      status: after.status,
      ...(after.assigneeMemberId !== locked.assigneeMemberId ? { assigneeMemberId: after.assigneeMemberId } : {}),
      // The due date is the task's too; the action follows it (AUD-10 §5, CW-11).
      ...(!sameValue(after.dueDate, locked.dueDate) ? { dueDate: after.dueDate } : {}),
    });
    if (synced) meetingIds.push(synced.meetingId);
  }

  if (after.status === "COMPLETED" && locked.status !== "COMPLETED") {
    // Finished work is not overdue work (PRD #38 §85).
    await resolveAttentionForRecord(tx, context.companyId, RECORD, taskId, ["OVERDUE_TASK"]);
  }

  if (after.assigneeMemberId && after.assigneeMemberId !== locked.assigneeMemberId) {
    const member = candidates.get(after.assigneeMemberId);
    if (member) {
      await subscribeStakeholdersIn(tx, {
        companyId: context.companyId,
        parentType: RECORD,
        parentId: taskId,
        members: new Map([[after.assigneeMemberId, member]]),
      });
    }
  }

  return {
    meta: { taskId, changed: true, version: committed.version, updatedAt: committed.updatedAt.toISOString() },
    effects: {
      projectIds: [...new Set([locked.projectId, after.projectId].filter((id): id is string => Boolean(id)))],
      meetingIds,
      parentHref: parentHref(locked),
    },
  };
}

type Plan = {
  data: Prisma.TaskUncheckedUpdateManyInput;
  after: Partial<LockedTask>;
  syncMeeting: boolean;
  record: (tx: Tx, change: { before: LockedTask; after: LockedTask; version: { from: number; to: number } }) => Promise<void>;
};

/* -------------------------------------------------------------------------- */
/* Dedicated commands                                                          */
/* -------------------------------------------------------------------------- */

export const CLAIMED_BY_ANOTHER = "This task was claimed by another user.";

/**
 * `claim`: an unassigned, active task becomes the actor's. Under the row lock a
 * second claimant finds it assigned and is refused (MOB-06 §22-§23). A task
 * the actor already holds is unchanged, not a second success.
 */
function planClaim(context: UserContext, locked: LockedTask): Plan | null {
  if (isTaskArchived(locked)) throw stateConflict("Restore this task before changing it.", { status: "ARCHIVED" });
  if (locked.status === "COMPLETED") throw stateConflict("This task is completed, so it cannot be claimed.", { status: locked.status });
  if (locked.assigneeMemberId === context.membershipId) return null;
  return {
    data: { assigneeMemberId: context.membershipId },
    after: { assigneeMemberId: context.membershipId },
    syncMeeting: true,
    record: async (tx, change) => {
      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: change.before.id,
        action: "TASK_CLAIMED",
        message: "claimed the task",
        metadata: { taskId: change.before.id, version: change.version } as Prisma.InputJsonValue,
      });
    },
  };
}

const COMMAND_ACTIVITY: Record<Exclude<TaskCommandKind, "edit" | "claim">, { action: string; message: string }> = {
  start: { action: "TASK_STARTED", message: "started the task" },
  block: { action: "TASK_BLOCKED", message: "marked the task blocked" },
  complete: { action: "TASK_COMPLETED", message: "completed the task" },
  reopen: { action: "TASK_REOPENED", message: "reopened the task" },
  archive: { action: "TASK_ARCHIVED", message: "archived the task" },
  restore: { action: "TASK_RESTORED", message: "restored the task" },
};

/** Leaving BLOCKED clears why it was blocked; the activity trail keeps the history. */
const UNBLOCKED = { blockedAt: null, blockedReason: null, blockedByMemberId: null } as const;

function stateConflict(message: string, details: Record<string, unknown> = {}): AccessError {
  return new AccessError("CONFLICT", message, { code: TASK_ERROR.STATE_CONFLICT, ...details });
}

function planCommand(context: UserContext, locked: LockedTask, command: Exclude<TaskCommand, { kind: "edit" | "claim" }>, now: () => Date): Plan {
  const archived = isTaskArchived(locked);
  const transition = transitionFor(taskMachine, command.kind as TaskAction)!;

  if (command.kind === "restore") {
    if (!archived) throw stateConflict("This task is not archived.", { status: locked.status });
    // A task archived before the status was remembered comes back as To Do
    // (PRD #11 §73). A remembered status that is not an active one is a
    // corrupted row, refused rather than restored into ARCHIVED.
    const target = locked.preArchiveStatus ?? "TODO";
    if (!targetsOf(transition).includes(target)) {
      throw stateConflict("This task cannot be restored: the status it was archived from is not valid.", { reason: "INVALID_PRE_ARCHIVE_STATUS" });
    }
    return {
      data: { status: target, preArchiveStatus: null, archivedAt: null, archivedBy: null },
      after: { status: target, preArchiveStatus: null, archivedAt: null, archivedBy: null },
      syncMeeting: true,
      record: (tx, change) => recordCommand(tx, context, command, change, { restoredFrom: locked.preArchiveStatus === null ? "LEGACY_TODO" : target }),
    };
  }

  if (archived) throw stateConflict("Restore this task before changing it.", { status: "ARCHIVED" });
  // Repeating a command on a task already there is a conflict, not a second
  // success: it says the action applies to nothing (PRD #11 §69).
  if (!transition.from.includes(locked.status)) {
    throw stateConflict(`This task is ${humanStatus(locked.status)}, so it cannot be ${PAST[command.kind]}.`, { status: locked.status });
  }

  if (command.kind === "archive") {
    // The status it had under the lock, and every field needed to put it back
    // exactly — completion time and blocked reason included (AUD-02 §5).
    const archivedAt = now();
    return {
      data: { preArchiveStatus: locked.status, status: "ARCHIVED", archivedAt, archivedBy: context.userId },
      after: { preArchiveStatus: locked.status, status: "ARCHIVED", archivedAt, archivedBy: context.userId },
      syncMeeting: false,
      record: (tx, change) => recordCommand(tx, context, command, change, { preArchiveStatus: locked.status }),
    };
  }

  const next: TaskStatus = command.kind === "reopen" ? command.target : (targetsOf(transition)[0] as TaskStatus);
  const at = now();
  const fields =
    command.kind === "block"
      ? { status: next, completedAt: null, blockedAt: at, blockedReason: command.reason, blockedByMemberId: context.membershipId }
      : { status: next, completedAt: next === "COMPLETED" ? at : null, ...UNBLOCKED };

  return {
    data: fields,
    after: fields,
    syncMeeting: true,
    record: async (tx, change) => {
      await recordCommand(tx, context, command, change);
      await enqueueStatusEvent(tx, context, change.after, command.kind === "block" ? command.reason : undefined);
    },
  };
}

const PAST: Record<Exclude<TaskCommandKind, "edit" | "claim">, string> = {
  start: "started",
  block: "marked blocked",
  complete: "completed",
  reopen: "reopened",
  archive: "archived",
  restore: "restored",
};

function humanStatus(status: TaskStatus): string {
  return status.toLowerCase().replace(/_/g, " ");
}

async function recordCommand(
  tx: Tx,
  context: UserContext,
  command: Exclude<TaskCommand, { kind: "edit" | "claim" }>,
  change: { before: LockedTask; after: LockedTask; version: { from: number; to: number } },
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { action, message } = COMMAND_ACTIVITY[command.kind];
  await recordActivity(tx, context, {
    module: MODULE,
    entityType: ENTITY,
    entityId: change.before.id,
    action,
    message: command.kind === "block" ? `${message}: ${command.reason.slice(0, 200)}` : message,
    metadata: {
      taskId: change.before.id,
      version: change.version,
      ...extra,
      ...(changeMetadata({ status: { from: change.before.status, to: change.after.status } }) as object),
    } as Prisma.InputJsonValue,
  });
}

/* -------------------------------------------------------------------------- */
/* Edit                                                                        */
/* -------------------------------------------------------------------------- */

async function planEdit(tx: Tx, context: UserContext, locked: LockedTask, fields: TaskEditFields, now: () => Date): Promise<Plan | null> {
  // An archived task is read-only: it must be restored first (PRD #11 §72).
  if (isTaskArchived(locked)) throw stateConflict("Restore this task before editing it.", { status: "ARCHIVED" });

  // A field the request did not name keeps what is saved (AUD-09 §4, FV-05).
  const nextStatus = (fields.status ?? locked.status) as TaskStatus;
  if (!canTransitionTaskStatus(locked.status, nextStatus)) {
    throw new AccessError("VALIDATION_ERROR", `A task cannot move from ${locked.status} to ${nextStatus}.`, {
      status: [`A task cannot move from ${humanStatus(locked.status)} to ${humanStatus(nextStatus)}.`],
    });
  }
  // Blocked is reached through the block command, which records why (PRD #38 §44).
  if (nextStatus === "BLOCKED" && locked.status !== "BLOCKED") {
    throw new AccessError("VALIDATION_ERROR", "Use Mark blocked, which records why the task cannot move.", {
      status: ["Use Mark blocked, which records why the task cannot move."],
    });
  }
  if (locked.status !== nextStatus) assertPermission(context, "task.status.update");
  // Completion and reopening through the form still need the permissions that
  // own them (PRD #11 §61, §68).
  if (nextStatus === "COMPLETED" && locked.status !== "COMPLETED") assertPermission(context, "task.complete");
  if (locked.status === "COMPLETED" && nextStatus !== "COMPLETED") assertPermission(context, "task.reopen");

  const requestedProject = fields.projectId === undefined ? locked.projectId : fields.projectId;
  const projectId = await validateProjectIn(tx, context, requestedProject ?? undefined);
  const projectChanged = projectId !== locked.projectId;
  // A task raised from another record belongs where that record is; moving it
  // would detach the work from its source's project (PRD #47 §51).
  if (projectChanged && locked.entityType && locked.entityId) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "This task belongs to the project of the record it was raised from.",
      { projectId: ["This task belongs to the project of the record it was raised from."] },
      "CROSS_PROJECT_REFERENCE",
    );
  }
  const requestedAssignee = fields.assigneeMemberId === undefined ? locked.assigneeMemberId : fields.assigneeMemberId;
  const assigneeMemberId = await resolveAssigneeIn(tx, context, requestedAssignee ?? undefined, projectId, locked.assigneeMemberId, { projectChanged });

  const statusChanged = nextStatus !== locked.status;
  const at = now();
  const startDate = fields.startDate === undefined ? locked.startDate : keepSameDay(fields.startDate, locked.startDate);
  const dueDate = fields.dueDate === undefined ? locked.dueDate : keepSameDay(fields.dueDate, locked.dueDate);
  // The schedule rule holds across the saved and the sent values: a request
  // that moves only the due date is checked against the saved start (PRD #11
  // §50, AUD-09 §4). A saved pair nobody is touching is not re-judged.
  if ((fields.startDate !== undefined || fields.dueDate !== undefined) && startDate && dueDate && dayOf(dueDate) < dayOf(startDate)) {
    throw new AccessError("VALIDATION_ERROR", "Due date must be on or after the start date.", {
      dueDate: ["Due date must be on or after the start date."],
    });
  }
  const next = {
    title: fields.title ?? locked.title,
    description: fields.description === undefined ? locked.description : fields.description,
    projectId,
    assigneeMemberId,
    status: nextStatus,
    priority: (fields.priority ?? locked.priority) as TaskPriority,
    // A date the form can only express as a day keeps its stored time while
    // the day is unchanged, so saving a form nobody touched changes nothing.
    startDate,
    dueDate,
    // Owned by the server and follows the status; an edit that keeps a task
    // completed keeps its original completion time (PRD #11 §68, AUD-02 §5).
    completedAt: nextStatus === "COMPLETED" ? (locked.status === "COMPLETED" ? locked.completedAt : at) : null,
    ...(locked.status === "BLOCKED" && nextStatus !== "BLOCKED" ? UNBLOCKED : {}),
  };

  const changedFields = (Object.keys(next) as (keyof typeof next)[]).filter((key) => !sameValue(next[key], locked[key]));
  if (changedFields.length === 0) return null;

  const assigneeChanged = assigneeMemberId !== locked.assigneeMemberId;
  const dueChanged = !sameValue(next.dueDate, locked.dueDate);
  return {
    data: next,
    after: next,
    syncMeeting: statusChanged || assigneeChanged || dueChanged,
    record: async (tx, change) => {
      const { before, after, version } = change;
      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: before.id,
        action: "TASK_UPDATED",
        message: "updated the task",
        // Which fields, never their content: a description is the person's own text.
        metadata: { taskId: before.id, version, fields: changedFields } as Prisma.InputJsonValue,
      });

      if (statusChanged) {
        await recordActivity(tx, context, {
          module: MODULE,
          entityType: ENTITY,
          entityId: before.id,
          action: "TASK_STATUS_CHANGED",
          message: `changed the status from ${before.status} to ${after.status}`,
          metadata: {
            taskId: before.id,
            version,
            ...(changeMetadata({ status: { from: before.status, to: after.status } }) as object),
          } as Prisma.InputJsonValue,
        });
        await enqueueStatusEvent(tx, context, after);
      }

      if (assigneeChanged) {
        await recordActivity(tx, context, {
          module: MODULE,
          entityType: ENTITY,
          entityId: before.id,
          action: after.assigneeMemberId ? "TASK_ASSIGNED" : "TASK_UNASSIGNED",
          message: after.assigneeMemberId ? "reassigned the task" : "removed the assignee",
          metadata: {
            taskId: before.id,
            version,
            ...(changeMetadata({ assigneeMemberId: { from: before.assigneeMemberId, to: after.assigneeMemberId } }) as object),
          } as Prisma.InputJsonValue,
        });
        // Only on gaining an assignee. Being unassigned is not news somebody
        // needs a notification about.
        if (after.assigneeMemberId) await enqueueAssignment(tx, context, after, version.to);
      }

      if (projectChanged) {
        await recordActivity(tx, context, {
          module: MODULE,
          entityType: ENTITY,
          entityId: before.id,
          action: "TASK_PROJECT_CHANGED",
          message: "moved the task to another project",
          metadata: {
            taskId: before.id,
            version,
            ...(changeMetadata({ projectId: { from: before.projectId, to: after.projectId } }) as object),
          } as Prisma.InputJsonValue,
        });
      }
    },
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
  }
  return (a ?? null) === (b ?? null);
}

/** The UTC calendar day of a stored task date: the day the form shows. */
function dayOf(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** A day-only input (midnight UTC) on the stored date's own day is the stored date. */
function keepSameDay(input: Date | null, stored: Date | null): Date | null {
  if (!input || !stored) return input;
  const dayOnly = input.getUTCHours() === 0 && input.getUTCMinutes() === 0 && input.getUTCSeconds() === 0 && input.getUTCMilliseconds() === 0;
  if (dayOnly && input.toISOString().slice(0, 10) === stored.toISOString().slice(0, 10)) return stored;
  return input;
}

/**
 * A project reference is only accepted when the caller can reach that project,
 * as the transaction sees it, and while it is live (PRD #11 §46, §90, §173).
 * The row is share-locked, so it cannot be archived or have its team changed
 * underneath the write.
 */
async function validateProjectIn(tx: Tx, context: UserContext, projectId: string | undefined): Promise<string | null> {
  if (!projectId) return null;

  const rows = await tx.$queryRaw<Array<{ id: string; status: string; archivedAt: Date | null }>>`
    SELECT "id", "status"::text AS "status", "archivedAt" FROM "projects" WHERE "id" = ${projectId} AND "companyId" = ${context.companyId} FOR SHARE`;
  const project = rows[0];
  if (!project) throw new AccessError("VALIDATION_ERROR", "That project does not exist.", { projectId: ["That project does not exist."] });

  const reachable = await tx.project.findFirst({ where: { ...buildProjectScopeWhere(context), id: projectId }, select: { id: true } });
  if (!reachable) throw new AccessError("VALIDATION_ERROR", "That project does not exist.", { projectId: ["That project does not exist."] });

  // New work on an archived project would be unreachable from the project itself (PRD #11 §173).
  if (project.archivedAt !== null || project.status === "ARCHIVED") {
    throw new AccessError("VALIDATION_ERROR", "That project is archived.", { projectId: ["That project is archived."] });
  }
  return project.id;
}

/**
 * The assignee, with the "assign only yourself" rule (PRD #11 §51, §122) and
 * the project team rule (§48), decided on share-locked rows.
 *
 * An unchanged assignee is waved through while the project stays put — an
 * existing inactive assignee may stay (PRD #11 §174) — but a task moved to
 * another project is re-checked against that project's team (PRD #47 §51).
 */
async function resolveAssigneeIn(
  tx: Tx,
  context: UserContext,
  requested: string | undefined,
  projectId: string | null,
  current: string | null,
  options: { projectChanged: boolean },
): Promise<string | null> {
  const next = requested ?? null;
  const changed = next !== current;
  if (!changed && !options.projectChanged) return next;

  if (changed && next !== null && next !== context.membershipId) assertPermission(context, "task.assign");
  // Clearing somebody else's assignment is also a reassignment.
  if (next === null && current !== null && current !== context.membershipId) assertPermission(context, "task.assign");
  if (next === null) return null;

  const members = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT "id", "status"::text AS "status" FROM "company_members" WHERE "id" = ${next} AND "companyId" = ${context.companyId} FOR SHARE`;
  const member = members[0];
  if (!member) throw new AccessError("VALIDATION_ERROR", "That team member does not exist.", { assigneeMemberId: ["That team member does not exist."] });
  if (member.status !== "ACTIVE") {
    throw new AccessError("VALIDATION_ERROR", "That team member is not active.", { assigneeMemberId: ["That team member is not active."] });
  }

  // Project work goes to the project team (PRD #11 §48, §97).
  if (projectId) {
    const onTeam = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "project_members" WHERE "projectId" = ${projectId} AND "companyMemberId" = ${next} AND "status" = 'ACTIVE' FOR SHARE`;
    const manager = await tx.project.count({ where: { id: projectId, companyId: context.companyId, projectManagerMemberId: next } });
    if (onTeam.length === 0 && manager === 0) {
      throw new AccessError("VALIDATION_ERROR", "Add this person to the project before assigning them project work.", {
        assigneeMemberId: ["Add this person to the project before assigning them project work."],
      });
    }
  }
  return member.id;
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

/**
 * The notification a status change produces (PRD #38 §50), from the committed
 * task: blocked and completed are their own events, anything else is a status
 * update. The actor is dropped by the dispatcher.
 */
async function enqueueStatusEvent(tx: Tx, context: UserContext, task: LockedTask, reason?: string): Promise<void> {
  const eventType =
    task.status === "BLOCKED"
      ? NotificationEvent.TASK_BLOCKED
      : task.status === "COMPLETED"
        ? NotificationEvent.TASK_COMPLETED
        : NotificationEvent.TASK_STATUS_CHANGED;

  const projectManagerMemberId = task.projectId
    ? ((await tx.project.findFirst({ where: { id: task.projectId, companyId: context.companyId }, select: { projectManagerMemberId: true } }))?.projectManagerMemberId ?? null)
    : null;

  await enqueueNotificationEvent(tx, {
    companyId: context.companyId,
    eventType,
    moduleKey: MODULE,
    entityType: RECORD,
    entityId: task.id,
    actorMemberId: context.membershipId,
    projectId: task.projectId,
    payload: {
      title: task.title,
      statusLabel: STATUS_LABELS[task.status],
      creatorMemberId: task.createdByMemberId,
      assigneeMemberId: task.assigneeMemberId,
      projectManagerMemberId,
      actorName: context.fullName,
      reason: reason ?? null,
    },
  });
}

/**
 * Being given work is the one thing somebody should not have to go looking
 * for (PRD #25 §30). The dedupe identity is the version that made the
 * assignment, so a redelivered event is one notification and a later
 * reassignment of the same person is a new one (AUD-02 §8).
 */
export async function enqueueAssignment(
  tx: Tx,
  context: UserContext,
  task: { id: string; title: string; projectId: string | null; assigneeMemberId: string | null },
  version: number,
): Promise<void> {
  if (!task.assigneeMemberId) return;
  await enqueueNotificationEvent(tx, {
    companyId: context.companyId,
    eventType: NotificationEvent.TASK_ASSIGNED,
    moduleKey: MODULE,
    entityType: RECORD,
    entityId: task.id,
    actorMemberId: context.membershipId,
    projectId: task.projectId,
    payload: { assigneeMemberId: task.assigneeMemberId, title: task.title, assignmentVersion: `v${version}` },
  });
}

/* -------------------------------------------------------------------------- */
/* Reads the transports need                                                   */
/* -------------------------------------------------------------------------- */

async function taskInScope(context: UserContext, taskId: string): Promise<boolean> {
  const found = await prisma.task.findFirst({ where: { AND: [buildTaskScopeWhere(context), { id: taskId }] }, select: { id: true } });
  return Boolean(found);
}

/** The page of the record a task was raised from, when that record has one of its own. */
function parentHref(task: Pick<LockedTask, "entityType" | "entityId">): string | null {
  if (!task.entityType || !task.entityId) return null;
  const route = recordDefinition(task.entityType)?.route;
  return route ? `${route}/${task.entityId}` : null;
}
