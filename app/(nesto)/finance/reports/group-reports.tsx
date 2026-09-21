import Link from "next/link";
import { ChartColumn } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { BudgetRiskBadge } from "@/components/finance/budget-risk-badge";
import { companyColumn, GroupRecordLink } from "@/components/finance/group-rows";
import { Money, Variance } from "@/components/finance/money";
import { EmptyState } from "@/components/ui/empty-state";
import type { UserContext } from "@/lib/context/types";
import { expenseCategoryLabels } from "@/lib/modules/finance/expenses/expense.status";
import * as reports from "@/lib/modules/finance/reports/reports.service";
import { cn } from "@/lib/utils/cn";

/**
 * The built-in reports in the Group workspace (Workspace Context §41, §60, §72).
 *
 * Each is the company's own report for every company the reader may open it in,
 * row by row with the company that says it, and beneath the rows the totals: an
 * amount is added to the same currency in another company and never to another
 * currency, so a group holding EUR and USD lists both. A company where Finance
 * is off or where the reader lacks the report's permission is not asked (§92).
 */

const CURRENCY_NOTE = "Totals add a currency only to itself: NESTO does not convert between currencies.";

/* Receivables aging -------------------------------------------------------- */

export async function GroupAgingReport({ context }: { context: UserContext }) {
  const { rows, totals } = await reports.receivablesAgingAcross(context);

  if (rows.length === 0) {
    return <EmptyState icon={<ChartColumn />} title="Nothing outstanding." description="Every sent invoice in the companies you can read has been settled." />;
  }

  return (
    <div className="space-y-3">
      <p className="text-meta text-fg-subtle">Outstanding on sent invoices, by how far past the due date they are, company by company. {CURRENCY_NOTE}</p>
      <div className="nesto-card overflow-x-auto">
        <table className="w-full text-table">
          <caption className="sr-only">Receivables aging by company</caption>
          <thead className="border-b border-line text-meta uppercase tracking-wide text-fg-subtle">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Company
              </th>
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
              <tr key={`${row.company.id}-${row.currency}`}>
                <th scope="row" className="px-4 py-2.5 text-left font-medium text-fg">
                  {row.company.name}
                </th>
                <td className="px-4 py-2.5 text-left text-fg-muted">{row.currency}</td>
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
          <tfoot className="border-t border-line-strong bg-surface-muted">
            {totals.map((row) => (
              <tr key={row.currency}>
                <th scope="row" className="px-4 py-2.5 text-left font-semibold text-fg">
                  All companies
                </th>
                <td className="px-4 py-2.5 text-left text-fg-muted">{row.currency}</td>
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
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* Budget vs actual --------------------------------------------------------- */

export async function GroupBudgetReport({ context }: { context: UserContext }) {
  const { rows, totals } = await reports.budgetVsActualAcross(context);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title="No approved budgets in your view."
        description="A project needs an approved budget before its variance means anything."
      />
    );
  }

  type Row = (typeof rows)[number];
  const columns: TableColumn<Row>[] = [
    {
      key: "project",
      label: "Project",
      primary: true,
      render: (row) => (
        <GroupRecordLink company={row.company} href={`/projects/${row.projectId}/finance`}>
          <span className="min-w-0">
            <span className="block truncate">{row.name}</span>
            <span className="block truncate text-meta font-normal text-fg-subtle">{row.code}</span>
          </span>
        </GroupRecordLink>
      ),
    },
    companyColumn<Row>(),
    { key: "budget", label: "Budget", align: "right", render: (row) => <Money amount={row.budget} currency={row.currency} emphasis /> },
    { key: "actual", label: "Actual", align: "right", render: (row) => <Money amount={row.actual} currency={row.currency} className="text-fg-muted" /> },
    { key: "committed", label: "Committed", align: "right", hideBelow: "lg", render: (row) => <Money amount={row.openCommitments} currency={row.currency} className="text-fg-muted" /> },
    { key: "forecast", label: "Forecast", align: "right", hideBelow: "md", render: (row) => <Money amount={row.forecast} currency={row.currency} className="text-fg-muted" /> },
    { key: "variance", label: "Variance", align: "right", render: (row) => <Variance amount={row.variance} currency={row.currency} /> },
    { key: "risk", label: "Utilisation", render: (row) => <BudgetRiskBadge risk={row.risk} utilizationPercent={row.utilizationPercent} /> },
  ];

  return (
    <div className="space-y-3">
      <DataTable caption="Budget vs actual by company" columns={columns} records={rows} rowKey={(row) => `${row.company.id}-${row.projectId}`} />
      <div className="nesto-card overflow-x-auto">
        <table className="w-full text-table">
          <caption className="sr-only">Budget vs actual totals by currency</caption>
          <thead className="border-b border-line text-meta uppercase tracking-wide text-fg-subtle">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                All companies
              </th>
              {["Budget", "Actual", "Committed", "Forecast", "Variance"].map((label) => (
                <th key={label} scope="col" className="px-4 py-2.5 text-right font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {totals.map((row) => (
              <tr key={row.currency}>
                <th scope="row" className="px-4 py-2.5 text-left font-medium text-fg">
                  {row.currency}
                </th>
                <td className="px-4 py-2.5 text-right">
                  <Money amount={row.budget} currency={row.currency} emphasis />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Money amount={row.actual} currency={row.currency} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Money amount={row.openCommitments} currency={row.currency} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Money amount={row.forecast} currency={row.currency} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Variance amount={row.variance} currency={row.currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-meta text-fg-subtle">{CURRENCY_NOTE}</p>
    </div>
  );
}

/* Expenses by category ----------------------------------------------------- */

export async function GroupCategoryReport({ context }: { context: UserContext }) {
  const { rows, totals } = await reports.expensesByCategoryAcross(context);

  if (rows.length === 0) {
    return <EmptyState icon={<ChartColumn />} title="No approved cost yet." description="Approved expenses are what actual cost is calculated from." />;
  }

  type Row = (typeof rows)[number];
  const label = (category: string) => expenseCategoryLabels[category as keyof typeof expenseCategoryLabels];
  const columns: TableColumn<Row>[] = [
    { key: "category", label: "Category", primary: true, render: (row) => label(row.category) },
    companyColumn<Row>(),
    { key: "currency", label: "Currency", render: (row) => row.currency },
    { key: "actual", label: "Actual cost", align: "right", render: (row) => <Money amount={row.actual} currency={row.currency} emphasis /> },
    { key: "committed", label: "Open commitments", align: "right", render: (row) => <Money amount={row.committed} currency={row.currency} className="text-fg-muted" /> },
  ];
  const totalColumns: TableColumn<(typeof totals)[number]>[] = [
    { key: "category", label: "Category", primary: true, render: (row) => label(row.category) },
    { key: "currency", label: "Currency", render: (row) => row.currency },
    { key: "actual", label: "Actual cost", align: "right", render: (row) => <Money amount={row.actual} currency={row.currency} emphasis /> },
    { key: "committed", label: "Open commitments", align: "right", render: (row) => <Money amount={row.committed} currency={row.currency} className="text-fg-muted" /> },
  ];

  return (
    <div className="space-y-3">
      <DataTable caption="Expenses by category and company" columns={columns} records={rows} rowKey={(row) => `${row.company.id}-${row.category}-${row.currency}`} />
      <h2 className="text-card font-semibold text-fg">All companies</h2>
      <DataTable caption="Expenses by category, all companies" columns={totalColumns} records={totals} rowKey={(row) => `${row.category}-${row.currency}`} />
      <p className="text-meta text-fg-subtle">{CURRENCY_NOTE}</p>
    </div>
  );
}

/* Cashflow ----------------------------------------------------------------- */

export async function GroupCashflowReport({ context, period }: { context: UserContext; period?: string }) {
  const known = (reports.CASHFLOW_PERIODS as readonly string[]).includes(period ?? "");
  const selected = known ? (period as reports.CashflowPeriod) : "this-month";
  const report = await reports.cashflowSummaryAcross(context, selected);

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
              entry === selected ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {reports.cashflowPeriodLabels[entry]}
          </Link>
        ))}
      </nav>

      <p className="text-meta text-fg-subtle">
        Recorded payments between {report.from} and {report.to}. Voided payments are excluded. {CURRENCY_NOTE}
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
            <caption className="sr-only">Cashflow summary by company</caption>
            <thead className="border-b border-line text-meta uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left font-medium">
                  Company
                </th>
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
                <tr key={`${row.company.id}-${row.currency}`}>
                  <th scope="row" className="px-4 py-2.5 text-left font-medium text-fg">
                    {row.company.name}
                  </th>
                  <td className="px-4 py-2.5 text-left text-fg-muted">{row.currency}</td>
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
            <tfoot className="border-t border-line-strong bg-surface-muted">
              {report.totals.map((row) => (
                <tr key={row.currency}>
                  <th scope="row" className="px-4 py-2.5 text-left font-semibold text-fg">
                    All companies
                  </th>
                  <td className="px-4 py-2.5 text-left text-fg-muted">{row.currency}</td>
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
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* Commitment summary ------------------------------------------------------- */

export async function GroupCommitmentReport({ context }: { context: UserContext }) {
  const { rows, totals } = await reports.commitmentSummaryAcross(context);

  if (rows.length === 0) {
    return <EmptyState icon={<ChartColumn />} title="No open commitments." description="Approved commitments that have not been closed appear here." />;
  }

  type Row = (typeof rows)[number];
  const columns: TableColumn<Row>[] = [
    { key: "project", label: "Project", primary: true, render: (row) => row.projectName },
    companyColumn<Row>(),
    { key: "category", label: "Category", render: (row) => expenseCategoryLabels[row.category as keyof typeof expenseCategoryLabels] },
    { key: "currency", label: "Currency", hideBelow: "md", render: (row) => row.currency },
    { key: "amount", label: "Open commitment", align: "right", render: (row) => <Money amount={row.amount} currency={row.currency} emphasis /> },
  ];

  return (
    <div className="space-y-3">
      <DataTable
        caption="Commitment summary by company"
        columns={columns}
        records={rows}
        rowKey={(row) => `${row.company.id}-${row.projectId ?? "company"}-${row.category}-${row.currency}`}
      />
      <p className="text-right text-table text-fg-muted">
        Total open commitment, all companies:{" "}
        {totals.map((total) => (
          <span key={total.currency} className="ml-2 font-semibold text-fg">
            <Money amount={total.amount} currency={total.currency} />
          </span>
        ))}
      </p>
      <p className="text-right text-meta text-fg-subtle">{CURRENCY_NOTE}</p>
    </div>
  );
}
