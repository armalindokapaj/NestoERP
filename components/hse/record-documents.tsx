import type { UserContext } from "@/lib/context/types";
import { RecordDocuments } from "@/components/documents/record-documents";
import { getTranslations } from "@/lib/i18n/server";

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
  const t = await getTranslations("hse");
  return (
    <RecordDocuments
      context={context}
      entityType={entityType}
      entityId={entityId}
      captureEvidence
      emptyTitle={t("documents.emptyTitle")}
      emptyDescription={emptyDescription ?? t("documents.emptyDescription")}
    />
  );
}
