import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RecordContextHeader } from "@/components/modules/record-header";
import { ReviseBudgetForm } from "@/components/finance/revise-budget-form";
import { getTranslations } from "@/lib/i18n/server";
import { budgetBreadcrumbs, budgetLabel, loadBudget } from "../budget-context";

type Params = { params: Promise<{ budgetId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.reviseBudget") };
}

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
  const t = await getTranslations("finance");

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <RecordContextHeader
        breadcrumbs={await budgetBreadcrumbs(budget, t("budgets.revise"))}
        title={t("budgets.reviseTitle", { label: budgetLabel(budget, t) })}
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
