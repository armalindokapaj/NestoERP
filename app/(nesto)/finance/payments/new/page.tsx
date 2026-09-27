import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Banknote } from "lucide-react";

import { PaymentForm, type PayableTarget } from "@/components/finance/payment-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { recordPaymentAction } from "@/lib/actions/finance";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import { approvedExpensesInScope } from "@/lib/modules/finance/expenses/expense.repository";
import { toAmountString } from "@/lib/modules/finance/finance.money";
import { paidByExpense, paidByInvoice, settlementFor } from "@/lib/modules/finance/finance.settlement";
import { sentInvoicesInScope } from "@/lib/modules/finance/invoices/invoice.repository";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.recordPayment") };
}

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
  const t = await getTranslations("finance");

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
          { label: t("crumbs.finance"), href: "/finance" },
          { label: t("crumbs.payments"), href: "/finance/payments" },
          { label: direction === "RECEIPT" ? t("paymentForm.recordReceipt") : t("paymentForm.recordPayment") },
        ]}
        title={direction === "RECEIPT" ? t("payments.recordReceiptTitle") : t("panel.recordTitle")}
        subtitle={
          direction === "RECEIPT"
            ? t("payments.receiptSubtitle")
            : t("payments.paymentSubtitle")
        }
      />

      {targets.length === 0 ? (
        <EmptyState
          icon={<Banknote />}
          title={
            direction === "RECEIPT"
              ? t("payments.nothingWaiting")
              : t("payments.noApprovedOutstanding")
          }
          description={
            direction === "RECEIPT"
              ? t("payments.receiptEmptyBody")
              : t("payments.paymentEmptyBody")
          }
          action={{ label: t("payments.back"), href: "/finance/payments" }}
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
