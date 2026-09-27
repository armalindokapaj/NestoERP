"use client";

import { FinanceRecordActions } from "@/components/finance/record-actions";
import { budgetLifecycleAction, rejectBudgetAction } from "@/lib/actions/finance";
import type { BudgetAction } from "@/lib/actions/finance";
import type { PendingCycle } from "@/lib/core/approvals/approval-guard";
import type { RecordCapabilities } from "@/lib/modules/finance/finance.types";

export function BudgetActions({
  budgetId,
  label,
  capabilities,
  cycle,
}: {
  budgetId: string;
  label: string;
  capabilities: RecordCapabilities;
  /** The approval cycle on screen; a decision names it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  return (
    <FinanceRecordActions
      kind="budget"
      label={label}
      capabilities={capabilities}
      editHref={`/finance/budgets/${budgetId}/edit`}
      lifecycle={(action) => budgetLifecycleAction(budgetId, action as BudgetAction, undefined, cycle)}
      reject={(reason) => rejectBudgetAction(budgetId, reason, cycle)}
    />
  );
}
