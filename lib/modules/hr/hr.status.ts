import type {
  AttendanceStatus,
  EmploymentStatus,
  HrProgressStatus,
  LeaveRequestStatus,
  LeaveType,
} from "@prisma/client";

/**
 * HR lifecycle rules (PRD #16 §55, §72, §99, §117).
 *
 * One source of truth per record type, so a transition allowed on a detail page
 * and a transition allowed in the service cannot drift apart.
 */

/* -------------------------------------------------------------------------- */
/* Employment (PRD #16 §55)                                                    */
/* -------------------------------------------------------------------------- */

const EMPLOYMENT_TRANSITIONS: Record<EmploymentStatus, EmploymentStatus[]> = {
  PLANNED: ["ACTIVE", "ENDED"],
  ACTIVE: ["ON_LEAVE", "SUSPENDED", "ENDED"],
  ON_LEAVE: ["ACTIVE", "SUSPENDED", "ENDED"],
  SUSPENDED: ["ACTIVE", "ENDED"],
  // Coming back is a rehire, which is its own action with its own dates
  // (PRD #16 §56).
  ENDED: [],
};

export function canTransitionEmployment(
  from: EmploymentStatus,
  to: EmploymentStatus,
): boolean {
  if (from === to) return true;
  return EMPLOYMENT_TRANSITIONS[from].includes(to);
}

/** Employment that is running, whatever the person is doing today. */
export function isEmploymentLive(status: EmploymentStatus): boolean {
  return status === "ACTIVE" || status === "ON_LEAVE";
}

/** Who counts in headcount (PRD #16 §142). */
export function countsInHeadcount(status: EmploymentStatus): boolean {
  return status === "ACTIVE" || status === "ON_LEAVE";
}

export const employmentStatusLabels: Record<EmploymentStatus, string> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  ON_LEAVE: "On leave",
  SUSPENDED: "Suspended",
  ENDED: "Ended",
};

export const employmentTypeLabels = {
  FULL_TIME: "Full time",
  PART_TIME: "Part time",
  CONTRACTOR: "Contractor",
  INTERN: "Intern",
  TEMPORARY: "Temporary",
  OTHER: "Other",
} as const;

export const progressStatusLabels: Record<HrProgressStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  NOT_REQUIRED: "Not required",
};

/* -------------------------------------------------------------------------- */
/* Leave (PRD #16 §72)                                                         */
/* -------------------------------------------------------------------------- */

const LEAVE_TRANSITIONS: Record<LeaveRequestStatus, LeaveRequestStatus[]> = {
  DRAFT: ["PENDING", "CANCELLED"],
  PENDING: ["APPROVED", "REJECTED", "CANCELLED"],
  // Approved leave can still be cancelled, but only by somebody with the
  // grant — and cancelling gives the days back (PRD #16 §89, §93).
  APPROVED: ["CANCELLED"],
  // Corrected and sent again (`isLeaveSubmittable`, `submitLeave`): straight
  // back to PENDING as a new submission with its own `submittedAt`. Missing
  // here, the resubmission every screen offers was refused (AUD-10 §4, CW-05).
  REJECTED: ["DRAFT", "PENDING", "CANCELLED"],
  CANCELLED: [],
};

export function canTransitionLeave(
  from: LeaveRequestStatus,
  to: LeaveRequestStatus,
): boolean {
  if (from === to) return true;
  return LEAVE_TRANSITIONS[from].includes(to);
}

export const EDITABLE_LEAVE_STATUSES: LeaveRequestStatus[] = ["DRAFT", "REJECTED"];

export function isLeaveEditable(status: LeaveRequestStatus): boolean {
  return EDITABLE_LEAVE_STATUSES.includes(status);
}

export function isLeaveSubmittable(status: LeaveRequestStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

/** Leave that occupies the calendar and must not overlap (PRD #16 §83). */
export function blocksOverlap(status: LeaveRequestStatus): boolean {
  return status === "PENDING" || status === "APPROVED";
}

/** Leave that has drawn down a balance (PRD #16 §80). */
export function consumesBalance(status: LeaveRequestStatus): boolean {
  return status === "APPROVED";
}

/**
 * Leave types counted against an entitlement (PRD #16 §84, §85).
 *
 * Only annual leave is capped in V0.1. Sick, parental and unpaid leave vary by
 * jurisdiction and company policy, and refusing a sick day because a counter
 * ran out would be worse than not counting it.
 */
const BALANCE_TRACKED: LeaveType[] = ["ANNUAL"];

export function isBalanceTracked(leaveType: LeaveType): boolean {
  return BALANCE_TRACKED.includes(leaveType);
}

export const leaveTypeLabels: Record<LeaveType, string> = {
  ANNUAL: "Annual leave",
  SICK: "Sick leave",
  UNPAID: "Unpaid leave",
  PARENTAL: "Parental leave",
  OTHER: "Other",
};

export const leaveStatusLabels: Record<LeaveRequestStatus, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

/* -------------------------------------------------------------------------- */
/* Attendance (PRD #16 §99, §105, §107)                                        */
/* -------------------------------------------------------------------------- */

/** Statuses that may carry check-in and check-out times (PRD #16 §105). */
const TIMED_STATUSES: AttendanceStatus[] = ["PRESENT", "REMOTE"];

export function acceptsTimes(status: AttendanceStatus): boolean {
  return TIMED_STATUSES.includes(status);
}

/**
 * Statuses that may be recorded for a future date (PRD #16 §104).
 *
 * Planning a holiday ahead is ordinary; recording that somebody was present
 * next Tuesday is not.
 */
const PLANNABLE_STATUSES: AttendanceStatus[] = ["HOLIDAY", "OFF"];

export function isPlannable(status: AttendanceStatus): boolean {
  return PLANNABLE_STATUSES.includes(status);
}

/** A day the person worked, for the attendance summary (PRD #16 §114). */
export function countsAsWorked(status: AttendanceStatus): boolean {
  return status === "PRESENT" || status === "REMOTE";
}

/**
 * Something that wants looking at (PRD #16 §115).
 *
 * Deliberately simple: an absence, or a present day with a check-in and no
 * check-out. No anomaly detection.
 */
export function isException(record: {
  status: AttendanceStatus;
  checkIn: Date | null;
  checkOut: Date | null;
}): boolean {
  if (record.status === "ABSENT") return true;
  return countsAsWorked(record.status) && record.checkIn !== null && record.checkOut === null;
}

export const attendanceStatusLabels: Record<AttendanceStatus, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  ON_LEAVE: "On leave",
  REMOTE: "Remote",
  HOLIDAY: "Holiday",
  OFF: "Off",
};

export const attendanceSourceLabels = {
  MANUAL: "Entered by HR",
  SELF: "Self-recorded",
  IMPORT: "Imported",
  SYSTEM: "From approved leave",
  SITE: "Recorded on site",
} as const;

/** Whether an employee can sign in to NESTO (E-04 §17). */
export const accountStatusLabels = {
  HAS_ACCOUNT: "Has a NESTO account",
  NO_ACCOUNT: "No NESTO account",
  ACCOUNT_SUSPENDED: "Account suspended",
} as const;

/** The kind of worker somebody is (E-04 §10). Not a NESTO role. */
export const workerCategoryLabels = {
  OFFICE: "Office",
  FIELD: "Field",
  SITE: "Site",
  CONSTRUCTION_WORKER: "Construction worker",
  DRIVER: "Driver",
  TECHNICIAN: "Technician",
  SUPERVISOR: "Supervisor",
  OTHER: "Other",
} as const;
