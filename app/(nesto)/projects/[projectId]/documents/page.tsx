import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { Files } from "lucide-react";

import { Pagination } from "@/components/data/pagination";
import { DocumentTable } from "@/components/documents/document-table";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";
import { firstValue, listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("tabs.documents") };
}

/**
 * Project documents (PRD #10 §83, PRD #13 §197).
 *
 * The same canonical Document records as /documents, filtered to this project.
 * A document here is reachable only because the reader can reach the project —
 * a bare `document.view` is never enough (PRD #13 §4, §37).
 */
export default async function ProjectDocumentsPage({ params, searchParams }: Params) {
  const { projectId } = await params;
  const raw = await searchParams;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  const actions = projects.projectActions(context);

  if (!actions.canViewDocuments) redirect("/access-denied");

  // Every document, a page of 100 at a time with a true count; it used to
  // show the first 100 and drop the rest silently (AUD-08 §4, DT-05).
  const page = Number.parseInt(firstValue(raw.page) ?? "1", 10);
  const query = documentListQuerySchema.parse({ projectId, limit: 100, page: Number.isFinite(page) && page > 0 ? page : 1 });
  const result = await documents.listDocuments(context, query);
  const basePath = `/projects/${project.id}/documents`;
  if (result.pagination.page !== query.page) redirect(listPageRedirect(basePath, raw, result.pagination.page));

  const archived = project.archivedAt !== null || project.status === "ARCHIVED";
  const canUpload = !archived && can(context, "document.create");
  const uploadHref = `/documents/new?projectId=${project.id}`;

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={await projectBreadcrumbs(project, "Documents")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          canUpload ? (
            <Button asChild size="sm">
              <Link href={uploadHref}>{t("tabPages.addDocument")}</Link>
            </Button>
          ) : null
        }
      />

      <ProjectTabs
        projectId={project.id}
        active="documents"
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

      {result.data.length === 0 ? (
        <EmptyState
          icon={<Files />}
          title={t("tabPages.noDocumentsTitle")}
          description={t("tabPages.noDocumentsBody")}
          action={canUpload ? { label: t("tabPages.addDocument"), href: uploadHref } : undefined}
        />
      ) : (
        <>
          <DocumentTable documents={result.data} listId="projects.documents" />
          <Pagination meta={result.pagination} buildHref={(next) => pageHref(basePath, raw, next)} />
        </>
      )}
    </div>
  );
}
