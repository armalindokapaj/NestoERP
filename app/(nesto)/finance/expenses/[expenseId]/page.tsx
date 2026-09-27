import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { ApprovalHistory } from "@/components/finance/approval-history";
import { ExpenseActions } from "@/components/finance/expense-actions";
import { Money } from "@/components/finance/money";
import { PaymentTable } from "@/components/finance/payment-table";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { expenseCategoryLabels } from "@/lib/modules/finance/expenses/expense.status";
import { pendingCycle } from "@/lib/modules/finance/approvals/approval.service";
import { formatDate, orDash } from "@/lib/utils/format";
import { expenseBreadcrumbs, expenseLabel, loadExpense } from "./expense-context";
import { FinanceRecordTabs } from "../../invoices/[invoiceId]/record-tabs";

type Params = { params: Promise<{ expenseId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { expenseId } = await params;
  try {
    const { expense } = await loadExpense(expenseId);
    return { title: expenseLabel(expense) };
  } catch {
    return { title: "Expense" };
  }
}

/**
 * Expense detail (PRD #15 §178).
 *
 * An approved expense is *actual cost*: it is what every budget-vs-actual
 * figure on its project is calculated from, which is why it stays visible and
 * cannot be archived (PRD #15 §102, §118).
 */
export default async function ExpenseDetailPage({ params }: Params) {
  const { expenseId } = await params;
  const { context, expense } = await loadExpense(expenseId);

  const may = expense.capabilities;
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle = may.canApprove || may.canReject ? await pendingCycle(context, "EXPENSE", expense.id) : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={expenseBreadcrumbs(expense)}
        title={expense.description}
        subtitle={expense.expenseNumber ?? undefined}
        status={expense.status}
        badges={<Badge tone="neutral">{expenseCategoryLabels[expense.category]}</Badge>}
        meta={[
          {
            label: "Total",
            value: <Money amount={expense.totalAmount} currency={expense.currency} emphasis />,
          },
          {
            label: "Outstanding",
            value: <Money amount={expense.outstandingAmount} currency={expense.currency} />,
          },
          { label: "Incurred", value: formatDate(expense.expenseDate) },
        ]}
        actions={
          <ExpenseActions
            expenseId={expense.id}
            label={expenseLabel(expense)}
            capabilities={may}
            cycle={cycle}
          />
        }
      />

      <FinanceRecordTabs
        basePath={`/finance/expenses/${expense.id}`}
        active="overview"
        show={{ documents: may.canViewDocuments, activity: may.canViewActivity }}
      />

      {expense.status === "APPROVED" ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          Approved, so this counts as actual cost against its project whether or not it has been
          paid.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">Details</h2>
          <DetailGrid
            className="mt-4"
            items={[
              { label: "Category", value: expenseCategoryLabels[expense.category] },
              {
                label: "Project",
                value: expense.project ? (
                  <Link href={`/projects/${expense.project.id}`} className="hover:text-accent">
                    {expense.project.name}
                  </Link>
                ) : (
                  "Company-wide"
                ),
              },
              { label: "Payee", value: orDash(expense.payeeName) },
              { label: "Reference", value: orDash(expense.expenseNumber) },
              { label: "Currency", value: expense.currency },
              { label: "Raised by", value: expense.createdBy ? <PersonLink memberId={expense.createdBy.memberId} name={expense.createdBy.fullName} /> : "—" },
            ]}
          />

          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-table">
            <Row label="Net">
              <Money amount={expense.netAmount} currency={expense.currency} />
            </Row>
            <Row label="Tax">
              <Money amount={expense.taxAmount} currency={expense.currency} />
            </Row>
            <Row label="Total">
              <Money amount={expense.totalAmount} currency={expense.currency} emphasis />
            </Row>
            <Row label="Paid">
              <Money amount={expense.paidAmount} currency={expense.currency} />
            </Row>
            <Row label="Outstanding">
              <Money amount={expense.outstandingAmount} currency={expense.currency} emphasis />
            </Row>
          </dl>

          {expense.notes ? (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="text-table font-medium text-fg">Notes</h3>
              <p className="mt-1 whitespace-pre-wrap text-table text-fg-muted">{expense.notes}</p>
            </div>
          ) : null}
        </section>

        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">Approvals</h2>
          <ApprovalHistory approvals={expense.approvals} />
        </section>
      </div>

      <section className="nesto-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-card font-semibold text-fg">Payments</h2>
          {may.canRecordPayment ? (
            <Button asChild size="sm">
              <Link href={`/finance/payments/new?expenseId=${expense.id}`}>Record payment</Link>
            </Button>
          ) : null}
        </div>

        {expense.payments.length === 0 ? (
          <p className="mt-4 text-table text-fg-subtle">
            {expense.status === "APPROVED"
              ? "Nothing paid out against this expense yet."
              : "Payments can be recorded once the expense has been approved."}
          </p>
        ) : (
          <div className="mt-4">
            <PaymentTable payments={expense.payments} listId="finance.expense-payments" />
          </div>
        )}
      </section>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="expense" parentId={expenseId} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
