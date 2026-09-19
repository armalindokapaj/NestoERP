import type { AttendanceSource, AttendanceStatus, EmploymentStatus, ProjectSiteStatus, WorkerCategory, WorkforceCrewStatus } from "@prisma/client";

import type { AccountStatus } from "@/lib/modules/hr/hr.person";

/**
 * The workforce's shapes (E-04 §28-§42, §123, §136-§139). A worker is an
 * employment — with or without a login — so every row here is addressed by the
 * employment (`employeeId`) and linked to the person (`personId`), never by a
 * membership. Nothing here carries pay, private contact data or an identifier
 * beyond the employee number (§79, §152).
 */

export type Ref = { id: string; name: string };
export type ProjectRef = Ref & { code: string | null };
export type WorkerRef = { employeeId: string; personId: string; name: string };

export const TRADE_NAME_MAX = 80;

export type TradeDTO = {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
  sortOrder: number;
  employeeCount: number;
  crewCount: number;
};

export type SiteDTO = {
  id: string;
  projectId: string;
  name: string;
  code: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  status: ProjectSiteStatus;
  /** Workers assigned to it today. */
  workerCount: number;
  crewCount: number;
};

export type CrewSummaryDTO = {
  id: string;
  name: string;
  status: WorkforceCrewStatus;
  notes: string | null;
  project: ProjectRef | null;
  site: Ref | null;
  trade: Ref | null;
  supervisor: WorkerRef | null;
  memberCount: number;
};

export type CrewMemberDTO = WorkerRef & {
  membershipId: string;
  trade: string | null;
  role: string | null;
  startDate: string;
  endDate: string | null;
  endReason: string | null;
  accountStatus: AccountStatus;
};

export type CrewDetailDTO = CrewSummaryDTO & {
  /** Today's members, and anybody due to join. */
  members: CrewMemberDTO[];
  /** Memberships that have ended, newest first (§30). */
  history: CrewMemberDTO[];
  capabilities: { canManage: boolean };
};

export type CrewMembershipDTO = {
  id: string;
  crew: Ref;
  role: string | null;
  startDate: string;
  endDate: string | null;
  endReason: string | null;
  current: boolean;
  canManage: boolean;
};

export type ProjectAssignmentDTO = {
  id: string;
  project: ProjectRef;
  site: Ref | null;
  trade: Ref | null;
  role: string | null;
  isPrimary: boolean;
  startDate: string;
  endDate: string | null;
  endReason: string | null;
  current: boolean;
  canManage: boolean;
};

export type WorkerSummaryDTO = WorkerRef & {
  employeeNumber: string | null;
  jobTitle: string | null;
  workerCategory: WorkerCategory | null;
  trade: Ref | null;
  crew: Ref | null;
  project: ProjectRef | null;
  site: Ref | null;
  /** The crew's supervisor — the foreman — who may have no login either (§31, §32). */
  supervisor: string | null;
  supervisorPersonId: string | null;
  employmentStatus: EmploymentStatus;
  accountStatus: AccountStatus;
};

/** A worker's place in the workforce, for their profile's Workforce tab (E-04 §139). */
export type WorkerWorkforceDTO = WorkerRef & {
  employeeNumber: string | null;
  jobTitle: string | null;
  workerCategory: WorkerCategory | null;
  trade: Ref | null;
  employmentStatus: EmploymentStatus;
  accountStatus: AccountStatus;
  /** Today's crew and any the worker is due to join. */
  crews: CrewMembershipDTO[];
  crewHistory: CrewMembershipDTO[];
  /** Today's and upcoming assignments, primary first. */
  assignments: ProjectAssignmentDTO[];
  assignmentHistory: ProjectAssignmentDTO[];
  capabilities: { canAssignProject: boolean; canAssignCrew: boolean };
};

export type SheetStatus = Extract<AttendanceStatus, "PRESENT" | "ABSENT" | "OFF">;
export const SHEET_STATUSES = ["PRESENT", "ABSENT", "OFF"] as const satisfies readonly SheetStatus[];

export type AttendanceSheetRowDTO = WorkerRef & {
  trade: string | null;
  crew: string | null;
  attendance: {
    id: string;
    status: AttendanceStatus;
    checkIn: string | null;
    checkOut: string | null;
    notes: string | null;
    source: AttendanceSource;
    /** Where the day was recorded, when that was somewhere else. */
    elsewhere: string | null;
  } | null;
  /** Why the row cannot be changed from the site sheet; null when it can. */
  locked: string | null;
};

export type AttendanceSheetDTO = {
  date: string;
  project: ProjectRef | null;
  site: Ref | null;
  crew: Ref | null;
  rows: AttendanceSheetRowDTO[];
  canRecord: boolean;
};

export type AttendanceSheetResult = { created: number; updated: number; unchanged: number };

export const siteStatusLabels: Record<ProjectSiteStatus, string> = { ACTIVE: "Active", ARCHIVED: "Archived" };
export const crewStatusLabels: Record<WorkforceCrewStatus, string> = { ACTIVE: "Active", ARCHIVED: "Archived" };
export const sheetStatusLabels: Record<SheetStatus, string> = { PRESENT: "Present", ABSENT: "Absent", OFF: "Day off" };
