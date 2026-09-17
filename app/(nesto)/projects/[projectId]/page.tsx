import type { Metadata } from "next";
import Link from "next/link";
import { RecordFavorite } from "@/components/productivity/record-favorite";
import { Megaphone, TriangleAlert } from "lucide-react";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PriorityBadge } from "@/components/modules/status-badge";
import { ProjectActions } from "@/components/projects/project-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import { canAddress } from "@/lib/modules/announcements/announcement.permissions";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import * as projects from "@/lib/modules/projects/project.service";
import { dateLabel } from "@/lib/modules/project-planning/planning.dates";
import { projectPlanningSummary } from "@/lib/modules/project-planning/planning.reports";
import { projectStructureSummary } from "@/lib/modules/project-structure/structure.service";
import { buildOpportunityScopeWhere } from "@/lib/modules/sales/sales.scope";
import {
  daysRemaining,
  formatDaysRemaining,
  getProjectScheduleStatus,
  scheduleStatusLabels,
} from "@/lib/modules/projects/project.status";
import { formatDate, orDash } from "@/lib/utils/format";
import { loadProject, projectBreadcrumbs } from "./project-context";
import { ProjectTabs } from "./project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { projectId } = await params;
  try {
    const { project } = await loadProject(projectId);
    return { title: project.name };
  } catch {
    return { title: "Project" };
  }
}

/**
 * Project overview (PRD #10 §42, §46).
 *
 * Each section checks the permission that underpins it, so a role without
 * document access sees no document summary rather than an empty locked card
 * (PRD #10 §134, §135).
 */
export default async function ProjectOverviewPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);

  const archived = project.archivedAt !== null || project.status === "ARCHIVED";

  const schedule = getProjectScheduleStatus({
    status: project.status,
    startDate: project.schedule.startDate ? new Date(project.schedule.startDate) : null,
    endDate: project.schedule.endDate ? new Date(project.schedule.endDate) : null,
  });

  const remaining = daysRemaining(
    project.schedule.endDate ? new Date(project.schedule.endDate) : null,
  );

  // Next milestone, delays, risk and progress by phase (PRD #44 §169).
  const planning = actions.canViewPlanning ? await projectPlanningSummary(context, projectId) : null;
  // Buildings, floors and units, counted from the rows (E-05B §88).
  const structure = actions.canViewUnits ? await projectStructureSummary(context, projectId) : null;

  const taskSummary = actions.canViewTasks
    ? await projects.getProjectTaskSummary(context, projectId)
    : null;

  // Through document access, not the project alone: an HSE incident photo or a
  // procurement quote filed on this project is listed only for somebody who
  // could open it — and not at all while its module is switched off
  // (PRD #13 §283, PRD #47 §63).
  const recentDocuments = actions.canViewDocuments
    ? await prisma.document.findMany({
        where: { AND: [await buildDocumentAccessWhere(context), { companyId: context.companyId, projectId, status: "ACTIVE" }] },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: { id: true, name: true, createdAt: true },
      })
    : [];

  const activity = actions.canViewActivity
    ? await projects.listActivity(context, projectId, { page: 1, limit: 5 })
    : null;

  /**
   * The deal this project came from (PRD #17 §267, §385).
   *
   * Shown only to somebody who may see Sales records, and resolved through the
   * Sales scope — so a project manager without Sales access sees nothing here
   * rather than the commercial value behind their own job (PRD #17 §365, §416).
   */
  const sourceOpportunity = can(context, "sales.opportunity.view")
    ? await prisma.opportunity.findFirst({
        where: {
          AND: [buildOpportunityScopeWhere(context), { convertedProjectId: projectId }],
        },
        select: { id: true, name: true, stage: true },
      })
    : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={projectBreadcrumbs(project)}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        badges={<PriorityBadge priority={project.priority} />}
        meta={[
          {
            label: "Client",
            value: project.client ? (
              can(context, "client.view") ? (
                <Link
                  href={`/clients/${project.client.id}`}
                  className="text-fg transition-colors hover:text-accent"
                >
                  {project.client.name}
                </Link>
              ) : (
                // No link to a record this person cannot open (PRD #10 §136).
                project.client.name
              )
            ) : (
              "—"
            ),
          },
          {
            label: "Project manager",
            value: project.projectManager ? (
              <span className="flex items-center gap-2">
                {can(context, "team.view") ? (
                  <Link
                    href={`/team/${project.projectManager.memberId}`}
                    className="text-fg transition-colors hover:text-accent"
                  >
                    {project.projectManager.fullName}
                  </Link>
                ) : (
                  project.projectManager.fullName
                )}
                {!project.projectManager.membershipActive ? (
                  <Badge tone="warning">Inactive</Badge>
                ) : null}
              </span>
            ) : (
              "Unassigned"
            ),
          },
          { label: "Schedule", value: scheduleStatusLabels[schedule] },
          ...(sourceOpportunity
            ? [
                {
                  label: "From opportunity",
                  value: (
                    <Link
                      href={`/sales/opportunities/${sourceOpportunity.id}`}
                      className="text-fg transition-colors hover:text-accent"
                    >
                      {sourceOpportunity.name}
                    </Link>
                  ),
                },
              ]
            : []),
        ]}
        actions={
          <>
          <RecordFavorite context={context} entityType="project" entityId={project.id} />
          {canAddress(context, "PROJECT") ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={`/announcements/new?projectId=${project.id}`}>
                <Megaphone aria-hidden="true" /> Announce
              </Link>
            </Button>
          ) : null}
          <ProjectActions
            projectId={project.id}
            projectName={project.name}
            archived={archived}
            canUpdate={actions.canUpdate}
            canArchive={actions.canArchive}
            canRestore={actions.canRestore}
          />
          </>
        }
      />

      {archived ? (
        <p className="flex items-center gap-2 rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          This project is archived and read-only. Restore it to make changes.
        </p>
      ) : null}

      <ProjectTabs
        projectId={project.id}
        active="overview"
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

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2 lg:self-start">
          <h2 className="text-card font-semibold text-fg">Project summary</h2>
          {project.description ? (
            <p className="mt-3 text-body text-fg-muted">{project.description}</p>
          ) : null}
          <DetailGrid
            className="mt-5"
            items={[
              { label: "Code", value: project.code },
              { label: "Priority", value: <PriorityBadge priority={project.priority} /> },
              {
                label: "Start date",
                value: project.schedule.startDate
                  ? formatDate(project.schedule.startDate)
                  : "Not set",
              },
              {
                label: "End date",
                value: project.schedule.endDate ? formatDate(project.schedule.endDate) : "Not set",
              },
              { label: "Schedule", value: formatDaysRemaining(remaining) },
              {
                label: "Location",
                value: orDash(
                  [project.location.city, project.location.country].filter(Boolean).join(", "),
                ),
              },
            ]}
          />
        </section>

        <div className="space-y-4">
          {planning ? (
            <section className="nesto-card p-5" data-testid="project-planning-card">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Planning</h2>
                <Link href={`/projects/${project.id}/planning`} className="text-table font-medium text-accent-strong">
                  View plan
                </Link>
              </div>
              {planning.metrics.total ? (
                <>
                  {planning.next ? (
                    <Link href={`/projects/${project.id}/planning?milestone=${planning.next.id}`} className="mt-3 block rounded-md border border-line px-3 py-2 hover:border-line-strong">
                      <span className="block text-meta text-fg-subtle">Next milestone</span>
                      <span className="block truncate text-table font-medium text-fg">{planning.next.name}</span>
                      <span className={planning.next.delayed ? "text-meta text-danger-strong" : "text-meta text-fg-muted"}>
                        {planning.next.delayed ? "Delayed · " : ""}
                        {dateLabel(planning.next.date)}
                      </span>
                    </Link>
                  ) : null}
                  <dl className="mt-3 grid grid-cols-3 gap-3">
                    {[
                      { label: "Complete", value: `${planning.metrics.completed}/${planning.metrics.total}` },
                      { label: "Delayed", value: planning.metrics.delayed },
                      { label: "At risk", value: planning.metrics.atRisk },
                    ].map((entry) => (
                      <div key={entry.label}>
                        <dt className="text-meta text-fg-subtle">{entry.label}</dt>
                        <dd className="text-section font-semibold tabular-nums text-fg">{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {planning.phases.length ? (
                    <ul className="mt-4 space-y-2">
                      {planning.phases.slice(0, 6).map((phase) => (
                        <li key={phase.id}>
                          <div className="flex justify-between gap-2 text-meta">
                            <span className="truncate text-fg">{phase.name}</span>
                            <span className="tabular-nums text-fg-muted">{phase.progress ?? 0}%</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                            <div className="h-full rounded-full bg-accent" style={{ width: `${phase.progress ?? 0}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 text-table text-fg-subtle">No plan yet.</p>
              )}
            </section>
          ) : null}

          {structure ? (
            <section className="nesto-card p-5" data-testid="project-structure-card">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Units</h2>
                <Link href={`/projects/${project.id}/units`} className="text-table font-medium text-accent-strong">
                  View units
                </Link>
              </div>
              {structure.buildings ? (
                <dl className="mt-4 grid grid-cols-3 gap-3">
                  {[
                    { label: structure.buildings === 1 ? "Building" : "Buildings", value: structure.buildings },
                    { label: structure.floors === 1 ? "Floor" : "Floors", value: structure.floors },
                    { label: structure.units === 1 ? "Unit" : "Units", value: structure.units },
                  ].map((entry) => (
                    <div key={entry.label}>
                      <dt className="text-meta text-fg-subtle">{entry.label}</dt>
                      <dd className="text-section font-semibold tabular-nums text-fg">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-table text-fg-subtle">No buildings yet.</p>
              )}
            </section>
          ) : null}

          {taskSummary ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Tasks</h2>
                <Link
                  href={`/projects/${project.id}/tasks`}
                  className="text-table font-medium text-accent-strong"
                >
                  View tasks
                </Link>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { label: "Open", value: taskSummary.open },
                  { label: "In progress", value: taskSummary.inProgress },
                  { label: "Blocked", value: taskSummary.blocked },
                  { label: "Overdue", value: taskSummary.overdue },
                ].map((entry) => (
                  <div key={entry.label}>
                    <dt className="text-meta text-fg-subtle">{entry.label}</dt>
                    <dd className="text-section font-semibold tabular-nums text-fg">
                      {entry.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {actions.canViewMembers ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Team</h2>
                <Link
                  href={`/projects/${project.id}/team`}
                  className="text-table font-medium text-accent-strong"
                >
                  View team
                </Link>
              </div>
              <p className="mt-3 text-page font-semibold tabular-nums text-fg">
                {project.counts.members}
              </p>
              <p className="text-meta text-fg-subtle">active members</p>
            </section>
          ) : null}

          {actions.canViewDocuments ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Documents</h2>
                <Link
                  href={`/projects/${project.id}/documents`}
                  className="text-table font-medium text-accent-strong"
                >
                  View all
                </Link>
              </div>
              {recentDocuments.length === 0 ? (
                <p className="mt-3 text-table text-fg-subtle">No documents yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {recentDocuments.map((document) => (
                    <li key={document.id} className="truncate py-2 text-table text-fg first:pt-0">
                      {document.name}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </div>
      </div>

      {activity && activity.data.length > 0 ? (
        <section className="nesto-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-card font-semibold text-fg">Recent activity</h2>
            <Link
              href={`/projects/${project.id}/activity`}
              className="text-table font-medium text-accent-strong"
            >
              View all
            </Link>
          </div>
          <ul className="mt-4 space-y-3">
            {activity.data.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line-strong"
                />
                <p className="text-table text-fg">
                  <span className="font-medium">{entry.actor ?? "NESTO"}</span> {entry.message}
                  <span className="ml-2 text-meta text-fg-subtle">
                    {formatDate(entry.createdAt)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="project" parentId={projectId} />
    </div>
  );
}
