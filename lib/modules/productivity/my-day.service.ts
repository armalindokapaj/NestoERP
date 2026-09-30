import { inGroupWorkspace } from "@/config/workspace";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { logger } from "@/lib/core/observability/logger";
import { addLocalDays, localDate, startOfLocalDay } from "@/lib/core/time/zoned-time";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { listApprovalsForWorkspace } from "@/lib/modules/approvals/approvals.group";
import type { UnifiedApprovalItem } from "@/lib/modules/approvals/approvals.types";
import { getCalendar } from "@/lib/modules/calendar/calendar.query";
import { calendarSettings } from "@/lib/modules/calendar/calendar.service";
import type { CalendarEventDTO } from "@/lib/modules/calendar/calendar.types";
import { parseTaskListQuery } from "@/lib/modules/tasks/task.query";
import { listTasksForWorkspace } from "@/lib/modules/tasks/task.workspace";
import type { TaskSummaryDTO } from "@/lib/modules/tasks/task.types";

/**
 * My Day (MOB-06 §6-§11, §77, §78): one authorised read that answers "what
 * needs me now". It is presentation over the canonical Tasks, Approvals and
 * Calendar services and owns no records and no urgency score: the attention
 * order is fixed (overdue, due today, approvals, next event), and every
 * section is read through the owning module's own scope, so this aggregate can
 * show nothing the modules would not show the same person.
 *
 * Sections fail independently (§75): a Calendar outage leaves Tasks on screen,
 * and a failed section is reported as failed, never as "nothing waiting".
 */

export type MyDaySection<T> = { status: "ok"; data: T } | { status: "unavailable" } | { status: "error" };

export type MyDayTasks = {
  overdue: TaskSummaryDTO[];
  dueToday: TaskSummaryDTO[];
  upcoming: TaskSummaryDTO[];
  counts: { overdue: number; dueToday: number; upcoming: number };
};

export type MyDayApprovals = { items: UnifiedApprovalItem[]; waiting: number; overdue: number; partial: boolean };

export type MyDayEvents = { today: CalendarEventDTO[]; tomorrow: CalendarEventDTO[] };

export type MyDayAttentionKind = "tasks_overdue" | "tasks_due_today" | "approvals_waiting" | "next_event";

export type MyDayAttention = { kind: MyDayAttentionKind; count: number; href: string; event?: CalendarEventDTO };

export type MyDayDTO = {
  /** The local date in the company's zone, `YYYY-MM-DD`. */
  date: string;
  timezone: string;
  /** In the Group workspace events are not read: they belong to one company (Workspace Context §39). */
  group: boolean;
  tasks: MySection<MyDayTasks>;
  approvals: MySection<MyDayApprovals>;
  events: MySection<MyDayEvents>;
  counters: { tasksDueToday: number; tasksOverdue: number; approvalsWaiting: number; meetingsToday: number };
  attention: MyDayAttention[];
  generatedAt: string;
};
type MySection<T> = MyDaySection<T>;

const LIST = 8;

async function section<T>(name: string, read: () => Promise<T>): Promise<MyDaySection<T>> {
  try {
    return { status: "ok", data: await read() };
  } catch (error) {
    // A module the person may not use is simply not part of their day.
    if (error instanceof AccessError && (error.code === "FORBIDDEN" || error.code === "MODULE_UNAVAILABLE" || error.code === "NOT_FOUND")) return { status: "unavailable" };
    logger.warn("my-day.section.failed", { section: name, message: error instanceof Error ? error.message : "unknown" });
    return { status: "error" };
  }
}

async function readTasks(session: UserContext): Promise<MyDayTasks> {
  const base = { mine: true, openOnly: true, limit: LIST, sort: "due-asc" as const };
  const [overdue, today, upcoming] = await Promise.all(
    (["overdue", "today", "next7"] as const).map((due) => listTasksForWorkspace(session, parseTaskListQuery({}, { ...base, due }))),
  );
  // "Next 7 days" includes today; today's own tasks already have their list.
  const todayIds = new Set(today.data.map((task) => task.id));
  const later = upcoming.data.filter((task) => !todayIds.has(task.id));
  return {
    overdue: overdue.data,
    dueToday: today.data,
    upcoming: later,
    counts: {
      overdue: overdue.pagination.total,
      dueToday: today.pagination.total,
      upcoming: Math.max(0, upcoming.pagination.total - today.pagination.total),
    },
  };
}

async function readApprovals(session: UserContext): Promise<MyDayApprovals> {
  const result = await listApprovalsForWorkspace(session, approvalQuerySchema.parse({ tab: "waiting", limit: LIST }));
  return { items: result.items, waiting: result.counts.waiting, overdue: result.counts.overdue, partial: result.counts.partial };
}

async function readEvents(session: UserContext, timezone: string, date: string): Promise<MyDayEvents> {
  const from = startOfLocalDay(date, timezone);
  const tomorrowStart = startOfLocalDay(addLocalDays(date, 1), timezone);
  const to = startOfLocalDay(addLocalDays(date, 2), timezone);
  const response = await getCalendar(session, { from, to }, { myOnly: true, includeAllDay: true });
  const events = [...response.events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const today: CalendarEventDTO[] = [];
  const tomorrow: CalendarEventDTO[] = [];
  for (const event of events) {
    const start = new Date(event.startsAt);
    if (start < tomorrowStart) today.push(event);
    else tomorrow.push(event);
  }
  return { today, tomorrow };
}

export async function getMyDay(session: UserContext, now: Date = new Date()): Promise<MyDayDTO> {
  const group = inGroupWorkspace(session);
  const settings = await calendarSettings(session.companyId);
  const date = localDate(now, settings.timezone);

  const [tasks, approvals, events] = await Promise.all([
    section("tasks", () => readTasks(session)),
    section("approvals", () => readApprovals(session)),
    group ? Promise.resolve<MyDaySection<MyDayEvents>>({ status: "unavailable" }) : section("events", () => readEvents(session, settings.timezone, date)),
  ]);

  const counters = {
    tasksDueToday: tasks.status === "ok" ? tasks.data.counts.dueToday : 0,
    tasksOverdue: tasks.status === "ok" ? tasks.data.counts.overdue : 0,
    approvalsWaiting: approvals.status === "ok" ? approvals.data.waiting : 0,
    meetingsToday: events.status === "ok" ? events.data.today.length : 0,
  };

  // The fixed order of §11: overdue work, work due today, approvals, then the next scheduled thing.
  const attention: MyDayAttention[] = [];
  if (counters.tasksOverdue > 0) attention.push({ kind: "tasks_overdue", count: counters.tasksOverdue, href: "/tasks/my-tasks?due=overdue" });
  if (counters.tasksDueToday > 0) attention.push({ kind: "tasks_due_today", count: counters.tasksDueToday, href: "/tasks/my-tasks?due=today" });
  if (counters.approvalsWaiting > 0) attention.push({ kind: "approvals_waiting", count: counters.approvalsWaiting, href: "/approvals" });
  if (events.status === "ok") {
    const upcoming = events.data.today.find((event) => !event.allDay && new Date(event.startsAt) >= now);
    if (upcoming) attention.push({ kind: "next_event", count: 1, href: upcoming.href, event: upcoming });
  }

  return { date, timezone: settings.timezone, group, tasks, approvals, events, counters, attention, generatedAt: now.toISOString() };
}
