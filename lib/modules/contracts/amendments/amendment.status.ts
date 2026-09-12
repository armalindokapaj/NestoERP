import type { ContractAmendmentStatus } from "@prisma/client";

/**
 * Amendment state (PRD #18 §162, §170–§180, §294).
 *
 * An amendment runs its own approval and signing cycle and then, once, applies
 * its result to the contract. After ACTIVE it is immutable: an executed legal
 * change is history, and changing it again means writing another amendment
 * (PRD #18 §179).
 */

export const AMENDMENT_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "SENT",
  "SIGNED",
  "ACTIVE",
  "CANCELLED",
  "ARCHIVED",
] as const;

export const amendmentStatusLabels: Record<ContractAmendmentStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SENT: "Sent",
  SIGNED: "Signed",
  ACTIVE: "Active",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};

const TRANSITIONS: Record<ContractAmendmentStatus, ContractAmendmentStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED", "ARCHIVED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["SENT", "CANCELLED"],
  REJECTED: ["PENDING_APPROVAL", "CANCELLED", "ARCHIVED"],
  SENT: ["SIGNED", "CANCELLED"],
  SIGNED: ["ACTIVE", "CANCELLED"],
  ACTIVE: [],
  CANCELLED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransitionAmendmentStatus(
  from: ContractAmendmentStatus,
  to: ContractAmendmentStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isAmendmentEditable(status: ContractAmendmentStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

export function isAmendmentSubmittable(status: ContractAmendmentStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

export function isAmendmentCancellable(status: ContractAmendmentStatus): boolean {
  return canTransitionAmendmentStatus(status, "CANCELLED");
}

export function isAmendmentArchivable(status: ContractAmendmentStatus): boolean {
  return status === "DRAFT" || status === "REJECTED" || status === "CANCELLED";
}

/**
 * States that occupy the one material-amendment slot on a contract
 * (PRD #18 §178, §238).
 *
 * Two amendments changing the same value at the same time is not a race the
 * product can resolve afterwards, so only one may be in flight.
 */
export const IN_FLIGHT_AMENDMENT_STATUSES: ContractAmendmentStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "SIGNED",
];

export function isAmendmentInFlight(status: ContractAmendmentStatus): boolean {
  return IN_FLIGHT_AMENDMENT_STATUSES.includes(status);
}
