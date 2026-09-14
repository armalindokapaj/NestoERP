import { AccessError } from "@/lib/access/guards";

/**
 * What a decision was made against (PRD #41 §121, §186, §187).
 *
 * The Approvals Center reviews one approval cycle — and, in a chain, one step
 * of it — then asks the owning module to decide. Between the drawer opening
 * and the button being pressed the record may have been resubmitted (a new
 * cycle) or a step may have been decided by somebody else. The module checks
 * this inside its own transaction, so a stale review can never decide the
 * cycle that replaced it.
 *
 * Optional everywhere: a module's own pages decide "whatever is pending on
 * this record", exactly as they always have.
 */
export type ApprovalGuard = {
  /** The module's approval row the reviewer was looking at. */
  approvalId?: string;
  /** In a chain, the step the reviewer was looking at. */
  stepNumber?: number;
};

export const APPROVAL_SOURCE_CHANGED = "APPROVAL_SOURCE_CHANGED";

export function assertApprovalGuard(
  guard: ApprovalGuard | undefined,
  pending: { id: string },
  currentStepNumber?: number | null,
): void {
  if (!guard) return;
  if (guard.approvalId && guard.approvalId !== pending.id) {
    throw new AccessError("CONFLICT", "This request was resubmitted since you opened it. Review the latest version.", {
      code: APPROVAL_SOURCE_CHANGED,
    });
  }
  if (guard.stepNumber !== undefined && currentStepNumber !== undefined && currentStepNumber !== null && guard.stepNumber !== currentStepNumber) {
    throw new AccessError("CONFLICT", "This approval moved to another step since you opened it. Review the latest version.", {
      code: APPROVAL_SOURCE_CHANGED,
    });
  }
}
