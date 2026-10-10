import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";

import { InventoryRecordDocuments } from "@/components/inventory/record-documents";
import { loadItemPage } from "../../item-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.documents") };
}

type Params = { params: Promise<{ itemId: string }> };

/** Files filed against an item (PRD #20 §192). */
export default async function ItemDocumentsPage({ params }: Params) {
  const { itemId } = await params;
  const { context, item } = await loadItemPage(itemId, "documents");
  const t = await getTranslations("inventory");

  return (
    <>
      <InventoryRecordDocuments
        context={context}
        entityType="inventory_item"
        entityId={itemId}
        emptyDescription={t("documents.itemEmpty")}
      />
    </>
  );
}
