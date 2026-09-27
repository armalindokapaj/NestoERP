import { DataTable, type TableColumn } from "@/components/data/data-table";
import { StatusBadge } from "@/components/modules/status-badge";
import { PersonLink } from "@/components/people/person-link";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import type { OpportunitySummaryDTO } from "@/lib/modules/sales/sales.types";
import { formatDate } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";
import { formatAmount } from "./sales-format";

/**
 * The opportunity list (PRD #17 §71, §282).
 *
 * Probability says whether it is the stage's default or a manual override, so a
 * forecast a person changed by hand does not look like the system's own opinion
 * (PRD #17 §276). An overdue expected close is labelled in words rather than by
 * colour alone (PRD #17 §296, §405).
 *
 * In the Group workspace (`grouped`) each row names its company and opens the
 * deal through the company hop, since a deal's own page is one company's
 * (Workspace Context §31, §45).
 */
export async function OpportunityTable({
  opportunities,
  showClient = true,
  grouped = false,
  listId = "sales.opportunities",
}: {
  opportunities: OpportunitySummaryDTO[];
  showClient?: boolean;
  grouped?: boolean;
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
}) {
  const t = await getTranslations("sales");
  const columns: TableColumn<OpportunitySummaryDTO>[] = [
    {
      key: "name",
      id: "name",
      mandatory: true,
      label: t("tables.opportunity"),
      primary: true,
      render: (row) =>
        grouped && row.company ? (
          <CompanyRecordLink
            companyId={row.company.id}
            companyName={row.company.name}
            href={`/sales/opportunities/${row.id}`}
            className="font-medium text-fg transition-colors hover:text-accent"
          >
            {row.name}
          </CompanyRecordLink>
        ) : (
          <span className="font-medium text-fg">{row.name}</span>
        ),
    },
    ...(grouped
      ? [
          {
            key: "company",
            id: "company",
            label: t("tables.company"),
            render: (row: OpportunitySummaryDTO) => (row.company ? <CompanyTag name={row.company.name} /> : null),
          },
        ]
      : []),
    ...(showClient
      ? [
          {
            key: "client",
            id: "client",
            label: t("tables.client"),
            hideBelow: "md" as const,
            render: (row: OpportunitySummaryDTO) =>
              row.client?.name ?? <span className="text-fg-subtle">{t("tables.noClientYet")}</span>,
          },
        ]
      : []),
    {
      key: "owner",
      id: "owner",
      label: t("tables.owner"),
      hideBelow: "xl",
      render: (row) => (
        <span className={row.owner.active ? undefined : "text-fg-subtle"}>
          <PersonLink memberId={row.owner.memberId} name={row.owner.fullName} />
          {row.owner.active ? "" : t("tables.inactive")}
        </span>
      ),
    },
    { key: "stage", label: t("tables.stage"), render: (row) => <StatusBadge status={row.stage} /> },
    {
      key: "value",
      id: "value",
      valueType: "money",
      label: t("tables.value"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums">{formatAmount(row.estimatedValue, row.currency)}</span>
      ),
    },
    {
      key: "probability",
      id: "probability",
      valueType: "number",
      label: t("tables.probability"),
      align: "right",
      hideBelow: "lg",
      render: (row) => (
        <span className="tabular-nums" title={row.probabilityIsOverride ? t("tables.manualOverride") : t("tables.stageDefault")}>
          {row.probability}%{row.probabilityIsOverride ? "*" : ""}
        </span>
      ),
    },
    {
      key: "weighted",
      id: "weighted",
      valueType: "money",
      label: t("tables.weighted"),
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
      id: "close",
      valueType: "date",
      label: t("tables.expectedClose"),
      hideBelow: "xl",
      render: (row) =>
        row.expectedCloseDate ? (
          <span className={row.expectedCloseOverdue ? "text-warning-strong" : undefined}>
            {formatDate(row.expectedCloseDate)}
            {row.expectedCloseOverdue ? t("tables.overdue") : ""}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
  ];

  return (
    <DataTable
      listId={listId}
      columns={columns}
      records={opportunities}
      rowKey={(row) => row.id}
      rowHref={grouped ? undefined : (row) => `/sales/opportunities/${row.id}`}
      caption={t("tables.opportunities")}
    />
  );
}
