import type { ContractRenewalType, ContractStatus } from "@prisma/client";

/**
 * The contract lifecycle (PRD #18 §40, §191, §293).
 *
 * Two rules are encoded here and nowhere else:
 *
 *   1. **Every move is a named action.** The transition table is the whole
 *      truth about what may follow what, and no generic PATCH can set `status`
 *      (PRD #18 §192). ARCHIVED has no outgoing edge because leaving the
 *      archive is a restore, which returns the status the record held before.
 *   2. **Expiry is a fact about today, not a stored flag.** A contract whose
 *      expiry date has passed reads as expired whether or not anybody has run
 *      the maintenance action yet, so a report cannot disagree with a calendar
 *      (PRD #18 §123, §193).
 */

export const CONTRACT_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "SIGNED",
  "ACTIVE",
  "EXPIRED",
  "TERMINATED",
  "CANCELLED",
  "ARCHIVED",
] as const;

export const contractStatusLabels: Record<ContractStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  SENT: "Sent",
  SIGNED: "Signed",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  TERMINATED: "Terminated",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};

export const renewalTypeLabels: Record<ContractRenewalType, string> = {
  NONE: "No renewal",
  MANUAL: "Manual renewal",
  AUTO_RENEW: "Auto-renews",
  EVERGREEN: "Evergreen",
};

/**
 * What may follow what (PRD #18 §191).
 *
 * SIGNED → TERMINATED is deliberate: an agreement can be ended after signature
 * but before it ever takes effect. ACTIVE → CANCELLED is deliberately absent —
 * a contract in force is terminated, never cancelled (PRD #18 §128).
 */
const TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  DRAFT: ["IN_REVIEW", "CANCELLED", "ARCHIVED"],
  IN_REVIEW: ["DRAFT", "PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "IN_REVIEW", "CANCELLED"],
  APPROVED: ["SENT", "CANCELLED"],
  SENT: ["SIGNED", "CANCELLED"],
  SIGNED: ["ACTIVE", "TERMINATED"],
  ACTIVE: ["EXPIRED", "TERMINATED"],
  EXPIRED: ["ARCHIVED"],
  TERMINATED: ["ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransitionContractStatus(from: ContractStatus, to: ContractStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * How much of a contract may still be changed by editing it (PRD #18 §105–§107).
 *
 *   FULL      the agreement is still being written
 *   METADATA  owner and internal summary only; terms change by amendment
 *   NONE      the record is closed or under decision
 */
export type ContractEditMode = "FULL" | "METADATA" | "NONE";

export function contractEditMode(status: ContractStatus): ContractEditMode {
  if (status === "DRAFT" || status === "IN_REVIEW") return "FULL";
  if (status === "APPROVED" || status === "SENT" || status === "SIGNED" || status === "ACTIVE") {
    return "METADATA";
  }
  return "NONE";
}

export function isContractEditable(status: ContractStatus): boolean {
  return contractEditMode(status) !== "NONE";
}

/** Archive only what is finished (PRD #18 §134). */
export function isContractArchivable(status: ContractStatus): boolean {
  return status === "DRAFT" || status === "CANCELLED" || status === "EXPIRED" || status === "TERMINATED";
}

export function isContractCancellable(status: ContractStatus): boolean {
  return canTransitionContractStatus(status, "CANCELLED");
}

/** Parties are a term of the agreement, so they freeze when it does (PRD #18 §145). */
export function arePartiesEditable(status: ContractStatus): boolean {
  return status === "DRAFT" || status === "IN_REVIEW";
}

/** A party row may only be removed while the contract is still a draft (PRD #18 §146). */
export function isPartyRemovable(status: ContractStatus): boolean {
  return status === "DRAFT";
}

/** Amendments exist for contracts that have left the drafting table (PRD #18 §165). */
export function acceptsAmendments(status: ContractStatus): boolean {
  return status === "APPROVED" || status === "SENT" || status === "SIGNED" || status === "ACTIVE";
}

/**
 * Obligations may be recorded from drafting through to activity (PRD #18 §158).
 *
 * Recording one against an active contract does not change its terms; it writes
 * down a requirement that was already in them.
 */
export function acceptsObligations(status: ContractStatus): boolean {
  return status !== "ARCHIVED" && status !== "CANCELLED";
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

const DAY = 24 * 60 * 60 * 1000;

export const EXPIRING_SOON_DAYS = 90;

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

function startOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export type ContractDateFacts = {
  status: ContractStatus;
  expiryDate: Date | null;
  renewalType: ContractRenewalType;
  renewalNoticeDays: number | null;
};

/**
 * The status a reader should act on (PRD #18 §123, §193).
 *
 * A live contract whose expiry date has passed is expired, whatever the stored
 * status says. Persisting that is a separate, permissioned action; reporting it
 * is not, because a list that shows "Active — expired 4 days ago" is lying in
 * one of its two columns.
 */
export function getEffectiveContractStatus(
  contract: Pick<ContractDateFacts, "status" | "expiryDate">,
  today: Date,
): ContractStatus {
  if (contract.status !== "ACTIVE") return contract.status;
  if (!contract.expiryDate) return "ACTIVE";
  return daysBetween(today, contract.expiryDate) < 0 ? "EXPIRED" : "ACTIVE";
}

/** ACTIVE and ending within the horizon (PRD #18 §75). */
export function isExpiringSoon(
  contract: Pick<ContractDateFacts, "status" | "expiryDate">,
  today: Date,
  withinDays = EXPIRING_SOON_DAYS,
): boolean {
  if (contract.status !== "ACTIVE" || !contract.expiryDate) return false;
  const days = daysBetween(today, contract.expiryDate);
  return days >= 0 && days <= withinDays;
}

/**
 * The date the renewal conversation has to start (PRD #18 §74).
 *
 * Derived rather than stored: it is expiry minus notice, and both of those can
 * change. A stored copy would be a third version of the same fact.
 */
export function renewalAlertDate(contract: ContractDateFacts): Date | null {
  if (contract.renewalType === "NONE" || !contract.expiryDate) return null;
  const notice = contract.renewalNoticeDays ?? 0;
  return new Date(contract.expiryDate.getTime() - notice * DAY);
}

/** Past the notice date and not yet expired (PRD #18 §194, §517). */
export function isRenewalNoticeDue(contract: ContractDateFacts, today: Date): boolean {
  if (contract.status !== "ACTIVE") return false;
  const alert = renewalAlertDate(contract);
  if (!alert || !contract.expiryDate) return false;
  return daysBetween(today, alert) <= 0 && daysBetween(today, contract.expiryDate) >= 0;
}
