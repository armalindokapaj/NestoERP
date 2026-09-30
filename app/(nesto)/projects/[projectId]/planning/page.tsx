import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound, redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { PlanningShell } from "@/components/project-planning/planning-shell";
import { AccessError } from "@/lib/access/guards";
import { getPlanningOverview } from "@/lib/modules/project-planning/planning.service";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, } from "../project-context";

type Params = { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("structurePages.planningTitle") };
}

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
  const t = await getTranslations("projects");
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
      <RecordContextHeader title={project.name} subtitle={project.code} status={project.status} />
      {overview.project.archived ? <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">{t("structurePages.planningArchived")}</p> : null}
      <PlanningShell
        initial={overview}
        initialView={(VIEWS as readonly string[]).includes(view ?? "") ? (view as (typeof VIEWS)[number]) : null}
        initialMilestone={one(search.milestone)}
        initialQuick={(QUICK as readonly string[]).includes(quick ?? "") ? (quick as (typeof QUICK)[number]) : null}
      />
    </div>
  );
}
