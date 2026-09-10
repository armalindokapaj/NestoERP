import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Files } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { RecordContextHeader } from "@/components/modules/record-header";
import { EmptyState } from "@/components/ui/empty-state";
import { buildDocumentScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import { formatDate } from "@/lib/utils/format";
import { clientBreadcrumbs, loadClient } from "../client-context";
import { ClientTabs } from "../client-tabs";

type Params = { params: Promise<{ clientId: string }> };

export const metadata: Metadata = { title: "Documents" };

type Row = { id: string; name: string; mimeType: string | null; createdAt: Date };

/**
 * Client documents (PRD #12 §96–§99).
 *
 * Documents linked directly to the client, and only those the document scope
 * already allows: a generic `document.view` never reaches a client this reader
 * cannot open (PRD #12 §99).
 */
export default async function ClientDocumentsPage({ params }: Params) {
  const { clientId } = await params;
  const { context, client } = await loadClient(clientId);

  if (!client.capabilities.canViewDocuments) notFound();

  const documents: Row[] = await prisma.document.findMany({
    where: { AND: [buildDocumentScopeWhere(context), { clientId, status: "ACTIVE" }] },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, name: true, mimeType: true, createdAt: true },
  });

  const columns: TableColumn<Row>[] = [
    {
      key: "name",
      label: "Document",
      primary: true,
      render: (document) => (
        <Link href={`/documents/all/${document.id}`} className="hover:text-accent">
          {document.name}
        </Link>
      ),
    },
    {
      key: "type",
      label: "Type",
      hideBelow: "md",
      render: (document) => <span className="text-fg-muted">{document.mimeType ?? "—"}</span>,
    },
    {
      key: "added",
      label: "Added",
      hideBelow: "md",
      render: (document) => (
        <span className="text-fg-muted">{formatDate(document.createdAt)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={clientBreadcrumbs(client, "Documents")}
        title={client.name}
        subtitle={client.code ?? undefined}
        status={client.status}
      />

      <ClientTabs
        clientId={client.id}
        active="documents"
        show={{
          contacts: client.capabilities.canViewContacts,
          projects: client.capabilities.canViewProjects,
          documents: true,
          activity: client.capabilities.canViewActivity,
        }}
      />

      {documents.length === 0 ? (
        <EmptyState
          icon={<Files />}
          title="No client documents yet."
          description="Documents filed against this client will appear here."
        />
      ) : (
        <DataTable
          caption={`${client.name} documents`}
          columns={columns}
          records={documents}
          rowKey={(document) => document.id}
        />
      )}
    </div>
  );
}
