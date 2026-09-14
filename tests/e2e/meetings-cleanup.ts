import { db } from "./db";

/**
 * Removes every meeting an E2E spec created (by title prefix), with what hangs
 * off it — participants, agenda, minutes, decisions, actions, the tasks those
 * actions raised, reminders, notifications, discussion and audit — so a rerun
 * starts from the seed.
 */
export async function removeMeetings(prefix: string): Promise<void> {
  const meetings = await db.meeting.findMany({ where: { title: { startsWith: prefix } }, select: { id: true, seriesId: true } });
  const ids = meetings.map((row) => row.id);
  if (ids.length === 0) return;
  const linked = await db.meetingActionItem.findMany({ where: { meetingId: { in: ids }, linkedTaskId: { not: null } }, select: { linkedTaskId: true } });
  const taskIds = linked.map((row) => row.linkedTaskId!);
  const parents = [...ids, ...taskIds];

  const reminders = await db.calendarReminder.findMany({ where: { meetingId: { in: ids } }, select: { id: true } });
  await db.calendarReminderDelivery.deleteMany({ where: { reminderId: { in: reminders.map((row) => row.id) } } });
  await db.calendarReminder.deleteMany({ where: { meetingId: { in: ids } } });
  await db.meetingActionItem.deleteMany({ where: { meetingId: { in: ids } } });
  await db.meetingDecision.deleteMany({ where: { meetingId: { in: ids } } });
  await db.meetingMinutesSection.deleteMany({ where: { meetingId: { in: ids } } });
  await db.meetingAgendaItem.deleteMany({ where: { meetingId: { in: ids } } });
  await db.meetingParticipant.deleteMany({ where: { meetingId: { in: ids } } });
  await db.attentionItem.deleteMany({ where: { entityId: { in: parents } } });
  await db.notification.deleteMany({ where: { entityId: { in: parents } } });
  await db.notificationEventOutbox.deleteMany({ where: { entityId: { in: parents } } });
  const threads = await db.collaborationThread.findMany({ where: { parentId: { in: parents } }, select: { id: true } });
  const threadIds = threads.map((row) => row.id);
  await db.mention.deleteMany({ where: { comment: { threadId: { in: threadIds } } } });
  await db.comment.deleteMany({ where: { threadId: { in: threadIds } } });
  await db.subscription.deleteMany({ where: { threadId: { in: threadIds } } });
  await db.collaborationThread.deleteMany({ where: { id: { in: threadIds } } });
  await db.activity.deleteMany({ where: { entityId: { in: parents } } });
  await db.auditEvent.deleteMany({ where: { entityId: { in: parents } } });
  await db.meeting.deleteMany({ where: { id: { in: ids } } });
  const seriesIds = [...new Set(meetings.map((row) => row.seriesId).filter((id): id is string => Boolean(id)))];
  if (seriesIds.length) await db.meetingSeries.deleteMany({ where: { id: { in: seriesIds } } });
  await db.task.deleteMany({ where: { id: { in: taskIds } } });
}
