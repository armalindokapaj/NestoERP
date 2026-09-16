import type { CommitmentStatus } from "@prisma/client";

import { canMove, transitionFor } from "@/lib/core/state/machine";
import { commitmentMachine, type CommitmentTransitionAction } from "./commitment.machine";

/** The statuses an action on the commitment machine is legal from. */
function legalFrom(action: CommitmentTransitionAction): CommitmentStatus[] {
  return [...transitionFor(commitmentMachine, action)!.from];
}

/**
 * The workflow, without archive and restore (PRD #15 §248).
 *
 * Both are actions on the machine, but neither is a step in the workflow. The
 * procurement door depends on the difference: asked whether an archived
 * commitment can become `CLOSED`, the answer has to be no, not "restoring one
 * might land there".
 */
const WORKFLOW = {
  ...commitmentMachine,
  transitions: commitmentMachine.transitions.filter((transition) => transition.action !== "archive" && transition.action !== "restore"),
};

/**
 * Whether the workflow moves a commitment from one status to another,
 * answered from `commitmentMachine` so there is one table rather than two that
 * can drift.
 *
 * A status counts as moving to itself, as it always has here — the procurement
 * door refreshes an approved commitment in place on exactly that answer.
 *
 * CLOSED means the commitment no longer contributes to open committed cost —
 * the work happened and became an expense, or it simply will not happen
 * (PRD #15 §134).
 */
export function canTransitionCommitment(
  from: CommitmentStatus,
  to: CommitmentStatus,
): boolean {
  if (from === to) return true;
  return canMove(WORKFLOW, from, to);
}

export const EDITABLE_COMMITMENT_STATUSES: CommitmentStatus[] = ["DRAFT", "REJECTED"];

export function isCommitmentEditable(status: CommitmentStatus): boolean {
  return EDITABLE_COMMITMENT_STATUSES.includes(status);
}

const SUBMITTABLE_COMMITMENT_STATUSES = legalFrom("submit");

export function isCommitmentSubmittable(status: CommitmentStatus): boolean {
  return SUBMITTABLE_COMMITMENT_STATUSES.includes(status);
}

/** An active approved commitment is live forecast; it stays visible (PRD #15 §136). */
export const ARCHIVABLE_COMMITMENT_STATUSES: CommitmentStatus[] = legalFrom("archive");

export function isCommitmentArchivable(status: CommitmentStatus): boolean {
  return ARCHIVABLE_COMMITMENT_STATUSES.includes(status);
}

export const CANCELLABLE_COMMITMENT_STATUSES: CommitmentStatus[] = legalFrom("cancel");

/** Only an approved, still-open commitment counts toward forecast (PRD #15 §119). */
export function countsAsOpenCommitment(status: CommitmentStatus): boolean {
  return status === "APPROVED";
}

/**
 * A commitment created by another module is that module's record (PRD #15 §128).
 *
 * Finance shows it and can close it, but the amount belongs to whatever raised
 * the purchase order — editing it here would put two numbers where there is one
 * commitment.
 */
export function isSourced(commitment: { sourceModule: string | null }): boolean {
  return commitment.sourceModule !== null;
}

export const commitmentStatusLabels: Record<CommitmentStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};
