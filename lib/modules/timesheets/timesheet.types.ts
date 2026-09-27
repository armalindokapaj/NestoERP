/**
 * Timesheet shapes (PRD #42 §13-§15, §32, §43, §79).
 *
 * Plain data for the browser. Minutes are the only unit of time anywhere in
 * here; hours are a display decision.
 */

export const TIMESHEET_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "RETURNED", "REJECTED", "CANCELLED"] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  RETURNED: "Returned",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const WORK_LOG_TYPES = ["PROJECT_WORK", "INTERNAL", "ADMIN", "TRAINING", "TRAVEL", "SUPPORT", "OTHER"] as const;
export type WorkLogType = (typeof WORK_LOG_TYPES)[number];

export const WORK_LOG_TYPE_LABELS: Record<WorkLogType, string> = {
  PROJECT_WORK: "Project work",
  INTERNAL: "Internal",
  ADMIN: "Admin",
  TRAINING: "Training",
  TRAVEL: "Travel",
  SUPPORT: "Support",
  OTHER: "Other",
};

export type TimesheetPerson = { memberId: string; name: string };

export type WorkLogDTO = {
  id: string;
  workDate: string;
  workType: WorkLogType;
  minutes: number;
  description: string | null;
  billable: boolean;
  overtimeFlag: boolean;
  project: { id: string; name: string; code: string | null } | null;
  task: { id: string; title: string } | null;
  updatedAt: string;
};

/** A grid row: one project/task/work-type combination across the week (§43, §192). */
export type TimesheetRowDTO = {
  key: string;
  workType: WorkLogType;
  project: { id: string; name: string; code: string | null } | null;
  task: { id: string; title: string } | null;
  /** Minutes per day, and the entries behind each day. */
  days: Record<string, { minutes: number; logIds: string[] }>;
  totalMinutes: number;
  billableMinutes: number;
};

export type TimesheetDayDTO = {
  date: string;
  totalMinutes: number;
  /** Approved leave on this day, which lowers what is expected (§96, §97). */
  leave: { label: string } | null;
  /** Attendance recorded that day, when the reader may see it — a comparison, never an entry (§98). */
  attendanceMinutes: number | null;
  future: boolean;
  /** Before the backdating window: entries can no longer be added (§59). */
  locked: boolean;
};

export type TimesheetTotals = {
  totalMinutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  internalMinutes: number;
  overtimeFlaggedMinutes: number;
  /** Informational: above the standard week, never a payroll figure (§33-§36). */
  overtimeMinutes: number;
  expectedMinutes: number;
  projects: Array<{ projectId: string | null; name: string; minutes: number }>;
};

export type TimesheetWarning = { code: string; message: string; severity: "INFO" | "WARNING" | "CRITICAL" };

export type TimesheetHistoryEntry = { id: string; action: string; actorName: string | null; actorMemberId: string | null; occurredAt: string; note: string | null; tone: "neutral" | "info" | "success" | "warning" | "danger" };

export type TimesheetSettingsDTO = {
  weekStartsOn: number;
  standardDailyMinutes: number;
  standardWeeklyMinutes: number;
  incrementMinutes: number;
  enforceIncrement: boolean;
  backdateDays: number;
  submitDay: number | null;
  submitTime: string | null;
  descriptionsRequired: boolean;
  membersSetBillable: boolean;
  timezone: string;
};

export type TimesheetWeekDTO = {
  id: string | null;
  member: TimesheetPerson;
  periodStart: string;
  periodEnd: string;
  today: string;
  status: TimesheetStatus;
  version: number;
  submissionVersion: number;
  approver: TimesheetPerson | null;
  /** The approver the week would go to if submitted now. */
  expectedApprover: TimesheetPerson | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedBy: TimesheetPerson | null;
  decisionNote: string | null;
  days: TimesheetDayDTO[];
  rows: TimesheetRowDTO[];
  logs: WorkLogDTO[];
  totals: TimesheetTotals;
  warnings: TimesheetWarning[];
  history: TimesheetHistoryEntry[];
  settings: TimesheetSettingsDTO;
  capabilities: {
    canEdit: boolean;
    canSubmit: boolean;
    canReopen: boolean;
    canSetBillable: boolean;
    canComment: boolean;
    /** Approval Center link for whoever decides it. */
    approvalHref: string | null;
    isOwn: boolean;
  };
};

export type TeamTimesheetRowDTO = {
  timesheetId: string | null;
  member: TimesheetPerson & { jobTitle: string | null; department: string | null };
  periodStart: string;
  status: TimesheetStatus | "NOT_STARTED";
  totalMinutes: number;
  billableMinutes: number;
  overtimeMinutes: number;
  submittedAt: string | null;
  approver: TimesheetPerson | null;
  href: string | null;
};

export type TeamTimesheetListDTO = {
  periodStart: string;
  periodEnd: string;
  weekLabel: string;
  rows: TeamTimesheetRowDTO[];
  counts: Record<TimesheetStatus | "NOT_STARTED", number>;
  departments: Array<{ id: string; name: string }>;
  approvers: TimesheetPerson[];
  truncated: boolean;
};

export type ProjectTimeSummaryDTO = {
  project: { id: string; name: string; code: string | null } | null;
  from: string;
  to: string;
  approvedOnly: boolean;
  billable: "all" | "billable" | "non_billable";
  totals: { totalMinutes: number; billableMinutes: number; nonBillableMinutes: number; overtimeFlaggedMinutes: number };
  byProject: Array<{ projectId: string; name: string; code: string | null; minutes: number; billableMinutes: number }>;
  byMember: Array<{ memberId: string; name: string; minutes: number; billableMinutes: number }>;
  byTask: Array<{ taskId: string | null; title: string; minutes: number }>;
  /** How many tasks carry time in the range; `byTask` holds the top 50 of them by hours. */
  byTaskCount: number;
  byWeek: Array<{ weekStart: string; minutes: number; billableMinutes: number }>;
  /** Individual entries; what people wrote is shown only to team readers (§126, §178, §230). */
  entries: Array<WorkLogDTO & { member: TimesheetPerson; status: TimesheetStatus }>;
  entriesTruncated: boolean;
  showsDescriptions: boolean;
  projects: Array<{ id: string; name: string; code: string | null }>;
  members: TimesheetPerson[];
  tasks: Array<{ id: string; title: string }>;
};

export type TimesheetFormOptions = {
  projects: Array<{ id: string; name: string; code: string | null }>;
  recent: Array<{ workType: WorkLogType; project: { id: string; name: string; code: string | null } | null; task: { id: string; title: string } | null }>;
};
