import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BudgetForm } from "@/components/finance/budget-form";
import { RecordContextHeader } from "@/components/modules/record-header";
import { updateBudgetAction } from "@/lib/actions/finance";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";
import { budgetBreadcrumbs, budgetLabel, loadBudget } from "../budget-context";

type Params = { params: Promise<{ budgetId: string }> };

export const metadata: Metadata = { title: "Edit budget" };

/** An approved budget is never edited — a revision is a new version (PRD #15 §111). */
export default async function EditBudgetPage({ params }: Params) {
  const { budgetId } = await params;
  const { context, budget } = await loadBudget(budgetId);

  if (!budget.capabilities.canEdit) redirect(`/finance/budgets/${budgetId}`);

  const approvedCurrency = await budgets.approvedBudgetCurrency(context, budget.project.id);

  async function action(formData: FormData) {
    "use server";
    return updateBudgetAction(budgetId, formData);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <RecordContextHeader
        breadcrumbs={budgetBreadcrumbs(budget, "Edit")}
        title={`Edit ${budgetLabel(budget)}`}
        subtitle={budget.project.name}
        status={budget.status}
      />

      <BudgetForm
        action={action}
        projects={[
          { value: budget.project.id, label: `${budget.project.name} (${budget.project.code})` },
        ]}
        values={{
          projectId: budget.project.id,
          name: budget.name,
          currency: budget.currency,
          notes: budget.notes,
          lineItems: budget.lineItems.map((line) => ({
            category: line.category,
            description: line.description,
            plannedAmount: line.plannedAmount,
          })),
        }}
        lockedCurrency={approvedCurrency}
        versionUpdatedAt={budget.updatedAt}
        cancelHref={`/finance/budgets/${budget.id}`}
        submitLabel="Save changes"
        pendingLabel="Saving…"
      />
    </div>
  );
}
