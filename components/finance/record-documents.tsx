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
 * Documents attached to a finance record (PRD #15 §187, §323–§326).
 *
 * The canonical Document records, filed under `module: "finance"` with this
 * record's `entityType` and `entityId`. There is no FinanceDocument: a document
 * here is reachable because the reader can reach the finance record, which the
 * parent-access resolver enforces (PRD #15 §188).
 */
export async function FinanceRecordDocuments({
  context,
  entityType,
  entityId,
  canAttach,
}: {
  context: UserContext;
  entityType: "invoice" | "expense" | "budget" | "commitment";
  entityId: string;
  canAttach: boolean;
}) {
  const query = documentListQuerySchema.parse({
    moduleKey: "finance",
    entityType,
    entityId,
    limit: 100,
  });

  const result = await documents.listDocuments(context, query);
  const uploadHref = `/documents/new?module=finance&entityType=${entityType}&entityId=${entityId}`;
  const mayUpload = canAttach && can(context, "document.create");

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<Files />}
        title="No documents attached."
        description="Contracts, receipts and supporting files attached to this record appear here."
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
