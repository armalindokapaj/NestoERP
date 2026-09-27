import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { WarehouseSummaryDTO } from "@/lib/modules/inventory/inventory.types";
import { warehouseTypeLabels } from "@/lib/modules/inventory/inventory.status";

/** Where stock is kept (PRD #20 §56). */
export function WarehouseTable({
  warehouses,
  caption = "Warehouses",
  listId = "inventory.warehouses",
}: {
  warehouses: WarehouseSummaryDTO[];
  caption?: string;
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
}) {
  const columns: TableColumn<WarehouseSummaryDTO>[] = [
    {
      key: "name",
      id: "name",
      mandatory: true,
      label: "Warehouse",
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
      label: "Type",
      hideBelow: "md",
      render: (row) => warehouseTypeLabels[row.warehouseType],
    },
    {
      key: "project",
      id: "project",
      label: "Project",
      hideBelow: "lg",
      render: (row) =>
        row.project ? row.project.code : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "city",
      id: "city",
      label: "City",
      hideBelow: "xl",
      render: (row) => row.city ?? <span className="text-fg-subtle">—</span>,
    },
    {
      key: "locationCount",
      id: "locationCount",
      valueType: "number",
      label: "Locations",
      align: "right",
      hideBelow: "lg",
      render: (row) => <span className="tabular-nums">{row.locationCount}</span>,
    },
    {
      key: "distinctItems",
      id: "distinctItems",
      valueType: "number",
      label: "Items held",
      align: "right",
      hideBelow: "md",
      render: (row) => <span className="tabular-nums">{row.distinctItems}</span>,
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: "Status",
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
      caption={caption}
    />
  );
}
