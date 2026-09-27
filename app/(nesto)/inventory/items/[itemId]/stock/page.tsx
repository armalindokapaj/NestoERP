import type { Metadata } from "next";
import { Warehouse } from "lucide-react";

import { StockTable } from "@/components/inventory/stock-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemPageShell, loadItemPage } from "../item-shell";

export const metadata: Metadata = { title: "Stock" };

type Params = { params: Promise<{ itemId: string }> };

/** One item, everywhere it is held (PRD #20 §180). */
export default async function ItemStockPage({ params }: Params) {
  const { itemId } = await params;
  const { item } = await loadItemPage(itemId, "stock");

  return (
    <ItemPageShell item={item} tab="stock">
      {item.byLocation.length === 0 ? (
        <EmptyState
          icon={<Warehouse />}
          title="Nothing on hand."
          description="None of this item is recorded in a location you can see."
        />
      ) : (
        <StockTable rows={item.byLocation} show="by-item" caption={`${item.name} by location`} listId="inventory.item-stock" />
      )}
    </ItemPageShell>
  );
}
