import { z } from "zod";

import { businessDate, optionalBusinessDate } from "@/lib/modules/finance/finance.fields";
import {
  optionalEnum,
  optionalId,
  optionalText,
  requiredText,
} from "@/lib/modules/shared/fields";
import { paginationSchema } from "@/lib/modules/shared/list-query";
import {
  CHECKLIST_RESULTS,
  CORRECTIVE_ACTION_STATUSES,
  DEFECT_STATUSES,
  INSPECTION_RESULTS,
  INSPECTION_STATUSES,
  INSPECTION_TYPES,
  NCR_CATEGORIES,
  NCR_STATUSES,
  PRIORITIES,
  REQUEST_STATUSES,
  RESPONSE_TYPES,
  SEVERITIES,
  TEMPLATE_STATUSES,
} from "./qaqc.status";

/**
 * QA/QC validation (PRD #21 §233).
 *
 * Quantities arrive as strings and stay strings until Prisma turns them into
 * decimals, because the equation `accepted + rejected + conditional = inspected`
 * has to balance exactly (PRD #21 §91, §220).
 *
 * No schema here accepts a status or a result. Records move through named
 * actions — submit, approve, close — so there is nothing for a generic update
 * to set, and no way to type your way past an approval.
 */

const quantityString = z
  .string()
  .trim()
  .min(1, "Enter a quantity")
  .transform((value) => value.replace(",", "."))
  .refine((value) => /^\d{1,14}(\.\d{1,4})?$/.test(value), {
    message: "Quantity must be a number with at most 4 decimal places",
  });

const positiveQuantityString = quantityString.refine(
  (value) => Number.parseFloat(value) > 0,
  { message: "Quantity must be more than zero" },
);

/* -------------------------------------------------------------------------- */
/* Inspection requests                                                         */
/* -------------------------------------------------------------------------- */

export const requestSchema = z
  .object({
    title: requiredText(3, 200, "Title"),
    inspectionType: z.enum(INSPECTION_TYPES),
    projectId: optionalId,
    goodsReceiptId: optionalId,
    goodsReceiptItemId: optionalId,
    requestedDate: businessDate,
    requiredByDate: optionalBusinessDate,
    priority: z.enum(PRIORITIES).default("MEDIUM"),
    assignedInspectorMemberId: optionalId,
    description: optionalText(4000),
    locationText: optionalText(200),
    versionUpdatedAt: z.coerce.date().optional(),
  })
  .refine((value) => value.inspectionType !== "WORK" || value.projectId !== undefined, {
    // Work happens on a site. A work inspection with no project is one nobody
    // can find or act on (PRD #21 §106).
    message: "A work inspection needs a project.",
    path: ["projectId"],
  })
  .refine(
    (value) => value.inspectionType !== "MATERIAL" || value.goodsReceiptId !== undefined,
    {
      // Material quality is always about a specific delivery (PRD #21 §41).
      message: "A material inspection needs the delivery it is about.",
      path: ["goodsReceiptId"],
    },
  )
  .refine(
    (value) =>
      value.requiredByDate === undefined ||
      value.requiredByDate.getTime() >= value.requestedDate.getTime(),
    {
      message: "The required-by date cannot be before the request was raised.",
      path: ["requiredByDate"],
    },
  );

export type RequestInput = z.infer<typeof requestSchema>;

export const requestListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(REQUEST_STATUSES)).optional(),
  inspectionType: z.array(z.enum(INSPECTION_TYPES)).optional(),
  priority: z.array(z.enum(PRIORITIES)).optional(),
  projectId: z.string().optional(),
  assignedInspectorMemberId: z.string().optional(),
  view: z.enum(["all", "open", "mine", "unassigned"]).default("all"),
  sort: z
    .enum(["created-desc", "required-asc", "priority-desc", "number-asc"])
    .default("created-desc"),
});

export type RequestListQuery = z.infer<typeof requestListQuerySchema>;

export const assignSchema = z.object({
  memberId: z.string().trim().min(1, "Choose somebody to assign it to"),
});

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

const templateItemSchema = z.object({
  id: optionalId,
  code: optionalText(40),
  label: requiredText(2, 300, "Check"),
  description: optionalText(2000),
  responseType: z.enum(RESPONSE_TYPES),
  required: z.coerce.boolean().optional().default(true),
  passCriteriaText: optionalText(1000),
  requiresEvidenceOnFail: z.coerce.boolean().optional().default(false),
});

export const templateSchema = z.object({
  code: requiredText(1, 40, "Template code"),
  name: requiredText(2, 200, "Template name"),
  inspectionType: z.enum(INSPECTION_TYPES),
  description: optionalText(2000),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  items: z.array(templateItemSchema).min(1, "A template needs at least one check"),
  versionUpdatedAt: z.coerce.date().optional(),
});

export type TemplateInput = z.infer<typeof templateSchema>;

export const templateListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(TEMPLATE_STATUSES)).optional(),
  inspectionType: z.array(z.enum(INSPECTION_TYPES)).optional(),
  sort: z.enum(["code-asc", "name-asc", "updated-desc"]).default("code-asc"),
});

export type TemplateListQuery = z.infer<typeof templateListQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

export const inspectionSchema = z
  .object({
    inspectionType: z.enum(INSPECTION_TYPES),
    requestId: optionalId,
    templateId: optionalId,
    projectId: optionalId,
    goodsReceiptId: optionalId,
    goodsReceiptItemId: optionalId,
    assignedInspectorMemberId: z.string().trim().min(1, "Choose an inspector"),
    inspectionDate: optionalBusinessDate,
    locationText: optionalText(200),
    workReference: optionalText(200),
    drawingReference: optionalText(200),
    specificationReference: optionalText(200),
    summary: optionalText(4000),
    versionUpdatedAt: z.coerce.date().optional(),
  })
  .refine((value) => value.inspectionType !== "WORK" || value.projectId !== undefined, {
    message: "A work inspection needs a project.",
    path: ["projectId"],
  })
  .refine(
    (value) => value.inspectionType !== "MATERIAL" || value.goodsReceiptId !== undefined,
    {
      message: "A material inspection needs the delivery it is about.",
      path: ["goodsReceiptId"],
    },
  );

export type InspectionInput = z.infer<typeof inspectionSchema>;

export const inspectionListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(INSPECTION_STATUSES)).optional(),
  result: z.array(z.enum(INSPECTION_RESULTS)).optional(),
  inspectionType: z.array(z.enum(INSPECTION_TYPES)).optional(),
  projectId: z.string().optional(),
  goodsReceiptId: z.string().optional(),
  assignedInspectorMemberId: z.string().optional(),
  view: z.enum(["all", "open", "mine", "awaiting-approval", "reinspections"]).default("all"),
  sort: z
    .enum(["created-desc", "date-desc", "date-asc", "number-asc", "updated-desc"])
    .default("created-desc"),
});

export type InspectionListQuery = z.infer<typeof inspectionListQuerySchema>;

/** One answer on a checklist (PRD #21 §71). */
export const checklistAnswerSchema = z.object({
  itemId: z.string().trim().min(1),
  result: optionalEnum(CHECKLIST_RESULTS),
  responseValue: optionalText(2000),
  note: optionalText(2000),
});

export const checklistSchema = z.object({
  answers: z.array(checklistAnswerSchema),
});

export type ChecklistInput = z.infer<typeof checklistSchema>;

/**
 * Finishing an inspection (PRD #21 §76, §78, §79).
 *
 * The result is chosen deliberately rather than derived, because a checklist
 * where everything passed can still be a conditional acceptance — and the
 * server checks the choice against the answers either way (§77).
 */
export const submitInspectionSchema = z
  .object({
    result: z.enum(["PASS", "FAIL", "CONDITIONAL"]),
    summary: optionalText(4000),
    decisionNote: optionalText(4000),
  })
  .refine(
    (value) => value.result !== "CONDITIONAL" || (value.decisionNote ?? "").trim().length >= 3,
    {
      // "Accepted with a condition" is not a verdict until somebody says what
      // the condition is (PRD #21 §78).
      message: "A conditional result has to say what the condition is.",
      path: ["decisionNote"],
    },
  );

export type SubmitInspectionInput = z.infer<typeof submitInspectionSchema>;

export const decisionSchema = z.object({ note: optionalText(4000) });
export const reasonSchema = z.object({ note: requiredText(3, 4000, "Reason") });

/* -------------------------------------------------------------------------- */
/* Material decisions and release                                              */
/* -------------------------------------------------------------------------- */

export const materialDecisionSchema = z
  .object({
    goodsReceiptItemId: z.string().trim().min(1, "Choose a delivery line"),
    inspectedQuantity: positiveQuantityString,
    acceptedQuantity: quantityString,
    rejectedQuantity: quantityString,
    conditionalQuantity: quantityString,
    notes: optionalText(2000),
  })
  .refine(
    (value) => {
      // Compared as fixed-point strings scaled to four places, so the check
      // here matches the Decimal check the service runs (PRD #21 §91).
      const scale = (input: string) => Math.round(Number.parseFloat(input) * 10_000);
      return (
        scale(value.acceptedQuantity) +
          scale(value.rejectedQuantity) +
          scale(value.conditionalQuantity) ===
        scale(value.inspectedQuantity)
      );
    },
    {
      message: "Accepted, rejected and conditional have to add up to the quantity inspected.",
      path: ["acceptedQuantity"],
    },
  );

export type MaterialDecisionInput = z.infer<typeof materialDecisionSchema>;

export const materialDecisionsSchema = z.object({
  decisions: z.array(materialDecisionSchema).min(1, "Record at least one line"),
});

export const materialReleaseSchema = z.object({
  notes: optionalText(2000),
});

export const revokeReleaseSchema = z.object({
  reason: requiredText(3, 2000, "Reason"),
});

/* -------------------------------------------------------------------------- */
/* Defects                                                                     */
/* -------------------------------------------------------------------------- */

export const defectSchema = z.object({
  title: requiredText(3, 200, "Title"),
  description: requiredText(3, 4000, "Description"),
  projectId: z.string().trim().min(1, "Choose the project it is on"),
  inspectionId: optionalId,
  severity: z.enum(SEVERITIES),
  locationText: optionalText(200),
  assignedToMemberId: optionalId,
  dueDate: optionalBusinessDate,
  versionUpdatedAt: z.coerce.date().optional(),
});

export type DefectInput = z.infer<typeof defectSchema>;

export const defectListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(DEFECT_STATUSES)).optional(),
  severity: z.array(z.enum(SEVERITIES)).optional(),
  projectId: z.string().optional(),
  assignedToMemberId: z.string().optional(),
  view: z.enum(["all", "open", "mine", "overdue"]).default("all"),
  sort: z
    .enum(["created-desc", "due-asc", "severity-desc", "number-asc"])
    .default("created-desc"),
});

export type DefectListQuery = z.infer<typeof defectListQuerySchema>;

export const resolveDefectSchema = z.object({
  resolutionNote: requiredText(3, 4000, "What was done"),
});

/* -------------------------------------------------------------------------- */
/* NCRs                                                                        */
/* -------------------------------------------------------------------------- */

export const ncrSchema = z.object({
  title: requiredText(3, 200, "Title"),
  description: requiredText(3, 4000, "Description"),
  projectId: optionalId,
  inspectionId: optionalId,
  goodsReceiptId: optionalId,
  goodsReceiptItemId: optionalId,
  sourceDefectId: optionalId,
  category: z.enum(NCR_CATEGORIES),
  severity: z.enum(SEVERITIES),
  assignedToMemberId: optionalId,
  ownerMemberId: optionalId,
  immediateAction: optionalText(4000),
  rootCause: optionalText(4000),
  correctiveActionSummary: optionalText(4000),
  dueDate: optionalBusinessDate,
  versionUpdatedAt: z.coerce.date().optional(),
});

export type NcrInput = z.infer<typeof ncrSchema>;

export const ncrListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(NCR_STATUSES)).optional(),
  category: z.array(z.enum(NCR_CATEGORIES)).optional(),
  severity: z.array(z.enum(SEVERITIES)).optional(),
  projectId: z.string().optional(),
  assignedToMemberId: z.string().optional(),
  view: z.enum(["all", "open", "mine", "overdue", "awaiting-approval"]).default("all"),
  sort: z
    .enum(["created-desc", "due-asc", "severity-desc", "number-asc"])
    .default("created-desc"),
});

export type NcrListQuery = z.infer<typeof ncrListQuerySchema>;

export const closeNcrSchema = z.object({
  closureNote: optionalText(4000),
});

/** Turning a defect into a formal non-conformance (PRD #21 §170). */
export const escalateSchema = z.object({
  category: z.enum(NCR_CATEGORIES),
  title: optionalText(200),
});

/* -------------------------------------------------------------------------- */
/* Corrective actions                                                          */
/* -------------------------------------------------------------------------- */

export const correctiveActionSchema = z
  .object({
    title: requiredText(3, 200, "Title"),
    description: requiredText(3, 4000, "Description"),
    ncrId: optionalId,
    defectId: optionalId,
    inspectionId: optionalId,
    projectId: optionalId,
    assignedToMemberId: z.string().trim().min(1, "Choose who is doing it"),
    dueDate: optionalBusinessDate,
    versionUpdatedAt: z.coerce.date().optional(),
  })
  .refine(
    (value) =>
      value.ncrId !== undefined ||
      value.defectId !== undefined ||
      value.inspectionId !== undefined,
    {
      // A corrective action with no parent is a task, not a corrective action
      // — and Tasks already exists (PRD #21 §153, §221).
      message: "A corrective action has to hang off an NCR, a defect or an inspection.",
      path: ["ncrId"],
    },
  );

export type CorrectiveActionInput = z.infer<typeof correctiveActionSchema>;

export const correctiveActionListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(CORRECTIVE_ACTION_STATUSES)).optional(),
  projectId: z.string().optional(),
  assignedToMemberId: z.string().optional(),
  ncrId: z.string().optional(),
  view: z.enum(["all", "open", "mine", "overdue", "awaiting-verification"]).default("all"),
  sort: z.enum(["created-desc", "due-asc", "number-asc"]).default("created-desc"),
});

export type CorrectiveActionListQuery = z.infer<typeof correctiveActionListQuerySchema>;

export const completeActionSchema = z.object({
  completionNote: requiredText(3, 4000, "What was done"),
});

export const verifyActionSchema = z.object({
  verificationNote: optionalText(4000),
});

/* -------------------------------------------------------------------------- */
/* Reinspections                                                               */
/* -------------------------------------------------------------------------- */

export const reinspectionSchema = z.object({
  assignedInspectorMemberId: z.string().trim().min(1, "Choose an inspector"),
  inspectionDate: optionalBusinessDate,
  summary: optionalText(4000),
});

export type ReinspectionInput = z.infer<typeof reinspectionSchema>;

/* -------------------------------------------------------------------------- */
/* Approvals                                                                   */
/* -------------------------------------------------------------------------- */

export const approvalListQuerySchema = paginationSchema.extend({
  recordType: optionalEnum(["INSPECTION", "NCR"] as const),
  view: z.enum(["pending", "decided", "all"]).default("pending"),
});

export type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>;
