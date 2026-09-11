import { z } from "zod";

import { SUPPORTED_CURRENCIES } from "./finance.currency";

/**
 * Money-shaped form fields (PRD #15 §30, §31, §243).
 *
 * An amount arrives from a form as a string and stays a string all the way to
 * `Prisma.Decimal`. It is never parsed into a `number` on the way, because that
 * is exactly where `12500.50` turns into `12500.4999999997` (PRD #15 §31).
 *
 * The regex is the validation: it accepts a plain decimal with at most the
 * given number of fractional digits and nothing else — no exponents, no
 * thousands separators, no leading `+`, no `Infinity`.
 */
function amountPattern(scale: number): RegExp {
  return new RegExp(`^\\d{1,15}(\\.\\d{1,${scale}})?$`);
}

function normalizeAmountInput(value: string): string {
  // Forms in several locales send "1 234,50"; the intent is unambiguous.
  return value.trim().replace(/\s/g, "").replace(",", ".");
}

/** A monetary amount at currency precision: `"0"`, `"12500.50"`. */
export const amountString = (label = "Amount") =>
  z
    .string()
    .transform(normalizeAmountInput)
    .refine((value) => amountPattern(2).test(value), {
      message: `${label} must be a number with at most 2 decimal places`,
    });

/** Quantity, unit price and tax rate carry four decimals (PRD #15 §32). */
export const rateString = (label: string) =>
  z
    .string()
    .transform(normalizeAmountInput)
    .refine((value) => amountPattern(4).test(value), {
      message: `${label} must be a number with at most 4 decimal places`,
    });

export const optionalAmountString = (label = "Amount") =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? "0" : value))
    .transform(normalizeAmountInput)
    .refine((value) => amountPattern(2).test(value), {
      message: `${label} must be a number with at most 2 decimal places`,
    });

export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z.enum(SUPPORTED_CURRENCIES as unknown as [string, ...string[]], {
      message: "Choose a supported currency",
    }),
  );

/**
 * A business date (PRD #15 §257).
 *
 * Stored at midday UTC so a timezone shift can never move an invoice's issue
 * date onto the previous day for a reader west of the server. Finance dates are
 * calendar facts, not instants.
 */
export const businessDate = z.coerce.date().transform(toBusinessDate);

export const optionalBusinessDate = z
  .union([z.coerce.date(), z.literal("")])
  .optional()
  .transform((value) =>
    value === "" || value === undefined ? undefined : toBusinessDate(value as Date),
  );

export function toBusinessDate(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12, 0, 0, 0),
  );
}

/** The calendar day a business date represents, for display and comparison. */
export function businessDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}
