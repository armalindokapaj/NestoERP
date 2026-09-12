import type {
  ChecklistItemResult,
  CorrectiveActionStatus,
  InspectionRequestStatus,
  InspectionResponseType,
  InspectionTemplateStatus,
  MaterialReleaseStatus,
  NCRCategory,
  NCRStatus,
  QualityApprovalRecordType,
  QualityApprovalStatus,
  QualityDefectStatus,
  QualityInspectionResult,
  QualityInspectionStatus,
  QualityInspectionType,
  QualityPriority,
  QualitySeverity,
} from "@prisma/client";

import type { NcrClosureGap } from "./qaqc.status";

/**
 * QA/QC DTOs (PRD #21 §22, §233).
 *
 * Quantities cross as decimal strings, never as JavaScript numbers: an accepted
 * quantity that a JSON parser has rounded is one that no longer balances
 * against the delivery it came from (PRD #21 §220).
 *
 * `capabilities` is a UX hint and never a security decision: the service
 * re-checks each one before it acts (PRD #7 §55).
 *
 * Redaction here is absence. A reader who may not see the Procurement delivery
 * behind a material inspection gets `source: null`, not a blanked-out label
 * (PRD #21 §231).
 */

export type MemberRef = { memberId: string; fullName: string; active: boolean };
export type ProjectRef = { id: string; code: string; name: string };
export type ModuleLinkRef = { id: string; label: string; href: string | null };

/* -------------------------------------------------------------------------- */
/* Inspection requests                                                         */
/* -------------------------------------------------------------------------- */

export type RequestSummaryDTO = {
  id: string;
  requestNumber: string;
  title: string;
  inspectionType: QualityInspectionType;
  status: InspectionRequestStatus;
  priority: QualityPriority;
  project: ProjectRef | null;
  requestedBy: MemberRef | null;
  assignedInspector: MemberRef | null;
  requestedDate: string;
  requiredByDate: string | null;
  /** True once the required-by date has passed and it is still open (§38). */
  overdue: boolean;
  inspectionCount: number;
  updatedAt: string;
};

export type RequestCapabilities = {
  canEdit: boolean;
  canAssign: boolean;
  canCancel: boolean;
  canStartInspection: boolean;
  canViewActivity: boolean;
};

export type RequestDetailDTO = RequestSummaryDTO & {
  description: string | null;
  locationText: string | null;
  /** Null when the reader cannot reach the delivery it is about (§231). */
  source: ModuleLinkRef | null;
  inspections: InspectionSummaryDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  cancelledAt: string | null;
  capabilities: RequestCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export type TemplateSummaryDTO = {
  id: string;
  code: string;
  name: string;
  inspectionType: QualityInspectionType;
  status: InspectionTemplateStatus;
  version: number;
  itemCount: number;
  /** How many inspections have been run against this version (§53). */
  usageCount: number;
  updatedAt: string;
};

export type TemplateItemDTO = {
  id: string;
  code: string | null;
  label: string;
  description: string | null;
  responseType: InspectionResponseType;
  required: boolean;
  sortOrder: number;
  passCriteriaText: string | null;
  requiresEvidenceOnFail: boolean;
};

export type TemplateCapabilities = {
  canEdit: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canUse: boolean;
};

export type TemplateDetailDTO = TemplateSummaryDTO & {
  description: string | null;
  items: TemplateItemDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  archivedAt: string | null;
  capabilities: TemplateCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

export type InspectionSummaryDTO = {
  id: string;
  inspectionNumber: string;
  inspectionType: QualityInspectionType;
  /** Where the record is (§65). */
  status: QualityInspectionStatus;
  /** What was found (§65). Deliberately a separate field. */
  result: QualityInspectionResult;
  project: ProjectRef | null;
  assignedInspector: MemberRef | null;
  inspectionDate: string | null;
  templateName: string | null;
  /** Set when this is a re-look at earlier work (§156). */
  reinspectionSequence: number | null;
  parentInspectionId: string | null;
  updatedAt: string;
};

export type ChecklistItemDTO = {
  id: string;
  code: string | null;
  label: string;
  description: string | null;
  responseType: InspectionResponseType;
  required: boolean;
  sortOrder: number;
  responseValue: string | null;
  result: ChecklistItemResult | null;
  note: string | null;
  passCriteriaText: string | null;
  requiresEvidenceOnFail: boolean;
};

export type InspectionCapabilities = {
  canEdit: boolean;
  canExecute: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canClose: boolean;
  canCancel: boolean;
  canRework: boolean;
  canReopen: boolean;
  canRecordMaterialDecision: boolean;
  canRelease: boolean;
  canRaiseReinspection: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type InspectionDetailDTO = InspectionSummaryDTO & {
  templateId: string | null;
  templateVersion: number | null;
  requestId: string | null;
  requestNumber: string | null;
  locationText: string | null;
  workReference: string | null;
  drawingReference: string | null;
  specificationReference: string | null;
  summary: string | null;
  decisionNote: string | null;
  source: ModuleLinkRef | null;
  checklist: ChecklistItemDTO[];
  /** What still stands between the inspector and submitting (§75). */
  blockers: string[];
  /** Which overall verdicts the answers actually allow (§77). */
  allowedResults: Exclude<QualityInspectionResult, "NOT_SET">[];
  materialDecisions: MaterialDecisionDTO[];
  release: MaterialReleaseDTO | null;
  defects: DefectSummaryDTO[];
  ncrs: NcrSummaryDTO[];
  correctiveActions: CorrectiveActionSummaryDTO[];
  reinspections: InspectionSummaryDTO[];
  executedBy: MemberRef | null;
  submittedAt: string | null;
  approvedBy: MemberRef | null;
  approvedAt: string | null;
  rejectedBy: MemberRef | null;
  rejectedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: InspectionCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Material decisions and release                                              */
/* -------------------------------------------------------------------------- */

export type MaterialDecisionDTO = {
  id: string;
  goodsReceiptItemId: string;
  /** Null when the reader cannot reach the delivery line (§231). */
  line: { description: string; receivedQuantity: string } | null;
  inspectedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  conditionalQuantity: string;
  unit: string;
  notes: string | null;
};

export type MaterialReleaseDTO = {
  id: string;
  goodsReceiptItemId: string;
  releasedQuantity: string;
  rejectedQuantity: string;
  heldQuantity: string;
  unit: string;
  status: MaterialReleaseStatus;
  releasedBy: MemberRef | null;
  releasedAt: string;
  revokedAt: string | null;
  revocationReason: string | null;
  notes: string | null;
  capabilities: { canRevoke: boolean };
};

/** What Inventory needs to know before it books a delivery in (PRD #21 §29). */
export type MaterialQualityStatusDTO = {
  goodsReceiptId: string;
  inspectionId: string | null;
  inspectionNumber: string | null;
  inspectionStatus: QualityInspectionStatus | null;
  result: QualityInspectionResult | null;
  releasedQuantity: string;
  rejectedQuantity: string;
  conditionalQuantity: string;
  heldQuantity: string;
  /** Whether Inventory may post against this delivery at all (§102). */
  clearedForPosting: boolean;
  blockedReason: string | null;
};

/* -------------------------------------------------------------------------- */
/* Defects                                                                     */
/* -------------------------------------------------------------------------- */

export type DefectSummaryDTO = {
  id: string;
  defectNumber: string;
  title: string;
  severity: QualitySeverity;
  status: QualityDefectStatus;
  project: ProjectRef;
  assignedTo: MemberRef | null;
  dueDate: string | null;
  overdue: boolean;
  updatedAt: string;
};

export type DefectCapabilities = {
  canEdit: boolean;
  canAssign: boolean;
  canResolve: boolean;
  canClose: boolean;
  canReopen: boolean;
  canCancel: boolean;
  canEscalate: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type DefectDetailDTO = DefectSummaryDTO & {
  description: string;
  locationText: string | null;
  inspection: { id: string; inspectionNumber: string } | null;
  resolutionNote: string | null;
  resolvedBy: MemberRef | null;
  resolvedAt: string | null;
  closedBy: MemberRef | null;
  closedAt: string | null;
  cancelledAt: string | null;
  ncrs: NcrSummaryDTO[];
  correctiveActions: CorrectiveActionSummaryDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: DefectCapabilities;
};

/* -------------------------------------------------------------------------- */
/* NCRs                                                                        */
/* -------------------------------------------------------------------------- */

export type NcrSummaryDTO = {
  id: string;
  ncrNumber: string;
  title: string;
  category: NCRCategory;
  severity: QualitySeverity;
  status: NCRStatus;
  project: ProjectRef | null;
  assignedTo: MemberRef | null;
  dueDate: string | null;
  overdue: boolean;
  openActions: number;
  updatedAt: string;
};

export type NcrCapabilities = {
  canEdit: boolean;
  canOpen: boolean;
  canAssign: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canClose: boolean;
  canReopen: boolean;
  canCancel: boolean;
  canAddAction: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type NcrDetailDTO = NcrSummaryDTO & {
  description: string;
  immediateAction: string | null;
  rootCause: string | null;
  correctiveActionSummary: string | null;
  closureNote: string | null;
  owner: MemberRef | null;
  inspection: { id: string; inspectionNumber: string } | null;
  sourceDefect: { id: string; defectNumber: string } | null;
  source: ModuleLinkRef | null;
  correctiveActions: CorrectiveActionSummaryDTO[];
  /** What still stands between this NCR and being closed (§136). */
  closureGaps: NcrClosureGap[];
  submittedAt: string | null;
  approvedBy: MemberRef | null;
  approvedAt: string | null;
  rejectedBy: MemberRef | null;
  rejectedAt: string | null;
  closedBy: MemberRef | null;
  closedAt: string | null;
  cancelledAt: string | null;
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: NcrCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Corrective actions                                                          */
/* -------------------------------------------------------------------------- */

export type CorrectiveActionSummaryDTO = {
  id: string;
  actionNumber: string;
  title: string;
  status: CorrectiveActionStatus;
  project: ProjectRef | null;
  assignedTo: MemberRef | null;
  dueDate: string | null;
  overdue: boolean;
  parent: { kind: "NCR" | "DEFECT" | "INSPECTION"; id: string; label: string } | null;
  updatedAt: string;
};

export type CorrectiveActionCapabilities = {
  canEdit: boolean;
  canAssign: boolean;
  canComplete: boolean;
  canVerify: boolean;
  canReopen: boolean;
  canCancel: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
  /** A task is somebody's to-do; the action is the formal record (§153). */
  canCreateTask: boolean;
};

export type CorrectiveActionDetailDTO = CorrectiveActionSummaryDTO & {
  description: string;
  completionNote: string | null;
  completedBy: MemberRef | null;
  completedAt: string | null;
  verificationNote: string | null;
  verifiedBy: MemberRef | null;
  verifiedAt: string | null;
  cancelledAt: string | null;
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: CorrectiveActionCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Approvals                                                                   */
/* -------------------------------------------------------------------------- */

export type QualityApprovalDTO = {
  id: string;
  recordType: QualityApprovalRecordType;
  recordId: string;
  recordNumber: string;
  recordTitle: string;
  status: QualityApprovalStatus;
  submittedBy: MemberRef | null;
  submittedAt: string;
  decidedBy: MemberRef | null;
  decidedAt: string | null;
  decisionNote: string | null;
  href: string;
  /** False for whoever submitted it: nobody approves their own (§165). */
  canDecide: boolean;
};

/* -------------------------------------------------------------------------- */
/* Overview and reports                                                        */
/* -------------------------------------------------------------------------- */

export type QaqcOverviewDTO = {
  visible: {
    requests: boolean;
    inspections: boolean;
    materials: boolean;
    defects: boolean;
    ncrs: boolean;
    actions: boolean;
    approvals: boolean;
  };
  openRequests: number;
  unassignedRequests: number;
  inspectionsInProgress: number;
  awaitingApproval: number;
  openDefects: number;
  criticalDefects: number;
  openNcrs: number;
  overdueNcrs: number;
  openActions: number;
  overdueActions: number;
  /** Null when there is nothing decided yet to compute a rate from (§193). */
  passRate: { passed: number; total: number; percent: number } | null;
};

export type QaqcAttentionDTO = {
  awaitingApproval: InspectionSummaryDTO[];
  overdueDefects: DefectSummaryDTO[];
  overdueNcrs: NcrSummaryDTO[];
  unassignedRequests: RequestSummaryDTO[];
};

export type PassRateRow = {
  label: string;
  passed: number;
  failed: number;
  conditional: number;
  total: number;
  percent: number | null;
};

export type AgingBucketRow = {
  label: string;
  count: number;
};

export type QaqcActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  createdAt: string;
};
