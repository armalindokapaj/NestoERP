import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FolderKanban } from "lucide-react";

import { ProjectTable } from "@/components/projects/project-table";
import { RecordContextHeader } from "@/components/modules/record-header";
import { EmptyState } from "@/components/ui/empty-state";
import * as clients from "@/lib/modules/clients/client.service";
import { clientBreadcrumbs, loadClient } from "../client-context";
import { ClientTabs } from "../client-tabs";

type Params = { params: Promise<{ clientId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("clients"))("meta.projects") };
}

/**
 * Projects linked to a client (PRD #12 §91–§94).
 *
 * The same canonical Project records as /projects, narrowed to this client and
 * to the caller's own project scope: a client may have four projects and this
 * reader may see two, and the count shown is the two (PRD #12 §93).
 */
export default async function ClientProjectsPage({ params }: Params) {
  const { clientId } = await params;
  const { context, client } = await loadClient(clientId);

  if (!client.capabilities.canViewProjects) notFound();
  const t = await getTranslations("clients");

  const { rows, total, cap } = await clients.listClientProjectsWithTotal(context, clientId);

  const projects = rows.map((project) => ({
    id: project.id,
    code: project.code,
    name: project.name,
    status: project.status,
    priority: project.priority,
    client: project.client,
    projectManager: project.projectManager
      ? {
          memberId: project.projectManager.id,
          fullName: `${project.projectManager.user.firstName} ${project.projectManager.user.lastName}`,
        }
      : null,
    startDate: project.startDate?.toISOString() ?? null,
    endDate: project.endDate?.toISOString() ?? null,
    teamSize: project._count.members,
    updatedAt: project.updatedAt.toISOString(),
    archivedAt: project.archivedAt?.toISOString() ?? null,
  }));

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={clientBreadcrumbs(client, t("tabs.projects"), t("meta.clients"))}
        title={client.name}
        subtitle={client.code ?? undefined}
        status={client.status}
      />

      <ClientTabs
        clientId={client.id}
        active="projects"
        capabilities={client.capabilities}
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title={t("projectsPage.emptyTitle")}
          description={t("projectsPage.emptyDescription")}
        />
      ) : (
        <>
          <ProjectTable projects={projects} listId="clients.projects" />
          {/* The true count, and the cap said out loud when it bites (AUD-08 §4). */}
          <p className="text-table text-fg-muted" data-testid="pagination-count">
            {total > projects.length ? (
              t("projectsPage.showing", { shown: projects.length, total, cap })
            ) : (
              t("projectsPage.count", { count: total })
            )}
          </p>
        </>
      )}
    </div>
  );
}
