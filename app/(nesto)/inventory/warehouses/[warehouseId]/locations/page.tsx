import type { Metadata } from "next";

import { LocationList } from "@/components/inventory/location-list";
import { WarehousePageShell, loadWarehousePage } from "../warehouse-shell";

export const metadata: Metadata = { title: "Locations" };

type Params = { params: Promise<{ warehouseId: string }> };

/** The bins inside a warehouse (PRD #20 §61–§66). */
export default async function WarehouseLocationsPage({ params }: Params) {
  const { warehouseId } = await params;
  const { warehouse } = await loadWarehousePage(warehouseId, "locations");

  return (
    <WarehousePageShell warehouse={warehouse} tab="locations">
      <LocationList
        warehouseId={warehouse.id}
        locations={warehouse.locations}
        canCreate={warehouse.capabilities.canManageLocations}
      />
    </WarehousePageShell>
  );
}
