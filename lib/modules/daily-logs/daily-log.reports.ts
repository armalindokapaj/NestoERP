import type { z } from "zod";

import { AccessError, assertModule } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { claimIdempotencyKey, idempotencyKeyClaimed } from "@/lib/core/jobs/job.idempotency";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { dailyLogsOpen, MODULE, projectDoor, readableDailyLogWhere } from "./daily-log.permissions";
import type { reportQuerySchema } from "./daily-log.schema";
import { projectRules, resolveDailyLogSettings } from "./daily-log.settings";
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

const JOB = "dailylogs.missing";
/** Projects read at a time; a company with more is walked by cursor, never cut off (PRD #51 §133-§138). */
const PROJECT_BATCH = 100;

/**
 * Hands the company's missing logs to `visit` a page of projects at a time, in
 * id order, until every project has been seen or `visit` returns false.
 *
 * The company's settings are resolved once and each project's own rules laid
 * over them in memory, and each page asks for its logs in one query — not a
 * settings upsert and a count per project every hour (PRD #51 §139).
 */
async function eachMissingPage(companyId: string, now: Date, visit: (missing: MissingLog[]) => Promise<boolean>): Promise<void> {
  const company = await resolveDailyLogSettings(companyId);
  const today = localDate(now, company.timezone);
  // Null follows the company: when it requires logs, only a project that opted out is left out.
  const required = company.logsRequired ? { NOT: { dailyLogSettings: { is: { logsRequired: false } } } } : { dailyLogSettings: { is: { logsRequired: true } } };
  for (let after: string | undefined; ; ) {
    const projects = await prisma.project.findMany({
      where: { companyId, status: "ACTIVE", archivedAt: null, ...required, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: PROJECT_BATCH,
      select: { id: true, name: true, startDate: true, endDate: true, projectManagerMemberId: true, dailyLogSettings: { select: { logsRequired: true, workingDays: true } } },
    });
    const due = projects.flatMap((project) => {
      const rules = projectRules(company, project.dailyLogSettings);
      const day = rules.logsRequired ? previousWorkingDay(today, rules.workingDays) : null;
      if (!day) return [];
      if (project.startDate && dateOf(project.startDate) > day) return [];
      if (project.endDate && dateOf(project.endDate) < day) return [];
      return [{ project, day }];
    });
    const logged = due.length
      ? await prisma.dailyLog.findMany({
          where: { companyId, projectId: { in: due.map((entry) => entry.project.id) }, workDate: { in: [...new Set(due.map((entry) => entry.day))].map(businessInstant) }, status: { not: "VOID" } },
          select: { projectId: true, workDate: true },
        })
      : [];
    const have = new Set(logged.map((row) => `${row.projectId}:${dateOf(row.workDate)}`));
    const missing = due
      .filter((entry) => !have.has(`${entry.project.id}:${entry.day}`))
      .map((entry): MissingLog => ({ companyId, projectId: entry.project.id, projectName: entry.project.name, date: entry.day, projectManagerMemberId: entry.project.projectManagerMemberId }));
    if (!(await visit(missing)) || projects.length < PROJECT_BATCH) return;
    after = projects[projects.length - 1]!.id;
  }
}

/** Active projects that require logs and have none for their last working day (§103-§107, §249, §250). */
export async function missingYesterday(companyId: string, now: Date): Promise<MissingLog[]> {
  const result: MissingLog[] = [];
  await eachMissingPage(companyId, now, async (missing) => {
    result.push(...missing);
    return true;
  });
  return result;
}

/**
 * Sends one reminder unless this project was already reminded about this work
 * date, and says whether it went.
 *
 * The ledger row is claimed in the transaction that enqueues the event, so two
 * runs at once, or a run after retention has purged the first event from the
 * outbox, still send it once (PRD #51 §15-§19). A reminder with nobody to tell
 * claims nothing: a manager named before the next run still hears.
 */
async function sendMissingLogReminder(missing: MissingLog): Promise<boolean> {
  const claim = { companyId: missing.companyId, jobKey: JOB, key: `${missing.projectId}:${missing.date}` };
  if (await idempotencyKeyClaimed(prisma, claim)) return false;
  const members = await prisma.projectMember.findMany({ where: { companyId: missing.companyId, projectId: missing.projectId, status: "ACTIVE" }, select: { companyMemberId: true } });
  const memberIds = [...new Set([...(missing.projectManagerMemberId ? [missing.projectManagerMemberId] : []), ...members.map((row) => row.companyMemberId)])];
  if (!memberIds.length) return false;
  return prisma.$transaction(async (tx) => {
    if (!(await claimIdempotencyKey(tx, claim))) return false;
    await enqueueNotificationEvent(tx, {
      companyId: missing.companyId, eventType: NotificationEvent.DAILY_LOG_MISSING_REMINDER, moduleKey: MODULE, entityType: "project", entityId: missing.projectId, actorMemberId: null, projectId: missing.projectId,
      payload: { memberIds, projectName: missing.projectName, workDate: missing.date, dateLabel: dateLabel(missing.date) },
    });
    return true;
  });
}

/**
 * Reminds each required project's people once about a missing log (job
 * `dailylogs.missing`, §107, §110). Nothing is written to the project or its
 * logs: a missing log is only told about, never made up (PRD #51 §90).
 *
 * Every project in the company is reached, and one that fails is logged by id
 * and stepped over; the company's run then fails, after every other project
 * has been reminded (PRD #51 §30-§36, §133-§138).
 */
export async function remindMissingDailyLogs(now = new Date()): Promise<{ reminded: number }> {
  let reminded = 0;
  const companyRun = await forEachCompany(JOB, async ({ companyId }) => {
    let failed = 0;
    await eachMissingPage(companyId, now, async (missing) => {
      for (const entry of missing) {
        try {
          if (await sendMissingLogReminder(entry)) reminded += 1;
        } catch (error) {
          failed += 1;
          logger.error(`${JOB}.item_failed`, { companyId, projectId: entry.projectId, workDate: entry.date, ...serialiseError(error) });
        }
      }
      return !jobStopRequested();
    });
    if (failed) throw new JobError("PARTIAL_FAILURE", `${failed} missing daily log reminders could not be sent`);
  }, { moduleKey: MODULE });
  if (reminded) incrementCounter(Metric.DAILY_LOG_MISSING, {}, reminded);
  assertEveryCompanySucceeded(JOB, companyRun);
  return { reminded };
}
