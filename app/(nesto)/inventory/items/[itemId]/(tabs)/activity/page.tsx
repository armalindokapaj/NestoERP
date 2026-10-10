import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";

import { InventoryActivityFeed } from "@/components/inventory/record-activity";
import { loadItemPage } from "../../item-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.activity") };
}

type Params = { params: Promise<{ itemId: string }> };

/** One item's history (PRD #20 §199). */
export default async function ItemActivityPage({ params }: Params) {
  const { itemId } = await params;
  const { context, item } = await loadItemPage(itemId, "activity");

  return (
    <>
      <InventoryActivityFeed context={context} entityType="InventoryItem" entityId={itemId} />
    </>
  );
}
