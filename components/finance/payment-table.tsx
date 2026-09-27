import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import type { TableSortConfig } from "@/components/data/sort-header";
import { Money } from "@/components/finance/money";
import { VoidPaymentButton } from "@/components/finance/void-payment-button";
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

export function PaymentTable({ payments, listId = "finance.payments", sort }: {
  payments: PaymentSummaryDTO[];
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
  /** The list's parsed sort and allowlist; header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const columns: TableColumn<PaymentSummaryDTO>[] = [
    {
      key: "record",
      id: "record",
      label: "Against",
      primary: true,
      mandatory: true,
      render: (payment) => (
        <span className="min-w-0">
          {payment.relatedRecord ? (
            <Link
              href={
                payment.relatedRecord.type === "INVOICE"
                  ? `/finance/invoices/${payment.relatedRecord.id}`
                  : payment.relatedRecord.type === "CONTRACT"
                    ? `/contracts/${payment.relatedRecord.id}`
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
            {/* Money not yet pointed at what it settles (E-05F §34). */}
            {payment.status === "RECORDED" && Number(payment.unallocatedAmount) > 0 ? ` · ${payment.unallocatedAmount} ${payment.currency} unallocated` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "date",
      id: "date",
      label: "Date",
      hideBelow: "md",
      valueType: "date",
      sortKey: sort ? "date" : undefined,
      render: (payment) => (
        <span className="text-fg-muted">{formatDate(payment.paymentDate)}</span>
      ),
    },
    {
      key: "method",
      id: "method",
      label: "Method",
      hideBelow: "xl",
      render: (payment) => (
        <span className="text-fg-muted">{METHOD_LABELS[payment.method] ?? payment.method}</span>
      ),
    },
    {
      key: "amount",
      id: "amount",
      label: "Amount",
      align: "right",
      mandatory: true,
      valueType: "money",
      sortKey: sort ? "amount" : undefined,
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
      id: "status",
      label: "Status",
      mandatory: true,
      valueType: "status",
      render: (payment) => (
        <Badge tone={payment.status === "VOIDED" ? "default" : "success"}>
          {payment.status === "VOIDED" ? "Voided" : "Recorded"}
        </Badge>
      ),
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption="Payments"
      columns={columns}
      records={payments}
      rowKey={(payment) => payment.id}
      // Void is the row's action, not a data column: a phone card shows it in
      // its own action row instead of an unlabelled value line, and it stays
      // reachable whatever columns are chosen (AUD-08 §5; AUD-04 §5, MW-05).
      // The capability is a hint; voidPayment re-checks the permission and
      // refuses a payment that is already voided (PRD #15 §86).
      actions={(payment) =>
        payment.capabilities.canVoid && payment.status !== "VOIDED" ? (
          <VoidPaymentButton
            paymentId={payment.id}
            reference={payment.relatedRecord?.reference ?? "this payment"}
          />
        ) : null
      }
    />
  );
}
