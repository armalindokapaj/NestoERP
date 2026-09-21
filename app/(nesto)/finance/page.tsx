import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Wallet } from "lucide-react";

import { CurrencyTotals } from "@/components/finance/money";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getFinanceOverview } from "@/lib/modules/finance/overview/overview.service";
import { budgetVsActual } from "@/lib/modules/finance/reports/reports.service";
import { BudgetRiskBadge } from "@/components/finance/budget-risk-badge";
import { GroupFinanceOverview } from "./group-overview";

export const metadata: Metadata = { title: "Finance" };

/**
 * The Finance overview (PRD #15 §21–§27).
 *
 * The module's own dashboard, not the personal one at /dashboard. Every panel
 * is gated by its own permission, so what a Sales user sees is receivables
 * alone rather than a company cash position with holes in it — and an Architect
 * with only the project-budget grant sees the budget panel and nothing else
 * (PRD #15 §24, §25).
 *
 * The Group workspace has its own overview, the companies' answers side by side
 * (Workspace Context §36, §72): see `group-overview.tsx`.
 */
export default async function FinanceOverviewPage() {
  const context = await requireModule("finance");
  if (inGroupWorkspace(context)) return <GroupFinanceOverview context={context} />;

  const experience = resolveModuleExperience(context, "finance");

  const overview = await getFinanceOverview(context);

  const budgets =
    overview.visible.projectBudgets && can(context, "finance.report.view")
      ? await budgetVsActual(context)
      : [];

  const cards = [
    ...(overview.visible.receivables
      ? [
          {
            label: "Outstanding receivables",
            totals: overview.receivables,
            href: "/finance/invoices?settlement=UNPAID,PARTIALLY_PAID,OVERDUE",
          },
          {
            label: "Overdue",
            totals: overview.overdueReceivables,
            href: "/finance/invoices?settlement=OVERDUE",
          },
        ]
      : []),
    ...(overview.visible.payables
      ? [
          {
            label: "Payables",
            totals: overview.payables,
            href: "/finance/expenses?status=APPROVED&settlement=UNPAID,PARTIALLY_PAID",
          },
        ]
      : []),
    ...(overview.visible.commitments
      ? [
          {
            label: "Open commitments",
            totals: overview.openCommitments,
            href: "/finance/commitments?open=1",
          },
        ]
      : []),
  ];

  const nothingVisible = cards.length === 0 && budgets.length === 0;

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        can(context, "finance.invoice.create") ? (
          <Button asChild size="sm">
            <Link href="/finance/invoices/new">New invoice</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        {cards.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className="nesto-card p-4 transition-colors hover:border-line-strong"
              >
                <p className="text-table text-fg-muted">{card.label}</p>
                <CurrencyTotals
                  totals={card.totals}
                  baseCurrency={overview.baseCurrency}
                  className="mt-2 text-page font-semibold text-fg"
                />
              </Link>
            ))}
          </div>
        ) : null}

        {nothingVisible ? (
          <EmptyState
            icon={<Wallet />}
            title="No finance figures in your view."
            description="Your access covers project budgets and cost summaries rather than company finance."
          />
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {overview.visible.cashflow ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Cash this month</h2>
                <Link
                  href="/finance/reports?report=cashflow"
                  className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
                >
                  Cashflow
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
              <dl className="mt-4 divide-y divide-line">
                <Row label="Received" totals={overview.cashIn} base={overview.baseCurrency} />
                <Row label="Paid out" totals={overview.cashOut} base={overview.baseCurrency} />
                <Row
                  label="Net"
                  totals={overview.netCashflow}
                  base={overview.baseCurrency}
                  emphasis
                />
              </dl>
            </section>
          ) : null}

          {overview.visible.projectBudgets && budgets.length > 0 ? (
            <section className="nesto-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-card font-semibold text-fg">Project budgets</h2>
                <Link
                  href="/finance/reports?report=budget-vs-actual"
                  className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
                >
                  Budget vs actual
                  <ArrowRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
              <ul className="mt-4 divide-y divide-line">
                {budgets.slice(0, 6).map((row) => (
                  <li
                    key={row.projectId}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                  >
                    <Link
                      href={`/projects/${row.projectId}/finance`}
                      className="min-w-0 truncate text-table text-fg transition-colors hover:text-accent"
                    >
                      {row.name}
                    </Link>
                    <BudgetRiskBadge
                      risk={row.risk}
                      utilizationPercent={row.utilizationPercent}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">What needs attention</h2>
          <dl className="mt-4 divide-y divide-line">
            {can(context, "finance.invoice.view") ? (
              <Count
                label="Draft invoices"
                value={overview.counts.draftInvoices}
                href="/finance/invoices?status=DRAFT"
              />
            ) : null}
            {overview.visible.approvals ? (
              <Count
                label="Waiting for a decision"
                value={overview.counts.pendingApprovals}
                href="/finance/approvals"
              />
            ) : null}
            {can(context, "finance.invoice.view") ? (
              <Count
                label="Overdue invoices"
                value={overview.counts.overdueInvoices}
                href="/finance/invoices?settlement=OVERDUE"
              />
            ) : null}
            {can(context, "finance.expense.view") ? (
              <Count
                label="Approved expenses"
                value={overview.counts.unpaidExpenses}
                href="/finance/expenses?status=APPROVED"
              />
            ) : null}
          </dl>
        </section>
      </div>
    </ModulePage>
  );
}

function Row({
  label,
  totals,
  base,
  emphasis,
}: {
  label: string;
  totals: { currency: string; amount: string }[];
  base: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
      <dt className="text-table text-fg-muted">{label}</dt>
      <dd className="text-right">
        <CurrencyTotals
          totals={totals}
          baseCurrency={base}
          className={emphasis ? "text-table font-semibold text-fg" : "text-table text-fg"}
        />
      </dd>
    </div>
  );
}

function Count({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
      <dt className="min-w-0">
        <Link href={href} className="text-table text-fg transition-colors hover:text-accent">
          {label}
        </Link>
      </dt>
      <dd className="shrink-0 text-table font-semibold tabular-nums text-fg">{value}</dd>
    </div>
  );
}
