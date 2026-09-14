import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wallet } from "lucide-react";

import { BudgetRiskBadge } from "@/components/finance/budget-risk-badge";
import { CommitmentTable } from "@/components/finance/commitment-table";
import { ExpenseTable } from "@/components/finance/expense-table";
import { InvoiceTable } from "@/components/finance/invoice-table";
import { Money, Variance } from "@/components/finance/money";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import * as projects from "@/lib/modules/projects/project.service";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";
import * as commitments from "@/lib/modules/finance/commitments/commitment.service";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";
import { parseBudgetQuery, parseCommitmentQuery, parseExpenseQuery, parseInvoiceQuery } from "@/lib/modules/finance/finance.query";
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Project finance" };

/**
 * Project finance (PRD #15 §181–§184).
 *
 * The same canonical finance records, filtered to this project — not a second
 * finance database. Each panel is gated by its own permission, so a Project
 * Manager sees budget, cost and commitments while an Architect sees the budget
 * summary alone and nobody sees a tab that would refuse them (PRD #15 §182).
 */
export default async function ProjectFinancePage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const actions = projects.projectActions(context);

  if (!actions.canViewFinance) redirect("/access-denied");

  const showSummary = can(context, "finance.project_budget.view");
  const showInvoices = can(context, "finance.invoice.view");
  const showExpenses = can(context, "finance.expense.view");
  const showCommitments = can(context, "finance.commitment.view");
  const showBudgets = can(context, "finance.budget.view");

  const [summary, budgetList, invoiceList, expenseList, commitmentList] = await Promise.all([
    showSummary ? budgets.getProjectFinanceSummary(context, projectId) : null,
    showBudgets
      ? budgets.listBudgets(context, parseBudgetQuery({ projectId, limit: "10" }))
      : null,
    showInvoices
      ? invoices.listInvoices(context, parseInvoiceQuery({ projectId, limit: "10" }))
      : null,
    showExpenses
      ? expenses.listExpenses(context, parseExpenseQuery({ projectId, limit: "10" }))
      : null,
    showCommitments
      ? commitments.listCommitments(
          context,
          parseCommitmentQuery({ projectId, open: "1", limit: "10" }),
        )
      : null,
  ]);

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={projectBreadcrumbs(project, "Finance")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          can(context, "finance.budget.create") && summary && !summary.hasApprovedBudget ? (
            <Button asChild size="sm">
              <Link href={`/finance/budgets/new?projectId=${project.id}`}>Create budget</Link>
            </Button>
          ) : null
        }
      />

      <ProjectTabs
        projectId={project.id}
        active="finance"
        show={{
          tasks: actions.canViewTasks,
          calendar: actions.canViewCalendar,
          meetings: actions.canViewMeetings,
          team: actions.canViewMembers,
          finance: true,
          contracts: actions.canViewContracts,
          inventory: actions.canViewInventory,
          qaqc: actions.canViewQaqc,
          hse: actions.canViewHse,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />

      {summary ? (
        summary.hasApprovedBudget ? (
          <section className="nesto-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-card font-semibold text-fg">Budget vs actual</h2>
              <BudgetRiskBadge
                risk={summary.risk}
                utilizationPercent={summary.utilizationPercent}
              />
            </div>

            <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <Figure label="Budget">
                <Money amount={summary.budgetAmount} currency={summary.currency} emphasis />
              </Figure>
              <Figure label="Actual cost">
                <Money amount={summary.actualCost} currency={summary.currency} />
              </Figure>
              <Figure label="Open commitments">
                <Money amount={summary.openCommitments} currency={summary.currency} />
              </Figure>
              <Figure label="Forecast">
                <Money amount={summary.forecastCost} currency={summary.currency} emphasis />
              </Figure>
              <Figure label="Variance">
                <Variance amount={summary.variance} currency={summary.currency} />
              </Figure>
            </dl>

            <p className="mt-4 border-t border-line pt-3 text-meta text-fg-subtle">
              Actual cost is approved expenses; forecast adds open commitments. Payments are cash
              events and do not change what has been spent.
            </p>
          </section>
        ) : (
          <EmptyState
            icon={<Wallet />}
            title="No approved budget."
            description="Every variance figure on a project is measured against its approved budget."
            action={
              can(context, "finance.budget.create")
                ? { label: "Create budget", href: `/finance/budgets/new?projectId=${project.id}` }
                : undefined
            }
          />
        )
      ) : null}

      {budgetList && budgetList.data.length > 0 ? (
        <Panel
          title="Budget versions"
          href={`/finance/budgets?projectId=${project.id}`}
          linkLabel="All budgets"
        >
          <ul className="divide-y divide-line">
            {budgetList.data.map((budget) => (
              <li key={budget.id} className="flex items-center justify-between gap-3 py-2.5">
                <Link
                  href={`/finance/budgets/${budget.id}`}
                  className="min-w-0 truncate text-table text-fg hover:text-accent"
                >
                  v{budget.version}
                  {budget.name ? ` · ${budget.name}` : ""}
                  {budget.isCurrent ? " · current" : ""}
                </Link>
                <Money amount={budget.budgetAmount} currency={budget.currency} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {commitmentList && commitmentList.data.length > 0 ? (
        <Panel
          title="Open commitments"
          href={`/finance/commitments?projectId=${project.id}&open=1`}
          linkLabel="All commitments"
        >
          <CommitmentTable commitments={commitmentList.data} />
        </Panel>
      ) : null}

      {expenseList && expenseList.data.length > 0 ? (
        <Panel
          title="Expenses"
          href={`/finance/expenses?projectId=${project.id}`}
          linkLabel="All expenses"
        >
          <ExpenseTable expenses={expenseList.data} />
        </Panel>
      ) : null}

      {invoiceList && invoiceList.data.length > 0 ? (
        <Panel
          title="Invoices"
          href={`/finance/invoices?projectId=${project.id}`}
          linkLabel="All invoices"
        >
          <InvoiceTable invoices={invoiceList.data} />
        </Panel>
      ) : null}
    </div>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-meta text-fg-subtle">{label}</dt>
      <dd className="mt-1 text-card">{children}</dd>
    </div>
  );
}

function Panel({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-card font-semibold text-fg">{title}</h2>
        <Link href={href} className="text-table font-medium text-accent-strong hover:underline">
          {linkLabel}
        </Link>
      </div>
      {children}
    </section>
  );
}
