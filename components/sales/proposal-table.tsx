import { DataTable, type TableColumn } from "@/components/data/data-table";
import type { TableSortConfig } from "@/components/data/sort-header";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import type { ProposalSummaryDTO } from "@/lib/modules/sales/sales.types";
import { formatDate } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";
import { formatAmount } from "./sales-format";

/**
 * The proposal list (PRD #17 §283).
 *
 * "Expiring soon" is derived at read time and shown as a word, not a colour: a
 * proposal does not change when a date passes, but what the list should be
 * drawing attention to does (PRD #17 §402).
 */
export async function ProposalTable({
  proposals,
  showOpportunity = true,
  listId = "sales.proposals",
  sort,
}: {
  proposals: ProposalSummaryDTO[];
  showOpportunity?: boolean;
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
  /** The list's parsed sort and allowlist; header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const t = await getTranslations("sales");
  const columns: TableColumn<ProposalSummaryDTO>[] = [
    {
      key: "number",
      id: "number",
      mandatory: true,
      sortKey: sort ? "number" : undefined,
      label: t("tables.number"),
      primary: true,
      render: (row) => <span className="font-medium tabular-nums text-fg">{row.proposalNumber}</span>,
    },
    { key: "title", label: t("tables.title"), hideBelow: "md", render: (row) => row.title },
    ...(showOpportunity
      ? [
          {
            key: "opportunity",
            id: "opportunity",
            label: t("tables.opportunity"),
            hideBelow: "xl" as const,
            render: (row: ProposalSummaryDTO) => row.opportunity.name,
          },
        ]
      : []),
    { key: "client", label: t("tables.client"), hideBelow: "lg", render: (row) => row.client.name },
    {
      key: "total",
      id: "total",
      mandatory: true,
      valueType: "money",
      sortKey: sort ? "amount" : undefined,
      label: t("tables.total"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatAmount(row.totalAmount, row.currency)}</span>
      ),
    },
    {
      key: "valid",
      id: "valid",
      valueType: "date",
      label: t("tables.validUntil"),
      hideBelow: "lg",
      render: (row) =>
        row.validUntil ? (
          <span className="flex items-center gap-2">
            {formatDate(row.validUntil)}
            {row.expiry === "EXPIRING_SOON" ? <Badge tone="warning">{t("tables.expiringSoon")}</Badge> : null}
            {row.expiry === "EXPIRED" ? <Badge tone="danger">{t("tables.expired")}</Badge> : null}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { key: "status", label: t("tables.status"), render: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      columns={columns}
      records={proposals}
      rowKey={(row) => row.id}
      rowHref={(row) => `/sales/proposals/${row.id}`}
      caption={t("tables.proposals")}
    />
  );
}
