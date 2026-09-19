/**
 * A unit's contract (E-05F). Client-safe: labels and the shapes the API answers
 * with. The Legal module's statuses are kept for every contract; the unit page
 * shows the E-05F names over them (§9) — Under review for IN_REVIEW, Ready for
 * signature for APPROVED.
 */

export const CONTRACT_STATUS_KEYS = ["DRAFT", "IN_REVIEW", "PENDING_APPROVAL", "APPROVED", "SENT", "SIGNED", "ACTIVE", "COMPLETED", "EXPIRED", "TERMINATED", "CANCELLED", "ARCHIVED"] as const;
export type ContractStatusKey = (typeof CONTRACT_STATUS_KEYS)[number];

export const UNIT_CONTRACT_STATUS_LABELS: Record<ContractStatusKey, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "Under review",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Ready for signature",
  SENT: "Sent for signature",
  SIGNED: "Signed",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  EXPIRED: "Expired",
  TERMINATED: "Terminated",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};

export const CONTRACT_REQUEST_STATUS_LABELS = { OPEN: "Waiting for Legal", FULFILLED: "Contract drafted", DECLINED: "Declined", CANCELLED: "Withdrawn" } as const;
export type ContractRequestStatusKey = keyof typeof CONTRACT_REQUEST_STATUS_LABELS;

export const LEGAL_REASON_MAX = 1_000;

/** The statuses under which a contract is still the unit's contract (§8). */
export const LIVE_CONTRACT_STATUSES: ContractStatusKey[] = ["DRAFT", "IN_REVIEW", "PENDING_APPROVAL", "APPROVED", "SENT", "SIGNED", "ACTIVE", "COMPLETED"];

export type UnitLegalCapabilities = {
  canView: boolean;
  canRequest: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canReview: boolean;
  canSignStatus: boolean;
  canCancel: boolean;
  canManageDocuments: boolean;
  canAmend: boolean;
  /** Opening the contract itself in Legal's workspace, with its own scope. */
  canOpenContract: boolean;
  /** The contract value, for readers of Legal's commercial terms or the unit's finance (§100). */
  canSeeValue: boolean;
  canSeeClients: boolean;
  canSeeDeals: boolean;
};

export type PartyRef = { id: string; name: string } | null;

export type ContractRequestDTO = {
  id: string;
  status: ContractRequestStatusKey;
  unit: { id: string; unitCode: string; projectId: string; projectName: string; building: string; floor: string };
  client: PartyRef;
  deal: PartyRef;
  agreedPrice: string | null;
  currency: string | null;
  reservation: { id: string; status: string; expiresAt: string };
  notes: string | null;
  requestedBy: string | null;
  requestedByMemberId: string | null;
  requestedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  contract: { id: string; number: string } | null;
};

/** A contract action the unit page offers, answered from the contract's machine and the reader's grants. */
export type UnitContractAction = "submit_review" | "return_to_draft" | "submit_approval" | "mark_sent" | "mark_signed" | "activate" | "complete" | "cancel" | "terminate";

export type UnitContractDTO = {
  id: string;
  number: string;
  title: string;
  status: ContractStatusKey;
  statusLabel: string;
  live: boolean;
  client: PartyRef;
  deal: PartyRef;
  value: string | null;
  currency: string | null;
  signedDate: string | null;
  effectiveDate: string | null;
  completedAt: string | null;
  owner: string | null;
  ownerMemberId: string | null;
  createdAt: string;
  units: Array<{ unitId: string; unitCode: string; value: string | null; valueNote: string | null; released: boolean; releaseReason: string | null }>;
  pendingApproval: boolean;
  documentCount: number;
  actions: UnitContractAction[];
};

export type ContractCandidateDTO = { unitId: string; unitCode: string; unitType: string; agreedPrice: string | null; currency: string | null; hasOpenRequest: boolean };

export type UnitLegalDTO = {
  unitId: string;
  projectId: string;
  unitCode: string;
  contract: UnitContractDTO | null;
  history: UnitContractDTO[];
  openRequest: ContractRequestDTO | null;
  requests: ContractRequestDTO[];
  /** Why a contract cannot be requested or drafted now, said before anybody tries (§13, §111). */
  requestBlocked: string | null;
  createBlocked: string | null;
  /** Other units of the same client and deal that one contract may sell with this one (§88). */
  candidates: ContractCandidateDTO[];
  defaults: { autoNumber: boolean; title: string; agreedPrice: string | null; currency: string | null };
  capabilities: UnitLegalCapabilities;
};
