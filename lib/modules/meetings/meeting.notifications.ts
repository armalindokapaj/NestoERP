import type { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { describeWhen } from "@/lib/modules/calendar/calendar.format";
import { MODULE, RECORD } from "./meeting.repository";

/**
 * Meeting notifications (PRD #40 §73-§78, §185, §230, §251-§253).
 *
 * Every event goes through the outbox, so the dispatcher re-reads the meeting
 * as each recipient would before telling them anything: an event about a
 * meeting someone can no longer see is dropped there, not here. Nobody is told
 * about their own action, and a series is announced once, never once per
 * generated occurrence.
 */

type Tx = Prisma.TransactionClient;
type MeetingRef = { id: string; projectId: string | null; startsAt: Date; endsAt: Date; timezone: string };

function when(meeting: MeetingRef): string {
  return describeWhen(meeting.startsAt, meeting.endsAt, false, meeting.timezone);
}

async function enqueue(tx: Tx, context: UserContext, meeting: MeetingRef, eventType: string, payload: Record<string, unknown>) {
  await enqueueNotificationEvent(tx, {
    companyId: context.companyId,
    eventType,
    moduleKey: MODULE,
    entityType: RECORD,
    entityId: meeting.id,
    actorMemberId: context.membershipId,
    projectId: meeting.projectId,
    payload: { when: when(meeting), ...payload },
  });
}

export async function notifyInvited(tx: Tx, context: UserContext, meeting: MeetingRef, memberIds: string[], series?: string) {
  const recipients = memberIds.filter((id) => id !== context.membershipId);
  if (recipients.length === 0) return;
  await enqueue(tx, context, meeting, NotificationEvent.MEETING_INVITED, { memberIds: recipients, actorName: context.fullName, ...(series ? { series } : {}) });
}

/** Only a change people must act on — time, place, link, project, cancellation (PRD #40 §252, §253). */
export async function notifyUpdated(tx: Tx, context: UserContext, meeting: MeetingRef, participantIds: string[], extra: Record<string, unknown> = {}) {
  const recipients = participantIds.filter((id) => id !== context.membershipId);
  if (recipients.length === 0) return;
  await enqueue(tx, context, meeting, NotificationEvent.MEETING_UPDATED, { participantIds: recipients, ...extra });
}

export async function notifyCancelled(tx: Tx, context: UserContext, meeting: MeetingRef, participantIds: string[], reason: string | null) {
  const recipients = participantIds.filter((id) => id !== context.membershipId);
  if (recipients.length === 0) return;
  await enqueue(tx, context, meeting, NotificationEvent.MEETING_CANCELLED, { participantIds: recipients, reason: reason ?? "" });
}

export async function notifyResponse(tx: Tx, context: UserContext, meeting: MeetingRef & { organizerMemberId: string }, response: string) {
  const verb = response === "ACCEPTED" ? "accepted" : response === "DECLINED" ? "declined" : "tentatively accepted";
  await enqueue(tx, context, meeting, NotificationEvent.MEETING_RESPONSE_CHANGED, {
    organizerMemberId: meeting.organizerMemberId,
    responderName: context.fullName,
    verb,
  });
}

export async function notifyMinutesFinalized(tx: Tx, context: UserContext, meeting: MeetingRef, participantIds: string[]) {
  const recipients = participantIds.filter((id) => id !== context.membershipId);
  if (recipients.length === 0) return;
  await enqueue(tx, context, meeting, NotificationEvent.MEETING_MINUTES_FINALIZED, { participantIds: recipients });
}

/**
 * The owner of a new action. When a Task is created with it, the task's own
 * assignment notification already tells them, so this one is skipped
 * (PRD #40 §62).
 */
export async function notifyActionAssigned(tx: Tx, context: UserContext, meeting: MeetingRef, action: { id: string; title: string; ownerMemberId: string | null }) {
  if (!action.ownerMemberId || action.ownerMemberId === context.membershipId) return;
  await enqueue(tx, context, meeting, NotificationEvent.MEETING_ACTION_ASSIGNED, {
    ownerMemberId: action.ownerMemberId,
    actionId: action.id,
    actionTitle: action.title,
  });
}

export async function notifyActionCompleted(
  tx: Tx,
  context: { companyId: string; membershipId: string | null },
  meeting: MeetingRef & { organizerMemberId: string },
  action: { id: string; title: string },
) {
  if (meeting.organizerMemberId === context.membershipId) return;
  await enqueueNotificationEvent(tx, {
    companyId: context.companyId,
    eventType: NotificationEvent.MEETING_ACTION_COMPLETED,
    moduleKey: MODULE,
    entityType: RECORD,
    entityId: meeting.id,
    actorMemberId: context.membershipId,
    projectId: meeting.projectId,
    payload: { organizerMemberId: meeting.organizerMemberId, actionId: action.id, actionTitle: action.title, when: when(meeting) },
  });
}
