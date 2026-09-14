import type { Metadata } from "next";
import Link from "next/link";

import { EmptyNote, Metric, MetricStrip, Panel } from "@/components/engineering/engineering-ui";
import { counted, one, orNotFound, type SearchParams } from "@/components/engineering/page-helpers";
import { ProjectFilter } from "@/components/engineering/project-filter";
import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { prisma } from "@/lib/database/prisma";
import { engineeringProjectDoor } from "@/lib/modules/engineering/engineering.permissions";
import { engineeringReport, type Breakdown } from "@/lib/modules/engineering/engineering.overview";

export const metadata: Metadata = { title: "Engineering reports" };

function Bars({ rows, empty }: { rows: Breakdown; empty: string }) {
  if (!rows.length) return <EmptyNote>{empty}</EmptyNote>;
  const max = Math.max(...rows.map((row) => row.count));
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-3 text-table">
          <span className="truncate text-fg">{row.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }} />
          </span>
          <span className="text-right tabular-nums text-fg-muted">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Engineering reports (PRD #46 §206-§211): RFIs, submittals, documents,
 * compliance and contractors by project — counts and durations, no contractor
 * score.
 */
export default async function EngineeringReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireModule("engineering");
  const experience = resolveModuleExperience(context, "engineering");
  const projectId = one((await searchParams).projectId) ?? null;
  const door = engineeringProjectDoor(context, "rfi.view");
  const [report, projects] = await Promise.all([orNotFound(engineeringReport(context, { projectId })), door ? prisma.project.findMany({ where: { AND: [door, { archivedAt: null }] }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true } }) : []]);
  return (
    <ModulePage experience={experience} activeSection="reports" title="Engineering reports" description="What is open, what is late and how long answers and reviews take — counted, never scored.">
      <div className="space-y-6">
        <ProjectFilter projects={projects} />
        <MetricStrip>
          <Metric label="Open RFIs" value={report.rfis.open} testId="report-open-rfis" />
          <Metric label="Overdue RFIs" value={report.rfis.overdue} tone="danger" />
          <Metric label="Average response" value={report.rfis.averageResponseDays === null ? "—" : `${report.rfis.averageResponseDays}d`} />
          <Metric label="Reviews overdue" value={report.submittals.overdueReviews} tone="danger" />
          <Metric label="Avg. revisions per submittal" value={report.submittals.averageRevisions ?? "—"} />
          <Metric label="Documents pending review" value={report.documents.pendingReview} />
          <Metric label="Superseded documents" value={report.documents.superseded} />
          {report.compliance ? <Metric label="Compliance alerts" value={report.compliance.alerts} tone="warning" /> : null}
        </MetricStrip>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
          <Panel title="RFIs by contractor">
            <Bars rows={report.rfis.byContractor} empty="No RFIs yet." />
          </Panel>
          <Panel title="RFIs by discipline">
            <Bars rows={report.rfis.byDiscipline} empty="No RFIs yet." />
          </Panel>
          <Panel title="Submittals by status">
            <Bars rows={report.submittals.byStatus} empty="No submittals yet." />
          </Panel>
          <Panel title="Submittals by type">
            <Bars rows={report.submittals.byType} empty="No submittals yet." />
          </Panel>
          <Panel title="Submittals by contractor">
            <Bars rows={report.submittals.byContractor} empty="No submittals yet." />
          </Panel>
          <Panel title="Documents by discipline">
            <Bars rows={report.documents.byDiscipline} empty="No engineering documents yet." />
          </Panel>
          <Panel title="Documents by status">
            <Bars rows={report.documents.byStatus} empty="No engineering documents yet." />
          </Panel>
          {report.compliance ? (
            <Panel title="Contractor compliance">
              <Bars rows={report.compliance.byStatus} empty="No compliance items recorded." />
            </Panel>
          ) : null}
        </div>
        {report.contractors ? (
          <Panel title="Contractors by project">
            {report.contractors.byProject.length === 0 ? (
              <EmptyNote>No contractors assigned yet.</EmptyNote>
            ) : (
              <ul className="divide-y divide-line">
                {report.contractors.byProject.map((row) => (
                  <li key={row.projectId} className="flex items-center justify-between gap-3 py-2 text-table">
                    <Link href={`/projects/${row.projectId}/contractors`} className="text-fg hover:underline">
                      {row.projectName}
                    </Link>
                    <span className="tabular-nums text-fg-muted">
                      {row.contractors} {counted(row.contractors, "contractor")} · {row.activeWorkPackages} open {counted(row.activeWorkPackages, "work package")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>
    </ModulePage>
  );
}
