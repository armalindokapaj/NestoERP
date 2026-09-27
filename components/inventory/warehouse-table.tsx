import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { WarehouseSummaryDTO } from "@/lib/modules/inventory/inventory.types";
import { warehouseTypeLabels } from "@/lib/modules/inventory/inventory.status";
import { getTranslations } from "@/lib/i18n/server";
import { inventoryLabel } from "./inventory-labels";

/** Where stock is kept (PRD #20 §56). */
export async function WarehouseTable({
  warehouses,
  caption,
  listId = "inventory.warehouses",
}: {
  warehouses: WarehouseSummaryDTO[];
  caption?: string;
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
}) {
  const t = await getTranslations("inventory");
  const columns: TableColumn<WarehouseSummaryDTO>[] = [
    {
      key: "name",
      id: "name",
      mandatory: true,
      label: t("columns.warehouse"),
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.name}</span>
          <span className="text-meta text-fg-subtle">{row.code}</span>
        </span>
      ),
    },
    {
      key: "warehouseType",
      id: "warehouseType",
      label: t("columns.type"),
      hideBelow: "md",
      render: (row) => inventoryLabel(t, "warehouseType", row.warehouseType, warehouseTypeLabels[row.warehouseType]),
    },
    {
      key: "project",
      id: "project",
      label: t("columns.project"),
      hideBelow: "lg",
      render: (row) =>
        row.project ? row.project.code : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "city",
      id: "city",
      label: t("columns.city"),
      hideBelow: "xl",
      render: (row) => row.city ?? <span className="text-fg-subtle">—</span>,
    },
    {
      key: "locationCount",
      id: "locationCount",
      valueType: "number",
      label: t("columns.locations"),
      align: "right",
      hideBelow: "lg",
      render: (row) => <span className="tabular-nums">{row.locationCount}</span>,
    },
    {
      key: "distinctItems",
      id: "distinctItems",
      valueType: "number",
      label: t("columns.itemsHeld"),
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums">{row.distinctItems}</span>,
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: t("columns.status"),
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <DataTable
      listId={listId}
      columns={columns}
      records={warehouses}
      rowKey={(row) => row.id}
      rowHref={(row) => `/inventory/warehouses/${row.id}`}
      caption={caption ?? t("captions.warehouses")}
    />
  );
}
