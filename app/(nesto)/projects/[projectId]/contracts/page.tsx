import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { Scale } from "lucide-react";

import { ContractTable } from "@/components/contracts/contract-table";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, } from "../project-context";

type Params = { params: Promise<{ projectId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("tabPages.contractsTitle") };
}

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
  const t = await getTranslations("projects");
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
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          mayCreate ? (
            <Button asChild size="sm">
              <Link href={createHref}>{t("tabPages.newContract")}</Link>
            </Button>
          ) : null
        }
      />


      {rows.length === 0 ? (
        <EmptyState
          icon={<Scale />}
          title={t("tabPages.noContractsTitle")}
          description={t("tabPages.noContractsBody")}
          action={mayCreate ? { label: t("tabPages.newContract"), href: createHref } : undefined}
        />
      ) : (
        <ContractTable
          contracts={rows}
          showProject={false}
          caption={t("tabPages.contractsCaption", { name: project.name })}
        />
      )}
    </div>
  );
}
