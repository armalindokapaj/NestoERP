import { z } from "zod";

import { day } from "@/lib/modules/hr/employment/employment.schema";
import { EMPLOYEE_DOCUMENT_CATEGORIES } from "./employee-document.types";

/**
 * Employee document validation (E-02 §125, §126, §133).
 *
 * The company, the employee's ownership, who verified it and its verification
 * status are the server's and are absent (§126): status moves only by the
 * semantic actions (§31). Every id is a claim the service checks names a row of
 * this company this reader may use.
 */

const CATEGORY = z.enum(EMPLOYEE_DOCUMENT_CATEGORIES as [string, ...string[]]) as z.ZodType<(typeof EMPLOYEE_DOCUMENT_CATEGORIES)[number]>;
const VISIBILITY = z.enum(["PRIVATE_EMPLOYEE", "EMPLOYEE_AND_HR", "HR_ONLY", "EMPLOYEE_HR_FINANCE", "RESTRICTED_MANAGEMENT", "GROUP_SUMMARY"]);

const id = z.string().trim().min(1).max(64);
/** Absent: unchanged. Empty or null: none. */
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

type Dated = { issueDate?: string | null; expiryDate?: string | null; effectiveFrom?: string | null; effectiveTo?: string | null };

/** The date rules of §133, said where the fields are rather than as one form error. */
function checkDates(value: Dated, context: z.RefinementCtx) {
  if (value.issueDate && value.expiryDate && value.expiryDate < value.issueDate) {
    context.addIssue({ code: "custom", path: ["expiryDate"], message: "The expiry date is before the issue date." });
  }
  if (value.effectiveFrom && value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "The end date is before the start date." });
  }
}

const metadata = {
  title: optionalText(200),
  issuer: optionalText(200),
  documentNumber: optionalText(100),
  issueDate: optionalDay,
  expiryDate: optionalDay,
  effectiveFrom: optionalDay,
  effectiveTo: optionalDay,
};

/**
 * Filing a document uploaded on the employment (§54, §55), or one that renews
 * or replaces a document already filed (§66, §91): `replacesId` names it, and
 * it stops being current.
 */
export const fileEmployeeDocumentSchema = z
  .object({
    documentId: id,
    category: CATEGORY,
    visibility: VISIBILITY.optional(),
    ...metadata,
    amendsId: optionalId,
    replacesId: optionalId,
  })
  .superRefine(checkDates);

export const updateEmployeeDocumentSchema = z
  .object({
    category: CATEGORY.optional(),
    visibility: VISIBILITY.optional(),
    ...metadata,
    expectedVersion,
  })
  .superRefine(checkDates);

export const verifyEmployeeDocumentSchema = z.object({ note: optionalText(1000), expectedVersion });
export const rejectEmployeeDocumentSchema = z.object({ reason, expectedVersion });
export const resubmitEmployeeDocumentSchema = z.object({ note: optionalText(1000), expectedVersion });
export const supersedeEmployeeDocumentSchema = z.object({ reason: optionalText(1000), replacementId: optionalId, expectedVersion });
export const archiveEmployeeDocumentSchema = z.object({ reason, expectedVersion });

export const employeeDocumentListSchema = z.object({
  history: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
    .optional()
    .transform((value) => value === "1" || value === "true"),
});

export type FileEmployeeDocumentInput = z.infer<typeof fileEmployeeDocumentSchema>;
export type UpdateEmployeeDocumentInput = z.infer<typeof updateEmployeeDocumentSchema>;
export type VerifyEmployeeDocumentInput = z.infer<typeof verifyEmployeeDocumentSchema>;
export type RejectEmployeeDocumentInput = z.infer<typeof rejectEmployeeDocumentSchema>;
export type ResubmitEmployeeDocumentInput = z.infer<typeof resubmitEmployeeDocumentSchema>;
export type SupersedeEmployeeDocumentInput = z.infer<typeof supersedeEmployeeDocumentSchema>;
export type ArchiveEmployeeDocumentInput = z.infer<typeof archiveEmployeeDocumentSchema>;
