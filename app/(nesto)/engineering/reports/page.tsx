import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { engineeringLabel, type EngineeringLabelGroup } from "@/lib/i18n/modules/engineering/labels";
import Link from "@/components/navigation/nav-link";

import { EmptyNote, Metric, MetricStrip, Panel } from "@/components/engineering/engineering-ui";
import { one, orNotFound, type SearchParams } from "@/components/engineering/page-helpers";
import { ProjectFilter } from "@/components/engineering/project-filter";
import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { prisma } from "@/lib/database/prisma";
import { engineeringProjectDoor } from "@/lib/modules/engineering/engineering.permissions";
import { engineeringReport, type Breakdown } from "@/lib/modules/engineering/engineering.overview";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("engineering"))("reports.title") };
}

function Bars({ rows, empty }: { rows: Breakdown; empty: string }) {
  if (!rows.length) return <EmptyNote>{empty}</EmptyNote>;
  const max = Math.max(...rows.map((row) => row.count));
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-3 text-table">
          {/* The whole name, on two lines at most, instead of a cut label (AUD-04 §8, D-09-10, MW-17). */}
          <span className="line-clamp-2 text-fg [overflow-wrap:anywhere]" title={row.label}>{row.label}</span>
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
  const t = await getTranslations("engineering");
  const door = engineeringProjectDoor(context, "rfi.view");
  // A stored value's bar reads in the reader's language; a contractor's name stays as it is.
  const translated = (rows: Breakdown, group: EngineeringLabelGroup): Breakdown => rows.map((row) => ({ ...row, label: engineeringLabel(t, group, row.key, row.label) }));
  const [report, projects] = await Promise.all([orNotFound(engineeringReport(context, { projectId })), door ? prisma.project.findMany({ where: { AND: [door, { archivedAt: null }] }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true } }) : []]);
  return (
    <ModulePage experience={experience} activeSection="reports" title={t("reports.title")} description={t("reports.description")}>
      <div className="space-y-6">
        <ProjectFilter projects={projects} label={t("reports.project")} allLabel={t("reports.allProjects")} />
        <MetricStrip>
          <Metric label={t("reports.openRfis")} value={report.rfis.open} testId="report-open-rfis" />
          <Metric label={t("reports.overdueRfis")} value={report.rfis.overdue} tone="danger" />
          <Metric label={t("reports.averageResponse")} value={report.rfis.averageResponseDays === null ? "—" : t("ui.days", { count: report.rfis.averageResponseDays })} />
          <Metric label={t("reports.reviewsOverdue")} value={report.submittals.overdueReviews} tone="danger" />
          <Metric label={t("reports.avgRevisions")} value={report.submittals.averageRevisions ?? "—"} />
          <Metric label={t("reports.documentsPending")} value={report.documents.pendingReview} />
          <Metric label={t("reports.supersededDocuments")} value={report.documents.superseded} />
          {report.compliance ? <Metric label={t("reports.complianceAlerts")} value={report.compliance.alerts} tone="warning" /> : null}
        </MetricStrip>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
          <Panel title={t("reports.rfisByContractor")}>
            <Bars rows={report.rfis.byContractor} empty={t("reports.noRfis")} />
          </Panel>
          <Panel title={t("reports.rfisByDiscipline")}>
            <Bars rows={translated(report.rfis.byDiscipline, "discipline")} empty={t("reports.noRfis")} />
          </Panel>
          <Panel title={t("reports.submittalsByStatus")}>
            <Bars rows={translated(report.submittals.byStatus, "reviewStatus")} empty={t("reports.noSubmittals")} />
          </Panel>
          <Panel title={t("reports.submittalsByType")}>
            <Bars rows={translated(report.submittals.byType, "submittalType")} empty={t("reports.noSubmittals")} />
          </Panel>
          <Panel title={t("reports.submittalsByContractor")}>
            <Bars rows={report.submittals.byContractor} empty={t("reports.noSubmittals")} />
          </Panel>
          <Panel title={t("reports.documentsByDiscipline")}>
            <Bars rows={translated(report.documents.byDiscipline, "discipline")} empty={t("reports.noDocuments")} />
          </Panel>
          <Panel title={t("reports.documentsByStatus")}>
            <Bars rows={translated(report.documents.byStatus, "reviewStatus")} empty={t("reports.noDocuments")} />
          </Panel>
          {report.compliance ? (
            <Panel title={t("reports.contractorCompliance")}>
              <Bars rows={report.compliance.byStatus} empty={t("reports.noCompliance")} />
            </Panel>
          ) : null}
        </div>
        {report.contractors ? (
          <Panel title={t("reports.contractorsByProject")}>
            {report.contractors.byProject.length === 0 ? (
              <EmptyNote>{t("reports.noContractors")}</EmptyNote>
            ) : (
              <ul className="divide-y divide-line">
                {report.contractors.byProject.map((row) => (
                  <li key={row.projectId} className="flex items-center justify-between gap-3 py-2 text-table">
                    <Link href={`/projects/${row.projectId}/contractors`} className="text-fg hover:underline">
                      {row.projectName}
                    </Link>
                    <span className="tabular-nums text-fg-muted">
                      {t("reports.contractors", { count: row.contractors })} · {t("reports.openPackages", { count: row.activeWorkPackages })}
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
