import type {
  EnvironmentalCategory,
  EnvironmentalStatus,
  HseActionStatus,
  HseActionType,
  HseApprovalRecordType,
  HseApprovalStatus,
  HseChecklistResponseType,
  HseChecklistResult,
  HseHazardCategory,
  HseHazardStatus,
  HseIncidentStatus,
  HseIncidentType,
  HseInspectionResult,
  HseInspectionStatus,
  HseInspectionType,
  HsePermitStatus,
  HsePermitType,
  HsePriority,
  HseRiskAssessmentStatus,
  HseRiskLevel,
  HseSeverity,
  HseTemplateStatus,
  PpeCheckResult,
  StopWorkStatus,
  ToolboxAttendanceStatus,
  ToolboxTalkStatus,
} from "@prisma/client";

import type {
  ChecklistGap,
  HazardClosureGap,
  IncidentClosureGap,
  StopWorkReleaseGap,
} from "./hse.status";

/**
 * HSE DTOs (PRD #22 §264–§270).
 *
 * Risk crosses as the server computed it — score and level together, never as
 * two axis numbers the page is expected to multiply (PRD #22 §270). If the page
 * did the arithmetic, two places would define what CRITICAL means.
 *
 * `capabilities` is a UX hint and never a security decision: the service
 * re-checks each one before it acts (PRD #7 §55).
 *
 * Redaction here is absence. A reader who may not see an incident's injury
 * flags gets `injury: null`, not a row of falses (PRD #22 §22).
 */

export type MemberRef = { memberId: string; fullName: string; active: boolean };
export type ProjectRef = { id: string; code: string; name: string };
export type ModuleLinkRef = { id: string; label: string; href: string | null };

/** Score and level as the server derived them (PRD #22 §243, §270). */
export type RiskDTO = {
  likelihood: number;
  severity: number;
  score: number;
  level: HseRiskLevel;
};

/** Null on every axis when the controls have not been re-assessed (§71). */
export type ResidualRiskDTO = RiskDTO | null;

export type InjuryFlags = {
  injuryOccurred: boolean;
  firstAidRequired: boolean;
  medicalTreatmentRequired: boolean;
  lostTime: boolean;
  propertyDamage: boolean;
  environmentalImpact: boolean;
};

export type HseActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  createdAt: string;
};

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export type TemplateItemDTO = {
  id: string;
  code: string | null;
  label: string;
  description: string | null;
  responseType: HseChecklistResponseType;
  required: boolean;
  sortOrder: number;
  riskIfFailed: HseSeverity | null;
  requiresNoteOnFail: boolean;
};

export type TemplateSummaryDTO = {
  id: string;
  code: string;
  name: string;
  inspectionType: HseInspectionType;
  version: number;
  status: HseTemplateStatus;
  itemCount: number;
  /** How many inspections have used this version (§349). */
  usageCount: number;
  updatedAt: string;
};

export type TemplateCapabilities = {
  canEdit: boolean;
  canArchive: boolean;
  canRestore: boolean;
  /** True when editing would create a version rather than rewrite (§349). */
  wouldVersion: boolean;
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

export type ChecklistItemDTO = {
  id: string;
  code: string | null;
  label: string;
  description: string | null;
  responseType: HseChecklistResponseType;
  required: boolean;
  sortOrder: number;
  responseValue: string | null;
  result: HseChecklistResult | null;
  note: string | null;
  riskIfFailed: HseSeverity | null;
  requiresNoteOnFail: boolean;
};

export type InspectionSummaryDTO = {
  id: string;
  inspectionNumber: string;
  inspectionType: HseInspectionType;
  /** Where the record is (§37). */
  status: HseInspectionStatus;
  /** What was found (§38). Deliberately a separate column. */
  result: HseInspectionResult;
  project: ProjectRef | null;
  assignedInspector: MemberRef | null;
  scheduledDate: string | null;
  inspectionDate: string | null;
  locationText: string | null;
  failedItemCount: number;
  updatedAt: string;
};

export type InspectionCapabilities = {
  canEdit: boolean;
  canAssign: boolean;
  canStart: boolean;
  canExecute: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canClose: boolean;
  canCancel: boolean;
  canRaiseHazard: boolean;
  canRaiseAction: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type InspectionDetailDTO = InspectionSummaryDTO & {
  template: { id: string; code: string; name: string; version: number } | null;
  summary: string | null;
  decisionNote: string | null;
  executedBy: MemberRef | null;
  submittedAt: string | null;
  approvedBy: MemberRef | null;
  approvedAt: string | null;
  rejectedBy: MemberRef | null;
  rejectedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  checklistItems: ChecklistItemDTO[];
  /** What still blocks submission, so the page can name it (§51). */
  gaps: ChecklistGap[];
  allowedResults: HseInspectionResult[];
  hazards: HazardSummaryDTO[];
  actions: ActionSummaryDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: InspectionCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Hazards                                                                     */
/* -------------------------------------------------------------------------- */

export type HazardSummaryDTO = {
  id: string;
  hazardNumber: string;
  title: string;
  hazardCategory: HseHazardCategory;
  status: HseHazardStatus;
  risk: RiskDTO;
  residualRisk: ResidualRiskDTO;
  project: ProjectRef | null;
  assignedTo: MemberRef | null;
  observedAt: string;
  dueDate: string | null;
  overdue: boolean;
  updatedAt: string;
};

export type HazardCapabilities = {
  canEdit: boolean;
  canAssign: boolean;
  canAssess: boolean;
  canControl: boolean;
  canClose: boolean;
  canReopen: boolean;
  canCancel: boolean;
  canRaiseAction: boolean;
  canStopWork: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type HazardDetailDTO = HazardSummaryDTO & {
  description: string;
  locationText: string | null;
  immediateControl: string | null;
  controlMeasure: string | null;
  reportedBy: MemberRef | null;
  inspection: ModuleLinkRef | null;
  closedBy: MemberRef | null;
  closedAt: string | null;
  closureNote: string | null;
  cancelledAt: string | null;
  actions: ActionSummaryDTO[];
  stopWorks: StopWorkSummaryDTO[];
  /** What still stands between this hazard and its closure (§73). */
  closureGaps: HazardClosureGap[];
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: HazardCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

export type IncidentSummaryDTO = {
  id: string;
  incidentNumber: string;
  incidentType: HseIncidentType;
  title: string;
  severity: HseSeverity;
  status: HseIncidentStatus;
  project: ProjectRef | null;
  reportedBy: MemberRef | null;
  investigator: MemberRef | null;
  occurredAt: string;
  reportedAt: string;
  /** Null when the reader may not see them at all (§22). */
  injury: InjuryFlags | null;
  dueDate: string | null;
  overdue: boolean;
  updatedAt: string;
};

export type IncidentCapabilities = {
  canEdit: boolean;
  canAssign: boolean;
  canInvestigate: boolean;
  canSubmitClose: boolean;
  canClose: boolean;
  canReopen: boolean;
  canCancel: boolean;
  canRaiseAction: boolean;
  canStopWork: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type IncidentDetailDTO = IncidentSummaryDTO & {
  description: string;
  locationText: string | null;
  immediateAction: string | null;
  investigationSummary: string | null;
  rootCause: string | null;
  lessonsLearned: string | null;
  submittedForCloseAt: string | null;
  closedBy: MemberRef | null;
  closedAt: string | null;
  closureNote: string | null;
  cancelledAt: string | null;
  actions: ActionSummaryDTO[];
  stopWorks: StopWorkSummaryDTO[];
  /** What still stands between this incident and its closure (§95). */
  closureGaps: IncidentClosureGap[];
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: IncidentCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Risk assessments                                                            */
/* -------------------------------------------------------------------------- */

export type RiskAssessmentItemDTO = {
  id: string;
  hazardDescription: string;
  existingControls: string | null;
  risk: RiskDTO;
  additionalControls: string | null;
  residualRisk: ResidualRiskDTO;
  responsible: MemberRef | null;
  dueDate: string | null;
  sortOrder: number;
};

export type RiskAssessmentSummaryDTO = {
  id: string;
  assessmentNumber: string;
  title: string;
  version: number;
  status: HseRiskAssessmentStatus;
  project: ProjectRef | null;
  owner: MemberRef | null;
  assessmentDate: string;
  reviewDate: string | null;
  /** Approved and past its review date (§359). Nothing expires by itself. */
  reviewDue: boolean;
  /** The worst line on the assessment, which is what people rank them by. */
  highestRisk: HseRiskLevel | null;
  itemCount: number;
  updatedAt: string;
};

export type RiskAssessmentCapabilities = {
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canArchive: boolean;
  /** A material change makes a new version rather than an edit (§112). */
  canVersion: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type RiskAssessmentDetailDTO = RiskAssessmentSummaryDTO & {
  description: string | null;
  activityType: string | null;
  locationText: string | null;
  items: RiskAssessmentItemDTO[];
  submittedAt: string | null;
  approvedBy: MemberRef | null;
  approvedAt: string | null;
  archivedAt: string | null;
  actions: ActionSummaryDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: RiskAssessmentCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

/** Where an action came from, as a link the reader may actually follow. */
export type ActionSourceDTO = {
  kind:
    | "HAZARD"
    | "INCIDENT"
    | "INSPECTION"
    | "RISK_ASSESSMENT"
    | "ENVIRONMENTAL"
    | "STOP_WORK"
    | "PERMIT";
  id: string;
  label: string;
  href: string | null;
} | null;

export type ActionSummaryDTO = {
  id: string;
  actionNumber: string;
  actionType: HseActionType;
  title: string;
  priority: HsePriority;
  status: HseActionStatus;
  project: ProjectRef | null;
  assignedTo: MemberRef | null;
  source: ActionSourceDTO;
  dueDate: string | null;
  overdue: boolean;
  daysOverdue: number;
  updatedAt: string;
};

export type ActionCapabilities = {
  canEdit: boolean;
  canAssign: boolean;
  canComplete: boolean;
  canVerify: boolean;
  canReject: boolean;
  canReopen: boolean;
  canCancel: boolean;
  canCreateTask: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type ActionDetailDTO = ActionSummaryDTO & {
  description: string;
  completionNote: string | null;
  completedBy: MemberRef | null;
  completedAt: string | null;
  verificationNote: string | null;
  verifiedBy: MemberRef | null;
  verifiedAt: string | null;
  cancelledAt: string | null;
  /** The canonical Tasks raised to discharge it (§126, §128). */
  tasks: { id: string; title: string; status: string }[];
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: ActionCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Toolbox talks                                                               */
/* -------------------------------------------------------------------------- */

export type ToolboxParticipantDTO = {
  id: string;
  member: MemberRef | null;
  /** Subcontractors attend too, and are not members (§133). */
  externalName: string | null;
  attendanceStatus: ToolboxAttendanceStatus;
  signatureRecorded: boolean;
};

export type ToolboxSummaryDTO = {
  id: string;
  talkNumber: string;
  title: string;
  topic: string;
  status: ToolboxTalkStatus;
  project: ProjectRef | null;
  conductedBy: MemberRef | null;
  talkDate: string;
  locationText: string | null;
  attendedCount: number;
  participantCount: number;
  updatedAt: string;
};

export type ToolboxCapabilities = {
  canEdit: boolean;
  canComplete: boolean;
  canCancel: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type ToolboxDetailDTO = ToolboxSummaryDTO & {
  notes: string | null;
  participants: ToolboxParticipantDTO[];
  completedAt: string | null;
  cancelledAt: string | null;
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: ToolboxCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Work permits                                                                */
/* -------------------------------------------------------------------------- */

export type PermitSummaryDTO = {
  id: string;
  permitNumber: string;
  permitType: HsePermitType;
  title: string;
  /** What the column says. */
  status: HsePermitStatus;
  /** What the permit actually is, once the clock is read (§151, §360). */
  effectiveStatus: HsePermitStatus;
  project: ProjectRef;
  locationText: string;
  requestedBy: MemberRef | null;
  responsible: MemberRef | null;
  validFrom: string;
  validUntil: string;
  /** Hours until expiry; negative once it has passed (§211, §322). */
  hoursRemaining: number;
  updatedAt: string;
};

export type PermitCapabilities = {
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canActivate: boolean;
  canSuspend: boolean;
  canClose: boolean;
  canCancel: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type PermitDetailDTO = PermitSummaryDTO & {
  hazardsSummary: string | null;
  controlsSummary: string | null;
  ppeRequirements: string | null;
  specialConditions: string | null;
  suspensionReason: string | null;
  riskAssessment: ModuleLinkRef | null;
  submittedAt: string | null;
  approvedBy: MemberRef | null;
  approvedAt: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  actions: ActionSummaryDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: PermitCapabilities;
};

/* -------------------------------------------------------------------------- */
/* PPE checks                                                                  */
/* -------------------------------------------------------------------------- */

export type PpeCheckDTO = {
  id: string;
  checkNumber: string;
  project: ProjectRef | null;
  checkDate: string;
  locationText: string | null;
  checkedBy: MemberRef | null;
  subject: MemberRef | null;
  externalSubjectName: string | null;
  result: PpeCheckResult;
  /** Only the equipment the check actually spoke to (§159). */
  items: { key: string; label: string; ok: boolean }[];
  failedItems: string[];
  otherPpeNote: string | null;
  notes: string | null;
  createdAt: string;
};

/* -------------------------------------------------------------------------- */
/* Environmental observations                                                  */
/* -------------------------------------------------------------------------- */

export type ObservationSummaryDTO = {
  id: string;
  observationNumber: string;
  category: EnvironmentalCategory;
  title: string;
  severity: HseSeverity;
  status: EnvironmentalStatus;
  project: ProjectRef | null;
  reportedBy: MemberRef | null;
  assignedTo: MemberRef | null;
  observedAt: string;
  dueDate: string | null;
  overdue: boolean;
  updatedAt: string;
};

export type ObservationCapabilities = {
  canEdit: boolean;
  canAssign: boolean;
  canClose: boolean;
  canReopen: boolean;
  canRaiseAction: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
};

export type ObservationDetailDTO = ObservationSummaryDTO & {
  description: string;
  locationText: string | null;
  immediateAction: string | null;
  closedBy: MemberRef | null;
  closedAt: string | null;
  closureNote: string | null;
  cancelledAt: string | null;
  actions: ActionSummaryDTO[];
  createdBy: MemberRef | null;
  createdAt: string;
  capabilities: ObservationCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Stop work                                                                   */
/* -------------------------------------------------------------------------- */

export type StopWorkSummaryDTO = {
  id: string;
  stopWorkNumber: string;
  title: string;
  status: StopWorkStatus;
  project: ProjectRef;
  locationText: string | null;
  issuedBy: MemberRef | null;
  issuedAt: string;
  releasedBy: MemberRef | null;
  releasedAt: string | null;
  updatedAt: string;
};

export type StopWorkCapabilities = {
  canRelease: boolean;
  canCancel: boolean;
  canRaiseAction: boolean;
  canViewActivity: boolean;
};

export type StopWorkDetailDTO = StopWorkSummaryDTO & {
  reason: string;
  releaseReason: string | null;
  hazard: ModuleLinkRef | null;
  incident: ModuleLinkRef | null;
  actions: ActionSummaryDTO[];
  /** What still stands between this stop-work and a release (§174). */
  releaseGaps: StopWorkReleaseGap[];
  createdBy: MemberRef | null;
  createdAt: string;
  cancelledAt: string | null;
  capabilities: StopWorkCapabilities;
};

/* -------------------------------------------------------------------------- */
/* Approvals                                                                   */
/* -------------------------------------------------------------------------- */

export type ApprovalQueueItemDTO = {
  id: string;
  recordType: HseApprovalRecordType;
  recordId: string;
  reference: string;
  title: string;
  href: string | null;
  project: ProjectRef | null;
  /** Risk for a hazard-backed record, severity for an incident (§181). */
  riskLabel: string | null;
  status: HseApprovalStatus;
  submittedBy: MemberRef | null;
  submittedAt: string;
  decidedBy: MemberRef | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** False when the reader submitted it themselves (§182). */
  canDecide: boolean;
};

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

export type HseKpiDTO = { key: string; label: string; value: number; href: string };

export type HseAttentionDTO = {
  id: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM";
  title: string;
  detail: string;
  href: string;
};

export type HseOverviewDTO = {
  kpis: HseKpiDTO[];
  attention: HseAttentionDTO[];
  recentIncidents: IncidentSummaryDTO[];
  openCriticalHazards: HazardSummaryDTO[];
  activeStopWorks: StopWorkSummaryDTO[];
  expiringPermits: PermitSummaryDTO[];
};

export type ProjectHseSummaryDTO = {
  inspections: number;
  passRate: number | null;
  openHazards: number;
  criticalHazards: number;
  incidents: number;
  nearMisses: number;
  overdueActions: number;
  activePermits: number;
  stopWorkActive: number;
};
