import { z } from "zod";

import { businessDate, optionalBusinessDate } from "@/lib/modules/finance/finance.fields";
import { optionalDate, optionalText, requiredText } from "@/lib/modules/shared/fields";

/**
 * Amendment validation (PRD #18 §280, §281).
 *
 * There is no currency field. An amendment changes what is owed, never the
 * currency it is owed in — a currency change is a different agreement
 * (PRD #18 §281).
 *
 * `valueDelta` is absent too: the server derives it from the contract's current
 * value, because a delta computed in a browser is a number nobody can check
 * (PRD #18 §332).
 */

const optionalAmendmentValue = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : value.replace(",", ".")))
  .refine((value) => value === undefined || /^\d{1,15}(\.\d{1,2})?$/.test(value), {
    message: "The new contract value must be a number with at most 2 decimal places",
  });

export const amendmentSchema = z.object({
  amendmentNumber: requiredText(2, 60, "Amendment number"),
  title: requiredText(2, 250, "Title"),
  summary: requiredText(2, 5000, "Summary"),
  effectiveDate: optionalBusinessDate,
  newContractValue: optionalAmendmentValue,
  newExpiryDate: optionalBusinessDate,
  /**
   * Shortening a term or cutting a value is legitimate, and the confirmation is
   * how the person doing it says they meant to (PRD #18 §168).
   */
  acknowledgeReduction: z.coerce.boolean().optional().default(false),
  versionUpdatedAt: optionalDate,
});

export type AmendmentInput = z.infer<typeof amendmentSchema>;

export const amendmentSignedSchema = z.object({ signedDate: businessDate });
export const amendmentNoteSchema = z.object({ note: optionalText(2000) });
export const amendmentReasonSchema = z.object({ note: requiredText(3, 2000, "Reason") });

export type AmendmentSignedInput = z.infer<typeof amendmentSignedSchema>;
