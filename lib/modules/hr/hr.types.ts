import type { EmploymentCapabilitiesDTO } from "./employment/employment.types";
import type {
  AttendanceSource,
  AttendanceStatus,
  CompensationPayType,
  EmploymentStatus,
  EmploymentType,
  HrProgressStatus,
  LeaveRequestStatus,
  LeaveType,
  WorkerCategory,
  WorkLocationType,
} from "@prisma/client";
import type { AccountStatus } from "./hr.person";

/**
 * HR DTOs (PRD #16 §169–§175).
 *
 * Explicitly shaped and deliberately narrow. Compensation is never part of an
 * employee DTO — it has its own type, returned only to a reader who holds
 * `hr.compensation.view` (PRD #16 §15, §17). Monetary amounts are decimal
 * strings for the same reason as Finance: a float is not the amount.
 */

/**
 * An employee as another record names them: by their employment, which every
 * employee has, and by their login only when they have one (E-04 §7).
 */
export type EmployeeRef = {
  employeeId: string;
  memberId: string | null;
  fullName: string;
  email: string | null;
  avatarUrl: string | null;
};

export type EmployeeSummaryDTO = {
  /** The employment: how every HR record addresses an employee (E-04 §7, §14). */
  id: string;
  /** Their login in this company, if they have one. */
  memberId: string | null;
  personId: string;
  name: { firstName: string; lastName: string; fullName: string };
  email: string | null;
  avatarUrl: string | null;
  employeeNumber: string | null;
  jobTitle: string | null;
  department: { id: string; name: string } | null;
  employmentStatus: EmploymentStatus;
  employmentType: EmploymentType;
  workerCategory: WorkerCategory | null;
  trade: { id: string; name: string } | null;
  /** Has a NESTO account, has none, or has one switched off (E-04 §17). */
  accountStatus: AccountStatus;
  startDate: string | null;
  endDate: string | null;
  /** The manager's login, and their own employment record here when they have one (E-04 §14). */
  manager: { memberId: string; employmentId: string | null; fullName: string } | null;
  updatedAt: string;
};

export type EmployeeDetailDTO = EmployeeSummaryDTO & {
  probationEndDate: string | null;
  workLocationType: WorkLocationType | null;
  workLocation: string | null;
  /** The open history row the page was built on; a change sends it back so a stale form is refused (E-03 §40). */
  currentAssignmentId: string | null;
  weeklyHours: string | null;
  onboardingStatus: HrProgressStatus;
  offboardingStatus: HrProgressStatus;
  phone: string | null;
  /** The NESTO role of their login; none without one (E-04 §13). */
  role: { id: string; name: string } | null;
  /** Company access, which HR never changes on its own (PRD #16 §230, §231). */
  membershipStatus: string | null;
  createdAt: string;

  /** Server-derived UX hints; every mutation re-checks authorisation. */
  capabilities: {
    canEditEmployment: boolean;
    canChangeStatus: boolean;
    canAssignManager: boolean;
    canViewCompensation: boolean;
    canEditCompensation: boolean;
    canViewLeave: boolean;
    canViewAttendance: boolean;
    canViewDocuments: boolean;
    canViewActivity: boolean;
    canManageOnboarding: boolean;
    canViewHistory: boolean;
    /** Ask Group IT for a login for somebody who has none (E-06 §27, E-04 §88). */
    canRequestAccount: boolean;
  };
  /** Which dated employment changes this reader may make (E-03 §163). */
  employment: EmploymentCapabilitiesDTO;

  /** Why an action is unavailable when the reason is a rule (PRD #16 §127). */
  guards: { openLeaveRequests: number; managedEmployees: number };
};

export type CompensationDTO = {
  id: string;
  currency: string;
  payType: CompensationPayType;
  baseAmount: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isCurrent: boolean;
  notes: string | null;
  recordedBy: string | null;
  createdAt: string;
};

export type LeaveRequestDTO = {
  id: string;
  employee: EmployeeRef;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: string;
  /**
   * Absent unless the reader is the requester, or holds
   * `hr.leave.reason.view` — a reason may be medical (PRD #16 §95).
   */
  reason?: string | null;
  status: LeaveRequestStatus;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  updatedAt: string;

  capabilities: {
    canEdit: boolean;
    canSubmit: boolean;
    canApprove: boolean;
    canReject: boolean;
    canCancel: boolean;
    canViewDocuments: boolean;
  };
};

export type LeaveBalanceDTO = {
  leaveType: LeaveType;
  year: number;
  entitledDays: string;
  usedDays: string;
  adjustmentDays: string;
  availableDays: string;
  /** False for types V0.1 does not cap, such as sick leave (PRD #16 §85). */
  tracked: boolean;
};

export type AttendanceDTO = {
  id: string;
  employee: EmployeeRef;
  date: string;
  status: AttendanceStatus;
  checkIn: string | null;
  checkOut: string | null;
  workedMinutes: number | null;
  notes: string | null;
  source: AttendanceSource;
  /** True for a row written by approved leave, which HR alone may override. */
  systemGenerated: boolean;
  isException: boolean;
  updatedAt: string;

  capabilities: { canEdit: boolean };
};

export type HrOverviewDTO = {
  headcount: number;
  byEmploymentType: { type: EmploymentType; count: number }[];
  pendingLeave: number;
  onLeaveToday: number;
  startingSoon: number;
  endingSoon: number;
  onboardingInProgress: number;
  offboardingInProgress: number;
  attendanceExceptions: number;

  /** Which panels this reader may see at all (PRD #16 §22, §23). */
  visible: {
    employees: boolean;
    leave: boolean;
    attendance: boolean;
    onboarding: boolean;
    selfOnly: boolean;
  };
};

export type HrActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  createdAt: string;
};

export type LeaveSummaryRow = {
  leaveType: LeaveType;
  requests: number;
  days: string;
};

export type AttendanceSummaryRow = {
  employeeId: string;
  fullName: string;
  present: number;
  remote: number;
  absent: number;
  onLeave: number;
  exceptions: number;
};

export type CompensationReportRow = {
  employeeId: string;
  fullName: string;
  department: string | null;
  payType: CompensationPayType;
  currency: string;
  baseAmount: string;
  effectiveFrom: string;
};

export type UpcomingEndRow = {
  employeeId: string;
  fullName: string;
  department: string | null;
  endDate: string;
  employmentType: EmploymentType;
};
