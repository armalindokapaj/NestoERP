import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { getTranslations } from "@/lib/i18n/server";
import type { TableSortConfig } from "@/components/data/sort-header";
import { BudgetRiskBadge } from "@/components/finance/budget-risk-badge";
import { companyColumn, GroupRecordLink } from "@/components/finance/group-rows";
import { Money, Variance } from "@/components/finance/money";
import { StatusBadge } from "@/components/modules/status-badge";
import { Badge } from "@/components/ui/badge";
import type { BudgetSummaryDTO } from "@/lib/modules/finance/finance.types";

/**
 * The budget list (PRD #15 §169).
 *
 * Actual and forecast are the *project's*, not the version's: a superseded
 * budget row shows what the project has really spent, which is the only
 * comparison that means anything (PRD #15 §118).
 */
export async function BudgetTable({ budgets, listId = "finance.budgets", sort }: {
  budgets: BudgetSummaryDTO[];
  /** The table's own list id: a nested use names its own, so its column choice is its own (AUD-08 §5). */
  listId?: string;
  /** The list's parsed sort and allowlist; header sorts only where the page reads the `sort` they write (AUD-08 §4). */
  sort?: TableSortConfig;
}) {
  const t = await getTranslations("finance");
  // Rows read in the Group workspace name their company and open through it.
  const grouped = budgets.some((budget) => budget.company);

  const columns: TableColumn<BudgetSummaryDTO>[] = [
    {
      key: "project",
      id: "project",
      mandatory: true,
      label: t("columns.project"),
      primary: true,
      render: (budget) => {
        const label = (
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate">{budget.project.name}</span>
              {budget.isCurrent ? <Badge tone="info">{t("current")}</Badge> : null}
            </span>
            <span className="block truncate text-meta font-normal text-fg-subtle">
              {budget.project.code} · v{budget.version}
              {budget.name ? ` · ${budget.name}` : ""}
            </span>
          </span>
        );
        return grouped && budget.company ? (
          <GroupRecordLink company={budget.company} href={`/finance/budgets/${budget.id}`}>
            {label}
          </GroupRecordLink>
        ) : (
          label
        );
      },
    },
    ...(grouped ? [companyColumn<BudgetSummaryDTO>(t("group.company"))] : []),
    {
      key: "budget",
      id: "budget",
      mandatory: true,
      valueType: "money",
      sortKey: sort ? "amount" : undefined,
      label: t("columns.budget"),
      align: "right",
      render: (budget) => (
        <Money amount={budget.budgetAmount} currency={budget.currency} emphasis />
      ),
    },
    {
      key: "actual",
      id: "actual",
      valueType: "money",
      label: t("columns.actual"),
      align: "right",
      hideBelow: "lg",
      render: (budget) => (
        <Money
          amount={budget.actualCost}
          currency={budget.currency}
          className="text-fg-muted"
        />
      ),
    },
    {
      key: "committed",
      id: "committed",
      valueType: "money",
      label: t("columns.committed"),
      align: "right",
      hideBelow: "xl",
      render: (budget) => (
        <Money
          amount={budget.openCommitments}
          currency={budget.currency}
          className="text-fg-muted"
        />
      ),
    },
    {
      key: "forecast",
      id: "forecast",
      valueType: "money",
      label: t("columns.forecast"),
      align: "right",
      hideBelow: "lg",
      render: (budget) => (
        <Money
          amount={budget.forecastCost}
          currency={budget.currency}
          className="text-fg-muted"
        />
      ),
    },
    {
      key: "variance",
      id: "variance",
      valueType: "money",
      label: t("columns.variance"),
      align: "right",
      render: (budget) => <Variance amount={budget.variance} currency={budget.currency} />,
    },
    {
      key: "risk",
      id: "risk",
      valueType: "status",
      label: t("columns.risk"),
      hideBelow: "md",
      render: (budget) => (
        <BudgetRiskBadge risk={budget.risk} utilizationPercent={budget.utilizationPercent} />
      ),
    },
    {
      key: "status",
      id: "status",
      mandatory: true,
      valueType: "status",
      label: t("columns.status"),
      render: (budget) => <StatusBadge status={budget.status} />,
    },
  ];

  return (
    <DataTable
      listId={listId}
      sort={sort}
      caption={t("captions.budgets")}
      columns={columns}
      records={budgets}
      rowKey={(budget) => budget.id}
      rowHref={grouped ? undefined : (budget) => `/finance/budgets/${budget.id}`}
    />
  );
}

/** A compact budget summary for the project finance tab. */
export function BudgetSummaryLink({ budget }: { budget: BudgetSummaryDTO }) {
  return (
    <Link
      href={`/finance/budgets/${budget.id}`}
      className="text-table font-medium text-accent-strong hover:underline"
    >
      v{budget.version}
    </Link>
  );
}
