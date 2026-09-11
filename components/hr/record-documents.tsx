import Link from "next/link";
import { Files } from "lucide-react";

import { DocumentTable } from "@/components/documents/document-table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";

/**
 * Documents filed against an HR record (PRD #16 §128–§135).
 *
 * The canonical Document records, under `module: "hr"`. There is no HrDocument:
 * a document here is reachable because the reader can reach the record it is
 * filed against, which the parent-access resolver decides — and it fails closed
 * for anything unregistered (PRD #16 §204, §205).
 */
export async function HrRecordDocuments({
  context,
  entityType,
  entityId,
  canAttach,
  emptyDescription,
}: {
  context: UserContext;
  entityType: "employee" | "leave_request";
  entityId: string;
  canAttach: boolean;
  emptyDescription?: string;
}) {
  const query = documentListQuerySchema.parse({
    moduleKey: "hr",
    entityType,
    entityId,
    limit: 100,
  });

  const result = await documents.listDocuments(context, query);
  const uploadHref = `/documents/new?module=hr&entityType=${entityType}&entityId=${entityId}`;
  const mayUpload = canAttach && can(context, "hr.document.create") && can(context, "document.create");

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<Files />}
        title="No documents on file."
        description={
          emptyDescription ??
          "Contracts, certificates and supporting files filed against this record appear here."
        }
        action={mayUpload ? { label: "Add document", href: uploadHref } : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      {mayUpload ? (
        <div className="flex justify-end">
          <Button asChild size="sm">
            <Link href={uploadHref}>Add document</Link>
          </Button>
        </div>
      ) : null}
      <DocumentTable documents={result.data} />
    </div>
  );
}
