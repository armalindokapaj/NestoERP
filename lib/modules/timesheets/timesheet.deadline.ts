import { can } from "@/lib/access/can";
import { buildMemberContexts } from "@/lib/context/member-context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { claimIdempotencyKey, idempotencyKeyClaimed } from "@/lib/core/jobs/job.idempotency";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { instantFromLocal, localDate } from "@/lib/modules/calendar/calendar.time";
import type { CalendarEventDTO, CalendarProvider } from "@/lib/modules/calendar/calendar.types";
import { onBusinessDate } from "@/lib/modules/calendar/providers/provider.helpers";
import { MODULE, timesheetsOpen } from "./timesheet.permissions";
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
const JOB = "timesheets.reminders";

type ReminderTotals = { companies: number; reminded: number };

/**
 * Reminds members whose week is coming due, or just went past due, once per
 * week each (§105, §215, §216). A member with nothing logged gets their empty
 * week created so the reminder, and the missing-submission attention after
 * it, point at something they can open.
 *
 * One company at a time, only active ones with timesheets switched on (PRD #51
 * §10, §26, §145): a company whose settings or members cannot be read is
 * logged and reported, and the companies after it are still reminded.
 */
export async function runTimesheetReminders(now = new Date()): Promise<ReminderTotals> {
  const totals: ReminderTotals = { companies: 0, reminded: 0 };
  const run = await forEachCompany(JOB, (system) => remindCompany(system.companyId, now, totals), { moduleKey: MODULE });
  if (totals.reminded > 0) incrementCounter(Metric.TIMESHEET_MISSING, { kind: "reminder" }, totals.reminded);
  assertEveryCompanySucceeded(JOB, run);
  return totals;
}

async function remindCompany(companyId: string, now: Date, totals: ReminderTotals): Promise<void> {
  // Most companies set no deadline, and then there is nothing to create or remind (§257).
  const configured = await prisma.timesheetSettings.findUnique({ where: { companyId }, select: { submitDay: true, submitTime: true } });
  if (!configured?.submitDay || !configured.submitTime) return;
  totals.companies += 1;

  const settings = await resolveTimesheetSettings(companyId);
  const current = weekStartOf(localDate(now, settings.timezone), settings.weekStartsOn);
  const due = [addLocalDays(current, -7), current].find((week) => {
    const deadline = submissionDeadline(week, settings);
    if (!deadline) return false;
    const until = deadline.instant.getTime() - now.getTime();
    return until <= REMIND_BEFORE_MS && -until <= REMIND_AFTER_MS;
  });
  if (!due) return;
  const reminder = { due, weekLabel: weekLabel(due), deadlineLabel: submissionDeadline(due, settings)!.label };

  // Every active member, a page at a time by id: a large company is never cut off at a fixed count (PRD #51 §133-§138).
  let failed = 0;
  let cursor: string | null = null;
  for (;;) {
    if (jobStopRequested()) return;
    const page: Array<{ id: string }> = await prisma.companyMember.findMany({ where: { companyId, status: "ACTIVE", ...(cursor ? { id: { gt: cursor } } : {}) }, select: { id: true }, orderBy: { id: "asc" }, take: MEMBER_BATCH });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    let weeks: Array<{ id: string; memberId: string }> = [];
    try {
      weeks = await openWeeks(companyId, due, page.map((member) => member.id));
    } catch (error) {
      failed += 1;
      logger.error(`${JOB}.item_failed`, { companyId, fromMemberId: page[0].id, toMemberId: cursor, ...serialiseError(error) });
    }
    for (const week of weeks) {
      if (jobStopRequested()) return;
      try {
        if (await remindWeek(companyId, week, reminder)) totals.reminded += 1;
      } catch (error) {
        failed += 1;
        logger.error(`${JOB}.item_failed`, { companyId, memberId: week.memberId, timesheetId: week.id, ...serialiseError(error) });
      }
    }
    if (page.length < MEMBER_BATCH) break;
  }
  if (failed) throw new JobError("PARTIAL_FAILURE", `${failed} timesheet reminders could not be sent`);
}

/**
 * The not-yet-submitted weeks of the members on one page who keep a
 * timesheet, created as empty drafts where they do not exist yet.
 *
 * Creating an empty week is not audited, although a person's first entry
 * audits TIMESHEET_CREATED: that policy is optional, the week holds nothing
 * anybody did, and an entry per member per week would bury the log (PRD #51
 * §149). The unique week per member makes the create safe to repeat.
 */
async function openWeeks(companyId: string, due: string, memberIds: string[]): Promise<Array<{ id: string; memberId: string }>> {
  const contexts = await buildMemberContexts(companyId, memberIds);
  const eligible = [...contexts].filter(([, context]) => timesheetsOpen(context) && can(context, "timesheet.submit_own")).map(([memberId]) => memberId);
  if (eligible.length === 0) return [];
  const periodStart = businessInstant(due);
  await prisma.timesheet.createMany({
    data: eligible.map((memberId) => ({ companyId, memberId, periodStart, periodEnd: businessInstant(addLocalDays(due, 6)) })),
    skipDuplicates: true,
  });
  const weeks = await prisma.timesheet.findMany({ where: { companyId, periodStart, memberId: { in: eligible } }, select: { id: true, memberId: true, status: true }, orderBy: { memberId: "asc" } });
  return weeks.filter((week) => !DONE.has(week.status));
}

/**
 * One reminder per member per week, however often the job runs and however
 * many run at once (§216, PRD #51 §17, §88): the member and week are claimed
 * in the idempotency ledger in the transaction that enqueues the reminder.
 */
async function remindWeek(companyId: string, week: { id: string; memberId: string }, reminder: { due: string; weekLabel: string; deadlineLabel: string }): Promise<boolean> {
  const claim = { companyId, jobKey: JOB, key: `${week.memberId}:${reminder.due}` };
  // Every run inside the window after the first finds its reminders already sent: a key read, not a transaction each.
  if (await idempotencyKeyClaimed(prisma, claim)) return false;
  return prisma.$transaction(async (tx) => {
    if (!(await claimIdempotencyKey(tx, claim))) return false;
    await enqueueNotificationEvent(tx, {
      companyId,
      eventType: NotificationEvent.TIMESHEET_REMINDER,
      moduleKey: MODULE,
      entityType: "timesheet",
      entityId: week.id,
      actorMemberId: null,
      payload: { memberId: week.memberId, weekLabel: reminder.weekLabel, deadlineLabel: reminder.deadlineLabel, periodStart: reminder.due },
    });
    return true;
  });
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
