import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { ItemSummaryDTO } from "@/lib/modules/inventory/inventory.types";
import { itemCategoryLabels } from "@/lib/modules/inventory/inventory.status";
import { formatQuantity } from "./inventory-format";
import { StockLevelBadge } from "./stock-level-badge";

/**
 * The item master (PRD #20 §39, §322).
 *
 * Stock columns disappear entirely for a reader without balance permission
 * rather than showing zeros — absence, not a blanked-out figure (PRD #20 §20).
 */
export function ItemTable({
  items,
  showStock,
  caption = "Inventory items",
}: {
  items: ItemSummaryDTO[];
  showStock: boolean;
  caption?: string;
}) {
  const columns: TableColumn<ItemSummaryDTO>[] = [
    {
      key: "name",
      label: "Item",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.name}</span>
          <span className="text-meta text-fg-subtle">{row.sku}</span>
        </span>
      ),
    },
    {
      key: "category",
      label: "Category",
      hideBelow: "lg",
      render: (row) => itemCategoryLabels[row.category],
    },
    {
      key: "baseUnit",
      label: "Unit",
      hideBelow: "xl",
      render: (row) => row.baseUnit,
    },
  ];

  if (showStock) {
    columns.push(
      {
        key: "onHand",
        label: "On hand",
        align: "right",
        render: (row) => (
          <span className="tabular-nums">{formatQuantity(row.stock?.onHand)}</span>
        ),
      },
      {
        key: "reserved",
        label: "Reserved",
        align: "right",
        hideBelow: "lg",
        render: (row) => (
          <span className="tabular-nums text-fg-muted">
            {formatQuantity(row.stock?.reserved)}
          </span>
        ),
      },
      {
        key: "available",
        label: "Available",
        align: "right",
        hideBelow: "md",
        render: (row) => (
          <span className="tabular-nums">{formatQuantity(row.stock?.available)}</span>
        ),
      },
      {
        key: "level",
        label: "Level",
        render: (row) => <StockLevelBadge level={row.level} />,
      },
    );
  } else {
    columns.push({
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    });
  }

  return (
    <DataTable
      columns={columns}
      records={items}
      rowKey={(row) => row.id}
      rowHref={(row) => `/inventory/items/${row.id}`}
      caption={caption}
    />
  );
}
