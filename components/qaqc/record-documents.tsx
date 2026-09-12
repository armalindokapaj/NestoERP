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
 * Files filed against a quality record (PRD #21 §175–§182).
 *
 * The canonical Document records, under `module: "qaqc"`. A photograph of a
 * failed check is reachable because the reader can reach the inspection it
 * hangs off, which the parent-access resolver decides — and it fails closed for
 * anything unregistered (PRD #21 §176, §177).
 */
export async function QaqcRecordDocuments({
  context,
  entityType,
  entityId,
  emptyDescription,
}: {
  context: UserContext;
  entityType:
    | "quality_inspection"
    | "quality_defect"
    | "non_conformance_report"
    | "corrective_action";
  entityId: string;
  emptyDescription?: string;
}) {
  const query = documentListQuerySchema.parse({
    moduleKey: "qaqc",
    entityType,
    entityId,
    limit: 100,
  });

  const result = await documents.listDocuments(context, query);
  const uploadHref = `/documents/new?module=qaqc&entityType=${entityType}&entityId=${entityId}`;
  const mayUpload = can(context, "qaqc.document.create") && can(context, "document.create");

  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<Files />}
        title="No documents on file."
        description={
          emptyDescription ??
          "Photographs, test certificates and signed records filed against this appear here."
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
