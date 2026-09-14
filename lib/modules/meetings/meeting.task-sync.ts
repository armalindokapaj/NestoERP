import type { MeetingActionItemStatus, Prisma, TaskStatus } from "@prisma/client";

import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { notifyActionCompleted } from "./meeting.notifications";
import { RECORD } from "./meeting.repository";

/**
 * Task → action (PRD #40 §59, §60). Called by the Task service inside the
 * transaction that changes the task's status, so the two never disagree. The
 * action follows: completed task, done action; reopened task, open action.
 */
export async function syncActionFromTask(
  tx: Prisma.TransactionClient,
  input: { companyId: string; taskId: string; status: TaskStatus; actorMemberId: string | null; assigneeMemberId?: string | null },
): Promise<void> {
  const action = await tx.meetingActionItem.findFirst({
    where: { companyId: input.companyId, linkedTaskId: input.taskId },
    select: {
      id: true,
      title: true,
      status: true,
      meeting: { select: { id: true, projectId: true, organizerMemberId: true, startsAt: true, endsAt: true, timezone: true } },
    },
  });
  if (!action || action.status === "CANCELLED") return;

  // Reassigning the task reassigns the action: one accountable person (PRD #40 §60).
  if (input.assigneeMemberId !== undefined) {
    await tx.meetingActionItem.update({ where: { id: action.id }, data: { ownerMemberId: input.assigneeMemberId } });
  }

  let next: MeetingActionItemStatus | null = null;
  if (input.status === "COMPLETED") next = "DONE";
  else if (input.status === "IN_PROGRESS" || input.status === "BLOCKED") next = "IN_PROGRESS";
  else if (input.status === "TODO") next = "OPEN";
  if (!next || next === action.status) return;

  await tx.meetingActionItem.update({
    where: { id: action.id },
    data: { status: next, completedAt: next === "DONE" ? new Date() : null },
  });
  if (next === "DONE") {
    await notifyActionCompleted(tx, { companyId: input.companyId, membershipId: input.actorMemberId }, action.meeting, action);
    await resolveAttentionForRecord(tx, input.companyId, RECORD, action.meeting.id, ["MEETING_ACTION_OVERDUE"]);
  }
}
