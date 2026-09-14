import { z } from "zod";

import {
  bool,
  expectedVersion,
  idSchema,
  LONG_TEXT_MAX,
  name,
  optionalDate,
  optionalId,
  optionalRecordNumber,
  optionalText,
  page,
  reason,
  recordNumber,
  revisionCode,
} from "./engineering.fields";
import {
  DISCIPLINES,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  LINKABLE_TYPES,
  REVIEW_DECISIONS,
  RFI_PRIORITIES,
  RFI_REFERENCE_TYPES,
  RFI_STATUSES,
  SHARING_CLASSIFICATIONS,
  SUBMITTAL_STATUSES,
  SUBMITTAL_TYPES,
  TRANSMITTAL_DIRECTIONS,
  TRANSMITTAL_PURPOSES,
  TRANSMITTAL_STATUSES,
} from "./engineering.types";

/**
 * Engineering validation (PRD #46 §60-§123, §217-§228). A schema never
 * decides a transition: statuses are not accepted on a raw update, so a PATCH
 * cannot walk around the state machine (§252).
 */

const optionalDiscipline = z.enum(DISCIPLINES).optional().nullable().transform((value) => value ?? null);

/* Engineering documents ---------------------------------------------------- */

const documentFields = {
  documentNumber: recordNumber,
  title: name("Give the document a title."),
  documentType: z.enum(DOCUMENT_TYPES),
  discipline: z.enum(DISCIPLINES).default("GENERAL"),
  contractorId: optionalId,
  workPackageId: optionalId,
  authorText: optionalText(200),
  responsibleMemberId: optionalId,
  reviewerMemberId: optionalId,
  reviewDueAt: optionalDate,
};
export const createEngineeringDocumentSchema = z.object(documentFields);
export type CreateEngineeringDocumentInput = z.infer<typeof createEngineeringDocumentSchema>;
export const updateEngineeringDocumentSchema = z.object({ ...documentFields, expectedVersion });
export type UpdateEngineeringDocumentInput = z.infer<typeof updateEngineeringDocumentSchema>;
export const voidSchema = z.object({ reason, expectedVersion: expectedVersion.optional() });

export const engineeringDocumentListSchema = z.object({
  projectId: optionalId,
  q: optionalText(100),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  type: z.enum(DOCUMENT_TYPES).optional(),
  drawings: bool,
  discipline: z.enum(DISCIPLINES).optional(),
  contractorId: optionalId,
  workPackageId: optionalId,
  reviewer: z.enum(["me"]).optional(),
  awaitingReview: bool,
  page,
});
export type EngineeringDocumentListQuery = z.infer<typeof engineeringDocumentListSchema>;

/* Revisions (documents and submittals) ------------------------------------ */

export const createRevisionSchema = z.object({
  revisionCode,
  /** A file already uploaded to this record through the canonical document pipeline (§125). */
  documentId: idSchema,
  notes: optionalText(2_000),
  submit: bool,
});
export type CreateRevisionInput = z.infer<typeof createRevisionSchema>;

export const reviewDecisionSchema = z
  .object({ decision: z.enum(REVIEW_DECISIONS), comment: optionalText(LONG_TEXT_MAX) })
  .superRefine((value, ctx) => {
    // Anything short of a clean approval says why (§73).
    if (value.decision !== "APPROVED" && !value.comment) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["comment"], message: "Say what the reviewer found." });
  });
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

export const sharingSchema = z.object({ documentId: idSchema, classification: z.enum(SHARING_CLASSIFICATIONS) });

/* RFIs --------------------------------------------------------------------- */

const rfiFields = {
  subject: name("Give the RFI a subject."),
  question: z.string().trim().min(1, "Ask the question.").max(LONG_TEXT_MAX, `Keep this under ${LONG_TEXT_MAX.toLocaleString("en")} characters.`),
  priority: z.enum(RFI_PRIORITIES).default("NORMAL"),
  discipline: optionalDiscipline,
  contractorId: optionalId,
  workPackageId: optionalId,
  assignedToMemberId: optionalId,
  dueAt: optionalDate,
  raisedByText: optionalText(200),
};
export const createRfiSchema = z.object({ ...rfiFields, rfiNumber: optionalRecordNumber, open: bool });
export type CreateRfiInput = z.infer<typeof createRfiSchema>;
export const updateRfiSchema = z.object({ ...rfiFields, expectedVersion });
export type UpdateRfiInput = z.infer<typeof updateRfiSchema>;
export const openRfiSchema = z.object({ expectedVersion });
export const respondRfiSchema = z.object({
  text: z.string().trim().min(1, "Write the response.").max(LONG_TEXT_MAX, `Keep this under ${LONG_TEXT_MAX.toLocaleString("en")} characters.`),
  final: bool,
});
export const clarificationSchema = z.object({ text: z.string().trim().min(1, "Say what is still unclear.").max(LONG_TEXT_MAX) });
export const closeRfiSchema = z.object({ note: optionalText(2_000) });
export const rfiReferenceSchema = z.object({ referenceType: z.enum(RFI_REFERENCE_TYPES), referenceId: idSchema, note: optionalText(500) });

export const rfiListSchema = z.object({
  projectId: optionalId,
  q: optionalText(100),
  status: z.enum(RFI_STATUSES).optional(),
  open: bool,
  /** Still waiting on an answer: open, or back with a clarification. */
  awaiting: bool,
  overdue: bool,
  priority: z.enum(RFI_PRIORITIES).optional(),
  discipline: z.enum(DISCIPLINES).optional(),
  contractorId: optionalId,
  workPackageId: optionalId,
  assignee: z.enum(["me"]).optional(),
  page,
});
export type RfiListQuery = z.infer<typeof rfiListSchema>;

/* Submittals --------------------------------------------------------------- */

const submittalFields = {
  title: name("Give the submittal a title."),
  description: optionalText(),
  submittalType: z.enum(SUBMITTAL_TYPES),
  discipline: optionalDiscipline,
  contractorId: optionalId,
  workPackageId: optionalId,
  assignedReviewerMemberId: optionalId,
  dueAt: optionalDate,
  specificationReference: optionalText(200),
  manufacturer: optionalText(200),
  productName: optionalText(200),
  modelNumber: optionalText(120),
  supplierId: optionalId,
  activity: optionalText(200),
  workArea: optionalText(200),
};
export const createSubmittalSchema = z.object({ ...submittalFields, submittalNumber: optionalRecordNumber });
export type CreateSubmittalInput = z.infer<typeof createSubmittalSchema>;
export const updateSubmittalSchema = z.object({ ...submittalFields, expectedVersion });
export type UpdateSubmittalInput = z.infer<typeof updateSubmittalSchema>;

export const submittalListSchema = z.object({
  projectId: optionalId,
  q: optionalText(100),
  status: z.enum(SUBMITTAL_STATUSES).optional(),
  type: z.enum(SUBMITTAL_TYPES).optional(),
  types: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",").filter((item): item is (typeof SUBMITTAL_TYPES)[number] => (SUBMITTAL_TYPES as readonly string[]).includes(item)) : undefined)),
  discipline: z.enum(DISCIPLINES).optional(),
  contractorId: optionalId,
  workPackageId: optionalId,
  reviewer: z.enum(["me"]).optional(),
  inReview: bool,
  overdue: bool,
  page,
});
export type SubmittalListQuery = z.infer<typeof submittalListSchema>;

/* Transmittals ------------------------------------------------------------- */

const transmittalItem = z.object({
  documentId: idSchema,
  engineeringDocumentId: optionalId,
  engineeringRevisionId: optionalId,
  remarks: optionalText(500),
});
const transmittalFields = {
  direction: z.enum(TRANSMITTAL_DIRECTIONS),
  purpose: z.enum(TRANSMITTAL_PURPOSES),
  subject: optionalText(200),
  contractorId: optionalId,
  workPackageId: optionalId,
  senderText: optionalText(200),
  recipientText: optionalText(200),
  notes: optionalText(2_000),
  items: z.array(transmittalItem).max(200, "A transmittal carries at most 200 documents.").default([]),
};
export const createTransmittalSchema = z.object({ ...transmittalFields, transmittalNumber: optionalRecordNumber });
export type CreateTransmittalInput = z.infer<typeof createTransmittalSchema>;
export const updateTransmittalSchema = z.object(transmittalFields);
export type UpdateTransmittalInput = z.infer<typeof updateTransmittalSchema>;
export const issueTransmittalSchema = z.object({ issuedAt: optionalDate });

export const transmittalListSchema = z.object({
  projectId: optionalId,
  q: optionalText(100),
  status: z.enum(TRANSMITTAL_STATUSES).optional(),
  direction: z.enum(TRANSMITTAL_DIRECTIONS).optional(),
  contractorId: optionalId,
  page,
});
export type TransmittalListQuery = z.infer<typeof transmittalListSchema>;

/* Links and tasks ---------------------------------------------------------- */

export const linkSchema = z.object({ type: z.enum(LINKABLE_TYPES), recordId: idSchema });
export const createTaskFromRecordSchema = z.object({
  title: name("Give the task a title."),
  description: optionalText(),
  assigneeMemberId: optionalId,
  dueDate: optionalDate,
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
});
export type CreateTaskFromRecordInput = z.infer<typeof createTaskFromRecordSchema>;

/* Settings ----------------------------------------------------------------- */

export const engineeringSettingsSchema = z.object({
  rfiDefaultDueDays: z.number().int().min(1, "At least one day.").max(90, "At most 90 days."),
  submittalDefaultReviewDays: z.number().int().min(1, "At least one day.").max(120, "At most 120 days."),
  contractorComplianceReminderDays: z.number().int().min(1, "At least one day.").max(180, "At most 180 days."),
  dueSoonDays: z.number().int().min(1, "At least one day.").max(14, "At most 14 days."),
  allowSelfReview: z.boolean(),
  requireSubmittalDueDate: z.boolean(),
});
export type EngineeringSettingsInput = z.infer<typeof engineeringSettingsSchema>;
