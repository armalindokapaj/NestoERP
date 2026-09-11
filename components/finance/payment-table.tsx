import Link from "next/link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { Money } from "@/components/finance/money";
import { Badge } from "@/components/ui/badge";
import type { PaymentSummaryDTO } from "@/lib/modules/finance/finance.types";
import { formatDate, orDash } from "@/lib/utils/format";

/** The payment list (PRD #15 §165). */
const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  CASH: "Cash",
  CHECK: "Cheque",
  OTHER: "Other",
};

export function PaymentTable({ payments }: { payments: PaymentSummaryDTO[] }) {
  const columns: TableColumn<PaymentSummaryDTO>[] = [
    {
      key: "record",
      label: "Against",
      primary: true,
      render: (payment) => (
        <span className="min-w-0">
          {payment.relatedRecord ? (
            <Link
              href={
                payment.relatedRecord.type === "INVOICE"
                  ? `/finance/invoices/${payment.relatedRecord.id}`
                  : `/finance/expenses/${payment.relatedRecord.id}`
              }
              className="block truncate hover:text-accent"
            >
              {payment.relatedRecord.reference}
            </Link>
          ) : (
            <span className="block truncate text-fg-subtle">Unlinked</span>
          )}
          <span className="block truncate text-meta font-normal text-fg-subtle">
            {payment.direction === "RECEIPT" ? "Received" : "Paid out"} ·{" "}
            {orDash(payment.reference)}
          </span>
        </span>
      ),
    },
    {
      key: "date",
      label: "Date",
      hideBelow: "md",
      render: (payment) => (
        <span className="text-fg-muted">{formatDate(payment.paymentDate)}</span>
      ),
    },
    {
      key: "method",
      label: "Method",
      hideBelow: "xl",
      render: (payment) => (
        <span className="text-fg-muted">{METHOD_LABELS[payment.method] ?? payment.method}</span>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      render: (payment) => (
        <Money
          amount={payment.amount}
          currency={payment.currency}
          emphasis
          // A voided payment keeps its row but stops counting, so it is struck
          // through rather than removed (PRD #15 §85, §86).
          className={payment.status === "VOIDED" ? "line-through opacity-60" : undefined}
        />
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (payment) => (
        <Badge tone={payment.status === "VOIDED" ? "default" : "success"}>
          {payment.status === "VOIDED" ? "Voided" : "Recorded"}
        </Badge>
      ),
    },
  ];

  return (
    <DataTable
      caption="Payments"
      columns={columns}
      records={payments}
      rowKey={(payment) => payment.id}
    />
  );
}
