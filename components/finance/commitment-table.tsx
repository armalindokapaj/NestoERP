import { DataTable, type TableColumn } from "@/components/data/data-table";
import { Money } from "@/components/finance/money";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import { expenseCategoryLabels } from "@/lib/modules/finance/expenses/expense.status";
import type { CommitmentSummaryDTO } from "@/lib/modules/finance/finance.types";
import { formatDate, orDash } from "@/lib/utils/format";

/** The commitment list (PRD #15 §171). */
export function CommitmentTable({ commitments }: { commitments: CommitmentSummaryDTO[] }) {
  const columns: TableColumn<CommitmentSummaryDTO>[] = [
    {
      key: "description",
      label: "Commitment",
      primary: true,
      render: (commitment) => (
        <span className="min-w-0">
          <span className="block truncate">{commitment.description}</span>
          <span className="block truncate text-meta font-normal text-fg-subtle">
            {commitment.reference ? `${commitment.reference} · ` : ""}
            {orDash(commitment.counterpartyName)}
          </span>
        </span>
      ),
    },
    {
      key: "project",
      label: "Project",
      hideBelow: "lg",
      render: (commitment) => (
        <span className="text-fg-muted">{commitment.project?.name ?? "Company-wide"}</span>
      ),
    },
    {
      key: "category",
      label: "Category",
      hideBelow: "xl",
      render: (commitment) => (
        <Badge tone="neutral">{expenseCategoryLabels[commitment.category]}</Badge>
      ),
    },
    {
      key: "expected",
      label: "Expected",
      hideBelow: "lg",
      render: (commitment) => (
        <span className="text-fg-muted">
          {commitment.expectedDate ? formatDate(commitment.expectedDate) : "—"}
        </span>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      render: (commitment) => (
        <Money amount={commitment.amount} currency={commitment.currency} emphasis />
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (commitment) => (
        <span className="flex items-center gap-2">
          <StatusBadge status={commitment.status} />
          {/* A commitment another module owns is marked, because Finance shows
              it but does not edit it (PRD #15 §128). */}
          {commitment.source.module ? (
            <Badge tone="default">{commitment.source.module}</Badge>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption="Commitments"
      columns={columns}
      records={commitments}
      rowKey={(commitment) => commitment.id}
      rowHref={(commitment) => `/finance/commitments/${commitment.id}`}
    />
  );
}
