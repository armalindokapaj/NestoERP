import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { ListChecks } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { RecordContextHeader } from "@/components/modules/record-header";
import { TaskTable } from "@/components/tasks/task-table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import * as projects from "@/lib/modules/projects/project.service";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { parseTaskListQuery } from "@/lib/modules/tasks/task.query";
import { TASK_SORT_KEYS } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("tabs.tasks") };
}

/**
 * Project tasks (PRD #10 §79, PRD #11 §88).
 *
 * The same canonical Task records as /tasks, filtered to this project and to
 * the tasks the user may see: the project tab narrows, it never widens
 * (PRD #10 §224). Rows open the canonical task URL rather than a project-local
 * copy of the detail page (PRD #11 §12, §172).
 *
 * The tab pages through every task with a true count and an allowlisted sort
 * (AUD-08 §4, DT-05). It used to show the first 100 with no count, silently
 * dropping the rest; the project filter is forced from the route, never read
 * from the query string.
 */
export default async function ProjectTasksPage({ params, searchParams }: Params) {
  const { projectId } = await params;
  const raw = await searchParams;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  const actions = projects.projectActions(context);

  if (!actions.canViewTasks) redirect("/access-denied");

  const query = { ...parseTaskListQuery(raw), projectId };
  const result = await tasks.listTasks(context, query);
  const basePath = `/projects/${project.id}/tasks`;
  if (result.pagination.page !== query.page) redirect(listPageRedirect(basePath, raw, result.pagination.page));

  // New work on an archived project is refused by the service, so the control
  // is not offered either (PRD #11 §173).
  const archived = project.archivedAt !== null || project.status === "ARCHIVED";
  const canCreate = !archived && can(context, "task.create");

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={await projectBreadcrumbs(project, "Tasks")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          canCreate ? (
            <Button asChild size="sm">
              <Link href={`/tasks/new?projectId=${project.id}`}>{t("tabPages.newTask")}</Link>
            </Button>
          ) : null
        }
      />

      <ProjectTabs
        projectId={project.id}
        active="tasks"
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

      {result.data.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={t("tabPages.noTasksTitle")}
          description={t("tabPages.noTasksBody")}
          action={
            canCreate
              ? { label: t("tabPages.newTask"), href: `/tasks/new?projectId=${project.id}` }
              : undefined
          }
        />
      ) : (
        <>
          <TaskTable tasks={result.data} listId="projects.tasks" sort={{ value: query.sort, keys: TASK_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={(page) => pageHref(basePath, raw, page)} />
        </>
      )}
    </div>
  );
}
