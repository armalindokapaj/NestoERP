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
 * Documents filed against a sales record (PRD #17 §141–§146, §265).
 *
 * The canonical Document records, under `module: "sales"`. There is no
 * SalesDocument: a file here is reachable because the reader can reach the
 * record it is filed against, which the parent-access resolver decides — and it
 * fails closed for anything unregistered (PRD #17 §142, §335).
 */
export async function SalesRecordDocuments({
  context,
  entityType,
  entityId,
  emptyDescription,
}: {
  context: UserContext;
  entityType: "lead" | "opportunity" | "proposal";
  entityId: string;
  emptyDescription?: string;
}) {
  const query = documentListQuerySchema.parse({
    moduleKey: "sales",
    entityType,
    entityId,
    limit: 100,
  });

  const result = await documents.listDocuments(context, query);
  const uploadHref = `/documents/new?module=sales&entityType=${entityType}&entityId=${entityId}`;
  const mayUpload =
    can(context, "sales.document.create") && can(context, "document.create");

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<Files />}
        title="No documents on file."
        description={
          emptyDescription ??
          "Briefs, requirements and commercial attachments filed against this record appear here."
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
