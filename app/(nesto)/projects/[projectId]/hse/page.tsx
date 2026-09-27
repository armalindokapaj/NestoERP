import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { HardHat } from "lucide-react";

import { StopWorkBanner } from "@/components/hse/hse-kpis";
import {
  ActionTable,
  HazardTable,
  IncidentTable,
  InspectionTable,
  ObservationTable,
  PermitTable,
  StopWorkTable,
  ToolboxTable,
} from "@/components/hse/hse-tables";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import * as actionService from "@/lib/modules/hse/actions/action.service";
import * as environment from "@/lib/modules/hse/environment/environment.service";
import * as hazards from "@/lib/modules/hse/hazards/hazard.service";
import * as incidents from "@/lib/modules/hse/incidents/incident.service";
import * as inspections from "@/lib/modules/hse/inspections/inspection.service";
import * as overview from "@/lib/modules/hse/overview/overview.service";
import * as permits from "@/lib/modules/hse/permits/permit.service";
import * as stopWork from "@/lib/modules/hse/stop-work/stop-work.service";
import * as toolbox from "@/lib/modules/hse/toolbox/toolbox.service";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Project HSE" };

/**
 * Safety on one project (PRD #22 §12, §31, §215).
 *
 * The same canonical safety records filtered by `projectId` — not a second
 * table. Being given a project does not by itself hand somebody its incident
 * history: the tab needs an HSE permission, and every HSE scope narrows the rows
 * again on the way out (PRD #22 §26, §373).
 *
 * An active stop-work sits above everything, because it is the one safety state
 * on a project page that must be impossible to miss (PRD #22 §175).
 *
 * Each section is a bounded preview of the full register (AUD-08 §4, DT-01):
 * the first rows and the true count of this project's records, with "View all"
 * opening the register filtered to this project — never a silent stop at 20.
 * Stop-works are few and shown complete.
 */
export default async function ProjectHsePage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const projectActions = projects.projectActions(context);

  if (!projectActions.canViewHse) redirect("/access-denied");

  const [
    summary,
    stopWorkRows,
    hazardRows,
    incidentRows,
    inspectionRows,
    actionRows,
    permitRows,
    toolboxRows,
    observationRows,
  ] = await Promise.all([
    overview.getProjectHseSummary(context, projectId),
    stopWork.listForProject(context, projectId),
    hazards.listForProject(context, projectId, 20),
    incidents.listForProject(context, projectId, 20),
    inspections.listForProject(context, projectId, 20),
    actionService.listForProject(context, projectId, 20),
    permits.listForProject(context, projectId, 20),
    toolbox.listForProject(context, projectId, 10),
    environment.listForProject(context, projectId, 10),
  ]);

  const nothing =
    stopWorkRows.length === 0 &&
    hazardRows.total === 0 &&
    incidentRows.total === 0 &&
    inspectionRows.total === 0 &&
    actionRows.total === 0 &&
    permitRows.total === 0 &&
    toolboxRows.total === 0 &&
    observationRows.total === 0;

  /** The full register narrowed to this project, in the preview's own order where the register has it. */
  const viewAll = (list: string, sort?: string) =>
    `/hse/${list}?projectId=${encodeURIComponent(project.id)}${sort ? `&sort=${sort}` : ""}`;

  const mayReport = can(context, "hse.hazard.create");
  const active = stopWorkRows.filter((record) => record.status === "ACTIVE");

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={projectBreadcrumbs(project, "HSE")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          mayReport ? (
            <Button asChild size="sm">
              <Link href={`/hse/hazards/new?projectId=${project.id}`}>Report a hazard</Link>
            </Button>
          ) : null
        }
      />

      <ProjectTabs
        projectId={project.id}
        active="hse"
        show={{
          planning: projectActions.canViewPlanning,
          units: projectActions.canViewUnits,
          sales: projectActions.canViewUnitSales,
          contractors: projectActions.canViewContractors,
          engineering: projectActions.canViewEngineering,
          tasks: projectActions.canViewTasks,
          calendar: projectActions.canViewCalendar,
          meetings: projectActions.canViewMeetings,
          dailyLogs: projectActions.canViewDailyLogs,
          workforce: projectActions.canViewWorkforce,
          team: projectActions.canViewMembers,
          finance: projectActions.canViewFinance,
          unitFinance: projectActions.canViewUnitFinance,
          contracts: projectActions.canViewContracts,
          inventory: projectActions.canViewInventory,
          qaqc: projectActions.canViewQaqc,
          hse: true,
          documents: projectActions.canViewDocuments,
          activity: projectActions.canViewActivity,
        }}
      />

      <StopWorkBanner
        records={active.map((record) => ({
          id: record.id,
          stopWorkNumber: record.stopWorkNumber,
          title: record.title,
          project: record.project,
        }))}
      />

      {nothing ? (
        <EmptyState
          icon={<HardHat />}
          title="No safety records on this project."
          description="Hazards, incidents, inspections and permits raised against this project appear here."
          action={
            mayReport
              ? { label: "Report a hazard", href: `/hse/hazards/new?projectId=${project.id}` }
              : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Inspection pass rate"
              value={summary.passRate === null ? "—" : `${summary.passRate}%`}
              hint={
                summary.inspections > 0
                  ? `${summary.inspections} inspection${summary.inspections === 1 ? "" : "s"}`
                  : "Nothing inspected yet"
              }
            />
            <Stat
              label="Open hazards"
              value={String(summary.openHazards)}
              hint={
                summary.criticalHazards > 0
                  ? `${summary.criticalHazards} critical`
                  : "None critical"
              }
            />
            <Stat
              label="Incidents"
              value={String(summary.incidents)}
              hint={`${summary.nearMisses} near ${summary.nearMisses === 1 ? "miss" : "misses"}`}
            />
            <Stat
              label="Active permits"
              value={String(summary.activePermits)}
              hint={
                summary.overdueActions > 0
                  ? `${summary.overdueActions} overdue actions`
                  : "No overdue actions"
              }
            />
          </section>

          {stopWorkRows.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Stop-work</h2>
              <StopWorkTable
                records={stopWorkRows}
                caption={`Stop-work on ${project.name}`}
                listId="projects.hse-stop-work"
              />
            </section>
          ) : null}

          {hazardRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Hazards</h2>
              <HazardTable
                hazards={hazardRows.data}
                caption={`Hazards on ${project.name}`}
                listId="projects.hse-hazards"
              />
              <PreviewFooter
                shown={hazardRows.data.length}
                total={hazardRows.total}
                href={viewAll("hazards", "risk-desc")}
                noun="hazards"
              />
            </section>
          ) : null}

          {incidentRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Incidents</h2>
              <IncidentTable
                incidents={incidentRows.data}
                caption={`Incidents on ${project.name}`}
                listId="projects.hse-incidents"
              />
              <PreviewFooter
                shown={incidentRows.data.length}
                total={incidentRows.total}
                href={viewAll("incidents", "occurred-desc")}
                noun="incidents"
              />
            </section>
          ) : null}

          {inspectionRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Inspections</h2>
              <InspectionTable
                inspections={inspectionRows.data}
                caption={`Inspections on ${project.name}`}
                listId="projects.hse-inspections"
              />
              <PreviewFooter
                shown={inspectionRows.data.length}
                total={inspectionRows.total}
                href={viewAll("inspections")}
                noun="inspections"
              />
            </section>
          ) : null}

          {actionRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Actions</h2>
              <ActionTable
                actions={actionRows.data}
                caption={`HSE actions on ${project.name}`}
                listId="projects.hse-actions"
              />
              <PreviewFooter
                shown={actionRows.data.length}
                total={actionRows.total}
                href={viewAll("actions")}
                noun="actions"
              />
            </section>
          ) : null}

          {permitRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Permits</h2>
              <PermitTable
                permits={permitRows.data}
                caption={`Permits on ${project.name}`}
                listId="projects.hse-permits"
              />
              <PreviewFooter
                shown={permitRows.data.length}
                total={permitRows.total}
                href={viewAll("permits")}
                noun="permits"
              />
            </section>
          ) : null}

          {toolboxRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Toolbox talks</h2>
              <ToolboxTable
                talks={toolboxRows.data}
                caption={`Toolbox talks on ${project.name}`}
                listId="projects.hse-toolbox-talks"
              />
              <PreviewFooter
                shown={toolboxRows.data.length}
                total={toolboxRows.total}
                href={viewAll("toolbox-talks", "date-desc")}
                noun="toolbox talks"
              />
            </section>
          ) : null}

          {observationRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Environmental</h2>
              <ObservationTable
                observations={observationRows.data}
                caption={`Environmental observations on ${project.name}`}
                listId="projects.hse-environment"
              />
              <PreviewFooter
                shown={observationRows.data.length}
                total={observationRows.total}
                href={viewAll("environment", "observed-desc")}
                noun="observations"
              />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Under a preview: how many of the project's records it shows, and the way to
 * the rest (AUD-08 §4). A complete preview still states its count.
 */
function PreviewFooter({ shown, total, href, noun }: { shown: number; total: number; href: string; noun: string }) {
  return (
    <p className="flex flex-wrap items-baseline justify-between gap-2 text-meta text-fg-muted" data-testid="preview-count">
      <span>
        {shown < total ? (
          <>
            Showing <span className="tabular-nums">{shown}</span> of <span className="tabular-nums">{total}</span> {noun}
          </>
        ) : (
          <>
            <span className="tabular-nums">{total}</span> {noun}
          </>
        )}
      </span>
      <Link href={href} className="text-accent hover:underline">
        View all {noun}
      </Link>
    </p>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="nesto-card p-5">
      <p className="nesto-eyebrow text-fg-subtle">{label}</p>
      <p className="mt-1.5 text-page font-semibold tabular-nums text-fg">{value}</p>
      {hint ? <p className="mt-1 text-meta text-fg-subtle">{hint}</p> : null}
    </div>
  );
}
