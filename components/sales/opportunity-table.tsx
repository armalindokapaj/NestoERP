import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import type { OpportunitySummaryDTO } from "@/lib/modules/sales/sales.types";
import { formatDate } from "@/lib/utils/format";
import { formatAmount } from "./sales-format";

/**
 * The opportunity list (PRD #17 §71, §282).
 *
 * Probability says whether it is the stage's default or a manual override, so a
 * forecast a person changed by hand does not look like the system's own opinion
 * (PRD #17 §276). An overdue expected close is labelled in words rather than by
 * colour alone (PRD #17 §296, §405).
 */
export function OpportunityTable({
  opportunities,
  showClient = true,
}: {
  opportunities: OpportunitySummaryDTO[];
  showClient?: boolean;
}) {
  const columns: TableColumn<OpportunitySummaryDTO>[] = [
    {
      key: "name",
      label: "Opportunity",
      primary: true,
      render: (row) => <span className="font-medium text-fg">{row.name}</span>,
    },
    ...(showClient
      ? [
          {
            key: "client",
            label: "Client",
            hideBelow: "md" as const,
            render: (row: OpportunitySummaryDTO) =>
              row.client?.name ?? <span className="text-fg-subtle">No client yet</span>,
          },
        ]
      : []),
    {
      key: "owner",
      label: "Owner",
      hideBelow: "xl",
      render: (row) => (
        <span className={row.owner.active ? undefined : "text-fg-subtle"}>
          <PersonLink memberId={row.owner.memberId} name={row.owner.fullName} />
          {row.owner.active ? "" : " (inactive)"}
        </span>
      ),
    },
    { key: "stage", label: "Stage", render: (row) => <StatusBadge status={row.stage} /> },
    {
      key: "value",
      label: "Value",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatAmount(row.estimatedValue, row.currency)}</span>
      ),
    },
    {
      key: "probability",
      label: "Probability",
      align: "right",
      hideBelow: "lg",
      render: (row) => (
        <span className="tabular-nums" title={row.probabilityIsOverride ? "Manual override" : "Stage default"}>
          {row.probability}%{row.probabilityIsOverride ? "*" : ""}
        </span>
      ),
    },
    {
      key: "weighted",
      label: "Weighted",
      align: "right",
      hideBelow: "lg",
      render: (row) => (
        <span className="tabular-nums text-fg-muted">
          {formatAmount(row.weightedValue, row.currency)}
        </span>
      ),
    },
    {
      key: "close",
      label: "Expected close",
      hideBelow: "xl",
      render: (row) =>
        row.expectedCloseDate ? (
          <span className={row.expectedCloseOverdue ? "text-warning-strong" : undefined}>
            {formatDate(row.expectedCloseDate)}
            {row.expectedCloseOverdue ? " · overdue" : ""}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      records={opportunities}
      rowKey={(row) => row.id}
      rowHref={(row) => `/sales/opportunities/${row.id}`}
      caption="Opportunities"
    />
  );
}
