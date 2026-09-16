import { runInTransaction } from "@/lib/core/transactions/transaction";
import type { MeetingActionItemStatus, Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere, buildTaskScopeWhere, canAccessProject } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { isLocalDate } from "@/lib/modules/calendar/calendar.time";
import { subscribeStakeholders } from "@/lib/core/collaboration/collaboration.service";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { createTaskFromContextIn } from "@/lib/modules/tasks/task.service";
import { notifyActionAssigned, notifyActionCompleted } from "./meeting.notifications";
import { canConvertToTask, canCreateAction, canManageActions, meetingsOpen, readableMeetingWhere } from "./meeting.permissions";
import {
  actionDTO,
  ENTITY,
  getMeeting,
  MODULE,
  RECORD,
  requireReadableMeeting,
  todayInZone,
  type MeetingDetailRow,
} from "./meeting.repository";
import type { ActionListQuery } from "./meeting.schema";
import { requireMembers } from "./meeting.service";
import type { MeetingDetailDTO, MyActionItemDTO } from "./meeting.types";

/**
 * Action items (PRD #40 §53-§62, §106, §107, §168, §213).
 *
 * A meeting-specific commitment, which may hand off to one canonical Task
 * through `createTaskFromContext` — the Task service's own path, with its own
 * permission, assignee and project checks (PRD #40 §56, §198, §233). Once an
 * action has a task, the task is the source of truth: finishing the task
 * finishes the action, and nothing here moves the task (PRD #40 §59).
 */

const OPEN: MeetingActionItemStatus[] = ["OPEN", "IN_PROGRESS"];

/** A business date, stored at midday UTC like every other due date. */
function dueAt(date: string | null | undefined): Date | null | undefined {
  if (date === undefined) return undefined;
  if (date === null) return null;
  if (!isLocalDate(date)) throw new AccessError("VALIDATION_ERROR", "Use a date in the form YYYY-MM-DD.", { dueDate: ["Use a date in the form YYYY-MM-DD."] });
  return new Date(`${date}T12:00:00.000Z`);
}

async function requireOwner(context: UserContext, ownerMemberId: string | null | undefined): Promise<string | null | undefined> {
  if (ownerMemberId === undefined) return undefined;
  if (!ownerMemberId) return null;
  // Same company and active, or the same refusal as for anybody else (PRD #40 §292).
  await requireMembers(context, [ownerMemberId], "ownerMemberId");
  return ownerMemberId;
}

function findAction(meeting: MeetingDetailRow, actionId: string) {
  const action = meeting.actionItems.find((row) => row.id === actionId);
  if (!action) throw new AccessError("NOT_FOUND");
  return action;
}

export async function createActionItem(
  context: UserContext,
  meetingId: string,
  input: { title: string; description: string | null; ownerMemberId?: string | null; dueDate?: string | null; createTask: boolean },
): Promise<MeetingDetailDTO> {
  const meeting = await requireReadableMeeting(context, meetingId);
  if (meeting.minutesStatus === "FINAL") throw new AccessError("CONFLICT", "These minutes are final. Reopen them to add an action.", { code: "MINUTES_FINAL" });
  if (!canCreateAction(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot add actions to this meeting.");
  if (input.createTask && !canConvertToTask(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot create tasks from this meeting.");
  const ownerMemberId = (await requireOwner(context, input.ownerMemberId)) ?? null;

  const action = await prisma.$transaction(async (tx) => {
    const created = await tx.meetingActionItem.create({
      data: {
        companyId: context.companyId,
        meetingId,
        title: input.title,
        description: input.description,
        ownerMemberId,
        dueAt: dueAt(input.dueDate) ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, title: true, ownerMemberId: true },
    });
    await recordUserAction(
      context,
      { actionKey: AuditAction.MEETING_ACTION_CREATED, entity: { type: ENTITY, id: meetingId }, projectId: meeting.projectId, metadata: { ownerMemberId, hasDueDate: Boolean(input.dueDate) } },
      { tx },
    );
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: meetingId,
      action: "MEETING_ACTION_CREATED",
      message: ownerMemberId ? "assigned an action" : "added an action",
      metadata: { actionId: created.id },
    });
    // With a task on the way, the task's own assignment notice tells the owner once.
    if (!input.createTask) await notifyActionAssigned(tx, context, meeting, created);
    return created;
  });

  if (input.createTask) {
    try {
      await convertActionToTask(context, meetingId, action.id);
    } catch (error) {
      // The action stands; the owner still hears about it, and the hand-off can be retried.
      await prisma.$transaction((tx) => notifyActionAssigned(tx, context, meeting, action));
      throw error;
    }
  }
  return getMeeting(context, meetingId);
}

export async function updateActionItem(
  context: UserContext,
  meetingId: string,
  actionId: string,
  input: { title?: string; description?: string | null; ownerMemberId?: string | null; dueDate?: string | null; status?: MeetingActionItemStatus },
): Promise<MeetingDetailDTO> {
  const meeting = await requireReadableMeeting(context, meetingId);
  const action = findAction(meeting, actionId);
  const manage = canManageActions(context, meeting);
  const content = input.title !== undefined || input.description !== undefined || input.ownerMemberId !== undefined || input.dueDate !== undefined;

  if (content) {
    if (!manage) throw new AccessError("FORBIDDEN", "You cannot change this action.");
    if (meeting.minutesStatus === "FINAL") throw new AccessError("CONFLICT", "These minutes are final. Reopen them to change an action.", { code: "MINUTES_FINAL" });
  }
  if (input.status !== undefined && input.status !== action.status) {
    if (action.linkedTaskId) {
      throw new AccessError("CONFLICT", "This action follows its task. Update the task instead.", { code: "ACTION_FOLLOWS_TASK" });
    }
    // The owner may move their own action along; anyone else needs to manage actions.
    if (!manage && !(action.ownerMemberId === context.membershipId && meetingsOpen(context) && meeting.status !== "CANCELLED")) {
      throw new AccessError("FORBIDDEN", "You cannot change this action.");
    }
  }
  const ownerMemberId = await requireOwner(context, input.ownerMemberId);
  const reassigned = ownerMemberId !== undefined && ownerMemberId !== action.ownerMemberId;
  const completed = input.status === "DONE" && action.status !== "DONE";

  await prisma.$transaction(async (tx) => {
    await tx.meetingActionItem.update({
      where: { id: actionId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(ownerMemberId !== undefined ? { ownerMemberId } : {}),
        ...(input.dueDate !== undefined ? { dueAt: dueAt(input.dueDate) } : {}),
        ...(input.status !== undefined ? { status: input.status, completedAt: input.status === "DONE" ? (action.completedAt ?? new Date()) : null } : {}),
      },
    });
    if (reassigned) await notifyActionAssigned(tx, context, meeting, { id: actionId, title: input.title ?? action.title, ownerMemberId: ownerMemberId ?? null });
    if (completed) {
      await recordActivity(tx, context, { module: MODULE, entityType: ENTITY, entityId: meetingId, action: "MEETING_ACTION_COMPLETED", message: "completed an action", metadata: { actionId } });
      await notifyActionCompleted(tx, context, meeting, { id: actionId, title: action.title });
    }
    if (input.status === "DONE" || input.status === "CANCELLED" || input.dueDate !== undefined) {
      await resolveAttentionForRecord(tx, context.companyId, RECORD, meetingId, ["MEETING_ACTION_OVERDUE"]);
    }
  });
  return getMeeting(context, meetingId);
}

export async function completeActionItem(context: UserContext, meetingId: string, actionId: string): Promise<MeetingDetailDTO> {
  return updateActionItem(context, meetingId, actionId, { status: "DONE" });
}

/**
 * Action → Task (PRD #40 §56-§61, §180). One task per action, ever.
 *
 * The task and the link commit together (PRD #48 §145): the link is claimed
 * with a conditional write, and the loser of a race rolls the transaction back
 * — so a task no action points at is never created in the first place, rather
 * than created and then archived (PRD #48 §22, §146). Meetings does not write
 * the task itself; Tasks owns that row and is given this transaction to write
 * it in (PRD #48 §75).
 */
export async function convertActionToTask(context: UserContext, meetingId: string, actionId: string): Promise<MeetingDetailDTO> {
  const meeting = await requireReadableMeeting(context, meetingId);
  const action = findAction(meeting, actionId);
  if (!canConvertToTask(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot create tasks from this meeting.");
  if (action.linkedTaskId) throw new AccessError("CONFLICT", "This action already has a task.", { code: "ACTION_ALREADY_CONVERTED" });
  if (action.status === "DONE" || action.status === "CANCELLED") {
    throw new AccessError("CONFLICT", "Only an open action can become a task.", { code: "ACTION_CLOSED" });
  }

  // The meeting's project, when the caller can put work on it.
  const projectId = meeting.projectId && canAccessModule(context, "projects") && (await canAccessProject(context, meeting.projectId)) ? meeting.projectId : undefined;

  const task = await runInTransaction("meetings.action.to_task", async (tx) => {
    const created = await createTaskFromContextIn(tx, context, {
      title: action.title.length >= 2 ? action.title : `${action.title} (action)`,
      description: action.description ?? undefined,
      projectId,
      assigneeMemberId: action.ownerMemberId ?? undefined,
      status: action.status === "IN_PROGRESS" ? "IN_PROGRESS" : "TODO",
      priority: "MEDIUM",
      dueDate: action.dueAt ?? undefined,
      startDate: undefined,
      parentType: RECORD,
      parentId: meetingId,
    });

    const result = await tx.meetingActionItem.updateMany({ where: { id: actionId, linkedTaskId: null }, data: { linkedTaskId: created.id } });
    if (result.count === 0) throw new AccessError("CONFLICT", "This action already has a task.", { code: "ACTION_ALREADY_CONVERTED" });

    await recordUserAction(
      context,
      { actionKey: AuditAction.MEETING_ACTION_TASK_CREATED, entity: { type: ENTITY, id: meetingId }, projectId: meeting.projectId, metadata: { actionId, taskId: created.id } },
      { tx },
    );
    return created;
  });

  // Watchers are the task's own, written outside its transaction because they
  // depend on who can read the task now it exists (PRD #38 §33).
  await subscribeStakeholders({ companyId: context.companyId, parentType: "task", parentId: task.id, memberIds: [context.membershipId, ...(task.assigneeMemberId ? [task.assigneeMemberId] : [])] });
  incrementCounter(Metric.MEETING_ACTION_TASK_CREATE);
  return getMeeting(context, meetingId);
}

/* -------------------------------------------------------------------------- */
/* Actions across meetings — the Actions section and "My open actions"         */
/* -------------------------------------------------------------------------- */

export async function listActionItems(context: UserContext, query: ActionListQuery): Promise<{ data: MyActionItemDTO[]; pagination: ReturnType<typeof paginationMeta> }> {
  assertModule(context, MODULE);
  assertPermission(context, "meeting.view");
  // A project filter goes through the project's own door, like the meeting list's (PRD #47 §175).
  const projectDoor = canAccessModule(context, "projects") && can(context, "project.view") ? buildProjectScopeWhere(context) : null;
  const byProject: Prisma.MeetingWhereInput = query.projectId ? (projectDoor ? { projectId: query.projectId, project: { is: projectDoor } } : { id: { in: [] } }) : {};
  const where: Prisma.MeetingActionItemWhereInput = {
    companyId: context.companyId,
    meeting: { AND: [readableMeetingWhere(context), { archivedAt: null }, byProject] },
    ...(query.mine ? { ownerMemberId: context.membershipId } : {}),
    ...(query.status === "open" ? { status: { in: OPEN } } : query.status === "done" ? { status: "DONE" } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.meetingActionItem.findMany({
      where,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        owner: { select: { id: true, status: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } } },
        linkedTask: { select: { id: true, title: true, status: true } },
        meeting: { select: { id: true, title: true, startsAt: true, timezone: true, project: { select: { id: true, name: true } } } },
      },
    }),
    prisma.meetingActionItem.count({ where }),
  ]);

  const taskIds = rows.map((row) => row.linkedTaskId).filter((id): id is string => Boolean(id));
  const readableTasks =
    taskIds.length && canAccessModule(context, "tasks") && can(context, "task.view")
      ? new Set(
          (
            await prisma.task.findMany({
              where: { AND: [buildTaskScopeWhere(context), { id: { in: taskIds } }] },
              select: { id: true },
            })
          ).map((row) => row.id),
        )
      : new Set<string>();

  /*
   * A meeting's project is named only to somebody who can open that project —
   * being invited to the meeting, or being able to see it, is not that
   * (PRD #40 §266, PRD #47 §175). The same rule as the meeting list.
   */
  const projectIds = [...new Set(rows.map((row) => row.meeting.project?.id).filter((id): id is string => Boolean(id)))];
  const openProjects =
    projectIds.length && projectDoor
      ? new Set((await prisma.project.findMany({ where: { AND: [projectDoor, { id: { in: projectIds } }] }, select: { id: true } })).map((row) => row.id))
      : new Set<string>();

  return {
    data: rows.map((row) => ({
      ...actionDTO(context, row, {
        today: todayInZone(row.meeting.timezone),
        readableTasks,
        // Managing an action is decided on its meeting's page; the list offers the owner's own moves only.
        canManage: false,
        canConvert: false,
        minutesFinal: true,
      }),
      meeting: { id: row.meeting.id, title: row.meeting.title, startsAt: row.meeting.startsAt.toISOString(), href: `/meetings/${row.meeting.id}` },
      project: row.meeting.project && openProjects.has(row.meeting.project.id) ? row.meeting.project : null,
    })),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}
