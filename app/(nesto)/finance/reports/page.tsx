import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { ChartColumn } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { BudgetRiskBadge } from "@/components/finance/budget-risk-badge";
import { NoAccessibleData } from "@/components/finance/group-rows";
import { Money, Variance } from "@/components/finance/money";
import { ModulePage } from "@/components/modules/module-page";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import { getTranslations } from "@/lib/i18n/server";
import { financeContexts, financeExperience } from "@/lib/modules/finance/finance.workspace";
import * as reports from "@/lib/modules/finance/reports/reports.service";
import { cn } from "@/lib/utils/cn";
import {
  GroupAgingReport,
  GroupBudgetReport,
  GroupCashflowReport,
  GroupCategoryReport,
  GroupCommitmentReport,
} from "./group-reports";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.reports") };
}

/**
 * The built-in reports (PRD #15 §147, §148).
 *
 * Six named reports, not a report builder. Each one is offered only when the
 * reader holds the permission behind it, so the tab strip is the list of
 * reports they can actually open (PRD #15 §158).
 *
 * In the Group workspace a report is offered when at least one company lets the
 * reader open it, and it is that company's own report for every company that
 * does — rows naming their company, totals added within a currency only
 * (Workspace Context §41, §72). See `group-reports.tsx`.
 */
const REPORTS = [
  { key: "receivables-aging", label: "reports.tab.aging", permission: "finance.receivables.view" },
  { key: "budget-vs-actual", label: "reports.tab.budget", permission: "finance.project_budget.view" },
  { key: "expenses-by-category", label: "reports.tab.category", permission: "finance.expense.view" },
  { key: "cashflow", label: "reports.tab.cashflow", permission: "finance.cashflow.view" },
  { key: "commitment-summary", label: "reports.tab.commitments", permission: "finance.commitment.view" },
] as const;

type ReportKey = (typeof REPORTS)[number]["key"];

export default async function FinanceReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; period?: string }>;
}) {
  const context = await requireModule("finance");
  const group = inGroupWorkspace(context);

  if (!group && !can(context, "finance.report.view")) redirect("/access-denied");

  const t = await getTranslations("finance");
  const experience = await financeExperience(context);
  const { report: requested, period } = await searchParams;

  // The contexts the reports are read in: the company's own, or each company
  // of the group that lets the reader open reports.
  const readers = group ? await financeContexts(context, "finance.report.view") : [context];
  const available = REPORTS.filter((entry) =>
    readers.some((reader) => can(reader, entry.permission as Parameters<typeof can>[1])),
  );

  if (group && readers.length === 0) {
    return (
      <ModulePage experience={experience} activeSection="reports">
        <NoAccessibleData />
      </ModulePage>
    );
  }

  if (available.length === 0) {
    return (
      <ModulePage experience={experience} activeSection="reports">
        <EmptyState
          icon={<ChartColumn />}
          title={t("reports.none")}
          description={t("reports.noneBody")}
        />
      </ModulePage>
    );
  }

  const active = (available.find((entry) => entry.key === requested)?.key ??
    available[0].key) as ReportKey;

  return (
    <ModulePage experience={experience} activeSection="reports">
      <div className="space-y-5">
        <nav aria-label={t("reports.nav")} className="border-b border-line">
          <ul className="-mb-px flex gap-1 overflow-x-auto">
            {available.map((entry) => (
              <li key={entry.key}>
                <Link
                  href={`/finance/reports?report=${entry.key}`}
                  aria-current={entry.key === active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors touch:h-11",
                    entry.key === active
                      ? "border-accent text-fg"
                      : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  {t(entry.label)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {group ? (
          <>
            {active === "receivables-aging" ? <GroupAgingReport context={context} /> : null}
            {active === "budget-vs-actual" ? <GroupBudgetReport context={context} /> : null}
            {active === "expenses-by-category" ? <GroupCategoryReport context={context} /> : null}
            {active === "cashflow" ? <GroupCashflowReport context={context} period={period} /> : null}
            {active === "commitment-summary" ? <GroupCommitmentReport context={context} /> : null}
          </>
        ) : (
          <>
            {active === "receivables-aging" ? <AgingReport context={context} /> : null}
            {active === "budget-vs-actual" ? <BudgetReport context={context} /> : null}
            {active === "expenses-by-category" ? <CategoryReport context={context} /> : null}
            {active === "cashflow" ? <CashflowReport context={context} period={period} /> : null}
            {active === "commitment-summary" ? <CommitmentReport context={context} /> : null}
          </>
        )}
      </div>
    </ModulePage>
  );
}

/* Receivables aging (PRD #15 §149, §150) ----------------------------------- */

async function AgingReport({ context }: { context: UserContext }) {
  const t = await getTranslations("finance");
  const rows = await reports.receivablesAging(context);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title={t("reports.agingNone")}
        description={t("reports.agingNoneBody")}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Grouped by currency and never combined: V0.1 has no FX engine, and a
          total across currencies would be arithmetic that means nothing. */}
      <p className="text-meta text-fg-subtle">
        {t("reports.agingHint")}
      </p>
      <ScrollRegion label={t("reports.tab.aging")} className="nesto-card">
        <table className="w-full text-table">
          <caption className="sr-only">{t("reports.tab.aging")}</caption>
          <thead className="border-b border-line text-meta uppercase tracking-wide text-fg-subtle">
            <tr>
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
      </ScrollRegion>
    </div>
  );
}

/* Budget vs actual (PRD #15 §151) ------------------------------------------ */

async function BudgetReport({ context }: { context: UserContext }) {
  const t = await getTranslations("finance");
  const rows = await reports.budgetVsActual(context);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title={t("reports.budgetNone")}
        description={t("reports.budgetNoneBody")}
      />
    );
  }

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "project",
      label: t("form.project"),
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
      label: t("columns.budget"),
      align: "right",
      render: (row) => <Money amount={row.budget} currency={row.currency} emphasis />,
    },
    {
      key: "actual",
      label: t("columns.actual"),
      align: "right",
      render: (row) => (
        <Money amount={row.actual} currency={row.currency} className="text-fg-muted" />
      ),
    },
    {
      key: "committed",
      label: t("columns.committed"),
      align: "right",
      hideBelow: "lg",
      render: (row) => (
        <Money amount={row.openCommitments} currency={row.currency} className="text-fg-muted" />
      ),
    },
    {
      key: "forecast",
      label: t("columns.forecast"),
      align: "right",
      hideBelow: "md",
      render: (row) => (
        <Money amount={row.forecast} currency={row.currency} className="text-fg-muted" />
      ),
    },
    {
      key: "variance",
      label: t("columns.variance"),
      align: "right",
      render: (row) => <Variance amount={row.variance} currency={row.currency} />,
    },
    {
      key: "risk",
      label: t("budgets.utilisation"),
      render: (row) => (
        <BudgetRiskBadge risk={row.risk} utilizationPercent={row.utilizationPercent} />
      ),
    },
  ];

  return (
    <DataTable
      caption={t("reports.tab.budget")}
      columns={columns}
      records={rows}
      rowKey={(row) => row.projectId}
      rowHref={(row) => `/projects/${row.projectId}/finance`}
    />
  );
}

/* Expenses by category (PRD #15 §153) -------------------------------------- */

async function CategoryReport({ context }: { context: UserContext }) {
  const t = await getTranslations("finance");
  const rows = await reports.expensesByCategory(context);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title={t("reports.categoryNone")}
        description={t("reports.categoryNoneBody")}
      />
    );
  }

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "category",
      label: t("form.category"),
      primary: true,
      render: (row) => t(`category.${row.category as "OTHER"}`),
    },
    { key: "currency", label: t("form.currency"), render: (row) => row.currency },
    {
      key: "actual",
      label: t("reports.actualCost"),
      align: "right",
      render: (row) => <Money amount={row.actual} currency={row.currency} emphasis />,
    },
    {
      key: "committed",
      label: t("overview.openCommitments"),
      align: "right",
      render: (row) => (
        <Money amount={row.committed} currency={row.currency} className="text-fg-muted" />
      ),
    },
  ];

  return (
    <DataTable
      caption={t("reports.tab.category")}
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
  const t = await getTranslations("finance");
  const known = (reports.CASHFLOW_PERIODS as readonly string[]).includes(period ?? "");
  const selected = known ? (period as reports.CashflowPeriod) : "this-month";
  const report = await reports.cashflowSummary(context, selected);

  return (
    <div className="space-y-3">
      <nav aria-label={t("reports.period")} className="flex flex-wrap gap-2">
        {reports.CASHFLOW_PERIODS.map((entry) => (
          <Link
            key={entry}
            href={`/finance/reports?report=cashflow&period=${entry}`}
            aria-current={entry === selected ? "page" : undefined}
            className={cn(
              "inline-flex items-center rounded-md border px-3 py-1.5 text-table font-medium transition-colors touch:min-h-11",
              entry === selected
                ? "border-accent bg-accent-soft text-accent-strong"
                : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {t(`cashflowPeriod.${entry}`)}
          </Link>
        ))}
      </nav>

      <p className="text-meta text-fg-subtle">
        {t("reports.cashflowHint", { from: report.from, to: report.to })}
      </p>

      {report.rows.length === 0 ? (
        <EmptyState
          icon={<ChartColumn />}
          title={t("reports.cashflowNone")}
          description={t("reports.cashflowNoneBody")}
        />
      ) : (
        <ScrollRegion label={t("reports.cashflowSummary")} className="nesto-card">
          <table className="w-full text-table">
            <caption className="sr-only">{t("reports.cashflowSummary")}</caption>
            <thead className="border-b border-line text-meta uppercase tracking-wide text-fg-subtle">
              <tr>
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
        </ScrollRegion>
      )}
    </div>
  );
}

/* Commitment summary (PRD #15 §156) ---------------------------------------- */

async function CommitmentReport({ context }: { context: UserContext }) {
  const t = await getTranslations("finance");
  const { rows, totals } = await reports.commitmentSummary(context);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartColumn />}
        title={t("reports.commitmentNone")}
        description={t("reports.commitmentNoneBody")}
      />
    );
  }

  const columns: TableColumn<(typeof rows)[number]>[] = [
    {
      key: "project",
      label: t("form.project"),
      primary: true,
      render: (row) => row.projectName,
    },
    {
      key: "category",
      label: t("form.category"),
      render: (row) => t(`category.${row.category as "OTHER"}`),
    },
    { key: "currency", label: t("form.currency"), hideBelow: "md", render: (row) => row.currency },
    {
      key: "amount",
      label: t("reports.openCommitment"),
      align: "right",
      render: (row) => <Money amount={row.amount} currency={row.currency} emphasis />,
    },
  ];

  return (
    <div className="space-y-3">
      <DataTable
        caption={t("reports.commitmentSummary")}
        columns={columns}
        records={rows}
        rowKey={(row) => `${row.projectId ?? "company"}-${row.category}-${row.currency}`}
      />
      <p className="text-right text-table text-fg-muted">
        {t("reports.totalOpen")}{" "}
        {totals.map((total) => (
          <span key={total.currency} className="ml-2 font-semibold text-fg">
            <Money amount={total.amount} currency={total.currency} />
          </span>
        ))}
      </p>
    </div>
  );
}
