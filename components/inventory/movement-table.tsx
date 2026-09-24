import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
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
}: {
  movements: MovementDTO[];
  showItem?: boolean;
  caption?: string;
}) {
  const columns: TableColumn<MovementDTO>[] = [
    {
      key: "occurredAt",
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
      label: "Project",
      hideBelow: "xl",
      render: (row) =>
        row.project ? row.project.code : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "source",
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
    <DataTable columns={columns} records={movements} rowKey={(row) => row.id} caption={caption} />
  );
}
