import { Prisma, type TaskPriority, type TaskStatus } from "@prisma/client";

import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { can } from "@/lib/access/can";
import { assertSameProject } from "@/lib/access/references";
import { canAccessProject } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { subscribeStakeholders } from "@/lib/core/collaboration/collaboration.service";
import { loadRecord, recordDefinition } from "@/lib/core/records/record.registry";
import { syncActionFromTask } from "@/lib/modules/meetings/meeting.task-sync";
import type { Permission } from "@/config/permissions";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import * as repository from "./task.repository";
import type { CreateTaskInput, TaskListQuery, UpdateTaskInput } from "./task.schema";
import {
  canTransitionTaskStatus,
  isTaskArchived,
  isTaskOverdue,
  REOPEN_STATUSES,
} from "./task.status";
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
 * `companyId`, `createdByMemberId`, `completedAt` and the archive fields come
 * from the server (PRD #11 §98, §116, §117).
 */

const MODULE = "tasks" as const;
const ENTITY = "Task";
/** The record registry type: what notifications, comments and documents call a task. */
const RECORD = "task";

const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

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
 * that parent, the assignee. What the caller gets back is an id, not a DTO —
 * reading the task back is for after the commit, and so is
 * `subscribeStakeholders`, which writes outside this transaction.
 */
export async function createTaskFromContextIn(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: CreateTaskInput & { parentType: string; parentId: string },
): Promise<{ id: string; assigneeMemberId: string | null }> {
  const { parentType, parentId, ...task } = input;
  const prepared = await prepareTask(context, task, parentContextOf(parentType, parentId));
  const created = await writeTask(tx, context, task, prepared).catch(translateWriteError);
  return { id: created.id, assigneeMemberId: prepared.assigneeMemberId };
}

type PreparedTask = {
  trustedParent: Awaited<ReturnType<typeof resolveTaskParent>>;
  projectId: string | null;
  assigneeMemberId: string | null;
  status: TaskStatus;
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

  return { trustedParent, projectId, assigneeMemberId, status };
}

/** The task row, its activity and the assignee's notification — one transaction's worth. */
async function writeTask(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: CreateTaskInput,
  prepared: PreparedTask,
): Promise<{ id: string }> {
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
    select: { id: true },
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

    // Being given work is the one thing somebody should not have to go
    // looking for (PRD #25 §30).
    await enqueueNotificationEvent(tx, {
      companyId: context.companyId,
      eventType: NotificationEvent.TASK_ASSIGNED,
      moduleKey: "tasks",
      entityType: RECORD,
      entityId: task.id,
      actorMemberId: context.membershipId,
      projectId,
      payload: { assigneeMemberId, title: input.title, assignmentVersion: new Date().toISOString() },
    });
  }

  return task;
}

export async function createTask(
  context: UserContext,
  input: CreateTaskInput,
  parent?: TaskParentContext,
): Promise<TaskDetailDTO> {
  const prepared = await prepareTask(context, input, parent);

  const created = await prisma
    .$transaction((tx) => writeTask(tx, context, input, prepared))
    .catch(translateWriteError);

  // The one accountable assignee and the creator watch the task's discussion
  // from the start (PRD #38 §33, §42).
  await subscribeStakeholders({
    companyId: context.companyId,
    parentType: RECORD,
    parentId: created.id,
    memberIds: [context.membershipId, ...(prepared.assigneeMemberId ? [prepared.assigneeMemberId] : [])],
  });

  return getTask(context, created.id);
}

export async function updateTask(
  context: UserContext,
  taskId: string,
  input: UpdateTaskInput,
): Promise<TaskDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "task.update");

  const existing = assertFound(await repository.findTaskInScope(context, taskId));

  // An archived task is read-only: it must be restored first (PRD #11 §72).
  if (isTaskArchived(existing)) {
    throw new AccessError("CONFLICT", "Restore this task before editing it.");
  }

  if (input.versionUpdatedAt && existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "This task was updated by another user. Refresh and review the latest changes.",
    );
  }

  const nextStatus = input.status as TaskStatus;
  if (!canTransitionTaskStatus(existing.status, nextStatus)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `A task cannot move from ${existing.status} to ${nextStatus}.`,
    );
  }
  if (existing.status !== nextStatus) assertPermission(context, "task.status.update");
  if (nextStatus === "BLOCKED" && existing.status !== "BLOCKED") {
    throw new AccessError("VALIDATION_ERROR", "Use Mark blocked, which records why the task cannot move.");
  }

  const projectId = await validateProject(context, input.projectId);
  const projectChanged = projectId !== existing.projectId;
  // A task raised from another record belongs where that record is; moving it
  // would detach the work from its source's project (PRD #47 §51).
  if (projectChanged && existing.entityType && existing.entityId) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "This task belongs to the project of the record it was raised from.",
      { projectId: ["This task belongs to the project of the record it was raised from."] },
      "CROSS_PROJECT_REFERENCE",
    );
  }

  const assigneeMemberId = await resolveAssignee(
    context,
    input.assigneeMemberId,
    projectId,
    existing.assigneeMemberId,
    { projectChanged },
  );
  const assigneeChanged = assigneeMemberId !== existing.assigneeMemberId;

  // Completion is a dedicated action; reaching COMPLETED through the edit form
  // still needs the permission that owns it (PRD #11 §61, §68).
  if (nextStatus === "COMPLETED" && existing.status !== "COMPLETED") {
    assertPermission(context, "task.complete");
  }
  if (existing.status === "COMPLETED" && nextStatus !== "COMPLETED") {
    assertPermission(context, "task.reopen");
  }

  await prisma
    .$transaction(async (tx) => {
      await tx.task.update({
        where: { id: taskId },
        data: {
          projectId,
          title: input.title,
          description: input.description ?? null,
          assigneeMemberId,
          status: nextStatus,
          priority: input.priority as TaskPriority,
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          completedAt: completionStamp(existing.status, nextStatus, existing.completedAt),
          ...(existing.status === "BLOCKED" && nextStatus !== "BLOCKED" ? UNBLOCKED : {}),
          updatedBy: context.userId,
        },
      });

      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: taskId,
        action: "TASK_UPDATED",
        message: "updated the task",
        metadata: { taskId } as Prisma.InputJsonValue,
      });

      if (existing.status !== nextStatus) {
        await recordActivity(tx, context, {
          module: MODULE,
          entityType: ENTITY,
          entityId: taskId,
          action: "TASK_STATUS_CHANGED",
          message: `changed the status from ${existing.status} to ${nextStatus}`,
          metadata: {
            taskId,
            ...(changeMetadata({ status: { from: existing.status, to: nextStatus } }) as object),
          } as Prisma.InputJsonValue,
        });

        await enqueueStatusEvent(tx, context, {
          taskId,
          title: input.title ?? existing.title,
          next: nextStatus,
          projectId,
          creatorMemberId: existing.createdByMemberId,
          assigneeMemberId,
        });
      }

      if (assigneeChanged) {
        await recordActivity(tx, context, {
          module: MODULE,
          entityType: ENTITY,
          entityId: taskId,
          action: assigneeMemberId ? "TASK_ASSIGNED" : "TASK_UNASSIGNED",
          message: assigneeMemberId ? "reassigned the task" : "removed the assignee",
          metadata: {
            taskId,
            ...(changeMetadata({
              assigneeMemberId: { from: existing.assigneeMemberId, to: assigneeMemberId },
            }) as object),
          } as Prisma.InputJsonValue,
        });

        // Only on gaining an assignee. Being unassigned is not news somebody
        // needs a notification about.
        if (assigneeMemberId) {
          await enqueueNotificationEvent(tx, {
            companyId: context.companyId,
            eventType: NotificationEvent.TASK_ASSIGNED,
            moduleKey: "tasks",
            entityType: RECORD,
            entityId: taskId,
            actorMemberId: context.membershipId,
            projectId,
            payload: {
              assigneeMemberId,
              title: input.title ?? existing.title,
              assignmentVersion: new Date().toISOString(),
            },
          });
        }
      }

      // A meeting action handed off to this task follows it (PRD #40 §59, §60).
      if (existing.status !== nextStatus || assigneeChanged) {
        await syncActionFromTask(tx, {
          companyId: context.companyId,
          taskId,
          status: nextStatus,
          actorMemberId: context.membershipId,
          ...(assigneeChanged ? { assigneeMemberId } : {}),
        });
      }

      if (projectChanged) {
        await recordActivity(tx, context, {
          module: MODULE,
          entityType: ENTITY,
          entityId: taskId,
          action: "TASK_PROJECT_CHANGED",
          message: "moved the task to another project",
          metadata: {
            taskId,
            ...(changeMetadata({ projectId: { from: existing.projectId, to: projectId } }) as object),
          } as Prisma.InputJsonValue,
        });
      }
    })
    .catch(translateWriteError);

  if (assigneeChanged && assigneeMemberId) {
    await subscribeStakeholders({ companyId: context.companyId, parentType: RECORD, parentId: taskId, memberIds: [assigneeMemberId] });
  }

  return getTask(context, taskId);
}

/** `TODO → IN_PROGRESS` (PRD #11 §66). */
export async function startTask(context: UserContext, taskId: string): Promise<TaskDetailDTO> {
  return transition(context, taskId, "IN_PROGRESS", {
    permission: "task.status.update",
    action: "TASK_STARTED",
    message: "started the task",
  });
}

/**
 * `TODO / IN_PROGRESS → BLOCKED` with the reason it cannot move
 * (PRD #11 §67, PRD #38 §44). A blocked task without a reason is a status
 * nobody can act on, so the reason is required.
 */
export async function blockTask(context: UserContext, taskId: string, reason: string): Promise<TaskDetailDTO> {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 3) throw new AccessError("VALIDATION_ERROR", "Say why the task is blocked.");
  if (trimmed.length > 1000) throw new AccessError("VALIDATION_ERROR", "Keep the reason under 1,000 characters.");

  return transition(context, taskId, "BLOCKED", {
    permission: "task.status.update",
    action: "TASK_BLOCKED",
    message: "marked the task blocked",
    blockedReason: trimmed,
  });
}

/** Completion sets the timestamp server-side (PRD #11 §68). */
export async function completeTask(context: UserContext, taskId: string): Promise<TaskDetailDTO> {
  return transition(context, taskId, "COMPLETED", {
    permission: "task.complete",
    action: "TASK_COMPLETED",
    message: "completed the task",
  });
}

/** Reopening clears the completion timestamp (PRD #11 §70). */
export async function reopenTask(
  context: UserContext,
  taskId: string,
  target: TaskStatus = "TODO",
): Promise<TaskDetailDTO> {
  if (!REOPEN_STATUSES.includes(target)) {
    throw new AccessError("VALIDATION_ERROR", "A task can only reopen as To Do or In Progress.");
  }
  return transition(context, taskId, target, {
    permission: "task.reopen",
    action: "TASK_REOPENED",
    message: "reopened the task",
    from: ["COMPLETED"],
  });
}

export async function archiveTask(context: UserContext, taskId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "task.archive");

  const existing = assertFound(await repository.findTaskInScope(context, taskId));
  if (isTaskArchived(existing)) {
    throw new AccessError("CONFLICT", "This task is already archived.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: taskId },
      data: {
        // Remembered so restore returns the task where it was, rather than
        // always resetting it to To Do (PRD #11 §71, §73).
        preArchiveStatus: existing.status,
        status: "ARCHIVED",
        archivedAt: new Date(),
        archivedBy: context.userId,
        updatedBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: taskId,
      action: "TASK_ARCHIVED",
      message: "archived the task",
      metadata: { taskId, preArchiveStatus: existing.status } as Prisma.InputJsonValue,
    });
  });
}

export async function restoreTask(context: UserContext, taskId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "task.restore");

  const existing = assertFound(await repository.findTaskInScope(context, taskId));
  if (!isTaskArchived(existing)) {
    throw new AccessError("CONFLICT", "This task is not archived.");
  }

  const restored = existing.preArchiveStatus ?? "TODO";

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: taskId },
      data: {
        status: restored,
        preArchiveStatus: null,
        archivedAt: null,
        archivedBy: null,
        updatedBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: taskId,
      action: "TASK_RESTORED",
      message: "restored the task",
      metadata: { taskId, status: restored } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

type TransitionOptions = {
  permission: Parameters<typeof assertPermission>[1];
  action: string;
  message: string;
  /** Restricts the statuses the action may be invoked from. */
  from?: TaskStatus[];
  /** Required when moving to BLOCKED. */
  blockedReason?: string;
};

/** Leaving BLOCKED clears why it was blocked; the activity trail keeps the history. */
const UNBLOCKED = { blockedAt: null, blockedReason: null, blockedByMemberId: null } as const;

/**
 * The notification a status change produces (PRD #38 §50): blocked and
 * completed are their own events, anything else is a status update. The actor
 * is dropped by the dispatcher.
 */
async function enqueueStatusEvent(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: {
    taskId: string;
    title: string;
    next: TaskStatus;
    projectId: string | null;
    creatorMemberId: string;
    assigneeMemberId: string | null;
    reason?: string;
  },
): Promise<void> {
  const eventType =
    input.next === "BLOCKED"
      ? NotificationEvent.TASK_BLOCKED
      : input.next === "COMPLETED"
        ? NotificationEvent.TASK_COMPLETED
        : NotificationEvent.TASK_STATUS_CHANGED;

  const projectManagerMemberId = input.projectId
    ? ((await tx.project.findUnique({ where: { id: input.projectId }, select: { projectManagerMemberId: true } }))
        ?.projectManagerMemberId ?? null)
    : null;

  await enqueueNotificationEvent(tx, {
    companyId: context.companyId,
    eventType,
    moduleKey: MODULE,
    entityType: RECORD,
    entityId: input.taskId,
    actorMemberId: context.membershipId,
    projectId: input.projectId,
    payload: {
      title: input.title,
      statusLabel: STATUS_LABELS[input.next],
      creatorMemberId: input.creatorMemberId,
      assigneeMemberId: input.assigneeMemberId,
      projectManagerMemberId,
      actorName: context.fullName,
      reason: input.reason ?? null,
    },
  });
}

/**
 * The shared body of every dedicated status action.
 *
 * Calling an action from a status it does not apply to is a conflict, not a
 * silent no-op — that is what exposes a logic error rather than hiding it
 * (PRD #11 §69, §209).
 */
async function transition(
  context: UserContext,
  taskId: string,
  next: TaskStatus,
  options: TransitionOptions,
): Promise<TaskDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, options.permission);

  const existing = assertFound(await repository.findTaskInScope(context, taskId));

  if (isTaskArchived(existing)) {
    throw new AccessError("CONFLICT", "Restore this task before changing its status.");
  }
  if (options.from && !options.from.includes(existing.status)) {
    throw new AccessError("CONFLICT", `This task is ${existing.status.toLowerCase()}.`);
  }
  if (existing.status === next) {
    throw new AccessError("CONFLICT", `This task is already ${next.toLowerCase()}.`);
  }
  if (!canTransitionTaskStatus(existing.status, next)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `A task cannot move from ${existing.status} to ${next}.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: taskId },
      data: {
        status: next,
        completedAt: completionStamp(existing.status, next, existing.completedAt),
        ...(next === "BLOCKED"
          ? { blockedAt: new Date(), blockedReason: options.blockedReason ?? null, blockedByMemberId: context.membershipId }
          : UNBLOCKED),
        updatedBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: taskId,
      action: options.action,
      message: options.blockedReason ? `${options.message}: ${options.blockedReason.slice(0, 200)}` : options.message,
      metadata: {
        taskId,
        ...(changeMetadata({ status: { from: existing.status, to: next } }) as object),
      } as Prisma.InputJsonValue,
    });

    await enqueueStatusEvent(tx, context, {
      taskId,
      title: existing.title,
      next,
      projectId: existing.projectId,
      creatorMemberId: existing.createdByMemberId,
      assigneeMemberId: existing.assigneeMemberId,
      reason: options.blockedReason,
    });

    await syncActionFromTask(tx, { companyId: context.companyId, taskId, status: next, actorMemberId: context.membershipId });

    // Finished work is not overdue work (PRD #38 §85).
    if (next === "COMPLETED") {
      await resolveAttentionForRecord(tx, context.companyId, RECORD, taskId, ["OVERDUE_TASK"]);
    }
  });

  return getTask(context, taskId);
}

/** `completedAt` is owned by the server and follows the status (PRD #11 §68, §70). */
function completionStamp(from: TaskStatus, to: TaskStatus, current: Date | null): Date | null {
  if (to === "COMPLETED") return from === "COMPLETED" ? current : new Date();
  return null;
}

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
    archivedAt: row.archivedAt?.toISOString() ?? null,
    capabilities: {
      canEdit: !archived && can(context, "task.update"),
      canAssign: !archived && can(context, "task.assign"),
      canChangeStatus: !archived && can(context, "task.status.update"),
      canComplete: !archived && row.status !== "COMPLETED" && can(context, "task.complete"),
      canReopen: !archived && row.status === "COMPLETED" && can(context, "task.reopen"),
      canArchive: !archived && can(context, "task.archive"),
      canRestore: archived && can(context, "task.restore"),
    },
  };
}
