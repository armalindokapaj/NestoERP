import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FinanceRecordDocuments } from "@/components/finance/record-documents";
import { loadBudget } from "../../budget-context";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ budgetId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.budgetDocuments") };
}

export default async function BudgetDocumentsPage({ params }: Params) {
  const t = await getTranslations("finance");
  const { budgetId } = await params;
  const { context, budget } = await loadBudget(budgetId);

  if (!budget.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <FinanceRecordDocuments
        context={context}
        entityType="budget"
        entityId={budget.id}
        canAttach={budget.status !== "ARCHIVED"}
      />
    </div>
  );
}
