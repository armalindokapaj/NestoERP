import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FinanceRecordDocuments } from "@/components/finance/record-documents";
import { RecordContextHeader } from "@/components/modules/record-header";
import { expenseBreadcrumbs, expenseLabel, loadExpense } from "../expense-context";
import { FinanceRecordTabs } from "../../../invoices/[invoiceId]/record-tabs";

type Params = { params: Promise<{ expenseId: string }> };

export const metadata: Metadata = { title: "Expense documents" };

export default async function ExpenseDocumentsPage({ params }: Params) {
  const { expenseId } = await params;
  const { context, expense } = await loadExpense(expenseId);

  if (!expense.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={expenseBreadcrumbs(expense, "Documents")}
        title={expenseLabel(expense)}
        status={expense.status}
      />

      <FinanceRecordTabs
        basePath={`/finance/expenses/${expense.id}`}
        active="documents"
        show={{ documents: true, activity: expense.capabilities.canViewActivity }}
      />

      <FinanceRecordDocuments
        context={context}
        entityType="expense"
        entityId={expense.id}
        canAttach={expense.status !== "ARCHIVED"}
      />
    </div>
  );
}
