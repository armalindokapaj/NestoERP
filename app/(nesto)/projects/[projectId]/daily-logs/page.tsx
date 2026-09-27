import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { DailyLogList } from "@/components/daily-logs/daily-log-list";
import { Pagination } from "@/components/data/pagination";
import { StartLogForm } from "@/components/daily-logs/start-log-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/access/can";
import { listQuerySchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { listDailyLogs } from "@/lib/modules/daily-logs/daily-log.service";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { resolveDailyLogSettings } from "@/lib/modules/daily-logs/daily-log.settings";
import { addLocalDays, localDate } from "@/lib/modules/daily-logs/daily-log.time";
import { DAILY_LOG_STATUSES, DAILY_LOG_STATUS_LABELS } from "@/lib/modules/daily-logs/daily-log.types";
import * as projects from "@/lib/modules/projects/project.service";
import { cn } from "@/lib/utils/cn";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Project daily logs" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/**
 * A project's site diary (PRD #43 §5, §6, §162, §163): today's log first — open
 * it, or start it — then every day, newest first.
 */
export default async function ProjectDailyLogsPage({ params, searchParams }: Params) {
  const { projectId } = await params;
  const search = await searchParams;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);
  if (!actions.canViewDailyLogs) redirect("/access-denied");

  const query = listQuerySchema.parse({ projectId: project.id, status: one(search.status), page: one(search.page) });
  const [list, settings] = await Promise.all([listDailyLogs(context, query), resolveDailyLogSettings(context.companyId, project.id)]);
  // A count on every page — the old Newer/Older pair said nothing about how many — and a page past
  // the end moves once to the last real page (AUD-08 §4, DT-05).
  const base = `/projects/${project.id}/daily-logs`;
  if (list.page !== query.page) redirect(listPageRedirect(base, search, list.page));
  const today = localDate(new Date(), settings.timezone);
  const canCreate = can(context, "daily_log.create") && list.today?.canCreate;
  const chip = (active: boolean) => cn("rounded-full border px-3 py-1 text-table transition-colors", active ? "border-accent/40 bg-accent-soft font-medium text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg");

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={projectBreadcrumbs(project, "Daily Logs")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          list.today?.logId ? (
            <Button asChild size="sm">
              <Link href={`/projects/${project.id}/daily-logs/${list.today.logId}`}>Open today&apos;s log</Link>
            </Button>
          ) : canCreate ? (
            <StartLogForm projectId={project.id} today={today} earliest={addLocalDays(today, -settings.backdateDays)} compact label="Start today's log" />
          ) : null
        }
      />
      <ProjectTabs
        projectId={project.id}
        active="dailyLogs"
        show={{
          planning: actions.canViewPlanning,
          units: actions.canViewUnits,
          sales: actions.canViewUnitSales,
          contractors: actions.canViewContractors,
          engineering: actions.canViewEngineering,
          tasks: actions.canViewTasks,
          calendar: actions.canViewCalendar,
          meetings: actions.canViewMeetings,
          dailyLogs: actions.canViewDailyLogs,
          workforce: actions.canViewWorkforce,
          team: actions.canViewMembers,
          finance: actions.canViewFinance,
          unitFinance: actions.canViewUnitFinance,
          contracts: actions.canViewContracts,
          inventory: actions.canViewInventory,
          qaqc: actions.canViewQaqc,
          hse: actions.canViewHse,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Log status" className="flex flex-wrap gap-1.5">
          <Link href={`/projects/${project.id}/daily-logs`} className={chip(!query.status)} aria-current={!query.status ? "page" : undefined}>
            All
          </Link>
          {DAILY_LOG_STATUSES.map((status) => (
            <Link key={status} href={`/projects/${project.id}/daily-logs?status=${status}`} className={chip(query.status === status)} aria-current={query.status === status ? "page" : undefined}>
              {DAILY_LOG_STATUS_LABELS[status]}
            </Link>
          ))}
        </nav>
        <span className="flex-1" />
        {canCreate ? (
          <Link href={`/projects/${project.id}/daily-logs/new`} className="text-table font-medium text-accent-strong hover:underline">
            Log an earlier day
          </Link>
        ) : null}
        {settings.logsRequired ? <span className="text-meta text-fg-muted">Logs are required on this project&apos;s working days.</span> : null}
      </div>

      <DailyLogList
        items={list.items}
        showProject={false}
        emptyTitle={query.status ? "No logs with this status." : "No daily logs yet."}
        emptyDescription="Each site day's workforce, work, deliveries, delays and photos are recorded here."
      />
      <Pagination meta={{ page: list.page, limit: list.pageSize, total: list.total, totalPages: Math.max(1, Math.ceil(list.total / list.pageSize)) }} buildHref={(page) => pageHref(base, search, page)} />
    </div>
  );
}
