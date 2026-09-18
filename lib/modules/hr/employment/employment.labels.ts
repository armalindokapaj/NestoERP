import type {
  EmploymentAssignmentReason,
  EmploymentChangeStatus,
  EmploymentChangeType,
  EmploymentHistorySource,
  EmploymentStatusReason,
  WorkLocationType,
} from "@prisma/client";

/** Labels for employment history (E-03 §29, §120, §125). No Prisma runtime import: forms read these. */

export const workLocationTypeLabels: Record<WorkLocationType, string> = {
  OFFICE: "Office",
  SITE: "Site",
  REMOTE: "Remote",
  HYBRID: "Hybrid",
  OTHER: "Other",
};

export const assignmentReasonLabels: Record<EmploymentAssignmentReason, string> = {
  HIRE: "Joined",
  REHIRE: "Rehired",
  PROMOTION: "Promoted",
  DEMOTION: "Position changed",
  TITLE_CHANGE: "Title changed",
  DEPARTMENT_TRANSFER: "Transferred department",
  LEGAL_ENTITY_TRANSFER: "Transferred company",
  MANAGER_CHANGE: "Manager changed",
  LOCATION_CHANGE: "Location changed",
  EMPLOYMENT_TYPE_CHANGE: "Employment type changed",
  REORGANIZATION: "Reorganization",
  CORRECTION: "Correction",
  OTHER: "Changed",
};

export const statusReasonLabels: Record<EmploymentStatusReason, string> = {
  HIRE: "Hired",
  REHIRE: "Rehired",
  LEAVE: "Leave",
  RETURN: "Returned",
  SUSPENSION: "Suspension",
  RESIGNATION: "Resignation",
  DISMISSAL: "Dismissal",
  END_OF_CONTRACT: "End of contract",
  RETIREMENT: "Retirement",
  MUTUAL_AGREEMENT: "Mutual agreement",
  LEGAL_ENTITY_TRANSFER: "Transferred to another company",
  CORRECTION: "Correction",
  OTHER: "Other",
};

export const changeTypeLabels: Record<EmploymentChangeType, string> = {
  POSITION_CHANGE: "Position",
  DEPARTMENT_TRANSFER: "Department transfer",
  MANAGER_CHANGE: "Manager change",
  LOCATION_CHANGE: "Location change",
  EMPLOYMENT_TYPE_CHANGE: "Employment type change",
  STATUS_CHANGE: "Status change",
  TERMINATION: "Termination",
  LEGAL_ENTITY_TRANSFER: "Company transfer",
};

export const changeStatusLabels: Record<EmploymentChangeStatus, string> = {
  SCHEDULED: "Scheduled",
  APPLIED: "Applied",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

export const historySourceLabels: Record<EmploymentHistorySource, string> = {
  CHANGE: "HR change",
  SCHEDULED: "Scheduled change",
  CORRECTION: "Correction",
  MIGRATION: "Recorded at migration",
  SYNC: "Placement in Team or Organization",
};

/** Reasons HR may give when ending employment (E-03 §104). */
export const TERMINATION_REASONS = ["RESIGNATION", "DISMISSAL", "END_OF_CONTRACT", "RETIREMENT", "MUTUAL_AGREEMENT", "OTHER"] as const satisfies readonly EmploymentStatusReason[];

/** Reasons for a status change that is not an ending (E-03 §102). */
export const STATUS_CHANGE_REASONS = ["LEAVE", "RETURN", "SUSPENSION", "OTHER"] as const satisfies readonly EmploymentStatusReason[];

/** Reasons for a change of position or title (E-03 §15, §29). */
export const POSITION_REASONS = ["PROMOTION", "DEMOTION", "TITLE_CHANGE", "REORGANIZATION", "OTHER"] as const satisfies readonly EmploymentAssignmentReason[];
