import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { sqlTimestamp } from "@/lib/database/clock";
import { prisma } from "@/lib/database/prisma";
import { describeWhen } from "./calendar.format";
import { expandRecurrence, parseRecurrence, type Occurrence } from "./calendar.recurrence";

/**
 * The reminder worker (PRD #39 §109-§111), a job on the PRD #38 runner.
 *
 *   for each active company, one at a time
 *   → walk the reminders that can be due now, a batch at a time by id
 *   → claim each due occurrence by inserting its delivery row
 *   → enqueue the notification on the same transaction
 *
 * The delivery's unique key — reminder and occurrence — is the idempotency key
 * (PRD #51 §15-§19): the insert skips a row that exists, and only the worker
 * whose insert landed enqueues, so two workers, or a retry after a crash,
 * cannot fire the same reminder twice. The notification dispatcher then
 * re-reads the event for the member, so a reminder for an event they can no
 * longer see is never delivered, and applies their preferences, including
 * email.
 *
 * Which reminders can be due is decided in the database rather than after
 * loading a week of events: the reminder moment is the start less the lead, a
 * sum Prisma cannot express, and a fixed-size read of every event in the next
 * seven days is what used to drop reminders silently once a deployment had
 * more of them than the read took (PRD #51 §133-§138). A single event or a
 * meeting is due exactly when that moment has come and no delivery exists; a
 * recurring event is only known to be due once its rule is expanded, so every
 * series that has started and not ended is walked.
 *
 * One reminder that cannot be sent — a stored rule that no longer parses, a
 * failed write — is logged and passed over, and the run ends as a partial
 * failure once every other reminder has had its turn (PRD #51 §30-§36, §42).
 *
 * A reminder is information, not attention: nothing here creates an attention
 * item (PRD #39 §111).
 */

const JOB = "calendar.reminders";
/** How late a reminder may still fire: a worker back from an outage catches up this far. */
const LOOKBACK_MS = 6 * 60 * 60_000;
/** An "at time" reminder is still useful a little after the start. */
const START_GRACE_MS = 15 * 60_000;
/** Reminders read per query (PRD #51 §134). */
export const REMINDER_BATCH = 200;

export type ReminderRunResult = { considered: number; fired: number; skipped: number; failed: number };

type Window = { now: Date; earliest: Date; graceStart: Date };

export async function runCalendarReminders(now: Date = new Date(), options: { batchSize?: number } = {}): Promise<ReminderRunResult> {
  const window: Window = { now, earliest: new Date(now.getTime() - LOOKBACK_MS), graceStart: new Date(now.getTime() - START_GRACE_MS) };
  const batchSize = options.batchSize ?? REMINDER_BATCH;
  const result: ReminderRunResult = { considered: 0, fired: 0, skipped: 0, failed: 0 };

  // The calendar is part of every company; a suspended one is reminded of nothing (PRD #51 §145).
  const events = await forEachCompany(JOB, (system) => fireEventReminders(system.companyId, window, batchSize, result));
  // Meetings keep their reminders in the same table and fire through the same
  // idempotent delivery row (PRD #40 §74, §188) — but only while the company
  // still uses the meetings module.
  const meetings = await forEachCompany(JOB, (system) => fireMeetingReminders(system.companyId, window, batchSize, result), { moduleKey: "meetings" });

  assertEveryCompanySucceeded(JOB, events);
  assertEveryCompanySucceeded(JOB, meetings);
  return result;
}

/* -------------------------------------------------------------------------- */
/* Calendar events                                                             */
/* -------------------------------------------------------------------------- */

async function fireEventReminders(companyId: string, window: Window, batchSize: number, result: ReminderRunResult): Promise<void> {
  let failed = 0;
  await inBatches(batchSize, (after, limit) => dueEventReminderIds(companyId, window, after, limit), async (ids) => {
    const reminders = await prisma.calendarReminder.findMany({
      where: { id: { in: ids }, companyId, eventId: { not: null } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        memberId: true,
        minutesBefore: true,
        event: { select: { id: true, projectId: true, startsAt: true, endsAt: true, allDay: true, timezone: true, recurrenceRule: true } },
      },
    });
    const delivered = await deliveredOccurrences(
      companyId,
      reminders.filter((reminder) => reminder.event?.recurrenceRule).map((reminder) => reminder.id),
      window,
    );

    for (const reminder of reminders) {
      const event = reminder.event!;
      result.considered += 1;
      try {
        const lead = reminder.minutesBefore * 60_000;
        // Occurrences whose reminder moment falls between the lookback and now.
        const occurrences = event.recurrenceRule
          ? expandRecurrence(event, parseRecurrence(event.recurrenceRule), { from: new Date(window.earliest.getTime() + lead - START_GRACE_MS), to: new Date(window.now.getTime() + lead + 1) }, 50)
          : [{ startsAt: event.startsAt, endsAt: event.endsAt ?? event.startsAt }];

        for (const occurrence of occurrences) {
          const dueAt = new Date(occurrence.startsAt.getTime() - lead);
          if (!isDue(occurrence, dueAt, window)) continue;
          if (delivered.has(deliveryKey(reminder.id, occurrence.startsAt))) {
            result.skipped += 1;
            continue;
          }
          const sent = await fire(companyId, reminder.id, occurrence, dueAt, {
            companyId,
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
          if (sent) {
            result.fired += 1;
            incrementCounter(Metric.CALENDAR_REMINDER_SENT);
          } else {
            result.skipped += 1;
          }
        }
      } catch (error) {
        failed += 1;
        result.failed += 1;
        incrementCounter(Metric.CALENDAR_REMINDER_FAILURE);
        logger.error("calendar.reminders.item_failed", { companyId, reminderId: reminder.id, eventId: event.id, ...serialiseError(error) });
      }
    }
  });
  if (failed > 0) throw new JobError("PARTIAL_FAILURE", `${failed} calendar event reminders could not be sent`);
}

/**
 * Event reminders that can be due at `window.now`, oldest id first.
 *
 * Raw SQL for the one condition Prisma cannot write — start minus lead — and
 * every instant through `sqlTimestamp`, because the columns hold UTC without a
 * zone and the database session may not (PRD #51 §159).
 */
async function dueEventReminderIds(companyId: string, window: Window, after: string, limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT r."id"
    FROM "calendar_reminders" r
    JOIN "calendar_events" e ON e."id" = r."eventId"
    JOIN "company_members" m ON m."id" = r."memberId"
    WHERE r."companyId" = ${companyId}
      AND e."companyId" = ${companyId}
      AND r."id" > ${after}
      AND e."archivedAt" IS NULL
      AND m."status" = 'ACTIVE'
      AND (
        (
          e."recurrenceRule" IS NULL
          AND e."startsAt" >= ${sqlTimestamp(window.graceStart)}
          AND e."startsAt" - r."minutesBefore" * interval '1 minute' BETWEEN ${sqlTimestamp(window.earliest)} AND ${sqlTimestamp(window.now)}
          AND NOT EXISTS (
            SELECT 1 FROM "calendar_reminder_deliveries" d
            WHERE d."reminderId" = r."id" AND d."occurrenceStartsAt" = e."startsAt"
          )
        )
        OR (
          e."recurrenceRule" IS NOT NULL
          AND e."startsAt" - r."minutesBefore" * interval '1 minute' <= ${sqlTimestamp(window.now)}
          AND (e."recurrenceEndsAt" IS NULL OR e."recurrenceEndsAt" >= ${sqlTimestamp(window.graceStart)})
        )
      )
    ORDER BY r."id"
    LIMIT ${limit}`;
  return rows.map((row) => row.id);
}

/**
 * Occurrences of these recurring reminders already delivered, so a run does
 * not open a transaction per minute per reminder only to find its row there.
 * The unique key, not this read, is what keeps a reminder to one delivery.
 */
async function deliveredOccurrences(companyId: string, reminderIds: string[], window: Window): Promise<Set<string>> {
  if (reminderIds.length === 0) return new Set();
  const rows = await prisma.calendarReminderDelivery.findMany({
    where: { companyId, reminderId: { in: reminderIds }, occurrenceStartsAt: { gte: window.graceStart } },
    select: { reminderId: true, occurrenceStartsAt: true },
  });
  return new Set(rows.map((row) => deliveryKey(row.reminderId, row.occurrenceStartsAt)));
}

/* -------------------------------------------------------------------------- */
/* Meetings                                                                    */
/* -------------------------------------------------------------------------- */

async function fireMeetingReminders(companyId: string, window: Window, batchSize: number, result: ReminderRunResult): Promise<void> {
  let failed = 0;
  await inBatches(batchSize, (after, limit) => dueMeetingReminderIds(companyId, window, after, limit), async (ids) => {
    const reminders = await prisma.calendarReminder.findMany({
      where: { id: { in: ids }, companyId, meetingId: { not: null } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        memberId: true,
        minutesBefore: true,
        meeting: { select: { id: true, projectId: true, startsAt: true, endsAt: true, timezone: true, status: true, archivedAt: true } },
      },
    });

    for (const reminder of reminders) {
      const meeting = reminder.meeting!;
      result.considered += 1;
      try {
        const dueAt = new Date(meeting.startsAt.getTime() - reminder.minutesBefore * 60_000);
        // Moved, cancelled or archived since the query above.
        if (meeting.status !== "SCHEDULED" || meeting.archivedAt || !isDue(meeting, dueAt, window)) continue;
        const sent = await fire(companyId, reminder.id, meeting, dueAt, {
          companyId,
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
        if (sent) {
          result.fired += 1;
          incrementCounter(Metric.CALENDAR_REMINDER_SENT, { kind: "meeting" });
        } else {
          result.skipped += 1;
        }
      } catch (error) {
        failed += 1;
        result.failed += 1;
        incrementCounter(Metric.CALENDAR_REMINDER_FAILURE, { kind: "meeting" });
        logger.error("calendar.reminders.item_failed", { companyId, reminderId: reminder.id, meetingId: meeting.id, ...serialiseError(error) });
      }
    }
  });
  if (failed > 0) throw new JobError("PARTIAL_FAILURE", `${failed} meeting reminders could not be sent`);
}

/** Meeting reminders due at `window.now` and not yet delivered, oldest id first. */
async function dueMeetingReminderIds(companyId: string, window: Window, after: string, limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT r."id"
    FROM "calendar_reminders" r
    JOIN "meetings" mt ON mt."id" = r."meetingId"
    JOIN "company_members" m ON m."id" = r."memberId"
    WHERE r."companyId" = ${companyId}
      AND mt."companyId" = ${companyId}
      AND r."id" > ${after}
      AND mt."archivedAt" IS NULL
      AND mt."status" = 'SCHEDULED'
      AND m."status" = 'ACTIVE'
      AND mt."startsAt" >= ${sqlTimestamp(window.graceStart)}
      AND mt."startsAt" - r."minutesBefore" * interval '1 minute' BETWEEN ${sqlTimestamp(window.earliest)} AND ${sqlTimestamp(window.now)}
      AND NOT EXISTS (
        SELECT 1 FROM "calendar_reminder_deliveries" d
        WHERE d."reminderId" = r."id" AND d."occurrenceStartsAt" = mt."startsAt"
      )
    ORDER BY r."id"
    LIMIT ${limit}`;
  return rows.map((row) => row.id);
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Pages ids by a stable cursor until none are left or the run must stop. The
 * cursor, not the condition, moves the walk on: a reminder that failed is
 * still due, and without it the same failures would be read again first.
 */
async function inBatches(batchSize: number, page: (after: string, limit: number) => Promise<string[]>, handle: (ids: string[]) => Promise<void>): Promise<void> {
  let after = "";
  while (!jobStopRequested()) {
    const ids = await page(after, batchSize);
    if (ids.length > 0) await handle(ids);
    if (ids.length < batchSize) return;
    after = ids.at(-1)!;
  }
}

function isDue(occurrence: { startsAt: Date }, dueAt: Date, window: Window): boolean {
  return dueAt <= window.now && dueAt >= window.earliest && occurrence.startsAt >= window.graceStart;
}

function deliveryKey(reminderId: string, occurrenceStartsAt: Date): string {
  return `${reminderId}:${occurrenceStartsAt.toISOString()}`;
}

/**
 * Claims one occurrence and enqueues its notification, together or not at
 * all. Returns false when the delivery row was already there — another run
 * sent it — so the caller counts only what this run sent (PRD #51 §18).
 */
async function fire(
  companyId: string,
  reminderId: string,
  occurrence: Occurrence,
  dueAt: Date,
  notification: Parameters<typeof enqueueNotificationEvent>[1],
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.calendarReminderDelivery.createMany({
      data: [{ companyId, reminderId, occurrenceStartsAt: occurrence.startsAt, dueAt }],
      skipDuplicates: true,
    });
    if (claimed.count === 0) return false;
    await enqueueNotificationEvent(tx, notification);
    return true;
  });
}
