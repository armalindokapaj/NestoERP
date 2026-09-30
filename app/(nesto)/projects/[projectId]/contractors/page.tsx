import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";

import { AssignContractorButton, NewWorkPackageButton } from "@/components/contractors/contractor-dialogs";
import { CompliancePanel } from "@/components/contractors/contractor-panels";
import { AssignmentTable, WorkPackageTable } from "@/components/contractors/contractor-tables";
import { Metric, MetricStrip } from "@/components/engineering/engineering-ui";
import { orNotFound } from "@/components/engineering/page-helpers";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/access/can";
import { listProjectAssignments } from "@/lib/modules/contractors/contractor.assignments";
import { listContractorCompliance } from "@/lib/modules/contractors/contractor.compliance";
import { contractorsOpen } from "@/lib/modules/contractors/contractor.permissions";
import { COMPLIANCE_ALERT_STATUSES } from "@/lib/modules/contractors/contractor.types";
import * as projects from "@/lib/modules/projects/project.service";
import { workPackageListSchema } from "@/lib/modules/contractors/contractor.schema";
import { listProjectWorkPackages } from "@/lib/modules/work-packages/work-package.service";
import { loadProject, } from "../project-context";

type Params = { params: Promise<{ projectId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("contractorsTab.title") };
}

/**
 * Who builds the project (PRD #46 §9, §161): each contractor's assignment,
 * contract, manager and open engineering actions; the work packages; and the
 * compliance that is expiring, expired or missing.
 */
export default async function ProjectContractorsPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  const actions = projects.projectActions(context);
  if (!actions.canViewContractors) redirect("/access-denied");

  const archived = project.archivedAt !== null || project.status === "ARCHIVED";
  const [assignments, packages] = await Promise.all([
    orNotFound(listProjectAssignments(context, project.id)),
    contractorsOpen(context, "work_package.view") ? listProjectWorkPackages(context, project.id, workPackageListSchema.parse({})) : Promise.resolve([]),
  ]);
  const live = assignments.filter((row) => row.status !== "TERMINATED" && row.status !== "COMPLETED");
  const compliance = contractorsOpen(context, "contractor_compliance.view")
    ? (await Promise.all(live.map((row) => listContractorCompliance(context, row.contractor.id).catch(() => [])))).flat().filter((item) => COMPLIANCE_ALERT_STATUSES.includes(item.status))
    : [];
  const openRfis = assignments.reduce((sum, row) => sum + row.openRfis, 0);
  const openSubmittals = assignments.reduce((sum, row) => sum + row.openSubmittals, 0);

  return (
    <div className="space-y-6">
      <RecordContextHeader title={project.name} subtitle={project.code} status={project.status} />
      <MetricStrip className="xl:grid-cols-5">
        <Metric label={t("contractorsTab.activeContractors")} value={assignments.filter((row) => row.status === "ACTIVE").length} testId="metric-active-contractors" />
        <Metric label={t("contractorsTab.openWorkPackages")} value={packages.filter((row) => ["PLANNED", "ACTIVE", "AT_RISK", "ON_HOLD"].includes(row.status)).length} href={`/projects/${project.id}/work-packages`} />
        <Metric label={t("contractorsTab.openRfis")} value={openRfis} href={actions.canViewEngineering ? `/projects/${project.id}/engineering/rfis?open=1` : undefined} />
        <Metric label={t("contractorsTab.openSubmittals")} value={openSubmittals} href={actions.canViewEngineering ? `/projects/${project.id}/engineering/submittals` : undefined} />
        <Metric label={t("contractorsTab.complianceAlerts")} value={compliance.length} tone="warning" testId="metric-project-compliance" />
      </MetricStrip>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-section font-semibold text-fg">{t("contractorsTab.contractors")}</h2>
            <p className="mt-0.5 text-table text-fg-muted">{t("contractorsTab.contractorsBody")}</p>
          </div>
          {!archived && can(context, "project_contractor.manage") ? <AssignContractorButton projectId={project.id} /> : null}
        </div>
        <AssignmentTable items={assignments} view="project" />
      </section>

      {contractorsOpen(context, "work_package.view") ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-section font-semibold text-fg">{t("contractorsTab.workPackages")}</h2>
              <p className="mt-0.5 text-table text-fg-muted">{t("contractorsTab.workPackagesBody")}</p>
            </div>
            <div className="flex gap-2">
              <Button asChild size="sm" variant="secondary">
                <Link href={`/projects/${project.id}/work-packages`}>{t("contractorsTab.allWorkPackages")}</Link>
              </Button>
              {!archived && can(context, "work_package.create") ? <NewWorkPackageButton projectId={project.id} /> : null}
            </div>
          </div>
          <WorkPackageTable items={packages.slice(0, 12)} />
        </section>
      ) : null}

      {contractorsOpen(context, "contractor_compliance.view") ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-section font-semibold text-fg">{t("contractorsTab.complianceAlerts")}</h2>
            <p className="mt-0.5 text-table text-fg-muted">{t("contractorsTab.complianceBody")}</p>
          </div>
          <CompliancePanel contractorId={null} items={compliance} canManage={false} canUpload={false} showContractor />
        </section>
      ) : null}
    </div>
  );
}
