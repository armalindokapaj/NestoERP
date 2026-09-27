"use client";

import { FinanceRecordActions } from "@/components/finance/record-actions";
import { commitmentLifecycleAction, rejectCommitmentAction } from "@/lib/actions/finance";
import type { CommitmentAction } from "@/lib/actions/finance";
import type { PendingCycle } from "@/lib/core/approvals/approval-guard";
import type { RecordCapabilities } from "@/lib/modules/finance/finance.types";

export function CommitmentActions({
  commitmentId,
  label,
  capabilities,
  cycle,
}: {
  commitmentId: string;
  label: string;
  capabilities: RecordCapabilities;
  /** The approval cycle on screen; a decision names it back (AUD-10 §4, CW-05). */
  cycle: PendingCycle | null;
}) {
  return (
    <FinanceRecordActions
      kind="commitment"
      label={label}
      capabilities={capabilities}
      editHref={`/finance/commitments/${commitmentId}/edit`}
      lifecycle={(action) => commitmentLifecycleAction(commitmentId, action as CommitmentAction, undefined, cycle)}
      reject={(reason) => rejectCommitmentAction(commitmentId, reason, cycle)}
    />
  );
}
