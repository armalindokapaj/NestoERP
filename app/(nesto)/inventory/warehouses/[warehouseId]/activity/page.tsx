import type { Metadata } from "next";

import { InventoryActivityFeed } from "@/components/inventory/record-activity";
import { WarehousePageShell, loadWarehousePage } from "../warehouse-shell";

export const metadata: Metadata = { title: "Activity" };

type Params = { params: Promise<{ warehouseId: string }> };

/** One warehouse's history (PRD #20 §199). */
export default async function WarehouseActivityPage({ params }: Params) {
  const { warehouseId } = await params;
  const { context, warehouse } = await loadWarehousePage(warehouseId, "activity");

  return (
    <WarehousePageShell warehouse={warehouse} tab="activity">
      <InventoryActivityFeed context={context} entityType="Warehouse" entityId={warehouseId} />
    </WarehousePageShell>
  );
}
