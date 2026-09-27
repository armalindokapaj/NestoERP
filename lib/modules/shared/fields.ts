import { z } from "zod";

import { isDateOnly, parseDateOnly } from "@/lib/forms/dates";
import { parseDecimalInput, type DecimalRule } from "@/lib/forms/decimal";

/**
 * Shared form-field primitives (PRD #7 §43).
 *
 * Every module validates the same way, so the awkward parts of HTML forms are
 * solved once: an untouched `<select>` submits `""` rather than omitting the
 * key, an empty text input is "no value" and not a zero-length string, and a
 * blank date must not become `Invalid Date`.
 *
 * The same schemas run on the form and in the service. The frontend copy exists
 * for the person filling in the form; the backend copy is the authority.
 *
 * The rules themselves — what a typed number is, what a calendar date is —
 * live in `lib/forms` (AUD-09 §3, §4), which a client component imports too:
 * these schemas call the very same functions, so the browser and the server
 * cannot hold two versions of a regex or a limit.
 */

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

export const requiredText = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label} must be at least ${min} character${min === 1 ? "" : "s"}`)
    .max(max, `${label} must be ${max} characters or fewer`);

export const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

/**
 * A date from a form (AUD-09 §4, FV-07). A `YYYY-MM-DD` value is a calendar
 * day: it must exist (30 February is refused, not rolled over into March) and
 * becomes that day's UTC midnight — never local midnight, which moves it a day
 * for somebody east or west of the server. Anything else (a full timestamp from
 * an API client, a `datetime-local` value, a `Date`) is read as before.
 */
const DATE_LIKE = /^\d{4}-\d{1,2}-\d{1,2}$/;

function formDate(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!DATE_LIKE.test(text)) return text;
  // "2026-9-7" is the same day as "2026-09-07", not local midnight.
  const [y, m, d] = text.split("-");
  const padded = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isDateOnly(padded) ? new Date(`${padded}T00:00:00.000Z`) : new Date(Number.NaN);
}

const formDateSchema = z.preprocess(formDate, z.coerce.date({ message: "Enter a real date, e.g. 2026-09-27." }));

export const optionalDate = z
  .union([z.literal(""), formDateSchema])
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : (value as Date)));

export const requiredDate = formDateSchema;

/**
 * An unset `<select>` submits an empty string, not an absent key. Treating that
 * as "no value" rather than an invalid enum member is what lets a form be
 * submitted with an optional dropdown left alone.
 */
export function optionalEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.enum(values), z.literal("")])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : (value as T[number])));
}

/** A checkbox that may be absent, "on", "true" or a real boolean. */
export const optionalBoolean = z
  .union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((value) => {
    if (value === undefined || value === "") return undefined;
    if (typeof value === "boolean") return value;
    return value === "on" || value === "true";
  });

/* -------------------------------------------------------------------------- */
/* AUD-09 additions: decimals, calendar dates and partial-update fields        */
/* -------------------------------------------------------------------------- */

/**
 * A typed number as its canonical decimal string (AUD-09 §4, FV-06), by
 * `lib/forms/decimal`'s one rule: `1,234` is refused as ambiguous, `1e5`,
 * NaN and Infinity as malformed, and too many decimals are refused, never
 * rounded. A JSON number is read through the same rule.
 */
export function decimalText(rule: DecimalRule) {
  return z.union([z.string(), z.number()]).transform((value, ctx) => {
    const parsed = parseDecimalInput(String(value), rule);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.message, params: { code: parsed.code } });
      return z.NEVER;
    }
    return parsed.value;
  });
}

/** As `decimalText`, where empty (or absent, or null) is "no value" — `undefined`, never zero. */
export function optionalDecimalText(rule: DecimalRule) {
  return z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === null || String(value).trim() === "") return undefined;
      const parsed = parseDecimalInput(String(value), rule);
      if (!parsed.ok) {
        ctx.addIssue({ code: "custom", message: parsed.message, params: { code: parsed.code } });
        return z.NEVER;
      }
      return parsed.value;
    });
}

/** A calendar date only (`YYYY-MM-DD`, a real day), as that day's UTC midnight. Timestamps are refused. */
export function calendarDate(label = "Date") {
  return z.string().transform((value, ctx) => {
    const parsed = parseDateOnly(value, { label });
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.message, params: { code: parsed.code } });
      return z.NEVER;
    }
    return new Date(`${parsed.value}T00:00:00.000Z`);
  });
}

/*
 * Partial updates (AUD-09 §4, FV-05): absent keeps the saved value
 * (`undefined`), `""` or `null` is the person clearing it (`null`), a value
 * replaces it. The three are never merged — use these on an update schema,
 * never a create default.
 */

export const patchText = (max: number) =>
  z
    .union([z.string().trim().max(max, `Keep this under ${max.toLocaleString("en")} characters.`), z.null()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : value));

export const patchId = z
  .union([z.string().trim().max(64), z.null()])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : value));

export const patchDate = z
  .union([z.literal(""), z.null(), formDateSchema])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : (value as Date)));

export function patchEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.enum(values), z.literal(""), z.null()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "" || value === null ? null : (value as T[number])));
}

/** A checkbox on an update: absent keeps the saved value; only an explicit value (or the `__present` marker, read by `lib/forms/normalize`) changes it. */
export const patchBoolean = z
  .union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("false")])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === true || value === "on" || value === "true"));
