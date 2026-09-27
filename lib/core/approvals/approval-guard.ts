import { AccessError } from "@/lib/access/guards";

/**
 * What a decision was made against (PRD #41 §121, §186, §187; AUD-10 §4).
 *
 * A reviewer looks at one approval cycle — and, in a chain, one step of it —
 * then asks the owning module to decide. Between the page opening and the
 * button being pressed the record may have been resubmitted (a new cycle) or a
 * step may have been decided by somebody else. The module checks this inside
 * its own transaction, so a stale view can never decide the cycle that
 * replaced it.
 *
 * Required at every decision (AUD-10 §4, CW-02, CW-05). The Approvals Center
 * has always named the cycle; the module's own pages, queues and API routes
 * now do too, from the pending cycle they displayed. "Whatever is pending on
 * this record" is exactly the decision a stale page must not be able to make.
 */
export type ApprovalGuard = {
  /** The module's approval row the reviewer was looking at. */
  approvalId?: string;
  /** In a chain, the step the reviewer was looking at. */
  stepNumber?: number;
  /**
   * The record's own version as the reviewer saw it, where the record has one
   * (a unit's row version). Checked in the deciding transaction, so a record
   * edited while its cycle waited is not decided from a stale view (AUD-10 §4,
   * A4/A5). Optional: a record with no version column has nothing to compare.
   */
  recordVersion?: number;
};

/** The cycle the reviewer saw is not the one pending now (409). */
export const APPROVAL_SOURCE_CHANGED = "APPROVAL_SOURCE_CHANGED";
/** A decision that did not say which cycle it decides (428, mirroring TASK_VERSION_REQUIRED). */
export const APPROVAL_CYCLE_REQUIRED = "APPROVAL_CYCLE_REQUIRED";
/** More than one pending cycle on a record: a data fault, never decided at random (AUD-10 §4, A6). */
export const APPROVAL_CYCLE_AMBIGUOUS = "APPROVAL_CYCLE_AMBIGUOUS";

/**
 * The comparison alone: a named cycle or step that is no longer current is a
 * conflict. Kept lenient for the providers that still decide without naming a
 * cycle (timesheets, unit sales); every AUD-10 source uses `assertDecisionGuard`.
 */
export function assertApprovalGuard(
  guard: ApprovalGuard | undefined,
  pending: { id: string },
  currentStepNumber?: number | null,
): void {
  if (!guard) return;
  if (guard.approvalId && guard.approvalId !== pending.id) {
    throw new AccessError("CONFLICT", "This request was resubmitted since you opened it. Reload the page to review the latest version.", {
      code: APPROVAL_SOURCE_CHANGED,
    });
  }
  if (guard.stepNumber !== undefined && currentStepNumber !== undefined && currentStepNumber !== null && guard.stepNumber !== currentStepNumber) {
    throw new AccessError("CONFLICT", "This approval moved to another step since you opened it. Reload the page to review the latest version.", {
      code: APPROVAL_SOURCE_CHANGED,
    });
  }
}

/**
 * A decision must name what it decides (AUD-10 §4, CW-02, CW-04, CW-05).
 *
 * Refused before anything is read or written: 428 APPROVAL_CYCLE_REQUIRED.
 * Call it first in every domain decision, then `assertDecisionGuard` once the
 * pending cycle has been read inside the transaction.
 */
export function requireDecisionGuard(guard: ApprovalGuard | undefined): asserts guard is ApprovalGuard & { approvalId: string } {
  if (!guard?.approvalId) {
    throw new AccessError("PRECONDITION_REQUIRED", "This decision did not say which request it was made on. Reload the page and decide the request you can see.", {
      code: APPROVAL_CYCLE_REQUIRED,
    });
  }
}

/**
 * The strict form, inside the deciding transaction: the cycle must be named
 * and current, and in a chain the step must be named and current too — a page
 * that showed step one cannot approve step two (AUD-10 §4, CW-04).
 */
export function assertDecisionGuard(
  guard: ApprovalGuard | undefined,
  pending: { id: string },
  currentStepNumber?: number | null,
): void {
  requireDecisionGuard(guard);
  if (currentStepNumber !== undefined && currentStepNumber !== null && guard.stepNumber === undefined) {
    throw new AccessError("PRECONDITION_REQUIRED", "This decision did not say which approval step it was made on. Reload the page and decide the step you can see.", {
      code: APPROVAL_CYCLE_REQUIRED,
    });
  }
  assertApprovalGuard(guard, pending, currentStepNumber);
}

/**
 * The pending cycle of a record, deterministically (AUD-10 §4, A6).
 *
 * Newest first; two pending cycles on one record is a data fault the unique
 * index is there to prevent, so it is refused with an integrity error rather
 * than deciding whichever row the planner returned first.
 */
export function singlePending<T extends { id: string }>(rows: T[]): T | null {
  if (rows.length > 1) {
    throw new AccessError("CONFLICT", "This record has more than one open approval, so it cannot be decided until that is corrected. Ask an administrator to check it.", {
      code: APPROVAL_CYCLE_AMBIGUOUS,
      approvalIds: rows.map((row) => row.id),
    });
  }
  return rows[0] ?? null;
}

/**
 * Reads the cycle a request names, from a JSON body or a form (AUD-10 §4).
 *
 * `approvalId` and, in a chain, `stepNumber`. Anything malformed is treated as
 * absent, so it is refused as APPROVAL_CYCLE_REQUIRED by the domain rather than
 * guessed at here.
 */
export function approvalGuardFrom(source: unknown): ApprovalGuard | undefined {
  const read = (key: string): unknown => {
    if (typeof FormData !== "undefined" && source instanceof FormData) return source.get(key) ?? undefined;
    if (source && typeof source === "object") return (source as Record<string, unknown>)[key];
    return undefined;
  };
  const approvalId = read("approvalId");
  if (typeof approvalId !== "string" || approvalId.trim().length === 0 || approvalId.length > 64) return undefined;
  const guard: ApprovalGuard = { approvalId: approvalId.trim() };
  const step = read("stepNumber");
  const stepNumber = typeof step === "number" ? step : typeof step === "string" && step.trim() !== "" ? Number(step) : undefined;
  if (stepNumber !== undefined && Number.isInteger(stepNumber) && stepNumber >= 1 && stepNumber <= 1000) guard.stepNumber = stepNumber;
  const version = read("recordVersion");
  const recordVersion = typeof version === "number" ? version : typeof version === "string" && version.trim() !== "" ? Number(version) : undefined;
  if (recordVersion !== undefined && Number.isSafeInteger(recordVersion) && recordVersion >= 1) guard.recordVersion = recordVersion;
  return guard;
}

/**
 * The cycle a source page displayed, as the page hands it to its decision
 * controls and they hand it back to a server action — which reads it with
 * `approvalGuardFrom`, since whatever a browser sends is only a claim.
 */
export type PendingCycle = { approvalId: string; stepNumber?: number | null };

/** A reject or return that gave no reason (422), the Approvals Center's own code. */
export const APPROVAL_REASON_REQUIRED = "APPROVAL_REASON_REQUIRED";

/**
 * Saying no needs a reason, at the domain rather than only in the dialog or
 * the Center's schema (AUD-10 §4, A13): every source that asks for one — the
 * reject dialogs, the modules' reason schemas — is backed by the service it
 * calls, so an API caller cannot turn a request down in silence. Returns the
 * trimmed note.
 */
export function requireDecisionNote(note: string | null | undefined, message = "Say why, so the person who submitted it knows what to change."): string {
  const trimmed = note?.trim() ?? "";
  if (!trimmed) {
    throw new AccessError("VALIDATION_ERROR", message, { code: APPROVAL_REASON_REQUIRED });
  }
  return trimmed;
}
