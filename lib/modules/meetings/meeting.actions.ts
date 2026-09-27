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
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { createTaskFromContextIn } from "@/lib/modules/tasks/task.service";
import { notifyActionAssigned, notifyActionCompleted } from "./meeting.notifications";
import { canConvertToTask, canCreateAction, canManageActions, meetingsOpen, readableMeetingWhere } from "./meeting.permissions";
import {
  actionDTO,
  ENTITY,
  getMeeting,
  LIST_SNAPSHOT,
  MODULE,
  readableTaskIds,
  RECORD,
  requireReadableMeeting,
  todayInZone,
  type MeetingDetailRow,
} from "./meeting.repository";
import type { ActionListQuery } from "./meeting.schema";
import { requireMembers } from "./meeting.service";
import type { ActionCreatedDTO, ActionTaskHandoff, MeetingDetailDTO, MyActionItemDTO } from "./meeting.types";

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

/**
 * Adds an action, and — asked to — hands it to a Task in the same transaction
 * (AUD-10 §5, §7).
 *
 * The action, its history and either the task (with its link) or the owner's
 * notice commit together. A hand-off the Task service refuses — an assignee
 * off the project team, a permission the person lacks — is rolled back to a
 * savepoint, so the action still commits with the owner's own notice, and the
 * answer says so: "the action was added; the task was not, because …". It is
 * never an error that suggests nothing was saved, and there is no second
 * transaction for the notice to go missing in. Anything else — a database
 * failure, the actor's access revoked — rolls the whole command back.
 */
export async function createActionItem(
  context: UserContext,
  meetingId: string,
  input: { title: string; description: string | null; ownerMemberId?: string | null; dueDate?: string | null; createTask: boolean },
): Promise<ActionCreatedDTO> {
  const meeting = await requireReadableMeeting(context, meetingId);
  if (meeting.minutesStatus === "FINAL") throw new AccessError("CONFLICT", "These minutes are final. Reopen them to add an action.", { code: "MINUTES_FINAL" });
  if (!canCreateAction(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot add actions to this meeting.");
  if (input.createTask && !canConvertToTask(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot create tasks from this meeting.");
  const ownerMemberId = (await requireOwner(context, input.ownerMemberId)) ?? null;
  const projectId = input.createTask ? await taskProjectOf(context, meeting) : undefined;

  const taskHandoff = await runInTransaction(
    "meetings.action.create",
    async (tx): Promise<ActionTaskHandoff | null> => {
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
        select: { id: true, title: true, description: true, status: true, ownerMemberId: true, dueAt: true },
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
      if (!input.createTask) {
        await notifyActionAssigned(tx, context, meeting, created);
        return null;
      }

      await tx.$executeRawUnsafe("SAVEPOINT meeting_action_handoff");
      try {
        const taskId = await handOffIn(tx, context, meeting, created, projectId);
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT meeting_action_handoff");
        // With a task, the task's own assignment notice tells the owner once (PRD #40 §62).
        return { created: true, taskId };
      } catch (error) {
        if (!(error instanceof AccessError) || error instanceof ConversionLost) throw error;
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT meeting_action_handoff");
        // No task, so the owner hears about the action itself — in this transaction.
        await notifyActionAssigned(tx, context, meeting, created);
        const code = (error.details as { code?: unknown } | undefined)?.code;
        return { created: false, code: typeof code === "string" ? code : error.code, message: error.message };
      }
    },
    { actor: context },
  );

  if (taskHandoff?.created) incrementCounter(Metric.MEETING_ACTION_TASK_CREATE);
  return { ...(await getMeeting(context, meetingId)), taskHandoff };
}

/** The action row as a change must see it: locked, in this company and meeting (AUD-10 §5, CW-11). */
type LockedAction = { id: string; title: string; status: MeetingActionItemStatus; ownerMemberId: string | null; dueAt: Date | null; completedAt: Date | null; linkedTaskId: string | null };

async function lockAction(tx: Prisma.TransactionClient, context: UserContext, meetingId: string, actionId: string): Promise<LockedAction> {
  const rows = await tx.$queryRaw<LockedAction[]>`
    SELECT "id", "title", "status", "ownerMemberId", "dueAt", "completedAt", "linkedTaskId"
    FROM "meeting_action_items"
    WHERE "id" = ${actionId} AND "companyId" = ${context.companyId} AND "meetingId" = ${meetingId}
    FOR UPDATE`;
  if (!rows[0]) throw new AccessError("NOT_FOUND");
  return rows[0];
}

const followsTask = () => new AccessError("CONFLICT", "This action follows its task. Update the task instead.", { code: "ACTION_FOLLOWS_TASK" });

function sameInstant(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

/**
 * Edits an action, or moves a standalone one along (PRD #40 §59, AUD-10 §5).
 *
 * Decided on the row as locked inside the transaction, not on the page read
 * before it: two people completing the same action at once write it once, and
 * only the one who moved it records the completion and tells the organizer
 * (AUD-10 CW-09). A linked action's status, owner and due date belong to its
 * Task — changing them here is refused with ACTION_FOLLOWS_TASK, so the action
 * cannot drift from the task, or bypass the task's own assignee and project
 * rules (AUD-10 CW-11). Sending the value it already has is not a change.
 */
export async function updateActionItem(
  context: UserContext,
  meetingId: string,
  actionId: string,
  input: { title?: string; description?: string | null; ownerMemberId?: string | null; dueDate?: string | null; status?: MeetingActionItemStatus },
): Promise<MeetingDetailDTO> {
  const meeting = await requireReadableMeeting(context, meetingId);
  const action = findAction(meeting, actionId);
  const manage = canManageActions(context, meeting);
  // Only somebody who manages actions, or the action's owner, changes it at
  // all: an empty or unchanged request from anybody else is refused, not
  // answered 200 as though it were theirs to send (AUD-06 §6, RP-09).
  if (!manage && action.ownerMemberId !== context.membershipId) throw new AccessError("FORBIDDEN", "You cannot change this action.");
  const content = input.title !== undefined || input.description !== undefined || input.ownerMemberId !== undefined || input.dueDate !== undefined;

  if (content) {
    if (!manage) throw new AccessError("FORBIDDEN", "You cannot change this action.");
    if (meeting.minutesStatus === "FINAL") throw new AccessError("CONFLICT", "These minutes are final. Reopen them to change an action.", { code: "MINUTES_FINAL" });
  }
  const nextDue = dueAt(input.dueDate);
  const ownerMemberId = await requireOwner(context, input.ownerMemberId);

  await runInTransaction(
    "meetings.action.update",
    async (tx) => {
      const locked = await lockAction(tx, context, meetingId, actionId);
      if (!manage && locked.ownerMemberId !== context.membershipId) throw new AccessError("FORBIDDEN", "You cannot change this action.");

      const statusChange = input.status !== undefined && input.status !== locked.status;
      const ownerChange = ownerMemberId !== undefined && ownerMemberId !== locked.ownerMemberId;
      const dueChange = nextDue !== undefined && !sameInstant(nextDue, locked.dueAt);
      if (locked.linkedTaskId && (statusChange || ownerChange || dueChange)) throw followsTask();
      if (statusChange) {
        // The owner may move their own action along; anyone else needs to manage actions.
        if (!manage && !(locked.ownerMemberId === context.membershipId && meetingsOpen(context) && meeting.status !== "CANCELLED")) {
          throw new AccessError("FORBIDDEN", "You cannot change this action.");
        }
      }
      const completed = input.status === "DONE" && locked.status !== "DONE";

      await tx.meetingActionItem.updateMany({
        where: { id: actionId, companyId: context.companyId, meetingId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(ownerChange ? { ownerMemberId } : {}),
          ...(dueChange ? { dueAt: nextDue } : {}),
          ...(statusChange ? { status: input.status, completedAt: input.status === "DONE" ? (locked.completedAt ?? new Date()) : null } : {}),
        },
      });
      if (ownerChange) await notifyActionAssigned(tx, context, meeting, { id: actionId, title: input.title ?? locked.title, ownerMemberId: ownerMemberId ?? null });
      if (completed) {
        await recordActivity(tx, context, { module: MODULE, entityType: ENTITY, entityId: meetingId, action: "MEETING_ACTION_COMPLETED", message: "completed an action", metadata: { actionId } });
        await notifyActionCompleted(tx, context, meeting, { id: actionId, title: locked.title });
      }
      if (statusChange && (input.status === "DONE" || input.status === "CANCELLED") || dueChange) {
        await resolveAttentionForRecord(tx, context.companyId, RECORD, meetingId, ["MEETING_ACTION_OVERDUE"]);
      }
    },
    { actor: context },
  );
  return getMeeting(context, meetingId);
}

export async function completeActionItem(context: UserContext, meetingId: string, actionId: string): Promise<MeetingDetailDTO> {
  return updateActionItem(context, meetingId, actionId, { status: "DONE" });
}

/** The meeting's project, when the caller can put work on it. */
async function taskProjectOf(context: UserContext, meeting: MeetingDetailRow): Promise<string | undefined> {
  return meeting.projectId && canAccessModule(context, "projects") && (await canAccessProject(context, meeting.projectId)) ? meeting.projectId : undefined;
}

/**
 * The action's claim was lost inside the transaction: somebody linked,
 * closed, reassigned or re-dated it at the same moment. Thrown to roll the
 * new task back; the caller then answers from the action as it now is.
 */
class ConversionLost extends AccessError {
  constructor() {
    super("CONFLICT", "This action changed while its task was being created. Nothing was saved; try again.", { code: "ACTION_CHANGED" });
  }
}

/**
 * The task for an action, and the link to it, in the caller's transaction
 * (PRD #48 §145, AUD-10 §5, CW-07).
 *
 * Tasks writes the task with its own rules; the link is then claimed with a
 * conditional write on everything the task was copied from — still unlinked,
 * still in the status, owner and due date read — so a concurrent conversion,
 * cancellation, completion or reassignment makes this one roll back rather
 * than link a task built from a stale action. The action row is locked last,
 * after the task, in AUD-02's lock order.
 */
async function handOffIn(
  tx: Prisma.TransactionClient,
  context: UserContext,
  meeting: MeetingDetailRow,
  action: { id: string; title: string; description: string | null; status: MeetingActionItemStatus; ownerMemberId: string | null; dueAt: Date | null },
  projectId: string | undefined,
): Promise<string> {
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
    parentId: meeting.id,
  });

  const claimed = await tx.meetingActionItem.updateMany({
    where: {
      id: action.id,
      companyId: context.companyId,
      meetingId: meeting.id,
      linkedTaskId: null,
      status: { in: OPEN, equals: action.status },
      ownerMemberId: action.ownerMemberId,
      dueAt: action.dueAt,
    },
    data: { linkedTaskId: created.id },
  });
  if (claimed.count === 0) throw new ConversionLost();

  await recordUserAction(
    context,
    { actionKey: AuditAction.MEETING_ACTION_TASK_CREATED, entity: { type: ENTITY, id: meeting.id }, projectId: meeting.projectId, metadata: { actionId: action.id, taskId: created.id } },
    { tx },
  );
  return created.id;
}

export type ActionConversion = { meeting: MeetingDetailDTO; taskId: string; created: boolean };

/**
 * An action that already has its task (AUD-10 §5, CW-07): the retry of a
 * finished conversion answers with that task when the caller may open it —
 * the same canonical task, not a second one and not an error. Somebody who
 * may not open it is told only that the action has a task, never its name.
 */
async function existingConversion(context: UserContext, meetingId: string, taskId: string): Promise<ActionConversion> {
  if (!(await readableTaskIds(context, [taskId])).has(taskId)) {
    throw new AccessError("CONFLICT", "This action already has a task.", { code: "ACTION_ALREADY_CONVERTED" });
  }
  return { meeting: await getMeeting(context, meetingId), taskId, created: false };
}

const actionClosed = () => new AccessError("CONFLICT", "Only an open action can become a task.", { code: "ACTION_CLOSED" });

/**
 * Action → Task (PRD #40 §56-§61, §180, AUD-10 §5). One task per action, ever.
 *
 * The task and the link commit together (PRD #48 §145): the loser of a race
 * rolls its task back — so a task no action points at is never created in the
 * first place (PRD #48 §22, §146) — and then answers like a retry: the
 * winner's task, when the caller may open it (CW-07). The actor is re-read at
 * the commit boundary (AUD-06 RP-16), and the action's state is rechecked in
 * the claim itself, so a cancelled or completed action never gets a task.
 */
export async function convertActionToTask(context: UserContext, meetingId: string, actionId: string): Promise<ActionConversion> {
  const meeting = await requireReadableMeeting(context, meetingId);
  const action = findAction(meeting, actionId);
  if (!canConvertToTask(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot create tasks from this meeting.");
  if (action.linkedTaskId) return existingConversion(context, meetingId, action.linkedTaskId);
  if (action.status === "DONE" || action.status === "CANCELLED") throw actionClosed();

  const projectId = await taskProjectOf(context, meeting);
  let taskId: string;
  try {
    taskId = await runInTransaction("meetings.action.to_task", (tx) => handOffIn(tx, context, meeting, action, projectId), { actor: context });
  } catch (error) {
    if (!(error instanceof ConversionLost)) throw error;
    const now = await prisma.meetingActionItem.findFirst({ where: { id: actionId, companyId: context.companyId, meetingId }, select: { status: true, linkedTaskId: true } });
    if (!now) throw new AccessError("NOT_FOUND");
    if (now.linkedTaskId) return existingConversion(context, meetingId, now.linkedTaskId);
    if (now.status === "DONE" || now.status === "CANCELLED") throw actionClosed();
    throw error;
  }

  // The task's watchers — its creator and assignee — were subscribed by the
  // task door inside the same transaction (PRD #38 §33, AUD-02 §8).
  incrementCounter(Metric.MEETING_ACTION_TASK_CREATE);
  return { meeting: await getMeeting(context, meetingId), taskId, created: true };
}

/* -------------------------------------------------------------------------- */
/* Actions across meetings — the Actions section and "My open actions"         */
/* -------------------------------------------------------------------------- */

/**
 * The `where` of an action list for one company's context. Its own function so
 * the Group workspace can put one per company in a union — each company
 * answering with its own rules (Workspace Context §34, §58).
 */
export function actionListWhere(context: UserContext, query: ActionListQuery): Prisma.MeetingActionItemWhereInput {
  // A project filter goes through the project's own door, like the meeting list's (PRD #47 §175).
  const projectDoor = canAccessModule(context, "projects") && can(context, "project.view") ? buildProjectScopeWhere(context) : null;
  const byProject: Prisma.MeetingWhereInput = query.projectId ? (projectDoor ? { projectId: query.projectId, project: { is: projectDoor } } : { id: { in: [] } }) : {};
  return {
    companyId: context.companyId,
    meeting: { AND: [readableMeetingWhere(context), { archivedAt: null }, byProject] },
    ...(query.mine ? { ownerMemberId: context.membershipId } : {}),
    ...(query.status === "open" ? { status: { in: OPEN } } : query.status === "done" ? { status: "DONE" } : {}),
  };
}

/** Soonest due first, undated actions last, then oldest first; the id breaks ties (AUD-08 §4, DT-04). */
export const ACTION_LIST_ORDER: Prisma.MeetingActionItemOrderByWithRelationInput[] = [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }];

export const ACTION_LIST_INCLUDE = {
  owner: { select: { id: true, status: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } } },
  linkedTask: { select: { id: true, title: true, status: true } },
  meeting: { select: { id: true, title: true, startsAt: true, timezone: true, project: { select: { id: true, name: true } } } },
} satisfies Prisma.MeetingActionItemInclude;

export type ActionListRow = Prisma.MeetingActionItemGetPayload<{ include: typeof ACTION_LIST_INCLUDE }>;

/** The action rows of one company as this reader sees them: linked tasks and projects only where they may open them. */
export async function actionListDTOs(context: UserContext, rows: ActionListRow[]): Promise<MyActionItemDTO[]> {
  const projectDoor = canAccessModule(context, "projects") && can(context, "project.view") ? buildProjectScopeWhere(context) : null;
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

  return rows.map((row) => ({
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
  }));
}

export async function listActionItems(context: UserContext, query: ActionListQuery): Promise<{ data: MyActionItemDTO[]; pagination: ReturnType<typeof paginationMeta> }> {
  assertModule(context, MODULE);
  assertPermission(context, "meeting.view");
  const where = actionListWhere(context, query);
  const [rows, total] = await prisma.$transaction(
    [
      prisma.meetingActionItem.findMany({
        where,
        orderBy: ACTION_LIST_ORDER,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: ACTION_LIST_INCLUDE,
      }),
      prisma.meetingActionItem.count({ where }),
    ],
    LIST_SNAPSHOT,
  );

  return { data: await actionListDTOs(context, rows), pagination: paginationMeta(total, query.page, query.limit) };
}
