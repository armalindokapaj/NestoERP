import type {
  ContractAmendmentStatus,
  ContractApprovalRecordType,
  ContractApprovalStatus,
  ContractObligationStatus,
  ContractObligationType,
  ContractPartyRole,
  ContractPartyType,
  ContractRenewalType,
  ContractStatus,
  ContractType,
} from "@prisma/client";

/**
 * Legal DTOs (PRD #18 §254–§260).
 *
 * Two things are load-bearing here:
 *
 *   1. **Redaction is absence, not a flag.** A reader without
 *      `legal.commercial.view` receives `commercial: null` — the value never
 *      leaves the server for the browser to hide. Shipping the number and
 *      styling it away is not a permission (PRD #18 §255, §495).
 *   2. **Money is a decimal string.** Every amount crosses the API as text, so
 *      no JSON parser ever rounds an agreement (PRD #18 §63, §351).
 *
 * `capabilities` is a UX hint and never a security decision: the service
 * re-checks each one before it acts (PRD #7 §55).
 */

export type ClientRef = { id: string; name: string };
export type ProjectRef = { id: string; code: string; name: string };
export type MemberRef = { memberId: string; fullName: string; active: boolean };

/**
 * A link to a record in another module.
 *
 * `href` is null when the reader may see that the link exists but not open what
 * it points at — the name renders as plain text rather than a dead link
 * (PRD #18 §496, §497).
 */
export type ModuleLinkRef = { id: string; label: string; href: string | null };

/* -------------------------------------------------------------------------- */
/* Contracts                                                                   */
/* -------------------------------------------------------------------------- */

export type ContractCommercialDTO = {
  currency: string | null;
  contractValue: string | null;
};

export type ContractAttentionDTO = {
  /** Derived from the expiry date, never stored (PRD #18 §193). */
  effectiveStatus: ContractStatus;
  expiringSoon: boolean;
  daysToExpiry: number | null;
  renewalNoticeDue: boolean;
  /** SIGNED, with an effective date that has arrived (PRD #18 §121). */
  readyToActivate: boolean;
  unsigned: boolean;
  overdueObligations: number;
  ownerInactive: boolean;
};

export type ContractSummaryDTO = {
  id: string;
  contractNumber: string;
  title: string;
  contractType: ContractType;
  status: ContractStatus;
  client: ClientRef | null;
  project: ProjectRef | null;
  counterpartyName: string | null;
  owner: MemberRef;
  /** Null when the reader has no commercial permission (PRD #18 §255). */
  commercial: ContractCommercialDTO | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  renewalType: ContractRenewalType;
  attention: ContractAttentionDTO;
  updatedAt: string;
};

export type ContractCapabilities = {
  canEdit: boolean;
  canEditTerms: boolean;
  canAssignOwner: boolean;
  canSubmitReview: boolean;
  canReturnToDraft: boolean;
  canSubmitApproval: boolean;
  canApprove: boolean;
  canReject: boolean;
  canMarkSent: boolean;
  canMarkSigned: boolean;
  canActivate: boolean;
  canExpire: boolean;
  canTerminate: boolean;
  canCancel: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canManageParties: boolean;
  canRemoveParties: boolean;
  canCreateObligation: boolean;
  canCreateAmendment: boolean;
  canViewParties: boolean;
  canViewObligations: boolean;
  canViewAmendments: boolean;
  canViewDocuments: boolean;
  canViewTasks: boolean;
  canViewActivity: boolean;
  canUploadDocuments: boolean;
};

export type ContractDetailDTO = ContractSummaryDTO & {
  commercialNotes: string | null;
  dates: {
    sentAt: string | null;
    signedDate: string | null;
    effectiveDate: string | null;
    expiryDate: string | null;
    terminationDate: string | null;
  };
  renewal: {
    type: ContractRenewalType;
    noticeDays: number | null;
    autoRenewalPeriodMonths: number | null;
    alertDate: string | null;
  };
  legal: {
    governingLaw: string | null;
    jurisdiction: string | null;
    summary: string | null;
    /** Null without `legal.confidential_terms.view` (PRD #18 §257). */
    legalNotes: string | null;
    terminationReason: string | null;
  };
  /** Null without `legal.sales_source.view` (PRD #18 §252). */
  salesSource: { opportunity: ModuleLinkRef | null; proposal: ModuleLinkRef | null } | null;
  clientLink: ModuleLinkRef | null;
  projectLink: ModuleLinkRef | null;
  counts: {
    parties: number;
    openObligations: number;
    amendments: number;
    documents: number;
  };
  approvals: ContractApprovalDTO[];
  activeAmendment: ContractAmendmentDTO | null;
  createdBy: MemberRef | null;
  archivedAt: string | null;
  createdAt: string;
  capabilities: ContractCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Parties, obligations, amendments                                            */
/* -------------------------------------------------------------------------- */

export type ContractPartyDTO = {
  id: string;
  role: ContractPartyRole;
  type: ContractPartyType;
  name: string;
  legalName: string | null;
  registrationNumber: string | null;
  taxId: string | null;
  clientId: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
  isPrimaryCounterparty: boolean;
};

export type ContractObligationDTO = {
  id: string;
  contractId: string;
  title: string;
  description: string | null;
  type: ContractObligationType;
  responsible: MemberRef | null;
  dueDate: string | null;
  status: ContractObligationStatus;
  isOverdue: boolean;
  daysOverdue: number;
  completedAt: string | null;
  sourceAmendmentId: string | null;
  capabilities: { canEdit: boolean; canComplete: boolean; canCancel: boolean; canCreateTask: boolean };
};

export type ContractAmendmentDTO = {
  id: string;
  contractId: string;
  amendmentNumber: string;
  title: string;
  summary: string;
  status: ContractAmendmentStatus;
  effectiveDate: string | null;
  signedDate: string | null;
  /** Null without `legal.commercial.view` (PRD #18 §260). */
  commercial: {
    valueDelta: string | null;
    newContractValue: string | null;
    previousContractValue: string | null;
  } | null;
  newExpiryDate: string | null;
  previousExpiryDate: string | null;
  activatedAt: string | null;
  approvals: ContractApprovalDTO[];
  capabilities: {
    canEdit: boolean;
    canSubmit: boolean;
    canApprove: boolean;
    canReject: boolean;
    canMarkSent: boolean;
    canMarkSigned: boolean;
    canActivate: boolean;
    canCancel: boolean;
    canArchive: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

/* -------------------------------------------------------------------------- */
/* Approvals                                                                   */
/* -------------------------------------------------------------------------- */

export type ContractApprovalDTO = {
  id: string;
  recordType: ContractApprovalRecordType;
  recordId: string;
  contractId: string;
  recordReference: string;
  recordTitle: string;
  contractNumber: string;
  client: ClientRef | null;
  project: ProjectRef | null;
  /** Null without `legal.commercial.view` (PRD #18 §186). */
  commercial: ContractCommercialDTO | null;
  status: ContractApprovalStatus;
  submittedBy: MemberRef | null;
  submittedAt: string;
  decidedBy: MemberRef | null;
  decidedAt: string | null;
  decisionNote: string | null;
  capabilities: { canApprove: boolean; canReject: boolean };
};

/* -------------------------------------------------------------------------- */
/* Overview and reports                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Money grouped by currency and never summed across them (PRD #18 §65, §221).
 *
 * V0.1 has no FX engine, so "€400,000 + $200,000" is not a number this product
 * is allowed to print.
 */
export type CurrencyTotal = {
  currency: string;
  count: number;
  value: string;
};

export type ContractOverviewDTO = {
  visible: {
    contracts: boolean;
    approvals: boolean;
    obligations: boolean;
    commercial: boolean;
  };
  activeContracts: number;
  expiringIn30Days: number;
  expiringIn90Days: number;
  pendingReview: number;
  pendingApproval: number;
  approvedNotSent: number;
  sentNotSigned: number;
  readyToActivate: number;
  openObligations: number;
  overdueObligations: number;
  renewalNoticeDue: number;
  terminatedThisYear: number;
  /** Null without commercial permission (PRD #18 §32, §298). */
  activeValue: CurrencyTotal[] | null;
};

export type ContractAttentionListDTO = {
  expiring: ContractSummaryDTO[];
  renewalNoticeDue: ContractSummaryDTO[];
  readyToActivate: ContractSummaryDTO[];
  awaitingSignature: ContractSummaryDTO[];
  overdueObligations: ContractObligationDTO[];
  inactiveOwners: ContractSummaryDTO[];
};

export type StatusCountRow = { status: ContractStatus; count: number };
export type TypeCountRow = { contractType: ContractType; count: number };

export type ExpiryBucketRow = {
  key: string;
  label: string;
  count: number;
  totals: CurrencyTotal[] | null;
};

export type RenewalNoticeRow = {
  contract: ContractSummaryDTO;
  alertDate: string | null;
  noticeDays: number | null;
};

export type ValueSummaryRow = {
  key: string;
  label: string;
  totals: CurrencyTotal[];
};

export type OwnerSummaryRow = {
  owner: MemberRef;
  count: number;
  totals: CurrencyTotal[] | null;
};

export type TerminatedContractRow = {
  contract: ContractSummaryDTO;
  terminationDate: string | null;
  /** Null without `legal.confidential_terms.view` (PRD #18 §223). */
  terminationReason: string | null;
};

export type AmendmentSummaryRow = {
  contractId: string;
  contractNumber: string;
  amendmentNumber: string;
  title: string;
  status: ContractAmendmentStatus;
  effectiveDate: string | null;
  /** Null without commercial permission. */
  valueChange: { from: string | null; to: string | null } | null;
  expiryChange: { from: string | null; to: string | null } | null;
};

export type ContractActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  createdAt: string;
};
