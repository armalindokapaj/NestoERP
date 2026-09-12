import type { Metadata } from "next";

import { InventoryRecordDocuments } from "@/components/inventory/record-documents";
import { ItemPageShell, loadItemPage } from "../item-shell";

export const metadata: Metadata = { title: "Documents" };

type Params = { params: Promise<{ itemId: string }> };

/** Files filed against an item (PRD #20 §192). */
export default async function ItemDocumentsPage({ params }: Params) {
  const { itemId } = await params;
  const { context, item } = await loadItemPage(itemId, "documents");

  return (
    <ItemPageShell item={item} tab="documents">
      <InventoryRecordDocuments
        context={context}
        entityType="inventory_item"
        entityId={itemId}
        emptyDescription="Specifications, datasheets and certificates for this item appear here."
      />
    </ItemPageShell>
  );
}
