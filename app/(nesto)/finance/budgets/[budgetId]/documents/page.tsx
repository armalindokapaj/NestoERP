import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FinanceRecordDocuments } from "@/components/finance/record-documents";
import { RecordContextHeader } from "@/components/modules/record-header";
import { budgetBreadcrumbs, budgetLabel, loadBudget } from "../budget-context";
import { FinanceRecordTabs } from "../../../invoices/[invoiceId]/record-tabs";

type Params = { params: Promise<{ budgetId: string }> };

export const metadata: Metadata = { title: "Budget documents" };

export default async function BudgetDocumentsPage({ params }: Params) {
  const { budgetId } = await params;
  const { context, budget } = await loadBudget(budgetId);

  if (!budget.capabilities.canViewDocuments) notFound();

  return (
    <div className="space-y-5">
      <RecordContextHeader
        breadcrumbs={budgetBreadcrumbs(budget, "Documents")}
        title={budgetLabel(budget)}
        subtitle={budget.project.name}
        status={budget.status}
      />

      <FinanceRecordTabs
        basePath={`/finance/budgets/${budget.id}`}
        active="documents"
        show={{ documents: true, activity: budget.capabilities.canViewActivity }}
      />

      <FinanceRecordDocuments
        context={context}
        entityType="budget"
        entityId={budget.id}
        canAttach={budget.status !== "ARCHIVED"}
      />
    </div>
  );
}
