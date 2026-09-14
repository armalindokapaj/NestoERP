/**
 * Daily log shapes (PRD #43 §7, §15-§79).
 *
 * Plain data for the browser. A daily log is the project's record of one site
 * day; its sections are separate rows edited one at a time, and everything it
 * links to — tasks, deliveries, QA/QC and HSE records, documents — stays owned
 * by its own module.
 */

export const DAILY_LOG_STATUSES = ["DRAFT", "SUBMITTED", "REVIEWED", "LOCKED", "CORRECTION_REQUIRED", "VOID"] as const;
export type DailyLogStatus = (typeof DAILY_LOG_STATUSES)[number];

export const DAILY_LOG_STATUS_LABELS: Record<DailyLogStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  REVIEWED: "Reviewed",
  LOCKED: "Locked",
  CORRECTION_REQUIRED: "Correction required",
  VOID: "Void",
};

export const WEATHER_CONDITIONS = ["CLEAR", "PARTLY_CLOUDY", "CLOUDY", "RAIN", "HEAVY_RAIN", "SNOW", "WINDY", "FOG", "EXTREME_HEAT", "EXTREME_COLD", "OTHER"] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];
export const WEATHER_CONDITION_LABELS: Record<WeatherCondition, string> = {
  CLEAR: "Clear",
  PARTLY_CLOUDY: "Partly cloudy",
  CLOUDY: "Cloudy",
  RAIN: "Rain",
  HEAVY_RAIN: "Heavy rain",
  SNOW: "Snow",
  WINDY: "Windy",
  FOG: "Fog",
  EXTREME_HEAT: "Extreme heat",
  EXTREME_COLD: "Extreme cold",
  OTHER: "Other",
};

export const SITE_CONDITIONS = ["DRY", "WET", "MUDDY", "FLOODED", "RESTRICTED_ACCESS", "HIGH_WIND", "DUSTY", "OTHER"] as const;
export type SiteCondition = (typeof SITE_CONDITIONS)[number];
export const SITE_CONDITION_LABELS: Record<SiteCondition, string> = {
  DRY: "Dry",
  WET: "Wet",
  MUDDY: "Muddy",
  FLOODED: "Flooded",
  RESTRICTED_ACCESS: "Restricted access",
  HIGH_WIND: "High wind",
  DUSTY: "Dusty",
  OTHER: "Other",
};

export const EQUIPMENT_STATUSES = ["AVAILABLE", "IN_USE", "IDLE", "OUT_OF_SERVICE", "BREAKDOWN", "OTHER"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = {
  AVAILABLE: "Available",
  IN_USE: "In use",
  IDLE: "Idle",
  OUT_OF_SERVICE: "Out of service",
  BREAKDOWN: "Breakdown",
  OTHER: "Other",
};

export const DELAY_CATEGORIES = ["WEATHER", "LABOR", "MATERIAL", "EQUIPMENT", "DESIGN", "ACCESS", "INSPECTION", "CLIENT", "SUBCONTRACTOR", "UTILITY", "SAFETY", "QUALITY", "OTHER"] as const;
export type DelayCategory = (typeof DELAY_CATEGORIES)[number];
export const DELAY_CATEGORY_LABELS: Record<DelayCategory, string> = {
  WEATHER: "Weather",
  LABOR: "Labour",
  MATERIAL: "Material",
  EQUIPMENT: "Equipment",
  DESIGN: "Design",
  ACCESS: "Access",
  INSPECTION: "Inspection",
  CLIENT: "Client",
  SUBCONTRACTOR: "Subcontractor",
  UTILITY: "Utility",
  SAFETY: "Safety",
  QUALITY: "Quality",
  OTHER: "Other",
};

export const DELAY_IMPACTS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type DelayImpact = (typeof DELAY_IMPACTS)[number];
export const DELAY_IMPACT_LABELS: Record<DelayImpact, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

export const TASK_LINK_TYPES = ["RELATED", "CREATED_FROM_LOG", "FOLLOW_UP", "DELAY_ACTION", "INSTRUCTION_ACTION"] as const;
export type TaskLinkType = (typeof TASK_LINK_TYPES)[number];
export const TASK_LINK_TYPE_LABELS: Record<TaskLinkType, string> = {
  RELATED: "Related",
  CREATED_FROM_LOG: "Created from this log",
  FOLLOW_UP: "Follow-up",
  DELAY_ACTION: "Delay action",
  INSTRUCTION_ACTION: "Instruction action",
};

export const DOCUMENT_CATEGORIES = ["PHOTO", "DELIVERY_TICKET", "SKETCH", "REPORT", "INSTRUCTION", "OTHER"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  PHOTO: "Photo",
  DELIVERY_TICKET: "Delivery ticket",
  SKETCH: "Sketch",
  REPORT: "Report",
  INSTRUCTION: "Instruction",
  OTHER: "Other",
};

/** The editable sections of a log, each with its own grant (PRD #43 §126, §161). */
export const SECTION_KEYS = ["weather", "workforce", "activities", "equipment", "deliveries", "visitors", "delays", "instructions"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_LABELS: Record<SectionKey, string> = {
  weather: "Weather",
  workforce: "Workforce",
  activities: "Work completed",
  equipment: "Equipment",
  deliveries: "Deliveries",
  visitors: "Visitors",
  delays: "Delays",
  instructions: "Instructions",
};

export type DailyLogPerson = { memberId: string; name: string };
export type Ref = { id: string; label: string; href: string | null };

export type WeatherEntryDTO = {
  id: string;
  observedAt: string;
  temperatureC: number | null;
  condition: WeatherCondition | null;
  precipitationMm: number | null;
  windKph: number | null;
  humidityPct: number | null;
  notes: string | null;
  updatedAt: string;
};

export type WorkforceEntryDTO = {
  id: string;
  organizationName: string;
  supplier: Ref | null;
  contractor: Ref | null;
  workPackage: Ref | null;
  trade: string | null;
  crewName: string | null;
  headcount: number;
  notes: string | null;
  updatedAt: string;
};

export type WorkActivityDTO = {
  id: string;
  title: string;
  description: string | null;
  projectArea: string | null;
  floorZone: string | null;
  trade: string | null;
  progressPercent: number | null;
  task: Ref | null;
  contractor: Ref | null;
  workPackage: Ref | null;
  createdBy: DailyLogPerson | null;
  updatedAt: string;
};

export type EquipmentEntryDTO = {
  id: string;
  equipmentName: string;
  equipmentCode: string | null;
  supplier: Ref | null;
  quantity: number;
  hoursUsed: number | null;
  status: EquipmentStatus | null;
  notes: string | null;
  updatedAt: string;
};

export type DeliveryEntryDTO = {
  id: string;
  description: string;
  supplier: Ref | null;
  purchaseOrder: Ref | null;
  goodsReceipt: Ref | null;
  inventoryReceipt: Ref | null;
  quantityText: string | null;
  deliveredAt: string | null;
  /** The site's wall clock and day for `deliveredAt`. */
  deliveredTime: string | null;
  deliveredDate: string | null;
  /** Delivered on another day than the log's (§190). */
  outsideWorkDate: boolean;
  conditionNote: string | null;
  notes: string | null;
  updatedAt: string;
};

export type VisitorEntryDTO = {
  id: string;
  name: string;
  organization: string | null;
  purpose: string | null;
  arrivedAt: string | null;
  departedAt: string | null;
  escortedBy: DailyLogPerson | null;
  notes: string | null;
  updatedAt: string;
};

export type DelayEntryDTO = {
  id: string;
  category: DelayCategory;
  title: string;
  description: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number | null;
  responsiblePartyText: string | null;
  impact: DelayImpact | null;
  task: Ref | null;
  updatedAt: string;
};

export type InstructionEntryDTO = {
  id: string;
  title: string;
  description: string;
  issuedByText: string | null;
  issuedBy: DailyLogPerson | null;
  recipientText: string | null;
  issuedAt: string | null;
  requiresAction: boolean;
  task: Ref | null;
  updatedAt: string;
};

export type LinkedTaskDTO = { linkId: string; taskId: string; title: string; status: string | null; linkType: TaskLinkType; href: string | null; visible: boolean };

/** A QA/QC or HSE record as this reader may see it: its own label, or only that something exists (§68, §69, §224). */
export type LinkedRecordDTO = {
  linkId: string;
  domain: "qaqc" | "hse";
  recordType: string;
  recordId: string;
  label: string;
  detail: string | null;
  status: string | null;
  href: string | null;
  restricted: boolean;
};

export type EvidenceDTO = {
  documentId: string;
  name: string;
  fileName: string | null;
  mimeType: string | null;
  extension: string | null;
  category: DocumentCategory;
  caption: string | null;
  takenAt: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
  href: string;
  previewHref: string | null;
  isImage: boolean;
};

export type CorrectionDTO = { id: string; reason: string; correctionSummary: string; createdBy: DailyLogPerson | null; createdAt: string };

export type DailyLogHistoryEntry = { id: string; action: string; actorName: string | null; occurredAt: string; note: string | null; tone: "neutral" | "info" | "success" | "warning" | "danger" };

export type DailyLogCounts = {
  workforce: number;
  activities: number;
  equipment: number;
  deliveries: number;
  visitors: number;
  delays: number;
  delayMinutes: number;
  instructions: number;
  qaqc: number;
  hse: number;
  photos: number;
  documents: number;
  tasks: number;
};

export type DailyLogIssue = { section: string; message: string };

export type DailyLogDetailDTO = {
  id: string;
  project: { id: string; name: string; code: string | null };
  workDate: string;
  today: string;
  status: DailyLogStatus;
  version: number;
  lateEntry: boolean;
  createdBy: DailyLogPerson | null;
  submittedBy: DailyLogPerson | null;
  submittedAt: string | null;
  reviewer: DailyLogPerson | null;
  reviewedBy: DailyLogPerson | null;
  reviewedAt: string | null;
  lockedBy: DailyLogPerson | null;
  lockedAt: string | null;
  returnReason: string | null;
  voidReason: string | null;
  summary: string | null;
  generalNotes: string | null;
  delaySummary: string | null;
  instructionSummary: string | null;
  weatherSummary: string | null;
  siteCondition: SiteCondition | null;
  siteConditionNotes: string | null;
  weather: WeatherEntryDTO[];
  workforce: WorkforceEntryDTO[];
  activities: WorkActivityDTO[];
  equipment: EquipmentEntryDTO[];
  deliveries: DeliveryEntryDTO[];
  visitors: VisitorEntryDTO[];
  delays: DelayEntryDTO[];
  instructions: InstructionEntryDTO[];
  tasks: LinkedTaskDTO[];
  records: LinkedRecordDTO[];
  evidence: EvidenceDTO[] | null;
  corrections: CorrectionDTO[];
  history: DailyLogHistoryEntry[];
  counts: DailyLogCounts;
  issues: DailyLogIssue[];
  capabilities: {
    canEdit: boolean;
    sections: Record<SectionKey | "qaqc" | "hse" | "tasks", boolean>;
    canSubmit: boolean;
    canReview: boolean;
    canReturn: boolean;
    canLock: boolean;
    canVoid: boolean;
    canCorrect: boolean;
    canUploadEvidence: boolean;
    canCreateTask: boolean;
    canViewEvidence: boolean;
  };
};

export type DailyLogListItemDTO = {
  id: string;
  project: { id: string; name: string; code: string | null };
  workDate: string;
  status: DailyLogStatus;
  lateEntry: boolean;
  summary: string | null;
  author: DailyLogPerson | null;
  reviewer: DailyLogPerson | null;
  workforceTotal: number;
  activities: number;
  delays: number;
  photos: number;
  corrected: boolean;
  href: string;
};

export type DailyLogListDTO = {
  items: DailyLogListItemDTO[];
  total: number;
  page: number;
  pageSize: number;
  /** For a single project's list: whether today's log exists, and whether this reader may start it. */
  today: { date: string; logId: string | null; canCreate: boolean } | null;
};

export type DailyLogSettingsDTO = { logsRequired: boolean; backdateDays: number; reviewerRequired: boolean; timezone: string; workingDays: number[] };
