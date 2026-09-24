import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import type {
  AdjustmentLineDTO,
  DocumentLineDTO,
  TransferLineDTO,
} from "@/lib/modules/inventory/inventory.types";
import { formatQuantity, formatSigned } from "./inventory-format";

/**
 * The lines of a posted or drafted stock document (PRD #20 §310, §313, §317).
 *
 * A posted line carries the movement it wrote, which is what makes the document
 * traceable to the ledger rather than merely consistent with it (PRD #20 §432).
 */
export function DocumentLinesTable({
  lines,
  caption = "Document lines",
}: {
  lines: DocumentLineDTO[];
  caption?: string;
}) {
  const columns: TableColumn<DocumentLineDTO>[] = [
    {
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
    },
    {
      key: "location",
      label: "Location",
      hideBelow: "md",
      render: (row) =>
        row.location ? row.location.code : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "quantity",
      label: "Quantity",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {formatQuantity(row.quantity)} {row.unit}
        </span>
      ),
    },
    {
      key: "notes",
      label: "Note",
      hideBelow: "xl",
      render: (row) => row.notes ?? <span className="text-fg-subtle">—</span>,
    },
  ];

  return (
    <DataTable columns={columns} records={lines} rowKey={(row) => row.id} caption={caption} />
  );
}

export function TransferLinesTable({
  lines,
  caption = "Transfer lines",
}: {
  lines: TransferLineDTO[];
  caption?: string;
}) {
  const columns: TableColumn<TransferLineDTO>[] = [
    {
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
    },
    {
      key: "route",
      label: "From → to",
      render: (row) => (
        <span>
          {row.fromLocation.code}
          <span className="text-fg-subtle"> → </span>
          {row.toLocation.code}
        </span>
      ),
    },
    {
      key: "quantity",
      label: "Quantity",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {formatQuantity(row.quantity)} {row.unit}
        </span>
      ),
    },
    {
      key: "notes",
      label: "Note",
      hideBelow: "xl",
      render: (row) => row.notes ?? <span className="text-fg-subtle">—</span>,
    },
  ];

  return (
    <DataTable columns={columns} records={lines} rowKey={(row) => row.id} caption={caption} />
  );
}

export function AdjustmentLinesTable({
  lines,
  caption = "Adjustment lines",
}: {
  lines: AdjustmentLineDTO[];
  caption?: string;
}) {
  const columns: TableColumn<AdjustmentLineDTO>[] = [
    {
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
    },
    {
      key: "location",
      label: "Location",
      hideBelow: "md",
      render: (row) => row.location.code,
    },
    {
      key: "quantityDelta",
      label: "Change",
      align: "right",
      render: (row) => (
        <span
          className={
            row.quantityDelta.trim().startsWith("-")
              ? "tabular-nums text-danger-strong"
              : "tabular-nums text-success-strong"
          }
        >
          {formatSigned(row.quantityDelta, row.unit)}
        </span>
      ),
    },
    {
      key: "notes",
      label: "Note",
      hideBelow: "xl",
      render: (row) => row.notes ?? <span className="text-fg-subtle">—</span>,
    },
  ];

  return (
    <DataTable columns={columns} records={lines} rowKey={(row) => row.id} caption={caption} />
  );
}
