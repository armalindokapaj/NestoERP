import type {
  LeadSource,
  LeadStatus,
  LostReason,
  OpportunityStage,
  ProposalStatus,
  SalesApprovalRecordType,
  SalesApprovalStatus,
} from "@prisma/client";

/**
 * Sales DTOs (PRD #17 §200–§206).
 *
 * Every monetary field is a decimal string, never a number: the moment a value
 * becomes a JavaScript float it stops being the value (PRD #17 §206). The same
 * is true of a probability, which is stored to two places.
 *
 * `capabilities` is a UX hint and never a security decision — the service
 * re-checks every one of them before it acts (PRD #7 §55).
 */

export type ClientRef = { id: string; name: string };
export type ProjectRef = { id: string; code: string; name: string };
export type MemberRef = { memberId: string; fullName: string; active: boolean };
export type ContactRef = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
};

/* -------------------------------------------------------------------------- */
/* Leads                                                                       */
/* -------------------------------------------------------------------------- */

export type LeadSummaryDTO = {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  status: LeadStatus;
  owner: MemberRef | null;
  estimatedValue: string | null;
  currency: string | null;
  updatedAt: string;
};

export type LeadCapabilities = {
  canEdit: boolean;
  canAssign: boolean;
  canQualify: boolean;
  canDisqualify: boolean;
  canMarkContacted: boolean;
  canConvert: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canViewActivity: boolean;
  canViewDocuments: boolean;
};

export type LeadDetailDTO = LeadSummaryDTO & {
  website: string | null;
  notes: string | null;
  disqualifyReason: string | null;
  convertedAt: string | null;
  convertedOpportunity: { id: string; name: string } | null;
  convertedClient: ClientRef | null;
  archivedAt: string | null;
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: LeadCapabilities;
};

/** A soft warning, never a block (PRD #17 §44). */
export type LeadDuplicateMatch = {
  kind: "LEAD" | "CLIENT";
  id: string;
  label: string;
  reason: string;
};

/* -------------------------------------------------------------------------- */
/* Opportunities                                                               */
/* -------------------------------------------------------------------------- */

export type OpportunitySummaryDTO = {
  id: string;
  name: string;
  client: ClientRef | null;
  owner: MemberRef;
  stage: OpportunityStage;
  estimatedValue: string;
  currency: string;
  /** The effective probability: the override if set, else the stage default. */
  probability: string;
  probabilityIsOverride: boolean;
  weightedValue: string;
  expectedCloseDate: string | null;
  nextStep: string | null;
  /** Derived at read time, never stored (PRD #17 §405). */
  expectedCloseOverdue: boolean;
  updatedAt: string;
};

export type OpportunityCapabilities = {
  canEdit: boolean;
  canAssign: boolean;
  canChangeStage: boolean;
  canMarkWon: boolean;
  canMarkLost: boolean;
  canReopen: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canCreateProposal: boolean;
  canLinkProject: boolean;
  canViewActivity: boolean;
  canViewDocuments: boolean;
  canViewTasks: boolean;
};

export type OpportunityDetailDTO = OpportunitySummaryDTO & {
  contact: ContactRef | null;
  description: string | null;
  actualCloseDate: string | null;
  stageChangedAt: string;
  sourceLead: { id: string; name: string } | null;
  convertedProject: ProjectRef | null;
  wonReason: string | null;
  lostReason: LostReason | null;
  lostNote: string | null;
  archivedAt: string | null;
  proposalCount: number;
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: OpportunityCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Proposals                                                                   */
/* -------------------------------------------------------------------------- */

export type ProposalLineDTO = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  sortOrder: number;
};

export type ProposalSummaryDTO = {
  id: string;
  proposalNumber: string;
  title: string;
  opportunity: { id: string; name: string; stage: OpportunityStage };
  client: ClientRef;
  currency: string;
  totalAmount: string;
  validUntil: string | null;
  status: ProposalStatus;
  expiry: "NONE" | "EXPIRING_SOON" | "EXPIRED";
  updatedAt: string;
};

export type ProposalCapabilities = {
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canMarkSent: boolean;
  canAccept: boolean;
  canDecline: boolean;
  canCancel: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canViewActivity: boolean;
  canViewDocuments: boolean;
};

export type ProposalDetailDTO = ProposalSummaryDTO & {
  subtotal: string;
  taxAmount: string;
  notes: string | null;
  lineItems: ProposalLineDTO[];
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  archivedAt: string | null;
  approvals: SalesApprovalDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: ProposalCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Approvals                                                                   */
/* -------------------------------------------------------------------------- */

export type SalesApprovalDTO = {
  id: string;
  recordType: SalesApprovalRecordType;
  recordId: string;
  recordReference: string;
  recordTitle: string;
  currency: string | null;
  amount: string | null;
  status: SalesApprovalStatus;
  submittedBy: MemberRef | null;
  submittedAt: string;
  decidedBy: MemberRef | null;
  decidedAt: string | null;
  decisionNote: string | null;
  capabilities: { canApprove: boolean; canReject: boolean };
};

/* -------------------------------------------------------------------------- */
/* Pipeline, overview and reports                                              */
/* -------------------------------------------------------------------------- */

/**
 * Money is grouped by currency and never summed across them (PRD #17 §31, §172).
 *
 * V0.1 has no FX engine, so "€400,000 + $200,000 = 600,000" is not a number
 * this product is allowed to print.
 */
export type CurrencyTotal = {
  currency: string;
  count: number;
  value: string;
  weightedValue: string;
};

export type PipelineStageBucket = {
  stage: OpportunityStage;
  count: number;
  probability: string;
  totals: CurrencyTotal[];
  opportunities: OpportunitySummaryDTO[];
};

export type SalesOverviewDTO = {
  visible: {
    leads: boolean;
    opportunities: boolean;
    proposals: boolean;
    approvals: boolean;
  };
  /** Open pipeline, grouped by currency (PRD #17 §21, §412). */
  openPipeline: CurrencyTotal[];
  openOpportunities: number;
  newLeadsThisMonth: number;
  qualifiedLeads: number;
  expectedCloseThisMonth: CurrencyTotal[];
  wonThisMonth: CurrencyTotal[];
  lostThisMonth: CurrencyTotal[];
  pendingProposalApprovals: number;
  /** Win rate over closed deals in the period, or null when none closed. */
  winRate: string | null;
};

export type SalesAttentionDTO = {
  overdueClose: OpportunitySummaryDTO[];
  noNextStep: OpportunitySummaryDTO[];
  qualifiedLeads: LeadSummaryDTO[];
  expiringProposals: ProposalSummaryDTO[];
  inactiveOwners: OpportunitySummaryDTO[];
};

export type SalesActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  actorMemberId: string | null;
  createdAt: string;
};

export type OwnerPerformanceRow = {
  owner: MemberRef;
  currency: string;
  openCount: number;
  openValue: string;
  weightedValue: string;
  wonCount: number;
  wonValue: string;
  lostCount: number;
  lostValue: string;
  winRate: string | null;
};

export type ForecastBucket = {
  key: string;
  label: string;
  totals: CurrencyTotal[];
};

export type LostReasonRow = {
  reason: LostReason;
  currency: string;
  count: number;
  value: string;
};

export type LeadConversionRow = {
  totalCreated: number;
  converted: number;
  qualified: number;
  disqualified: number;
  conversionRate: string | null;
};

export type ProposalReportRow = {
  currency: string;
  counts: Record<ProposalStatus, number>;
  acceptedValue: string;
  sentValue: string;
  acceptanceRate: string | null;
};
