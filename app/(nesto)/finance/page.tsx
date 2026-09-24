import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { Suspense } from "react";
import { ArrowRight, Wallet } from "lucide-react";

import { CurrencyTotals } from "@/components/finance/money";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionBoundary } from "@/components/modules/page-section";
import { ListSectionSkeleton, StatCardsSkeleton } from "@/components/modules/section-skeletons";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { loadFinanceOverviewDomains, netOf, planFinanceOverview } from "@/lib/modules/finance/overview/overview.service";
import { budgetVsActual } from "@/lib/modules/finance/reports/reports.service";
import { BudgetRiskBadge } from "@/components/finance/budget-risk-badge";
import { GroupFinanceOverview } from "./group-overview";

export const metadata: Metadata = { title: "Finance" };

/**
 * The Finance overview (PRD #15 §21–§27; NAV-03 STREAM-02, STREAM-05).
 *
 * The module's own dashboard, not the personal one at /dashboard. Every panel
 * is gated by its own permission, so what a Sales user sees is receivables
 * alone rather than a company cash position with holes in it — and an Architect
 * with only the project-budget grant sees the budget panel and nothing else
 * (PRD #15 §24, §25).
 *
 * The plan — which domains this reader may see, from permissions alone —
 * draws the page at once. Each domain is read beside the others on one
 * reporting time and arrives in its own section; the budget report starts as
 * soon as its eligibility is known, not after the rest. The primary section is
 * the first permitted of receivables, payables, cashflow, commitments,
 * budgets and counts.
 *
 * The Group workspace has its own overview, the companies' answers side by side
 * (Workspace Context §36, §72): see `group-overview.tsx`.
 */
export default async function FinanceOverviewPage() {
  const context = await requireModule("finance");
  if (inGroupWorkspace(context)) return <GroupFinanceOverview context={context} />;

  const experience = resolveModuleExperience(context, "finance");
  const plan = planFinanceOverview(context);
  const { visible } = plan;
  const domains = loadFinanceOverviewDomains(context, plan);
  const budgetsShown = visible.projectBudgets && can(context, "finance.report.view");
  const budgets = budgetsShown ? budgetVsActual(context) : null;
  for (const promise of [...Object.values(domains), budgets]) promise?.catch(() => undefined);

  const order = [
    visible.receivables && "receivables",
    visible.payables && "payables",
    visible.cashflow && "cashflow",
    visible.commitments && "commitments",
    budgetsShown && "budgets",
    "counts",
  ].filter(Boolean);
  const primary = order[0];
  const nothingVisible = !visible.receivables && !visible.payables && !visible.commitments && !visible.cashflow && !budgetsShown;
  const base = domains.baseCurrency;

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
        {visible.receivables || visible.payables || visible.commitments ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {visible.receivables ? (
              <SectionBoundary className="nesto-card sm:col-span-2">
                <Suspense fallback={<StatCardsSkeleton count={2} />}>
                  <ReceivableCards receivables={domains.receivables} base={base} primary={primary === "receivables"} />
                </Suspense>
              </SectionBoundary>
            ) : null}
            {visible.payables ? (
              <SectionBoundary className="nesto-card">
                <Suspense fallback={<CardSkeleton />}>
                  <TotalsCard label="Payables" href="/finance/expenses?status=APPROVED&settlement=UNPAID,PARTIALLY_PAID" totals={domains.payables} base={base} primary={primary === "payables"} />
                </Suspense>
              </SectionBoundary>
            ) : null}
            {visible.commitments ? (
              <SectionBoundary className="nesto-card">
                <Suspense fallback={<CardSkeleton />}>
                  <TotalsCard label="Open commitments" href="/finance/commitments?open=1" totals={domains.commitments} base={base} primary={primary === "commitments"} />
                </Suspense>
              </SectionBoundary>
            ) : null}
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
          {visible.cashflow ? (
            <SectionBoundary className="nesto-card">
              <Suspense fallback={<ListSectionSkeleton title="Cash this month" rows={3} />}>
                <Cashflow cash={domains.cash} base={base} primary={primary === "cashflow"} />
              </Suspense>
            </SectionBoundary>
          ) : null}
          {budgets ? (
            <SectionBoundary className="nesto-card">
              <Suspense fallback={<ListSectionSkeleton title="Project budgets" rows={6} />}>
                <ProjectBudgets budgets={budgets} primary={primary === "budgets"} />
              </Suspense>
            </SectionBoundary>
          ) : null}
        </div>

        <SectionBoundary className="nesto-card">
          <Suspense fallback={<ListSectionSkeleton title="What needs attention" rows={4} />}>
            <AttentionCounts
              counts={domains.counts}
              invoices={can(context, "finance.invoice.view")}
              approvals={visible.approvals}
              expenses={can(context, "finance.expense.view")}
              primary={primary === "counts"}
            />
          </Suspense>
        </SectionBoundary>
      </div>
    </ModulePage>
  );
}

type Domains = ReturnType<typeof loadFinanceOverviewDomains>;

async function ReceivableCards({ receivables, base, primary }: { receivables: Domains["receivables"]; base: Domains["baseCurrency"]; primary: boolean }) {
  const [value, currency] = await Promise.all([receivables, base]);
  const cards = [
    { label: "Outstanding receivables", totals: value.outstanding, href: "/finance/invoices?settlement=UNPAID,PARTIALLY_PAID,OVERDUE" },
    { label: "Overdue", totals: value.overdue, href: "/finance/invoices?settlement=OVERDUE" },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-section={primary ? "primary" : undefined}>
      {cards.map((card) => (
        <Link key={card.label} href={card.href} className="nesto-card p-4 transition-colors hover:border-line-strong">
          <p className="text-table text-fg-muted">{card.label}</p>
          <CurrencyTotals totals={card.totals} baseCurrency={currency} className="mt-2 text-page font-semibold text-fg" />
        </Link>
      ))}
    </div>
  );
}

async function TotalsCard({ label, href, totals, base, primary }: { label: string; href: string; totals: Promise<{ currency: string; amount: string }[]>; base: Domains["baseCurrency"]; primary: boolean }) {
  const [value, currency] = await Promise.all([totals, base]);
  return (
    <Link href={href} className="nesto-card block p-4 transition-colors hover:border-line-strong" data-section={primary ? "primary" : undefined}>
      <p className="text-table text-fg-muted">{label}</p>
      <CurrencyTotals totals={value} baseCurrency={currency} className="mt-2 text-page font-semibold text-fg" />
    </Link>
  );
}

async function Cashflow({ cash, base, primary }: { cash: Domains["cash"]; base: Domains["baseCurrency"]; primary: boolean }) {
  const [value, currency] = await Promise.all([cash, base]);
  return (
    <section className="nesto-card p-5" data-section={primary ? "primary" : undefined}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card font-semibold text-fg">Cash this month</h2>
        <Link href="/finance/reports?report=cashflow" className="inline-flex items-center gap-1 text-table font-medium text-accent-strong">
          Cashflow
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      <dl className="mt-4 divide-y divide-line">
        <Row label="Received" totals={value.in} base={currency} />
        <Row label="Paid out" totals={value.out} base={currency} />
        <Row label="Net" totals={netOf(value.in, value.out)} base={currency} emphasis />
      </dl>
    </section>
  );
}

async function ProjectBudgets({ budgets, primary }: { budgets: ReturnType<typeof budgetVsActual>; primary: boolean }) {
  const rows = await budgets;
  return (
    <section className="nesto-card p-5" data-section={primary ? "primary" : undefined}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card font-semibold text-fg">Project budgets</h2>
        <Link href="/finance/reports?report=budget-vs-actual" className="inline-flex items-center gap-1 text-table font-medium text-accent-strong">
          Budget vs actual
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">No project budgets in your view.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.slice(0, 6).map((row) => (
            <li key={row.projectId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
              <Link href={`/projects/${row.projectId}/finance`} className="min-w-0 truncate text-table text-fg transition-colors hover:text-accent">
                {row.name}
              </Link>
              <BudgetRiskBadge risk={row.risk} utilizationPercent={row.utilizationPercent} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function AttentionCounts({ counts, invoices, approvals, expenses, primary }: { counts: Domains["counts"]; invoices: boolean; approvals: boolean; expenses: boolean; primary: boolean }) {
  const value = await counts;
  return (
    <section className="nesto-card p-5" data-section={primary ? "primary" : undefined}>
      <h2 className="text-card font-semibold text-fg">What needs attention</h2>
      <dl className="mt-4 divide-y divide-line">
        {invoices ? <Count label="Draft invoices" value={value.draftInvoices} href="/finance/invoices?status=DRAFT" /> : null}
        {approvals ? <Count label="Waiting for a decision" value={value.pendingApprovals} href="/finance/approvals" /> : null}
        {invoices ? <Count label="Overdue invoices" value={value.overdueInvoices} href="/finance/invoices?settlement=OVERDUE" /> : null}
        {expenses ? <Count label="Approved expenses" value={value.unpaidExpenses} href="/finance/expenses?status=APPROVED" /> : null}
      </dl>
    </section>
  );
}

function CardSkeleton() {
  return (
    <div aria-hidden="true" className="nesto-card space-y-3 p-4" data-testid="section-skeleton">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-7 w-20" />
    </div>
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
