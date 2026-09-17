import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { History } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { RecordContextHeader } from "@/components/modules/record-header";
import { EmptyState } from "@/components/ui/empty-state";
import * as projects from "@/lib/modules/projects/project.service";
import { formatDateTime } from "@/lib/utils/format";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ page?: string }>;
};

export const metadata: Metadata = { title: "Activity" };

/**
 * Project activity (PRD #10 §87, §90).
 *
 * Filtered to the modules this person may see: Finance activity on a shared
 * project does not reach an Architect just because they can open the project.
 */
export default async function ProjectActivityPage({ params, searchParams }: Params) {
  const { projectId } = await params;
  const { page } = await searchParams;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);

  if (!actions.canViewActivity) redirect("/access-denied");

  const currentPage = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const activity = await projects.listActivity(context, projectId, {
    page: currentPage,
    limit: 25,
  });

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={projectBreadcrumbs(project, "Activity")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
      />

      <ProjectTabs
        projectId={project.id}
        active="activity"
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

      {activity.data.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="No activity yet."
          description="Changes to this project will be recorded here."
        />
      ) : (
        <>
          <ol className="nesto-card divide-y divide-line p-5">
            {activity.data.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 py-3 first:pt-0 last:pb-0">
                <span className="text-table font-medium text-fg">{entry.actor ?? "NESTO"}</span>
                <span className="text-table text-fg-muted">{entry.message ?? entry.action}</span>
                <span className="ml-auto text-meta tabular-nums text-fg-subtle">
                  {formatDateTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ol>

          <Pagination
            meta={activity.pagination}
            buildHref={(next) =>
              next > 1
                ? `/projects/${project.id}/activity?page=${next}`
                : `/projects/${project.id}/activity`
            }
          />
        </>
      )}
    </div>
  );
}
