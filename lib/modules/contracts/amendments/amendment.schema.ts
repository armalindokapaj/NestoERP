import { z } from "zod";

import { businessDate, MONEY_RULE, optionalBusinessDate, optionalDecimalString } from "@/lib/modules/finance/finance.fields";
import { optionalBoolean, optionalDate, optionalText, requiredText } from "@/lib/modules/shared/fields";

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

/** By the shared decimal rule (AUD-09 §4, FV-06); empty is "value unchanged". */
const optionalAmendmentValue = optionalDecimalString("New contract value", MONEY_RULE);

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
  acknowledgeReduction: optionalBoolean.transform((value) => value ?? false),
  versionUpdatedAt: optionalDate,
})
  // An amendment's new expiry cannot come before it takes effect (AUD-09 §4, FV-07).
  .refine((value) => !value.effectiveDate || !value.newExpiryDate || value.newExpiryDate.getTime() >= value.effectiveDate.getTime(), {
    message: "The new expiry date cannot be before the amendment takes effect.",
    path: ["newExpiryDate"],
  });

export type AmendmentInput = z.infer<typeof amendmentSchema>;

export const amendmentSignedSchema = z.object({ signedDate: businessDate });
export const amendmentNoteSchema = z.object({ note: optionalText(2000) });
export const amendmentReasonSchema = z.object({ note: requiredText(3, 2000, "Reason") });

export type AmendmentSignedInput = z.infer<typeof amendmentSignedSchema>;
