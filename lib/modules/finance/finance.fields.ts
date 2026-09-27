import { z } from "zod";

import { SUPPORTED_CURRENCIES } from "./finance.currency";
import { isPositiveDecimal, parseDecimalInput, type DecimalRule } from "./finance.decimal";

/**
 * Money-shaped form fields (PRD #15 §30, §31, §243; AUD-09 §4, FV-06).
 *
 * An amount arrives from a form as a string and stays a string all the way to
 * `Prisma.Decimal`. It is never parsed into a `number` on the way, because that
 * is exactly where `12500.50` turns into `12500.4999999997` (PRD #15 §31).
 *
 * `parseDecimalInput` is the validation, and the one locale rule: a point is
 * the decimal point, a comma is a decimal comma unless `1,234` makes it
 * ambiguous (refused with both spellings offered), spaces group thousands, and
 * no exponent, `Infinity`, leading `+` or mixed separators. The bounds keep a
 * value inside its column, so an oversized figure is a field error and not a
 * database overflow answered as a 500.
 *
 * Empty is not zero (AUD-09 §4): each field below says what an empty value
 * means for it — refused, "no value", or cleared — instead of a generic
 * empty-becomes-"0".
 */

/** `Decimal(18, 2)` money: fifteen whole digits keeps every sum of them in range. */
export const MONEY_RULE = { scale: 2, maxIntegerDigits: 15 } as const;
/** `Decimal(18, 4)` quantity and unit price: fourteen whole digits, four decimals. */
export const RATE_RULE = { scale: 4, maxIntegerDigits: 14 } as const;
/** `Decimal(7, 4)` tax rate: three whole digits, four decimals. */
export const TAX_RATE_RULE = { scale: 4, maxIntegerDigits: 3 } as const;

type DecimalShape = Omit<DecimalRule, "label">;

/**
 * A required decimal: a string that parses under `rule`, answered as its
 * canonical form. An absent, empty or non-string value is refused with the
 * field's own sentence — never read as zero.
 */
export function decimalString(label: string, rule: DecimalShape) {
  return z.unknown().transform((value, ctx): string => {
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
      ctx.addIssue({ code: "custom", message: `Enter ${/^[aeiou]/i.test(label) ? "an" : "a"} ${label.toLowerCase()}.`, params: { code: "DECIMAL_REQUIRED" } });
      return z.NEVER;
    }
    if (typeof value !== "string") {
      ctx.addIssue({ code: "custom", message: `${label} must be sent as a decimal string, e.g. "1234.50".`, params: { code: "DECIMAL_MALFORMED" } });
      return z.NEVER;
    }
    const parsed = parseDecimalInput(value, { label, ...rule });
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.message, params: { code: parsed.code } });
      return z.NEVER;
    }
    return parsed.value;
  });
}

/**
 * An optional decimal on a create, or on an update whose field is always sent:
 * empty or absent means "no value" (`undefined`), never zero.
 */
export function optionalDecimalString(label: string, rule: DecimalShape) {
  const inner = decimalString(label, rule);
  return z.unknown().transform((value, ctx): string | undefined => {
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return undefined;
    const parsed = inner.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", message: issue.message });
      return z.NEVER;
    }
    return parsed.data;
  }).optional();
}

/**
 * A decimal on a partial update (AUD-09 §4, FV-05): absent keeps the saved
 * value (`undefined`), an empty string or `null` clears it (`null`), anything
 * else must parse.
 */
export function clearableDecimalString(label: string, rule: DecimalShape) {
  const inner = decimalString(label, rule);
  return z.unknown().transform((value, ctx): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null || (typeof value === "string" && value.trim() === "")) return null;
    const parsed = inner.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", message: issue.message });
      return z.NEVER;
    }
    return parsed.data;
  }).optional();
}

/** A monetary amount at currency precision: `"0"`, `"12500.50"`. Never negative. */
export const amountString = (label = "Amount") => decimalString(label, MONEY_RULE);

/** Quantity and unit price carry four decimals (PRD #15 §32). */
export const rateString = (label: string) => decimalString(label, RATE_RULE);

/** A tax rate in percent, `Decimal(7, 4)` (PRD #15 §238). */
export const taxRateString = (label = "Tax rate") => decimalString(label, TAX_RATE_RULE);

/** Money that may be left empty for "no value" — an estimate nobody has made yet. */
export const optionalAmountValue = (label = "Amount") => optionalDecimalString(label, MONEY_RULE);

/** `value > 0`, exactly — a sign test on the canonical string, not a float comparison. */
export const positive = (value: string) => isPositiveDecimal(value);

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
 * A business date (PRD #15 §257; AUD-09 §4, FV-07).
 *
 * Stored at midday UTC so a timezone shift can never move an invoice's issue
 * date onto the previous day for a reader west of the server. Finance dates are
 * calendar facts, not instants.
 *
 * Read strictly: `YYYY-MM-DD` (a timestamp's own calendar day, as written, when
 * an API caller sends one) or a `Date`. `2026-02-31` is refused rather than
 * rolled over to 3 March, and `"1"` is not the year 2001 — both of which
 * `z.coerce.date()` quietly did.
 */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export const DATE_FORMAT_MESSAGE = "Enter a real calendar date as YYYY-MM-DD, e.g. 2026-09-27.";

/** The calendar day a value names, at midday UTC, or `null` when it names none. */
export function parseCalendarDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : toBusinessDate(value);
  if (typeof value !== "string") return null;
  const match = value.trim().match(ISO_DAY);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2199) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function blankDate(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

export const businessDate = z.unknown().transform((value, ctx): Date => {
  if (blankDate(value)) {
    ctx.addIssue({ code: "custom", message: "Enter a date.", params: { code: "DATE_REQUIRED" } });
    return z.NEVER;
  }
  const date = parseCalendarDate(value);
  if (!date) {
    ctx.addIssue({ code: "custom", message: DATE_FORMAT_MESSAGE, params: { code: "DATE_INVALID" } });
    return z.NEVER;
  }
  return date;
});

/** Empty or absent is "no date" (`undefined`). */
export const optionalBusinessDate = z.unknown().transform((value, ctx): Date | undefined => {
  if (blankDate(value)) return undefined;
  const date = parseCalendarDate(value);
  if (!date) {
    ctx.addIssue({ code: "custom", message: DATE_FORMAT_MESSAGE, params: { code: "DATE_INVALID" } });
    return z.NEVER;
  }
  return date;
}).optional();

/**
 * A date on a partial update (AUD-09 §4, FV-05): absent keeps the saved date
 * (`undefined`), empty or `null` clears it (`null`).
 */
export const clearableBusinessDate = z.unknown().transform((value, ctx): Date | null | undefined => {
  if (value === undefined) return undefined;
  if (blankDate(value)) return null;
  const date = parseCalendarDate(value);
  if (!date) {
    ctx.addIssue({ code: "custom", message: DATE_FORMAT_MESSAGE, params: { code: "DATE_INVALID" } });
    return z.NEVER;
  }
  return date;
}).optional();

export function toBusinessDate(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12, 0, 0, 0),
  );
}

/** The calendar day a business date represents, for display and comparison. */
export function businessDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Partial-update fields (AUD-09 §4, FV-05)                                    */
/* -------------------------------------------------------------------------- */

/*
 * On an update, three different things can happen to an optional field and
 * they must not collapse into one: the key is absent (keep what is saved —
 * `undefined`, which Prisma leaves alone), the key is sent empty or `null`
 * (the person cleared it — `null`), or it carries a value. A form always sends
 * its fields, so clearing one is an empty string; an API caller that leaves a
 * key out has not asked for it to be erased.
 *
 * AUD-09: candidate for lib/forms (beside lib/modules/shared/fields).
 */

/** Optional text and links on an update: absent keeps, empty or `null` clears (lib/modules/shared/fields). */
export { patchId as clearableId, patchText as clearableText } from "@/lib/modules/shared/fields";

/**
 * The value an update writes: the input's when it said something, the saved
 * one when the key was absent.
 */
export function keepOrSet<T>(input: T | undefined, saved: T): T {
  return input === undefined ? saved : input;
}

/**
 * A whole number typed into a form (AUD-09 §4, FV-06): digits only, within
 * bounds. `z.coerce.number()` read an empty field as 0, `"1e2"` as 100 and
 * `"0x10"` as 16; this reads none of them.
 */
export function wholeNumber(label: string, min: number, max: number) {
  return z.unknown().transform((value, ctx): number => {
    const text = typeof value === "number" ? (Number.isInteger(value) ? String(value) : "") : typeof value === "string" ? value.trim() : "";
    if (value === undefined || value === null || (typeof value === "string" && text === "")) {
      ctx.addIssue({ code: "custom", message: `Enter ${/^[aeiou]/i.test(label) ? "an" : "a"} ${label.toLowerCase()}.` });
      return z.NEVER;
    }
    if (!/^\d{1,9}$/.test(text)) {
      ctx.addIssue({ code: "custom", message: `${label} must be a whole number, e.g. ${Math.max(min, Math.min(max, 30))}.` });
      return z.NEVER;
    }
    const parsed = Number(text);
    if (parsed < min || parsed > max) {
      ctx.addIssue({ code: "custom", message: `${label} must be between ${min} and ${max}.` });
      return z.NEVER;
    }
    return parsed;
  });
}

/** An optional whole number: empty or absent is "not set" (`undefined`), never 0. */
export function optionalWholeNumber(label: string, min: number, max: number) {
  const inner = wholeNumber(label, min, max);
  return z.unknown().transform((value, ctx): number | undefined => {
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return undefined;
    const parsed = inner.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", message: issue.message });
      return z.NEVER;
    }
    return parsed.data;
  }).optional();
}

/** An optional whole number on an update: absent keeps, empty or `null` clears. */
export function clearableWholeNumber(label: string, min: number, max: number) {
  const inner = wholeNumber(label, min, max);
  return z.unknown().transform((value, ctx): number | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null || (typeof value === "string" && value.trim() === "")) return null;
    const parsed = inner.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", message: issue.message });
      return z.NEVER;
    }
    return parsed.data;
  }).optional();
}

/**
 * Any optional field on an update (AUD-09 §4, FV-05): absent keeps
 * (`undefined`), an empty string or `null` clears (`null`), anything else goes
 * through `inner` — which may be a field with its own format rule (an email, a
 * URL) that on a create would read empty as "none".
 */
export function patchOf<T extends z.ZodType>(inner: T) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.union([z.null(), inner]).optional(),
  );
}
