import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import type { TableSortConfig } from "@/components/data/sort-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import type { MovementDTO } from "@/lib/modules/inventory/inventory.types";
import { movementTypeLabels } from "@/lib/modules/inventory/inventory.status";
import { formatDateTime } from "@/lib/utils/format";
import { formatSigned } from "./inventory-format";

/**
 * The stock ledger (PRD #20 §173, §174, §320).
 *
 * Read-only by construction: a movement is never edited or deleted, so there
 * are no row controls here at all. A correction is a new row (PRD #20 §70).
 *
 * The source column links back to whatever caused the movement, but only when
 * the reader may open it — otherwise it names the document without linking to
 * a page that would refuse them (PRD #20 §179).
 */
export function MovementTable({
  movements,
  showItem = true,
  caption = "Stock movements",
  listId = "inventory.movements",
  sort,
}: {
  movements: MovementDTO[];
  showItem?: boolean;
  caption?: string;
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
  /** The list's parsed sort and allowlist; header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const columns: TableColumn<MovementDTO>[] = [
    {
      key: "occurredAt",
      id: "occurredAt",
      mandatory: true,
      valueType: "datetime",
      sortKey: sort ? "occurred" : undefined,
      label: "When",
      primary: !showItem,
      render: (row) => (
        <span className="whitespace-nowrap text-fg-muted">{formatDateTime(row.occurredAt)}</span>
      ),
    },
  ];

  if (showItem) {
    columns.push({
      key: "item",
      id: "item",
      mandatory: true,
      label: "Item",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.item.name}</span>
          <span className="text-meta text-fg-subtle">{row.item.sku}</span>
        </span>
      ),
    });
  }

  columns.push(
    {
      key: "movementType",
      id: "movementType",
      mandatory: true,
      valueType: "status",
      label: "Type",
      render: (row) => (
        <span className="flex items-center gap-1.5">
          {movementTypeLabels[row.movementType]}
          {row.isReversal ? <Badge tone="default">Reversal</Badge> : null}
        </span>
      ),
    },
    {
      key: "quantity",
      id: "quantity",
      mandatory: true,
      valueType: "number",
      label: "Quantity",
      align: "right",
      render: (row) => (
        <span
          className={
            row.signedQuantity.startsWith("-")
              ? "tabular-nums text-danger-strong"
              : "tabular-nums text-success-strong"
          }
        >
          {formatSigned(row.signedQuantity, row.unit)}
        </span>
      ),
    },
    {
      key: "location",
      id: "location",
      label: "Location",
      hideBelow: "lg",
      render: (row) => (
        <span className="flex flex-col">
          <span>{row.warehouse.code}</span>
          <span className="text-meta text-fg-subtle">{row.location.code}</span>
        </span>
      ),
    },
    {
      key: "project",
      id: "project",
      label: "Project",
      hideBelow: "xl",
      render: (row) =>
        row.project ? row.project.code : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "source",
      id: "source",
      label: "Source",
      hideBelow: "md",
      render: (row) => {
        if (!row.source) return <span className="text-fg-subtle">—</span>;
        return row.source.href ? (
          <Link href={row.source.href} className="text-accent-strong hover:underline">
            {row.source.label}
          </Link>
        ) : (
          <span>{row.source.label}</span>
        );
      },
    },
    {
      key: "postedBy",
      id: "postedBy",
      label: "Posted by",
      hideBelow: "xl",
      render: (row) =>
        row.postedBy ? (
          <PersonLink memberId={row.postedBy.memberId} name={row.postedBy.fullName} />
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
  );

  return (
    <DataTable listId={listId} sort={sort} columns={columns} records={movements} rowKey={(row) => row.id} caption={caption} />
  );
}
