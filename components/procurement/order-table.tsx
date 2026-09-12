import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { OrderSummaryDTO } from "@/lib/modules/procurement/procurement.types";
import { formatDate } from "@/lib/utils/format";
import { dueLabel, formatAmount, receivedLabel } from "./procurement-format";

/**
 * The purchase order list (PRD #19 §254, §279).
 *
 * Receiving progress is stated in words as well as shown as a proportion,
 * because "the half-filled bar" is not a state a screen reader can perceive
 * (PRD #19 §289).
 */
export function OrderTable({
  orders,
  showProject = true,
  showSupplier = true,
  caption = "Purchase orders",
}: {
  orders: OrderSummaryDTO[];
  showProject?: boolean;
  showSupplier?: boolean;
  caption?: string;
}) {
  const columns: TableColumn<OrderSummaryDTO>[] = [
    {
      key: "poNumber",
      label: "Order",
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{row.poNumber}</span>
          <span className="text-meta text-fg-subtle">
            {row.itemCount} line{row.itemCount === 1 ? "" : "s"}
          </span>
        </span>
      ),
    },
    ...(showSupplier
      ? [
          {
            key: "supplier",
            label: "Supplier",
            render: (row: OrderSummaryDTO) => (
              <span className={row.supplier.status === "ACTIVE" ? undefined : "text-fg-subtle"}>
                {row.supplier.name}
              </span>
            ),
          },
        ]
      : []),
    ...(showProject
      ? [
          {
            key: "project",
            label: "Project",
            hideBelow: "xl" as const,
            render: (row: OrderSummaryDTO) =>
              row.project?.code ?? <span className="text-fg-subtle">Company</span>,
          },
        ]
      : []),
    {
      key: "totalAmount",
      label: "Value",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatAmount(row.totalAmount, row.currency)}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "received",
      label: "Received",
      hideBelow: "lg",
      render: (row) =>
        row.attention.awaitingReceipt || row.receivedFraction > 0 ? (
          <span className="text-meta">{receivedLabel(row.receivedFraction)}</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "requiredDate",
      label: "Due",
      hideBelow: "md",
      render: (row) =>
        row.requiredDate ? (
          <span className={row.attention.overdue ? "text-warning-strong" : undefined}>
            {formatDate(row.requiredDate)}
            {row.attention.overdue ? ` · ${dueLabel(row.attention.daysToRequired)}` : ""}
          </span>
        ) : (
          <span className="text-fg-subtle">No date</span>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      records={orders}
      rowKey={(row) => row.id}
      rowHref={(row) => `/procurement/orders/${row.id}`}
      caption={caption}
    />
  );
}
