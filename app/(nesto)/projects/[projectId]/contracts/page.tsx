import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Scale } from "lucide-react";

import { ContractTable } from "@/components/contracts/contract-table";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Project contracts" };

/**
 * The agreements attached to one project (PRD #18 §11, §440).
 *
 * The same canonical Contract records filtered by `projectId` — not a second
 * table. Being given a project does not by itself hand somebody its contracts:
 * the tab needs a legal permission, and the contract scope narrows the rows
 * again on the way out (PRD #18 §248, §251).
 */
export default async function ProjectContractsPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);

  if (!actions.canViewContracts) redirect("/access-denied");

  const rows = await contracts.listForProject(context, projectId);

  // Preselects the project, and the client behind it when the reader may name
  // that client: the create form re-validates both (PRD #18 §55, §368).
  const params_ = new URLSearchParams({ projectId: project.id });
  if (project.client) params_.set("clientId", project.client.id);
  const createHref = `/contracts/new?${params_.toString()}`;
  const mayCreate = can(context, "legal.contract.create");

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={projectBreadcrumbs(project, "Contracts")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          mayCreate ? (
            <Button asChild size="sm">
              <Link href={createHref}>New contract</Link>
            </Button>
          ) : null
        }
      />

      <ProjectTabs
        projectId={project.id}
        active="contracts"
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
          contracts: true,
          inventory: actions.canViewInventory,
          qaqc: actions.canViewQaqc,
          hse: actions.canViewHse,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Scale />}
          title="No contracts on this project."
          description="Agreements attached to this project appear here, with their parties, value and dates."
          action={mayCreate ? { label: "New contract", href: createHref } : undefined}
        />
      ) : (
        <ContractTable
          contracts={rows}
          showProject={false}
          caption={`Contracts on ${project.name}`}
        />
      )}
    </div>
  );
}
