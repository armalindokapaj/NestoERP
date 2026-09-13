import type { UserContext } from "@/lib/context/types";
import { RecordDocuments } from "@/components/documents/record-documents";

/**
 * This module's record documents, through the shared section (PRD #38 §55).
 * Whether an upload is offered comes from the record registry, not from here.
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
  return (
    <RecordDocuments
      context={context}
      entityType={entityType}
      entityId={entityId}
      emptyTitle="No documents on file."
      emptyDescription={emptyDescription ?? "Drafts, executed copies and supporting papers filed against this record appear here."}
    />
  );
}
