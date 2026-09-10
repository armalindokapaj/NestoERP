import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Files } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { RecordContextHeader } from "@/components/modules/record-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buildDocumentScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import * as projects from "@/lib/modules/projects/project.service";
import { formatDate } from "@/lib/utils/format";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Documents" };

type Row = {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: bigint | null;
  status: string;
  createdAt: Date;
};

/**
 * Project documents (PRD #10 §83, §86).
 *
 * A document on this project is reachable only because the person can reach the
 * project: a bare `document.view` is never enough (PRD #8 §43).
 */
export default async function ProjectDocumentsPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);

  if (!actions.canViewDocuments) redirect("/access-denied");

  const documents: Row[] = await prisma.document.findMany({
    where: { AND: [buildDocumentScopeWhere(context), { projectId }] },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, name: true, mimeType: true, sizeBytes: true, status: true, createdAt: true },
  });

  const columns: TableColumn<Row>[] = [
    { key: "name", label: "Document", primary: true, render: (row) => row.name },
    {
      key: "type",
      label: "Type",
      hideBelow: "lg",
      render: (row) => row.mimeType?.split("/").pop()?.toUpperCase() ?? "—",
    },
    {
      key: "size",
      label: "Size",
      hideBelow: "xl",
      align: "right",
      render: (row) => (row.sizeBytes ? `${Math.round(Number(row.sizeBytes) / 1024)} KB` : "—"),
    },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "created",
      label: "Added",
      hideBelow: "lg",
      render: (row) => formatDate(row.createdAt),
    },
  ];

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={projectBreadcrumbs(project, "Documents")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
      />

      <ProjectTabs
        projectId={project.id}
        active="documents"
        show={{
          tasks: actions.canViewTasks,
          team: actions.canViewMembers,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />

      {documents.length === 0 ? (
        <EmptyState
          icon={<Files />}
          title="No documents on this project."
          description="Documents filed against this project will appear here."
        />
      ) : (
        <DataTable
          caption={`${project.name} documents`}
          columns={columns}
          records={documents}
          rowKey={(row) => row.id}
        />
      )}
    </div>
  );
}
