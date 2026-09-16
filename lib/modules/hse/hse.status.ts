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
  HseSeverity,
  HseTemplateStatus,
  PpeCheckResult,
  StopWorkStatus,
  ToolboxAttendanceStatus,
  ToolboxTalkStatus,
} from "@prisma/client";

/**
 * HSE lifecycles (PRD #22 §37, §61, §81, §103, §118, §131, §144, §166, §172).
 *
 * Three rules run through all of them.
 *
 * **Status is where the record is; result is what was found** (PRD #22 §37,
 * §38) — the same split QA/QC uses. An inspection sits at PENDING_APPROVAL with
 * a result of FAIL: the inspector is done and found a problem, and somebody
 * still has to sign it off.
 *
 * **Nobody verifies their own work** (PRD #22 §52, §122, §149, §182). Whoever
 * submitted an inspection, completed an action or requested a permit is not the
 * person who says it is good. The services enforce it; these helpers only say
 * which transitions exist at all.
 *
 * **A safety record closes when the control is actually in** (PRD #22 §73,
 * §95, §174) — not when somebody is tired of looking at it. Hazard closure
 * wants its actions verified, incident closure wants a root cause, and a
 * stop-work release wants the thing that caused it resolved.
 */

/* -------------------------------------------------------------------------- */
/* Shared vocabulary                                                           */
/* -------------------------------------------------------------------------- */

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const severityLabels: Record<HseSeverity, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const priorityLabels: Record<HsePriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

/** Severity that makes a record something the company must not lose track of. */
export function isSeriousSeverity(severity: HseSeverity): boolean {
  return severity === "HIGH" || severity === "CRITICAL";
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

export const INSPECTION_TYPES = [
  "SITE_SAFETY",
  "PPE",
  "HOUSEKEEPING",
  "WORK_AT_HEIGHT",
  "ELECTRICAL",
  "FIRE_SAFETY",
  "EXCAVATION",
  "LIFTING",
  "ENVIRONMENTAL",
  "GENERAL",
] as const;

export const inspectionTypeLabels: Record<HseInspectionType, string> = {
  SITE_SAFETY: "Site safety",
  PPE: "PPE",
  HOUSEKEEPING: "Housekeeping",
  WORK_AT_HEIGHT: "Work at height",
  ELECTRICAL: "Electrical",
  FIRE_SAFETY: "Fire safety",
  EXCAVATION: "Excavation",
  LIFTING: "Lifting",
  ENVIRONMENTAL: "Environmental",
  GENERAL: "General",
};

export const INSPECTION_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "IN_PROGRESS",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "CLOSED",
  "CANCELLED",
] as const;

export const inspectionStatusLabels: Record<HseInspectionStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const INSPECTION_RESULTS = ["NOT_SET", "PASS", "FAIL", "CONDITIONAL"] as const;

export const inspectionResultLabels: Record<HseInspectionResult, string> = {
  NOT_SET: "Not set",
  PASS: "Pass",
  FAIL: "Fail",
  CONDITIONAL: "Conditional",
};

/** DRAFT and SCHEDULED are still being set up (PRD #22 §50). */
export function isInspectionEditable(status: HseInspectionStatus): boolean {
  return status === "DRAFT" || status === "SCHEDULED";
}

/** Starting the walk-round (PRD #22 §50). */
export function canStartInspection(status: HseInspectionStatus): boolean {
  return status === "DRAFT" || status === "SCHEDULED" || status === "REJECTED";
}

/** Answering the checklist (PRD #22 §41). */
export function isInspectionExecutable(status: HseInspectionStatus): boolean {
  return status === "IN_PROGRESS";
}

export function isInspectionSubmittable(status: HseInspectionStatus): boolean {
  return status === "IN_PROGRESS";
}

export function isInspectionDecidable(status: HseInspectionStatus): boolean {
  return status === "PENDING_APPROVAL";
}

export function isInspectionClosable(status: HseInspectionStatus): boolean {
  return status === "APPROVED";
}

/** Only before anybody has signed anything (PRD #22 §56). */
export function isInspectionCancellable(status: HseInspectionStatus): boolean {
  return status === "DRAFT" || status === "SCHEDULED" || status === "IN_PROGRESS";
}

export const RESPONSE_TYPES = [
  "PASS_FAIL",
  "PASS_FAIL_NA",
  "BOOLEAN",
  "TEXT",
  "NUMBER",
] as const;

export const responseTypeLabels: Record<HseChecklistResponseType, string> = {
  PASS_FAIL: "Pass / fail",
  PASS_FAIL_NA: "Pass / fail / N-A",
  BOOLEAN: "Yes / no",
  TEXT: "Text",
  NUMBER: "Number",
};

export const checklistResultLabels: Record<HseChecklistResult, string> = {
  PASS: "Pass",
  FAIL: "Fail",
  NA: "N/A",
};

/** Which verdicts a given response type may carry (PRD #22 §46). */
export function allowedChecklistResults(
  responseType: HseChecklistResponseType,
): HseChecklistResult[] {
  switch (responseType) {
    case "PASS_FAIL":
    case "BOOLEAN":
      return ["PASS", "FAIL"];
    case "PASS_FAIL_NA":
      return ["PASS", "FAIL", "NA"];
    case "TEXT":
    case "NUMBER":
      return ["PASS", "FAIL", "NA"];
  }
}

export type ChecklistAnswer = {
  label: string;
  required: boolean;
  responseType: HseChecklistResponseType;
  result: HseChecklistResult | null;
  responseValue: string | null;
  note: string | null;
  requiresNoteOnFail: boolean;
};

export type ChecklistGap =
  | { kind: "UNANSWERED"; label: string }
  | { kind: "MISSING_VALUE"; label: string }
  | { kind: "MISSING_NOTE"; label: string };

/**
 * What still stands between a half-done checklist and a submission
 * (PRD #22 §51).
 *
 * Returned as a list rather than a boolean so the page can name the items the
 * inspector still has to deal with. Being told "not ready" and left to hunt
 * through forty rows for the one that is blank is how checklists get
 * abandoned half-finished.
 */
export function checklistGaps(items: ChecklistAnswer[]): ChecklistGap[] {
  const gaps: ChecklistGap[] = [];

  for (const item of items) {
    if (item.required && item.result === null) {
      gaps.push({ kind: "UNANSWERED", label: item.label });
      continue;
    }

    // A text or number question is answered by its value, not by its verdict.
    const needsValue = item.responseType === "TEXT" || item.responseType === "NUMBER";
    if (item.required && needsValue && (item.responseValue ?? "").trim() === "") {
      gaps.push({ kind: "MISSING_VALUE", label: item.label });
      continue;
    }

    if (item.result === "FAIL" && item.requiresNoteOnFail && (item.note ?? "").trim() === "") {
      gaps.push({ kind: "MISSING_NOTE", label: item.label });
    }
  }

  return gaps;
}

/**
 * Which overall results the answers can honestly support (PRD #22 §49, §51).
 *
 * A required item failed, so the inspection did not pass. It may still be
 * CONDITIONAL — the work can continue under a control — but PASS is not on the
 * table, and offering it is how a failed fire-exit check becomes a passed
 * inspection.
 */
export function allowedOverallResults(items: ChecklistAnswer[]): HseInspectionResult[] {
  const failedRequired = items.some((item) => item.required && item.result === "FAIL");
  return failedRequired ? ["FAIL", "CONDITIONAL"] : ["PASS", "FAIL", "CONDITIONAL"];
}

/**
 * Whether a result may be closed out without a disposition (PRD #22 §55).
 *
 * A PASS closes on its own. A FAIL or a CONDITIONAL says something was wrong,
 * so closing it needs a hazard, an action or a written disposition — otherwise
 * "closed" would mean "we stopped talking about it".
 */
export function closureNeedsDisposition(result: HseInspectionResult): boolean {
  return result === "FAIL" || result === "CONDITIONAL";
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export const TEMPLATE_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;

export const templateStatusLabels: Record<HseTemplateStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

/** Only an active template may be picked for a new inspection (PRD #22 §44). */
export function isTemplateUsable(status: HseTemplateStatus): boolean {
  return status === "ACTIVE";
}

/* -------------------------------------------------------------------------- */
/* Hazards                                                                     */
/* -------------------------------------------------------------------------- */

export const HAZARD_CATEGORIES = [
  "WORK_AT_HEIGHT",
  "ELECTRICAL",
  "FIRE",
  "EXCAVATION",
  "LIFTING",
  "MACHINERY",
  "VEHICLE",
  "HOUSEKEEPING",
  "PPE",
  "CHEMICAL",
  "ENVIRONMENTAL",
  "ERGONOMIC",
  "OTHER",
] as const;

export const hazardCategoryLabels: Record<HseHazardCategory, string> = {
  WORK_AT_HEIGHT: "Work at height",
  ELECTRICAL: "Electrical",
  FIRE: "Fire",
  EXCAVATION: "Excavation",
  LIFTING: "Lifting",
  MACHINERY: "Machinery",
  VEHICLE: "Vehicle",
  HOUSEKEEPING: "Housekeeping",
  PPE: "PPE",
  CHEMICAL: "Chemical",
  ENVIRONMENTAL: "Environmental",
  ERGONOMIC: "Ergonomic",
  OTHER: "Other",
};

export const HAZARD_STATUSES = [
  "OPEN",
  "CONTROLLED",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "CLOSED",
  "CANCELLED",
  "REOPENED",
] as const;

export const hazardStatusLabels: Record<HseHazardStatus, string> = {
  OPEN: "Open",
  CONTROLLED: "Controlled",
  IN_PROGRESS: "In progress",
  PENDING_VERIFICATION: "Pending verification",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
  REOPENED: "Reopened",
};

/** A closed hazard is read-only until somebody reopens it (PRD #22 §353). */
export function isHazardEditable(status: HseHazardStatus): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}

export function isHazardClosable(status: HseHazardStatus): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}

export function isHazardReopenable(status: HseHazardStatus): boolean {
  return status === "CLOSED";
}

export function isHazardCancellable(status: HseHazardStatus): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}

/** Statuses that still count as live on the register (PRD #22 §203). */
export const OPEN_HAZARD_STATUSES: HseHazardStatus[] = [
  "OPEN",
  "CONTROLLED",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "REOPENED",
];

export type HazardClosureGap =
  | "CONTROL_MEASURE"
  | "CLOSURE_NOTE"
  | "RESIDUAL_RISK"
  | "UNVERIFIED_ACTION";

/**
 * What stands between a hazard and its closure (PRD #22 §73).
 *
 * The control has to be described, the closure has to be explained, any actions
 * raised against it have to be verified by somebody, and a hazard that was HIGH
 * or CRITICAL has to say what the risk is now. A hazard closed without those is
 * a hazard that was filed rather than fixed.
 */
export function hazardClosureGaps(input: {
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  controlMeasure: string | null;
  closureNote: string | null;
  residualRiskScore: number | null;
  actions: { status: HseActionStatus }[];
}): HazardClosureGap[] {
  const gaps: HazardClosureGap[] = [];

  if ((input.controlMeasure ?? "").trim() === "") gaps.push("CONTROL_MEASURE");
  if ((input.closureNote ?? "").trim() === "") gaps.push("CLOSURE_NOTE");

  if (
    (input.riskLevel === "HIGH" || input.riskLevel === "CRITICAL") &&
    input.residualRiskScore == null
  ) {
    gaps.push("RESIDUAL_RISK");
  }

  // A cancelled action was withdrawn on purpose and does not hold closure up.
  const live = input.actions.filter((action) => action.status !== "CANCELLED");
  if (live.some((action) => action.status !== "VERIFIED")) {
    gaps.push("UNVERIFIED_ACTION");
  }

  return gaps;
}

export const hazardClosureGapLabels: Record<HazardClosureGap, string> = {
  CONTROL_MEASURE: "Record the control that was put in place.",
  CLOSURE_NOTE: "Write a closure note.",
  RESIDUAL_RISK: "Assess the residual risk left after the control.",
  UNVERIFIED_ACTION: "Every action raised against this hazard must be verified.",
};

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

export const INCIDENT_TYPES = [
  "INCIDENT",
  "NEAR_MISS",
  "FIRST_AID",
  "PROPERTY_DAMAGE",
  "ENVIRONMENTAL_EVENT",
  "VEHICLE_EVENT",
  "FIRE_EVENT",
  "OTHER",
] as const;

export const incidentTypeLabels: Record<HseIncidentType, string> = {
  INCIDENT: "Incident",
  NEAR_MISS: "Near miss",
  FIRST_AID: "First aid",
  PROPERTY_DAMAGE: "Property damage",
  ENVIRONMENTAL_EVENT: "Environmental event",
  VEHICLE_EVENT: "Vehicle event",
  FIRE_EVENT: "Fire event",
  OTHER: "Other",
};

export const INCIDENT_STATUSES = [
  "OPEN",
  "UNDER_INVESTIGATION",
  "ACTIONS_OPEN",
  "PENDING_CLOSE",
  "CLOSED",
  "CANCELLED",
  "REOPENED",
] as const;

export const incidentStatusLabels: Record<HseIncidentStatus, string> = {
  OPEN: "Open",
  UNDER_INVESTIGATION: "Under investigation",
  ACTIONS_OPEN: "Actions open",
  PENDING_CLOSE: "Pending close",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
  REOPENED: "Reopened",
};

/** A closed incident is read-only until it is reopened (PRD #22 §352). */
export function isIncidentEditable(status: HseIncidentStatus): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}

/**
 * Whether the incident's facts and findings may still change (PRD #47 §85).
 *
 * Put up for closure, the incident is being decided on what it says now — the
 * severity, the root cause, the investigation. Rewriting those while the
 * approver reads them would have the closure signed against a record that no
 * longer exists. Actions and stop-work stay available: a new danger never
 * waits on a decision.
 */
export function isIncidentRecordEditable(status: HseIncidentStatus): boolean {
  return isIncidentEditable(status) && status !== "PENDING_CLOSE";
}

export function isIncidentInvestigable(status: HseIncidentStatus): boolean {
  return status === "OPEN" || status === "REOPENED" || status === "UNDER_INVESTIGATION";
}

export function isIncidentSubmittableForClose(status: HseIncidentStatus): boolean {
  return status === "UNDER_INVESTIGATION" || status === "ACTIONS_OPEN";
}

export function isIncidentClosable(status: HseIncidentStatus): boolean {
  return status === "PENDING_CLOSE";
}

export function isIncidentReopenable(status: HseIncidentStatus): boolean {
  return status === "CLOSED";
}

export function isIncidentCancellable(status: HseIncidentStatus): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}

export const OPEN_INCIDENT_STATUSES: HseIncidentStatus[] = [
  "OPEN",
  "UNDER_INVESTIGATION",
  "ACTIONS_OPEN",
  "PENDING_CLOSE",
  "REOPENED",
];

export type IncidentClosureGap =
  | "ROOT_CAUSE"
  | "INVESTIGATION_SUMMARY"
  | "CLOSURE_NOTE"
  | "UNVERIFIED_ACTION";

/**
 * What stands between an incident and its closure (PRD #22 §95, §363).
 *
 * A serious incident cannot close without a root cause. That is the whole point
 * of investigating one: an incident closed with "operative was careless" and no
 * cause teaches the company nothing and will happen again. LOW and MEDIUM are
 * recommended to have one but not held up by it (PRD #22 §364).
 */
export function incidentClosureGaps(input: {
  severity: HseSeverity;
  rootCause: string | null;
  investigationSummary: string | null;
  closureNote: string | null;
  actions: { status: HseActionStatus }[];
}): IncidentClosureGap[] {
  const gaps: IncidentClosureGap[] = [];
  const serious = isSeriousSeverity(input.severity);

  if (serious && (input.rootCause ?? "").trim() === "") gaps.push("ROOT_CAUSE");
  if (serious && (input.investigationSummary ?? "").trim() === "") {
    gaps.push("INVESTIGATION_SUMMARY");
  }
  if ((input.closureNote ?? "").trim() === "") gaps.push("CLOSURE_NOTE");

  const live = input.actions.filter((action) => action.status !== "CANCELLED");
  if (live.some((action) => action.status !== "VERIFIED")) gaps.push("UNVERIFIED_ACTION");

  return gaps;
}

export const incidentClosureGapLabels: Record<IncidentClosureGap, string> = {
  ROOT_CAUSE: "A high or critical incident needs a root cause before it closes.",
  INVESTIGATION_SUMMARY: "A high or critical incident needs an investigation summary.",
  CLOSURE_NOTE: "Write a closure note.",
  UNVERIFIED_ACTION: "Every action raised against this incident must be verified.",
};

/** An immediate action is required as soon as it is serious (PRD #22 §362). */
export function requiresImmediateAction(severity: HseSeverity): boolean {
  return isSeriousSeverity(severity);
}

/* -------------------------------------------------------------------------- */
/* Risk assessments                                                            */
/* -------------------------------------------------------------------------- */

export const RISK_ASSESSMENT_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "ARCHIVED",
] as const;

export const riskAssessmentStatusLabels: Record<HseRiskAssessmentStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  ARCHIVED: "Archived",
};

/** Only a draft may be edited; an approved assessment is frozen (PRD #22 §107). */
export function isRiskAssessmentEditable(status: HseRiskAssessmentStatus): boolean {
  return status === "DRAFT";
}

export function isRiskAssessmentSubmittable(status: HseRiskAssessmentStatus): boolean {
  return status === "DRAFT";
}

export function isRiskAssessmentDecidable(status: HseRiskAssessmentStatus): boolean {
  return status === "PENDING_APPROVAL";
}

export function isRiskAssessmentArchivable(status: HseRiskAssessmentStatus): boolean {
  return status === "APPROVED";
}

/** A material change to an approved assessment makes a version (PRD #22 §112). */
export function requiresNewVersion(status: HseRiskAssessmentStatus): boolean {
  return status === "APPROVED" || status === "ARCHIVED";
}

/**
 * Whether an approved assessment is due to be looked at again (PRD #22 §359).
 *
 * Nothing is invalidated automatically — a risk assessment that silently expired
 * would stop work on a site with no warning. It is flagged for attention and a
 * person decides.
 */
export function isReviewDue(
  status: HseRiskAssessmentStatus,
  reviewDate: Date | null,
  now = new Date(),
): boolean {
  return status === "APPROVED" && reviewDate != null && reviewDate <= now;
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export const ACTION_TYPES = [
  "CORRECTIVE",
  "PREVENTIVE",
  "IMMEDIATE",
  "FOLLOW_UP",
  "OTHER",
] as const;

export const actionTypeLabels: Record<HseActionType, string> = {
  CORRECTIVE: "Corrective",
  PREVENTIVE: "Preventive",
  IMMEDIATE: "Immediate",
  FOLLOW_UP: "Follow-up",
  OTHER: "Other",
};

export const ACTION_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "VERIFIED",
  "REJECTED",
  "CANCELLED",
  "REOPENED",
] as const;

export const actionStatusLabels: Record<HseActionStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  PENDING_VERIFICATION: "Pending verification",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  REOPENED: "Reopened",
};

/** A verified action is read-only until it is reopened (PRD #22 §354). */
export function isActionEditable(status: HseActionStatus): boolean {
  return status !== "VERIFIED" && status !== "CANCELLED";
}

export function isActionStartable(status: HseActionStatus): boolean {
  return status === "OPEN" || status === "REOPENED" || status === "REJECTED";
}

export function isActionCompletable(status: HseActionStatus): boolean {
  return (
    status === "OPEN" ||
    status === "IN_PROGRESS" ||
    status === "REOPENED" ||
    status === "REJECTED"
  );
}

export function isActionVerifiable(status: HseActionStatus): boolean {
  return status === "PENDING_VERIFICATION";
}

export function isActionReopenable(status: HseActionStatus): boolean {
  return status === "VERIFIED";
}

export function isActionCancellable(status: HseActionStatus): boolean {
  return status !== "VERIFIED" && status !== "CANCELLED";
}

export const OPEN_ACTION_STATUSES: HseActionStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "REJECTED",
  "REOPENED",
];

/** Overdue means a due date in the past and the work not yet signed off. */
export function isActionOverdue(
  status: HseActionStatus,
  dueDate: Date | null,
  now = new Date(),
): boolean {
  if (dueDate == null) return false;
  if (status === "VERIFIED" || status === "CANCELLED") return false;
  return dueDate < now;
}

/* -------------------------------------------------------------------------- */
/* Toolbox talks                                                               */
/* -------------------------------------------------------------------------- */

export const TOOLBOX_STATUSES = ["DRAFT", "COMPLETED", "CANCELLED"] as const;

export const toolboxStatusLabels: Record<ToolboxTalkStatus, string> = {
  DRAFT: "Draft",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const ATTENDANCE_STATUSES = ["ATTENDED", "ABSENT", "EXCUSED"] as const;

export const attendanceLabels: Record<ToolboxAttendanceStatus, string> = {
  ATTENDED: "Attended",
  ABSENT: "Absent",
  EXCUSED: "Excused",
};

export function isToolboxEditable(status: ToolboxTalkStatus): boolean {
  return status === "DRAFT";
}

export function isToolboxCompletable(status: ToolboxTalkStatus): boolean {
  return status === "DRAFT";
}

export function isToolboxCancellable(status: ToolboxTalkStatus): boolean {
  return status !== "CANCELLED";
}

/* -------------------------------------------------------------------------- */
/* Work permits                                                                */
/* -------------------------------------------------------------------------- */

export const PERMIT_TYPES = [
  "HOT_WORK",
  "WORK_AT_HEIGHT",
  "CONFINED_SPACE",
  "EXCAVATION",
  "ELECTRICAL",
  "LIFTING",
  "GENERAL",
  "OTHER",
] as const;

export const permitTypeLabels: Record<HsePermitType, string> = {
  HOT_WORK: "Hot work",
  WORK_AT_HEIGHT: "Work at height",
  CONFINED_SPACE: "Confined space",
  EXCAVATION: "Excavation",
  ELECTRICAL: "Electrical",
  LIFTING: "Lifting",
  GENERAL: "General",
  OTHER: "Other",
};

export const PERMIT_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "ACTIVE",
  "SUSPENDED",
  "EXPIRED",
  "CLOSED",
  "CANCELLED",
] as const;

export const permitStatusLabels: Record<HsePermitStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  EXPIRED: "Expired",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

/** An ACTIVE permit's core terms are frozen (PRD #22 §351). */
export function isPermitEditable(status: HsePermitStatus): boolean {
  return status === "DRAFT";
}

export function isPermitSubmittable(status: HsePermitStatus): boolean {
  return status === "DRAFT";
}

export function isPermitDecidable(status: HsePermitStatus): boolean {
  return status === "PENDING_APPROVAL";
}

/** Reactivation from SUSPENDED uses the same grant (PRD #22 §150, §153). */
export function isPermitActivatable(status: HsePermitStatus): boolean {
  return status === "APPROVED" || status === "SUSPENDED";
}

export function isPermitSuspendable(status: HsePermitStatus): boolean {
  return status === "ACTIVE";
}

export function isPermitClosable(status: HsePermitStatus): boolean {
  return status === "ACTIVE" || status === "SUSPENDED" || status === "EXPIRED";
}

export function isPermitCancellable(status: HsePermitStatus): boolean {
  return status === "DRAFT" || status === "PENDING_APPROVAL" || status === "APPROVED";
}

/**
 * What a permit *is*, as opposed to what the column says (PRD #22 §151, §360).
 *
 * A permit whose window has closed authorises nothing, whatever the stored
 * status says. Reporting and the UI both read through this, so a permit does
 * not stay "active" on a dashboard because no background job has run yet.
 */
export function effectivePermitStatus(
  status: HsePermitStatus,
  validUntil: Date,
  now = new Date(),
): HsePermitStatus {
  if (status === "CLOSED" || status === "CANCELLED" || status === "EXPIRED") return status;
  if (validUntil < now) return "EXPIRED";
  return status;
}

/** Activation only inside the window it authorises (PRD #22 §150). */
export function isWithinValidity(validFrom: Date, validUntil: Date, now = new Date()): boolean {
  return validFrom <= now && validUntil >= now;
}

export const LIVE_PERMIT_STATUSES: HsePermitStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "ACTIVE",
  "SUSPENDED",
];

/* -------------------------------------------------------------------------- */
/* PPE                                                                         */
/* -------------------------------------------------------------------------- */

export const PPE_RESULTS = ["PASS", "FAIL", "CONDITIONAL"] as const;

export const ppeResultLabels: Record<PpeCheckResult, string> = {
  PASS: "Pass",
  FAIL: "Fail",
  CONDITIONAL: "Conditional",
};

/** The equipment a check can speak to, in the order it is worn. */
export const PPE_ITEMS = [
  { key: "helmetOk", label: "Helmet" },
  { key: "eyeProtectionOk", label: "Eye protection" },
  { key: "hearingProtectionOk", label: "Hearing protection" },
  { key: "respiratoryProtectionOk", label: "Respiratory protection" },
  { key: "glovesOk", label: "Gloves" },
  { key: "harnessOk", label: "Harness" },
  { key: "footwearOk", label: "Footwear" },
] as const;

export type PpeItemKey = (typeof PPE_ITEMS)[number]["key"];

/**
 * The verdict the equipment actually supports (PRD #22 §160).
 *
 * Any item explicitly marked not-OK is a failure. A check with nothing recorded
 * is not a pass — it is a check that did not look at anything, and the caller
 * is told so rather than having it recorded as compliance.
 */
export function ppeResultFor(items: Partial<Record<PpeItemKey, boolean | null>>): {
  result: PpeCheckResult | null;
  failed: PpeItemKey[];
} {
  const answered = PPE_ITEMS.filter((item) => items[item.key] != null);
  const failed = answered.filter((item) => items[item.key] === false).map((item) => item.key);

  if (answered.length === 0) return { result: null, failed: [] };
  return { result: failed.length > 0 ? "FAIL" : "PASS", failed };
}

/* -------------------------------------------------------------------------- */
/* Environmental observations                                                  */
/* -------------------------------------------------------------------------- */

export const ENVIRONMENTAL_CATEGORIES = [
  "SPILL",
  "WASTE",
  "DUST",
  "NOISE",
  "WATER",
  "SOIL",
  "EMISSIONS",
  "BIODIVERSITY",
  "OTHER",
] as const;

export const environmentalCategoryLabels: Record<EnvironmentalCategory, string> = {
  SPILL: "Spill",
  WASTE: "Waste",
  DUST: "Dust",
  NOISE: "Noise",
  WATER: "Water",
  SOIL: "Soil",
  EMISSIONS: "Emissions",
  BIODIVERSITY: "Biodiversity",
  OTHER: "Other",
};

export const ENVIRONMENTAL_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "CLOSED",
  "CANCELLED",
  "REOPENED",
] as const;

export const environmentalStatusLabels: Record<EnvironmentalStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  PENDING_VERIFICATION: "Pending verification",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
  REOPENED: "Reopened",
};

export function isObservationEditable(status: EnvironmentalStatus): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}

export function isObservationClosable(status: EnvironmentalStatus): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}

export function isObservationReopenable(status: EnvironmentalStatus): boolean {
  return status === "CLOSED";
}

export const OPEN_ENVIRONMENTAL_STATUSES: EnvironmentalStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "REOPENED",
];

/* -------------------------------------------------------------------------- */
/* Stop work                                                                   */
/* -------------------------------------------------------------------------- */

export const STOP_WORK_STATUSES = ["ACTIVE", "RELEASED", "CANCELLED"] as const;

export const stopWorkStatusLabels: Record<StopWorkStatus, string> = {
  ACTIVE: "Active",
  RELEASED: "Released",
  CANCELLED: "Cancelled",
};

export function isStopWorkReleasable(status: StopWorkStatus): boolean {
  return status === "ACTIVE";
}

export function isStopWorkCancellable(status: StopWorkStatus): boolean {
  return status === "ACTIVE";
}

export type StopWorkReleaseGap = "RELEASE_REASON" | "UNRESOLVED_CRITICAL_ACTION";

/**
 * What stands between a stop-work and sending people back (PRD #22 §174).
 *
 * A critical action raised against the stop-work has to be dealt with first.
 * This is the one release rule that matters: releasing while the thing that
 * stopped the job is still outstanding is how the same accident happens twice
 * in one week.
 */
export function stopWorkReleaseGaps(input: {
  releaseReason: string | null;
  actions: { status: HseActionStatus; priority: HsePriority }[];
}): StopWorkReleaseGap[] {
  const gaps: StopWorkReleaseGap[] = [];

  if ((input.releaseReason ?? "").trim() === "") gaps.push("RELEASE_REASON");

  const unresolvedCritical = input.actions.some(
    (action) =>
      action.priority === "CRITICAL" &&
      action.status !== "VERIFIED" &&
      action.status !== "CANCELLED",
  );
  if (unresolvedCritical) gaps.push("UNRESOLVED_CRITICAL_ACTION");

  return gaps;
}

export const stopWorkReleaseGapLabels: Record<StopWorkReleaseGap, string> = {
  RELEASE_REASON: "Say why it is safe to resume.",
  UNRESOLVED_CRITICAL_ACTION:
    "Every critical action raised against this stop-work must be verified first.",
};

/* -------------------------------------------------------------------------- */
/* Approvals                                                                   */
/* -------------------------------------------------------------------------- */

export const APPROVAL_RECORD_TYPES = [
  "INSPECTION",
  "RISK_ASSESSMENT",
  "WORK_PERMIT",
  "INCIDENT_CLOSE",
] as const;

export const approvalRecordTypeLabels: Record<HseApprovalRecordType, string> = {
  INSPECTION: "Inspection",
  RISK_ASSESSMENT: "Risk assessment",
  WORK_PERMIT: "Work permit",
  INCIDENT_CLOSE: "Incident close",
};

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

export const approvalStatusLabels: Record<HseApprovalStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
