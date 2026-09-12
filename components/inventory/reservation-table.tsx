
import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import type { ReservationDTO } from "@/lib/modules/inventory/inventory.types";
import { formatDate } from "@/lib/utils/format";
import { formatQuantity } from "./inventory-format";

/**
 * Stock promised but not yet moved (PRD #20 §152, §326).
 *
 * A reservation holds quantity back from available without changing on hand:
 * the material is still in the rack, it is just already spoken for
 * (PRD #20 §166).
 */
export function ReservationTable({
  reservations,
  actions,
  caption = "Reservations",
}: {
  reservations: ReservationDTO[];
  actions?: (row: ReservationDTO) => React.ReactNode;
  caption?: string;
}) {
  const columns: TableColumn<ReservationDTO>[] = [
    {
      key: "reservationNumber",
      label: "Reservation",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.reservationNumber}</span>
          <span className="text-meta text-fg-subtle">{row.item.name}</span>
        </span>
      ),
    },
    {
      key: "project",
      label: "Project",
      hideBelow: "md",
      render: (row) =>
        row.project ? row.project.code : <span className="text-fg-subtle">General</span>,
    },
    {
      key: "location",
      label: "Held at",
      hideBelow: "lg",
      render: (row) => (
        <span className="flex flex-col">
          <span>{row.warehouse.code}</span>
          <span className="text-meta text-fg-subtle">{row.location.code}</span>
        </span>
      ),
    },
    {
      key: "quantity",
      label: "Reserved",
      align: "right",
      render: (row) => (
        <span className="flex flex-col items-end">
          <span className="tabular-nums">
            {formatQuantity(row.remainingQuantity)} {row.item.baseUnit}
          </span>
          {row.fulfilledQuantity !== "0" && row.fulfilledQuantity !== "0.0000" ? (
            <span className="text-meta text-fg-subtle tabular-nums">
              {formatQuantity(row.fulfilledQuantity)} taken
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "requiredDate",
      label: "Required",
      hideBelow: "xl",
      render: (row) =>
        row.requiredDate ? formatDate(row.requiredDate) : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <StatusBadge status={row.status} />
          {row.expired ? <Badge tone="warning">Past expiry</Badge> : null}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      records={reservations}
      rowKey={(row) => row.id}
      rowHref={(row) => `/inventory/reservations/${row.id}`}
      caption={caption}
      actions={actions}
    />
  );
}
