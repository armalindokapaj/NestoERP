import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";

import { LocationList } from "@/components/inventory/location-list";
import { WarehousePageShell, loadWarehousePage } from "../warehouse-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.locations") };
}

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
