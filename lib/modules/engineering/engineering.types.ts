/**
 * Engineering vocabulary and DTOs (PRD #46 §59-§124, §159, §165-§172).
 *
 * Client-safe: no database, no server imports. The labels here are what every
 * register, badge, filter and notification says, so the words stay the same
 * wherever a record appears.
 */

export const DISCIPLINES = [
  "GENERAL",
  "ARCHITECTURE",
  "STRUCTURAL",
  "CIVIL",
  "MECHANICAL",
  "ELECTRICAL",
  "PLUMBING",
  "FIRE_PROTECTION",
  "FACADE",
  "INTERIORS",
  "LANDSCAPE",
  "INFRASTRUCTURE",
  "OTHER",
] as const;
export type Discipline = (typeof DISCIPLINES)[number];
export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  GENERAL: "General",
  ARCHITECTURE: "Architecture",
  STRUCTURAL: "Structural",
  CIVIL: "Civil",
  MECHANICAL: "Mechanical",
  ELECTRICAL: "Electrical",
  PLUMBING: "Plumbing",
  FIRE_PROTECTION: "Fire protection",
  FACADE: "Façade",
  INTERIORS: "Interiors",
  LANDSCAPE: "Landscape",
  INFRASTRUCTURE: "Infrastructure",
  OTHER: "Other",
};

/* Engineering documents ---------------------------------------------------- */

export const DOCUMENT_TYPES = [
  "DRAWING",
  "SHOP_DRAWING",
  "SPECIFICATION",
  "CALCULATION",
  "METHOD_STATEMENT",
  "MATERIAL_SUBMITTAL",
  "PRODUCT_DATA",
  "AS_BUILT",
  "TECHNICAL_REPORT",
  "SAMPLE",
  "OTHER",
] as const;
export type EngineeringDocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABELS: Record<EngineeringDocumentType, string> = {
  DRAWING: "Drawing",
  SHOP_DRAWING: "Shop drawing",
  SPECIFICATION: "Specification",
  CALCULATION: "Calculation",
  METHOD_STATEMENT: "Method statement",
  MATERIAL_SUBMITTAL: "Material submittal",
  PRODUCT_DATA: "Product data",
  AS_BUILT: "As-built",
  TECHNICAL_REPORT: "Technical report",
  SAMPLE: "Sample",
  OTHER: "Other",
};
/** The drawing register is the document register narrowed to these (§76). */
export const DRAWING_TYPES: EngineeringDocumentType[] = ["DRAWING", "SHOP_DRAWING"];

export const DOCUMENT_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "APPROVED_WITH_COMMENTS", "REVISION_REQUIRED", "REJECTED", "SUPERSEDED", "VOID"] as const;
export type EngineeringDocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  APPROVED_WITH_COMMENTS: "Approved with comments",
  REVISION_REQUIRED: "Revision required",
  REJECTED: "Rejected",
  SUPERSEDED: "Superseded",
  CLOSED: "Closed",
  VOID: "Void",
  FINALIZED: "Reviewed",
};

export const REVISION_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "FINALIZED", "SUPERSEDED", "VOID"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const REVIEW_DECISIONS = ["APPROVED", "APPROVED_WITH_COMMENTS", "REVISION_REQUIRED", "REJECTED"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = {
  APPROVED: "Approved",
  APPROVED_WITH_COMMENTS: "Approved with comments",
  REVISION_REQUIRED: "Revision required",
  REJECTED: "Rejected",
};
/** Decisions that need the approve grant on top of the review grant (§172). */
export const APPROVING_DECISIONS: ReviewDecision[] = ["APPROVED", "APPROVED_WITH_COMMENTS"];

/* RFIs --------------------------------------------------------------------- */

export const RFI_STATUSES = ["DRAFT", "OPEN", "ANSWERED", "CLARIFICATION_REQUIRED", "CLOSED", "VOID"] as const;
export type RfiStatus = (typeof RFI_STATUSES)[number];
export const RFI_STATUS_LABELS: Record<RfiStatus, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  ANSWERED: "Answered",
  CLARIFICATION_REQUIRED: "Clarification required",
  CLOSED: "Closed",
  VOID: "Void",
};
/** Still waiting on somebody: the RFIs a register counts as open (§159). */
export const RFI_OPEN_STATUSES: RfiStatus[] = ["OPEN", "ANSWERED", "CLARIFICATION_REQUIRED"];
/** Waiting on the assignee's answer — the only states a due date presses on (§95). */
export const RFI_AWAITING_RESPONSE: RfiStatus[] = ["OPEN", "CLARIFICATION_REQUIRED"];

export const RFI_PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export type RfiPriority = (typeof RFI_PRIORITIES)[number];
export const RFI_PRIORITY_LABELS: Record<RfiPriority, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", CRITICAL: "Critical" };

export const RFI_REFERENCE_TYPES = ["ENGINEERING_DOCUMENT", "DRAWING", "SUBMITTAL", "MEETING", "DAILY_LOG", "TASK", "DOCUMENT", "CONTRACT", "OTHER"] as const;
export type RfiReferenceType = (typeof RFI_REFERENCE_TYPES)[number];
export const RFI_REFERENCE_LABELS: Record<RfiReferenceType, string> = {
  ENGINEERING_DOCUMENT: "Engineering document",
  DRAWING: "Drawing",
  SUBMITTAL: "Submittal",
  MEETING: "Meeting",
  DAILY_LOG: "Daily log",
  TASK: "Task",
  DOCUMENT: "Document",
  CONTRACT: "Contract",
  OTHER: "Other",
};

/* Submittals --------------------------------------------------------------- */

export const SUBMITTAL_TYPES = ["SHOP_DRAWING", "MATERIAL_SUBMITTAL", "METHOD_STATEMENT", "TECHNICAL_SUBMITTAL", "SAMPLE", "PRODUCT_DATA", "CALCULATION", "OTHER"] as const;
export type SubmittalType = (typeof SUBMITTAL_TYPES)[number];
export const SUBMITTAL_TYPE_LABELS: Record<SubmittalType, string> = {
  SHOP_DRAWING: "Shop drawing",
  MATERIAL_SUBMITTAL: "Material submittal",
  METHOD_STATEMENT: "Method statement",
  TECHNICAL_SUBMITTAL: "Technical submittal",
  SAMPLE: "Sample",
  PRODUCT_DATA: "Product data",
  CALCULATION: "Calculation",
  OTHER: "Other",
};

export const SUBMITTAL_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "APPROVED_WITH_COMMENTS", "REVISION_REQUIRED", "REJECTED", "CLOSED", "VOID"] as const;
export type SubmittalStatus = (typeof SUBMITTAL_STATUSES)[number];
/** With the reviewer (§159 "Submittals Under Review"). */
export const SUBMITTAL_IN_REVIEW: SubmittalStatus[] = ["SUBMITTED", "UNDER_REVIEW"];
export const SUBMITTAL_CLOSED: SubmittalStatus[] = ["CLOSED", "VOID"];

/* Transmittals ------------------------------------------------------------- */

export const TRANSMITTAL_DIRECTIONS = ["OUTGOING", "INCOMING", "INTERNAL"] as const;
export type TransmittalDirection = (typeof TRANSMITTAL_DIRECTIONS)[number];
export const TRANSMITTAL_DIRECTION_LABELS: Record<TransmittalDirection, string> = { OUTGOING: "Outgoing", INCOMING: "Incoming", INTERNAL: "Internal" };

export const TRANSMITTAL_PURPOSES = ["FOR_INFORMATION", "FOR_REVIEW", "FOR_APPROVAL", "FOR_CONSTRUCTION", "AS_BUILT", "OTHER"] as const;
export type TransmittalPurpose = (typeof TRANSMITTAL_PURPOSES)[number];
export const TRANSMITTAL_PURPOSE_LABELS: Record<TransmittalPurpose, string> = {
  FOR_INFORMATION: "For information",
  FOR_REVIEW: "For review",
  FOR_APPROVAL: "For approval",
  FOR_CONSTRUCTION: "For construction",
  AS_BUILT: "As-built",
  OTHER: "Other",
};

export const TRANSMITTAL_STATUSES = ["DRAFT", "ISSUED", "VOID"] as const;
export type TransmittalStatus = (typeof TRANSMITTAL_STATUSES)[number];
export const TRANSMITTAL_STATUS_LABELS: Record<TransmittalStatus, string> = { DRAFT: "Draft", ISSUED: "Issued", VOID: "Void" };

export const SHARING_CLASSIFICATIONS = ["INTERNAL_ONLY", "EXTERNAL_SHAREABLE", "EXTERNAL_SHARED", "CONTRACTOR_SUBMITTED"] as const;
export type SharingClassification = (typeof SHARING_CLASSIFICATIONS)[number];
export const SHARING_LABELS: Record<SharingClassification, string> = {
  INTERNAL_ONLY: "Internal only",
  EXTERNAL_SHAREABLE: "Shareable later",
  EXTERNAL_SHARED: "Shared externally",
  CONTRACTOR_SUBMITTED: "Contractor submitted",
};

/* Links -------------------------------------------------------------------- */

/**
 * Records an engineering record or work package may point at (PRD #46 §111-§113,
 * §133-§155). Each is referenced through an integration link and read through
 * its own module's door — linking changes nothing on the other record.
 */
export const LINKABLE_TYPES = [
  "engineering_document",
  "technical_submittal",
  "task",
  "meeting",
  "daily_log",
  "quality_inspection",
  "quality_defect",
  "non_conformance_report",
  "incident",
  "hazard",
  "risk_assessment",
  "work_permit",
  "toolbox_talk",
  "purchase_order",
  "obligation",
  "amendment",
] as const;
export type LinkableType = (typeof LINKABLE_TYPES)[number];
export const LINKABLE_LABELS: Record<LinkableType, string> = {
  engineering_document: "Engineering document",
  technical_submittal: "Submittal",
  task: "Task",
  meeting: "Meeting",
  daily_log: "Daily log",
  quality_inspection: "QA/QC inspection",
  quality_defect: "Defect",
  non_conformance_report: "NCR",
  incident: "Incident",
  hazard: "Hazard",
  risk_assessment: "Risk assessment",
  work_permit: "Work permit",
  toolbox_talk: "Toolbox talk",
  purchase_order: "Purchase order",
  obligation: "Contract obligation",
  amendment: "Contract amendment",
};
export const LINK_GROUPS: Array<{ label: string; types: LinkableType[] }> = [
  { label: "Engineering", types: ["engineering_document", "technical_submittal"] },
  { label: "Work", types: ["task", "meeting", "daily_log"] },
  { label: "Quality", types: ["quality_inspection", "quality_defect", "non_conformance_report"] },
  { label: "Safety", types: ["incident", "hazard", "risk_assessment", "work_permit", "toolbox_talk"] },
  { label: "Commercial", types: ["purchase_order", "obligation", "amendment"] },
];

/* DTOs --------------------------------------------------------------------- */

export type Option = { id: string; label: string };
export type PersonRef = { id: string; name: string };
export type RecordRef = { id: string; label: string; href: string };

export type RevisionDTO = {
  id: string;
  revisionCode: string;
  revisionNumber: number | null;
  status: RevisionStatus;
  notes: string | null;
  file: { documentId: string; name: string; href: string; versionNumber: number | null; sharing: SharingClassification } | null;
  submittedAt: string | null;
  submittedBy: PersonRef | null;
  reviewStartedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: PersonRef | null;
  decision: ReviewDecision | null;
  /** Shown to readers of the record; never written to logs or audit (§233). */
  reviewComment: string | null;
  supersededAt: string | null;
  current: boolean;
  createdAt: string;
};

export type RevisionCapabilities = {
  canSubmit: boolean;
  canStartReview: boolean;
  canReview: boolean;
  /** The decisions this reader may record on the revision in front of them. */
  decisions: ReviewDecision[];
  /** Why the decision bar is not offered, when it is not (self-review, not assigned). */
  reviewBlockedReason: string | null;
  canVoid: boolean;
};

export type LinkedRecordDTO = { linkId: string; type: LinkableType; typeLabel: string; id: string; label: string; href: string };

export type EngineeringDocumentRowDTO = {
  id: string;
  projectId: string;
  projectName: string;
  documentNumber: string;
  title: string;
  documentType: EngineeringDocumentType;
  discipline: Discipline;
  status: EngineeringDocumentStatus;
  contractor: RecordRef | null;
  workPackage: RecordRef | null;
  currentRevision: { code: string; status: RevisionStatus; submittedAt: string | null } | null;
  revisionCount: number;
  reviewer: PersonRef | null;
  reviewDueAt: string | null;
  overdue: boolean;
  href: string;
};

export type EngineeringDocumentDetailDTO = EngineeringDocumentRowDTO & {
  authorText: string | null;
  responsible: PersonRef | null;
  voidReason: string | null;
  revisions: RevisionDTO[];
  revisionCapabilities: Record<string, RevisionCapabilities>;
  linkedRfis: RecordRef[];
  linkedSubmittals: RecordRef[];
  linkedTransmittals: RecordRef[];
  links: LinkedRecordDTO[];
  version: number;
  capabilities: {
    canEdit: boolean;
    canAddRevision: boolean;
    canVoid: boolean;
    canLink: boolean;
    canCreateTask: boolean;
    canViewFiles: boolean;
    canUploadFiles: boolean;
  };
};

export type RfiRowDTO = {
  id: string;
  projectId: string;
  projectName: string;
  rfiNumber: string;
  subject: string;
  status: RfiStatus;
  priority: RfiPriority;
  discipline: Discipline | null;
  contractor: RecordRef | null;
  workPackage: RecordRef | null;
  assignee: PersonRef | null;
  dueAt: string | null;
  overdue: boolean;
  /** Days since it was opened, or since it was drafted when never opened (§167). */
  ageDays: number;
  responseCount: number;
  href: string;
};

export type RfiResponseDTO = { id: string; text: string; by: PersonRef | null; at: string; final: boolean; clarificationRequest: boolean };

export type RfiReferenceDTO = { id: string; type: RfiReferenceType; typeLabel: string; label: string; href: string | null; note: string | null };

export type RfiDetailDTO = RfiRowDTO & {
  question: string;
  raisedByText: string | null;
  raisedBy: PersonRef | null;
  createdBy: PersonRef | null;
  openedAt: string | null;
  answeredAt: string | null;
  closedAt: string | null;
  closureNote: string | null;
  voidReason: string | null;
  responses: RfiResponseDTO[];
  references: RfiReferenceDTO[];
  tasks: Array<RecordRef & { status: string }>;
  version: number;
  capabilities: {
    canEdit: boolean;
    canOpen: boolean;
    canRespond: boolean;
    canRequestClarification: boolean;
    canClose: boolean;
    canVoid: boolean;
    canReference: boolean;
    canCreateTask: boolean;
    canViewFiles: boolean;
    canUploadFiles: boolean;
  };
};

export type SubmittalRowDTO = {
  id: string;
  projectId: string;
  projectName: string;
  submittalNumber: string;
  title: string;
  submittalType: SubmittalType;
  discipline: Discipline | null;
  status: SubmittalStatus;
  contractor: RecordRef | null;
  workPackage: RecordRef | null;
  currentRevision: { code: string; status: RevisionStatus } | null;
  revisionCount: number;
  reviewer: PersonRef | null;
  dueAt: string | null;
  overdue: boolean;
  href: string;
};

export type SubmittalDetailDTO = SubmittalRowDTO & {
  description: string | null;
  specificationReference: string | null;
  manufacturer: string | null;
  productName: string | null;
  modelNumber: string | null;
  supplier: RecordRef | null;
  activity: string | null;
  workArea: string | null;
  voidReason: string | null;
  revisions: RevisionDTO[];
  revisionCapabilities: Record<string, RevisionCapabilities>;
  links: LinkedRecordDTO[];
  linkedRfis: RecordRef[];
  version: number;
  capabilities: {
    canEdit: boolean;
    canAddRevision: boolean;
    canClose: boolean;
    canVoid: boolean;
    canLink: boolean;
    canCreateTask: boolean;
    canViewFiles: boolean;
    canUploadFiles: boolean;
  };
};

export type TransmittalRowDTO = {
  id: string;
  projectId: string;
  projectName: string;
  transmittalNumber: string;
  subject: string | null;
  direction: TransmittalDirection;
  purpose: TransmittalPurpose;
  status: TransmittalStatus;
  contractor: RecordRef | null;
  workPackage: RecordRef | null;
  recipientText: string | null;
  issuedAt: string | null;
  itemCount: number;
  href: string;
};

export type TransmittalItemDTO = {
  id: string;
  document: { id: string; name: string; href: string } | null;
  engineeringDocument: RecordRef | null;
  revisionCode: string | null;
  versionNumber: number | null;
  remarks: string | null;
};

export type TransmittalDetailDTO = TransmittalRowDTO & {
  senderText: string | null;
  notes: string | null;
  issuedBy: PersonRef | null;
  voidReason: string | null;
  items: TransmittalItemDTO[];
  capabilities: { canEditDraft: boolean; canIssue: boolean; canVoid: boolean };
};

export type EngineeringOverviewDTO = {
  project: { id: string; name: string; code: string | null };
  counts: {
    openRfis: number;
    overdueRfis: number;
    submittalsInReview: number;
    revisionRequired: number;
    approvedThisWeek: number;
    drawingsAwaitingReview: number;
    complianceAlerts: number;
    overdueReviews: number;
  };
  attention: Array<{ id: string; kind: "rfi" | "submittal" | "document"; label: string; detail: string; href: string; tone: "danger" | "warning" | "neutral" }>;
  recentDecisions: Array<{ id: string; label: string; decision: ReviewDecision; at: string; href: string }>;
};
