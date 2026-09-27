import type { UserContext } from "@/lib/context/types";
import { getTranslations } from "@/lib/i18n/server";
import { RecordDocuments } from "@/components/documents/record-documents";

/**
 * This module's record documents, through the shared section (PRD #38 §55).
 * Whether an upload is offered comes from the record registry, not from here.
 */
export async function QaqcRecordDocuments({
  context,
  entityType,
  entityId,
  emptyDescription,
}: {
  context: UserContext;
  entityType: "quality_inspection" | "quality_defect" | "non_conformance_report" | "corrective_action";
  entityId: string;
  emptyDescription?: string;
}) {
  const t = await getTranslations("qaqc");
  return (
    <RecordDocuments
      context={context}
      entityType={entityType}
      entityId={entityId}
      emptyTitle={t("documents.empty")}
      emptyDescription={emptyDescription ?? t("documents.emptyBody")}
    />
  );
}
