import type { Metadata } from "next";
import Link from "next/link";
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
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Project contractors" };

/**
 * Who builds the project (PRD #46 §9, §161): each contractor's assignment,
 * contract, manager and open engineering actions; the work packages; and the
 * compliance that is expiring, expired or missing.
 */
export default async function ProjectContractorsPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
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
      <RecordContextHeader breadcrumbs={projectBreadcrumbs(project, "Contractors")} title={project.name} subtitle={project.code} status={project.status} />
      <ProjectTabs
        projectId={project.id}
        active="contractors"
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
      <MetricStrip className="xl:grid-cols-5">
        <Metric label="Active contractors" value={assignments.filter((row) => row.status === "ACTIVE").length} testId="metric-active-contractors" />
        <Metric label="Open work packages" value={packages.filter((row) => ["PLANNED", "ACTIVE", "AT_RISK", "ON_HOLD"].includes(row.status)).length} href={`/projects/${project.id}/work-packages`} />
        <Metric label="Open RFIs" value={openRfis} href={actions.canViewEngineering ? `/projects/${project.id}/engineering/rfis?open=1` : undefined} />
        <Metric label="Open submittals" value={openSubmittals} href={actions.canViewEngineering ? `/projects/${project.id}/engineering/submittals` : undefined} />
        <Metric label="Compliance alerts" value={compliance.length} tone="warning" testId="metric-project-compliance" />
      </MetricStrip>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-section font-semibold text-fg">Contractors</h2>
            <p className="mt-0.5 text-table text-fg-muted">Each assignment has its own status, scope, contract and internal manager.</p>
          </div>
          {!archived && can(context, "project_contractor.manage") ? <AssignContractorButton projectId={project.id} /> : null}
        </div>
        <AssignmentTable items={assignments} view="project" />
      </section>

      {contractorsOpen(context, "work_package.view") ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-section font-semibold text-fg">Work packages</h2>
              <p className="mt-0.5 text-table text-fg-muted">Scope units tying contractor, contract, dates and records together.</p>
            </div>
            <div className="flex gap-2">
              <Button asChild size="sm" variant="secondary">
                <Link href={`/projects/${project.id}/work-packages`}>All work packages</Link>
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
            <h2 className="text-section font-semibold text-fg">Compliance alerts</h2>
            <p className="mt-0.5 text-table text-fg-muted">Expiring, expired or missing items for the contractors working on this project.</p>
          </div>
          <CompliancePanel contractorId={null} items={compliance} canManage={false} canUpload={false} showContractor />
        </section>
      ) : null}
    </div>
  );
}
