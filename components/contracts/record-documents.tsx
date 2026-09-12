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
 * Documents filed against a legal record (PRD #18 §196–§204).
 *
 * The canonical Document records, under `module: "contracts"`. There is no
 * ContractDocument: a file here is reachable because the reader can reach the
 * record it is filed against, which the parent-access resolver decides — and it
 * fails closed for anything unregistered (PRD #18 §199, §437).
 *
 * There is no "replace" action. A corrected signed copy is a new document, so
 * the file that was actually executed is never overwritten (PRD #18 §204).
 */
export async function ContractRecordDocuments({
  context,
  entityType,
  entityId,
  emptyDescription,
}: {
  context: UserContext;
  entityType: "contract" | "amendment" | "obligation";
  entityId: string;
  emptyDescription?: string;
}) {
  const query = documentListQuerySchema.parse({
    moduleKey: "contracts",
    entityType,
    entityId,
    limit: 100,
  });

  const result = await documents.listDocuments(context, query);
  const uploadHref = `/documents/new?module=contracts&entityType=${entityType}&entityId=${entityId}`;
  const mayUpload = can(context, "legal.document.create") && can(context, "document.create");

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<Files />}
        title="No documents on file."
        description={
          emptyDescription ??
          "Drafts, executed copies and supporting papers filed against this record appear here."
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
