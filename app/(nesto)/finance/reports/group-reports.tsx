import Link from "@/components/navigation/nav-link";
import { ChartColumn } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { BudgetRiskBadge } from "@/components/finance/budget-risk-badge";
import { companyColumn, GroupRecordLink } from "@/components/finance/group-rows";
import { Money, Variance } from "@/components/finance/money";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollRegion } from "@/components/ui/scroll-region";
import type { UserContext } from "@/lib/context/types";
import * as reports from "@/lib/modules/finance/reports/reports.service";
import { cn } from "@/lib/utils/cn";
import { getTranslations } from "@/lib/i18n/server";

/**
 * The built-in reports in the Group workspace (Workspace Context §41, §60, §72).
 *
 * Each is the company's own report for every company the reader may open it in,
 * row by row with the company that says it, and beneath the rows the totals: an
 * amount is added to the same currency in another company and never to another
 * currency, so a group holding EUR and USD lists both. A company where Finance
 * is off or where the reader lacks the report's permission is not asked (§92).
 */


/* Receivables aging -------------------------------------------------------- */

export async function GroupAgingReport({ context }: { context: UserContext }) {
  const t = await getTranslations("finance");
  const { rows, totals } = await reports.receivablesAgingAcross(context);

  if (rows.length === 0) {
    return <EmptyState icon={<ChartColumn />} title={t("reports.agingNone")} description={t("reports.groupAgingNoneBody")} />;
  }

  return (
    <div className="space-y-3">
      <p className="text-meta text-fg-subtle">{t("reports.groupAgingHint")} {t("reports.currencyNote")}</p>
      <ScrollRegion label={t("reports.agingByCompany")} className="nesto-card">
        <table className="w-full text-table">
          <caption className="sr-only">{t("reports.agingByCompany")}</caption>
          <thead className="border-b border-line text-meta uppercase tracking-wide text-fg-subtle">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                {t("group.company")}
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                {t("form.currency")}
              </th>
              {reports.AGING_BUCKETS.map((bucket) => (
                <th key={bucket} scope="col" className="px-4 py-2.5 text-right font-medium">
                  {t(`aging.${bucket}`)}
                </th>
              ))}
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {t("columns.total")}
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
                  {t("reports.allCompanies")}
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
      </ScrollRegion>
    </div>
  );
}

/* Budget vs actual --------------------------------------------------------- */

export async function GroupBudgetReport({ context }: { context: UserContext }) {
  const t = await getTranslations("finance");
  const { rows, totals } = await reports.budgetVsActualAcross(context);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title={t("reports.budgetNone")}
        description={t("reports.budgetNoneBody")}
      />
    );
  }

  type Row = (typeof rows)[number];
  const columns: TableColumn<Row>[] = [
    {
      key: "project",
      label: t("form.project"),
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
    companyColumn<Row>(t("group.company")),
    { key: "budget", label: t("columns.budget"), align: "right", render: (row) => <Money amount={row.budget} currency={row.currency} emphasis /> },
    { key: "actual", label: t("columns.actual"), align: "right", render: (row) => <Money amount={row.actual} currency={row.currency} className="text-fg-muted" /> },
    { key: "committed", label: t("columns.committed"), align: "right", hideBelow: "lg", render: (row) => <Money amount={row.openCommitments} currency={row.currency} className="text-fg-muted" /> },
    { key: "forecast", label: t("columns.forecast"), align: "right", hideBelow: "md", render: (row) => <Money amount={row.forecast} currency={row.currency} className="text-fg-muted" /> },
    { key: "variance", label: t("columns.variance"), align: "right", render: (row) => <Variance amount={row.variance} currency={row.currency} /> },
    { key: "risk", label: t("budgets.utilisation"), render: (row) => <BudgetRiskBadge risk={row.risk} utilizationPercent={row.utilizationPercent} /> },
  ];

  return (
    <div className="space-y-3">
      <DataTable caption={t("reports.budgetByCompany")} columns={columns} records={rows} rowKey={(row) => `${row.company.id}-${row.projectId}`} />
      <ScrollRegion label={t("reports.budgetTotals")} className="nesto-card">
        <table className="w-full text-table">
          <caption className="sr-only">{t("reports.budgetTotals")}</caption>
          <thead className="border-b border-line text-meta uppercase tracking-wide text-fg-subtle">
            <tr>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                {t("reports.allCompanies")}
              </th>
              {(["budget", "actual", "committed", "forecast", "variance"] as const).map((label) => (
                <th key={label} scope="col" className="px-4 py-2.5 text-right font-medium">
                  {t(`columns.${label}`)}
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
      </ScrollRegion>
      <p className="text-meta text-fg-subtle">{t("reports.currencyNote")}</p>
    </div>
  );
}

/* Expenses by category ----------------------------------------------------- */

export async function GroupCategoryReport({ context }: { context: UserContext }) {
  const t = await getTranslations("finance");
  const { rows, totals } = await reports.expensesByCategoryAcross(context);

  if (rows.length === 0) {
    return <EmptyState icon={<ChartColumn />} title={t("reports.categoryNone")} description={t("reports.categoryNoneBody")} />;
  }

  type Row = (typeof rows)[number];
  const label = (category: string) => t(`category.${category as "OTHER"}`);
  const columns: TableColumn<Row>[] = [
    { key: "category", label: t("form.category"), primary: true, render: (row) => label(row.category) },
    companyColumn<Row>(t("group.company")),
    { key: "currency", label: t("form.currency"), render: (row) => row.currency },
    { key: "actual", label: t("reports.actualCost"), align: "right", render: (row) => <Money amount={row.actual} currency={row.currency} emphasis /> },
    { key: "committed", label: t("overview.openCommitments"), align: "right", render: (row) => <Money amount={row.committed} currency={row.currency} className="text-fg-muted" /> },
  ];
  const totalColumns: TableColumn<(typeof totals)[number]>[] = [
    { key: "category", label: t("form.category"), primary: true, render: (row) => label(row.category) },
    { key: "currency", label: t("form.currency"), render: (row) => row.currency },
    { key: "actual", label: t("reports.actualCost"), align: "right", render: (row) => <Money amount={row.actual} currency={row.currency} emphasis /> },
    { key: "committed", label: t("overview.openCommitments"), align: "right", render: (row) => <Money amount={row.committed} currency={row.currency} className="text-fg-muted" /> },
  ];

  return (
    <div className="space-y-3">
      <DataTable caption={t("reports.categoryByCompany")} columns={columns} records={rows} rowKey={(row) => `${row.company.id}-${row.category}-${row.currency}`} />
      <h2 className="text-card font-semibold text-fg">{t("reports.allCompanies")}</h2>
      <DataTable caption={t("reports.categoryAll")} columns={totalColumns} records={totals} rowKey={(row) => `${row.category}-${row.currency}`} />
      <p className="text-meta text-fg-subtle">{t("reports.currencyNote")}</p>
    </div>
  );
}

/* Cashflow ----------------------------------------------------------------- */

export async function GroupCashflowReport({ context, period }: { context: UserContext; period?: string }) {
  const t = await getTranslations("finance");
  const known = (reports.CASHFLOW_PERIODS as readonly string[]).includes(period ?? "");
  const selected = known ? (period as reports.CashflowPeriod) : "this-month";
  const report = await reports.cashflowSummaryAcross(context, selected);

  return (
    <div className="space-y-3">
      <nav aria-label={t("reports.period")} className="flex flex-wrap gap-2">
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
            {t(`cashflowPeriod.${entry}`)}
          </Link>
        ))}
      </nav>

      <p className="text-meta text-fg-subtle">
        {t("reports.cashflowHint", { from: report.from, to: report.to })} {t("reports.currencyNote")}
      </p>

      {report.rows.length === 0 ? (
        <EmptyState
          icon={<ChartColumn />}
          title={t("reports.cashflowNone")}
          description={t("reports.cashflowNoneBody")}
        />
      ) : (
        <ScrollRegion label={t("reports.cashflowByCompany")} className="nesto-card">
          <table className="w-full text-table">
            <caption className="sr-only">{t("reports.cashflowByCompany")}</caption>
            <thead className="border-b border-line text-meta uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left font-medium">
                  {t("group.company")}
                </th>
                <th scope="col" className="px-4 py-2.5 text-left font-medium">
                  {t("form.currency")}
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  {t("overview.received")}
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  {t("overview.paidOut")}
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  {t("overview.net")}
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
                    {t("reports.allCompanies")}
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
        </ScrollRegion>
      )}
    </div>
  );
}

/* Commitment summary ------------------------------------------------------- */

export async function GroupCommitmentReport({ context }: { context: UserContext }) {
  const t = await getTranslations("finance");
  const { rows, totals } = await reports.commitmentSummaryAcross(context);

  if (rows.length === 0) {
    return <EmptyState icon={<ChartColumn />} title={t("reports.commitmentNone")} description={t("reports.commitmentNoneBody")} />;
  }

  type Row = (typeof rows)[number];
  const columns: TableColumn<Row>[] = [
    { key: "project", label: t("form.project"), primary: true, render: (row) => row.projectName },
    companyColumn<Row>(t("group.company")),
    { key: "category", label: t("form.category"), render: (row) => t(`category.${row.category as "OTHER"}`) },
    { key: "currency", label: t("form.currency"), hideBelow: "md", render: (row) => row.currency },
    { key: "amount", label: t("reports.openCommitment"), align: "right", render: (row) => <Money amount={row.amount} currency={row.currency} emphasis /> },
  ];

  return (
    <div className="space-y-3">
      <DataTable
        caption={t("reports.commitmentByCompany")}
        columns={columns}
        records={rows}
        rowKey={(row) => `${row.company.id}-${row.projectId ?? "company"}-${row.category}-${row.currency}`}
      />
      <p className="text-right text-table text-fg-muted">
        {t("reports.totalOpenAll")}{" "}
        {totals.map((total) => (
          <span key={total.currency} className="ml-2 font-semibold text-fg">
            <Money amount={total.amount} currency={total.currency} />
          </span>
        ))}
      </p>
      <p className="text-right text-meta text-fg-subtle">{t("reports.currencyNote")}</p>
    </div>
  );
}
