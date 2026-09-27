import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { ItemSummaryDTO } from "@/lib/modules/inventory/inventory.types";
import { itemCategoryLabels } from "@/lib/modules/inventory/inventory.status";
import { getTranslations } from "@/lib/i18n/server";
import { inventoryLabel } from "./inventory-labels";
import { formatQuantity } from "./inventory-format";
import { StockLevelBadge } from "./stock-level-badge";

/**
 * The item master (PRD #20 §39, §322).
 *
 * Stock columns disappear entirely for a reader without balance permission
 * rather than showing zeros — absence, not a blanked-out figure (PRD #20 §20).
 */
export async function ItemTable({
  items,
  showStock,
  caption,
  listId = "inventory.items",
}: {
  items: ItemSummaryDTO[];
  showStock: boolean;
  caption?: string;
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
}) {
  const t = await getTranslations("inventory");
  const columns: TableColumn<ItemSummaryDTO>[] = [
    {
      key: "name",
      id: "name",
      mandatory: true,
      label: t("columns.item"),
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
      id: "category",
      label: t("columns.category"),
      hideBelow: "lg",
      render: (row) => inventoryLabel(t, "itemCategory", row.category, itemCategoryLabels[row.category]),
    },
    {
      key: "baseUnit",
      id: "baseUnit",
      label: t("columns.unit"),
      hideBelow: "xl",
      render: (row) => row.baseUnit,
    },
  ];

  if (showStock) {
    columns.push(
      {
        key: "onHand",
        id: "onHand",
        valueType: "number",
        label: t("columns.onHand"),
        align: "right",
        render: (row) => (
          <span className="tabular-nums">{formatQuantity(row.stock?.onHand)}</span>
        ),
      },
      {
        key: "reserved",
        id: "reserved",
        valueType: "number",
        label: t("columns.reserved"),
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
        id: "available",
        valueType: "number",
        label: t("columns.available"),
        align: "right",
        hideBelow: "md",
        render: (row) => (
          <span className="tabular-nums">{formatQuantity(row.stock?.available)}</span>
        ),
      },
      {
        key: "level",
        id: "level",
        valueType: "status",
        label: t("columns.level"),
        render: (row) => <StockLevelBadge level={row.level} />,
      },
    );
  } else {
    columns.push({
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: t("columns.status"),
      render: (row) => <StatusBadge status={row.status} />,
    });
  }

  return (
    <DataTable
      listId={listId}
      columns={columns}
      records={items}
      rowKey={(row) => row.id}
      rowHref={(row) => `/inventory/items/${row.id}`}
      caption={caption ?? t("captions.items")}
    />
  );
}
