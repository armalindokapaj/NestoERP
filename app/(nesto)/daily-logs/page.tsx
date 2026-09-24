import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { DailyLogList } from "@/components/daily-logs/daily-log-list";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { prisma } from "@/lib/database/prisma";
import { projectDoor } from "@/lib/modules/daily-logs/daily-log.permissions";
import { listQuerySchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { listDailyLogs } from "@/lib/modules/daily-logs/daily-log.service";
import { DAILY_LOG_STATUSES, DAILY_LOG_STATUS_LABELS } from "@/lib/modules/daily-logs/daily-log.types";

export const metadata: Metadata = { title: "Daily logs" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/** Logs across every project this reader can open (PRD #43 §5). */
export default async function DailyLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("dailyLogs");
  const experience = resolveModuleExperience(context, "dailyLogs");
  const params = await searchParams;
  const query = listQuerySchema.parse({ projectId: one(params.projectId), status: one(params.status), q: one(params.q), page: one(params.page) });
  const door = projectDoor(context);
  const [list, projects] = await Promise.all([
    listDailyLogs(context, query),
    door ? prisma.project.findMany({ where: { AND: [door, { archivedAt: null }] }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true } }) : [],
  ]);
  const filters: FilterConfig[] = [
    { param: "status", label: "Status", options: DAILY_LOG_STATUSES.map((status) => ({ value: status, label: DAILY_LOG_STATUS_LABELS[status] })) },
    ...(projects.length ? [{ param: "projectId", label: "Project", options: projects.map((project) => ({ value: project.id, label: project.name })) }] : []),
  ];
  const href = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "page") next.set(key, value);
    if (page > 1) next.set("page", String(page));
    return `/daily-logs${next.size ? `?${next}` : ""}`;
  };

  return (
    <ModulePage experience={experience} activeSection="all">
      <div className="space-y-4">
        <ListToolbar searchPlaceholder="Search by project or summary…" searchParam="q" filters={filters} />
        <DailyLogList items={list.items} showProject emptyTitle="No daily logs here." emptyDescription="Open a project's Daily Logs tab to start the day's record." />
        <div className="flex justify-center gap-2">
          {query.page > 1 ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={href(query.page - 1)}>Newer</Link>
            </Button>
          ) : null}
          {query.page * query.pageSize < list.total ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={href(query.page + 1)}>Older</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </ModulePage>
  );
}
