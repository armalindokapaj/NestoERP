import { ExpenseActions } from "@/components/finance/expense-actions";
import { Money } from "@/components/finance/money";
import { RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { getTranslations } from "@/lib/i18n/server";
import { pendingCycle } from "@/lib/modules/finance/approvals/approval.service";
import { formatDate } from "@/lib/utils/format";
import { expenseBreadcrumbs, expenseLabel, loadExpense } from "../expense-context";
import { FinanceRecordTabs } from "../../../invoices/[invoiceId]/record-tabs";

type Props = { children: React.ReactNode; params: Promise<{ expenseId: string }> };

/** The record's frame: header and tabs stay mounted while Overview, Documents and Activity swap beneath them. */
export default async function ExpenseTabsLayout({ children, params }: Props) {
  const { expenseId } = await params;
  const { context, expense } = await loadExpense(expenseId);

  const may = expense.capabilities;
  const t = await getTranslations("finance");
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle = may.canApprove || may.canReject ? await pendingCycle(context, "EXPENSE", expense.id) : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={await expenseBreadcrumbs(expense)}
        title={expense.description}
        subtitle={expense.expenseNumber ?? undefined}
        status={expense.status}
        badges={<Badge tone="neutral">{t(`category.${expense.category}`)}</Badge>}
        meta={[
          {
            label: t("columns.total"),
            value: <Money amount={expense.totalAmount} currency={expense.currency} emphasis />,
          },
          {
            label: t("columns.outstanding"),
            value: <Money amount={expense.outstandingAmount} currency={expense.currency} />,
          },
          { label: t("expenses.incurred"), value: formatDate(expense.expenseDate) },
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
        show={{ documents: may.canViewDocuments, activity: may.canViewActivity }}
      />

      {children}
    </div>
  );
}
