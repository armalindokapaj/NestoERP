import type {
  ChecklistItemResult,
  CorrectiveActionStatus,
  InspectionRequestStatus,
  InspectionResponseType,
  InspectionTemplateStatus,
  MaterialReleaseStatus,
  NCRCategory,
  NCRStatus,
  QualityApprovalStatus,
  QualityDefectStatus,
  QualityInspectionResult,
  QualityInspectionStatus,
  QualityInspectionType,
  QualityPriority,
  QualitySeverity,
} from "@prisma/client";

/**
 * QA/QC lifecycles (PRD #21 §63–§88, §115, §127, §143).
 *
 * The distinction the whole module turns on: **status is where the record is,
 * result is what was found** (PRD #21 §65). An inspection can sit at
 * PENDING_APPROVAL with a result of FAIL — the inspector has finished and found
 * a problem, and somebody still has to sign it off. Collapsing the two into one
 * field would make that state impossible to express.
 */

/* -------------------------------------------------------------------------- */
/* Shared vocabulary                                                           */
/* -------------------------------------------------------------------------- */

export const INSPECTION_TYPES = ["MATERIAL", "WORK", "GENERAL"] as const;

export const inspectionTypeLabels: Record<QualityInspectionType, string> = {
  MATERIAL: "Material",
  WORK: "Work",
  GENERAL: "General",
};

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const priorityLabels: Record<QualityPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const severityLabels: Record<QualitySeverity, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

/* -------------------------------------------------------------------------- */
/* Inspection requests                                                         */
/* -------------------------------------------------------------------------- */

export const REQUEST_STATUSES = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

export const requestStatusLabels: Record<InspectionRequestStatus, string> = {
  OPEN: "Open",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export function isRequestEditable(status: InspectionRequestStatus): boolean {
  return status === "OPEN" || status === "ASSIGNED";
}

export function isRequestAssignable(status: InspectionRequestStatus): boolean {
  return status === "OPEN" || status === "ASSIGNED";
}

export function isRequestCancellable(status: InspectionRequestStatus): boolean {
  return status !== "COMPLETED" && status !== "CANCELLED";
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export const TEMPLATE_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;

export const templateStatusLabels: Record<InspectionTemplateStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

export const RESPONSE_TYPES = [
  "PASS_FAIL",
  "PASS_FAIL_NA",
  "TEXT",
  "NUMBER",
  "BOOLEAN",
] as const;

export const responseTypeLabels: Record<InspectionResponseType, string> = {
  PASS_FAIL: "Pass / fail",
  PASS_FAIL_NA: "Pass / fail / N/A",
  TEXT: "Written answer",
  NUMBER: "Measurement",
  BOOLEAN: "Yes / no",
};

/** Only an active template may be used on a new inspection (PRD #21 §52). */
export function isTemplateUsable(status: InspectionTemplateStatus): boolean {
  return status === "ACTIVE";
}

/**
 * Which response types produce a pass/fail verdict at all.
 *
 * A measurement or a written answer is evidence, not a verdict: the inspector
 * still has to say whether it passed (PRD #21 §55, §71).
 */
export function isVerdictResponse(type: InspectionResponseType): boolean {
  return type === "PASS_FAIL" || type === "PASS_FAIL_NA";
}

export function allowsNotApplicable(type: InspectionResponseType): boolean {
  return type === "PASS_FAIL_NA";
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

export const INSPECTION_STATUSES = [
  "DRAFT",
  "IN_PROGRESS",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "CLOSED",
  "CANCELLED",
] as const;

export const inspectionStatusLabels: Record<QualityInspectionStatus, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In progress",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const INSPECTION_RESULTS = ["NOT_SET", "PASS", "FAIL", "CONDITIONAL"] as const;

export const inspectionResultLabels: Record<QualityInspectionResult, string> = {
  NOT_SET: "No result yet",
  PASS: "Pass",
  FAIL: "Fail",
  CONDITIONAL: "Conditional",
};

export const CHECKLIST_RESULTS = ["PASS", "FAIL", "NA"] as const;

export const checklistResultLabels: Record<ChecklistItemResult, string> = {
  PASS: "Pass",
  FAIL: "Fail",
  NA: "N/A",
};

/** The header may be edited while it is still being set up (PRD #21 §66). */
export function isInspectionEditable(status: QualityInspectionStatus): boolean {
  return status === "DRAFT";
}

/** The checklist is answered while the inspection is under way (PRD #21 §72). */
export function isInspectionExecutable(status: QualityInspectionStatus): boolean {
  return status === "DRAFT" || status === "IN_PROGRESS";
}

export function isInspectionSubmittable(status: QualityInspectionStatus): boolean {
  return status === "IN_PROGRESS";
}

export function isInspectionDecidable(status: QualityInspectionStatus): boolean {
  return status === "PENDING_APPROVAL";
}

export function isInspectionCloseable(status: QualityInspectionStatus): boolean {
  return status === "APPROVED";
}

/** Rework after a rejection, which never erases the rejection (PRD #21 §82). */
export function isInspectionReworkable(status: QualityInspectionStatus): boolean {
  return status === "REJECTED";
}

export function isInspectionCancellable(status: QualityInspectionStatus): boolean {
  return status === "DRAFT" || status === "IN_PROGRESS";
}

/**
 * A closed inspection stays closed (PRD #21 §88).
 *
 * The answer to "it needs looking at again" is a reinspection, which is a new
 * record with its own verdict — not a rewrite of the one somebody signed.
 * Reopening exists for data correction and is gated on its own permission.
 */
export function isInspectionReopenable(status: QualityInspectionStatus): boolean {
  return status === "CLOSED";
}

/** A cancelled inspection releases nothing (PRD #21 §87). */
export function hasQualityEffect(status: QualityInspectionStatus): boolean {
  return status === "APPROVED" || status === "CLOSED";
}

/* -------------------------------------------------------------------------- */
/* Result consistency                                                          */
/* -------------------------------------------------------------------------- */

export type ChecklistAnswer = {
  required: boolean;
  responseType: InspectionResponseType;
  result: ChecklistItemResult | null;
  responseValue: string | null;
  note: string | null;
  requiresEvidenceOnFail: boolean;
};

export type ChecklistProblem =
  | { kind: "UNANSWERED"; label: string }
  | { kind: "MISSING_NOTE"; label: string };

/**
 * What still stands between the inspector and submitting (PRD #21 §75).
 *
 * Every required item answered, and every failure explained. A checklist with a
 * blank FAIL is an accusation with no evidence behind it, which is exactly what
 * somebody will need when they read it back in a year.
 */
export function checklistProblems(
  items: (ChecklistAnswer & { label: string })[],
): ChecklistProblem[] {
  const problems: ChecklistProblem[] = [];

  for (const item of items) {
    const answered = isVerdictResponse(item.responseType)
      ? item.result !== null
      : (item.responseValue ?? "").trim() !== "";

    if (item.required && !answered) {
      problems.push({ kind: "UNANSWERED", label: item.label });
      continue;
    }

    if (item.result === "FAIL" && item.requiresEvidenceOnFail) {
      if ((item.note ?? "").trim() === "") {
        problems.push({ kind: "MISSING_NOTE", label: item.label });
      }
    }
  }

  return problems;
}

/**
 * Whether an overall result can honestly be claimed (PRD #21 §76, §77).
 *
 * A required item that failed makes an overall PASS impossible. The inspector
 * may still call it CONDITIONAL — accepted with a condition is a real and
 * useful verdict — but they may not call a failure a pass.
 */
export function allowedOverallResults(
  items: ChecklistAnswer[],
): Exclude<QualityInspectionResult, "NOT_SET">[] {
  const failedRequired = items.some((item) => item.required && item.result === "FAIL");
  return failedRequired ? ["FAIL", "CONDITIONAL"] : ["PASS", "FAIL", "CONDITIONAL"];
}

/** A conditional acceptance has to say what the condition is (PRD #21 §78). */
export function requiresDecisionNote(result: QualityInspectionResult): boolean {
  return result === "CONDITIONAL";
}

/**
 * Whether a verdict may be closed out without any follow-up
 * (PRD #21 §84, §85, §86).
 *
 * A pass closes on its own — there is nothing to chase. A failure or a
 * conditional acceptance needs either a record of what will be done about it,
 * or somebody stating in writing that nothing will be.
 */
export function closesWithoutFollowUp(result: QualityInspectionResult): boolean {
  return result === "PASS";
}

/* -------------------------------------------------------------------------- */
/* Defects                                                                     */
/* -------------------------------------------------------------------------- */

export const DEFECT_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
  "CANCELLED",
  "REOPENED",
] as const;

export const defectStatusLabels: Record<QualityDefectStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
  REOPENED: "Reopened",
};

export function isDefectEditable(status: QualityDefectStatus): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}

export function isDefectResolvable(status: QualityDefectStatus): boolean {
  return status === "OPEN" || status === "IN_PROGRESS" || status === "REOPENED";
}

/**
 * Closing is a second pair of eyes (PRD #21 §118, §119).
 *
 * Whoever fixed it says RESOLVED; somebody else agrees it is actually fixed and
 * says CLOSED. One person doing both would make the status meaningless.
 */
export function isDefectCloseable(status: QualityDefectStatus): boolean {
  return status === "RESOLVED";
}

export function isDefectReopenable(status: QualityDefectStatus): boolean {
  return status === "RESOLVED" || status === "CLOSED";
}

export function isDefectCancellable(status: QualityDefectStatus): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}

/* -------------------------------------------------------------------------- */
/* NCRs                                                                        */
/* -------------------------------------------------------------------------- */

export const NCR_STATUSES = [
  "DRAFT",
  "OPEN",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "PENDING_APPROVAL",
  "APPROVED_FOR_CLOSE",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
  "REOPENED",
] as const;

export const ncrStatusLabels: Record<NCRStatus, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  PENDING_VERIFICATION: "Pending verification",
  PENDING_APPROVAL: "Pending approval",
  APPROVED_FOR_CLOSE: "Approved for close",
  CLOSED: "Closed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  REOPENED: "Reopened",
};

export const NCR_CATEGORIES = [
  "MATERIAL",
  "WORKMANSHIP",
  "DOCUMENTATION",
  "PROCESS",
  "SUPPLIER",
  "DESIGN",
  "OTHER",
] as const;

export const ncrCategoryLabels: Record<NCRCategory, string> = {
  MATERIAL: "Material",
  WORKMANSHIP: "Workmanship",
  DOCUMENTATION: "Documentation",
  PROCESS: "Process",
  SUPPLIER: "Supplier",
  DESIGN: "Design",
  OTHER: "Other",
};

export function isNcrEditable(status: NCRStatus): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}

export function isNcrOpenable(status: NCRStatus): boolean {
  return status === "DRAFT";
}

export function isNcrSubmittable(status: NCRStatus): boolean {
  return (
    status === "OPEN" ||
    status === "IN_PROGRESS" ||
    status === "PENDING_VERIFICATION" ||
    status === "REOPENED"
  );
}

export function isNcrDecidable(status: NCRStatus): boolean {
  return status === "PENDING_APPROVAL";
}

export function isNcrCloseable(status: NCRStatus): boolean {
  return status === "APPROVED_FOR_CLOSE";
}

export function isNcrReopenable(status: NCRStatus): boolean {
  return status === "CLOSED";
}

export function isNcrCancellable(status: NCRStatus): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}

export type NcrClosureGap =
  | "ROOT_CAUSE"
  | "CORRECTIVE_ACTION"
  | "UNVERIFIED_ACTION"
  | "CLOSURE_NOTE";

/**
 * What an NCR still needs before it can be closed (PRD #21 §136, §137).
 *
 * This is the entire difference between an NCR and a defect. A defect closes
 * when the work is fixed; an NCR closes only when somebody has written down
 * *why it happened* and *what was done so it does not happen again*, and
 * somebody else has verified that action. Without those, closing an NCR records
 * that a problem stopped being discussed rather than that it was solved.
 */
export function ncrClosureGaps(input: {
  rootCause: string | null;
  closureNote: string | null;
  actions: { status: CorrectiveActionStatus }[];
  severity: QualitySeverity;
}): NcrClosureGap[] {
  const gaps: NcrClosureGap[] = [];

  if ((input.rootCause ?? "").trim() === "") gaps.push("ROOT_CAUSE");

  const live = input.actions.filter((action) => action.status !== "CANCELLED");
  if (live.length === 0) gaps.push("CORRECTIVE_ACTION");
  else if (!live.every((action) => action.status === "VERIFIED")) {
    gaps.push("UNVERIFIED_ACTION");
  }

  // A critical non-conformance also has to say, in writing, how it was closed:
  // the severity is the reason somebody will read this again (PRD #21 §137).
  if (input.severity === "CRITICAL" && (input.closureNote ?? "").trim() === "") {
    gaps.push("CLOSURE_NOTE");
  }

  return gaps;
}

export const ncrClosureGapLabels: Record<NcrClosureGap, string> = {
  ROOT_CAUSE: "Record the root cause.",
  CORRECTIVE_ACTION: "Raise at least one corrective action.",
  UNVERIFIED_ACTION: "Every corrective action has to be verified first.",
  CLOSURE_NOTE: "A critical non-conformance needs a written closure note.",
};

/* -------------------------------------------------------------------------- */
/* Corrective actions                                                          */
/* -------------------------------------------------------------------------- */

export const CORRECTIVE_ACTION_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "VERIFIED",
  "REJECTED",
  "CANCELLED",
  "REOPENED",
] as const;

export const correctiveActionStatusLabels: Record<CorrectiveActionStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  PENDING_VERIFICATION: "Pending verification",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  REOPENED: "Reopened",
};

export function isActionEditable(status: CorrectiveActionStatus): boolean {
  return status !== "VERIFIED" && status !== "CANCELLED";
}

export function isActionCompletable(status: CorrectiveActionStatus): boolean {
  return (
    status === "OPEN" ||
    status === "IN_PROGRESS" ||
    status === "REJECTED" ||
    status === "REOPENED"
  );
}

/** Verification is somebody other than whoever did the work (PRD #21 §147). */
export function isActionVerifiable(status: CorrectiveActionStatus): boolean {
  return status === "PENDING_VERIFICATION";
}

export function isActionReopenable(status: CorrectiveActionStatus): boolean {
  return status === "VERIFIED";
}

export function isActionCancellable(status: CorrectiveActionStatus): boolean {
  return status !== "VERIFIED" && status !== "CANCELLED";
}

/* -------------------------------------------------------------------------- */
/* Approvals                                                                   */
/* -------------------------------------------------------------------------- */

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

export const approvalStatusLabels: Record<QualityApprovalStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

/* -------------------------------------------------------------------------- */
/* Material release                                                            */
/* -------------------------------------------------------------------------- */

export const RELEASE_STATUSES = [
  "RELEASED",
  "PARTIALLY_RELEASED",
  "HELD",
  "REJECTED",
  "REVOKED",
] as const;

export const releaseStatusLabels: Record<MaterialReleaseStatus, string> = {
  RELEASED: "Released",
  PARTIALLY_RELEASED: "Partly released",
  HELD: "Held",
  REJECTED: "Rejected",
  REVOKED: "Revoked",
};

/** A revoked release stops Inventory posting against it (PRD #21 §103). */
export function allowsInventoryPosting(status: MaterialReleaseStatus): boolean {
  return status === "RELEASED" || status === "PARTIALLY_RELEASED";
}
