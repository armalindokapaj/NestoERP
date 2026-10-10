import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";

import { InventoryActivityFeed } from "@/components/inventory/record-activity";
import { loadWarehousePage } from "../../warehouse-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.activity") };
}

type Params = { params: Promise<{ warehouseId: string }> };

/** One warehouse's history (PRD #20 §199). */
export default async function WarehouseActivityPage({ params }: Params) {
  const { warehouseId } = await params;
  const { context, warehouse } = await loadWarehousePage(warehouseId, "activity");

  return (
    <>
      <InventoryActivityFeed context={context} entityType="Warehouse" entityId={warehouseId} />
    </>
  );
}
