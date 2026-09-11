import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Files } from "lucide-react";

import { DocumentTable } from "@/components/documents/document-table";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";
import { clientBreadcrumbs, loadClient } from "../client-context";
import { ClientTabs } from "../client-tabs";

type Params = { params: Promise<{ clientId: string }> };

export const metadata: Metadata = { title: "Documents" };

/**
 * Client documents (PRD #12 §96–§99, PRD #13 §198).
 *
 * Documents filed directly against the client. A generic `document.view` never
 * reaches a client this reader cannot open (PRD #12 §99).
 */
export default async function ClientDocumentsPage({ params }: Params) {
  const { clientId } = await params;
  const { context, client } = await loadClient(clientId);

  if (!client.capabilities.canViewDocuments) notFound();

  const query = documentListQuerySchema.parse({ clientId, limit: 100 });
  const result = await documents.listDocuments(context, query);

  const archived = client.archivedAt !== null || client.status === "ARCHIVED";
  const canUpload = !archived && can(context, "document.create");
  const uploadHref = `/documents/new?clientId=${client.id}`;

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={clientBreadcrumbs(client, "Documents")}
        title={client.name}
        subtitle={client.code ?? undefined}
        status={client.status}
        actions={
          canUpload ? (
            <Button asChild size="sm">
              <Link href={uploadHref}>Add document</Link>
            </Button>
          ) : null
        }
      />

      <ClientTabs
        clientId={client.id}
        active="documents"
        capabilities={client.capabilities}
      />

      {result.data.length === 0 ? (
        <EmptyState
          icon={<Files />}
          title="No client documents yet."
          description="Files filed against this client will appear here."
          action={canUpload ? { label: "Add document", href: uploadHref } : undefined}
        />
      ) : (
        <DocumentTable documents={result.data} />
      )}
    </div>
  );
}
