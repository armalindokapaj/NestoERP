"use client";

import { FinanceRecordActions } from "@/components/finance/record-actions";
import { commitmentLifecycleAction, rejectCommitmentAction } from "@/lib/actions/finance";
import type { CommitmentAction } from "@/lib/actions/finance";
import type { RecordCapabilities } from "@/lib/modules/finance/finance.types";

export function CommitmentActions({
  commitmentId,
  label,
  capabilities,
}: {
  commitmentId: string;
  label: string;
  capabilities: RecordCapabilities;
}) {
  return (
    <FinanceRecordActions
      kind="commitment"
      label={label}
      capabilities={capabilities}
      editHref={`/finance/commitments/${commitmentId}/edit`}
      lifecycle={(action) => commitmentLifecycleAction(commitmentId, action as CommitmentAction)}
      reject={(reason) => rejectCommitmentAction(commitmentId, reason)}
    />
  );
}
