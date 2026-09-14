import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Files } from "lucide-react";

import { DocumentTable } from "@/components/documents/document-table";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Documents" };

/**
 * Project documents (PRD #10 §83, PRD #13 §197).
 *
 * The same canonical Document records as /documents, filtered to this project.
 * A document here is reachable only because the reader can reach the project —
 * a bare `document.view` is never enough (PRD #13 §4, §37).
 */
export default async function ProjectDocumentsPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);

  if (!actions.canViewDocuments) redirect("/access-denied");

  const query = documentListQuerySchema.parse({ projectId, limit: 100 });
  const result = await documents.listDocuments(context, query);

  const archived = project.archivedAt !== null || project.status === "ARCHIVED";
  const canUpload = !archived && can(context, "document.create");
  const uploadHref = `/documents/new?projectId=${project.id}`;

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={projectBreadcrumbs(project, "Documents")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          canUpload ? (
            <Button asChild size="sm">
              <Link href={uploadHref}>Add document</Link>
            </Button>
          ) : null
        }
      />

      <ProjectTabs
        projectId={project.id}
        active="documents"
        show={{
          tasks: actions.canViewTasks,
          calendar: actions.canViewCalendar,
          meetings: actions.canViewMeetings,
          dailyLogs: actions.canViewDailyLogs,
          team: actions.canViewMembers,
          finance: actions.canViewFinance,
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
          title="No documents have been added to this project."
          description="Files filed against this project will appear here."
          action={canUpload ? { label: "Add document", href: uploadHref } : undefined}
        />
      ) : (
        <DocumentTable documents={result.data} />
      )}
    </div>
  );
}
