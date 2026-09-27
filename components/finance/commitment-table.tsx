import { DataTable, type TableColumn } from "@/components/data/data-table";
import type { TableSortConfig } from "@/components/data/sort-header";
import { Money } from "@/components/finance/money";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import type { CommitmentSummaryDTO } from "@/lib/modules/finance/finance.types";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate, orDash } from "@/lib/utils/format";

/** The commitment list (PRD #15 §171). */
export async function CommitmentTable({ commitments, listId = "finance.commitments", sort }: {
  commitments: CommitmentSummaryDTO[];
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
  /** The list's parsed sort and allowlist; header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const t = await getTranslations("finance");
  const columns: TableColumn<CommitmentSummaryDTO>[] = [
    {
      key: "description",
      id: "description",
      mandatory: true,
      label: t("columns.commitment"),
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
      id: "project",
      label: t("columns.project"),
      hideBelow: "lg",
      render: (commitment) => (
        <span className="text-fg-muted">{commitment.project?.name ?? t("companyWide")}</span>
      ),
    },
    {
      key: "category",
      id: "category",
      label: t("columns.category"),
      hideBelow: "xl",
      render: (commitment) => (
        <Badge tone="neutral">{t(`category.${commitment.category}`)}</Badge>
      ),
    },
    {
      key: "expected",
      id: "expected",
      valueType: "date",
      sortKey: sort ? "expected" : undefined,
      label: t("columns.expected"),
      hideBelow: "lg",
      render: (commitment) => (
        <span className="text-fg-muted">
          {commitment.expectedDate ? formatDate(commitment.expectedDate) : "—"}
        </span>
      ),
    },
    {
      key: "amount",
      id: "amount",
      mandatory: true,
      valueType: "money",
      sortKey: sort ? "amount" : undefined,
      label: t("columns.amount"),
      align: "right",
      render: (commitment) => (
        <Money amount={commitment.amount} currency={commitment.currency} emphasis />
      ),
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: t("columns.status"),
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
      listId={listId}
      sort={sort}
      caption={t("captions.commitments")}
      columns={columns}
      records={commitments}
      rowKey={(commitment) => commitment.id}
      rowHref={(commitment) => `/finance/commitments/${commitment.id}`}
    />
  );
}
