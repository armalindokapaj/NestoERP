
import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import type { ReservationDTO } from "@/lib/modules/inventory/inventory.types";
import { formatDate } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";
import { formatQuantity } from "./inventory-format";

/**
 * Stock promised but not yet moved (PRD #20 §152, §326).
 *
 * A reservation holds quantity back from available without changing on hand:
 * the material is still in the rack, it is just already spoken for
 * (PRD #20 §166).
 */
export async function ReservationTable({
  reservations,
  actions,
  caption,
  listId = "inventory.reservations",
}: {
  reservations: ReservationDTO[];
  actions?: (row: ReservationDTO) => React.ReactNode;
  caption?: string;
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
}) {
  const t = await getTranslations("inventory");
  const columns: TableColumn<ReservationDTO>[] = [
    {
      key: "reservationNumber",
      id: "reservationNumber",
      mandatory: true,
      label: t("columns.reservation"),
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
      id: "project",
      label: t("columns.project"),
      hideBelow: "md",
      render: (row) =>
        row.project ? row.project.code : <span className="text-fg-subtle">{t("columns.general")}</span>,
    },
    {
      key: "location",
      id: "location",
      label: t("columns.heldAt"),
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
      id: "quantity",
      valueType: "number",
      label: t("columns.reserved"),
      align: "right",
      render: (row) => (
        <span className="flex flex-col items-end">
          <span className="tabular-nums">
            {formatQuantity(row.remainingQuantity)} {row.item.baseUnit}
          </span>
          {row.fulfilledQuantity !== "0" && row.fulfilledQuantity !== "0.0000" ? (
            <span className="text-meta text-fg-subtle tabular-nums">
              {t("columns.taken", { quantity: formatQuantity(row.fulfilledQuantity) })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "requiredDate",
      id: "requiredDate",
      valueType: "date",
      label: t("columns.required"),
      hideBelow: "xl",
      render: (row) =>
        row.requiredDate ? formatDate(row.requiredDate) : <span className="text-fg-subtle">—</span>,
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: t("columns.status"),
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <StatusBadge status={row.status} />
          {row.expired ? <Badge tone="warning">{t("columns.pastExpiry")}</Badge> : null}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      listId={listId}
      columns={columns}
      records={reservations}
      rowKey={(row) => row.id}
      rowHref={(row) => `/inventory/reservations/${row.id}`}
      caption={caption ?? t("captions.reservations")}
      actions={actions}
    />
  );
}
