import type { MeetingActionItemStatus, Prisma, TaskStatus } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { recordActivity } from "@/lib/modules/shared/activity";
import { notifyActionCompleted } from "./meeting.notifications";
import { ENTITY, MODULE, RECORD } from "./meeting.repository";

/**
 * Task → action (PRD #40 §59, §60, AUD-10 §5). Called by the Task service
 * inside the transaction that changes the task, so the two never disagree.
 * The action follows: completed task, done action; reopened task, open action.
 *
 * The mapping, unchanged from PRD #40 and verified by AUD-10 CW-08..CW-10:
 *
 *   TODO → OPEN · IN_PROGRESS or BLOCKED → IN_PROGRESS · COMPLETED → DONE
 *   an assignee change, to somebody or to nobody → the action's owner
 *   a due date change → the action's due date (the task owns it, AUD-10 CW-11)
 *   ARCHIVED → nothing: the meetings have no archived action, and the action
 *     still names the task. Restoring calls this again with the status the
 *     task returns to (AUD-02 §8).
 *   a CANCELLED action → nothing, ever: it is not resurrected or reassigned.
 *
 * The action row is locked after the task, in AUD-02's lock order. Completion
 * writes the same meeting history the standalone path writes — once per
 * genuine transition, since it is guarded on the status just read: a replay
 * finds DONE and writes nothing; reopen and complete again is a new
 * completion with its own entry (AUD-10 CW-09). Any failure here throws, and
 * the task's own change rolls back with it (CW-11).
 *
 * Answers the meeting whose action it read, so the caller can refresh that
 * meeting's page; null when the task has no live action.
 */
export async function syncActionFromTask(
  tx: Prisma.TransactionClient,
  input: { actor: UserContext; taskId: string; status: TaskStatus; assigneeMemberId?: string | null; dueDate?: Date | null },
): Promise<{ meetingId: string } | null> {
  const { actor } = input;
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "meeting_action_items" WHERE "companyId" = ${actor.companyId} AND "linkedTaskId" = ${input.taskId} FOR UPDATE`;
  if (!locked[0]) return null;
  const action = await tx.meetingActionItem.findUniqueOrThrow({
    where: { id: locked[0].id },
    select: {
      id: true,
      title: true,
      status: true,
      ownerMemberId: true,
      dueAt: true,
      meeting: { select: { id: true, projectId: true, organizerMemberId: true, startsAt: true, endsAt: true, timezone: true } },
    },
  });
  if (action.status === "CANCELLED") return null;

  // Reassigning the task reassigns the action: one accountable person (PRD #40 §60).
  const ownerChanged = input.assigneeMemberId !== undefined && input.assigneeMemberId !== action.ownerMemberId;
  const dueChanged = input.dueDate !== undefined && !sameDay(input.dueDate, action.dueAt);
  if (ownerChanged || dueChanged) {
    // Columns spelled out (undefined leaves one alone): never the status, which moves only below.
    await tx.meetingActionItem.update({
      where: { id: action.id },
      data: { ownerMemberId: ownerChanged ? input.assigneeMemberId : undefined, dueAt: dueChanged ? businessDue(input.dueDate ?? null) : undefined },
    });
  }

  let next: MeetingActionItemStatus | null = null;
  if (input.status === "COMPLETED") next = "DONE";
  else if (input.status === "IN_PROGRESS" || input.status === "BLOCKED") next = "IN_PROGRESS";
  else if (input.status === "TODO") next = "OPEN";
  if (!next || next === action.status) return { meetingId: action.meeting.id };

  // Guarded on the status just read, under the row lock: kept so a change to
  // the locking above fails closed rather than writing blind.
  const moved = await tx.meetingActionItem.updateMany({
    where: { id: action.id, status: action.status },
    data: { status: next, completedAt: next === "DONE" ? new Date() : null },
  });
  if (moved.count === 0) {
    throw new AccessError("CONFLICT", "The meeting action linked to this task changed at the same moment. Try again.", {
      code: "MEETING_ACTION_CHANGED",
    });
  }
  if (next === "DONE") {
    await recordActivity(tx, actor, {
      module: MODULE,
      entityType: ENTITY,
      entityId: action.meeting.id,
      action: "MEETING_ACTION_COMPLETED",
      message: "completed an action",
      metadata: { actionId: action.id, taskId: input.taskId },
    });
    await notifyActionCompleted(tx, actor, action.meeting, action);
    await resolveAttentionForRecord(tx, actor.companyId, RECORD, action.meeting.id, ["MEETING_ACTION_OVERDUE"]);
  }
  return { meetingId: action.meeting.id };
}

/** Meetings store a due date as the business day at midday UTC (meeting.actions `dueAt`). */
function businessDue(date: Date | null): Date | null {
  return date ? new Date(`${date.toISOString().slice(0, 10)}T12:00:00.000Z`) : null;
}

function sameDay(a: Date | null, b: Date | null): boolean {
  return (a?.toISOString().slice(0, 10) ?? null) === (b?.toISOString().slice(0, 10) ?? null);
}
