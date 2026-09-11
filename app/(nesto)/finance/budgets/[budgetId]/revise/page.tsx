import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { ReviseBudgetForm } from "@/components/finance/revise-budget-form";
import { budgetBreadcrumbs, budgetLabel, loadBudget } from "../budget-context";

type Params = { params: Promise<{ budgetId: string }> };

export const metadata: Metadata = { title: "Revise budget" };

/**
 * Opening the next budget version (PRD #15 §115).
 *
 * A confirmation rather than a form: the revision starts as an exact copy of
 * the approved version, and the editing happens on the draft that comes out of
 * it. The currency is carried across and cannot be changed (PRD #15 §117).
 */
export default async function ReviseBudgetPage({ params }: Params) {
  const { budgetId } = await params;
  const { budget } = await loadBudget(budgetId);

  if (!budget.capabilities.canRevise) redirect(`/finance/budgets/${budgetId}`);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <RecordContextHeader
        breadcrumbs={budgetBreadcrumbs(budget, "Revise")}
        title={`Revise ${budgetLabel(budget)}`}
        subtitle={budget.project.name}
        status={budget.status}
      />

      <ReviseBudgetForm
        budgetId={budget.id}
        nextVersion={budget.version + 1}
        currency={budget.currency}
        lineCount={budget.lineItems.length}
        cancelHref={`/finance/budgets/${budget.id}`}
      />
    </div>
  );
}
