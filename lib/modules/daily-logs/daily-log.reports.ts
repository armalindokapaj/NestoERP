import type { z } from "zod";

import { AccessError, assertModule } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { dailyLogsOpen, MODULE, projectDoor, readableDailyLogWhere } from "./daily-log.permissions";
import type { reportQuerySchema } from "./daily-log.schema";
import { resolveDailyLogSettings } from "./daily-log.settings";
import { addLocalDays, businessInstant, dateLabel, dateOf, isoWeekday, localDate, previousWorkingDay } from "./daily-log.time";
import { DELAY_CATEGORIES, type DelayCategory, type DelayImpact } from "./daily-log.types";

/**
 * Site reporting and the missing-log rule (PRD #43 §103-§107, §196-§202,
 * §249, §250).
 *
 * Everything is aggregated in the database over logs this reader can open.
 * Workforce is headcount on site, never attendance; deliveries are what was
 * seen arrive, never stock. A missing log is only counted, flagged or reminded
 * for an active project that requires logs, on its own working days, between
 * its start and its end, and never for today, which is still going.
 */

const RANGE_DEFAULT_DAYS = 30;
const RANGE_MAX_DAYS = 366;
const PROJECT_LIMIT = 200;

export type DailyLogReportDTO = {
  from: string;
  to: string;
  projects: Array<{ id: string; name: string; code: string | null }>;
  projectId: string | null;
  totals: {
    logs: number;
    completed: number;
    missing: number;
    averageWorkforce: number;
    deliveries: number;
    delays: number;
    delayMinutes: number;
    activities: number;
    qaqc: number;
    hse: number;
    photos: number;
  };
  workforceByTrade: Array<{ trade: string; headcount: number }>;
  delaysByCategory: Array<{ category: DelayCategory; count: number; minutes: number }>;
  delaysByImpact: Array<{ impact: DelayImpact | "UNSET"; count: number }>;
  byProject: Array<{ projectId: string; name: string; logs: number; missing: number; delays: number; delayMinutes: number; workforce: number }>;
  missingDays: Array<{ projectId: string; name: string; date: string }>;
};

/** Working days a project needed a log on, in a range (§104-§106, §249, §250). */
export function requiredDays(input: { from: string; to: string; workingDays: readonly number[]; startDate: Date | null; endDate: Date | null }): string[] {
  const start = input.startDate && dateOf(input.startDate) > input.from ? dateOf(input.startDate) : input.from;
  const end = input.endDate && dateOf(input.endDate) < input.to ? dateOf(input.endDate) : input.to;
  const days: string[] = [];
  for (let day = start; day <= end && days.length <= RANGE_MAX_DAYS; day = addLocalDays(day, 1)) {
    if (input.workingDays.includes(isoWeekday(day))) days.push(day);
  }
  return days;
}

async function missingFor(companyId: string, projects: Array<{ id: string; name: string; status: string; startDate: Date | null; endDate: Date | null }>, from: string, to: string) {
  const missing: Array<{ projectId: string; name: string; date: string }> = [];
  for (const project of projects) {
    if (project.status !== "ACTIVE") continue;
    const settings = await resolveDailyLogSettings(companyId, project.id);
    if (!settings.logsRequired) continue;
    const days = requiredDays({ from, to, workingDays: settings.workingDays, startDate: project.startDate, endDate: project.endDate });
    if (!days.length) continue;
    const logged = await prisma.dailyLog.findMany({ where: { companyId, projectId: project.id, status: { not: "VOID" }, workDate: { gte: businessInstant(days[0]), lte: businessInstant(days[days.length - 1]) } }, select: { workDate: true } });
    const have = new Set(logged.map((row) => dateOf(row.workDate)));
    for (const day of days) if (!have.has(day)) missing.push({ projectId: project.id, name: project.name, date: day });
  }
  return missing;
}

export async function dailyLogReport(context: UserContext, query: z.infer<typeof reportQuerySchema>): Promise<DailyLogReportDTO> {
  assertModule(context, MODULE);
  const door = dailyLogsOpen(context) ? projectDoor(context) : null;
  if (!door) throw new AccessError("FORBIDDEN");
  const settings = await resolveDailyLogSettings(context.companyId);
  const today = localDate(new Date(), settings.timezone);
  let to = query.to ?? today;
  let from = query.from ?? addLocalDays(to, -(RANGE_DEFAULT_DAYS - 1));
  if (from > to) [from, to] = [to, from];
  if (to > today) to = today;
  if (from < addLocalDays(to, -RANGE_MAX_DAYS)) from = addLocalDays(to, -RANGE_MAX_DAYS);

  const projects = await prisma.project.findMany({ where: { AND: [door, { archivedAt: null }] }, orderBy: { name: "asc" }, take: PROJECT_LIMIT, select: { id: true, name: true, code: true, status: true, startDate: true, endDate: true } });
  const selected = query.projectId ? projects.filter((project) => project.id === query.projectId) : projects;
  if (query.projectId && selected.length === 0) throw new AccessError("NOT_FOUND", "That project could not be found.", { code: "DAILY_LOG_PROJECT_NOT_FOUND" });
  const projectIds = selected.map((project) => project.id);

  const logWhere = {
    AND: [readableDailyLogWhere(context), { projectId: { in: projectIds }, status: { not: "VOID" as const }, workDate: { gte: businessInstant(from), lte: businessInstant(to) } }],
  };
  const logs = await prisma.dailyLog.findMany({ where: logWhere, select: { id: true, projectId: true, status: true } });
  const ids = logs.map((log) => log.id);
  const inLogs = { dailyLogId: { in: ids } };

  const [workforceByLog, trades, delayByCategory, delayByImpact, delayByLog, deliveries, activities, photos, links] = ids.length
    ? await Promise.all([
        prisma.dailyLogWorkforceEntry.groupBy({ by: ["dailyLogId"], where: inLogs, _sum: { headcount: true } }),
        prisma.dailyLogWorkforceEntry.groupBy({ by: ["trade"], where: inLogs, _sum: { headcount: true } }),
        prisma.dailyLogDelayEntry.groupBy({ by: ["category"], where: inLogs, _count: { _all: true }, _sum: { durationMinutes: true } }),
        prisma.dailyLogDelayEntry.groupBy({ by: ["impact"], where: inLogs, _count: { _all: true } }),
        prisma.dailyLogDelayEntry.groupBy({ by: ["dailyLogId"], where: inLogs, _count: { _all: true }, _sum: { durationMinutes: true } }),
        prisma.dailyLogDeliveryEntry.count({ where: inLogs }),
        prisma.dailyLogWorkActivity.count({ where: inLogs }),
        prisma.dailyLogDocumentLink.count({ where: { ...inLogs, category: "PHOTO" } }),
        prisma.integrationLink.groupBy({ by: ["targetModule"], where: { companyId: context.companyId, integrationType: "DAILY_LOG_RECORD", status: "ACTIVE", sourceEntityId: { in: ids } }, _count: { _all: true } }),
      ])
    : [[], [], [], [], [], 0, 0, 0, []];

  const missingDays = await missingFor(context.companyId, selected, from, addLocalDays(today, -1) < to ? addLocalDays(today, -1) : to);
  const projectOf = new Map(logs.map((log) => [log.id, log.projectId]));
  const byProject = new Map(selected.map((project) => [project.id, { projectId: project.id, name: project.name, logs: 0, missing: 0, delays: 0, delayMinutes: 0, workforce: 0 }]));
  for (const log of logs) byProject.get(log.projectId)!.logs += 1;
  for (const day of missingDays) byProject.get(day.projectId)!.missing += 1;
  let workforceTotal = 0;
  for (const row of workforceByLog) {
    const headcount = row._sum.headcount ?? 0;
    workforceTotal += headcount;
    byProject.get(projectOf.get(row.dailyLogId)!)!.workforce += headcount;
  }
  for (const row of delayByLog) {
    const entry = byProject.get(projectOf.get(row.dailyLogId)!)!;
    entry.delays += row._count._all;
    entry.delayMinutes += row._sum.durationMinutes ?? 0;
  }
  const categoryRows = new Map(delayByCategory.map((row) => [row.category, row]));

  return {
    from,
    to,
    projects: projects.map((project) => ({ id: project.id, name: project.name, code: project.code })),
    projectId: query.projectId ?? null,
    totals: {
      logs: logs.length,
      completed: logs.filter((log) => log.status === "SUBMITTED" || log.status === "REVIEWED" || log.status === "LOCKED").length,
      missing: missingDays.length,
      averageWorkforce: logs.length ? Math.round((workforceTotal / logs.length) * 10) / 10 : 0,
      deliveries,
      delays: delayByCategory.reduce((sum, row) => sum + row._count._all, 0),
      delayMinutes: delayByCategory.reduce((sum, row) => sum + (row._sum.durationMinutes ?? 0), 0),
      activities,
      qaqc: links.find((row) => row.targetModule === "qaqc")?._count._all ?? 0,
      hse: links.find((row) => row.targetModule === "hse")?._count._all ?? 0,
      photos,
    },
    workforceByTrade: trades.map((row) => ({ trade: row.trade ?? "Unspecified", headcount: row._sum.headcount ?? 0 })).sort((a, b) => b.headcount - a.headcount),
    delaysByCategory: DELAY_CATEGORIES.filter((category) => categoryRows.has(category)).map((category) => ({ category, count: categoryRows.get(category)!._count._all, minutes: categoryRows.get(category)!._sum.durationMinutes ?? 0 })).sort((a, b) => b.count - a.count),
    delaysByImpact: delayByImpact.map((row) => ({ impact: row.impact ?? "UNSET", count: row._count._all })),
    byProject: [...byProject.values()].filter((row) => row.logs || row.missing).sort((a, b) => b.logs - a.logs || a.name.localeCompare(b.name)),
    missingDays: missingDays.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100),
  };
}

/* -------------------------------------------------------------------------- */
/* Site today                                                                  */
/* -------------------------------------------------------------------------- */

export type SiteTodayItem = { projectId: string; projectName: string; date: string; logId: string | null; status: string | null; workforce: number; activities: number; delays: number; photos: number; href: string };

/** The latest log on each project this reader can open, for the dashboard (§201, §202). */
export async function siteToday(context: UserContext, limit = 5): Promise<SiteTodayItem[]> {
  const door = dailyLogsOpen(context) ? projectDoor(context) : null;
  if (!door) return [];
  const projects = await prisma.project.findMany({ where: { AND: [door, { archivedAt: null, status: "ACTIVE" }] }, orderBy: { updatedAt: "desc" }, take: limit, select: { id: true, name: true } });
  const items: SiteTodayItem[] = [];
  for (const project of projects) {
    const log = await prisma.dailyLog.findFirst({
      where: { AND: [readableDailyLogWhere(context), { projectId: project.id, status: { not: "VOID" } }] },
      orderBy: { workDate: "desc" },
      select: { id: true, workDate: true, status: true, _count: { select: { workActivities: true, delayEntries: true } } },
    });
    const [workforce, photos] = log
      ? await Promise.all([prisma.dailyLogWorkforceEntry.aggregate({ where: { dailyLogId: log.id }, _sum: { headcount: true } }), prisma.dailyLogDocumentLink.count({ where: { dailyLogId: log.id, category: "PHOTO" } })])
      : [null, 0];
    items.push({
      projectId: project.id,
      projectName: project.name,
      date: log ? dateOf(log.workDate) : "",
      logId: log?.id ?? null,
      status: log?.status ?? null,
      workforce: workforce?._sum.headcount ?? 0,
      activities: log?._count.workActivities ?? 0,
      delays: log?._count.delayEntries ?? 0,
      photos,
      href: log ? `/projects/${project.id}/daily-logs/${log.id}` : `/projects/${project.id}/daily-logs`,
    });
  }
  return items;
}

/* -------------------------------------------------------------------------- */
/* Missing logs                                                                */
/* -------------------------------------------------------------------------- */

export type MissingLog = { companyId: string; projectId: string; projectName: string; date: string; projectManagerMemberId: string | null };

/** Active projects that require logs and have none for their last working day (§103-§107, §249, §250). */
export async function missingYesterday(companyId: string, now: Date): Promise<MissingLog[]> {
  const settings = await resolveDailyLogSettings(companyId);
  const projectRows = await prisma.projectDailyLogSettings.findMany({ where: { companyId, logsRequired: true }, select: { projectId: true } });
  const projects = await prisma.project.findMany({
    where: {
      companyId, status: "ACTIVE", archivedAt: null,
      ...(settings.logsRequired ? { NOT: { dailyLogSettings: { is: { logsRequired: false } } } } : { id: { in: projectRows.map((row) => row.projectId) } }),
    },
    take: 1_000,
    select: { id: true, name: true, startDate: true, endDate: true, projectManagerMemberId: true },
  });
  const today = localDate(now, settings.timezone);
  const result: MissingLog[] = [];
  for (const project of projects) {
    const projectSettings = await resolveDailyLogSettings(companyId, project.id);
    if (!projectSettings.logsRequired) continue;
    const day = previousWorkingDay(today, projectSettings.workingDays);
    if (!day) continue;
    if (project.startDate && dateOf(project.startDate) > day) continue;
    if (project.endDate && dateOf(project.endDate) < day) continue;
    const exists = await prisma.dailyLog.count({ where: { companyId, projectId: project.id, workDate: businessInstant(day), status: { not: "VOID" } } });
    if (!exists) result.push({ companyId, projectId: project.id, projectName: project.name, date: day, projectManagerMemberId: project.projectManagerMemberId });
  }
  return result;
}

/** Reminds each required project's people once about a missing log (job `dailylogs.missing`, §107, §110). */
export async function remindMissingDailyLogs(now = new Date()): Promise<{ reminded: number }> {
  let reminded = 0;
  const companyRun = await forEachCompany("dailylogs.missing", async (system) => {
    const company = { id: system.companyId };
    for (const missing of await missingYesterday(company.id, now)) {
      const already = await prisma.notificationEventOutbox.count({ where: { companyId: company.id, eventType: NotificationEvent.DAILY_LOG_MISSING_REMINDER, entityType: "project", entityId: missing.projectId, payloadJson: { path: ["workDate"], equals: missing.date } } });
      if (already) continue;
      const members = await prisma.projectMember.findMany({ where: { projectId: missing.projectId, status: "ACTIVE" }, select: { companyMemberId: true } });
      const memberIds = [...new Set([...(missing.projectManagerMemberId ? [missing.projectManagerMemberId] : []), ...members.map((row) => row.companyMemberId)])];
      await prisma.$transaction((tx) =>
        enqueueNotificationEvent(tx, {
          companyId: company.id, eventType: NotificationEvent.DAILY_LOG_MISSING_REMINDER, moduleKey: MODULE, entityType: "project", entityId: missing.projectId, actorMemberId: null, projectId: missing.projectId,
          payload: { memberIds, projectName: missing.projectName, workDate: missing.date, dateLabel: dateLabel(missing.date) },
        }),
      );
      reminded += 1;
    }
  }, { moduleKey: MODULE });
  if (reminded) incrementCounter(Metric.DAILY_LOG_MISSING, {}, reminded);
  assertEveryCompanySucceeded("dailylogs.missing", companyRun);
  return { reminded };
}
