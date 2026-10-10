import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FinanceRecordDocuments } from "@/components/finance/record-documents";
import { loadExpense } from "../../expense-context";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ expenseId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.expenseDocuments") };
}

export default async function ExpenseDocumentsPage({ params }: Params) {
  const t = await getTranslations("finance");
  const { expenseId } = await params;
  const { context, expense } = await loadExpense(expenseId);

  if (!expense.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <FinanceRecordDocuments
        context={context}
        entityType="expense"
        entityId={expense.id}
        canAttach={expense.status !== "ARCHIVED"}
      />
    </div>
  );
}
