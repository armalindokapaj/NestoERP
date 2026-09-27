import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { WarehouseActions } from "@/components/inventory/warehouse-actions";
import { RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as warehouses from "@/lib/modules/inventory/warehouses/warehouse.service";
import { warehouseTypeLabels } from "@/lib/modules/inventory/inventory.status";
import { getTranslations } from "@/lib/i18n/server";
import { inventoryLabel } from "@/components/inventory/inventory-labels";
import type { WarehouseDetailDTO } from "@/lib/modules/inventory/inventory.types";
import { cn } from "@/lib/utils/cn";

/**
 * Warehouse record tabs and the furniture around them (PRD #20 §307, §308).
 *
 * A tab renders only when the reader may open what it leads to, and asking for
 * one they cannot open is a 404 rather than a 403: the record's existence is
 * itself information (PRD #7 §60).
 */
const TABS = [
  { key: "overview", label: "tabs.overview", suffix: "" },
  { key: "locations", label: "meta.locations", suffix: "/locations" },
  { key: "stock", label: "meta.stock", suffix: "/stock" },
  { key: "movements", label: "meta.movements", suffix: "/movements" },
  { key: "activity", label: "meta.activity", suffix: "/activity" },
] as const;

export type WarehouseTabKey = (typeof TABS)[number]["key"];

export async function loadWarehousePage(
  warehouseId: string,
  tab: WarehouseTabKey,
): Promise<{ context: UserContext; warehouse: WarehouseDetailDTO }> {
  const context = await requireModule("inventory");

  let warehouse: WarehouseDetailDTO;
  try {
    warehouse = await warehouses.getWarehouse(context, warehouseId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const allowed: Record<WarehouseTabKey, boolean> = {
    overview: true,
    locations: warehouse.locations.length > 0 || warehouse.capabilities.canManageLocations,
    stock: warehouse.capabilities.canViewStock,
    movements: warehouse.capabilities.canViewMovements,
    activity: warehouse.capabilities.canViewActivity,
  };
  if (!allowed[tab]) notFound();

  return { context, warehouse };
}

export async function WarehousePageShell({
  warehouse,
  tab,
  children,
}: {
  warehouse: WarehouseDetailDTO;
  tab: WarehouseTabKey;
  children: React.ReactNode;
}) {
  const t = await getTranslations("inventory");
  const show: Record<WarehouseTabKey, boolean> = {
    overview: true,
    locations: warehouse.locations.length > 0 || warehouse.capabilities.canManageLocations,
    stock: warehouse.capabilities.canViewStock,
    movements: warehouse.capabilities.canViewMovements,
    activity: warehouse.capabilities.canViewActivity,
  };

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("meta.inventory"), href: "/inventory" },
          { label: t("meta.warehouses"), href: "/inventory/warehouses" },
          { label: warehouse.name },
        ]}
        title={warehouse.name}
        subtitle={warehouse.code}
        status={warehouse.status}
        badges={
          <>
            <Badge tone="neutral">{inventoryLabel(t, "warehouseType", warehouse.warehouseType, warehouseTypeLabels[warehouse.warehouseType])}</Badge>
            {warehouse.project ? <Badge tone="info">{warehouse.project.code}</Badge> : null}
          </>
        }
        meta={[
          { label: t("columns.locations"), value: String(warehouse.locationCount) },
          { label: t("columns.itemsHeld"), value: String(warehouse.distinctItems) },
          { label: t("columns.city"), value: warehouse.city ?? "—" },
        ]}
        actions={<WarehouseActions warehouse={warehouse} />}
      />

      <nav aria-label={t("tabs.warehouseSections")} className="border-b border-line">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.filter((entry) => show[entry.key]).map((entry) => {
            const isActive = entry.key === tab;
            return (
              <li key={entry.key}>
                <Link
                  href={`/inventory/warehouses/${warehouse.id}${entry.suffix}`}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors touch:h-11",
                    isActive
                      ? "border-accent text-fg"
                      : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  {t(entry.label)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {warehouse.archivedAt ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("detail.warehouseArchived")}
        </p>
      ) : warehouse.status === "INACTIVE" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("detail.warehouseInactive")}
        </p>
      ) : null}

      {children}
    </div>
  );
}
