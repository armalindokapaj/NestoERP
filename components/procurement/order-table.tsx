import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import type { OrderSummaryDTO } from "@/lib/modules/procurement/procurement.types";
import { formatDate } from "@/lib/utils/format";
import { companyColumn, isGroupRows, RecordLink } from "./company-cells";
import { dueLabel, formatAmount, receivedLabel } from "./procurement-format";
import { getTranslations } from "@/lib/i18n/server";

/**
 * The purchase order list (PRD #19 §254, §279).
 *
 * Receiving progress is stated in words as well as shown as a proportion,
 * because "the half-filled bar" is not a state a screen reader can perceive
 * (PRD #19 §289).
 */
export async function OrderTable({
  orders,
  showProject = true,
  showSupplier = true,
  caption,
  listId = "procurement.orders",
}: {
  orders: OrderSummaryDTO[];
  showProject?: boolean;
  showSupplier?: boolean;
  caption?: string;
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
}) {
  const grouped = isGroupRows(orders);
  const t = await getTranslations("procurement");

  const columns: TableColumn<OrderSummaryDTO>[] = [
    {
      key: "poNumber",
      id: "poNumber",
      mandatory: true,
      label: t("orders.order"),
      primary: true,
      render: (row) => (
        <RecordLink company={row.company} href={`/procurement/orders/${row.id}`}>
          <span className="flex flex-col">
            <span className="font-medium text-fg">{row.poNumber}</span>
            <span className="text-meta text-fg-subtle">
              {t("common.lineCount", { count: row.itemCount })}
            </span>
          </span>
        </RecordLink>
      ),
    },
    ...(grouped ? [companyColumn<OrderSummaryDTO>(t("common.company"))] : []),
    ...(showSupplier
      ? [
          {
            key: "supplier",
            id: "supplier",
            label: t("common.supplier"),
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
            id: "project",
            label: t("common.project"),
            hideBelow: "xl" as const,
            render: (row: OrderSummaryDTO) =>
              row.project?.code ?? <span className="text-fg-subtle">{t("common.company")}</span>,
          },
        ]
      : []),
    {
      key: "totalAmount",
      id: "totalAmount",
      mandatory: true,
      valueType: "money",
      label: t("orders.value"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatAmount(row.totalAmount, row.currency)}</span>
      ),
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: t("common.status"),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "received",
      id: "received",
      valueType: "status",
      label: t("common.received"),
      hideBelow: "lg",
      render: (row) =>
        row.attention.awaitingReceipt || row.receivedFraction > 0 ? (
          <span className="text-meta">{receivedLabel(t, row.receivedFraction)}</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      key: "requiredDate",
      id: "requiredDate",
      valueType: "date",
      label: t("orders.due"),
      hideBelow: "md",
      render: (row) =>
        row.requiredDate ? (
          <span className={row.attention.overdue ? "text-warning-strong" : undefined}>
            {formatDate(row.requiredDate)}
            {row.attention.overdue ? ` · ${dueLabel(t, row.attention.daysToRequired)}` : ""}
          </span>
        ) : (
          <span className="text-fg-subtle">{t("common.noDate")}</span>
        ),
    },
  ];

  return (
    <DataTable
      listId={listId}
      columns={columns}
      records={orders}
      rowKey={(row) => row.id}
      rowHref={grouped ? undefined : (row) => `/procurement/orders/${row.id}`}
      caption={caption ?? t("orders.caption")}
    />
  );
}
