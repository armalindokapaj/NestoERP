import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChartColumn } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { BudgetRiskBadge } from "@/components/finance/budget-risk-badge";
import { Money, Variance } from "@/components/finance/money";
import { ModulePage } from "@/components/modules/module-page";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import { expenseCategoryLabels } from "@/lib/modules/finance/expenses/expense.status";
import * as reports from "@/lib/modules/finance/reports/reports.service";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Finance reports" };

/**
 * The built-in reports (PRD #15 §147, §148).
 *
 * Six named reports, not a report builder. Each one is offered only when the
 * reader holds the permission behind it, so the tab strip is the list of
 * reports they can actually open (PRD #15 §158).
 */
const REPORTS = [
  { key: "receivables-aging", label: "Receivables aging", permission: "finance.receivables.view" },
  { key: "budget-vs-actual", label: "Budget vs actual", permission: "finance.project_budget.view" },
  { key: "expenses-by-category", label: "Expenses by category", permission: "finance.expense.view" },
  { key: "cashflow", label: "Cashflow", permission: "finance.cashflow.view" },
  { key: "commitment-summary", label: "Commitments", permission: "finance.commitment.view" },
] as const;

type ReportKey = (typeof REPORTS)[number]["key"];

export default async function FinanceReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; period?: string }>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.report.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "finance");
  const { report: requested, period } = await searchParams;

  const available = REPORTS.filter((entry) =>
    can(context, entry.permission as Parameters<typeof can>[1]),
  );

  if (available.length === 0) {
    return (
      <ModulePage experience={experience} activeSection="reports">
        <EmptyState
          icon={<ChartColumn />}
          title="No reports in your view."
          description="Reports follow the same permissions as the lists they summarise."
        />
      </ModulePage>
    );
  }

  const active = (available.find((entry) => entry.key === requested)?.key ??
    available[0].key) as ReportKey;

  return (
    <ModulePage experience={experience} activeSection="reports">
      <div className="space-y-5">
        <nav aria-label="Reports" className="border-b border-line">
          <ul className="-mb-px flex gap-1 overflow-x-auto">
            {available.map((entry) => (
              <li key={entry.key}>
                <Link
                  href={`/finance/reports?report=${entry.key}`}
                  aria-current={entry.key === active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors",
                    entry.key === active
                      ? "border-accent text-fg"
                      : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  {entry.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {active === "receivables-aging" ? <AgingReport context={context} /> : null}
        {active === "budget-vs-actual" ? <BudgetReport context={context} /> : null}
        {active === "expenses-by-category" ? <CategoryReport context={context} /> : null}
        {active === "cashflow" ? <CashflowReport context={context} period={period} /> : null}
        {active === "commitment-summary" ? <CommitmentReport context={context} /> : null}
      </div>
    </ModulePage>
  );
}

/* Receivables aging (PRD #15 §149, §150) ----------------------------------- */

async function AgingReport({ context }: { context: UserContext }) {
  const rows = await reports.receivablesAging(context);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title="Nothing outstanding."
        description="Every sent invoice in your view has been settled."
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Grouped by currency and never combined: V0.1 has no FX engine, and a
          total across currencies would be arithmetic that means nothing. */}
      <p className="text-meta text-fg-subtle">
        Outstanding on sent invoices, by how far past the due date they are. Currencies are
        reported separately.
      </p>
      <div className="nesto-card overflow-x-auto">
        <table className="w-full text-table">
          <caption className="sr-only">Receivables aging</caption>
          <thead className="border-b border-line text-meta uppercase tracking-wide text-fg-subtle">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Currency
              </th>
              {reports.AGING_BUCKETS.map((bucket) => (
                <th key={bucket} scope="col" className="px-4 py-2.5 text-right font-medium">
                  {reports.agingBucketLabels[bucket]}
                </th>
              ))}
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.currency}>
                <th scope="row" className="px-4 py-2.5 text-left font-medium text-fg">
                  {row.currency}
                </th>
                {reports.AGING_BUCKETS.map((bucket) => (
                  <td key={bucket} className="px-4 py-2.5 text-right">
                    <Money amount={row.buckets[bucket]} currency={row.currency} />
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right">
                  <Money amount={row.total} currency={row.currency} emphasis />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* Budget vs actual (PRD #15 §151) ------------------------------------------ */

async function BudgetReport({ context }: { context: UserContext }) {
  const rows = await reports.budgetVsActual(context);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title="No approved budgets in your view."
        description="A project needs an approved budget before its variance means anything."
      />
    );
  }

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "project",
      label: "Project",
      primary: true,
      render: (row) => (
        <span className="min-w-0">
          <span className="block truncate">{row.name}</span>
          <span className="block truncate text-meta font-normal text-fg-subtle">{row.code}</span>
        </span>
      ),
    },
    {
      key: "budget",
      label: "Budget",
      align: "right",
      render: (row) => <Money amount={row.budget} currency={row.currency} emphasis />,
    },
    {
      key: "actual",
      label: "Actual",
      align: "right",
      render: (row) => (
        <Money amount={row.actual} currency={row.currency} className="text-fg-muted" />
      ),
    },
    {
      key: "committed",
      label: "Committed",
      align: "right",
      hideBelow: "lg",
      render: (row) => (
        <Money amount={row.openCommitments} currency={row.currency} className="text-fg-muted" />
      ),
    },
    {
      key: "forecast",
      label: "Forecast",
      align: "right",
      hideBelow: "md",
      render: (row) => (
        <Money amount={row.forecast} currency={row.currency} className="text-fg-muted" />
      ),
    },
    {
      key: "variance",
      label: "Variance",
      align: "right",
      render: (row) => <Variance amount={row.variance} currency={row.currency} />,
    },
    {
      key: "risk",
      label: "Utilisation",
      render: (row) => (
        <BudgetRiskBadge risk={row.risk} utilizationPercent={row.utilizationPercent} />
      ),
    },
  ];

  return (
    <DataTable
      caption="Budget vs actual"
      columns={columns}
      records={rows}
      rowKey={(row) => row.projectId}
      rowHref={(row) => `/projects/${row.projectId}/finance`}
    />
  );
}

/* Expenses by category (PRD #15 §153) -------------------------------------- */

async function CategoryReport({ context }: { context: UserContext }) {
  const rows = await reports.expensesByCategory(context);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title="No approved cost yet."
        description="Approved expenses are what actual cost is calculated from."
      />
    );
  }

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "category",
      label: "Category",
      primary: true,
      render: (row) => expenseCategoryLabels[row.category as keyof typeof expenseCategoryLabels],
    },
    { key: "currency", label: "Currency", render: (row) => row.currency },
    {
      key: "actual",
      label: "Actual cost",
      align: "right",
      render: (row) => <Money amount={row.actual} currency={row.currency} emphasis />,
    },
    {
      key: "committed",
      label: "Open commitments",
      align: "right",
      render: (row) => (
        <Money amount={row.committed} currency={row.currency} className="text-fg-muted" />
      ),
    },
  ];

  return (
    <DataTable
      caption="Expenses by category"
      columns={columns}
      records={rows}
      rowKey={(row) => `${row.category}-${row.currency}`}
    />
  );
}

/* Cashflow (PRD #15 §154, §155) -------------------------------------------- */

async function CashflowReport({
  context,
  period,
}: {
  context: UserContext;
  period?: string;
}) {
  const known = (reports.CASHFLOW_PERIODS as readonly string[]).includes(period ?? "");
  const selected = known ? (period as reports.CashflowPeriod) : "this-month";
  const report = await reports.cashflowSummary(context, selected);

  return (
    <div className="space-y-3">
      <nav aria-label="Cashflow period" className="flex flex-wrap gap-2">
        {reports.CASHFLOW_PERIODS.map((entry) => (
          <Link
            key={entry}
            href={`/finance/reports?report=cashflow&period=${entry}`}
            aria-current={entry === selected ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-table font-medium transition-colors",
              entry === selected
                ? "border-accent bg-accent-soft text-accent-strong"
                : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {reports.cashflowPeriodLabels[entry]}
          </Link>
        ))}
      </nav>

      <p className="text-meta text-fg-subtle">
        Recorded payments between {report.from} and {report.to}. Voided payments are excluded.
      </p>

      {report.rows.length === 0 ? (
        <EmptyState
          icon={<ChartColumn />}
          title="No cash movement in this period."
          description="Try a wider period, or record a payment against an invoice or expense."
        />
      ) : (
        <div className="nesto-card overflow-x-auto">
          <table className="w-full text-table">
            <caption className="sr-only">Cashflow summary</caption>
            <thead className="border-b border-line text-meta uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left font-medium">
                  Currency
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Received
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Paid out
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Net
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.rows.map((row) => (
                <tr key={row.currency}>
                  <th scope="row" className="px-4 py-2.5 text-left font-medium text-fg">
                    {row.currency}
                  </th>
                  <td className="px-4 py-2.5 text-right">
                    <Money amount={row.cashIn} currency={row.currency} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Money amount={row.cashOut} currency={row.currency} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Variance amount={row.net} currency={row.currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* Commitment summary (PRD #15 §156) ---------------------------------------- */

async function CommitmentReport({ context }: { context: UserContext }) {
  const { rows, totals } = await reports.commitmentSummary(context);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title="No open commitments."
        description="Approved commitments that have not been closed appear here."
      />
    );
  }

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "project",
      label: "Project",
      primary: true,
      render: (row) => row.projectName,
    },
    {
      key: "category",
      label: "Category",
      render: (row) => expenseCategoryLabels[row.category as keyof typeof expenseCategoryLabels],
    },
    { key: "currency", label: "Currency", hideBelow: "md", render: (row) => row.currency },
    {
      key: "amount",
      label: "Open commitment",
      align: "right",
      render: (row) => <Money amount={row.amount} currency={row.currency} emphasis />,
    },
  ];

  return (
    <div className="space-y-3">
      <DataTable
        caption="Commitment summary"
        columns={columns}
        records={rows}
        rowKey={(row) => `${row.projectId ?? "company"}-${row.category}-${row.currency}`}
      />
      <p className="text-right text-table text-fg-muted">
        Total open commitment:{" "}
        {totals.map((total) => (
          <span key={total.currency} className="ml-2 font-semibold text-fg">
            <Money amount={total.amount} currency={total.currency} />
          </span>
        ))}
      </p>
    </div>
  );
}
