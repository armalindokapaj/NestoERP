"use client";

import { FinanceRecordActions } from "@/components/finance/record-actions";
import { expenseLifecycleAction, rejectExpenseAction } from "@/lib/actions/finance";
import type { ExpenseAction } from "@/lib/actions/finance";
import type { RecordCapabilities } from "@/lib/modules/finance/finance.types";

export function ExpenseActions({
  expenseId,
  label,
  capabilities,
}: {
  expenseId: string;
  label: string;
  capabilities: RecordCapabilities;
}) {
  return (
    <FinanceRecordActions
      kind="expense"
      label={label}
      capabilities={capabilities}
      editHref={`/finance/expenses/${expenseId}/edit`}
      lifecycle={(action) => expenseLifecycleAction(expenseId, action as ExpenseAction)}
      reject={(reason) => rejectExpenseAction(expenseId, reason)}
    />
  );
}
