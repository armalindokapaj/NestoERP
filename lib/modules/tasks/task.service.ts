import { Prisma, type TaskPriority, type TaskStatus } from "@prisma/client";

import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { can } from "@/lib/access/can";
import { assertSameProject } from "@/lib/access/references";
import { canAccessProject } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import { assertActorCurrent } from "@/lib/core/transactions/actor";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { recordActivity } from "@/lib/modules/shared/activity";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { subscribeStakeholdersIn } from "@/lib/core/collaboration/collaboration.service";
import { loadRecord, recordDefinition } from "@/lib/core/records/record.registry";
import type { Permission } from "@/config/permissions";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import * as repository from "./task.repository";
import type { CreateTaskInput, TaskListQuery, UpdateTaskInput } from "./task.schema";
import {
  enqueueAssignment,
  mutateTask,
  type TaskCommand,
  type TaskMutationEffects,
  type TaskMutationMeta,
  type TaskMutationResult,
} from "./task.mutation";
import { isTaskArchived, isTaskOverdue } from "./task.status";
import type {
  TaskActivityDTO,
  TaskDetailDTO,
  TaskOverviewStats,
  TaskSummaryDTO,
} from "./task.types";

/**
 * Tasks service (PRD #11 §102, §118).
 *
 * Every entry point runs the same sequence: module enabled → permission →
 * scope → validate related records belong to this company → mutate in a
 * transaction → record activity. Nothing here trusts a field from the browser:
 * `companyId`, `createdByMemberId`, `completedAt`, the archive fields and the
 * version come from the server (PRD #11 §98, §116, §117, AUD-02 §3).
 *
 * A change to an existing task is `mutateTask` (`task.mutation.ts`), whatever
 * starts it: it names the version its person reviewed and is refused against
 * any other (AUD-02 §4).
 */

const MODULE = "tasks" as const;
const ENTITY = "Task";
/** The record registry type: what notifications, comments and documents call a task. */
const RECORD = "task";

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listTasks(context: UserContext, query: TaskListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "task.view");

  const { rows, total } = await repository.listTasks(context, query);

  return {
    data: rows.map(toSummaryDTO),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getTask(context: UserContext, taskId: string): Promise<TaskDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "task.view");

  // Outside scope answers "not found", so the response cannot confirm that a
  // task the user may not see exists (PRD #11 §120).
  const task = assertFound(await repository.findTaskInScope(context, taskId));
  const detail = toDetailDTO(context, task);

  if (task.entityType && task.entityId) {
    const definition = recordDefinition(task.entityType);
    const record = definition ? await loadRecord(context, definition.type, task.entityId) : null;
    if (definition && record) {
      detail.parent = { type: definition.type, noun: definition.noun, label: record.label, href: record.href };
    }
  }
  return detail;
}

export async function getTaskOverview(context: UserContext): Promise<TaskOverviewStats> {
  assertModule(context, MODULE);
  assertPermission(context, "task.view");
  return repository.taskOverviewStats(context);
}

export async function listPriorityTasks(context: UserContext, limit = 5) {
  assertModule(context, MODULE);
  assertPermission(context, "task.view");
  const rows = await repository.priorityTasks(context, limit);
  return rows.map(toSummaryDTO);
}

export async function listActivity(
  context: UserContext,
  taskId: string,
  options: { page: number; limit: number },
) {
  assertModule(context, MODULE);
  assertPermission(context, "task.activity.view");
  await assertTaskInScope(context, taskId);

  const { rows, total } = await repository.listTaskActivity(context, taskId, options);

  const data: TaskActivityDTO[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    message: row.message,
    actor: row.actorMember
      ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}`
      : null,
    actorMemberId: row.actorMember ? row.actorMemberId : null,
    createdAt: row.createdAt.toISOString(),
  }));

  return { data, pagination: paginationMeta(total, options.page, options.limit) };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where a task came from, when another module raised it (PRD #11 §26,
 * PRD #18 §155).
 *
 * A server-side argument rather than a field on `createTaskSchema`: the context
 * says which record the work belongs to, and that is a statement the calling
 * service makes, never something a browser gets to assert about a task it is
 * filing.
 */
export type TaskParentContext = {
  moduleKey: string;
  entityType: string;
  entityId: string;
};

/**
 * The task grant each module requires on top of `task.create` before its
 * records can raise work (PRD #38 §45, §46).
 */
const PARENT_TASK_GRANT: Partial<Record<string, Permission>> = {
  meetings: "meeting.action.convert_to_task",
  sales: "sales.task.create",
  contracts: "legal.task.create",
  procurement: "procurement.task.create",
  inventory: "inventory.task.create",
  qaqc: "qaqc.task.create",
  hse: "hse.task.create",
};

/**
 * The trusted parent of a task raised from another module (PRD #38 §45-§47).
 *
 * The record is read through the record registry in the caller's own scope,
 * so a task can only be filed against a record the person could open, in
 * their company — never against an id somebody typed. The stored context is
 * the registry's type and module, not whatever the caller passed.
 */
async function resolveTaskParent(
  context: UserContext,
  parent: TaskParentContext | undefined,
): Promise<{ moduleKey: string; entityType: string; entityId: string; projectId: string | null } | null> {
  if (!parent) return null;
  const definition = recordDefinition(parent.entityType);
  if (!definition || definition.type === "task") {
    throw new AccessError("VALIDATION_ERROR", "A task cannot be raised from that record.");
  }
  const grant = PARENT_TASK_GRANT[definition.moduleKey];
  if (grant) assertPermission(context, grant);

  const record = await loadRecord(context, definition.type, parent.entityId);
  if (!record) throw new AccessError("VALIDATION_ERROR", "That record does not exist.");
  if (record.archived) throw new AccessError("CONFLICT", "That record is archived.");

  return { moduleKey: definition.moduleKey, entityType: definition.type, entityId: record.id, projectId: record.projectId };
}

/**
 * `TaskService.createFromContext` (PRD #38 §46): one trusted path for every
 * module that raises work from one of its records.
 */
export async function createTaskFromContext(
  context: UserContext,
  input: CreateTaskInput & { parentType: string; parentId: string },
): Promise<TaskDetailDTO> {
  const { parentType, parentId, ...task } = input;
  return createTask(context, task, parentContextOf(parentType, parentId));
}

function parentContextOf(parentType: string, parentId: string): TaskParentContext {
  const definition = recordDefinition(parentType);
  return { moduleKey: definition?.moduleKey ?? "", entityType: parentType, entityId: parentId };
}

/**
 * The same door, opened inside the caller's transaction (PRD #48 §24, §25, §145).
 *
 * A module that must create a task and record something of its own together
 * — a meeting action becoming a task — cannot use the version above: it
 * commits on its own, and a failure afterwards would leave a task nobody
 * asked for. Here the task is written with the caller's client, so one
 * rollback takes both (PRD #48 §22, §146).
 *
 * Tasks' rules still apply: the permission, the parent record, the project of
 * that parent, the assignee. What the caller gets back is an id and the
 * version the task starts at, not a DTO — reading the task back is for after
 * the commit. The creator and assignee are subscribed in the same
 * transaction (AUD-02 §8).
 */
export async function createTaskFromContextIn(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: CreateTaskInput & { parentType: string; parentId: string },
): Promise<{ id: string; assigneeMemberId: string | null; version: number }> {
  const { parentType, parentId, ...task } = input;
  const prepared = await prepareTask(context, task, parentContextOf(parentType, parentId));
  const created = await writeTask(tx, context, task, prepared).catch(translateWriteError);
  return { id: created.id, assigneeMemberId: prepared.assigneeMemberId, version: created.version };
}

type PreparedTask = {
  trustedParent: Awaited<ReturnType<typeof resolveTaskParent>>;
  projectId: string | null;
  assigneeMemberId: string | null;
  status: TaskStatus;
  /** The creator's and assignee's contexts, read before the transaction that subscribes them. */
  stakeholders: Map<string, UserContext>;
};

/**
 * Everything decided before the write: the parent record, its project, the
 * assignee. All reads, and none of it depends on the caller's transaction —
 * which is why a caller that owns one can still use it (PRD #48 §114).
 */
async function prepareTask(
  context: UserContext,
  input: CreateTaskInput,
  parent?: TaskParentContext,
): Promise<PreparedTask> {
  assertModule(context, MODULE);
  assertPermission(context, "task.create");

  const trustedParent = await resolveTaskParent(context, parent);
  const projectId = await validateProject(context, input.projectId);

  /*
   * Work raised from a project record lives on that record's project
   * (PRD #47 §51). Otherwise a hazard on Project A could file a task on
   * Project B — or on no project at all, outside every project gate — and the
   * task would carry A's context to people who were never given A. A parent
   * with no project of its own (an obligation, an opportunity) leaves the
   * task's project to the caller.
   */
  if (trustedParent) {
    assertSameProject("projectId", projectId, trustedParent.projectId, { allowUnlinked: true });
  }

  const assigneeMemberId = await resolveAssignee(context, input.assigneeMemberId, projectId, null);

  const status = input.status as TaskStatus;
  // Blocked is reached through the block action, which records why (PRD #38 §44).
  if (status === "BLOCKED") {
    throw new AccessError("VALIDATION_ERROR", "Create the task, then mark it blocked with a reason.");
  }

  const stakeholders = await buildMemberContexts(context.companyId, [context.membershipId, ...(assigneeMemberId ? [assigneeMemberId] : [])]);

  return { trustedParent, projectId, assigneeMemberId, status, stakeholders };
}

/**
 * The task row, its activity, the assignee's notification and the stakeholder
 * subscriptions — one transaction's worth. A new task starts at version 1.
 */
async function writeTask(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: CreateTaskInput,
  prepared: PreparedTask,
): Promise<{ id: string; version: number }> {
  const { trustedParent, projectId, assigneeMemberId, status } = prepared;

  const task = await tx.task.create({
    data: {
      companyId: context.companyId,
      projectId,
      title: input.title,
      description: input.description ?? null,
      assigneeMemberId,
      createdByMemberId: context.membershipId,
      status,
      priority: input.priority as TaskPriority,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      // Completing on create is allowed, but the timestamp is the server's
      // (PRD #11 §50, §117).
      completedAt: status === "COMPLETED" ? new Date() : null,
      createdBy: context.userId,
      module: trustedParent?.moduleKey ?? null,
      entityType: trustedParent?.entityType ?? null,
      entityId: trustedParent?.entityId ?? null,
    },
    select: { id: true, version: true },
  });

  await recordActivity(tx, context, {
    module: MODULE,
    entityType: ENTITY,
    entityId: task.id,
    action: "TASK_CREATED",
    message: "created the task",
    metadata: { taskId: task.id, projectId } as Prisma.InputJsonValue,
  });

  if (assigneeMemberId) {
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: task.id,
      action: "TASK_ASSIGNED",
      message: "assigned the task",
      metadata: { taskId: task.id, assigneeMemberId } as Prisma.InputJsonValue,
    });

    await enqueueAssignment(tx, context, { id: task.id, title: input.title, projectId, assigneeMemberId }, task.version);
  }

  // The one accountable assignee and the creator watch the task's discussion
  // from the start (PRD #38 §33, §42) — subscribed in this transaction, so a
  // task never exists without them (AUD-02 §8).
  await subscribeStakeholdersIn(tx, { companyId: context.companyId, parentType: RECORD, parentId: task.id, members: prepared.stakeholders });

  return task;
}

export async function createTask(
  context: UserContext,
  input: CreateTaskInput,
  parent?: TaskParentContext,
): Promise<TaskDetailDTO> {
  const prepared = await prepareTask(context, input, parent);

  // The actor is re-read first, under a share lock (AUD-06 §7, RP-16): a
  // suspension, deactivation, role change or sign-out that commits between the
  // decision above and this write refuses it, and one arriving later waits.
  const created = await prisma
    .$transaction(async (tx) => {
      await assertActorCurrent(tx, context);
      return writeTask(tx, context, input, prepared);
    })
    .catch(translateWriteError);

  return getTask(context, created.id);
}

/**
 * What a task command answers (AUD-02 §6): the task as the actor may now read
 * it, and the mutation's own metadata. When the change took the task out of
 * the actor's sight — they reassigned it away, or moved it to a project they
 * are not on — `data` is null and `redirectTo` names somewhere safe: the save
 * happened, and it is reported as having happened.
 *
 * `effects` is for the transport's cache invalidation, never for the client.
 */
export type TaskMutationResponse = {
  data: TaskDetailDTO | null;
  meta: TaskMutationMeta;
  redirectTo?: string;
  effects: TaskMutationEffects;
};

type VersionInput = { expectedVersion?: unknown };

export async function updateTask(context: UserContext, taskId: string, input: UpdateTaskInput): Promise<TaskMutationResponse> {
  const { expectedVersion, ...fields } = input;
  return command(context, taskId, expectedVersion, { kind: "edit", fields });
}

/** `TODO / BLOCKED → IN_PROGRESS` (PRD #11 §66). */
export async function startTask(context: UserContext, taskId: string, input: VersionInput): Promise<TaskMutationResponse> {
  return command(context, taskId, input.expectedVersion, { kind: "start" });
}

/** An unassigned task becomes the actor's; a second claimant is refused (MOB-06 §22-§23). */
export async function claimTask(context: UserContext, taskId: string, input: VersionInput): Promise<TaskMutationResponse> {
  return command(context, taskId, input.expectedVersion, { kind: "claim" });
}

/**
 * `TODO / IN_PROGRESS → BLOCKED` with the reason it cannot move
 * (PRD #11 §67, PRD #38 §44). A blocked task without a reason is a status
 * nobody can act on, so the reason is required.
 */
export async function blockTask(context: UserContext, taskId: string, input: VersionInput & { reason?: string }): Promise<TaskMutationResponse> {
  return command(context, taskId, input.expectedVersion, { kind: "block", reason: input.reason ?? "" });
}

/** Completion sets the timestamp server-side (PRD #11 §68). */
export async function completeTask(context: UserContext, taskId: string, input: VersionInput): Promise<TaskMutationResponse> {
  return command(context, taskId, input.expectedVersion, { kind: "complete" });
}

/** Reopening clears the completion timestamp (PRD #11 §70). */
export async function reopenTask(
  context: UserContext,
  taskId: string,
  input: VersionInput & { status?: TaskStatus },
): Promise<TaskMutationResponse> {
  return command(context, taskId, input.expectedVersion, { kind: "reopen", target: input.status ?? "TODO" });
}

/** Remembers the status it had, so restore puts it back (PRD #11 §71, §73). */
export async function archiveTask(context: UserContext, taskId: string, input: VersionInput): Promise<TaskMutationResponse> {
  return command(context, taskId, input.expectedVersion, { kind: "archive" });
}

export async function restoreTask(context: UserContext, taskId: string, input: VersionInput): Promise<TaskMutationResponse> {
  return command(context, taskId, input.expectedVersion, { kind: "restore" });
}

async function command(context: UserContext, taskId: string, expectedVersion: unknown, request: TaskCommand): Promise<TaskMutationResponse> {
  return respond(context, await mutateTask(context, taskId, expectedVersion, request));
}

/**
 * The committed change, shaped for the actor from an authorised read. Nothing
 * after the commit may turn it into a failure: a task the actor can no longer
 * read is a success with somewhere safe to go, and a read that fails for any
 * other reason is a success without the detail (AUD-02 §6, §8).
 */
async function respond(context: UserContext, result: TaskMutationResult): Promise<TaskMutationResponse> {
  try {
    return { data: await getTask(context, result.meta.taskId), meta: result.meta, effects: result.effects };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") {
      return { data: null, meta: result.meta, redirectTo: "/tasks", effects: result.effects };
    }
    logger.error("tasks.mutation.read_after_commit_failed", { taskId: result.meta.taskId, ...serialiseError(error) });
    return { data: null, meta: result.meta, effects: result.effects };
  }
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function assertTaskInScope(context: UserContext, taskId: string): Promise<void> {
  if (!(await repository.taskInScopeExists(context, taskId))) {
    throw new AccessError("NOT_FOUND");
  }
}

/**
 * A project reference is only accepted when the caller can reach that project.
 * A hand-edited query parameter must not create work on a project the user
 * cannot see (PRD #11 §46, §90).
 */
async function validateProject(
  context: UserContext,
  projectId: string | undefined,
): Promise<string | null> {
  if (!projectId) return null;

  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: context.companyId },
    select: { id: true, status: true, archivedAt: true },
  });
  if (!project) throw new AccessError("VALIDATION_ERROR", "That project does not exist.");

  if (!(await canAccessProject(context, projectId))) {
    throw new AccessError("VALIDATION_ERROR", "That project does not exist.");
  }

  // New work on an archived project would be unreachable from the project
  // itself (PRD #11 §173).
  if (project.archivedAt !== null || project.status === "ARCHIVED") {
    throw new AccessError("VALIDATION_ERROR", "That project is archived.");
  }

  return project.id;
}

/**
 * Resolves the assignee, applying the "assign only yourself" fallback.
 *
 * With `task.create` but not `task.assign`, a user may leave a task unassigned
 * or take it themselves — but not hand work to somebody else (PRD #11 §51,
 * §122).
 *
 * An unchanged assignee is only waved through while the project stays put. A
 * task moved to another project is re-checked against that project's team, or
 * the move would quietly put somebody on work — and in front of a project —
 * they were never added to (PRD #11 §48, PRD #47 §51).
 */
async function resolveAssignee(
  context: UserContext,
  assigneeMemberId: string | undefined,
  projectId: string | null,
  currentAssigneeId: string | null,
  options: { projectChanged?: boolean } = {},
): Promise<string | null> {
  const next = assigneeMemberId ?? null;
  const assigneeChanged = next !== currentAssigneeId;
  if (!assigneeChanged && !options.projectChanged) return next;

  if (assigneeChanged && next !== null && next !== context.membershipId) {
    assertPermission(context, "task.assign");
  }
  // Clearing somebody else's assignment is also a reassignment.
  if (next === null && currentAssigneeId !== null && currentAssigneeId !== context.membershipId) {
    assertPermission(context, "task.assign");
  }
  if (next === null) return null;

  const member = await prisma.companyMember.findFirst({
    where: { id: next, companyId: context.companyId },
    select: { id: true, status: true },
  });
  if (!member) throw new AccessError("VALIDATION_ERROR", "That team member does not exist.");
  if (member.status !== "ACTIVE") {
    throw new AccessError("VALIDATION_ERROR", "That team member is not active.");
  }

  // Project work goes to the project team, so an unrelated colleague is never
  // silently attached to a project they do not belong to (PRD #11 §48, §97).
  if (projectId) {
    const membership = await prisma.projectMember.findFirst({
      where: { projectId, companyMemberId: next, status: "ACTIVE" },
      select: { id: true },
    });
    const isManager = await prisma.project.findFirst({
      where: { id: projectId, projectManagerMemberId: next },
      select: { id: true },
    });
    if (!membership && !isManager) {
      throw new AccessError(
        "VALIDATION_ERROR",
        "Add this person to the project before assigning them project work.",
      );
    }
  }

  return member.id;
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
    throw new AccessError("VALIDATION_ERROR", "A related record could not be found.");
  }
  throw error;
}

/* -------------------------------------------------------------------------- */
/* DTO mapping                                                                 */
/* -------------------------------------------------------------------------- */

function person(
  row: { id: string; status: string; user: { firstName: string; lastName: string; avatarUrl: string | null } } | null,
) {
  if (!row) return null;
  return {
    memberId: row.id,
    fullName: `${row.user.firstName} ${row.user.lastName}`,
    avatarUrl: row.user.avatarUrl,
    membershipActive: row.status === "ACTIVE",
  };
}

export function toSummaryDTO(row: repository.TaskSummaryRow): TaskSummaryDTO {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    project: row.project,
    assignee: person(row.assignee),
    dueDate: row.dueDate?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    isOverdue: isTaskOverdue(row),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toDetailDTO(context: UserContext, row: repository.TaskDetailRow): TaskDetailDTO {
  const archived = isTaskArchived(row);
  const assignee = person(row.assignee);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    preArchiveStatus: row.preArchiveStatus,
    priority: row.priority,
    project: row.project,
    assignee: assignee && row.assignee ? { ...assignee, userId: row.assignee.user.id } : null,
    creator: row.creator
      ? {
          memberId: row.creator.id,
          fullName: `${row.creator.user.firstName} ${row.creator.user.lastName}`,
        }
      : null,
    schedule: {
      startDate: row.startDate?.toISOString() ?? null,
      dueDate: row.dueDate?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      isOverdue: isTaskOverdue(row),
    },
    context: { module: row.module, entityType: row.entityType, entityId: row.entityId },
    parent: null,
    blocked:
      row.status === "BLOCKED"
        ? { reason: row.blockedReason, since: row.blockedAt?.toISOString() ?? null, byMemberId: row.blockedByMemberId }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    capabilities: {
      canEdit: !archived && can(context, "task.update"),
      canAssign: !archived && can(context, "task.assign"),
      canChangeStatus: !archived && can(context, "task.status.update"),
      canClaim: !archived && row.status !== "COMPLETED" && row.assigneeMemberId === null && can(context, "task.status.update"),
      canComplete: !archived && row.status !== "COMPLETED" && can(context, "task.complete"),
      canReopen: !archived && row.status === "COMPLETED" && can(context, "task.reopen"),
      canArchive: !archived && can(context, "task.archive"),
      canRestore: archived && can(context, "task.restore"),
    },
  };
}
