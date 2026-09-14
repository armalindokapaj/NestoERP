import { z } from "zod";

import { isLocalDate } from "@/lib/modules/calendar/calendar.time";

/**
 * Validation primitives shared by contractors, work packages and engineering
 * (PRD #46 §222). Ids are shapes only: whether a project, contractor, work
 * package, contract, supplier, member or document belongs to this company and
 * this project is always the service's question (§223, §224).
 */

export const NAME_MAX = 200;
export const TEXT_MAX = 5_000;
export const LONG_TEXT_MAX = 20_000;
export const REASON_MAX = 2_000;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const idSchema = z.string().regex(ID, "Unknown record.");
export const localDate = z.string().trim().refine(isLocalDate, { message: "Use a date in the form YYYY-MM-DD." });
export const optionalDate = localDate.optional().nullable().transform((value) => value ?? null);
export const optionalId = z
  .union([idSchema, z.literal("")])
  .optional()
  .nullable()
  .transform((value) => value || null);
export const name = (label = "Give it a name.", max = NAME_MAX) => z.string().trim().min(1, label).max(max, `Keep this under ${max} characters.`);
export const optionalText = (max = TEXT_MAX) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en")} characters.`)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));
export const reason = z.string().trim().min(1, "Give a reason.").max(REASON_MAX, `Keep this under ${REASON_MAX.toLocaleString("en")} characters.`);
export const expectedVersion = z.number().int().min(1);
export const page = z.coerce.number().int().min(1).max(10_000).default(1);
export const optionalEmail = z
  .string()
  .trim()
  .max(200)
  .optional()
  .nullable()
  .transform((value) => (value ? value.toLowerCase() : null))
  .refine((value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), { message: "Enter a valid email address." });
export const countryCode = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((value) => (value ? value.toUpperCase() : null))
  .refine((value) => value === null || /^[A-Z]{2}$/.test(value), { message: "Use a two-letter country code." });
export const currency = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((value) => (value ? value.toUpperCase() : null))
  .refine((value) => value === null || /^[A-Z]{3}$/.test(value), { message: "Use a three-letter currency code." });
/** A money amount as text, so nothing is lost to floating point (§270). */
export const optionalAmount = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((value) => (value === undefined || value === null || value === "" ? null : String(value).trim()))
  .refine((value) => value === null || (/^\d{1,16}(\.\d{1,2})?$/.test(value)), { message: "Enter an amount with at most two decimals." });
/** A human number typed by the user: letters, digits and a few separators (§64). */
export const recordNumber = z
  .string()
  .trim()
  .min(1, "Give it a number.")
  .max(40, "Keep the number under 40 characters.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use letters, digits, dots, dashes or slashes.");
export const optionalRecordNumber = z
  .union([recordNumber, z.literal("")])
  .optional()
  .nullable()
  .transform((value) => value || null);
/** Revision codes are the company's own: A, B, 01, P01, C01 (§72). */
export const revisionCode = z
  .string()
  .trim()
  .min(1, "Give the revision a code.")
  .max(12, "Keep the revision code under 12 characters.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, digits, dots or dashes.");
export const bool = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .optional()
  .transform((value) => value === true || value === "true" || value === "1");

export function dateRange<T extends Record<string, unknown>>(pairs: Array<[keyof T & string, keyof T & string]>) {
  return (value: T, ctx: z.RefinementCtx) => {
    for (const [start, end] of pairs) {
      const from = value[start] as string | null;
      const to = value[end] as string | null;
      if (from && to && to < from) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [end], message: "The end is before the start." });
    }
  };
}
