import type { ProposalStatus } from "@prisma/client";

/**
 * Proposal workflow (PRD #17 §107, §230, §231).
 *
 * ARCHIVED is unreachable through this table, as elsewhere: archive is its own
 * action and restore reads `preArchiveStatus` (PRD #17 §125).
 *
 * The one transition this table cannot express is ACCEPTED, which carries a
 * second condition — no other proposal on the same opportunity may already be
 * accepted — and the service enforces it inside the transaction (PRD #17 §186).
 */
const TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: ["SENT", "CANCELLED"],
  REJECTED: ["DRAFT", "PENDING_APPROVAL", "CANCELLED"],
  SENT: ["ACCEPTED", "DECLINED", "CANCELLED"],
  ACCEPTED: [],
  DECLINED: [],
  CANCELLED: [],
  ARCHIVED: [],
};

export function canTransitionProposalStatus(from: ProposalStatus, to: ProposalStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/** Money and terms are frozen the moment a proposal leaves draft (PRD #17 §115, §184). */
export const EDITABLE_PROPOSAL_STATUSES: ProposalStatus[] = ["DRAFT", "REJECTED"];

export function isProposalEditable(status: ProposalStatus): boolean {
  return EDITABLE_PROPOSAL_STATUSES.includes(status);
}

export function isProposalSubmittable(status: ProposalStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

/**
 * An accepted proposal is the deal the client agreed to (PRD #17 §125, §232).
 *
 * It cannot be cancelled and it cannot be archived. If the terms change, the
 * answer is a new proposal, not a quiet edit to the one somebody signed off.
 */
export const ARCHIVABLE_PROPOSAL_STATUSES: ProposalStatus[] = [
  "DRAFT",
  "REJECTED",
  "DECLINED",
  "CANCELLED",
];

export function isProposalArchivable(status: ProposalStatus): boolean {
  return ARCHIVABLE_PROPOSAL_STATUSES.includes(status);
}

export const CANCELLABLE_PROPOSAL_STATUSES: ProposalStatus[] = [
  "DRAFT",
  "REJECTED",
  "APPROVED",
  "SENT",
];

export function isProposalCancellable(status: ProposalStatus): boolean {
  return CANCELLABLE_PROPOSAL_STATUSES.includes(status);
}

/**
 * "Expiring soon" is derived at read time, never stored (PRD #17 §402).
 *
 * A proposal does not change when a date passes; what changes is what the list
 * should be drawing attention to today.
 */
export const EXPIRY_WARNING_DAYS = 7;

export function proposalExpiry(input: {
  status: ProposalStatus;
  validUntil: Date | null;
  now?: Date;
}): "NONE" | "EXPIRING_SOON" | "EXPIRED" {
  if (input.status !== "SENT" || !input.validUntil) return "NONE";

  const now = input.now ?? new Date();
  const days = Math.ceil((input.validUntil.getTime() - now.getTime()) / 86_400_000);

  if (days < 0) return "EXPIRED";
  return days <= EXPIRY_WARNING_DAYS ? "EXPIRING_SOON" : "NONE";
}

export const proposalStatusLabels: Record<ProposalStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};

export const lostReasonLabels = {
  PRICE: "Price",
  COMPETITOR: "Competitor",
  TIMING: "Timing",
  NO_BUDGET: "No budget",
  NO_RESPONSE: "No response",
  SCOPE_MISMATCH: "Scope mismatch",
  INTERNAL_DECISION: "Internal decision",
  OTHER: "Other",
} as const;
