"use client";

import { FinanceRecordActions } from "@/components/finance/record-actions";
import { budgetLifecycleAction, rejectBudgetAction } from "@/lib/actions/finance";
import type { BudgetAction } from "@/lib/actions/finance";
import type { RecordCapabilities } from "@/lib/modules/finance/finance.types";

export function BudgetActions({
  budgetId,
  label,
  capabilities,
}: {
  budgetId: string;
  label: string;
  capabilities: RecordCapabilities;
}) {
  return (
    <FinanceRecordActions
      kind="budget"
      label={label}
      capabilities={capabilities}
      editHref={`/finance/budgets/${budgetId}/edit`}
      lifecycle={(action) => budgetLifecycleAction(budgetId, action as BudgetAction)}
      reject={(reason) => rejectBudgetAction(budgetId, reason)}
    />
  );
}
