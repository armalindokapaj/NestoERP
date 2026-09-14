import type { CommitmentStatus } from "@prisma/client";

/**
 * Commitment workflow transitions (PRD #15 §248).
 *
 * CLOSED means the commitment no longer contributes to open committed cost —
 * the work happened and became an expense, or it simply will not happen
 * (PRD #15 §134).
 */
const TRANSITIONS: Record<CommitmentStatus, CommitmentStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  // DRAFT: returned for revision (PRD #41 §48).
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED: ["CLOSED", "CANCELLED"],
  REJECTED: ["DRAFT", "PENDING_APPROVAL", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
  ARCHIVED: [],
};

export function canTransitionCommitment(
  from: CommitmentStatus,
  to: CommitmentStatus,
): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export const EDITABLE_COMMITMENT_STATUSES: CommitmentStatus[] = ["DRAFT", "REJECTED"];

export function isCommitmentEditable(status: CommitmentStatus): boolean {
  return EDITABLE_COMMITMENT_STATUSES.includes(status);
}

export function isCommitmentSubmittable(status: CommitmentStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

/** An active approved commitment is live forecast; it stays visible (PRD #15 §136). */
export const ARCHIVABLE_COMMITMENT_STATUSES: CommitmentStatus[] = [
  "DRAFT",
  "REJECTED",
  "CANCELLED",
  "CLOSED",
];

export function isCommitmentArchivable(status: CommitmentStatus): boolean {
  return ARCHIVABLE_COMMITMENT_STATUSES.includes(status);
}

export const CANCELLABLE_COMMITMENT_STATUSES: CommitmentStatus[] = [
  "DRAFT",
  "REJECTED",
  "APPROVED",
];

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
