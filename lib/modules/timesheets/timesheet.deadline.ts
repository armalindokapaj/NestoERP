import { can } from "@/lib/access/can";
import { buildMemberContexts } from "@/lib/context/member-context";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { instantFromLocal, localDate } from "@/lib/modules/calendar/calendar.time";
import type { CalendarEventDTO, CalendarProvider } from "@/lib/modules/calendar/calendar.types";
import { onBusinessDate } from "@/lib/modules/calendar/providers/provider.helpers";
import { timesheetsOpen } from "./timesheet.permissions";
import { resolveTimesheetSettings } from "./timesheet.settings";
import { addLocalDays, businessInstant, dateOf, dayLabel, isoWeekday, weekLabel, weekStartOf } from "./timesheet.time";
import type { TimesheetSettingsDTO } from "./timesheet.types";

/**
 * The submission deadline, and what hangs off it (PRD #42 §100-§105, §213-§216).
 *
 * A deadline exists only when the company sets one — a weekday and a local
 * time. A week is due on the first such weekday from its fifth day on, so
 * "Friday 17:00" means the Friday of the week itself and "Monday 12:00" the
 * Monday after it. Without a deadline there is nothing to remind anybody
 * about, nothing missing and nothing on the calendar (§257).
 */

const WEEKDAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** Reminders start this long before the deadline… */
const REMIND_BEFORE_MS = 24 * 3_600_000;
/** …and a week this far past it is left to Attention alone. */
const REMIND_AFTER_MS = 3 * 86_400_000;
const MEMBER_BATCH = 200;
const MEMBER_LIMIT = 5_000;

export type SubmissionDeadline = { date: string; time: string; instant: Date; label: string };

export function submissionDeadline(periodStart: string, settings: Pick<TimesheetSettingsDTO, "submitDay" | "submitTime" | "timezone">): SubmissionDeadline | null {
  if (!settings.submitDay || !settings.submitTime) return null;
  let date = addLocalDays(periodStart, 4);
  while (isoWeekday(date) !== settings.submitDay) date = addLocalDays(date, 1);
  const instant = instantFromLocal(date, settings.submitTime, settings.timezone);
  const day = dayLabel(date);
  return { date, time: settings.submitTime, instant, label: `${day.weekday} ${day.day}, ${settings.submitTime}` };
}

export function deadlineDescription(settings: Pick<TimesheetSettingsDTO, "submitDay" | "submitTime">): string | null {
  if (!settings.submitDay || !settings.submitTime) return null;
  return `${WEEKDAY_NAMES[settings.submitDay]} ${settings.submitTime}`;
}

/** The latest week whose deadline has passed, or null when the company has none (§213). */
export function lastDueWeek(now: Date, settings: TimesheetSettingsDTO): string | null {
  if (!settings.submitDay || !settings.submitTime) return null;
  let week = weekStartOf(localDate(now, settings.timezone), settings.weekStartsOn);
  for (let guard = 0; guard < 3; guard += 1) {
    const deadline = submissionDeadline(week, settings);
    if (deadline && deadline.instant.getTime() <= now.getTime()) return week;
    week = addLocalDays(week, -7);
  }
  return null;
}

const DONE = new Set(["SUBMITTED", "APPROVED", "CANCELLED"]);

/**
 * Reminds members whose week is coming due, or just went past due, once per
 * week each (§105, §215, §216). A member with nothing logged gets their empty
 * week created so the reminder, and the missing-submission attention after
 * it, point at something they can open.
 */
export async function runTimesheetReminders(now = new Date()): Promise<{ companies: number; reminded: number }> {
  const configured = await prisma.timesheetSettings.findMany({
    where: { submitDay: { not: null }, submitTime: { not: null }, company: { status: "ACTIVE" } },
    select: { companyId: true },
  });
  let reminded = 0;
  for (const { companyId } of configured) {
    const settings = await resolveTimesheetSettings(companyId);
    const current = weekStartOf(localDate(now, settings.timezone), settings.weekStartsOn);
    const due = [addLocalDays(current, -7), current].find((week) => {
      const deadline = submissionDeadline(week, settings);
      if (!deadline) return false;
      const until = deadline.instant.getTime() - now.getTime();
      return until <= REMIND_BEFORE_MS && -until <= REMIND_AFTER_MS;
    });
    if (!due) continue;
    const deadline = submissionDeadline(due, settings)!;
    const periodStart = businessInstant(due);

    const members = await prisma.companyMember.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true }, orderBy: { id: "asc" }, take: MEMBER_LIMIT });
    const eligible: string[] = [];
    for (let index = 0; index < members.length; index += MEMBER_BATCH) {
      const contexts = await buildMemberContexts(companyId, members.slice(index, index + MEMBER_BATCH).map((row) => row.id));
      for (const [memberId, context] of contexts) if (timesheetsOpen(context) && can(context, "timesheet.submit_own")) eligible.push(memberId);
    }
    if (eligible.length === 0) continue;

    await prisma.timesheet.createMany({
      data: eligible.map((memberId) => ({ companyId, memberId, periodStart, periodEnd: businessInstant(addLocalDays(due, 6)) })),
      skipDuplicates: true,
    });
    const weeks = await prisma.timesheet.findMany({ where: { companyId, periodStart, memberId: { in: eligible } }, select: { id: true, memberId: true, status: true } });
    const open = weeks.filter((week) => !DONE.has(week.status));
    const already = new Set(
      (
        await prisma.notificationEventOutbox.findMany({
          where: { eventType: NotificationEvent.TIMESHEET_REMINDER, entityType: "timesheet", entityId: { in: open.map((week) => week.id) } },
          select: { entityId: true },
        })
      ).map((row) => row.entityId),
    );
    const label = weekLabel(due);
    for (const week of open) {
      if (already.has(week.id)) continue;
      await prisma.$transaction((tx) =>
        enqueueNotificationEvent(tx, {
          companyId,
          eventType: NotificationEvent.TIMESHEET_REMINDER,
          moduleKey: "timesheets",
          entityType: "timesheet",
          entityId: week.id,
          actorMemberId: null,
          payload: { memberId: week.memberId, weekLabel: label, deadlineLabel: deadline.label, periodStart: due },
        }),
      );
      reminded += 1;
    }
  }
  if (reminded > 0) incrementCounter(Metric.TIMESHEET_MISSING, { kind: "reminder" }, reminded);
  return { companies: configured.length, reminded };
}

/**
 * The member's own submission deadlines on their calendar (§100-§102): only
 * when the company has one, only their own weeks, and never the entries.
 */
export const timesheetDeadlineCalendarProvider: CalendarProvider = {
  key: "timesheets",
  moduleKey: "timesheets",
  categories: ["PERSONAL"],
  capabilities: { draggable: false, resizable: false, quickEdit: false },
  enabled: (context) => timesheetsOpen(context) && can(context, "timesheet.submit_own"),
  async getEvents(input) {
    const { context, range, filters } = input;
    if (filters.categories?.length && !filters.categories.includes("PERSONAL")) return [];
    if (filters.memberIds?.length && !filters.memberIds.includes(context.membershipId)) return [];
    const settings = await resolveTimesheetSettings(context.companyId);
    if (!settings.submitDay || !settings.submitTime) return [];

    // Deadlines can fall in the week after the one they close: start a week early.
    const first = addLocalDays(weekStartOf(localDate(range.from, settings.timezone), settings.weekStartsOn), -7);
    const last = localDate(range.to, settings.timezone);
    const periods: Array<{ week: string; deadline: SubmissionDeadline }> = [];
    for (let week = first; week <= last && periods.length < 20; week = addLocalDays(week, 7)) {
      const deadline = submissionDeadline(week, settings);
      if (deadline) periods.push({ week, deadline });
    }
    if (periods.length === 0) return [];
    const rows = await prisma.timesheet.findMany({
      where: { companyId: context.companyId, memberId: context.membershipId, periodStart: { in: periods.map((period) => businessInstant(period.week)) } },
      select: { id: true, periodStart: true, status: true },
    });
    const byWeek = new Map(rows.map((row) => [dateOf(row.periodStart), row]));
    const events: CalendarEventDTO[] = [];
    for (const { week, deadline } of periods) {
      const row = byWeek.get(week);
      const done = row ? DONE.has(row.status) : false;
      const overdue = !done && deadline.instant.getTime() < Date.now();
      const event = onBusinessDate(input, businessInstant(deadline.date), {
        id: `timesheets:deadline:${week}`,
        sourceType: "timesheet",
        sourceId: row?.id ?? `week:${week}`,
        providerKey: "timesheets",
        title: `Timesheet due ${deadline.time}`,
        subtitle: weekLabel(week),
        category: "PERSONAL",
        status: done ? "SUBMITTED" : overdue ? "OVERDUE" : "DUE",
        severity: overdue ? "warning" : undefined,
        href: `/timesheets?week=${week}`,
        metadata: { sourceLabel: "Timesheet", moduleKey: "timesheets" },
      });
      if (event) events.push(event);
    }
    return events;
  },
};
