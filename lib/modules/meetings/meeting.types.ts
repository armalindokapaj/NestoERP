import type {
  MeetingActionItemStatus,
  MeetingAgendaItemStatus,
  MeetingAttendanceStatus,
  MeetingLocationType,
  MeetingParticipantRole,
  MeetingResponseStatus,
  MeetingStatus,
  MeetingType,
  MeetingVisibility,
  MinutesStatus,
} from "@prisma/client";

import type { RecurrenceInput } from "@/lib/modules/calendar/calendar.types";

/**
 * Meetings contracts (PRD #40 §12-§20, §93-§95).
 *
 * Browser-safe: types, labels and the static agenda templates only. Everything
 * that decides who may do what lives in `meeting.permissions.ts` and runs on
 * the server; the capabilities a DTO carries are that decision, reported.
 */

export const MEETING_TYPES: MeetingType[] = [
  "INTERNAL",
  "PROJECT",
  "SITE",
  "CLIENT",
  "COORDINATION",
  "MANAGEMENT",
  "DESIGN_REVIEW",
  "TECHNICAL",
  "PROCUREMENT",
  "QA_QC",
  "HSE",
  "FINANCE",
  "LEGAL",
  "HR",
  "OTHER",
];

export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  INTERNAL: "Internal",
  PROJECT: "Project",
  SITE: "Site",
  CLIENT: "Client",
  COORDINATION: "Coordination",
  MANAGEMENT: "Management",
  DESIGN_REVIEW: "Design review",
  TECHNICAL: "Technical",
  PROCUREMENT: "Procurement",
  QA_QC: "QA/QC",
  HSE: "HSE",
  FINANCE: "Finance",
  LEGAL: "Legal",
  HR: "HR",
  OTHER: "Other",
};

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const MEETING_VISIBILITY_LABELS: Record<MeetingVisibility, string> = {
  PARTICIPANTS: "Participants only",
  PROJECT: "Project team",
  DEPARTMENT: "Department",
  COMPANY: "Whole company",
};

export const LOCATION_TYPE_LABELS: Record<MeetingLocationType, string> = {
  IN_PERSON: "In person",
  ONLINE: "Online",
  HYBRID: "Hybrid",
  UNSPECIFIED: "Not set",
};

export const PARTICIPANT_ROLE_LABELS: Record<MeetingParticipantRole, string> = {
  ORGANIZER: "Organizer",
  CHAIR: "Chair",
  SECRETARY: "Secretary",
  ATTENDEE: "Attendee",
  OBSERVER: "Observer",
};

export const RESPONSE_LABELS: Record<MeetingResponseStatus, string> = {
  PENDING: "Awaiting reply",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  TENTATIVE: "Tentative",
};

export const ATTENDANCE_LABELS: Record<MeetingAttendanceStatus, string> = {
  UNKNOWN: "Not recorded",
  PRESENT: "Present",
  ABSENT: "Absent",
  EXCUSED: "Excused",
};

export const AGENDA_STATUS_LABELS: Record<MeetingAgendaItemStatus, string> = {
  PENDING: "To discuss",
  DISCUSSED: "Discussed",
  SKIPPED: "Skipped",
  DEFERRED: "Deferred",
};

export const ACTION_STATUS_LABELS: Record<MeetingActionItemStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

/** "D-03" (PRD #40 §214). */
export function decisionLabel(decisionNumber: number): string {
  return `D-${String(decisionNumber).padStart(2, "0")}`;
}

/**
 * The visibility a new meeting suggests (PRD #40 §88): a project meeting is the
 * project team's; anything else — management included — starts with the
 * people invited, and widening it is a deliberate choice.
 */
export function defaultVisibilityFor(meetingType: MeetingType, hasProject: boolean): MeetingVisibility {
  if (hasProject && meetingType !== "HR" && meetingType !== "MANAGEMENT") return "PROJECT";
  return "PARTICIPANTS";
}

/* -------------------------------------------------------------------------- */
/* Agenda templates (PRD #40 §38-§40) — static, code-defined                   */
/* -------------------------------------------------------------------------- */

export type AgendaTemplate = {
  key: string;
  label: string;
  items: Array<{ title: string; plannedMinutes?: number }>;
};

export const AGENDA_TEMPLATES: AgendaTemplate[] = [
  {
    key: "general",
    label: "General",
    items: [{ title: "Purpose and context", plannedMinutes: 5 }, { title: "Discussion", plannedMinutes: 30 }, { title: "Decisions required" }, { title: "Actions and owners", plannedMinutes: 10 }],
  },
  {
    key: "project-coordination",
    label: "Project Coordination",
    items: [
      { title: "Previous action items", plannedMinutes: 10 },
      { title: "Design status", plannedMinutes: 10 },
      { title: "Site progress", plannedMinutes: 10 },
      { title: "Procurement", plannedMinutes: 5 },
      { title: "QA/QC", plannedMinutes: 5 },
      { title: "HSE", plannedMinutes: 5 },
      { title: "Risks / blockers", plannedMinutes: 5 },
      { title: "Decisions required", plannedMinutes: 5 },
      { title: "New actions", plannedMinutes: 5 },
    ],
  },
  {
    key: "site-meeting",
    label: "Site Meeting",
    items: [
      { title: "Safety briefing", plannedMinutes: 5 },
      { title: "Progress since last meeting", plannedMinutes: 10 },
      { title: "Site issues and photographs", plannedMinutes: 15 },
      { title: "Look-ahead for the coming week", plannedMinutes: 10 },
      { title: "Actions", plannedMinutes: 5 },
    ],
  },
  {
    key: "design-review",
    label: "Design Review",
    items: [
      { title: "Scope of the review", plannedMinutes: 5 },
      { title: "Drawings and options", plannedMinutes: 25 },
      { title: "Comments from disciplines", plannedMinutes: 15 },
      { title: "Decisions required", plannedMinutes: 10 },
      { title: "Actions", plannedMinutes: 5 },
    ],
  },
  {
    key: "qa-qc",
    label: "QA/QC",
    items: [
      { title: "Open non-conformances", plannedMinutes: 10 },
      { title: "Inspections this period", plannedMinutes: 10 },
      { title: "Defects and corrective actions", plannedMinutes: 10 },
      { title: "Actions", plannedMinutes: 5 },
    ],
  },
  {
    key: "hse",
    label: "HSE",
    items: [
      { title: "Incidents and near misses", plannedMinutes: 10 },
      { title: "Hazards and observations", plannedMinutes: 10 },
      { title: "Permits and toolbox talks", plannedMinutes: 5 },
      { title: "Actions", plannedMinutes: 5 },
    ],
  },
  {
    key: "management",
    label: "Management",
    items: [
      { title: "Previous actions", plannedMinutes: 10 },
      { title: "Portfolio status", plannedMinutes: 15 },
      { title: "Finance", plannedMinutes: 10 },
      { title: "People", plannedMinutes: 10 },
      { title: "Decisions required", plannedMinutes: 10 },
      { title: "Actions", plannedMinutes: 5 },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* DTOs                                                                        */
/* -------------------------------------------------------------------------- */

export type MeetingPersonDTO = { memberId: string; fullName: string; avatarUrl: string | null };

export type MeetingListItemDTO = {
  id: string;
  title: string;
  meetingType: MeetingType;
  status: MeetingStatus;
  minutesStatus: MinutesStatus;
  startsAt: string;
  endsAt: string;
  timezone: string;
  locationType: MeetingLocationType;
  locationText: string | null;
  project: { id: string; name: string; code: string } | null;
  organizer: MeetingPersonDTO;
  participantCount: number;
  participantsPreview: Array<MeetingPersonDTO & { response: MeetingResponseStatus }>;
  myRole: MeetingParticipantRole | null;
  myResponse: MeetingResponseStatus | null;
  recurring: boolean;
  openActionCount: number;
  href: string;
  /** Present only in the Group workspace, where a row must say which company it is (Workspace Context §34, §45). */
  company?: { id: string; name: string };
};

export type MeetingParticipantDTO = MeetingPersonDTO & {
  role: MeetingParticipantRole;
  response: MeetingResponseStatus;
  required: boolean;
  attendance: MeetingAttendanceStatus;
  /** False once the membership has ended; the name is the snapshot taken when they were added. */
  active: boolean;
  respondedAt: string | null;
};

export type MeetingAgendaItemDTO = {
  id: string;
  sortOrder: number;
  title: string;
  description: string | null;
  presenter: MeetingPersonDTO | null;
  plannedMinutes: number | null;
  status: MeetingAgendaItemStatus;
};

export type MeetingMinutesSectionDTO = {
  id: string;
  sortOrder: number;
  title: string;
  body: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type MeetingDecisionDTO = {
  id: string;
  decisionNumber: number;
  label: string;
  title: string;
  description: string | null;
  decidedAt: string;
  recordedBy: string;
  recordedByMemberId: string | null;
};

export type MeetingActionItemDTO = {
  id: string;
  title: string;
  description: string | null;
  owner: MeetingPersonDTO | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  status: MeetingActionItemStatus;
  overdue: boolean;
  completedAt: string | null;
  /** The linked Task, named only to a reader who can open it (PRD #40 §198). */
  task: { id: string; title: string; status: string; href: string | null } | null;
  capabilities: { canEdit: boolean; canChangeStatus: boolean; canConvertToTask: boolean };
};

export type MeetingCapabilities = {
  canEdit: boolean;
  canSchedule: boolean;
  canStart: boolean;
  canComplete: boolean;
  canCancel: boolean;
  canDuplicate: boolean;
  canManageParticipants: boolean;
  canTransferOrganizer: boolean;
  canManageAgenda: boolean;
  canEditMinutes: boolean;
  canFinalizeMinutes: boolean;
  canReopenMinutes: boolean;
  canRecordDecision: boolean;
  canCreateAction: boolean;
  canManageActions: boolean;
  canConvertToTask: boolean;
  canRecordAttendance: boolean;
  canRespond: boolean;
  canViewDocuments: boolean;
  canUploadDocuments: boolean;
};

export type MeetingDetailDTO = {
  id: string;
  title: string;
  description: string | null;
  meetingType: MeetingType;
  status: MeetingStatus;
  minutesStatus: MinutesStatus;
  minutesFinalizedAt: string | null;
  minutesFinalizedBy: string | null;
  minutesFinalizedByMemberId: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  locationType: MeetingLocationType;
  locationText: string | null;
  onlineUrl: string | null;
  visibility: MeetingVisibility;
  project: { id: string; name: string; code: string; href: string | null } | null;
  department: { id: string; name: string } | null;
  organizer: MeetingPersonDTO;
  createdBy: MeetingPersonDTO;
  participants: MeetingParticipantDTO[];
  agenda: MeetingAgendaItemDTO[];
  minutes: MeetingMinutesSectionDTO[];
  decisions: MeetingDecisionDTO[];
  actions: MeetingActionItemDTO[];
  series: { id: string; occurrenceIndex: number; recurrence: RecurrenceInput | null; cancelled: boolean } | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  archived: boolean;
  version: number;
  reminders: number[];
  myRole: MeetingParticipantRole | null;
  myResponse: MeetingResponseStatus | null;
  capabilities: MeetingCapabilities;
  createdAt: string;
  updatedAt: string;
};

export type MeetingConflictDTO = { memberId: string; fullName: string; busy: Array<{ startsAt: string; endsAt: string }> };

export type MeetingWriteResult = { meeting: MeetingDetailDTO; conflicts: MeetingConflictDTO[]; occurrences?: number };

export type MyActionItemDTO = MeetingActionItemDTO & {
  meeting: { id: string; title: string; startsAt: string; href: string };
  project: { id: string; name: string } | null;
  /** Present only in the Group workspace (Workspace Context §34, §45). */
  company?: { id: string; name: string };
};
