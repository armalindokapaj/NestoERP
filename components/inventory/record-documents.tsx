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
 * Files filed against a stock record (PRD #20 §189–§196).
 *
 * The canonical Document records, under `module: "inventory"`. There is no
 * InventoryDocument: a file here is reachable because the reader can reach the
 * record it hangs off, which the parent-access resolver decides — and it fails
 * closed for anything unregistered (PRD #20 §190, §191).
 */
export async function InventoryRecordDocuments({
  context,
  entityType,
  entityId,
  emptyDescription,
}: {
  context: UserContext;
  entityType:
    | "inventory_item"
    | "warehouse"
    | "inventory_receipt"
    | "stock_issue"
    | "stock_adjustment";
  entityId: string;
  emptyDescription?: string;
}) {
  const query = documentListQuerySchema.parse({
    moduleKey: "inventory",
    entityType,
    entityId,
    limit: 100,
  });

  const result = await documents.listDocuments(context, query);
  const uploadHref = `/documents/new?module=inventory&entityType=${entityType}&entityId=${entityId}`;
  const mayUpload = can(context, "inventory.document.create") && can(context, "document.create");

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<Files />}
        title="No documents on file."
        description={
          emptyDescription ??
          "Delivery notes, photographs and count sheets filed against this record appear here."
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
