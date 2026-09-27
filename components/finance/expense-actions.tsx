"use client";

import { FinanceRecordActions } from "@/components/finance/record-actions";
import { expenseLifecycleAction, rejectExpenseAction } from "@/lib/actions/finance";
import type { ExpenseAction } from "@/lib/actions/finance";
import type { PendingCycle } from "@/lib/core/approvals/approval-guard";
import type { RecordCapabilities } from "@/lib/modules/finance/finance.types";

export function ExpenseActions({
  expenseId,
  label,
  capabilities,
  cycle,
}: {
  expenseId: string;
  label: string;
  capabilities: RecordCapabilities;
  /** The approval cycle on screen; a decision names it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  return (
    <FinanceRecordActions
      kind="expense"
      label={label}
      capabilities={capabilities}
      editHref={`/finance/expenses/${expenseId}/edit`}
      lifecycle={(action) => expenseLifecycleAction(expenseId, action as ExpenseAction, undefined, cycle)}
      reject={(reason) => rejectExpenseAction(expenseId, reason, cycle)}
    />
  );
}
