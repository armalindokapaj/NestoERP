import Link from "@/components/navigation/nav-link";

import { DataTable, type TableColumn } from "@/components/data/data-table";
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
export function BudgetTable({ budgets }: { budgets: BudgetSummaryDTO[] }) {
  // Rows read in the Group workspace name their company and open through it.
  const grouped = budgets.some((budget) => budget.company);

  const columns: TableColumn<BudgetSummaryDTO>[] = [
    {
      key: "project",
      label: "Project",
      primary: true,
      render: (budget) => {
        const label = (
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate">{budget.project.name}</span>
              {budget.isCurrent ? <Badge tone="info">Current</Badge> : null}
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
    ...(grouped ? [companyColumn<BudgetSummaryDTO>()] : []),
    {
      key: "budget",
      label: "Budget",
      align: "right",
      render: (budget) => (
        <Money amount={budget.budgetAmount} currency={budget.currency} emphasis />
      ),
    },
    {
      key: "actual",
      label: "Actual",
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
      label: "Committed",
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
      label: "Forecast",
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
      label: "Variance",
      align: "right",
      render: (budget) => <Variance amount={budget.variance} currency={budget.currency} />,
    },
    {
      key: "risk",
      label: "Risk",
      hideBelow: "md",
      render: (budget) => (
        <BudgetRiskBadge risk={budget.risk} utilizationPercent={budget.utilizationPercent} />
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (budget) => <StatusBadge status={budget.status} />,
    },
  ];

  return (
    <DataTable
      caption="Project budgets"
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
