import { DataTable, type TableColumn } from "@/components/data/data-table";
import type { TableSortConfig } from "@/components/data/sort-header";
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

export function InvoiceTable({ invoices, listId = "finance.invoices", sort }: {
  invoices: InvoiceSummaryDTO[];
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
  /** The list's parsed sort and allowlist; header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  // Rows read in the Group workspace name their company and open through it.
  const grouped = invoices.some((invoice) => invoice.company);

  const columns: TableColumn<InvoiceSummaryDTO>[] = [
    {
      key: "number",
      id: "number",
      mandatory: true,
      sortKey: sort ? "number" : undefined,
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
      id: "project",
      label: "Project",
      hideBelow: "xl",
      render: (invoice) => (
        <span className="text-fg-muted">{orDash(invoice.project?.name)}</span>
      ),
    },
    {
      key: "issued",
      id: "issued",
      valueType: "date",
      sortKey: sort ? "issue" : undefined,
      label: "Issued",
      hideBelow: "xl",
      render: (invoice) => <span className="text-fg-muted">{formatDate(invoice.issueDate)}</span>,
    },
    {
      key: "due",
      id: "due",
      valueType: "date",
      sortKey: sort ? "due" : undefined,
      label: "Due",
      hideBelow: "lg",
      render: (invoice) => <span className="text-fg-muted">{formatDate(invoice.dueDate)}</span>,
    },
    {
      key: "total",
      id: "total",
      mandatory: true,
      valueType: "money",
      sortKey: sort ? "amount" : undefined,
      label: "Total",
      align: "right",
      render: (invoice) => (
        <Money amount={invoice.totalAmount} currency={invoice.currency} emphasis />
      ),
    },
    {
      key: "outstanding",
      id: "outstanding",
      valueType: "money",
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
      id: "status",
      mandatory: true,
      valueType: "status",
      label: "Status",
      render: (invoice) => <StatusBadge status={invoice.status} />,
    },
    {
      key: "settlement",
      id: "settlement",
      valueType: "status",
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
      listId={listId}
      sort={sort}
      caption="Invoices"
      columns={columns}
      records={invoices}
      rowKey={(invoice) => invoice.id}
      rowHref={grouped ? undefined : (invoice) => `/finance/invoices/${invoice.id}`}
    />
  );
}
