import { z } from "zod";

import { day } from "@/lib/modules/hr/employment/employment.schema";
import { QUALIFICATION_TYPES } from "./qualification.types";

/**
 * Qualification validation (E-02 §125, §126, §133).
 *
 * The person is the one in the address, the group and the recording company
 * are the reader's own, and the verification status and verifier are the
 * server's (§126). A supporting file is named by the document uploaded for it;
 * the service checks it is this person's and this reader's to use.
 */

const TYPE = z.enum(QUALIFICATION_TYPES as [string, ...string[]]) as z.ZodType<(typeof QUALIFICATION_TYPES)[number]>;
const VISIBILITY = z.enum(["PRIVATE", "EMPLOYEE_AND_HR", "HR_ONLY", "GROUP_SUMMARY", "RESTRICTED"]);
const PROFICIENCY = z.enum(["BASIC", "INTERMEDIATE", "ADVANCED", "EXPERT"]);

const id = z.string().trim().min(1).max(64);
const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max, `Keep it under ${max} characters.`), z.null()])
    .optional()
    .transform((value) => (value === "" ? null : value));
const optionalDay = z
  .union([day, z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" ? null : value));
const optionalId = z
  .union([id, z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" ? null : value));
const expectedVersion = z.number().int().min(1);
const reason = z.string().trim().min(1, "Give a reason.").max(1000, "Keep the reason under 1000 characters.");
const title = z.string().trim().min(1, "Say what it is.").max(200, "Keep the title under 200 characters.");

function checkDates(value: { issueDate?: string | null; expiryDate?: string | null }, context: z.RefinementCtx) {
  if (value.issueDate && value.expiryDate && value.expiryDate < value.issueDate) {
    context.addIssue({ code: "custom", path: ["expiryDate"], message: "The expiry date is before the issue date." });
  }
}

/** A new qualification, or — with `renewsId` — the renewal of one the person already holds (§91). */
export const createQualificationSchema = z
  .object({
    type: TYPE,
    title,
    issuer: optionalText(200),
    documentNumber: optionalText(100),
    issueDate: optionalDay,
    expiryDate: optionalDay,
    proficiency: z.union([PROFICIENCY, z.literal(""), z.null()]).optional().transform((value) => (value === "" ? null : value)),
    visibility: VISIBILITY.optional(),
    documentId: optionalId,
    renewsId: optionalId,
  })
  .superRefine(checkDates);

export const updateQualificationSchema = z
  .object({
    type: TYPE.optional(),
    title: title.optional(),
    issuer: optionalText(200),
    documentNumber: optionalText(100),
    issueDate: optionalDay,
    expiryDate: optionalDay,
    proficiency: z.union([PROFICIENCY, z.literal(""), z.null()]).optional().transform((value) => (value === "" ? null : value)),
    visibility: VISIBILITY.optional(),
    documentId: optionalId,
    expectedVersion,
  })
  .superRefine(checkDates);

export const verifyQualificationSchema = z.object({ note: optionalText(1000), expectedVersion });
export const rejectQualificationSchema = z.object({ reason, expectedVersion });
export const resubmitQualificationSchema = z.object({ note: optionalText(1000), documentId: optionalId, expectedVersion });
export const archiveQualificationSchema = z.object({ reason, expectedVersion });

export type CreateQualificationInput = z.infer<typeof createQualificationSchema>;
export type UpdateQualificationInput = z.infer<typeof updateQualificationSchema>;
export type VerifyQualificationInput = z.infer<typeof verifyQualificationSchema>;
export type RejectQualificationInput = z.infer<typeof rejectQualificationSchema>;
export type ResubmitQualificationInput = z.infer<typeof resubmitQualificationSchema>;
export type ArchiveQualificationInput = z.infer<typeof archiveQualificationSchema>;
