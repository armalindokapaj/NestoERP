import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { ApprovalHistory } from "@/components/finance/approval-history";
import { Money } from "@/components/finance/money";
import { PaymentTable } from "@/components/finance/payment-table";
import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Button } from "@/components/ui/button";
import { getTranslations } from "@/lib/i18n/server";
import { orDash } from "@/lib/utils/format";
import { expenseLabel, loadExpense } from "../expense-context";

type Params = { params: Promise<{ expenseId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { expenseId } = await params;
  try {
    const { expense } = await loadExpense(expenseId);
    return { title: expenseLabel(expense) };
  } catch {
    return { title: (await getTranslations("finance"))("kind.expense") };
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
  const t = await getTranslations("finance");

  return (
    <div className="space-y-5">
      {expense.status === "APPROVED" ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("expenses.approvedNote")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">{t("detail.details")}</h2>
          <DetailGrid
            className="mt-4"
            items={[
              { label: t("form.category"), value: t(`category.${expense.category}`) },
              {
                label: t("form.project"),
                value: expense.project ? (
                  <Link href={`/projects/${expense.project.id}`} className="hover:text-accent">
                    {expense.project.name}
                  </Link>
                ) : (
                  t("companyWide")
                ),
              },
              { label: t("expenseForm.payee"), value: orDash(expense.payeeName) },
              { label: t("form.reference"), value: orDash(expense.expenseNumber) },
              { label: t("form.currency"), value: expense.currency },
              { label: t("invoices.raisedBy"), value: expense.createdBy ? <PersonLink memberId={expense.createdBy.memberId} name={expense.createdBy.fullName} /> : "—" },
            ]}
          />

          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-table">
            <Row label={t("overview.net")}>
              <Money amount={expense.netAmount} currency={expense.currency} />
            </Row>
            <Row label={t("lines.tax")}>
              <Money amount={expense.taxAmount} currency={expense.currency} />
            </Row>
            <Row label={t("columns.total")}>
              <Money amount={expense.totalAmount} currency={expense.currency} emphasis />
            </Row>
            <Row label={t("columns.paid")}>
              <Money amount={expense.paidAmount} currency={expense.currency} />
            </Row>
            <Row label={t("columns.outstanding")}>
              <Money amount={expense.outstandingAmount} currency={expense.currency} emphasis />
            </Row>
          </dl>

          {expense.notes ? (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="text-table font-medium text-fg">{t("form.notes")}</h3>
              <p className="mt-1 whitespace-pre-wrap break-words text-table text-fg-muted">{expense.notes}</p>
            </div>
          ) : null}

          {/* Where the receipt goes (AUD-04 §7, MW-13, J-E4): the existing route is the
              Documents tab after the expense is saved; this says so on the record
              itself, where a phone user lands after saving, instead of leaving it
              to a tab they may not notice. No new upload path. */}
          {may.canViewDocuments ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4" data-testid="expense-receipt-hint">
              <div className="min-w-0">
                <h3 className="text-table font-medium text-fg">{t("expenses.receipt")}</h3>
                <p className="mt-0.5 text-table text-fg-muted">
                  {t("expenses.receiptHint")}
                </p>
              </div>
              <Button asChild variant="secondary" size="sm">
                <Link href={`/finance/expenses/${expense.id}/documents`}>
                  {expense.status === "ARCHIVED" ? t("expenses.viewDocuments") : t("expenses.attachReceipt")}
                </Link>
              </Button>
            </div>
          ) : null}
        </section>

        <section className="nesto-card p-5">
          <h2 className="text-card font-semibold text-fg">{t("detail.approvals")}</h2>
          <ApprovalHistory approvals={expense.approvals} />
        </section>
      </div>

      <section className="nesto-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-card font-semibold text-fg">{t("captions.payments")}</h2>
          {may.canRecordPayment ? (
            <Button asChild size="sm">
              <Link href={`/finance/payments/new?expenseId=${expense.id}`}>{t("panel.recordPayment")}</Link>
            </Button>
          ) : null}
        </div>

        {expense.payments.length === 0 ? (
          <p className="mt-4 text-table text-fg-subtle">
            {expense.status === "APPROVED"
              ? t("expenses.nothingPaid")
              : t("expenses.paymentsAfterApproved")}
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
