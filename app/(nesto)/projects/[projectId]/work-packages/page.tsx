import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ListToolbar } from "@/components/data/list-toolbar";
import { NewWorkPackageButton } from "@/components/contractors/contractor-dialogs";
import { WorkPackageTable } from "@/components/contractors/contractor-tables";
import { flat, orNotFound, type SearchParams } from "@/components/engineering/page-helpers";
import { RecordContextHeader } from "@/components/modules/record-header";
import { can } from "@/lib/access/can";
import { contractorsOpen } from "@/lib/modules/contractors/contractor.permissions";
import { workPackageListSchema } from "@/lib/modules/contractors/contractor.schema";
import { WORK_PACKAGE_STATUSES, WORK_PACKAGE_STATUS_LABELS } from "@/lib/modules/contractors/contractor.types";
import { DISCIPLINES, DISCIPLINE_LABELS } from "@/lib/modules/engineering/engineering.types";
import * as projects from "@/lib/modules/projects/project.service";
import { listProjectWorkPackages } from "@/lib/modules/work-packages/work-package.service";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }>; searchParams: SearchParams };

export const metadata: Metadata = { title: "Work packages" };

/** The project's work packages (PRD #46 §32-§40, §215). */
export default async function ProjectWorkPackagesPage({ params, searchParams }: Params) {
  const [{ projectId }, search] = await Promise.all([params, searchParams]);
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);
  if (!contractorsOpen(context, "work_package.view")) redirect("/access-denied");
  const items = await orNotFound(listProjectWorkPackages(context, project.id, workPackageListSchema.parse(flat(search))));
  const archived = project.archivedAt !== null || project.status === "ARCHIVED";

  return (
    <div className="space-y-5">
      <RecordContextHeader breadcrumbs={projectBreadcrumbs(project, "Work packages")} title={project.name} subtitle={project.code} status={project.status} actions={!archived && can(context, "work_package.create") ? <NewWorkPackageButton projectId={project.id} /> : null} />
      <ProjectTabs
        projectId={project.id}
        active="contractors"
        show={{
          planning: actions.canViewPlanning,
          contractors: actions.canViewContractors,
          engineering: actions.canViewEngineering,
          tasks: actions.canViewTasks,
          calendar: actions.canViewCalendar,
          meetings: actions.canViewMeetings,
          dailyLogs: actions.canViewDailyLogs,
          team: actions.canViewMembers,
          finance: actions.canViewFinance,
          contracts: actions.canViewContracts,
          inventory: actions.canViewInventory,
          qaqc: actions.canViewQaqc,
          hse: actions.canViewHse,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />
      <ListToolbar
        searchPlaceholder="Search code or name…"
        searchParam="q"
        filters={[
          { param: "status", label: "Status", options: WORK_PACKAGE_STATUSES.map((value) => ({ value, label: WORK_PACKAGE_STATUS_LABELS[value] })) },
          { param: "discipline", label: "Discipline", options: DISCIPLINES.map((value) => ({ value, label: DISCIPLINE_LABELS[value] })) },
        ]}
      />
      <WorkPackageTable items={items} />
    </div>
  );
}
