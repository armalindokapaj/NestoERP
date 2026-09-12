import type { Metadata } from "next";

import { InventoryActivityFeed } from "@/components/inventory/record-activity";
import { ItemPageShell, loadItemPage } from "../item-shell";

export const metadata: Metadata = { title: "Activity" };

type Params = { params: Promise<{ itemId: string }> };

/** One item's history (PRD #20 §199). */
export default async function ItemActivityPage({ params }: Params) {
  const { itemId } = await params;
  const { context, item } = await loadItemPage(itemId, "activity");

  return (
    <ItemPageShell item={item} tab="activity">
      <InventoryActivityFeed context={context} entityType="InventoryItem" entityId={itemId} />
    </ItemPageShell>
  );
}
