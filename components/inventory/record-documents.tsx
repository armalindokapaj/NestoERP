import type { UserContext } from "@/lib/context/types";
import { RecordDocuments } from "@/components/documents/record-documents";
import { getTranslations } from "@/lib/i18n/server";

/**
 * This module's record documents, through the shared section (PRD #38 §55).
 * Whether an upload is offered comes from the record registry, not from here.
 */
export async function InventoryRecordDocuments({
  context,
  entityType,
  entityId,
  emptyDescription,
}: {
  context: UserContext;
  entityType: "inventory_item" | "warehouse" | "inventory_receipt" | "stock_issue" | "stock_adjustment";
  entityId: string;
  emptyDescription?: string;
}) {
  const t = await getTranslations("inventory");
  return (
    <RecordDocuments
      context={context}
      entityType={entityType}
      entityId={entityId}
      emptyTitle={t("documents.emptyTitle")}
      emptyDescription={emptyDescription ?? t("documents.emptyDescription")}
    />
  );
}
