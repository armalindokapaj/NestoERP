import { DataTable, type TableColumn } from "@/components/data/data-table";
import { companyColumn, GroupRecordLink } from "@/components/finance/group-rows";
import { Money } from "@/components/finance/money";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import { settlementLabels } from "@/lib/modules/finance/invoices/invoice.status";
import type { InvoiceSummaryDTO } from "@/lib/modules/finance/finance.types";
import { formatDate, orDash } from "@/lib/utils/format";

/**
 * The invoice list (PRD #15 §160, §161).
 *
 * Two statuses per row, because they answer different questions: the workflow
 * status says where the invoice is, the settlement status says whether the
 * money has arrived. Collapsing them into one column is what makes a "paid"
 * invoice impossible to cancel for the wrong reason (PRD #15 §42).
 */
const SETTLEMENT_TONES = {
  PAID: "success",
  PARTIALLY_PAID: "info",
  OVERDUE: "danger",
  UNPAID: "neutral",
} as const;

export function InvoiceTable({ invoices }: { invoices: InvoiceSummaryDTO[] }) {
  // Rows read in the Group workspace name their company and open through it.
  const grouped = invoices.some((invoice) => invoice.company);

  const columns: TableColumn<InvoiceSummaryDTO>[] = [
    {
      key: "number",
      label: "Invoice",
      primary: true,
      render: (invoice) => {
        const label = (
          <span className="min-w-0">
            <span className="block truncate">{invoice.invoiceNumber}</span>
            <span className="block truncate text-meta font-normal text-fg-subtle">
              {invoice.client.name}
            </span>
          </span>
        );
        return grouped && invoice.company ? (
          <GroupRecordLink company={invoice.company} href={`/finance/invoices/${invoice.id}`}>
            {label}
          </GroupRecordLink>
        ) : (
          label
        );
      },
    },
    ...(grouped ? [companyColumn<InvoiceSummaryDTO>()] : []),
    {
      key: "project",
      label: "Project",
      hideBelow: "xl",
      render: (invoice) => (
        <span className="text-fg-muted">{orDash(invoice.project?.name)}</span>
      ),
    },
    {
      key: "issued",
      label: "Issued",
      hideBelow: "xl",
      render: (invoice) => <span className="text-fg-muted">{formatDate(invoice.issueDate)}</span>,
    },
    {
      key: "due",
      label: "Due",
      hideBelow: "lg",
      render: (invoice) => <span className="text-fg-muted">{formatDate(invoice.dueDate)}</span>,
    },
    {
      key: "total",
      label: "Total",
      align: "right",
      render: (invoice) => (
        <Money amount={invoice.totalAmount} currency={invoice.currency} emphasis />
      ),
    },
    {
      key: "outstanding",
      label: "Outstanding",
      align: "right",
      hideBelow: "lg",
      render: (invoice) => (
        <Money
          amount={invoice.outstandingAmount}
          currency={invoice.currency}
          className="text-fg-muted"
        />
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (invoice) => <StatusBadge status={invoice.status} />,
    },
    {
      key: "settlement",
      label: "Settlement",
      hideBelow: "md",
      render: (invoice) => (
        <Badge tone={SETTLEMENT_TONES[invoice.settlementStatus]}>
          {settlementLabels[invoice.settlementStatus]}
        </Badge>
      ),
    },
  ];

  return (
    <DataTable
      caption="Invoices"
      columns={columns}
      records={invoices}
      rowKey={(invoice) => invoice.id}
      rowHref={grouped ? undefined : (invoice) => `/finance/invoices/${invoice.id}`}
    />
  );
}
