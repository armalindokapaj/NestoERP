import type { UserContext } from "@/lib/context/types";
import { RecordDocuments } from "@/components/documents/record-documents";
import { getTranslations } from "@/lib/i18n/server";

/**
 * This module's record documents, through the shared section (PRD #38 §55).
 * Whether an upload is offered comes from the record registry, not from here.
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
  const t = await getTranslations("sales");
  return (
    <RecordDocuments
      context={context}
      entityType={entityType}
      entityId={entityId}
      emptyTitle={t("common.noDocuments")}
      emptyDescription={emptyDescription ?? t("common.documentsDescription")}
    />
  );
}
