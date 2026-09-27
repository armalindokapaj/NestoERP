import type { PersonRef } from "@/components/people/person-link";

/**
 * The Unified Approvals Center's shapes (PRD #41 §13-§16, §54).
 *
 * Normalised enough to list and review side by side, never so flat that a
 * purchase order and a leave request read the same: each provider fills the
 * summary with its own facts (§17). Everything here is plain data — safe to
 * hand to the browser, and nothing in it is trusted when it comes back.
 */

export const APPROVAL_TABS = ["waiting", "requested", "approved", "rejected", "returned", "history"] as const;
export type ApprovalTab = (typeof APPROVAL_TABS)[number];

export const TAB_LABELS: Record<ApprovalTab, string> = {
  waiting: "Waiting for me",
  requested: "Requested by me",
  approved: "Approved",
  rejected: "Rejected",
  returned: "Returned",
  history: "All history",
};

export const UNIFIED_APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "RETURNED", "CANCELLED", "EXPIRED"] as const;
export type UnifiedApprovalStatus = (typeof UNIFIED_APPROVAL_STATUSES)[number];

export const STATUS_LABELS: Record<UnifiedApprovalStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

/** Presentation and attention only — never a business outcome (§15). */
export const APPROVAL_PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export type ApprovalPriority = (typeof APPROVAL_PRIORITIES)[number];

export const DUE_STATES = ["overdue", "due_today", "due_soon", "later", "none"] as const;
export type DueState = (typeof DUE_STATES)[number];

export const DUE_STATE_LABELS: Record<DueState, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  due_soon: "Due within 3 days",
  later: "Due later",
  none: "No due date",
};

export const APPROVAL_SORTS = ["urgency", "newest", "oldest", "due", "amount"] as const;
export type ApprovalSort = (typeof APPROVAL_SORTS)[number];

export const PROVIDER_KEYS = ["finance", "procurement", "hr", "sales", "legal", "documents", "qaqc", "hse", "timesheets", "projects", "unit_sales"] as const;
export type ApprovalProviderKey = (typeof PROVIDER_KEYS)[number];

export type ApprovalMoney = { value: string; currency: string };
export type ApprovalPerson = { memberId: string; name: string };

/** The company an approval belongs to, on a list read in the Group workspace (Workspace Context §45). */
export type ApprovalCompany = { id: string; name: string };

export type UnifiedApprovalItem = {
  /** `${providerKey}:${approvalId}` — the Center's own reference (§197). */
  id: string;
  providerKey: ApprovalProviderKey;
  /** The record registry type of the record being decided. */
  sourceType: string;
  sourceId: string;
  /** The owning module's approval row: one cycle (§52). */
  approvalId: string;

  /** "Purchase order", "Leave request" — the small label above the title (§77). */
  sourceLabel: string;
  title: string;
  subtitle: string | null;
  reference: string | null;

  status: UnifiedApprovalStatus;
  priority: ApprovalPriority;

  amount: ApprovalMoney | null;
  project: { id: string; name: string; code: string | null } | null;
  requester: ApprovalPerson;

  requestedAt: string;
  /** A real deadline from the source, or null — never invented (§37). */
  dueAt: string | null;
  decidedAt: string | null;
  decidedBy: ApprovalPerson | null;

  /** Where a chain stands: step 2 of 3, "Finance" (§108). */
  currentStep: number | null;
  totalSteps: number | null;
  stepLabel: string | null;

  /** The source record's own page (§110). */
  href: string;

  canApprove: boolean;
  canReject: boolean;
  canReturn: boolean;
  /** Approve asks for an explicit second press (§84, §85). */
  requiresStrongConfirmation: boolean;
  /** Why this reader cannot act, when they can see it but not decide it. */
  blockedReason: string | null;
  /** When acting would be on somebody's behalf, under a delegation (§33). */
  onBehalfOf: ApprovalPerson | null;

  /** Moves when the cycle does — a step decided, a resubmission (§121). */
  version: number;

  /** Computed by the Center from dueAt and priority. */
  dueState: DueState;
  urgency: number;
  /** The date the current tab orders by. */
  sortAt: string;

  /** Group workspace only: which company's approval this is, so no row reads like another company's (§45). */
  company?: ApprovalCompany;
};

export type ApprovalSummaryField = {
  label: string;
  value: string;
  emphasis?: "normal" | "strong" | "warning";
  /** The value names a person: it links to their profile (E-08 §71). */
  person?: PersonRef;
};

export type ApprovalWarning = { code: string; message: string; severity: "INFO" | "WARNING" | "CRITICAL" };

export type UnifiedApprovalDocumentRef = {
  id: string;
  name: string;
  fileName: string | null;
  extension: string | null;
  sizeLabel: string | null;
  versionNumber: number | null;
  uploadedAt: string | null;
  href: string;
  previewable: boolean;
};

export type UnifiedApprovalHistoryEntry = {
  id: string;
  action: string;
  actorName: string | null;
  actorRole: string | null;
  /** Who acted, and whom they stood in for, when a member did (E-08 §71). */
  actor: ApprovalPerson | null;
  onBehalfOf: ApprovalPerson | null;
  occurredAt: string;
  note: string | null;
  step: number | null;
  tone: "neutral" | "success" | "danger" | "warning" | "info";
};

export type ApprovalStepDTO = {
  number: number;
  label: string;
  status: "PENDING" | "WAITING" | "APPROVED" | "REJECTED" | "RETURNED" | "SKIPPED" | "CANCELLED";
  decidedBy: string | null;
  decidedAt: string | null;
  onBehalfOf: string | null;
  decidedByMemberId: string | null;
  onBehalfOfMemberId: string | null;
  /** The step is one person — a document's reviewer — rather than a role. */
  labelMemberId: string | null;
};

export type UnifiedApprovalDetail = {
  item: UnifiedApprovalItem;
  /** "Why approval is needed" (§81). */
  reason: string | null;
  summary: ApprovalSummaryField[];
  description: string | null;
  warnings: ApprovalWarning[];
  documents: UnifiedApprovalDocumentRef[];
  /** Null when the reader may not see files on this record at all. */
  documentsAvailable: boolean;
  history: UnifiedApprovalHistoryEntry[];
  /** SINGLE, a sequential chain, or reviewers deciding in parallel (§20-§22). */
  chainMode: "SINGLE" | "SEQUENTIAL" | "PARALLEL";
  /** Parallel: every reviewer must approve; any rejection rejects (§22). */
  completionRule: "ALL" | "ANY" | null;
  steps: ApprovalStepDTO[];
  commentsEnabled: boolean;
  discussion: { parentType: string; parentId: string } | null;
  sourceRecord: { label: string; href: string };
};

export type ApprovalDecision = "APPROVE" | "REJECT" | "RETURN";
export type ApprovalDecisionOutcome = "APPROVED" | "REJECTED" | "RETURNED" | "STEP_APPROVED";

export type ApprovalDecisionResult = {
  outcome: ApprovalDecisionOutcome;
  /** A retried or repeated request found the decision already made by this person (§124). */
  alreadyApplied: boolean;
  item: UnifiedApprovalItem | null;
};

export type ApprovalCounts = {
  waiting: number;
  overdue: number;
  critical: number;
  /** A source reached its window, so there are at least this many (§251, §253). */
  capped: boolean;
  /**
   * Some source could not be read, so these figures are what the others said and
   * the real total is unknown — never "0 waiting" or "all caught up" (AUD-10 §4,
   * CW-03). Always false when `unavailable` is empty.
   */
  partial: boolean;
  /** The sources missing from these figures, named (and, in the group, by company). */
  unavailable: ApprovalProviderSummary[];
  /**
   * Group workspace only: the same three figures per company the person may
   * read approvals in, by company name — "ARLIS 7 · IDEAL 4 · UNICO 6" (§33).
   * The totals above are exactly the sum of these.
   */
  byCompany?: ApprovalCompanyCounts[];
};

/** One company's figures; `partial` when one of its sources could not be read (AUD-10 §4). */
export type ApprovalCompanyCounts = { company: ApprovalCompany; waiting: number; overdue: number; critical: number; capped: boolean; partial: boolean };

/** A source of approvals; in the Group workspace also the company whose copy of it could not be read. */
export type ApprovalProviderSummary = { key: ApprovalProviderKey; label: string; moduleKey: string; company?: ApprovalCompany };

export type ApprovalQueueResult = {
  items: UnifiedApprovalItem[];
  nextCursor: string | null;
  counts: ApprovalCounts;
  /** Sources that could not be read this time; their items and counts are absent, not guessed (§130, §201). */
  failedProviders: ApprovalProviderSummary[];
  /** Whether the list was cut at the per-source window, so older items need a narrower filter (§253). */
  windowed: boolean;
  providers: ApprovalProviderSummary[];
  canViewHistory: boolean;
  canManageDelegation: boolean;
  /**
   * Group workspace only: the companies whose approvals this person may read,
   * by name — the choices of the Company filter, derived from their access and
   * never from the request (§57, §87). Absent in a company workspace.
   */
  companies?: ApprovalCompany[];
};

export type ApprovalDelegationDTO = {
  id: string;
  from: ApprovalPerson;
  to: ApprovalPerson;
  providerKey: ApprovalProviderKey | null;
  providerLabel: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  state: "ACTIVE" | "UPCOMING" | "ENDED" | "REVOKED";
  canRevoke: boolean;
};
