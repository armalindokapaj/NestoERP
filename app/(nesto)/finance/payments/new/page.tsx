import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Banknote } from "lucide-react";

import { PaymentForm, type PayableTarget } from "@/components/finance/payment-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { recordPaymentAction } from "@/lib/actions/finance";
import { requireModule } from "@/lib/context/current-user";
import { approvedExpensesInScope } from "@/lib/modules/finance/expenses/expense.repository";
import { toAmountString } from "@/lib/modules/finance/finance.money";
import { paidByExpense, paidByInvoice, settlementFor } from "@/lib/modules/finance/finance.settlement";
import { sentInvoicesInScope } from "@/lib/modules/finance/invoices/invoice.repository";

export const metadata: Metadata = { title: "Record payment" };

/**
 * Record a payment (PRD #15 §81, §82).
 *
 * Only records that can actually take one are offered: sent invoices with
 * something still owing, and approved expenses with something still owing. The
 * server recalculates the outstanding balance inside the transaction anyway, so
 * a stale list here cannot overpay anything (PRD #15 §79, §83).
 */
export default async function NewPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ invoiceId?: string; expenseId?: string }>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.payment.create")) redirect("/access-denied");

  const params = await searchParams;
  const direction = params.expenseId ? "DISBURSEMENT" : "RECEIPT";

  const targets =
    direction === "RECEIPT" ? await receivableTargets() : await payableTargets();

  async function action(formData: FormData) {
    "use server";
    return recordPaymentAction(formData);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <RecordContextHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Payments", href: "/finance/payments" },
          { label: direction === "RECEIPT" ? "Record receipt" : "Record payment" },
        ]}
        title={direction === "RECEIPT" ? "Record a receipt" : "Record a payment"}
        subtitle={
          direction === "RECEIPT"
            ? "Money received against a sent invoice."
            : "Money paid out against an approved expense."
        }
      />

      {targets.length === 0 ? (
        <EmptyState
          icon={<Banknote />}
          title={
            direction === "RECEIPT"
              ? "Nothing is waiting to be paid."
              : "No approved expenses are outstanding."
          }
          description={
            direction === "RECEIPT"
              ? "A payment can be recorded once an invoice has been sent and is still owing."
              : "A payment can be recorded once an expense has been approved and is still owing."
          }
          action={{ label: "Back to payments", href: "/finance/payments" }}
        />
      ) : (
        <PaymentForm
          action={action}
          direction={direction}
          targets={targets}
          defaultTargetId={params.invoiceId ?? params.expenseId}
          cancelHref={
            params.invoiceId
              ? `/finance/invoices/${params.invoiceId}`
              : params.expenseId
                ? `/finance/expenses/${params.expenseId}`
                : "/finance/payments"
          }
        />
      )}
    </div>
  );

  async function receivableTargets(): Promise<PayableTarget[]> {
    const invoices = await sentInvoicesInScope(context);
    const paid = await paidByInvoice(invoices.map((invoice) => invoice.id));

    return invoices
      .map((invoice) => {
        const settlement = settlementFor(invoice.totalAmount, paid.get(invoice.id));
        return {
          id: invoice.id,
          label: `${invoice.invoiceNumber} · ${invoice.client.name}`,
          currency: invoice.currency,
          outstanding: toAmountString(settlement.outstanding),
        };
      })
      .filter((target) => Number.parseFloat(target.outstanding) > 0);
  }

  async function payableTargets(): Promise<PayableTarget[]> {
    const expenses = await approvedExpensesInScope(context);
    const paid = await paidByExpense(expenses.map((expense) => expense.id));

    return expenses
      .map((expense) => {
        const settlement = settlementFor(expense.totalAmount, paid.get(expense.id));
        return {
          id: expense.id,
          label: `${expense.expenseNumber ?? expense.description}${
            expense.payeeName ? ` · ${expense.payeeName}` : ""
          }`,
          currency: expense.currency,
          outstanding: toAmountString(settlement.outstanding),
        };
      })
      .filter((target) => Number.parseFloat(target.outstanding) > 0);
  }
}
