import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { Warehouse } from "lucide-react";

import { StockTable } from "@/components/inventory/stock-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemPageShell, loadItemPage } from "../item-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.stock") };
}

type Params = { params: Promise<{ itemId: string }> };

/** One item, everywhere it is held (PRD #20 §180). */
export default async function ItemStockPage({ params }: Params) {
  const { itemId } = await params;
  const { item } = await loadItemPage(itemId, "stock");
  const t = await getTranslations("inventory");

  return (
    <ItemPageShell item={item} tab="stock">
      {item.byLocation.length === 0 ? (
        <EmptyState
          icon={<Warehouse />}
          title={t("detail.nothingOnHand")}
          description={t("detail.itemNoLocation")}
        />
      ) : (
        <StockTable rows={item.byLocation} show="by-item" caption={t("detail.byLocation", { name: item.name })} listId="inventory.item-stock" />
      )}
    </ItemPageShell>
  );
}
