import { z } from "zod";

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

export const optionalDate = z
  .union([z.coerce.date(), z.literal("")])
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : (value as Date)));

export const requiredDate = z.coerce.date();

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
