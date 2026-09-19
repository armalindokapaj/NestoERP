/**
 * Project planning contracts (PRD #44 §9-§14, §40, §51, §276-§278). Client-safe.
 *
 * A phase groups the plan, a milestone is a key achievement or date, a
 * dependency sequences two milestones and a blocker is a known issue in one's
 * way. Tasks stay the executable work: a milestone links them, never owns them.
 */

export const PHASE_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "AT_RISK", "DELAYED", "COMPLETED", "ON_HOLD", "CANCELLED"] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];

export const MILESTONE_STATUSES = PHASE_STATUSES;
export type MilestoneStatus = PhaseStatus;

export const STATUS_LABELS: Record<MilestoneStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  AT_RISK: "At Risk",
  DELAYED: "Delayed",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold",
  CANCELLED: "Cancelled",
};

/** A milestone in one of these is finished with, one way or another (§44). */
export const CLOSED_STATUSES: readonly MilestoneStatus[] = ["COMPLETED", "CANCELLED"];

export const MILESTONE_TYPES = ["PROJECT_START", "DESIGN", "APPROVAL", "PROCUREMENT", "CONSTRUCTION", "INSPECTION", "COMMISSIONING", "HANDOVER", "PAYMENT", "CONTRACTUAL", "INTERNAL", "OTHER"] as const;
export type MilestoneType = (typeof MILESTONE_TYPES)[number];

export const TYPE_LABELS: Record<MilestoneType, string> = {
  PROJECT_START: "Project start",
  DESIGN: "Design",
  APPROVAL: "Approval",
  PROCUREMENT: "Procurement",
  CONSTRUCTION: "Construction",
  INSPECTION: "Inspection",
  COMMISSIONING: "Commissioning",
  HANDOVER: "Handover",
  PAYMENT: "Payment",
  CONTRACTUAL: "Contractual",
  INTERNAL: "Internal",
  OTHER: "Other",
};

export const BLOCKER_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type BlockerSeverity = (typeof BLOCKER_SEVERITIES)[number];

export const SEVERITY_LABELS: Record<BlockerSeverity, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

export const TASK_LINK_TYPES = ["SUPPORTS", "BLOCKS", "DELIVERS", "RELATED"] as const;
export type TaskLinkType = (typeof TASK_LINK_TYPES)[number];

export const TASK_LINK_LABELS: Record<TaskLinkType, string> = { SUPPORTS: "Supports", BLOCKS: "Blocks", DELIVERS: "Delivers", RELATED: "Related" };

export type PlanningPerson = { memberId: string; name: string; active: boolean };

export type PhaseSummaryDTO = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  status: PhaseStatus;
  progressPercent: number | null;
  /** Completed over active milestones, offered as a suggestion only (§28, §131). */
  suggestedProgress: number | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  forecastStartDate: string | null;
  forecastEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  owner: PlanningPerson | null;
  milestoneCount: number;
  completedCount: number;
  /** The span the timeline draws: the phase's own dates, else its milestones'. */
  span: { start: string; end: string } | null;
  version: number;
};

export type MilestoneSummaryDTO = {
  id: string;
  name: string;
  description: string | null;
  phaseId: string | null;
  status: MilestoneStatus;
  type: MilestoneType;
  owner: PlanningPerson | null;
  baselineDate: string | null;
  plannedDate: string | null;
  forecastDate: string | null;
  actualDate: string | null;
  /** Actual, else forecast, else planned, else baseline (§20). */
  displayDate: string | null;
  varianceDays: number | null;
  /** Its target date has passed and it is neither completed nor cancelled (§44). */
  delayed: boolean;
  overdueDays: number;
  critical: boolean;
  externallyCommitted: boolean;
  progressPercent: number | null;
  taskStats: { total: number; completed: number };
  openBlockerCount: number;
  criticalBlockerCount: number;
  /** Predecessors not yet completed or cancelled (§39). */
  waitingOn: number;
  dependencyWarning: string | null;
  sortOrder: number;
  version: number;
};

export type DependencyEdgeDTO = {
  id: string;
  predecessorId: string;
  successorId: string;
  lagDays: number;
  satisfied: boolean;
  warning: string | null;
};

export type PlanningMetrics = {
  total: number;
  completed: number;
  upcoming: number;
  atRisk: number;
  delayed: number;
  critical: number;
  /** Completed over milestones not cancelled — a planning indicator, not financial progress (§129, §130). */
  progressPercent: number | null;
};

export type PlanningCapabilities = {
  canManage: boolean;
  canCreatePhase: boolean;
  canEditPhase: boolean;
  canArchivePhase: boolean;
  canCreateMilestone: boolean;
  canEditMilestone: boolean;
  canComplete: boolean;
  canReopen: boolean;
  canManageBaseline: boolean;
  canManageDependencies: boolean;
  canManageBlockers: boolean;
  canApplyTemplate: boolean;
  canCreateTask: boolean;
  canLockBaseline: boolean;
  canUnlockBaseline: boolean;
};

export type Option = { id: string; label: string };

export type ProjectPlanningOverviewDTO = {
  projectId: string;
  project: { id: string; name: string; code: string; status: string; startDate: string | null; endDate: string | null; archived: boolean };
  today: string;
  timezone: string;
  phases: PhaseSummaryDTO[];
  milestones: MilestoneSummaryDTO[];
  dependencies: DependencyEdgeDTO[];
  metrics: PlanningMetrics;
  capabilities: PlanningCapabilities;
  baselineLocked: boolean;
  baselineReasonRequired: boolean;
  templateKey: string | null;
  /** People a milestone or blocker may be given to: the project's manager and active members. */
  members: Option[];
};

export type TimelineDTO = {
  projectId: string;
  today: string;
  phases: Array<{ id: string; name: string; status: PhaseStatus; progressPercent: number | null; start: string | null; end: string | null }>;
  milestones: Array<{ id: string; phaseId: string | null; name: string; date: string | null; baselineDate: string | null; status: MilestoneStatus; critical: boolean; delayed: boolean; varianceDays: number | null }>;
  edges: Array<{ id: string; from: string; to: string; lagDays: number }>;
};

export type BlockerDTO = {
  id: string;
  title: string;
  description: string | null;
  severity: BlockerSeverity;
  owner: PlanningPerson | null;
  dueDate: string | null;
  overdue: boolean;
  resolvedAt: string | null;
  resolvedBy: PlanningPerson | null;
  resolutionNote: string | null;
  linkedTask: { id: string; title: string; href: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

export type LinkedRecordDTO = {
  linkId: string;
  recordType: "meeting" | "daily_log";
  recordId: string;
  label: string;
  href: string | null;
  restricted: boolean;
};

export type MilestoneRelationDTO = {
  dependencyId: string;
  milestoneId: string;
  name: string;
  status: MilestoneStatus;
  targetDate: string | null;
  lagDays: number;
  delayed: boolean;
  overdueDays: number;
};

export type MilestoneDocumentDTO = {
  documentId: string;
  name: string;
  fileName: string | null;
  extension: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
  uploadedByMemberId: string | null;
  href: string;
};

export type PlanningHistoryEntry = { id: string; action: string; actorName: string | null; actorMemberId: string | null; occurredAt: string; note: string | null };

export type MilestoneCapabilities = {
  canEdit: boolean;
  canComplete: boolean;
  canReopen: boolean;
  canArchive: boolean;
  canChangeBaseline: boolean;
  canManageDependencies: boolean;
  canManageBlockers: boolean;
  canLinkTasks: boolean;
  canCreateTask: boolean;
  canLinkMeetings: boolean;
  canLinkDailyLogs: boolean;
  canUploadDocuments: boolean;
  canViewDocuments: boolean;
};

export type MilestoneDetailDTO = MilestoneSummaryDTO & {
  project: { id: string; name: string; code: string };
  phase: { id: string; name: string } | null;
  today: string;
  completionNote: string | null;
  completedBy: PlanningPerson | null;
  reopenedAt: string | null;
  createdBy: PlanningPerson | null;
  createdAt: string;
  updatedAt: string;
  baselineLocked: boolean;
  baselineReasonRequired: boolean;
  predecessors: MilestoneRelationDTO[];
  successors: MilestoneRelationDTO[];
  tasks: Array<{ taskId: string; title: string; status: string | null; linkType: TaskLinkType; href: string | null; visible: boolean }>;
  blockers: BlockerDTO[];
  meetings: LinkedRecordDTO[];
  dailyLogs: LinkedRecordDTO[];
  documents: MilestoneDocumentDTO[] | null;
  history: PlanningHistoryEntry[];
  /** What the plan suggests, never applies (§43, §162). */
  suggestion: { forecastDate: string | null; atRisk: string[] };
  capabilities: MilestoneCapabilities;
  /** Starred by this reader (PRD #45 §75). */
  favorite: boolean;
};

export type PlanningSettingsDTO = {
  milestoneReminderDays: number;
  baselineChangeReasonRequired: boolean;
  notifyExecutivesOnCriticalChanges: boolean;
  timezone: string;
};
