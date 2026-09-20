import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Project3DViewer } from "@/components/3d/company/Project3DViewer";
import { PageHeader } from "@/components/ui/page-header";
import { hasActiveProject3DViewer } from "@/lib/modules/project-3d/project-3d.viewer";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { projectId } = await params;
  const { project } = await loadProject(projectId);
  return { title: `${project.name} · 3D Viewer` };
}

export default async function ProjectThreeDPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  if (!await hasActiveProject3DViewer(context, project.id)) notFound();
  const actions = projects.projectActions(context);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${project.name} · 3D Viewer`}
        description="Explore the active published experience and open mapped units in their canonical NESTO records."
      />
      <ProjectTabs
        projectId={project.id}
        active="3d"
        show={{
          threeD: true,
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
      <Project3DViewer projectId={project.id} />
    </div>
  );
}
