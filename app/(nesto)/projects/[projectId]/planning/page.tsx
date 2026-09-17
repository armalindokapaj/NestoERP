import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { PlanningShell } from "@/components/project-planning/planning-shell";
import { AccessError } from "@/lib/access/guards";
import { getPlanningOverview } from "@/lib/modules/project-planning/planning.service";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: "Project planning" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || null;
const VIEWS = ["overview", "timeline", "milestones", "dependencies"] as const;
const QUICK = ["upcoming", "delayed", "at_risk", "critical", "completed"] as const;

/**
 * A project's plan (PRD #44 §6-§8): phases, milestones, the timeline and the
 * dependencies, with the milestone drawer opened straight from a link
 * (`?milestone=`) — which is how the calendar, search and notifications arrive.
 */
export default async function ProjectPlanningPage({ params, searchParams }: Params) {
  const { projectId } = await params;
  const search = await searchParams;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);
  if (!actions.canViewPlanning) redirect("/access-denied");

  const overview = await getPlanningOverview(context, project.id).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    if (error instanceof AccessError && error.code === "FORBIDDEN") redirect("/access-denied");
    throw error;
  });
  const view = one(search.view);
  const quick = one(search.filter);

  return (
    <div className="space-y-5">
      <RecordContextHeader breadcrumbs={projectBreadcrumbs(project, "Planning")} title={project.name} subtitle={project.code} status={project.status} />
      <ProjectTabs
        projectId={project.id}
        active="planning"
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
      {overview.project.archived ? <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">This project is archived. Its plan is kept as history and cannot be changed.</p> : null}
      <PlanningShell
        initial={overview}
        initialView={(VIEWS as readonly string[]).includes(view ?? "") ? (view as (typeof VIEWS)[number]) : null}
        initialMilestone={one(search.milestone)}
        initialQuick={(QUICK as readonly string[]).includes(quick ?? "") ? (quick as (typeof QUICK)[number]) : null}
      />
    </div>
  );
}
