import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { leadSourceLabels } from "@/lib/modules/sales/leads/lead.status";
import type { LeadSummaryDTO } from "@/lib/modules/sales/sales.types";
import { formatDate } from "@/lib/utils/format";
import { formatAmount } from "./sales-format";

/**
 * The lead list (PRD #17 §37, §281).
 *
 * Monetary columns are right-aligned and tabular so a column of figures lines
 * up on the decimal point (PRD #17 §407). An estimate with no currency reads as
 * no estimate, because a bare number is not a value.
 */
export function LeadTable({ leads }: { leads: LeadSummaryDTO[] }) {
  const columns: TableColumn<LeadSummaryDTO>[] = [
    {
      key: "name",
      label: "Lead",
      primary: true,
      render: (lead) => <span className="font-medium text-fg">{lead.name}</span>,
    },
    {
      key: "company",
      label: "Company",
      hideBelow: "md",
      render: (lead) => lead.companyName ?? <span className="text-fg-subtle">—</span>,
    },
    {
      key: "source",
      label: "Source",
      hideBelow: "lg",
      render: (lead) => leadSourceLabels[lead.source],
    },
    {
      key: "owner",
      label: "Owner",
      hideBelow: "lg",
      render: (lead) =>
        lead.owner ? (
          <span className={lead.owner.active ? undefined : "text-fg-subtle"}>
            <PersonLink memberId={lead.owner.memberId} name={lead.owner.fullName} />
            {lead.owner.active ? "" : " (inactive)"}
          </span>
        ) : (
          <span className="text-fg-subtle">Unassigned</span>
        ),
    },
    {
      key: "value",
      label: "Estimated value",
      align: "right",
      render: (lead) =>
        lead.estimatedValue && lead.currency ? (
          <span className="tabular-nums">{formatAmount(lead.estimatedValue, lead.currency)}</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { key: "status", label: "Status", render: (lead) => <StatusBadge status={lead.status} /> },
    {
      key: "updated",
      label: "Updated",
      hideBelow: "xl",
      render: (lead) => (
        <span className="text-meta text-fg-subtle">{formatDate(lead.updatedAt)}</span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      records={leads}
      rowKey={(lead) => lead.id}
      rowHref={(lead) => `/sales/leads/${lead.id}`}
      caption="Leads"
    />
  );
}
