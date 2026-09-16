import type { ContractAmendmentStatus } from "@prisma/client";

import { canMove } from "@/lib/core/state/machine";
import { contractAmendmentMachine } from "./amendment.machine";

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

/** What may follow what, answered from the amendment's machine. */
export function canTransitionAmendmentStatus(
  from: ContractAmendmentStatus,
  to: ContractAmendmentStatus,
): boolean {
  return canMove(contractAmendmentMachine, from, to);
}

export function isAmendmentEditable(status: ContractAmendmentStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

export function isAmendmentSubmittable(status: ContractAmendmentStatus): boolean {
  return canTransitionAmendmentStatus(status, "PENDING_APPROVAL");
}

export function isAmendmentCancellable(status: ContractAmendmentStatus): boolean {
  return canTransitionAmendmentStatus(status, "CANCELLED");
}

export function isAmendmentArchivable(status: ContractAmendmentStatus): boolean {
  return canTransitionAmendmentStatus(status, "ARCHIVED");
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
