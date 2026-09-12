import Link from "next/link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
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
}: {
  rows: StockRowDTO[];
  /** Columns already implied by the page are dropped rather than repeated. */
  show?: "all" | "by-location" | "by-item";
  caption?: string;
}) {
  const columns: TableColumn<StockRowDTO>[] = [];

  if (show !== "by-location") {
    columns.push({
      key: "item",
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
      label: "Reserved",
      align: "right",
      hideBelow: "lg",
      render: (row) => (
        <span className="tabular-nums text-fg-muted">{formatQuantity(row.reserved)}</span>
      ),
    },
    {
      key: "available",
      label: "Available",
      align: "right",
      render: (row) => <span className="tabular-nums">{formatQuantity(row.available)}</span>,
    },
    {
      key: "level",
      label: "Level",
      hideBelow: "lg",
      render: (row) => <StockLevelBadge level={row.level} />,
    },
  );

  return (
    <DataTable
      columns={columns}
      records={rows}
      rowKey={(row) => `${row.item.id}:${row.location.id}`}
      caption={caption}
    />
  );
}
