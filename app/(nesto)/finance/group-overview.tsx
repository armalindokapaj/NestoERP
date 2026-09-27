import Link from "@/components/navigation/nav-link";
import { ArrowRight, Wallet } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { BudgetRiskBadge } from "@/components/finance/budget-risk-badge";
import { GroupRecordLink, NoAccessibleData } from "@/components/finance/group-rows";
import { CurrencyTotals } from "@/components/finance/money";
import { ModulePage } from "@/components/modules/module-page";
import { CompanyTag } from "@/components/workspace/company-tag";
import { EmptyState } from "@/components/ui/empty-state";
import type { UserContext } from "@/lib/context/types";
import { canReadFinance, financeExperience } from "@/lib/modules/finance/finance.workspace";
import type { CompanyRef, CurrencyTotal, FinanceOverviewDTO } from "@/lib/modules/finance/finance.types";
import { getGroupFinanceOverview } from "@/lib/modules/finance/overview/overview.service";
import { getTranslations } from "@/lib/i18n/server";
import { budgetVsActualAcross } from "@/lib/modules/finance/reports/reports.service";

/**
 * The Finance overview in the Group workspace (Workspace Context §36, §60, §72,
 * §73).
 *
 * The cards add each currency only to itself — EUR and USD stand side by side,
 * never as one number — and the table under them is the same figures company by
 * company, each the company's own overview. A company where the reader may not
 * see a figure shows a dash there and adds nothing to the card above it; a
 * company where Finance is off or not theirs is not on the page at all (§92).
 * Read-only: creating an invoice needs a company.
 */
export async function GroupFinanceOverview({ context }: { context: UserContext }) {
  // The budget report starts beside the overview, not after it (NAV-03 STREAM-05);
  // it asks only the companies where the reader holds the grant, and is shown
  // only where the overview says project budgets are the reader's to see.
  const budgetReport = budgetVsActualAcross(context).then((report) => report.rows);
  const t = await getTranslations("finance");
  const [experience, overview, canInvoices, canExpenses, budgetRows] = await Promise.all([
    financeExperience(context),
    getGroupFinanceOverview(context),
    canReadFinance(context, "finance.invoice.view"),
    canReadFinance(context, "finance.expense.view"),
    budgetReport,
  ]);
  const budgets = overview.visible.projectBudgets ? budgetRows : [];

  if (overview.companies.length === 0) {
    return (
      <ModulePage experience={experience} activeSection="overview">
        <NoAccessibleData />
      </ModulePage>
    );
  }

  const { totals, visible } = overview;
  const cards = [
    ...(visible.receivables
      ? [
          { key: "outstanding", label: t("overview.outstandingReceivables"), totals: totals.receivables, href: "/finance/invoices?settlement=UNPAID,PARTIALLY_PAID,OVERDUE" },
          { key: "overdue", label: t("overview.overdue"), totals: totals.overdueReceivables, href: "/finance/invoices?settlement=OVERDUE" },
        ]
      : []),
    ...(visible.payables
      ? [{ key: "payables", label: t("overview.payables"), totals: totals.payables, href: "/finance/expenses?status=APPROVED&settlement=UNPAID,PARTIALLY_PAID" }]
      : []),
    // The commitments list belongs to one company; the group reads them in the report.
    ...(visible.commitments ? [{ key: "commitments", label: t("overview.openCommitments"), totals: totals.openCommitments, href: "/finance/reports?report=commitment-summary" }] : []),
  ];

  const columns: TableColumn<(typeof overview.companies)[number]>[] = [
    {
      key: "company",
      label: t("group.company"),
      primary: true,
      render: ({ company }) => (
        <GroupRecordLink company={company} href="/finance">
          {company.name}
        </GroupRecordLink>
      ),
    },
    ...(visible.receivables
      ? [
          figure("receivables", t("overview.receivables"), (o) => o.receivables, (o) => o.visible.receivables),
          figure("overdue", t("overview.overdue"), (o) => o.overdueReceivables, (o) => o.visible.receivables, "lg"),
        ]
      : []),
    ...(visible.payables ? [figure("payables", t("overview.payables"), (o) => o.payables, (o) => o.visible.payables, "lg")] : []),
    ...(visible.commitments ? [figure("commitments", t("overview.openCommitments"), (o) => o.openCommitments, (o) => o.visible.commitments, "xl")] : []),
    ...(visible.cashflow
      ? [
          figure("cash-in", t("overview.receivedThisMonth"), (o) => o.cashIn, (o) => o.visible.cashflow, "xl"),
          figure("cash-out", t("overview.paidOutThisMonth"), (o) => o.cashOut, (o) => o.visible.cashflow, "xl"),
        ]
      : []),
  ];

  return (
    <ModulePage experience={experience} activeSection="overview">
      <div className="space-y-5">
        {cards.length > 0 ? (
          <div className="space-y-2">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {cards.map((card) => (
                <Link key={card.key} href={card.href} className="nesto-card p-4 transition-colors hover:border-line-strong">
                  <p className="text-table text-fg-muted">{card.label}</p>
                  <Totals totals={card.totals} className="mt-2 text-page font-semibold text-fg" />
                </Link>
              ))}
            </div>
            <p className="text-meta text-fg-subtle">
              {t("overview.across", { count: overview.companies.length })}
            </p>
          </div>
        ) : (
          <EmptyState icon={<Wallet />} title={t("overview.noFigures")} description={t("overview.noFiguresBody")} />
        )}

        {cards.length > 0 ? <DataTable caption={t("overview.byCompany")} columns={columns} records={overview.companies} rowKey={(row) => row.company.id} /> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {visible.cashflow ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">{t("overview.cashThisMonth")}</h2>
                <Link href="/finance/reports?report=cashflow" className="inline-flex items-center gap-1 text-table font-medium text-accent-strong">
                  {t("overview.cashflow")}
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
              <dl className="mt-4 divide-y divide-line">
                <Row label={t("overview.received")} totals={totals.cashIn} />
                <Row label={t("overview.paidOut")} totals={totals.cashOut} />
                <Row label={t("overview.net")} totals={totals.netCashflow} emphasis />
              </dl>
            </section>
          ) : null}

          {visible.projectBudgets && budgets.length > 0 ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">{t("overview.projectBudgets")}</h2>
                <Link href="/finance/reports?report=budget-vs-actual" className="inline-flex items-center gap-1 text-table font-medium text-accent-strong">
                  {t("overview.budgetVsActual")}
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
              <ul className="mt-4 divide-y divide-line">
                {budgets.slice(0, 6).map((row) => (
                  <li key={`${row.company.id}-${row.projectId}`} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <GroupRecordLink company={row.company} href={`/projects/${row.projectId}/finance`}>
                        <span className="truncate">{row.name}</span>
                      </GroupRecordLink>
                      <CompanyTag name={row.company.name} />
                    </span>
                    <BudgetRiskBadge risk={row.risk} utilizationPercent={row.utilizationPercent} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">{t("overview.attention")}</h2>
          <dl className="mt-4 divide-y divide-line">
            {canInvoices ? <Count label={t("overview.draftInvoices")} value={overview.counts.draftInvoices} href="/finance/invoices?status=DRAFT" /> : null}
            {/* Approvals are decided in one company's queue: counted here, opened there. */}
            {visible.approvals ? <Count label={t("overview.waiting")} value={overview.counts.pendingApprovals} /> : null}
            {canInvoices ? <Count label={t("overview.overdueInvoices")} value={overview.counts.overdueInvoices} href="/finance/invoices?settlement=OVERDUE" /> : null}
            {canExpenses ? <Count label={t("overview.approvedExpenses")} value={overview.counts.unpaidExpenses} href="/finance/expenses?status=APPROVED" /> : null}
          </dl>
        </section>
      </div>
    </ModulePage>
  );
}

type CompanyOverview = { company: CompanyRef; overview: FinanceOverviewDTO };

/** One figure of the by-company table: the company's own totals, or a dash where it is not the reader's to see there. */
function figure(
  key: string,
  label: string,
  pick: (overview: FinanceOverviewDTO) => CurrencyTotal[],
  shown: (overview: FinanceOverviewDTO) => boolean,
  hideBelow?: "md" | "lg" | "xl",
): TableColumn<CompanyOverview> {
  return {
    key,
    label,
    align: "right",
    hideBelow,
    render: ({ overview }) => (shown(overview) ? <Totals totals={pick(overview)} className="items-end" /> : <span className="text-fg-subtle">—</span>),
  };
}

/** Per-currency amounts; nothing at all is a dash, since no base currency belongs to a group. */
function Totals({ totals, className }: { totals: CurrencyTotal[]; className?: string }) {
  if (totals.length === 0) return <span className={className}>—</span>;
  return <CurrencyTotals totals={totals} baseCurrency={totals[0].currency} className={className} />;
}

function Row({ label, totals, emphasis }: { label: string; totals: CurrencyTotal[]; emphasis?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
      <dt className="text-table text-fg-muted">{label}</dt>
      <dd className="text-right">
        <Totals totals={totals} className={emphasis ? "items-end text-table font-semibold text-fg" : "items-end text-table text-fg"} />
      </dd>
    </div>
  );
}

function Count({ label, value, href }: { label: string; value: number; href?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
      <dt className="min-w-0">
        {href ? (
          <Link href={href} className="text-table text-fg transition-colors hover:text-accent">
            {label}
          </Link>
        ) : (
          <span className="text-table text-fg">{label}</span>
        )}
      </dt>
      <dd className="shrink-0 text-table font-semibold tabular-nums text-fg">{value}</dd>
    </div>
  );
}
