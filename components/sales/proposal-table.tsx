import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import type { ProposalSummaryDTO } from "@/lib/modules/sales/sales.types";
import { formatDate } from "@/lib/utils/format";
import { formatAmount } from "./sales-format";

/**
 * The proposal list (PRD #17 §283).
 *
 * "Expiring soon" is derived at read time and shown as a word, not a colour: a
 * proposal does not change when a date passes, but what the list should be
 * drawing attention to does (PRD #17 §402).
 */
export function ProposalTable({
  proposals,
  showOpportunity = true,
}: {
  proposals: ProposalSummaryDTO[];
  showOpportunity?: boolean;
}) {
  const columns: TableColumn<ProposalSummaryDTO>[] = [
    {
      key: "number",
      label: "Number",
      primary: true,
      render: (row) => <span className="font-medium tabular-nums text-fg">{row.proposalNumber}</span>,
    },
    { key: "title", label: "Title", hideBelow: "md", render: (row) => row.title },
    ...(showOpportunity
      ? [
          {
            key: "opportunity",
            label: "Opportunity",
            hideBelow: "xl" as const,
            render: (row: ProposalSummaryDTO) => row.opportunity.name,
          },
        ]
      : []),
    { key: "client", label: "Client", hideBelow: "lg", render: (row) => row.client.name },
    {
      key: "total",
      label: "Total",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatAmount(row.totalAmount, row.currency)}</span>
      ),
    },
    {
      key: "valid",
      label: "Valid until",
      hideBelow: "lg",
      render: (row) =>
        row.validUntil ? (
          <span className="flex items-center gap-2">
            {formatDate(row.validUntil)}
            {row.expiry === "EXPIRING_SOON" ? <Badge tone="warning">Expiring soon</Badge> : null}
            {row.expiry === "EXPIRED" ? <Badge tone="danger">Expired</Badge> : null}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      columns={columns}
      records={proposals}
      rowKey={(row) => row.id}
      rowHref={(row) => `/sales/proposals/${row.id}`}
      caption="Proposals"
    />
  );
}
