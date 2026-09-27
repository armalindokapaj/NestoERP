import type { UserContext } from "@/lib/context/types";
import { RecordDocuments } from "@/components/documents/record-documents";
import { getTranslations } from "@/lib/i18n/server";

/**
 * This module's record documents, through the shared section (PRD #38 §55).
 * Whether an upload is offered comes from the record registry, not from here.
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
  const t = await getTranslations("hr");
  return (
    <RecordDocuments
      context={context}
      entityType={entityType}
      entityId={entityId}
      canAttach={canAttach}
      emptyTitle={t("documents.noneOnFile")}
      emptyDescription={emptyDescription ?? t("documents.noneOnFileDescription")}
    />
  );
}
