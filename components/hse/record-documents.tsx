import type { UserContext } from "@/lib/context/types";
import { RecordDocuments } from "@/components/documents/record-documents";

export type HseDocumentParent =
  | "hse_inspection"
  | "hazard"
  | "incident"
  | "risk_assessment"
  | "hse_action"
  | "toolbox_talk"
  | "work_permit"
  | "environmental_observation"
  | "stop_work";

/**
 * This module's record documents, through the shared section (PRD #38 §55).
 * Whether an upload is offered comes from the record registry, not from here.
 */
export async function HseRecordDocuments({
  context,
  entityType,
  entityId,
  emptyDescription,
}: {
  context: UserContext;
  entityType: HseDocumentParent;
  entityId: string;
  emptyDescription?: string;
}) {
  return (
    <RecordDocuments
      context={context}
      entityType={entityType}
      entityId={entityId}
      emptyTitle="No documents on file."
      emptyDescription={emptyDescription ?? "Photographs, signed sheets and supporting records filed against this appear here."}
    />
  );
}
