import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import {
  CorrectiveActionTable,
  DefectTable,
  InspectionTable,
  NcrTable,
} from "@/components/qaqc/qaqc-tables";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import * as actions from "@/lib/modules/qaqc/corrective-actions/action.service";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";
import * as inspections from "@/lib/modules/qaqc/inspections/inspection.service";
import * as ncrs from "@/lib/modules/qaqc/ncrs/ncr.service";
import { projectQuality } from "@/lib/modules/qaqc/reports/reports.service";
import { inspectionListQuerySchema } from "@/lib/modules/qaqc/qaqc.schema";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Project QA/QC" };

/**
 * Quality on one project (PRD #21 §11, §32).
 *
 * The same canonical quality records filtered by `projectId` — not a second
 * table. Being given a project does not by itself hand somebody its quality
 * history: the tab needs a quality permission, and every quality scope narrows
 * the rows again on the way out (PRD #21 §26).
 *
 * Each section is a bounded preview of the full register (AUD-08 §4, DT-01):
 * the first rows and the true count of this project's records, with "View all"
 * opening the register filtered to this project — never a silent stop at 20.
 */
export default async function ProjectQaqcPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const projectActions = projects.projectActions(context);

  if (!projectActions.canViewQaqc) redirect("/access-denied");

  const empty = { data: [], total: 0 };
  const [summary, inspectionRows, defectRows, ncrRows, actionRows] = await Promise.all([
    projectQuality(context, projectId),
    can(context, "qaqc.inspection.view")
      ? inspections
          .listInspections(context, inspectionListQuerySchema.parse({ projectId, limit: 20 }))
          .then((result) => ({ data: result.data, total: result.pagination.total }))
      : Promise.resolve(empty),
    defects.listForProject(context, projectId, 20),
    ncrs.listForProject(context, projectId, 20),
    actions.listForProject(context, projectId, 20),
  ]);

  const nothing =
    inspectionRows.total === 0 &&
    defectRows.total === 0 &&
    ncrRows.total === 0 &&
    actionRows.total === 0;

  /** The full register narrowed to this project, in the preview's own order where the register has it. */
  const viewAll = (list: string, sort?: string) =>
    `/qaqc/${list}?projectId=${encodeURIComponent(project.id)}${sort ? `&sort=${sort}` : ""}`;

  const mayRequest = can(context, "qaqc.request.create");

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={projectBreadcrumbs(project, "QA/QC")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          mayRequest ? (
            <Button asChild size="sm">
              <Link href={`/qaqc/requests/new?projectId=${project.id}`}>
                Request an inspection
              </Link>
            </Button>
          ) : null
        }
      />

      <ProjectTabs
        projectId={project.id}
        active="qaqc"
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
          qaqc: true,
          documents: projectActions.canViewDocuments,
          activity: projectActions.canViewActivity,
        }}
      />

      {nothing ? (
        <EmptyState
          icon={<ShieldCheck />}
          title="No quality records on this project."
          description="Inspections, defects and non-conformances raised against this project appear here."
          action={
            mayRequest
              ? {
                  label: "Request an inspection",
                  href: `/qaqc/requests/new?projectId=${project.id}`,
                }
              : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Pass rate"
              value={summary.passRate ? `${summary.passRate.percent}%` : "—"}
              hint={
                summary.passRate
                  ? `${summary.passRate.passed} of ${summary.passRate.total} decided`
                  : "Nothing decided yet"
              }
            />
            <Stat label="Open defects" value={String(summary.openDefects)} />
            <Stat label="Open NCRs" value={String(summary.openNcrs)} />
            <Stat label="Open actions" value={String(summary.openActions)} />
          </section>

          {inspectionRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Inspections</h2>
              <InspectionTable
                inspections={inspectionRows.data}
                caption={`Inspections on ${project.name}`}
                listId="projects.qaqc-inspections"
              />
              <PreviewFooter
                shown={inspectionRows.data.length}
                total={inspectionRows.total}
                href={viewAll("inspections")}
                noun="inspections"
              />
            </section>
          ) : null}

          {defectRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Defects</h2>
              <DefectTable
                defects={defectRows.data}
                showProject={false}
                caption={`Defects on ${project.name}`}
                listId="projects.qaqc-defects"
              />
              <PreviewFooter
                shown={defectRows.data.length}
                total={defectRows.total}
                href={viewAll("defects", "severity-desc")}
                noun="defects"
              />
            </section>
          ) : null}

          {ncrRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Non-conformances</h2>
              <NcrTable
                ncrs={ncrRows.data}
                showProject={false}
                caption={`NCRs on ${project.name}`}
                listId="projects.qaqc-ncrs"
              />
              <PreviewFooter
                shown={ncrRows.data.length}
                total={ncrRows.total}
                href={viewAll("ncrs", "severity-desc")}
                noun="NCRs"
              />
            </section>
          ) : null}

          {actionRows.total > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Corrective actions</h2>
              <CorrectiveActionTable
                actions={actionRows.data}
                caption={`Corrective actions on ${project.name}`}
                listId="projects.qaqc-corrective-actions"
              />
              <PreviewFooter
                shown={actionRows.data.length}
                total={actionRows.total}
                href={viewAll("corrective-actions")}
                noun="corrective actions"
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
