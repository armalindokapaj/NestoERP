import { z } from "zod";

import { businessDate, optionalBusinessDate } from "@/lib/modules/finance/finance.fields";
import {
  optionalBoolean,
  optionalId,
  optionalText,
  requiredText,
} from "@/lib/modules/shared/fields";
import { paginationSchema } from "@/lib/modules/shared/list-query";
import { RISK_LEVELS, RISK_MAX, RISK_MIN } from "./hse.risk";
import {
  ACTION_STATUSES,
  ACTION_TYPES,
  ATTENDANCE_STATUSES,
  ENVIRONMENTAL_CATEGORIES,
  ENVIRONMENTAL_STATUSES,
  HAZARD_CATEGORIES,
  HAZARD_STATUSES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  INSPECTION_RESULTS,
  INSPECTION_STATUSES,
  INSPECTION_TYPES,
  PERMIT_STATUSES,
  PERMIT_TYPES,
  PRIORITIES,
  RESPONSE_TYPES,
  RISK_ASSESSMENT_STATUSES,
  SEVERITIES,
  STOP_WORK_STATUSES,
  TEMPLATE_STATUSES,
  TOOLBOX_STATUSES,
} from "./hse.status";

/**
 * HSE validation (PRD #22 §271–§279).
 *
 * Two things no schema here accepts.
 *
 * **A risk score or a risk level.** Only `likelihood` and `severity` cross the
 * boundary; the server multiplies them and bands the answer (PRD #22 §243). A
 * schema that took `riskLevel` would let a browser file a critical hazard as
 * LOW and route it away from the people who must see it.
 *
 * **A status.** Records move through named actions — submit, approve, activate,
 * close — so there is nothing for a generic update to set, and no way to type
 * your way past a permit approval.
 */

/** One axis of the 5×5 matrix (PRD #22 §62). */
const riskAxis = (label: string) =>
  z.coerce
    .number()
    .int(`${label} must be a whole number`)
    .min(RISK_MIN, `${label} runs from 1 to 5`)
    .max(RISK_MAX, `${label} runs from 1 to 5`);

const optionalRiskAxis = (label: string) =>
  z
    .union([riskAxis(label), z.literal("").transform(() => undefined)])
    .optional()
    .transform((value) => (value === undefined ? undefined : value));

/** Both residual axes or neither: half an assessment renders as nonsense (§71). */
const residualPair = <T extends { residualLikelihood?: number; residualSeverity?: number }>(
  value: T,
) =>
  (value.residualLikelihood === undefined) === (value.residualSeverity === undefined);

const RESIDUAL_PAIR_MESSAGE =
  "Give both the residual likelihood and the residual severity, or neither.";

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export const templateItemSchema = z.object({
  id: optionalId,
  code: optionalText(40),
  label: requiredText(2, 300, "Label"),
  description: optionalText(2000),
  responseType: z.enum(RESPONSE_TYPES).default("PASS_FAIL"),
  required: optionalBoolean.default(true),
  riskIfFailed: z.enum(SEVERITIES).optional(),
  requiresNoteOnFail: optionalBoolean.default(false),
});

export const templateSchema = z.object({
  code: requiredText(2, 40, "Code"),
  name: requiredText(3, 200, "Name"),
  inspectionType: z.enum(INSPECTION_TYPES),
  description: optionalText(2000),
  items: z.array(templateItemSchema).min(1, "A checklist needs at least one item"),
  versionUpdatedAt: z.coerce.date().optional(),
});

export const templateListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(TEMPLATE_STATUSES)).optional(),
  inspectionType: z.array(z.enum(INSPECTION_TYPES)).optional(),
  sort: z.enum(["recent", "code-asc", "name-asc"]).default("recent"),
});

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

export const inspectionSchema = z.object({
  inspectionType: z.enum(INSPECTION_TYPES),
  projectId: optionalId,
  templateId: optionalId,
  assignedInspectorMemberId: z.string().min(1, "Choose an inspector"),
  scheduledDate: optionalBusinessDate,
  locationText: optionalText(200),
  summary: optionalText(4000),
  versionUpdatedAt: z.coerce.date().optional(),
});

/** One answered checklist row (PRD #22 §48). */
export const checklistAnswerSchema = z.object({
  itemId: z.string().min(1),
  result: z.enum(["PASS", "FAIL", "NA"]).optional(),
  responseValue: optionalText(500),
  note: optionalText(2000),
});

export const executeInspectionSchema = z.object({
  answers: z.array(checklistAnswerSchema),
  versionUpdatedAt: z.coerce.date().optional(),
});

export const submitInspectionSchema = z.object({
  result: z.enum(["PASS", "FAIL", "CONDITIONAL"]),
  summary: optionalText(4000),
  inspectionDate: optionalBusinessDate,
  versionUpdatedAt: z.coerce.date().optional(),
});

export const inspectionDecisionSchema = z.object({
  decisionNote: optionalText(2000),
});

export const inspectionRejectSchema = z.object({
  // A rejection with no reason sends the inspector back with nothing to act on
  // (PRD #22 §53).
  decisionNote: requiredText(3, 2000, "Reason"),
});

export const inspectionCloseSchema = z.object({
  disposition: optionalText(2000),
});

export const inspectionListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  view: z.enum(["all", "mine", "due", "failed"]).default("all"),
  status: z.array(z.enum(INSPECTION_STATUSES)).optional(),
  result: z.array(z.enum(INSPECTION_RESULTS)).optional(),
  inspectionType: z.array(z.enum(INSPECTION_TYPES)).optional(),
  projectId: optionalId,
  assignedInspectorMemberId: optionalId,
  sort: z.enum(["recent", "scheduled-asc", "number-asc"]).default("recent"),
});

/* -------------------------------------------------------------------------- */
/* Hazards                                                                     */
/* -------------------------------------------------------------------------- */

export const hazardSchema = z
  .object({
    title: requiredText(3, 200, "Title"),
    description: requiredText(3, 4000, "Description"),
    projectId: optionalId,
    inspectionId: optionalId,
    hazardCategory: z.enum(HAZARD_CATEGORIES),
    likelihood: riskAxis("Likelihood"),
    severity: riskAxis("Severity"),
    observedAt: businessDate,
    locationText: optionalText(200),
    assignedToMemberId: optionalId,
    immediateControl: optionalText(2000),
    controlMeasure: optionalText(2000),
    dueDate: optionalBusinessDate,
    versionUpdatedAt: z.coerce.date().optional(),
  })
  .refine(
    (value) =>
      // A critical hazard must say what was done about it *now* (PRD #22 §68).
      // Filing one with "we will look at it" is how somebody walks into it.
      value.likelihood * value.severity < 17 ||
      (value.immediateControl ?? "").trim().length > 0,
    {
      message: "A critical hazard needs the immediate control that was put in place.",
      path: ["immediateControl"],
    },
  );

export const hazardAssessSchema = z
  .object({
    likelihood: riskAxis("Likelihood"),
    severity: riskAxis("Severity"),
    controlMeasure: optionalText(2000),
    residualLikelihood: optionalRiskAxis("Residual likelihood"),
    residualSeverity: optionalRiskAxis("Residual severity"),
    versionUpdatedAt: z.coerce.date().optional(),
  })
  .refine(residualPair, { message: RESIDUAL_PAIR_MESSAGE, path: ["residualSeverity"] });

export const hazardControlSchema = z.object({
  immediateControl: optionalText(2000),
  controlMeasure: requiredText(3, 2000, "Control measure"),
});

export const hazardCloseSchema = z
  .object({
    closureNote: requiredText(3, 2000, "Closure note"),
    residualLikelihood: optionalRiskAxis("Residual likelihood"),
    residualSeverity: optionalRiskAxis("Residual severity"),
  })
  .refine(residualPair, { message: RESIDUAL_PAIR_MESSAGE, path: ["residualSeverity"] });

export const hazardReopenSchema = z.object({
  reason: requiredText(3, 2000, "Reason"),
});

export const hazardListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  view: z.enum(["all", "open", "mine", "critical", "overdue"]).default("all"),
  status: z.array(z.enum(HAZARD_STATUSES)).optional(),
  riskLevel: z.array(z.enum(RISK_LEVELS)).optional(),
  hazardCategory: z.array(z.enum(HAZARD_CATEGORIES)).optional(),
  projectId: optionalId,
  assignedToMemberId: optionalId,
  sort: z.enum(["recent", "risk-desc", "due-asc", "number-asc"]).default("recent"),
});

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

export const incidentSchema = z
  .object({
    incidentType: z.enum(INCIDENT_TYPES),
    title: requiredText(3, 200, "Title"),
    description: requiredText(3, 4000, "Description"),
    projectId: optionalId,
    occurredAt: z.coerce.date(),
    locationText: optionalText(200),
    severity: z.enum(SEVERITIES),
    /*
     * The whole of what V0.1 records about somebody being hurt (PRD #22 §22,
     * §87). Flags, not descriptions: no diagnosis field exists to fill in.
     */
    // Absent is not false: a form that could not show them leaves them out, and an edit keeps them (AUD-09 §5, FV-10).
    injuryOccurred: optionalBoolean,
    firstAidRequired: optionalBoolean,
    medicalTreatmentRequired: optionalBoolean,
    lostTime: optionalBoolean,
    propertyDamage: optionalBoolean,
    environmentalImpact: optionalBoolean,
    immediateAction: optionalText(2000),
    dueDate: optionalBusinessDate,
    versionUpdatedAt: z.coerce.date().optional(),
  })
  .refine((value) => value.occurredAt.getTime() <= Date.now(), {
    // An incident that has not happened yet is a hazard (PRD #22 §85).
    message: "An incident cannot have occurred in the future.",
    path: ["occurredAt"],
  })
  .refine(
    (value) =>
      !["HIGH", "CRITICAL"].includes(value.severity) ||
      (value.immediateAction ?? "").trim().length > 0,
    {
      // A serious incident must say what was done about it right away
      // (PRD #22 §362).
      message: "A high or critical incident needs the immediate action taken.",
      path: ["immediateAction"],
    },
  );

export const investigationSchema = z.object({
  investigationSummary: optionalText(8000),
  rootCause: optionalText(4000),
  lessonsLearned: optionalText(4000),
  versionUpdatedAt: z.coerce.date().optional(),
});

export const incidentCloseSchema = z.object({
  closureNote: requiredText(3, 2000, "Closure note"),
});

export const incidentReopenSchema = z.object({
  reason: requiredText(3, 2000, "Reason"),
});

export const incidentListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  view: z.enum(["all", "open", "near-miss", "serious", "mine"]).default("all"),
  status: z.array(z.enum(INCIDENT_STATUSES)).optional(),
  incidentType: z.array(z.enum(INCIDENT_TYPES)).optional(),
  severity: z.array(z.enum(SEVERITIES)).optional(),
  projectId: optionalId,
  sort: z.enum(["recent", "occurred-desc", "severity-desc", "number-asc"]).default("recent"),
});

/* -------------------------------------------------------------------------- */
/* Risk assessments                                                            */
/* -------------------------------------------------------------------------- */

export const riskAssessmentItemSchema = z
  .object({
    id: optionalId,
    hazardDescription: requiredText(3, 2000, "Hazard"),
    existingControls: optionalText(2000),
    likelihood: riskAxis("Likelihood"),
    severity: riskAxis("Severity"),
    additionalControls: optionalText(2000),
    residualLikelihood: optionalRiskAxis("Residual likelihood"),
    residualSeverity: optionalRiskAxis("Residual severity"),
    responsibleMemberId: optionalId,
    dueDate: optionalBusinessDate,
  })
  .refine(residualPair, { message: RESIDUAL_PAIR_MESSAGE, path: ["residualSeverity"] });

export const riskAssessmentSchema = z.object({
  title: requiredText(3, 200, "Title"),
  description: optionalText(4000),
  projectId: optionalId,
  activityType: optionalText(200),
  locationText: optionalText(200),
  ownerMemberId: optionalId,
  assessmentDate: businessDate,
  reviewDate: optionalBusinessDate,
  items: z.array(riskAssessmentItemSchema).min(1, "A risk assessment needs at least one line"),
  versionUpdatedAt: z.coerce.date().optional(),
});

export const riskAssessmentDecisionSchema = z.object({
  decisionNote: optionalText(2000),
});

export const riskAssessmentListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  view: z.enum(["all", "approved", "review-due", "mine"]).default("all"),
  status: z.array(z.enum(RISK_ASSESSMENT_STATUSES)).optional(),
  projectId: optionalId,
  sort: z.enum(["recent", "review-asc", "number-asc"]).default("recent"),
});

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export const actionSchema = z.object({
  actionType: z.enum(ACTION_TYPES).default("CORRECTIVE"),
  title: requiredText(3, 200, "Title"),
  description: requiredText(3, 4000, "Description"),
  projectId: optionalId,
  hazardId: optionalId,
  incidentId: optionalId,
  inspectionId: optionalId,
  riskAssessmentId: optionalId,
  environmentalObservationId: optionalId,
  stopWorkId: optionalId,
  permitId: optionalId,
  assignedToMemberId: z.string().min(1, "Choose who is responsible"),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  dueDate: optionalBusinessDate,
  versionUpdatedAt: z.coerce.date().optional(),
});

export const actionCompleteSchema = z.object({
  completionNote: requiredText(3, 2000, "What was done"),
});

export const actionVerifySchema = z.object({
  verificationNote: optionalText(2000),
});

export const actionRejectSchema = z.object({
  // Rejecting without saying why leaves the assignee guessing (PRD #22 §123).
  verificationNote: requiredText(3, 2000, "Reason"),
});

export const actionReopenSchema = z.object({
  reason: requiredText(3, 2000, "Reason"),
});

export const actionListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  view: z.enum(["all", "open", "mine", "overdue", "verification"]).default("all"),
  status: z.array(z.enum(ACTION_STATUSES)).optional(),
  actionType: z.array(z.enum(ACTION_TYPES)).optional(),
  priority: z.array(z.enum(PRIORITIES)).optional(),
  projectId: optionalId,
  assignedToMemberId: optionalId,
  sort: z.enum(["recent", "due-asc", "priority-desc", "number-asc"]).default("recent"),
});

/* -------------------------------------------------------------------------- */
/* Toolbox talks                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A people picker offers workers without a NESTO login beside members, sending
 * them as `employee:<employment id>` (E-04 §70-§72). Split here, so every
 * service receives a member id or an employment id and never has to guess.
 */
export const WORKER_PREFIX = "employee:";

function splitWorker(memberKey: string, workerKey: string) {
  return (raw: unknown) => {
    if (!raw || typeof raw !== "object") return raw;
    const value = (raw as Record<string, unknown>)[memberKey];
    if (typeof value !== "string" || !value.startsWith(WORKER_PREFIX)) return raw;
    return { ...(raw as Record<string, unknown>), [memberKey]: "", [workerKey]: value.slice(WORKER_PREFIX.length) };
  };
}

export const toolboxParticipantSchema = z.preprocess(
  splitWorker("companyMemberId", "employeeProfileId"),
  z
    .object({
      id: optionalId,
      companyMemberId: optionalId,
      /** A worker without a login attends by their employment (E-04 §71). */
      employeeProfileId: optionalId,
      externalName: optionalText(200),
      attendanceStatus: z.enum(ATTENDANCE_STATUSES).default("ATTENDED"),
      signatureRecorded: optionalBoolean.default(false),
    })
    .refine(
      (value) =>
        value.companyMemberId !== undefined || value.employeeProfileId !== undefined || (value.externalName ?? "").trim().length > 0,
      {
        // A participant who is neither a member nor a name is an empty row on an
        // attendance sheet (PRD #22 §133).
        message: "Name the person, or pick a colleague.",
        path: ["externalName"],
      },
    ),
);

export const toolboxSchema = z.object({
  title: requiredText(3, 200, "Title"),
  topic: requiredText(3, 200, "Topic"),
  projectId: optionalId,
  talkDate: businessDate,
  locationText: optionalText(200),
  conductedByMemberId: z.string().min(1, "Choose who gave the talk"),
  notes: optionalText(4000),
  participants: z.array(toolboxParticipantSchema).default([]),
  versionUpdatedAt: z.coerce.date().optional(),
});

export const toolboxListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(TOOLBOX_STATUSES)).optional(),
  projectId: optionalId,
  sort: z.enum(["recent", "date-desc", "number-asc"]).default("recent"),
});

/* -------------------------------------------------------------------------- */
/* Work permits                                                                */
/* -------------------------------------------------------------------------- */

export const permitSchema = z
  .object({
    permitType: z.enum(PERMIT_TYPES),
    title: requiredText(3, 200, "Title"),
    // A permit authorises work on a site; there is no such thing as a
    // company-wide permit to enter a confined space (PRD #22 §146).
    projectId: z.string().min(1, "Choose the project"),
    locationText: requiredText(2, 200, "Location"),
    riskAssessmentId: optionalId,
    validFrom: z.coerce.date(),
    validUntil: z.coerce.date(),
    responsibleMemberId: optionalId,
    hazardsSummary: optionalText(4000),
    controlsSummary: optionalText(4000),
    ppeRequirements: optionalText(2000),
    specialConditions: optionalText(4000),
    versionUpdatedAt: z.coerce.date().optional(),
  })
  .refine((value) => value.validUntil.getTime() > value.validFrom.getTime(), {
    // A window that runs backwards authorises nothing (PRD #22 §147).
    message: "The permit must expire after it starts.",
    path: ["validUntil"],
  });

export const permitDecisionSchema = z.object({
  decisionNote: optionalText(2000),
});

export const permitRejectSchema = z.object({
  decisionNote: requiredText(3, 2000, "Reason"),
});

export const permitSuspendSchema = z.object({
  reason: requiredText(3, 2000, "Reason"),
});

export const permitListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  view: z.enum(["all", "active", "expiring", "pending", "mine"]).default("all"),
  status: z.array(z.enum(PERMIT_STATUSES)).optional(),
  permitType: z.array(z.enum(PERMIT_TYPES)).optional(),
  projectId: optionalId,
  sort: z.enum(["recent", "expiry-asc", "number-asc"]).default("recent"),
});

/* -------------------------------------------------------------------------- */
/* PPE checks                                                                  */
/* -------------------------------------------------------------------------- */

export const ppeCheckSchema = z.preprocess(
  splitWorker("subjectMemberId", "subjectEmployeeProfileId"),
  z
    .object({
      projectId: optionalId,
      checkDate: businessDate,
      locationText: optionalText(200),
      subjectMemberId: optionalId,
      /** Whose PPE was checked, when they have no login (E-04 §72). */
      subjectEmployeeProfileId: optionalId,
      externalSubjectName: optionalText(200),
      helmetOk: z.enum(["yes", "no", ""]).optional(),
      eyeProtectionOk: z.enum(["yes", "no", ""]).optional(),
      hearingProtectionOk: z.enum(["yes", "no", ""]).optional(),
      respiratoryProtectionOk: z.enum(["yes", "no", ""]).optional(),
      glovesOk: z.enum(["yes", "no", ""]).optional(),
      harnessOk: z.enum(["yes", "no", ""]).optional(),
      footwearOk: z.enum(["yes", "no", ""]).optional(),
      otherPpeNote: optionalText(2000),
      notes: optionalText(2000),
    })
    .refine(
      (value) =>
        [
          value.helmetOk,
          value.eyeProtectionOk,
          value.hearingProtectionOk,
          value.respiratoryProtectionOk,
          value.glovesOk,
          value.harnessOk,
          value.footwearOk,
        ].some((item) => item === "yes" || item === "no"),
      {
        // A check that looked at nothing is not a pass (PRD #22 §160).
        message: "Record at least one item of equipment.",
        path: ["helmetOk"],
      },
    ),
);

export const ppeListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  result: z.array(z.enum(["PASS", "FAIL", "CONDITIONAL"])).optional(),
  projectId: optionalId,
  sort: z.enum(["recent", "date-desc", "number-asc"]).default("recent"),
});

/* -------------------------------------------------------------------------- */
/* Environmental observations                                                  */
/* -------------------------------------------------------------------------- */

export const observationSchema = z.object({
  category: z.enum(ENVIRONMENTAL_CATEGORIES),
  title: requiredText(3, 200, "Title"),
  description: requiredText(3, 4000, "Description"),
  projectId: optionalId,
  observedAt: businessDate,
  locationText: optionalText(200),
  severity: z.enum(SEVERITIES),
  assignedToMemberId: optionalId,
  immediateAction: optionalText(2000),
  dueDate: optionalBusinessDate,
  versionUpdatedAt: z.coerce.date().optional(),
});

export const observationCloseSchema = z.object({
  closureNote: requiredText(3, 2000, "Closure note"),
});

export const observationListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  view: z.enum(["all", "open", "mine"]).default("all"),
  status: z.array(z.enum(ENVIRONMENTAL_STATUSES)).optional(),
  category: z.array(z.enum(ENVIRONMENTAL_CATEGORIES)).optional(),
  severity: z.array(z.enum(SEVERITIES)).optional(),
  projectId: optionalId,
  sort: z.enum(["recent", "observed-desc", "number-asc"]).default("recent"),
});

/* -------------------------------------------------------------------------- */
/* Stop work                                                                   */
/* -------------------------------------------------------------------------- */

export const stopWorkSchema = z.object({
  title: requiredText(3, 200, "Title"),
  // Stopping work always stops it somewhere (PRD #22 §171).
  projectId: z.string().min(1, "Choose the project"),
  reason: requiredText(3, 4000, "Reason"),
  locationText: optionalText(200),
  hazardId: optionalId,
  incidentId: optionalId,
});

export const stopWorkReleaseSchema = z.object({
  releaseReason: requiredText(3, 2000, "Release reason"),
});

export const stopWorkListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(STOP_WORK_STATUSES)).optional(),
  projectId: optionalId,
  sort: z.enum(["recent", "issued-desc", "number-asc"]).default("recent"),
});

/* -------------------------------------------------------------------------- */
/* Approvals and shared                                                        */
/* -------------------------------------------------------------------------- */

export const approvalDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  decisionNote: optionalText(2000),
});

export const assignSchema = z.object({
  memberId: z.string().min(1, "Choose a colleague"),
});

export const cancelSchema = z.object({
  reason: optionalText(2000),
});

export const activityListSchema = paginationSchema;

/* -------------------------------------------------------------------------- */
/* Inferred input types                                                        */
/* -------------------------------------------------------------------------- */

export type TemplateInput = z.infer<typeof templateSchema>;
export type TemplateListQuery = z.infer<typeof templateListSchema>;
export type InspectionInput = z.infer<typeof inspectionSchema>;
export type ExecuteInspectionInput = z.infer<typeof executeInspectionSchema>;
export type SubmitInspectionInput = z.infer<typeof submitInspectionSchema>;
export type InspectionListQuery = z.infer<typeof inspectionListSchema>;
export type HazardInput = z.infer<typeof hazardSchema>;
export type HazardAssessInput = z.infer<typeof hazardAssessSchema>;
export type HazardCloseInput = z.infer<typeof hazardCloseSchema>;
export type HazardListQuery = z.infer<typeof hazardListSchema>;
export type IncidentInput = z.infer<typeof incidentSchema>;
export type InvestigationInput = z.infer<typeof investigationSchema>;
export type IncidentListQuery = z.infer<typeof incidentListSchema>;
export type RiskAssessmentInput = z.infer<typeof riskAssessmentSchema>;
export type RiskAssessmentListQuery = z.infer<typeof riskAssessmentListSchema>;
export type ActionInput = z.infer<typeof actionSchema>;
export type ActionListQuery = z.infer<typeof actionListSchema>;
export type ToolboxInput = z.infer<typeof toolboxSchema>;
export type ToolboxListQuery = z.infer<typeof toolboxListSchema>;
export type PermitInput = z.infer<typeof permitSchema>;
export type PermitListQuery = z.infer<typeof permitListSchema>;
export type PpeCheckInput = z.infer<typeof ppeCheckSchema>;
export type PpeListQuery = z.infer<typeof ppeListSchema>;
export type ObservationInput = z.infer<typeof observationSchema>;
export type ObservationListQuery = z.infer<typeof observationListSchema>;
export type StopWorkInput = z.infer<typeof stopWorkSchema>;
export type StopWorkListQuery = z.infer<typeof stopWorkListSchema>;
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;

/* -------------------------------------------------------------------------- */
/* Workers without a login on the safety record (E-04 §70-§74)                 */
/* -------------------------------------------------------------------------- */

const workforceDay = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date as YYYY-MM-DD.");
const nullableId = z
  .union([z.string().trim().min(1).max(64), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value ? value : null));
const nullableText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((value) => (value ? value : null));

export const INCIDENT_INVOLVEMENTS = ["INJURED", "WITNESS", "INVOLVED"] as const;

/** Somebody the incident involved: an employee of the company, or the name of somebody it does not employ (§73). */
export const incidentPersonSchema = z.object({
  employeeId: nullableId,
  externalName: nullableText(200),
  involvement: z.enum(INCIDENT_INVOLVEMENTS),
  notes: nullableText(1000),
});

/** A person or a whole crew a permit covers (§74). */
export const permitWorkerSchema = z.object({ employeeId: nullableId, crewId: nullableId });

/** A site induction given to somebody, with or without a login (§71, §270). */
export const inductionSchema = z.object({
  employeeId: z.string().trim().min(1, "Choose who was inducted.").max(64),
  projectId: z.string().trim().min(1, "Choose the project.").max(64),
  siteId: nullableId,
  inductedOn: workforceDay,
  validUntil: z
    .union([workforceDay, z.literal(""), z.null()])
    .optional()
    .transform((value) => (value ? value : null)),
  notes: nullableText(1000),
});

export const voidInductionSchema = z.object({ reason: z.string().trim().min(3, "Say why it is void.").max(500) });
