import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import type { TableSortConfig } from "@/components/data/sort-header";
import type { StockRowDTO } from "@/lib/modules/inventory/inventory.types";
import { formatQuantity } from "./inventory-format";
import { StockLevelBadge } from "./stock-level-badge";

/**
 * What is where (PRD #20 §180, §181, §208).
 *
 * One row per item per location, because "we have 40 tonnes somewhere" is not
 * an answer anybody can act on.
 */
export function StockTable({
  rows,
  show = "all",
  caption = "Stock on hand",
  listId = "inventory.stock",
  sort,
}: {
  rows: StockRowDTO[];
  /** Columns already implied by the page are dropped rather than repeated. */
  show?: "all" | "by-location" | "by-item";
  caption?: string;
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
  /** The list's parsed sort and allowlist; header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const columns: TableColumn<StockRowDTO>[] = [];

  if (show !== "by-location") {
    columns.push({
      key: "item",
      id: "item",
      mandatory: true,
      label: "Item",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <Link
            href={`/inventory/items/${row.item.id}`}
            className="font-medium text-fg hover:text-accent"
          >
            {row.item.name}
          </Link>
          <span className="text-meta text-fg-subtle">{row.item.sku}</span>
        </span>
      ),
    });
  }

  if (show !== "by-item") {
    columns.push({
      key: "warehouse",
      id: "warehouse",
      label: "Warehouse",
      primary: show === "by-location",
      render: (row) => (
        <span className="flex flex-col">
          <Link
            href={`/inventory/warehouses/${row.warehouse.id}`}
            className="font-medium text-fg hover:text-accent"
          >
            {row.warehouse.name}
          </Link>
          <span className="text-meta text-fg-subtle">{row.warehouse.code}</span>
        </span>
      ),
    });
  }

  columns.push(
    {
      key: "location",
      id: "location",
      label: "Location",
      hideBelow: "md",
      render: (row) => (
        <span>
          {row.location.code}
          {row.location.name ? (
            <span className="text-fg-subtle"> · {row.location.name}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "onHand",
      id: "onHand",
      valueType: "number",
      label: "On hand",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {formatQuantity(row.onHand)} {row.item.baseUnit}
        </span>
      ),
    },
    {
      key: "reserved",
      id: "reserved",
      valueType: "number",
      label: "Reserved",
      align: "right",
      hideBelow: "lg",
      render: (row) => (
        <span className="tabular-nums text-fg-muted">{formatQuantity(row.reserved)}</span>
      ),
    },
    {
      key: "available",
      id: "available",
      mandatory: true,
      valueType: "number",
      sortKey: sort ? "available" : undefined,
      label: "Available",
      align: "right",
      render: (row) => <span className="tabular-nums">{formatQuantity(row.available)}</span>,
    },
    {
      key: "level",
      id: "level",
      valueType: "status",
      label: "Level",
      hideBelow: "lg",
      render: (row) => <StockLevelBadge level={row.level} />,
    },
  );

  return (
    <DataTable
      listId={listId}
      sort={sort}
      columns={columns}
      records={rows}
      rowKey={(row) => `${row.item.id}:${row.location.id}`}
      caption={caption}
    />
  );
}
