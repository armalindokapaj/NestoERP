import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getTranslations } from "@/lib/i18n/server";
import { dailyLogsLabel } from "@/lib/i18n/modules/dailyLogs/labels";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { DailyLogList } from "@/components/daily-logs/daily-log-list";
import { ModulePage } from "@/components/modules/module-page";
import { NoResultsState, hasActiveFilters } from "@/components/ui/empty-state";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { prisma } from "@/lib/database/prisma";
import { projectDoor } from "@/lib/modules/daily-logs/daily-log.permissions";
import { listQuerySchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { listDailyLogs } from "@/lib/modules/daily-logs/daily-log.service";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { DAILY_LOG_STATUSES, DAILY_LOG_STATUS_LABELS } from "@/lib/modules/daily-logs/daily-log.types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("dailyLogs"))("meta.dailyLogs") };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/** Logs across every project this reader can open (PRD #43 §5). */
export default async function DailyLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("dailyLogs");
  const experience = resolveModuleExperience(context, "dailyLogs");
  const params = await searchParams;
  const query = listQuerySchema.parse({ projectId: one(params.projectId), status: one(params.status), q: one(params.q), page: one(params.page) });
  const door = projectDoor(context);
  const t = await getTranslations("dailyLogs");
  const [list, projects] = await Promise.all([
    listDailyLogs(context, query),
    door ? prisma.project.findMany({ where: { AND: [door, { archivedAt: null }] }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true } }) : [],
  ]);
  const filters: FilterConfig[] = [
    { param: "status", label: t("common.status"), options: DAILY_LOG_STATUSES.map((status) => ({ value: status, label: dailyLogsLabel(t, "status", status, DAILY_LOG_STATUS_LABELS[status]) })) },
    ...(projects.length ? [{ param: "projectId", label: t("common.project"), options: projects.map((project) => ({ value: project.id, label: project.name })) }] : []),
  ];
  // A count on every page, and a page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (list.page !== query.page) redirect(listPageRedirect("/daily-logs", params, list.page));

  return (
    <ModulePage experience={experience} activeSection="all">
      <div className="space-y-4">
        {/* English: "Search by project or summary…" (AUD-05 §5). */}
        <ListToolbar searchPlaceholder={t("list.searchPlaceholder")} searchParam="q" filters={filters} />
        {/* Filters that match nothing are not an empty module (AUD-05 §6, UX-11). */}
        {list.items.length === 0 && hasActiveFilters(params, ["q", "status", "projectId"]) ? (
          <NoResultsState noun={t("list.noun")} clearHref="/daily-logs" />
        ) : (
          <DailyLogList items={list.items} showProject emptyTitle={t("list.emptyTitle")} emptyDescription={t("list.emptyDescription")} />
        )}
        <Pagination meta={{ page: list.page, limit: list.pageSize, total: list.total, totalPages: Math.max(1, Math.ceil(list.total / list.pageSize)) }} buildHref={(page) => pageHref("/daily-logs", params, page)} />
      </div>
    </ModulePage>
  );
}
