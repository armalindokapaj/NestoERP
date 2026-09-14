import { Prisma } from "@prisma/client";

import { logger } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";
import { describeWhen } from "./calendar.format";
import { expandRecurrence, parseRecurrence } from "./calendar.recurrence";

/**
 * The reminder worker (PRD #39 §109-§111), a job on the PRD #38 runner.
 *
 *   find reminders whose moment has come
 *   → claim the occurrence by inserting its delivery row
 *   → enqueue the notification on the same transaction
 *
 * The delivery's unique key — reminder and occurrence — is the idempotency key:
 * two workers, or a retry after a crash, cannot fire the same reminder twice.
 * The notification dispatcher then re-reads the event for the member, so a
 * reminder for an event they can no longer see is never delivered, and applies
 * their preferences, including email.
 *
 * A reminder is information, not attention: nothing here creates an attention
 * item (PRD #39 §111).
 */

/** How late a reminder may still fire: a worker back from an outage catches up this far. */
const LOOKBACK_MS = 6 * 60 * 60_000;
/** An "at time" reminder is still useful a little after the start. */
const START_GRACE_MS = 15 * 60_000;
const MAX_MINUTES_BEFORE = 10_080;
const BATCH = 2_000;

export type ReminderRunResult = { considered: number; fired: number; skipped: number };

export async function runCalendarReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const horizon = new Date(now.getTime() + MAX_MINUTES_BEFORE * 60_000 + 60_000);
  const earliest = new Date(now.getTime() - LOOKBACK_MS);

  const reminders = await prisma.calendarReminder.findMany({
    where: {
      eventId: { not: null },
      event: {
        archivedAt: null,
        company: { status: "ACTIVE" },
        startsAt: { lte: horizon },
        OR: [
          { recurrenceRule: null, startsAt: { gte: earliest } },
          { recurrenceRule: { not: null }, OR: [{ recurrenceEndsAt: null }, { recurrenceEndsAt: { gte: earliest } }] },
        ],
      },
      member: { status: "ACTIVE" },
    },
    take: BATCH,
    select: {
      id: true,
      companyId: true,
      memberId: true,
      minutesBefore: true,
      event: {
        select: { id: true, projectId: true, startsAt: true, endsAt: true, allDay: true, timezone: true, recurrenceRule: true },
      },
    },
  });

  let fired = 0;
  let skipped = 0;

  for (const reminder of reminders) {
    const event = reminder.event!;
    const lead = reminder.minutesBefore * 60_000;
    // Occurrences whose reminder moment falls between the lookback and now.
    const window = { from: new Date(earliest.getTime() + lead - START_GRACE_MS), to: new Date(now.getTime() + lead + 1) };
    const occurrences = event.recurrenceRule
      ? expandRecurrence(event, parseRecurrence(event.recurrenceRule), window, 50)
      : [{ startsAt: event.startsAt, endsAt: event.endsAt ?? event.startsAt }];

    for (const occurrence of occurrences) {
      const dueAt = new Date(occurrence.startsAt.getTime() - lead);
      if (dueAt > now || dueAt < earliest || occurrence.startsAt.getTime() < now.getTime() - START_GRACE_MS) continue;

      try {
        await prisma.$transaction(async (tx) => {
          await tx.calendarReminderDelivery.create({
            data: { companyId: reminder.companyId, reminderId: reminder.id, occurrenceStartsAt: occurrence.startsAt, dueAt },
          });
          await enqueueNotificationEvent(tx, {
            companyId: reminder.companyId,
            eventType: NotificationEvent.CALENDAR_REMINDER,
            moduleKey: "calendar",
            entityType: "calendar_event",
            entityId: event.id,
            projectId: event.projectId,
            payload: {
              memberId: reminder.memberId,
              reminderId: reminder.id,
              occurrenceStartsAt: occurrence.startsAt.toISOString(),
              when: describeWhen(occurrence.startsAt, occurrence.endsAt, event.allDay, event.timezone),
            },
          });
        });
        fired += 1;
        incrementCounter(Metric.CALENDAR_REMINDER_SENT);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          skipped += 1; // Already fired by an earlier run.
          continue;
        }
        incrementCounter(Metric.CALENDAR_REMINDER_FAILURE);
        logger.error("calendar.reminder.failed", {
          companyId: reminder.companyId,
          reminderId: reminder.id,
          error: error instanceof Error ? error.message : "unknown",
        });
        throw error;
      }
    }
  }

  // Meetings keep their reminders in the same table and fire through the same
  // idempotent delivery row (PRD #40 §74, §188).
  const meetingReminders = await prisma.calendarReminder.findMany({
    where: {
      meetingId: { not: null },
      meeting: {
        archivedAt: null,
        status: "SCHEDULED",
        company: { status: "ACTIVE" },
        startsAt: { lte: horizon, gte: new Date(now.getTime() - START_GRACE_MS) },
      },
      member: { status: "ACTIVE" },
    },
    take: BATCH,
    select: {
      id: true,
      companyId: true,
      memberId: true,
      minutesBefore: true,
      meeting: { select: { id: true, projectId: true, startsAt: true, endsAt: true, timezone: true } },
    },
  });

  for (const reminder of meetingReminders) {
    const meeting = reminder.meeting!;
    const dueAt = new Date(meeting.startsAt.getTime() - reminder.minutesBefore * 60_000);
    if (dueAt > now || dueAt < earliest) continue;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.calendarReminderDelivery.create({
          data: { companyId: reminder.companyId, reminderId: reminder.id, occurrenceStartsAt: meeting.startsAt, dueAt },
        });
        await enqueueNotificationEvent(tx, {
          companyId: reminder.companyId,
          eventType: NotificationEvent.MEETING_REMINDER,
          moduleKey: "meetings",
          entityType: "meeting",
          entityId: meeting.id,
          projectId: meeting.projectId,
          payload: {
            memberId: reminder.memberId,
            reminderId: reminder.id,
            occurrenceStartsAt: meeting.startsAt.toISOString(),
            when: describeWhen(meeting.startsAt, meeting.endsAt, false, meeting.timezone),
          },
        });
      });
      fired += 1;
      incrementCounter(Metric.CALENDAR_REMINDER_SENT, { kind: "meeting" });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        skipped += 1;
        continue;
      }
      incrementCounter(Metric.CALENDAR_REMINDER_FAILURE, { kind: "meeting" });
      throw error;
    }
  }

  return { considered: reminders.length + meetingReminders.length, fired, skipped };
}
